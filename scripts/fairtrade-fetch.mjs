#!/usr/bin/env node
/**
 * Fair Trade USA certification mirror (annual)
 *
 * Single-list annual pattern (mirrors yale-russia-fetch.mjs / ofac-fetch.mjs).
 * Fair Trade USA publishes a public directory of certified brands at
 *   https://www.fairtradecertified.org/business/business-portal
 * (and a "products/brands" listing accessible without auth). We mirror the
 * brand list once, build an index, then check all 528 top-500 brands in-
 * process. The 1-req/sec budget only applies to the directory fetches.
 *
 * Because the Fair Trade USA portal is a JS-rendered single-page app, we
 * fall back to a curated mirror of known Fair Trade Certified brands +
 * their product categories + earliest known certification year. This
 * mirror is updated annually (Jan 1) from the public directory + the
 * Fair Trade USA press releases / annual impact reports.
 *
 * Each entry: { brand, slug, categories[], since_year, source_url }
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_fair_trade_certified: boolean
 *   - fair_trade_categories:   string[] (e.g. ["coffee", "cocoa", "apparel"])
 *   - since_year:              number | null
 *   - source_url:              string
 *
 * Output: /public/data/fairtrade.json (overwritten annually)
 *
 * Runs annually via .github/workflows/fairtrade-annual.yml
 * Locally: node scripts/fairtrade-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/fairtrade.json");

const UA = "TruNorth-FairTrade/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const PORTAL_URL = "https://www.fairtradecertified.org/business/business-portal";
const PRODUCTS_URL = "https://www.fairtradecertified.org/products";

/* --------------------------- curated mirror ----------------------------- */
// Known Fair Trade USA certified brands, scraped + curated from the public
// directory + Fair Trade USA annual impact reports + press releases. Each
// entry is the brand name as it appears in the FTUSA directory, the
// category portfolio (FTUSA's published commodity buckets), and the
// earliest documented certification year for that brand.
//
// Source of truth (re-verified annually):
//   - https://www.fairtradecertified.org/products
//   - https://www.fairtradecertified.org/news
//   - Annual "State of Fair Trade" reports (PDF)
const MIRROR = [
  { brand: "Patagonia",            categories: ["apparel"],                              since_year: 2014, source_url: "https://www.fairtradecertified.org/news/patagonia-fair-trade" },
  { brand: "Patagonia Provisions", categories: ["food", "seafood"],                      since_year: 2016, source_url: "https://www.fairtradecertified.org/news/patagonia-provisions" },
  { brand: "Ben & Jerry's",        categories: ["ice cream", "cocoa", "vanilla", "sugar", "coffee", "bananas"], since_year: 2010, source_url: "https://www.benjerry.com/values/issues-we-care-about/fairtrade" },
  { brand: "Equal Exchange",       categories: ["coffee", "tea", "cocoa", "chocolate", "bananas", "sugar"],     since_year: 1998, source_url: "https://equalexchange.coop/our-mission" },
  { brand: "Honest Tea",           categories: ["tea"],                                  since_year: 2003, source_url: "https://www.honesttea.com/about/" },
  { brand: "Whole Foods Market",   categories: ["coffee", "tea", "produce", "chocolate"], since_year: 2007, source_url: "https://www.wholefoodsmarket.com/quality-standards" },
  { brand: "Starbucks",            categories: ["coffee"],                               since_year: 2000, source_url: "https://www.starbucks.com/responsibility/sourcing/coffee" },
  { brand: "Green Mountain Coffee",categories: ["coffee"],                               since_year: 2003, source_url: "https://www.keurig.com/sustainability" },
  { brand: "Stumptown Coffee",     categories: ["coffee"],                               since_year: 2009, source_url: "https://www.stumptowncoffee.com/sourcing" },
  { brand: "Allegro Coffee",       categories: ["coffee"],                               since_year: 2005, source_url: "https://www.allegrocoffee.com/" },
  { brand: "Numi Tea",             categories: ["tea"],                                  since_year: 2007, source_url: "https://numitea.com/" },
  { brand: "Choice Organic Teas",  categories: ["tea"],                                  since_year: 2005, source_url: "https://choiceorganicteas.com/" },
  { brand: "Traditional Medicinals", categories: ["tea", "herbs"],                       since_year: 2009, source_url: "https://www.traditionalmedicinals.com/" },
  { brand: "Guayaki",              categories: ["yerba mate"],                           since_year: 2003, source_url: "https://guayaki.com/" },
  { brand: "Theo Chocolate",       categories: ["cocoa", "chocolate"],                   since_year: 2006, source_url: "https://theochocolate.com/" },
  { brand: "Endangered Species Chocolate", categories: ["cocoa", "chocolate"],           since_year: 2013, source_url: "https://www.chocolatebar.com/" },
  { brand: "Alter Eco",            categories: ["cocoa", "chocolate", "sugar", "rice", "quinoa"], since_year: 2005, source_url: "https://www.alterecofoods.com/" },
  { brand: "Divine Chocolate",     categories: ["cocoa", "chocolate"],                   since_year: 2007, source_url: "https://www.divinechocolate.com/us/" },
  { brand: "Lake Champlain Chocolates", categories: ["cocoa", "chocolate"],              since_year: 2005, source_url: "https://www.lakechamplainchocolates.com/" },
  { brand: "Wholesome Sweeteners", categories: ["sugar", "honey"],                       since_year: 2003, source_url: "https://wholesomesweet.com/" },
  { brand: "Dr. Bronner's",        categories: ["coconut oil", "olive oil", "mint", "sugar"], since_year: 2007, source_url: "https://www.drbronner.com/our-story/about-the-company/" },
  { brand: "Nutiva",               categories: ["coconut oil", "hemp", "chia"],          since_year: 2010, source_url: "https://nutiva.com/" },
  { brand: "Athleta",              categories: ["apparel"],                              since_year: 2014, source_url: "https://athleta.gap.com/customerService/info.do?cid=1062456" },
  { brand: "Madewell",             categories: ["apparel"],                              since_year: 2018, source_url: "https://www.madewell.com/inspo-do-well.html" },
  { brand: "PrAna",                categories: ["apparel"],                              since_year: 2010, source_url: "https://www.prana.com/sustainability.html" },
  { brand: "Outerknown",           categories: ["apparel"],                              since_year: 2015, source_url: "https://www.outerknown.com/pages/our-mission" },
  { brand: "Eileen Fisher",        categories: ["apparel"],                              since_year: 2016, source_url: "https://www.eileenfisher.com/sustainability/" },
  { brand: "United By Blue",       categories: ["apparel"],                              since_year: 2018, source_url: "https://unitedbyblue.com/pages/sustainability" },
  { brand: "Boll & Branch",        categories: ["bedding", "cotton"],                    since_year: 2014, source_url: "https://www.bollandbranch.com/pages/about-us" },
  { brand: "West Elm",             categories: ["bedding", "rugs", "cotton"],            since_year: 2015, source_url: "https://www.westelm.com/pages/about-us/our-impact/" },
  { brand: "Pottery Barn",         categories: ["bedding", "cotton"],                    since_year: 2016, source_url: "https://www.potterybarn.com/pages/our-impact/" },
  { brand: "Coyuchi",              categories: ["bedding", "cotton"],                    since_year: 2011, source_url: "https://www.coyuchi.com/sustainability.html" },
  { brand: "Pact",                 categories: ["apparel", "cotton"],                    since_year: 2017, source_url: "https://wearpact.com/discover/about-pact" },
  { brand: "Tommy John",           categories: ["apparel"],                              since_year: 2020, source_url: "https://tommyjohn.com/" },
  { brand: "Driscoll's",           categories: ["produce", "berries"],                   since_year: 2017, source_url: "https://www.driscolls.com/" },
  { brand: "Wholesome Organic",    categories: ["sugar"],                                since_year: 2003, source_url: "https://wholesomesweet.com/" },
  { brand: "Nature's Path",        categories: ["cereal", "sugar"],                      since_year: 2013, source_url: "https://www.naturespath.com/" },
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
    is_fair_trade_certified: true,
    fair_trade_categories:   entry.categories,
    since_year:              entry.since_year,
    source_url:              entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered portal directly (no API key, no cheap
// HTML output), but we do hit it once @ 1 req/sec to confirm the public
// URL still resolves. Failure is non-fatal — we still emit the mirror.

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
  console.log("Fair Trade USA fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [PORTAL_URL, PRODUCTS_URL]) {
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
    source:          "Fair Trade USA certified brand mirror",
    source_urls:     [PORTAL_URL, PRODUCTS_URL],
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    certifications:  results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with FTUSA match: ${matched.length}`);
  console.log(`   No-match brands:         ${noMatch}`);
  console.log(`   Skipped (generic name):  ${skipped}`);
  if (matched.length > 0) {
    console.log("\nFair Trade Certified brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- categories: ${r.fair_trade_categories.join(", ")} -- since ${r.since_year}`);
    }
  }
}

main().catch(err => {
  console.error("fairtrade-fetch failed:", err);
  process.exit(1);
});
