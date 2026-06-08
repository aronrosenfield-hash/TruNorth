#!/usr/bin/env node
/**
 * TCO Certified — merge product records into per-slug brand augment.
 *
 * Reads the most-recent file under data/raw/tco-certified/ (or --in
 * override) and produces data/derived/tco-certified-augment.json keyed by
 * TruNorth brand slug.
 *
 * Per the brief:
 *   value: {
 *     environment: {
 *       tcoCertifiedCount: <int>,
 *       latestCertYear: <int|null>,
 *       productCategories: [<string>...unique],
 *       sourceUrl: "https://tcocertified.com/product-finder/"
 *     }
 *   }
 *
 * Matching strategy (in priority order):
 *   1. Direct: slugify(brand_name) hits a known slug in index.json.
 *   2. Tech alias map (TECH_BRAND_ALIASES below): hand-curated mapping of
 *      common TCO-style brand strings to the TruNorth parent slug
 *      ("Samsung Electronics" → "samsung-usa", "LG Electronics" → "lg-usa",
 *      etc.). Most of the top-15 IT brands in the registry use a Holding
 *      Co. style name that doesn't match our slugs verbatim.
 *   3. brand-parent-map.json fallback for sub-brand → parent rollups.
 *   4. Anything that still doesn't match is recorded in
 *      _orphan_brands with a count, so future runs can promote them
 *      into the alias map.
 *
 * Locally:
 *   node scripts/tco-certified-merge.mjs
 *   node scripts/tco-certified-merge.mjs --in /tmp/tco.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/tco-certified");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/tco-certified-augment.json");
const SOURCE_URL = "https://tcocertified.com/product-finder/";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

// ─── helpers (exported for tests) ─────────────────────────────────────────

/** Slugify: lowercase, strip diacritics, collapse non-alnum to `-`. */
export function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Hand-curated mapping of TCO brand strings → TruNorth parent slug.
 * Pulled from the top brands that appear in the live product-finder.
 * "LHS = slugified TCO brand_name" → "RHS = our slug".
 */
export const TECH_BRAND_ALIASES = {
  // Apple — direct, no alias needed (kept for documentation)
  "apple-inc": "apple",
  // Samsung
  "samsung-electronics":            "samsung-usa",
  "samsung-electronics-co-ltd":     "samsung-usa",
  "samsung-display":                "samsung-usa",
  // LG
  "lg-electronics":                 "lg-usa",
  "lg-electronics-inc":             "lg-usa",
  "lg-display":                     "lg-usa",
  // Sony
  "sony":                           "sony-usa",
  "sony-corporation":               "sony-usa",
  // Panasonic
  "panasonic":                      "panasonic-usa",
  "panasonic-corporation":          "panasonic-usa",
  // HP — direct in our index, but include the full name variant
  "hp-inc":                         "hp",
  "hewlett-packard":                "hp",
  // HPE — distinct from HP Inc.
  "hewlett-packard-enterprise":     "hewlett-packard-enterprise",
  "hpe":                            "hewlett-packard-enterprise",
  // Dell
  "dell":                           "dell",
  "dell-technologies":              "dell",
  "dell-inc":                       "dell",
  // Lenovo
  "lenovo":                         "lenovo",
  "lenovo-group":                   "lenovo",
  // Microsoft
  "microsoft":                      "microsoft",
  "microsoft-corporation":          "microsoft",
  // Acer
  "acer":                           "acer",
  "acer-inc":                       "acer",
  // Cisco
  "cisco":                          "cisco",
  "cisco-systems":                  "cisco-systems",
  // Motorola Solutions (NOT Motorola Mobility — that's Lenovo)
  "motorola-solutions":             "motorola-solutions",
  // Xiaomi
  "xiaomi":                         "xiaomi",
  // Toshiba laptop business → Dynabook (a Sharp subsidiary). No direct
  // slug today; left out so it falls through to orphan logging.
};

/**
 * Resolve a brand_name string to a TruNorth slug.
 * Returns { slug, routedVia } where routedVia ∈ {"direct","alias","brand-parent","orphan"}.
 */
export function resolveBrand(rawName, indexSlugs, parentMap) {
  if (!rawName) return { slug: null, routedVia: "orphan" };
  const slug = slugify(rawName);
  if (!slug) return { slug: null, routedVia: "orphan" };

  if (indexSlugs.has(slug)) return { slug, routedVia: "direct" };

  if (TECH_BRAND_ALIASES[slug] && indexSlugs.has(TECH_BRAND_ALIASES[slug])) {
    return { slug: TECH_BRAND_ALIASES[slug], routedVia: "alias" };
  }

  const pm = parentMap[slug];
  if (pm?.parent && indexSlugs.has(pm.parent)) {
    return { slug: pm.parent, routedVia: "brand-parent" };
  }

  return { slug: null, routedVia: "orphan" };
}

