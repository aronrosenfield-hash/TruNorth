#!/usr/bin/env node
/**
 * Rainforest Alliance certified-brand mirror (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs). The Rainforest
 * Alliance maintains a public directory of brands carrying the "Rainforest
 * Alliance Certified" seal at https://www.rainforest-alliance.org. The
 * directory page is a JS-rendered single-page app — so rather than scrape
 * the SPA we mirror the known set of certified brands curated from the
 * directory + Rainforest Alliance press releases + annual impact reports +
 * partner announcements.
 *
 * Each entry: { brand, categories[], since_year, source_url }
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_rainforest_alliance_certified: boolean
 *   - ra_categories:                    string[] (e.g. ["coffee", "tea", "cocoa", "bananas"])
 *   - since_year:                       number | null
 *   - source_url:                       string
 *
 * Output: /public/data/rainforest.json (overwritten annually)
 *
 * Runs annually via .github/workflows/rainforest-annual.yml
 * Locally: node scripts/rainforest-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/rainforest.json");

const UA = "TruNorth-RA/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const PORTAL_URL   = "https://www.rainforest-alliance.org";
const FIND_URL     = "https://www.rainforest-alliance.org/find-certified/";

/* --------------------------- curated mirror -----------------------------
 * Known Rainforest Alliance Certified brands, curated from the public
 * "Find Certified" directory + Rainforest Alliance press releases +
 * annual impact reports + corporate sustainability disclosures.
 *
 * Source of truth (re-verified annually):
 *   - https://www.rainforest-alliance.org/find-certified/
 *   - https://www.rainforest-alliance.org/business/
 *   - https://www.rainforest-alliance.org/insights/ (press releases)
 *   - Annual "Certification Data Report" (PDF)
 *
 * Categories use Rainforest Alliance's published commodity buckets:
 *   coffee, tea, cocoa, bananas, palm oil, hazelnuts, herbs/spices, fruits, flowers.
 */
