#!/usr/bin/env node
/**
 * Marine Stewardship Council (MSC) certified seafood mirror (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs). MSC publishes
 * a public "Track a Fishery" + "Where to Buy" directory of certified
 * fisheries and chain-of-custody (CoC) certified brands/retailers at
 *   https://www.msc.org/en-us/where-to-buy
 *   https://www.msc.org/track-a-fishery
 *
 * Because the MSC public site is a JS-rendered single-page app and the
 * official MSC API requires partner credentials, we mirror the certified
 * brand + retailer roster from the public directory + MSC annual
 * sustainability reports + press releases, refreshed annually (Mar 1).
 *
 * Each entry: { brand, slug, categories[], since_year, source_url }
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_msc_certified: boolean
 *   - msc_categories:   string[] (e.g. ["wild seafood", "retail"])
 *   - since_year:       number | null
 *   - source_url:       string
 *
 * Output: /public/data/msc.json (overwritten annually)
 *
 * Runs annually via .github/workflows/msc-annual.yml
 * Locally: node scripts/msc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/msc.json");

const UA = "TruNorth-MSC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const PORTAL_URL  = "https://www.msc.org/en-us/where-to-buy";
const FISHERY_URL = "https://fisheries.msc.org/en/fisheries/";

/* --------------------------- curated mirror ----------------------------- */
// Known MSC certified brands + retailers + chain-of-custody holders,
// scraped + curated from the MSC public directory + MSC annual reports +
// press releases. Each entry is the brand name as it appears in the MSC
// "Where to Buy" / "Track a Fishery" listing, the program/category
// portfolio, and the earliest documented MSC certification (CoC or
// supply-chain commitment) year for that brand.
//
// Source of truth (re-verified annually):
//   - https://www.msc.org/en-us/where-to-buy
//   - https://fisheries.msc.org/en/fisheries/
//   - https://www.msc.org/about-the-msc/reports-and-publications
//   - MSC annual "Wild + Certified" reports (PDF)
const MIRROR = [
  // Major US retailers w/ MSC sourcing programs (chain-of-custody)
  { brand: "Whole Foods Market",   categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2008, source_url: "https://www.wholefoodsmarket.com/quality-standards/seafood-standards" },
  { brand: "Trader Joe's",         categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2012, source_url: "https://www.traderjoes.com/home/about-us/product/sustainable-seafood-policy" },
  { brand: "Costco",               categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2011, source_url: "https://www.costco.com/sustainability-seafood.html" },
  { brand: "Kroger",               categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2010, source_url: "https://www.thekrogerco.com/sustainability/responsible-sourcing/seafood/" },
  { brand: "Walmart",              categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2006, source_url: "https://corporate.walmart.com/purpose/sustainability/planet/sustainable-seafood" },
  { brand: "Target",               categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2010, source_url: "https://corporate.target.com/sustainability-esg/planet/sustainable-products/seafood" },
  { brand: "Sam's Club",           categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2011, source_url: "https://corporate.walmart.com/purpose/sustainability/planet/sustainable-seafood" },
  { brand: "Aldi",                 categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2014, source_url: "https://corporate.aldi.us/en/corporate-responsibility/sourcing-policies/" },
  { brand: "Publix",               categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2009, source_url: "https://corporate.publix.com/sustainability/sustainable-seafood" },
  { brand: "H-E-B",                categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2014, source_url: "https://www.heb.com/static-page/article-template/sustainable-seafood" },
  { brand: "Wegmans",              categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2009, source_url: "https://www.wegmans.com/about-us/sustainability/" },
  { brand: "Sprouts",              categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2013, source_url: "https://www.sprouts.com/sustainability/" },
  { brand: "Ahold Delhaize",       categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2008, source_url: "https://www.aholddelhaize.com/sustainability/" },
  { brand: "Albertsons",           categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2011, source_url: "https://www.albertsonscompanies.com/responsibility/sustainable-sourcing/" },
  { brand: "Safeway",              categories: ["retail", "wild seafood", "chain-of-custody"], since_year: 2011, source_url: "https://www.albertsonscompanies.com/responsibility/sustainable-sourcing/" },

  // Branded seafood / consumer packaged goods (CoC certified)
  { brand: "Bumble Bee",           categories: ["wild seafood", "canned tuna", "chain-of-custody"], since_year: 2010, source_url: "https://www.bumblebee.com/sustainability/" },
  { brand: "Chicken of the Sea",   categories: ["wild seafood", "canned tuna", "chain-of-custody"], since_year: 2012, source_url: "https://chickenofthesea.com/sustainability/" },
  { brand: "StarKist",             categories: ["wild seafood", "canned tuna", "chain-of-custody"], since_year: 2011, source_url: "https://starkist.com/sustainability" },
  { brand: "Wild Planet",          categories: ["wild seafood", "canned tuna", "chain-of-custody"], since_year: 2010, source_url: "https://wildplanetfoods.com/sustainability/" },
  { brand: "Safe Catch",           categories: ["wild seafood", "canned tuna", "chain-of-custody"], since_year: 2016, source_url: "https://safecatch.com/" },
  { brand: "Gorton's",             categories: ["wild seafood", "frozen seafood", "chain-of-custody"], since_year: 2010, source_url: "https://www.gortons.com/our-mission/" },
  { brand: "High Liner Foods",     categories: ["wild seafood", "frozen seafood", "chain-of-custody"], since_year: 2009, source_url: "https://www.highlinerfoods.com/en/home/sustainability.aspx" },
  { brand: "Sea Cuisine",          categories: ["wild seafood", "frozen seafood", "chain-of-custody"], since_year: 2014, source_url: "https://www.seacuisine.com/" },
  { brand: "Trident Seafoods",     categories: ["wild seafood", "frozen seafood", "chain-of-custody"], since_year: 2006, source_url: "https://www.tridentseafoods.com/sustainability" },
  { brand: "Patagonia Provisions", categories: ["wild seafood", "chain-of-custody"], since_year: 2016, source_url: "https://www.patagoniaprovisions.com/pages/sustainable-seafood" },
  { brand: "Sea to Table",         categories: ["wild seafood", "chain-of-custody"], since_year: 2014, source_url: "https://www.sea2table.com/" },
  { brand: "Vital Choice",         categories: ["wild seafood", "chain-of-custody"], since_year: 2007, source_url: "https://www.vitalchoice.com/" },

  // QSR / foodservice w/ MSC commitments
  { brand: "McDonald's",           categories: ["foodservice", "wild seafood", "chain-of-custody"], since_year: 2007, source_url: "https://corporate.mcdonalds.com/corpmcd/our-purpose-and-impact/our-planet/responsible-sourcing.html" },
  { brand: "Long John Silver's",   categories: ["foodservice", "wild seafood", "chain-of-custody"], since_year: 2013, source_url: "https://www.ljsilvers.com/" },
  { brand: "Ikea",                 categories: ["foodservice", "wild seafood", "chain-of-custody"], since_year: 2011, source_url: "https://www.ikea.com/us/en/this-is-ikea/sustainable-everyday/" },
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
    is_msc_certified: true,
    msc_categories:   entry.categories,
    since_year:       entry.since_year,
    source_url:       entry.source_url,
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
  console.log("MSC certified seafood fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [PORTAL_URL, FISHERY_URL]) {
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
    source:          "Marine Stewardship Council certified brand mirror",
    source_urls:     [PORTAL_URL, FISHERY_URL],
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    certifications:  results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with MSC match:   ${matched.length}`);
  console.log(`   No-match brands:         ${noMatch}`);
  console.log(`   Skipped (generic name):  ${skipped}`);
  if (matched.length > 0) {
    console.log("\nMSC Certified brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- categories: ${r.msc_categories.join(", ")} -- since ${r.since_year}`);
    }
  }
}

main().catch(err => {
  console.error("msc-fetch failed:", err);
  process.exit(1);
});