/**
 * Aggregate a list of normalized products into the per-slug shape the
 * brief requires.
 * Returns: { [slug]: { environment: { tcoCertifiedCount, latestCertYear,
 *                                     productCategories: [...], sourceUrl } } }
 * Exposed for tests.
 */
export function aggregateBySlug(products, { indexSlugs, parentMap }) {
  const acc = new Map();           // slug -> { count, years:Set, cats:Set }
  const orphan = new Map();        // raw brand_name -> count
  const routedViaCounts = { direct: 0, alias: 0, "brand-parent": 0, orphan: 0 };

  for (const p of products) {
    const { slug, routedVia } = resolveBrand(p.brand_name, indexSlugs, parentMap);
    routedViaCounts[routedVia]++;

    if (!slug) {
      const key = p.brand_name || "(blank)";
      orphan.set(key, (orphan.get(key) || 0) + 1);
      continue;
    }

    let entry = acc.get(slug);
    if (!entry) {
      entry = { count: 0, years: new Set(), cats: new Set() };
      acc.set(slug, entry);
    }
    entry.count++;
    if (p.certification_date) {
      const yr = Number(p.certification_date.slice(0, 4));
      if (Number.isFinite(yr) && yr >= 1990 && yr <= 2100) entry.years.add(yr);
    }
    if (p.category) entry.cats.add(p.category);
  }

  const bySlug = {};
  for (const [slug, e] of acc.entries()) {
    bySlug[slug] = {
      environment: {
        tcoCertifiedCount: e.count,
        latestCertYear: e.years.size ? Math.max(...e.years) : null,
        productCategories: [...e.cats].sort(),
        sourceUrl: SOURCE_URL,
      },
    };
  }

  const orphans = [...orphan.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { bySlug, orphans, routedViaCounts };
}

// ─── load ─────────────────────────────────────────────────────────────────

async function loadIndexSlugs() {
  const text = await fs.readFile(INDEX_FILE, "utf-8");
  const arr = JSON.parse(text);
  return new Set(arr.map(c => c.slug));
}

async function loadParentMap() {
  try {
    const text = await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8");
    const obj = JSON.parse(text);
    // Strip the doc field; everything else is { parent, confidence, ... }
    const { _doc, ...rest } = obj;
    return rest;
  } catch {
    return {};
  }
}

async function pickLatestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) {
    throw new Error(`No raw dir at ${RAW_DIR}; run tco-certified-fetch.mjs first.`);
  }
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No raw files in ${RAW_DIR}; run tco-certified-fetch.mjs first.`);
  }
  return path.join(RAW_DIR, files[files.length - 1]);
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("TCO Certified merger");

  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const products = raw.products || [];
  console.log(`  ${products.length} raw products`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap = await loadParentMap();
  console.log(`  Loaded ${indexSlugs.size} index slugs + ${Object.keys(parentMap).length} brand-parent entries`);

  const { bySlug, orphans, routedViaCounts } = aggregateBySlug(products, { indexSlugs, parentMap });

  const output = {
    _license: "Public, TCO Certified product registry",
    _source_url: SOURCE_URL,
    _source_raw_file: path.relative(ROOT, rawPath),
    _generated_at: new Date().toISOString(),
    _matched_slug_count: Object.keys(bySlug).length,
    _orphan_brand_count: orphans.length,
    _orphan_brands: orphans.slice(0, 30),  // top 30 unmatched for triage
    _routing_counts: routedViaCounts,
    bySlug,
  };

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs: ${Object.keys(bySlug).length}`);
  console.log(`  Routing: direct=${routedViaCounts.direct} alias=${routedViaCounts.alias} brand-parent=${routedViaCounts["brand-parent"]} orphan=${routedViaCounts.orphan}`);

  // Top 5 brands by cert count
  const top = Object.entries(bySlug)
    .sort((a, b) => b[1].environment.tcoCertifiedCount - a[1].environment.tcoCertifiedCount)
    .slice(0, 5);
  if (top.length) {
    console.log(`\nTop 5 matched brands by cert count:`);
    for (const [slug, val] of top) {
      console.log(`  ${String(val.environment.tcoCertifiedCount).padStart(4)}  ${slug}  (latest ${val.environment.latestCertYear ?? "—"}, ${val.environment.productCategories.length} categories)`);
    }
  }
  if (orphans.length) {
    console.log(`\nTop 5 orphan brands (no slug match — promote into TECH_BRAND_ALIASES if needed):`);
    for (const o of orphans.slice(0, 5)) {
      console.log(`  ${String(o.count).padStart(4)}  ${o.name}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("tco-certified-merge failed:", err);
    process.exit(1);
  });
}
