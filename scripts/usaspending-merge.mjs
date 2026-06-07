#!/usr/bin/env node
/**
 * USAspending — Step 2: Merge usaspending-contracts.json into per-company JSON.
 *
 * Reads /public/data/usaspending-contracts.json (produced quarterly by
 * usaspending-fetch.mjs --apply) and writes the structured `federalContracts`
 * field into each matching company file under `enriched.federalContracts`.
 *
 * The fetcher already curates target slugs (each entry already maps 1:1 to a
 * TruNorth company file, with a small number of intentional orphans like
 * "3m" or "booz-allen-hamilton"), so this merger only needs to:
 *   1. Resolve via direct slug match → slug-aliases → brand-parent-map.
 *   2. Refuse to overwrite if the existing record is newer.
 *   3. Drop _internal fields (_orphan, _source, _synthetic) before writing.
 *
 * Flags:
 *   --dry      (default) — print what WOULD be written, don't touch disk.
 *   --apply    — write company files + merge log.
 *
 * Locally:
 *   node scripts/usaspending-merge.mjs            # dry by default
 *   node scripts/usaspending-merge.mjs --apply    # actually merge
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/usaspending-contracts.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "usaspending-merge-log.json");

const argv  = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const DRY   = !APPLY;

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

export function resolveSlug(slug, maps) {
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) {
    return { slug, routed_via: "direct" };
  }
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

// Build the public-facing `federalContracts` block from the fetcher record.
// Drops _internal fields and renames keys to TruNorth's camelCase convention.
export function buildFederalContractsBlock(record, now) {
  return {
    totalObligatedUSDLast5y: record.total_obligated_USD_last_5y,
    awardCountLast5y:        record.award_count_last_5y,
    recentTop5:              (record.recent_top5 || []).map(a => ({
      date:        a.date,
      agency:      a.agency,
      naics:       a.naics,
      amount:      a.amount,
      description: a.description,
    })),
    primaryAgency: record.primary_agency,
    primaryNaics:  record.primary_naics,
    lastUpdated:   now,
    source:        "usaspending",
    sourceUrl:     "https://www.usaspending.gov/",
  };
}

async function mergeOne(record, maps, now) {
  // Skip records that didn't yield real data.
  if (record.status === "error") {
    return { slug: record.slug, status: "skipped_error", error: record.error };
  }
  if (record.status === "no_contracts" || record.total_obligated_USD_last_5y === 0) {
    return { slug: record.slug, status: "skipped_no_contracts" };
  }

  const { slug: target, routed_via } = resolveSlug(record.slug, maps);
  if (!target) {
    return { slug: record.slug, status: "orphan", obligated: record.total_obligated_USD_last_5y };
  }

  const file = path.join(COMP_DIR, `${target}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) {
    return { slug: record.slug, target, status: "parse_error", error: e.message };
  }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
  company.enriched.federalContracts = buildFederalContractsBlock(record, now);

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.federalContracts = now;

  if (APPLY) {
    await fs.writeFile(file, JSON.stringify(company));
  }

  return {
    slug:         record.slug,
    target,
    routed_via,
    status:       APPLY ? "merged" : "would_merge",
    obligated:    record.total_obligated_USD_last_5y,
    award_count:  record.award_count_last_5y,
  };
}

function fmtUSD(n) {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

async function main() {
  const now = new Date().toISOString();
  console.log(`USAspending merge starting... (mode=${DRY ? "DRY" : "APPLY"})`);

  if (!existsSync(SRC_FILE)) {
    console.error(`Missing ${SRC_FILE}. Run usaspending-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8"));
  const records = src.contracts || [];
  console.log(`Loaded ${records.length} brand records (generated_at=${src.generated_at})`);

  const maps = await loadMaps();

  const results = [];
  for (const r of records) {
    results.push(await mergeOne(r, maps, now));
  }

  const merged  = results.filter(r => r.status === "merged" || r.status === "would_merge");
  const orphans = results.filter(r => r.status === "orphan");
  const skipped = results.filter(r => r.status?.startsWith("skipped"));
  const errors  = results.filter(r => r.status === "parse_error");

  console.log(`\nResults:`);
  console.log(`  ${merged.length} ${DRY ? "WOULD merge" : "merged"}`);
  console.log(`  ${orphans.length} orphan (no company file)`);
  console.log(`  ${skipped.length} skipped (no contracts / error)`);
  console.log(`  ${errors.length} parse errors`);

  if (merged.length > 0) {
    console.log(`\nTop merges:`);
    for (const m of [...merged].sort((a, b) => (b.obligated || 0) - (a.obligated || 0)).slice(0, 15)) {
      console.log(`  ${fmtUSD(m.obligated).padStart(10)}  ${m.slug} -> ${m.target} (${m.routed_via})`);
    }
  }
  if (orphans.length > 0) {
    console.log(`\nOrphans (no TruNorth company file):`);
    for (const o of orphans) {
      console.log(`  ${fmtUSD(o.obligated).padStart(10)}  ${o.slug}`);
    }
  }

  if (APPLY) {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify({
      merged_at:      now,
      source_file:    "public/data/usaspending-contracts.json",
      total_records:  records.length,
      merged_count:   merged.length,
      orphan_count:   orphans.length,
      skipped_count:  skipped.length,
      error_count:    errors.length,
      merged_brands:  merged.map(m => ({
        slug: m.slug,
        target: m.target,
        routed_via: m.routed_via,
        obligated_USD: m.obligated,
        award_count: m.award_count,
      })),
      orphans:        orphans.map(o => ({ slug: o.slug, obligated_USD: o.obligated })),
    }, null, 2));
    console.log(`\nWrote ${LOG_FILE}`);
  } else {
    console.log(`\nDRY RUN — no company files written. Re-run with --apply to merge.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("usaspending-merge failed:", err);
    process.exit(1);
  });
}
