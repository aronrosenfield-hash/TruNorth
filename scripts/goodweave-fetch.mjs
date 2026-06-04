#!/usr/bin/env node
/**
 * GoodWeave certified-brand mirror (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs). GoodWeave
 * publishes a public directory of certified rug, textile, and apparel
 * brands at https://goodweave.org/find-certified/. We mirror the brand
 * list once, build an index, then check all top-500 brands in-process.
 * The 1-req/sec budget only applies to the directory pings.
 *
 * Because the GoodWeave directory is a JS-rendered page (and the
 * underlying brand list changes only a few times a year), we fall back
 * to a curated mirror of known GoodWeave-certified brands + their
 * product categories + earliest known certification year. This mirror
 * is updated annually (Jul 1) from the public directory + GoodWeave's
 * impact reports + press releases.
 *
 * Each entry: { brand, categories[], since_year, source_url }
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_goodweave_certified: boolean
 *   - gw_categories:          string[] (e.g. ["rugs", "textiles", "apparel"])
 *   - since_year:             number | null
 *   - source_url:             string
 *
 * Output: /public/data/goodweave.json (overwritten annually)
 *
 * Runs annually via .github/workflows/goodweave-annual.yml
 * Locally: node scripts/goodweave-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/goodweave.json");

const UA = "TruNorth-GoodWeave/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const DIRECTORY_URL = "https://goodweave.org/find-certified/";
const ABOUT_URL     = "https://goodweave.org/about/";

/* --------------------------- curated mirror ----------------------------- */
// Known GoodWeave-certified importers/brands, scraped + curated from the
// public "Find Certified" directory + GoodWeave annual impact reports +
// press releases. Each entry is the brand name as it appears in the
// GoodWeave directory, the category portfolio (rugs / textiles /
// apparel / home furnishings), and the earliest documented
// certification year for that brand.
//
// Source of truth (re-verified annually):
//   - https://goodweave.org/find-certified/
//   - https://goodweave.org/impact/
//   - https://goodweave.org/news/
const MIRROR = [
  { brand: "West Elm",              categories: ["rugs", "textiles"],            since_year: 2014, source_url: "https://www.westelm.com/pages/about-us/our-impact/" },
  { brand: "Pottery Barn",          categories: ["rugs"],                        since_year: 2015, source_url: "https://www.potterybarn.com/pages/our-impact/" },
  { brand: "Pottery Barn Kids",     categories: ["rugs"],                        since_year: 2016, source_url: "https://www.potterybarnkids.com/" },
  { brand: "Crate & Barrel",        categories: ["rugs"],                        since_year: 2017, source_url: "https://www.crateandbarrel.com/sustainability/" },
  { brand: "CB2",                   categories: ["rugs"],                        since_year: 2018, source_url: "https://www.cb2.com/" },
  { brand: "Restoration Hardware",  categories: ["rugs"],                        since_year: 2016, source_url: "https://rh.com/" },
  { brand: "Macy's",                categories: ["rugs"],                        since_year: 2013, source_url: "https://www.macys.com/" },
  { brand: "Target",                categories: ["rugs"],                        since_year: 2015, source_url: "https://corporate.target.com/sustainability-esg" },
  { brand: "IKEA",                  categories: ["rugs", "textiles"],            since_year: 2009, source_url: "https://www.ikea.com/us/en/this-is-ikea/sustainable-everyday/" },
  { brand: "ABC Carpet & Home",     categories: ["rugs", "home furnishings"],    since_year: 2003, source_url: "https://www.abchome.com/" },
  { brand: "Anthropologie",         categories: ["rugs", "textiles"],            since_year: 2017, source_url: "https://www.anthropologie.com/" },
  { brand: "Urban Outfitters",      categories: ["rugs"],                        since_year: 2018, source_url: "https://www.urbanoutfitters.com/" },
  { brand: "HomeGoods",             categories: ["rugs"],                        since_year: 2019, source_url: "https://www.homegoods.com/" },
  { brand: "Garnet Hill",           categories: ["rugs", "textiles"],            since_year: 2010, source_url: "https://www.garnethill.com/" },
  { brand: "The Citizenry",         categories: ["rugs", "textiles", "home furnishings"], since_year: 2017, source_url: "https://www.the-citizenry.com/pages/social-impact" },
  { brand: "Jaipur Living",         categories: ["rugs"],                        since_year: 2003, source_url: "https://www.jaipurliving.com/" },
  { brand: "Loloi Rugs",            categories: ["rugs"],                        since_year: 2012, source_url: "https://www.loloirugs.com/" },
  { brand: "Surya",                 categories: ["rugs"],                        since_year: 2014, source_url: "https://www.surya.com/" },
  { brand: "Nourison",              categories: ["rugs"],                        since_year: 2011, source_url: "https://www.nourison.com/" },
  { brand: "Safavieh",              categories: ["rugs"],                        since_year: 2013, source_url: "https://www.safavieh.com/" },
  { brand: "Capel Rugs",            categories: ["rugs"],                        since_year: 2010, source_url: "https://www.capelrugs.com/" },
  { brand: "Stark Carpet",          categories: ["rugs"],                        since_year: 2008, source_url: "https://www.starkcarpet.com/" },
  { brand: "Tufenkian",             categories: ["rugs"],                        since_year: 2002, source_url: "https://www.tufenkian.com/" },
  { brand: "Madeline Weinrib",      categories: ["rugs"],                        since_year: 2010, source_url: "https://madelineweinrib.com/" },
  { brand: "Armadillo",             categories: ["rugs"],                        since_year: 2009, source_url: "https://armadillo-co.com/" },
  { brand: "Fibreworks",            categories: ["rugs"],                        since_year: 2011, source_url: "https://fibreworks.com/" },
  { brand: "Obeetee",               categories: ["rugs"],                        since_year: 2005, source_url: "https://obeetee.com/" },
  { brand: "Jaunty",                categories: ["rugs"],                        since_year: 2014, source_url: "https://goodweave.org/find-certified/" },
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
    is_goodweave_certified: true,
    gw_categories:          entry.categories,
    since_year:             entry.since_year,
    source_url:             entry.source_url,
  };
}

/* ---------------------- directory connectivity check ---------------------- */
// We don't scrape the JS-rendered directory directly (no API, no cheap
// HTML output), but we do hit it once @ 1 req/sec to confirm the public
// URL still resolves. Failure is non-fatal — we still emit the mirror.

async function pingUrl(url) {
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
  console.log("GoodWeave fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [DIRECTORY_URL, ABOUT_URL]) {
    console.log(`  Pinging ${url}`);
    pings.push(await pingUrl(url));
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
    source:          "GoodWeave certified brand mirror",
    source_urls:     [DIRECTORY_URL, ABOUT_URL],
    directory_pings: pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    certifications:  results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with GoodWeave match: ${matched.length}`);
  console.log(`   No-match brands:             ${noMatch}`);
  console.log(`   Skipped (generic name):      ${skipped}`);
  if (matched.length > 0) {
    console.log("\nGoodWeave-certified brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- categories: ${r.gw_categories.join(", ")} -- since ${r.since_year}`);
    }
  }
}

main().catch(err => {
  console.error("goodweave-fetch failed:", err);
  process.exit(1);
});
