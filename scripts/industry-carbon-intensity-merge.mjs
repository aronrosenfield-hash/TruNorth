#!/usr/bin/env node
/**
 * Industry-sector carbon-intensity MERGE (annual, Sprint I — environment).
 *
 * For every brand in public/data/index.json, look up its `cat` field, resolve
 * it to a NAICS code + intensity tier via the snapshot written by the fetcher,
 * and emit a SECTOR-LEVEL ENVIRONMENT PROXY keyed by slug.
 *
 * Output:
 *   data/derived/industry-carbon-intensity-augment.json
 *   {
 *     _license, _sources, _generated_at, _source_file,
 *     _stats: { ... },
 *     companies: {
 *       "<slug>": {
 *         environment: {
 *           industryTier:             "very-high|high|medium|low|very-low",
 *           inferredCarbonIntensity:  <kg CO2e per $>,
 *           industryCategory:         "<our cat>",
 *           industryNaics:            "<naics>",
 *           industryNaicsLabel:       "<label>",
 *           sourceUrl:                "https://ourworldindata.org/emissions-by-sector",
 *           _inferred:                true,    // CRITICAL — see below
 *         }
 *       },
 *       ...
 *     }
 *   }
 *
 *   The `_inferred: true` flag is LOAD-BEARING. The UI MUST treat this
 *   block as "industry typical" copy, not "this company's actual
 *   emissions". Existing per-company direct emissions data
 *   (enriched.environment.ghg_* / tri_*) is always more authoritative;
 *   downstream merge order should overlay this AUGMENT first, then let
 *   direct EPA GHGRP/TRI data take precedence.
 *
 * Flags:
 *   --dry     (default) — write the augment JSON, print a summary.
 *                         (No per-company file writes — this is an augment
 *                          file consumed by the app's data loader, like
 *                          data/derived/wikirate-augment.json.)
 *   --apply   — same as --dry today. Reserved for future per-company writes.
 *   --print   — pretty-print sector coverage to stdout.
 *
 * Locally:
 *   node scripts/industry-carbon-intensity-merge.mjs
 *   node scripts/industry-carbon-intensity-merge.mjs --print
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE   = path.join(ROOT, "public/data/index.json");
const RAW_DIR      = path.join(ROOT, "data/raw/industry-carbon-intensity");
const OUT_FILE     = path.join(ROOT, "data/derived/industry-carbon-intensity-augment.json");

const argv  = new Set(process.argv.slice(2));
const PRINT = argv.has("--print");

const SOURCE_URL = "https://ourworldindata.org/emissions-by-sector";

// ───────────────────────── snapshot loader ──────────────────────────────────
//
// Finds the most-recent YYYY-MM-DD.json under data/raw/industry-carbon-intensity/.
// If none exists, falls back to a fresh in-memory build (so the merger still
// works on a clean checkout without a prior fetch run).
//
export async function loadLatestSnapshot() {
  if (!existsSync(RAW_DIR)) return { source: null, snapshot: null };
  const entries = (await fs.readdir(RAW_DIR)).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n));
  if (entries.length === 0) return { source: null, snapshot: null };
  entries.sort();
  const newest = entries[entries.length - 1];
  const snap = JSON.parse(await fs.readFile(path.join(RAW_DIR, newest), "utf-8"));
  return { source: path.join("data/raw/industry-carbon-intensity", newest), snapshot: snap };
}

// ───────────────────────── augment builder ──────────────────────────────────
export function buildAugmentForCompany(company, catToNaics) {
  const cat = company.cat || "Other";
  // Direct match → fall back to "Other" if the cat is unknown.
  const hit = catToNaics[cat] || catToNaics["Other"];
  if (!hit) return null;
  return {
    industryTier:            hit.tier,
    inferredCarbonIntensity: hit.kgCO2ePerUSD,
    industryCategory:        cat,
    industryNaics:           hit.naics,
    industryNaicsLabel:      hit.label,
    sourceUrl:               SOURCE_URL,
    _inferred:               true,
  };
}

// ────────────────────────────── index loader ────────────────────────────────
function asArray(rawIndex) {
  if (Array.isArray(rawIndex)) return rawIndex;
  if (Array.isArray(rawIndex.companies)) return rawIndex.companies;
  if (Array.isArray(rawIndex.brands))    return rawIndex.brands;
  if (Array.isArray(rawIndex.items))     return rawIndex.items;
  return Object.values(rawIndex);
}

// ───────────────────────────── runner ──────────────────────────────────────
async function main() {
  console.log("industry-carbon-intensity merge starting...");

  const { source, snapshot } = await loadLatestSnapshot();
  if (!snapshot) {
    console.error(`No snapshot found under ${RAW_DIR}. Run industry-carbon-intensity-fetch.mjs first.`);
    process.exit(2);
  }
  console.log(`Loaded snapshot ${source} (${Object.keys(snapshot.cat_to_naics).length} cat mappings, ${Object.keys(snapshot.naics_intensity).length} NAICS buckets)`);

  const indexRaw = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const companies = asArray(indexRaw);
  console.log(`Loaded index: ${companies.length} companies`);

  const out = {};
  const tierCounts   = { "very-high": 0, "high": 0, "medium": 0, "low": 0, "very-low": 0 };
  const sectorCounts = {};       // cat → { count, tier, kgCO2ePerUSD }
  const unknownCats  = new Map();
  let covered = 0;
  let skipped = 0;

  for (const c of companies) {
    if (!c.slug) { skipped++; continue; }
    const cat = c.cat || "Other";
    const hit = snapshot.cat_to_naics[cat];
    if (!hit) {
      unknownCats.set(cat, (unknownCats.get(cat) || 0) + 1);
      // Still emit a record so coverage is universal — use "Other" fallback.
    }
    const aug = buildAugmentForCompany(c, snapshot.cat_to_naics);
    if (!aug) { skipped++; continue; }

    out[c.slug] = { environment: aug };
    covered++;
    tierCounts[aug.industryTier] = (tierCounts[aug.industryTier] || 0) + 1;

    const sk = aug.industryCategory;
    if (!sectorCounts[sk]) {
      sectorCounts[sk] = {
        count: 0,
        tier: aug.industryTier,
        kgCO2ePerUSD: aug.inferredCarbonIntensity,
        naics: aug.industryNaics,
        label: aug.industryNaicsLabel,
      };
    }
    sectorCounts[sk].count++;
  }

  const augment = {
    _license:       snapshot._license,
    _sources:       snapshot._sources,
    _source_file:   source,
    _generated_at:  new Date().toISOString(),
    _units:         snapshot._units,
    _stats: {
      total_companies:    companies.length,
      covered,
      skipped,
      tier_counts:        tierCounts,
      unknown_cats:       Object.fromEntries([...unknownCats.entries()].sort((a, b) => b[1] - a[1])),
      naics_bucket_count: Object.keys(snapshot.naics_intensity).length,
      cat_mapping_count:  Object.keys(snapshot.cat_to_naics).length,
    },
    sector_summary: sectorCounts,
    companies:      out,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  // Minified — 11k companies × ~150 bytes each is 1.5MB minified vs 4MB
  // pretty. The shape is stable + machine-consumed by the app's data loader.
  await fs.writeFile(OUT_FILE, JSON.stringify(augment));
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  covered: ${covered} / ${companies.length}`);
  console.log(`  tiers:   ${JSON.stringify(tierCounts)}`);
  if (unknownCats.size > 0) {
    console.log(`  unknown cats (fell back to "Other"): ${[...unknownCats.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  if (PRINT) {
    const ranked = Object.entries(sectorCounts).sort((a, b) => b[1].kgCO2ePerUSD - a[1].kgCO2ePerUSD);
    console.log("\nSector coverage (sorted by inferred intensity):");
    for (const [cat, v] of ranked) {
      console.log(`  ${String(v.count).padStart(5)} co  ${v.tier.padEnd(10)} ${String(v.kgCO2ePerUSD).padStart(5)} kgCO2e/$  ${cat}  → NAICS ${v.naics} (${v.label})`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("industry-carbon-intensity-merge failed:", err);
    process.exit(1);
  });
}
