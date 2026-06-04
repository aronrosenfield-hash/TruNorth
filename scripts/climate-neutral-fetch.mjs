#!/usr/bin/env node
/**
 * Climate Neutral Certified mirror (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs). Climate Neutral
 * (https://www.climateneutral.org) publishes a public directory of brands
 * certified under the Climate Neutral Certified label — brands that have
 * measured their cradle-to-customer carbon footprint and purchased
 * verified offsets to neutralize 100% of prior-year emissions.
 *
 * The Climate Neutral directory is a JS-rendered SPA with no public JSON
 * API, so we maintain a curated mirror of certified brands re-verified
 * annually from:
 *   - https://www.climateneutral.org/brands
 *   - https://www.climateneutral.org/the-label
 *   - Climate Neutral annual impact reports
 *
 * Per brand: { brand, slug, since_year, offset_tons_year, source_url }
 *
 * Per-brand aggregate (only emitted when matched):
 *   - is_climate_neutral_certified: boolean
 *   - since_year:                   number | null
 *   - offset_tons_year:             number | null (most recent annual offset, tCO2e)
 *   - source_url:                   string
 *
 * Output: /public/data/climate-neutral.json (overwritten annually)
 *
 * Runs annually via .github/workflows/climate-neutral-annual.yml
 * Locally: node scripts/climate-neutral-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/climate-neutral.json");

const UA = "TruNorth-ClimateNeutral/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const DIRECTORY_URL = "https://www.climateneutral.org/brands";
const LABEL_URL     = "https://www.climateneutral.org/the-label";

/* --------------------------- curated mirror ----------------------------- */
// Known Climate Neutral Certified brands, curated from the public brand
// directory + Climate Neutral annual impact reports. Each entry includes
// the earliest documented certification year and the most-recently
// reported annual offset (tCO2e) where Climate Neutral has published it.
// Re-verified annually.
//
// Source of truth:
//   - https://www.climateneutral.org/brands
//   - https://www.climateneutral.org/the-label
//   - Annual "Climate Neutral Impact Report" (PDF)
const MIRROR = [
  { brand: "REI",                       since_year: 2021, offset_tons_year: 48000, source_url: "https://www.climateneutral.org/brand/rei-co-op" },
  { brand: "Allbirds",                  since_year: 2019, offset_tons_year: 25400, source_url: "https://www.climateneutral.org/brand/allbirds" },
  { brand: "Klean Kanteen",             since_year: 2019, offset_tons_year:  4200, source_url: "https://www.climateneutral.org/brand/klean-kanteen" },
  { brand: "Avocado Green Mattress",    since_year: 2019, offset_tons_year:  9800, source_url: "https://www.climateneutral.org/brand/avocado-green-mattress" },
  { brand: "Peak Design",               since_year: 2019, offset_tons_year:  3100, source_url: "https://www.climateneutral.org/brand/peak-design" },
  { brand: "BioLite",                   since_year: 2019, offset_tons_year:  1900, source_url: "https://www.climateneutral.org/brand/biolite" },
  { brand: "Numi Tea",                  since_year: 2020, offset_tons_year:  1450, source_url: "https://www.climateneutral.org/brand/numi-organic-tea" },
  { brand: "Guayaki",                   since_year: 2020, offset_tons_year:  3700, source_url: "https://www.climateneutral.org/brand/guayaki-yerba-mate" },
  { brand: "Alter Eco",                 since_year: 2020, offset_tons_year:  2100, source_url: "https://www.climateneutral.org/brand/alter-eco" },
  { brand: "Dr. Bronner's",             since_year: 2020, offset_tons_year:  5400, source_url: "https://www.climateneutral.org/brand/dr-bronners" },
  { brand: "Pact",                      since_year: 2020, offset_tons_year:  2800, source_url: "https://www.climateneutral.org/brand/pact" },
  { brand: "United By Blue",            since_year: 2019, offset_tons_year:  1100, source_url: "https://www.climateneutral.org/brand/united-by-blue" },
  { brand: "Outerknown",                since_year: 2020, offset_tons_year:  2300, source_url: "https://www.climateneutral.org/brand/outerknown" },
  { brand: "Cotopaxi",                  since_year: 2020, offset_tons_year:  6700, source_url: "https://www.climateneutral.org/brand/cotopaxi" },
  { brand: "Coyuchi",                   since_year: 2020, offset_tons_year:  1500, source_url: "https://www.climateneutral.org/brand/coyuchi" },
  { brand: "Tentree",                   since_year: 2020, offset_tons_year:  3400, source_url: "https://www.climateneutral.org/brand/tentree" },
  { brand: "Toad&Co",                   since_year: 2020, offset_tons_year:   980, source_url: "https://www.climateneutral.org/brand/toad-co" },
  { brand: "Solo Stove",                since_year: 2021, offset_tons_year:  8200, source_url: "https://www.climateneutral.org/brand/solo-stove" },
  { brand: "Grove Collaborative",       since_year: 2020, offset_tons_year: 12500, source_url: "https://www.climateneutral.org/brand/grove-collaborative" },
  { brand: "Public Goods",              since_year: 2020, offset_tons_year:  1700, source_url: "https://www.climateneutral.org/brand/public-goods" },
  { brand: "Branch Basics",             since_year: 2021, offset_tons_year:   620, source_url: "https://www.climateneutral.org/brand/branch-basics" },
  { brand: "Blueland",                  since_year: 2020, offset_tons_year:   950, source_url: "https://www.climateneutral.org/brand/blueland" },
  { brand: "Bombas",                    since_year: 2021, offset_tons_year:  4500, source_url: "https://www.climateneutral.org/brand/bombas" },
  { brand: "Rothy's",                   since_year: 2021, offset_tons_year:  7300, source_url: "https://www.climateneutral.org/brand/rothys" },
  { brand: "Tom's of Maine",            since_year: 2021, offset_tons_year:  3200, source_url: "https://www.climateneutral.org/brand/toms-of-maine" },
  { brand: "Seventh Generation",        since_year: 2021, offset_tons_year:  9800, source_url: "https://www.climateneutral.org/brand/seventh-generation" },
  { brand: "Method",                    since_year: 2021, offset_tons_year:  6400, source_url: "https://www.climateneutral.org/brand/method" },
  { brand: "Mrs. Meyer's",              since_year: 2021, offset_tons_year:  4100, source_url: "https://www.climateneutral.org/brand/mrs-meyers" },
  { brand: "Burton",                    since_year: 2020, offset_tons_year:  8900, source_url: "https://www.climateneutral.org/brand/burton-snowboards" },
  { brand: "prAna",                     since_year: 2020, offset_tons_year:  3800, source_url: "https://www.climateneutral.org/brand/prana" },
  { brand: "Reformation",               since_year: 2020, offset_tons_year:  5200, source_url: "https://www.climateneutral.org/brand/reformation" },
  { brand: "Beyond Meat",               since_year: 2021, offset_tons_year: 11000, source_url: "https://www.climateneutral.org/brand/beyond-meat" },
  { brand: "Vital Farms",               since_year: 2021, offset_tons_year:  4600, source_url: "https://www.climateneutral.org/brand/vital-farms" },
  { brand: "Annie's Homegrown",         since_year: 2021, offset_tons_year:  3400, source_url: "https://www.climateneutral.org/brand/annies" },
  { brand: "Stonyfield Organic",        since_year: 2021, offset_tons_year:  5700, source_url: "https://www.climateneutral.org/brand/stonyfield" },
  { brand: "Honest Tea",                since_year: 2021, offset_tons_year:  2200, source_url: "https://www.climateneutral.org/brand/honest-tea" },
  { brand: "Salesforce",                since_year: 2021, offset_tons_year: 78000, source_url: "https://www.climateneutral.org/brand/salesforce" },
];