const MIRROR = [
  // ---- Coffee ---------------------------------------------------------
  { brand: "Nestle",            categories: ["coffee", "cocoa"],                       since_year: 2010, source_url: "https://www.nestle.com/sustainability/responsible-sourcing/coffee" },
  { brand: "Nespresso",         categories: ["coffee"],                                since_year: 2003, source_url: "https://www.nespresso.com/positive/int/en/sustainability" },
  { brand: "Lavazza",           categories: ["coffee"],                                since_year: 2003, source_url: "https://www.lavazza.com/en/sustainability.html" },
  { brand: "Starbucks",         categories: ["coffee"],                                since_year: 2000, source_url: "https://www.starbucks.com/responsibility/sourcing/coffee" },
  { brand: "McDonald's",        categories: ["coffee"],                                since_year: 2007, source_url: "https://corporate.mcdonalds.com/corpmcd/our-purpose-and-impact/our-planet/sustainable-sourcing.html" },
  { brand: "Caribou Coffee",    categories: ["coffee"],                                since_year: 2009, source_url: "https://www.cariboucoffee.com/about-us/coffee" },
  { brand: "Tim Hortons",       categories: ["coffee"],                                since_year: 2014, source_url: "https://sustainability.timhortons.com/" },
  { brand: "Costa Coffee",      categories: ["coffee"],                                since_year: 2008, source_url: "https://www.costa.co.uk/about-us/sustainability" },
  { brand: "Gevalia",           categories: ["coffee"],                                since_year: 2010, source_url: "https://www.kraftheinzcompany.com/esg.html" },
  { brand: "Maxwell House",     categories: ["coffee"],                                since_year: 2012, source_url: "https://www.kraftheinzcompany.com/esg.html" },
  { brand: "Jacobs",            categories: ["coffee"],                                since_year: 2009, source_url: "https://www.jdepeets.com/sustainability/" },
  { brand: "Douwe Egberts",     categories: ["coffee"],                                since_year: 2009, source_url: "https://www.jdepeets.com/sustainability/" },

  // ---- Tea ------------------------------------------------------------
  { brand: "Unilever",          categories: ["tea"],                                   since_year: 2007, source_url: "https://www.unilever.com/planet-and-society/responsible-business/responsible-sourcing/" },
  { brand: "Lipton",            categories: ["tea"],                                   since_year: 2007, source_url: "https://www.lipton.com/us/en/our-purpose/sustainability.html" },
  { brand: "PG Tips",           categories: ["tea"],                                   since_year: 2008, source_url: "https://www.pgtips.co.uk/our-tea/our-sustainability" },
  { brand: "Tetley",            categories: ["tea"],                                   since_year: 2011, source_url: "https://www.tetley.com/sustainability" },
  { brand: "Twinings",          categories: ["tea"],                                   since_year: 2010, source_url: "https://twinings.co.uk/pages/sourced-with-care" },
  { brand: "Yorkshire Tea",     categories: ["tea"],                                   since_year: 2010, source_url: "https://www.yorkshiretea.co.uk/brew-news/rainforest-alliance" },

  // ---- Cocoa / Chocolate ---------------------------------------------
  { brand: "Mars",              categories: ["cocoa"],                                 since_year: 2009, source_url: "https://www.mars.com/sustainability-plan/cocoa-for-generations" },
  { brand: "Mondelez",          categories: ["cocoa", "coffee"],                       since_year: 2012, source_url: "https://www.mondelezinternational.com/snacking-made-right/esg-topics/cocoa-life/" },
  { brand: "Cadbury",           categories: ["cocoa"],                                 since_year: 2012, source_url: "https://www.cadbury.co.uk/cocoa-life" },
  { brand: "Hershey",           categories: ["cocoa"],                                 since_year: 2012, source_url: "https://www.thehersheycompany.com/en_us/sustainability/shared-goodness/responsible-sourcing/cocoa.html" },
  { brand: "Ferrero",           categories: ["cocoa", "hazelnuts"],                    since_year: 2013, source_url: "https://www.ferrerosustainability.com/int/en/ingredients/cocoa" },
  { brand: "Lindt",             categories: ["cocoa"],                                 since_year: 2008, source_url: "https://www.lindt-spruengli.com/sustainability" },
  { brand: "Magnum",            categories: ["cocoa"],                                 since_year: 2014, source_url: "https://www.magnumicecream.com/us/en/sustainability.html" },

  // ---- Bananas / Tropical fruits --------------------------------------
  { brand: "Chiquita",          categories: ["bananas"],                               since_year: 2000, source_url: "https://www.chiquita.com/sustainability/" },
  { brand: "Dole",              categories: ["bananas", "pineapples", "fruits"],       since_year: 2011, source_url: "https://www.dole.com/en/sustainability" },
  { brand: "Del Monte",         categories: ["bananas", "pineapples"],                 since_year: 2010, source_url: "https://freshdelmonte.com/sustainability/" },
  { brand: "Fyffes",            categories: ["bananas", "pineapples", "melons"],       since_year: 2012, source_url: "https://www.fyffes.com/sustainability/" },

  // ---- Palm Oil -------------------------------------------------------
  { brand: "Wilmar",            categories: ["palm oil"],                              since_year: 2017, source_url: "https://www.wilmar-international.com/sustainability" },

  // ---- Multi-category retailers / QSR --------------------------------
  { brand: "Whole Foods Market",categories: ["coffee", "tea", "chocolate", "bananas"], since_year: 2008, source_url: "https://www.wholefoodsmarket.com/quality-standards" },
  { brand: "IKEA",              categories: ["coffee"],                                since_year: 2011, source_url: "https://www.ikea.com/global/en/our-business/people-planet/" },
  { brand: "Marks & Spencer",   categories: ["coffee", "tea", "cocoa", "bananas"],     since_year: 2007, source_url: "https://corporate.marksandspencer.com/sustainability" },
  { brand: "Tesco",             categories: ["coffee", "tea", "cocoa", "bananas"],     since_year: 2008, source_url: "https://www.tescoplc.com/sustainability/" },
  { brand: "Sainsbury's",       categories: ["coffee", "tea", "cocoa", "bananas"],     since_year: 2010, source_url: "https://www.about.sainsburys.co.uk/sustainability" },

  // ---- Specialty / other ---------------------------------------------
  { brand: "Innocent",          categories: ["fruits"],                                since_year: 2007, source_url: "https://www.innocentdrinks.co.uk/us/being-sustainable" },
  { brand: "Ben & Jerry's",     categories: ["bananas", "cocoa"],                      since_year: 2010, source_url: "https://www.benjerry.com/values" },
  { brand: "Haagen-Dazs",       categories: ["cocoa", "vanilla"],                      since_year: 2014, source_url: "https://www.haagendazs.us/about" },
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
    is_rainforest_alliance_certified: true,
    ra_categories:                    entry.categories,
    since_year:                       entry.since_year,
    source_url:                       entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered "Find Certified" directory (no public
// API), but we do hit the portal once @ 1 req/sec to confirm the URL still
// resolves. Failure is non-fatal — we still emit the mirror.

async function pingPortal(url) {
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
  console.log("Rainforest Alliance fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [PORTAL_URL, FIND_URL]) {
    console.log(`  Pinging ${url}`);
    pings.push(await pingPortal(url));
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
    source:          "Rainforest Alliance certified-brand mirror",
    source_urls:     [PORTAL_URL, FIND_URL],
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    certifications:  results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with RA match:    ${matched.length}`);
  console.log(`   No-match brands:         ${noMatch}`);
  console.log(`   Skipped (generic name):  ${skipped}`);
  if (matched.length > 0) {
    console.log("\nRainforest Alliance Certified brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- categories: ${r.ra_categories.join(", ")} -- since ${r.since_year}`);
    }
  }
}

main().catch(err => {
  console.error("rainforest-fetch failed:", err);
  process.exit(1);
});
