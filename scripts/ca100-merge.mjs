#!/usr/bin/env node
/**
 * Step 2 — Merge ca100.json into per-company JSON. — B-Data8.
 *
 * Reads /public/data/ca100.json (produced annually by ca100-fetch.mjs)
 * and writes the structured `ca100` field into each matching company
 * file under enriched.environment.ca100. Honors slug-aliases.json +
 * brand-parent-map.json.
 *
 * TARGET SCHEMA (only set when status === "ok"):
 *   company.enriched.environment.ca100 = {
 *     included: true,
 *     latest_benchmark_year: number,
 *     scores: {
 *       disclosure: number,           // 0-5
 *       alignment: number,            // 0-5
 *       governance: number,           // 0-5
 *       capital_allocation: number    // 0-5
 *     },
 *     net_zero_target_year: number | null,
 *     scope_1_2_emissions_mt_co2e: number | null,
 *     source_url: string,
 *     last_updated: ISO string,
 *     source: "climate-action-100"
 *   }
 *
 * DRY-RUN
 *   Default. Computes everything, writes the merge log, but does NOT
 *   touch per-company JSON. Pass --apply to actually write the per-
 *   company files.
 *
 * Locally:
 *   node scripts/ca100-merge.mjs                # default --dry (no writes)
 *   node scripts/ca100-merge.mjs --apply        # actually write changes
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CA100_FILE = path.join(ROOT, "public/data/ca100.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/ca100-merge-log.json");

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");

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

function resolveSlug(slug, maps) {
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) return { slug, routed_via: "direct" };
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return { slug: alias, routed_via: "alias" };
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return { slug: parent, routed_via: "parent" };
  return { slug: null, routed_via: "orphan" };
}

async function mergeOne(brandEntry, maps, now, benchmarkYear) {
  if (brandEntry.status !== "ok") {
    return { brand: brandEntry.slug, status: "skipped", reason: brandEntry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(brandEntry.slug, maps);
  if (!targetSlug) return { brand: brandEntry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: brandEntry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
  if (!company.enriched.environment || typeof company.enriched.environment !== "object") {
    company.enriched.environment = {};
  }
  const ca100Block = {
    included: true,
    latest_benchmark_year: benchmarkYear,
    scores: brandEntry.scores ?? null,
    net_zero_target_year: brandEntry.net_zero_target_year ?? null,
    scope_1_2_emissions_mt_co2e: brandEntry.scope_1_2_emissions_mt_co2e ?? null,
    source_url: brandEntry.source_url || "https://www.climateaction100.org/net-zero-company-benchmark/",
    last_updated: now,
    source: "climate-action-100",
  };
  company.enriched.environment.ca100 = ca100Block;

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.ca100 = now;

  if (APPLY) {
    await fs.writeFile(file, JSON.stringify(company));
  }

  return {
    brand:      brandEntry.slug,
    target:     targetSlug,
    routed_via,
    status:     APPLY ? "merged" : "would_merge",
    scores:     ca100Block.scores,
    net_zero_target_year: ca100Block.net_zero_target_year,
    scope_1_2_emissions_mt_co2e: ca100Block.scope_1_2_emissions_mt_co2e,
    year:       ca100Block.latest_benchmark_year,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log(`Climate Action 100+ merge starting (mode: ${APPLY ? "APPLY" : "DRY-RUN (no writes)"})...`);

  const ca = JSON.parse(await fs.readFile(CA100_FILE, "utf-8"));
  const entries = ca.rankings || [];
  const benchmarkYear = ca.benchmark_year ?? new Date().getFullYear();
  console.log(`${entries.length} brand entries (benchmark year ${benchmarkYear})`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now, benchmarkYear));
  }

  const merged  = results.filter(r => r.status === "merged" || r.status === "would_merge");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:       now,
    mode:            APPLY ? "apply" : "dry",
    source_file:     "public/data/ca100.json",
    benchmark_year:  benchmarkYear,
    total_brands:    entries.length,
    merged_count:    merged.length,
    skipped_count:   skipped.length,
    orphan_count:    orphans.length,
    error_count:     errors.length,
    orphans:         orphans.map(o => o.brand),
    ranked_list:     merged.map(r => ({
      brand:  r.brand,
      target: r.target,
      routed_via: r.routed_via,
      year:   r.year,
      scores: r.scores,
      net_zero_target_year: r.net_zero_target_year,
      scope_1_2_emissions_mt_co2e: r.scope_1_2_emissions_mt_co2e,
    })),
  }, null, 2));

  console.log(`${APPLY ? "Merged" : "Would merge"}: ${merged.length}`);
  console.log(`   Skipped (no CA100 match):       ${skipped.length}`);
  console.log(`   Orphan slugs (no company file): ${orphans.length}`);
  console.log(`   Parse errors:                   ${errors.length}`);
  if (!APPLY) console.log("\n(DRY-RUN — no per-company files written. Use --apply to commit changes.)");
}

main().catch(err => {
  console.error("ca100-merge failed:", err);
  process.exit(1);
});