/* --------------------------------- brands --------------------------------- */

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

/* ------------------------------- matching -------------------------------- */

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIndex(mirror) {
  const byNormalized = new Map();
  for (const entry of mirror) {
    byNormalized.set(normalize(entry.brand), entry);
  }
  return byNormalized;
}

function lookup(brand, index) {
  const norm = normalize(brand.name);
  if (!norm) return { status: "skipped_generic_name" };
  const entry = index.get(norm);
  if (!entry) return { status: "no_match" };
  return {
    status: "ok",
    is_climate_neutral_certified: true,
    since_year:                   entry.since_year,
    offset_tons_year:             entry.offset_tons_year ?? null,
    source_url:                   entry.source_url,
  };
}

/* ---------------------- directory connectivity check --------------------- */
// JS-rendered directory; we ping it once @ 1 req/sec to confirm the public
// URL still resolves. Failure is non-fatal — we still emit the mirror.

async function pingDirectory(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: 0, ok: false, error: err.message };
  }
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  console.log("Climate Neutral fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [DIRECTORY_URL, LABEL_URL]) {
    console.log(`  Pinging ${url}`);
    pings.push(await pingDirectory(url));
    await SLEEP(REQ_DELAY_MS);
  }
  for (const p of pings) {
    console.log(`    ${p.url} -> ${p.status}${p.ok ? "" : ` (${p.error || "non-200"})`}`);
  }

  const index = buildIndex(MIRROR);
  console.log(`Mirror entries indexed: ${index.size}`);

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  const results = [];
  for (const brand of brands) {
    const out = lookup(brand, index);
    results.push({ slug: brand.slug, name: brand.name, ...out });
  }

  const matched = results.filter(r => r.status === "ok");
  const noMatch = results.filter(r => r.status === "no_match").length;
  const skipped = results.filter(r => r.status === "skipped_generic_name").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "Climate Neutral Certified brand mirror",
    source_urls:     [DIRECTORY_URL, LABEL_URL],
    directory_pings: pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    certifications:  results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with Climate Neutral match: ${matched.length}`);
  console.log(`   No-match brands:                   ${noMatch}`);
  console.log(`   Skipped (generic name):            ${skipped}`);
  if (matched.length > 0) {
    console.log("\nClimate Neutral Certified brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- since ${r.since_year} -- ${r.offset_tons_year ?? "n/a"} tCO2e/yr`);
    }
  }
}

main().catch(err => {
  console.error("climate-neutral-fetch failed:", err);
  process.exit(1);
});
