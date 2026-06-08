#!/usr/bin/env node
/**
 * Corporate giving — Step 2: Merge data/raw/corporate-giving/<date>.json
 * into a slug-keyed augment file at data/derived/corporate-giving-augment.json.
 *
 * Key behavior:
 *   - Reads the LATEST data/raw/corporate-giving/<date>.json (lex-greatest).
 *   - For each seed record we already know maps 1:1 to a TruNorth company
 *     slug, we emit `{slug: {charity: {…}}}` directly.
 *   - For every entry in public/data/_meta/brand-parent-map.json that
 *     names a parent we DO have giving data for, we ALSO emit an entry
 *     for the subsidiary slug pointing at the parent's record (with a
 *     `routedVia: "parent"` tag) so 100% of mapped subsidiaries inherit.
 *   - We honor slug-aliases.json the same way.
 *
 * Output:
 *   data/derived/corporate-giving-augment.json
 *
 * Per-entry value shape:
 *   {
 *     charity: {
 *       totalGivingUsd: 1_730_000_000,
 *       pctRevenue:     0.0027,
 *       year:           2024,
 *       sourceUrl:      "https://corporate.walmart.com/purpose/philanthropy",
 *       foundationName: "Walmart Foundation",
 *       ein:            "20-5639919",
 *       source:         "corporate-disclosure" | "blend",
 *       foundation990:  { totalGrants, fiscalYear, propublicaUrl }  // optional
 *     },
 *     routedVia: "direct" | "alias" | "parent",
 *     parentSlug: "walmart"   // only when routedVia === "parent"
 *   }
 *
 * Locally: node scripts/corporate-giving-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/corporate-giving");
const OUT_FILE = path.join(ROOT, "data/derived/corporate-giving-augment.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");

const argv  = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");  // alias: also write through to per-company JSON
const RAW_ARG = (() => {
  const i = process.argv.indexOf("--raw");
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ───────────────────────────────────────────────────────────────

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

async function findLatestRaw() {
  if (RAW_ARG) return RAW_ARG;
  const entries = await fs.readdir(RAW_DIR).catch(() => []);
  const dated = entries.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (dated.length === 0) throw new Error(`No dated raw file in ${RAW_DIR}`);
  return path.join(RAW_DIR, dated[dated.length - 1]);
}

// Build the public-facing `charity` block from one raw record.
// Drops _internal fields and renames as needed.
export function buildCharityBlock(record) {
  return {
    totalGivingUsd: record.totalGivingUsd,
    pctRevenue:     record.pctRevenue ?? null,
    year:           record.year,
    sourceUrl:      record.sourceUrl,
    foundationName: record.foundationName ?? null,
    ein:            record.ein ?? null,
    source:         record.source || "corporate-disclosure",
    ...(record.foundation990 ? { foundation990: record.foundation990 } : {}),
  };
}

function companyExists(slug) {
  return existsSync(path.join(COMP_DIR, `${slug}.json`));
}

// Walk the parent map and produce { childSlug: { parentSlug, charity } }
// for every child that points at a parent we have data for, AND that
// has a company file we can write into.
function fanOutThroughParents(directBySlug, parents) {
  const out = {};
  for (const [child, info] of Object.entries(parents)) {
    if (!info || typeof info !== "object") continue;
    const parentSlug = info.parent;
    if (!parentSlug) continue;
    if (!directBySlug[parentSlug]) continue;
    if (!companyExists(child)) continue;
    if (directBySlug[child]) continue;     // already direct, skip
    out[child] = {
      parentSlug,
      charity: directBySlug[parentSlug],
    };
  }
  return out;
}

// Same, for slug-aliases.
function fanOutThroughAliases(directBySlug, aliases) {
  const out = {};
  for (const [alias, target] of Object.entries(aliases)) {
    if (!target) continue;
    if (!directBySlug[target]) continue;
    if (!companyExists(alias)) continue;
    if (directBySlug[alias]) continue;
    out[alias] = {
      aliasOf: target,
      charity: directBySlug[target],
    };
  }
  return out;
}

function fmtUsd(n) {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

async function main() {
  const rawFile = await findLatestRaw();
  console.log(`Reading ${rawFile}`);
  const payload = JSON.parse(await fs.readFile(rawFile, "utf-8"));
  const records = payload.companies || [];
  console.log(`${records.length} raw records`);

  const maps = await loadMaps();

  // 1. Direct matches: build charity block for every record whose slug
  // either has a company file directly OR resolves through an alias.
  const directBySlug   = {};   // slug → charity block (used as data source)
  const augmentBySlug  = {};   // slug → { charity, routedVia, parentSlug? }
  const skipped        = [];   // [{slug, reason}]
  const orphans        = [];   // slug not in companies and not in parent/alias maps

  for (const r of records) {
    if (r.status !== "ok") {
      skipped.push({ slug: r.slug, reason: r.status });
      continue;
    }
    const charity = buildCharityBlock(r);
    directBySlug[r.slug] = charity;

    if (companyExists(r.slug)) {
      augmentBySlug[r.slug] = { charity, routedVia: "direct" };
    } else if (maps.aliases[r.slug] && companyExists(maps.aliases[r.slug])) {
      augmentBySlug[maps.aliases[r.slug]] = { charity, routedVia: "alias", aliasFrom: r.slug };
    } else if (maps.parents[r.slug]?.parent && companyExists(maps.parents[r.slug].parent)) {
      // The seed slug itself is a subsidiary — route the data to its parent.
      const parent = maps.parents[r.slug].parent;
      if (!augmentBySlug[parent]) {
        augmentBySlug[parent] = { charity, routedVia: "seed-routed-to-parent", seedSlug: r.slug };
      }
    } else {
      orphans.push(r.slug);
    }
  }

  // 2. Fan out through parent map: every subsidiary in brand-parent-map
  // inherits its parent's charity data. (Most informative — Olay → P&G,
  // Doritos → PepsiCo, etc.)
  const viaParents = fanOutThroughParents(directBySlug, maps.parents);
  for (const [child, val] of Object.entries(viaParents)) {
    augmentBySlug[child] = {
      charity: val.charity,
      routedVia: "parent",
      parentSlug: val.parentSlug,
    };
  }

  // 3. Fan out through slug-aliases.
  const viaAliases = fanOutThroughAliases(directBySlug, maps.aliases);
  for (const [alias, val] of Object.entries(viaAliases)) {
    if (augmentBySlug[alias]) continue;
    augmentBySlug[alias] = {
      charity: val.charity,
      routedVia: "alias",
      aliasOf: val.aliasOf,
    };
  }

  // Stats
  const matched = Object.keys(augmentBySlug).length;
  const routedDirect = Object.values(augmentBySlug).filter(v => v.routedVia === "direct").length;
  const routedParent = Object.values(augmentBySlug).filter(v => v.routedVia === "parent").length;
  const routedAlias  = Object.values(augmentBySlug).filter(v => v.routedVia === "alias").length;

  console.log(`\nResults:`);
  console.log(`  ${matched} total matched companies`);
  console.log(`    direct:        ${routedDirect}`);
  console.log(`    via parent:    ${routedParent}`);
  console.log(`    via alias:     ${routedAlias}`);
  console.log(`  ${orphans.length} orphan seeds (no company file, no alias, no parent)`);
  console.log(`  ${skipped.length} skipped (non-ok records)`);

  // Top 10 givers (by direct dollars, deduped — exclude children that inherit
  // a parent's number).
  const topGivers = records
    .filter(r => r.status === "ok" && !r.inheritedFromParent)
    .map(r => ({ slug: r.slug, totalGivingUsd: r.totalGivingUsd }))
    .sort((a, b) => b.totalGivingUsd - a.totalGivingUsd)
    .slice(0, 10);
  console.log(`\nTop 10 givers ($ disclosed):`);
  for (const t of topGivers) console.log(`  ${fmtUsd(t.totalGivingUsd).padStart(8)}  ${t.slug}`);

  // Write augment
  const out = {
    _license:    "Public domain — IRS Form 990 + corporate citizenship disclosures",
    _source:     "data/raw/corporate-giving/<date>.json",
    _source_file:rawFile.replace(ROOT + "/", ""),
    _generated_at: new Date().toISOString(),
    _stats: {
      raw_records:   records.length,
      matched:       matched,
      via_direct:    routedDirect,
      via_parent:    routedParent,
      via_alias:     routedAlias,
      orphans:       orphans.length,
      skipped:       skipped.length,
    },
    orphans,
    companies: augmentBySlug,
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE}`);

  if (APPLY) {
    // Optional: write through into per-company JSON under company.charityCorporate.
    console.log(`\n--apply: writing charityCorporate field into ${matched} company files...`);
    let written = 0;
    for (const [slug, val] of Object.entries(augmentBySlug)) {
      const file = path.join(COMP_DIR, `${slug}.json`);
      try {
        const company = JSON.parse(await fs.readFile(file, "utf-8"));
        company.charityCorporate = val.charity;
        if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
          company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
        }
        company.dataLastUpdated.charityCorporate = out._generated_at;
        await fs.writeFile(file, JSON.stringify(company));
        written++;
      } catch (e) {
        console.warn(`  skip ${slug}: ${e.message}`);
      }
    }
    console.log(`  wrote ${written} company files`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("corporate-giving-merge failed:", err);
    process.exit(1);
  });
}
