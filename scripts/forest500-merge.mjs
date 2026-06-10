#!/usr/bin/env node
/**
 * Forest 500 — Merge step.
 *
 * Reads the latest data/raw/forest500/<date>.json snapshot and writes
 * data/derived/forest500-augment.json keyed by TruNorth slug:
 *
 *   {
 *     display_name, country, sector, entity_type,
 *     overall_score, score_year,
 *     commodity_scores: { soy, palm, beef, timber, pulp },
 *     commodities_exposed: ["soy", "palm", ...],
 *     forest500Tier: "leader" | "midpack" | "laggard",
 *     hasDeforestationExposure: true,
 *     _routedVia: "slugHint" | "direct" | "alias" | "parent",
 *   }
 *
 * Tiers (out of 100): leader >= 70, laggard <= 25, else midpack. These
 * thresholds reflect Forest500's published methodology rubric.
 *
 * Slug resolution ladder (matches farm-welfare-merge convention):
 *   1) SLUG_HINTS override (curated, source-specific)
 *   2) direct slug match in public/data/index.json
 *   3) public/data/_meta/slug-aliases.json
 *   4) public/data/_meta/brand-parent-map.json (route sub-brand → parent)
 *   5) else orphan (collected for review)
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/forest500");
const OUT_DEFAULT = path.join(ROOT, "data/derived/forest500-augment.json");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");

const args = process.argv.slice(2);
const IN_OVERRIDE  = (() => { const i = args.indexOf("--in");  return i >= 0 && args[i + 1] ? args[i + 1] : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

/**
 * Curated brand-name → known slug overrides specific to Forest 500 source.
 * Forest 500 publishes legal names that diverge from TruNorth canonical
 * slugs (e.g. "Nestlé S.A." vs slug "nestl", "JBS S.A." vs "jbs-n-v",
 * "Aldi Süd" vs "aldi"). Only applied when the override slug actually
 * exists in the index — otherwise we fall through to alias/parent.
 */
export const SLUG_HINTS = {
  "nestle-s-a":                 "nestl",
  "reckitt-benckiser":          "reckitt",
  "kellanova":                  "kellogg-s",
  "henkel-and":                 "henkel",
  "l-oreal":                    "l-or-al",
  "estee-lauder":               "estee-lauder-companies",
  "jbs-s-a":                    "jbs-n-v",
  "marfrig-global-foods":       "marfrig-global-foods-s-a",
  "adecoagro":                  "adecoagro-s-a",
  "smurfit-kappa":              "smurfit-westrock",
  "westrock":                   "smurfit-westrock",
  "yum-brands":                 "kfc",
  "kfc-yum":                    "kfc",
  "pizza-hut-yum":              "pizza-hut",
  "burger-king-rbi":            "burger-king",
  "subway-ip":                  "subway",
  "chipotle-mexican-grill":     "chipotle",
  "costco-wholesale":           "costco",
  "j-sainsbury":                "sainsbury-s",
  "marks-and-spencer":          "marks-and-spencers",
  "aldi-sud":                   "aldi",
  "aldi-nord":                  "aldi",
  "lidl-schwarz":               "aldi",
  "ikea-inter-ikea":            "ikea",
  "ikea-food-services":         "ikea",
  "inditex-zara":               "zara-inditex",
  "h-and-m-hennes-and-mauritz": "handm",
  "gap":                        "gap-inc",
  "compass":                    "compass",
  "jpmorgan-chase-and":         "jpmorgan-chase",
  "credit-agricole":            "credit-agricole-s-a",
  "deutsche-bank":              "deutsche-bank-aktiengesellschaft",
  "ing":                        "ing-groep-nv",
  "santander":                  "santander-uk",
  "credit-suisse-ubs":          "credit-suisse-ag",
  "td-bank":                    "bank-of-nova-scotia",       // closest TruNorth Canadian-bank proxy
  "allianz-se":                 "allianz",
};

/* ------------------------------- helpers ------------------------------- */

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadKnownSlugs() {
  const idx = await tryReadJson(INDEX_FILE);
  if (!Array.isArray(idx)) return new Set();
  return new Set(idx.map(r => r.slug));
}

async function loadMaps() {
  const [aliases, parents] = await Promise.all([
    tryReadJson(path.join(META_DIR, "slug-aliases.json")),
    tryReadJson(path.join(META_DIR, "brand-parent-map.json")),
  ]);
  return { aliases: aliases || {}, parents: parents || {} };
}

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) throw new Error(`Missing ${RAW_DIR}`);
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function tierFor(score) {
  if (score == null) return null;
  if (score >= 70) return "leader";
  if (score <= 25) return "laggard";
  return "midpack";
}

export function buildAugment(row) {
  return {
    display_name: row.company,
    country: row.country,
    sector: row.sector,
    entity_type: row.entity_type,
    overall_score: row.overall_score_2024,
    score_year: 2024,
    commodity_scores: {
      soy: row.soy_score,
      palm: row.palm_score,
      beef: row.beef_score,
      timber: row.timber_score,
      pulp: row.pulp_score,
    },
    commodities_exposed: row.commodities || [],
    forest500Tier: tierFor(row.overall_score_2024),
    hasDeforestationExposure: true,
  };
}

/**
 * Resolve a Forest 500 row to a TruNorth slug, walking the ladder.
 */
export function resolveSlug(company, ctx) {
  const { knownSlugs, aliases, parents, hints = SLUG_HINTS } = ctx;
  const raw = toSlug(company);
  if (!raw) return { slug: null, routedVia: "orphan" };
  if (hints[raw] && knownSlugs.has(hints[raw])) {
    return { slug: hints[raw], routedVia: "slugHint" };
  }
  if (knownSlugs.has(raw)) return { slug: raw, routedVia: "direct" };
  if (aliases[raw] && knownSlugs.has(aliases[raw])) {
    return { slug: aliases[raw], routedVia: "alias" };
  }
  if (parents[raw]?.parent && knownSlugs.has(parents[raw].parent)) {
    return { slug: parents[raw].parent, routedVia: "parent" };
  }
  return { slug: null, routedVia: "orphan" };
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`Forest500 merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();
  const ctx = { knownSlugs, ...maps };

  const companies = {};
  const orphans = [];
  const routeCounts = { slugHint: 0, direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const r of rows) {
    const { slug, routedVia } = resolveSlug(r.company, ctx);
    routeCounts[routedVia] = (routeCounts[routedVia] || 0) + 1;
    if (!slug) {
      orphans.push({ company: r.company, country: r.country, score: r.overall_score_2024 });
      continue;
    }
    // First-wins per slug (e.g. McDonald's listed only once anyway).
    if (companies[slug]) continue;
    const aug = buildAugment(r);
    aug._routedVia = routedVia;
    companies[slug] = aug;
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "forest500",
    source_url: "https://forest500.org",
    upstream_file: path.relative(ROOT, inFile),
    company_count: Object.keys(companies).length,
    routing: routeCounts,
    orphan_total: orphans.length,
    orphans: orphans.slice(0, 200),
    companies,
  }, null, 2));

  const stats = { leader: 0, midpack: 0, laggard: 0, unknown: 0 };
  for (const k of Object.keys(companies)) {
    const t = companies[k].forest500Tier ?? "unknown";
    stats[t] = (stats[t] || 0) + 1;
  }
  console.log(`✅ Wrote ${outFile} — ${Object.keys(companies).length} companies (${JSON.stringify(stats)})`);
  console.log(`Routing:`, routeCounts, `orphans: ${orphans.length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("forest500-merge failed:", err);
    process.exit(1);
  });
}
