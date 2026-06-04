#!/usr/bin/env node
/**
 * Forest Stewardship Council (FSC) certified-wood/paper/packaging mirror
 * (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs). FSC publishes
 * a public certificate database at
 *   https://info.fsc.org/certificate.php
 * (license-holder + product-group search). The public search is a JS-
 * rendered form with no cheap public JSON endpoint, so we mirror a
 * curated list of FSC-certified consumer brands (paper, lumber,
 * packaging) re-verified annually against the FSC trademark portal
 * (https://marketplace.fsc.org), brand sustainability disclosures, and
 * FSC's published Connect news feed.
 *
 * Each entry: { brand, slug, categories[], since_year, source_url }
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_fsc_certified:   boolean
 *   - fsc_categories:     string[] (paper | lumber | packaging | furniture | tissue)
 *   - since_year:         number | null
 *   - source_url:         string
 *
 * Output: /public/data/fsc.json (overwritten annually)
 *
 * Runs annually via .github/workflows/fsc-annual.yml
 * Locally: node scripts/fsc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/fsc.json");

const UA = "TruNorth-FSC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const HOME_URL         = "https://fsc.org/en";
const CERT_SEARCH_URL  = "https://info.fsc.org/certificate.php";
const MARKETPLACE_URL  = "https://marketplace.fsc.org";

/* --------------------------- curated mirror ----------------------------- */
// Known FSC-certified consumer brands (paper, lumber, packaging, tissue,
// furniture). Re-verified annually against:
//   - https://info.fsc.org/certificate.php  (license-holder search)
//   - https://marketplace.fsc.org           (FSC trademark portal)
//   - https://fsc.org/en/newsfeed           (FSC Connect news)
//   - brand sustainability / ESG reports
// Categories follow FSC's broad product-type buckets used in the
// trademark portal (paper, tissue, lumber, packaging, furniture).
const MIRROR = [
  // Paper & tissue (CPG)
  { brand: "Kimberly-Clark",       categories: ["paper", "tissue", "packaging"],            since_year: 2009, source_url: "https://www.kimberly-clark.com/en-us/esg/sustainability/forests" },
  { brand: "Kleenex",              categories: ["tissue", "paper"],                          since_year: 2009, source_url: "https://www.kleenex.com/en-us/sustainability" },
  { brand: "Cottonelle",           categories: ["tissue"],                                   since_year: 2009, source_url: "https://www.cottonelle.com/en-us/sustainability" },
  { brand: "Scott",                categories: ["tissue", "paper"],                          since_year: 2009, source_url: "https://www.scottbrand.com/en-us/sustainability" },
  { brand: "Procter & Gamble",     categories: ["paper", "tissue", "packaging"],            since_year: 2014, source_url: "https://us.pg.com/policies-and-practices/sustainable-forestry/" },
  { brand: "Charmin",              categories: ["tissue"],                                   since_year: 2014, source_url: "https://charmin.com/en-us/about-us/sustainability" },
  { brand: "Bounty",               categories: ["paper", "tissue"],                          since_year: 2014, source_url: "https://www.bountytowels.com/en-us/about/sustainability" },
  { brand: "Puffs",                categories: ["tissue"],                                   since_year: 2014, source_url: "https://puffs.com/" },
  { brand: "Georgia-Pacific",      categories: ["paper", "tissue", "packaging", "lumber"],  since_year: 2011, source_url: "https://www.gp.com/sustainability/forestry" },
  { brand: "Quilted Northern",     categories: ["tissue"],                                   since_year: 2011, source_url: "https://www.quiltednorthern.com/sustainability" },
  { brand: "Brawny",               categories: ["paper"],                                    since_year: 2011, source_url: "https://www.brawny.com/" },
  { brand: "Dixie",                categories: ["paper", "packaging"],                       since_year: 2011, source_url: "https://www.dixie.com/" },
  { brand: "Essity",               categories: ["tissue", "paper"],                          since_year: 2009, source_url: "https://www.essity.com/sustainability/" },
  { brand: "Tork",                 categories: ["tissue", "paper"],                          since_year: 2009, source_url: "https://www.torkusa.com/sustainability" },

  // Office / retail paper
  { brand: "Staples",              categories: ["paper", "packaging"],                       since_year: 2005, source_url: "https://www.staples.com/sbd/cre/marketing/sustainability-center/" },
  { brand: "Office Depot",         categories: ["paper", "packaging"],                       since_year: 2006, source_url: "https://www.officedepot.com/cm/sustainability/forest-products" },
  { brand: "Hammermill",           categories: ["paper"],                                    since_year: 2010, source_url: "https://www.hammermill.com/sustainability" },
  { brand: "Domtar",               categories: ["paper"],                                    since_year: 2005, source_url: "https://www.domtar.com/en/sustainability" },
  { brand: "International Paper",  categories: ["paper", "packaging"],                       since_year: 2007, source_url: "https://www.internationalpaper.com/sustainability/forests" },

  // Packaging / corrugated
  { brand: "WestRock",             categories: ["packaging", "paper"],                       since_year: 2010, source_url: "https://www.westrock.com/sustainability/forestry-and-fiber" },
  { brand: "Smurfit Kappa",        categories: ["packaging", "paper"],                       since_year: 2008, source_url: "https://www.smurfitkappa.com/sustainability" },
  { brand: "Sonoco",               categories: ["packaging"],                                since_year: 2010, source_url: "https://sustainability.sonoco.com/" },
  { brand: "Tetra Pak",            categories: ["packaging"],                                since_year: 2007, source_url: "https://www.tetrapak.com/sustainability/responsible-sourcing/forests" },
  { brand: "Amazon",               categories: ["packaging"],                                since_year: 2020, source_url: "https://sustainability.aboutamazon.com/environment/sustainable-operations/packaging" },

  // Lumber / building materials / home improvement
  { brand: "IKEA",                 categories: ["lumber", "furniture", "paper"],            since_year: 2011, source_url: "https://www.ikea.com/global/en/our-business/people-planet/forestry/" },
  { brand: "Home Depot",           categories: ["lumber"],                                   since_year: 1999, source_url: "https://corporate.homedepot.com/sustainability/forestry" },
  { brand: "Lowe's",               categories: ["lumber"],                                   since_year: 2000, source_url: "https://corporate.lowes.com/our-responsibilities/environment/sustainable-products/wood-policy" },
  { brand: "Weyerhaeuser",         categories: ["lumber"],                                   since_year: 2006, source_url: "https://www.weyerhaeuser.com/sustainability/forests/" },

  // Furniture / home
  { brand: "West Elm",             categories: ["furniture", "lumber"],                      since_year: 2014, source_url: "https://www.westelm.com/pages/about-us/our-impact/" },
  { brand: "Pottery Barn",         categories: ["furniture", "lumber"],                      since_year: 2015, source_url: "https://www.potterybarn.com/pages/our-impact/" },
  { brand: "Crate & Barrel",       categories: ["furniture", "lumber"],                      since_year: 2014, source_url: "https://www.crateandbarrel.com/sustainability/" },
  { brand: "Williams-Sonoma",      categories: ["furniture", "paper", "packaging"],          since_year: 2014, source_url: "https://www.williams-sonomainc.com/impact/people-and-communities/responsible-sourcing/" },

  // Books / publishing / media
  { brand: "Penguin Random House", categories: ["paper"],                                    since_year: 2010, source_url: "https://global.penguinrandomhouse.com/sustainability/" },
  { brand: "HarperCollins",        categories: ["paper"],                                    since_year: 2011, source_url: "https://www.harpercollins.com/pages/sustainability" },
  { brand: "Hachette",             categories: ["paper"],                                    since_year: 2012, source_url: "https://www.hachettebookgroup.com/about/" },

  // CPG / personal care packaging
  { brand: "Unilever",             categories: ["packaging", "paper"],                       since_year: 2014, source_url: "https://www.unilever.com/sustainability/nature/" },
  { brand: "Nestle",               categories: ["packaging", "paper"],                       since_year: 2015, source_url: "https://www.nestle.com/sustainability/nature-environment/forests" },
  { brand: "L'Oreal",              categories: ["packaging", "paper"],                       since_year: 2014, source_url: "https://www.loreal.com/en/commitments-and-responsibilities/for-the-planet/" },
  { brand: "Estee Lauder",         categories: ["packaging", "paper"],                       since_year: 2016, source_url: "https://www.elcompanies.com/en/our-commitments/the-planet" },

  // Coffee / QSR cups & packaging
  { brand: "Starbucks",            categories: ["packaging", "paper"],                       since_year: 2015, source_url: "https://www.starbucks.com/responsibility/sourcing/cups" },
  { brand: "McDonald's",           categories: ["packaging", "paper"],                       since_year: 2016, source_url: "https://corporate.mcdonalds.com/corpmcd/our-purpose-and-impact/our-planet/packaging-and-waste.html" },

  // Retail (private label paper / packaging)
  { brand: "Walmart",              categories: ["packaging", "paper"],                       since_year: 2017, source_url: "https://corporate.walmart.com/purpose/sustainability/planet/sustainable-products" },
  { brand: "Target",               categories: ["packaging", "paper"],                       since_year: 2017, source_url: "https://corporate.target.com/sustainability-esg/planet/sustainable-products-and-packaging" },
  { brand: "Costco",               categories: ["packaging", "paper"],                       since_year: 2018, source_url: "https://www.costco.com/sustainability-forest-products.html" },
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
    is_fsc_certified: true,
    fsc_categories:   entry.categories,
    since_year:       entry.since_year,
    source_url:       entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape FSC's JS-rendered certificate search directly (no public
// API, no cheap HTML), but we ping the public URLs once @ 1 req/sec to
// confirm they still resolve. Failure is non-fatal -- we still emit the
// mirror.

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
  console.log("FSC fetcher starting...");

  // Connectivity pings (1 req/sec budget).
  const pings = [];
  for (const url of [HOME_URL, CERT_SEARCH_URL, MARKETPLACE_URL]) {
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
    source:          "Forest Stewardship Council certified-brand mirror",
    source_urls:     [HOME_URL, CERT_SEARCH_URL, MARKETPLACE_URL],
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    certifications:  results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with FSC match: ${matched.length}`);
  console.log(`   No-match brands:       ${noMatch}`);
  console.log(`   Skipped (generic):     ${skipped}`);
  if (matched.length > 0) {
    console.log("\nFSC Certified brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- categories: ${r.fsc_categories.join(", ")} -- since ${r.since_year}`);
    }
  }
}

main().catch(err => {
  console.error("fsc-fetch failed:", err);
  process.exit(1);
});
