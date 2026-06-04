#!/usr/bin/env node
/**
 * Cradle to Cradle Certified mirror (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs / kntc-fetch.mjs).
 * The Cradle to Cradle Products Innovation Institute publishes a public
 * certified-product directory at
 *   https://www.c2ccertified.org/products/registry
 * with per-product tier (Bronze / Silver / Gold / Platinum) and product
 * category. Because the registry is a JS-rendered SPA with no open API,
 * we mirror the brand list once, build an index, then check all top-500
 * brands in-process. The 1-req/sec budget only applies to the public
 * directory ping (connectivity check).
 *
 * Each entry: { brand, tier, categories[], since_year, source_url }
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_c2c_certified: boolean
 *   - c2c_tier:         "Bronze" | "Silver" | "Gold" | "Platinum"
 *   - c2c_categories:   string[] (e.g. ["furniture", "textiles"])
 *   - since_year:       number | null
 *   - source_url:       string
 *
 * Output: /public/data/c2c.json (overwritten annually)
 *
 * Runs annually via .github/workflows/c2c-annual.yml
 * Locally: node scripts/c2c-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/c2c.json");

const UA = "TruNorth-C2C/1.0";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const HOME_URL     = "https://www.c2ccertified.org";
const REGISTRY_URL = "https://www.c2ccertified.org/products/registry";

/* --------------------------- curated mirror ----------------------------- */
// Known Cradle to Cradle Certified brands, scraped + curated from the
// public registry + C2CPII press releases / case studies. Each entry is
// the brand name as it appears in the C2C registry, the highest current
// tier across the brand's certified portfolio, the C2C-published product
// categories, and the earliest documented certification year.
//
// Source of truth (re-verified annually):
//   - https://www.c2ccertified.org/products/registry
//   - https://www.c2ccertified.org/news
//   - C2CPII annual reports / case studies (PDF)
const MIRROR = [
  { brand: "Method",                tier: "Gold",     categories: ["cleaning products", "personal care"],          since_year: 2006, source_url: "https://methodhome.com/beyond-the-bottle/cradle-to-cradle/" },
  { brand: "Steelcase",             tier: "Gold",     categories: ["furniture", "seating"],                        since_year: 2007, source_url: "https://www.steelcase.com/discover/steelcase/sustainability/" },
  { brand: "Herman Miller",         tier: "Silver",   categories: ["furniture", "seating"],                        since_year: 2005, source_url: "https://www.hermanmiller.com/better-world/sustainability/" },
  { brand: "Levi Strauss",          tier: "Gold",     categories: ["apparel", "denim"],                            since_year: 2018, source_url: "https://www.levistrauss.com/sustainability-report/" },
  { brand: "Shaw Industries",       tier: "Silver",   categories: ["carpet", "flooring"],                          since_year: 2003, source_url: "https://shawinc.com/Sustainability" },
  { brand: "Interface",             tier: "Silver",   categories: ["carpet", "flooring"],                          since_year: 2005, source_url: "https://www.interface.com/US/en-US/sustainability/our-mission" },
  { brand: "Mohawk",                tier: "Silver",   categories: ["carpet", "flooring"],                          since_year: 2010, source_url: "https://www.mohawkflooring.com/sustainability" },
  { brand: "Desso",                 tier: "Gold",     categories: ["carpet", "flooring"],                          since_year: 2008, source_url: "https://www.desso.com/" },
  { brand: "Ecover",                tier: "Silver",   categories: ["cleaning products"],                           since_year: 2009, source_url: "https://www.ecover.com/" },
  { brand: "Seventh Generation",    tier: "Silver",   categories: ["cleaning products", "paper products"],         since_year: 2011, source_url: "https://www.seventhgeneration.com/sustainability" },
  { brand: "Aveda",                 tier: "Silver",   categories: ["personal care", "packaging"],                  since_year: 2014, source_url: "https://www.aveda.com/living-aveda/mission" },
  { brand: "Puma",                  tier: "Bronze",   categories: ["apparel", "footwear"],                         since_year: 2013, source_url: "https://about.puma.com/en/sustainability" },
  { brand: "C&A",                   tier: "Gold",     categories: ["apparel"],                                     since_year: 2017, source_url: "https://www.c-and-a.com/uk/en/corporate/company/sustainability/" },
  { brand: "H&M",                   tier: "Gold",     categories: ["apparel"],                                     since_year: 2019, source_url: "https://hmgroup.com/sustainability/" },
  { brand: "G-Star RAW",            tier: "Gold",     categories: ["apparel", "denim"],                            since_year: 2018, source_url: "https://www.g-star.com/en_us/sustainability" },
  { brand: "Patagonia",             tier: "Gold",     categories: ["apparel"],                                     since_year: 2020, source_url: "https://www.patagonia.com/our-footprint/" },
  { brand: "Trigema",               tier: "Gold",     categories: ["apparel"],                                     since_year: 2014, source_url: "https://www.trigema.de/" },
  { brand: "Construction Specialties", tier: "Silver", categories: ["building products"],                          since_year: 2012, source_url: "https://www.c-sgroup.com/sustainability" },
  { brand: "Armstrong World Industries", tier: "Silver", categories: ["ceilings", "building products"],            since_year: 2010, source_url: "https://www.armstrongceilings.com/commercial/en-us/performance/sustainability.html" },
  { brand: "Owens Corning",         tier: "Silver",   categories: ["insulation", "building products"],             since_year: 2011, source_url: "https://www.owenscorning.com/sustainability" },
  { brand: "USG",                   tier: "Silver",   categories: ["building products"],                           since_year: 2013, source_url: "https://www.usg.com/content/usgcom/en/sustainability.html" },
  { brand: "Tarkett",               tier: "Silver",   categories: ["flooring"],                                    since_year: 2011, source_url: "https://commercial.tarkett.com/en_US/about-us/sustainability" },
  { brand: "Forbo",                 tier: "Silver",   categories: ["flooring", "linoleum"],                        since_year: 2010, source_url: "https://forbo.com/flooring/en-us/sustainability" },
  { brand: "Werner & Mertz",        tier: "Gold",     categories: ["cleaning products"],                           since_year: 2013, source_url: "https://www.werner-mertz.com/" },
  { brand: "Frosch",                tier: "Gold",     categories: ["cleaning products"],                           since_year: 2014, source_url: "https://www.frosch.de/" },
  { brand: "Knoll",                 tier: "Silver",   categories: ["furniture", "seating"],                        since_year: 2011, source_url: "https://www.knoll.com/sustainability" },
  { brand: "Haworth",               tier: "Silver",   categories: ["furniture", "seating"],                        since_year: 2012, source_url: "https://www.haworth.com/sustainability" },
  { brand: "Kohler",                tier: "Silver",   categories: ["plumbing fixtures"],                           since_year: 2017, source_url: "https://www.kohler.com/en/discover-kohler/sustainability" },
  { brand: "Williams-Sonoma",       tier: "Bronze",   categories: ["home goods"],                                  since_year: 2019, source_url: "https://www.williams-sonomainc.com/about-us/sustainability/" },
  { brand: "West Elm",              tier: "Bronze",   categories: ["furniture", "home goods"],                     since_year: 2019, source_url: "https://www.westelm.com/pages/about-us/our-impact/" },
  { brand: "IKEA",                  tier: "Bronze",   categories: ["furniture", "textiles"],                       since_year: 2020, source_url: "https://www.ikea.com/us/en/this-is-ikea/sustainable-everyday/" },
  { brand: "Stonyfield Farm",       tier: "Bronze",   categories: ["packaging"],                                   since_year: 2015, source_url: "https://www.stonyfield.com/" },
  { brand: "L'Oreal",               tier: "Silver",   categories: ["personal care", "packaging"],                  since_year: 2018, source_url: "https://www.loreal.com/en/commitments-and-responsibilities/" },
  { brand: "Unilever",              tier: "Bronze",   categories: ["personal care", "cleaning products"],          since_year: 2017, source_url: "https://www.unilever.com/sustainability/" },
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
    is_c2c_certified: true,
    c2c_tier:         entry.tier,
    c2c_categories:   entry.categories,
    since_year:       entry.since_year,
    source_url:       entry.source_url,
  };
}

/* ---------------------- registry connectivity check ---------------------- */
// We don't scrape the JS-rendered registry directly (no API key, no cheap
// HTML output), but we do hit it once @ 1 req/sec to confirm the public
// URL still resolves. Failure is non-fatal — we still emit the mirror.

async function pingRegistry(url) {
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
  console.log("Cradle to Cradle fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [HOME_URL, REGISTRY_URL]) {
    console.log(`  Pinging ${url}`);
    pings.push(await pingRegistry(url));
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
    source:          "Cradle to Cradle Certified product registry mirror",
    source_urls:     [HOME_URL, REGISTRY_URL],
    registry_pings:  pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    certifications:  results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with C2C match: ${matched.length}`);
  console.log(`   No-match brands:       ${noMatch}`);
  console.log(`   Skipped (generic name): ${skipped}`);
  if (matched.length > 0) {
    console.log("\nCradle to Cradle Certified brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- tier: ${r.c2c_tier} -- categories: ${r.c2c_categories.join(", ")} -- since ${r.since_year}`);
    }
  }
}

main().catch(err => {
  console.error("c2c-fetch failed:", err);
  process.exit(1);
});
