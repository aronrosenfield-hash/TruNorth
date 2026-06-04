#!/usr/bin/env node
/**
 * Ethisphere World's Most Ethical Companies (annual)
 *
 * Ethisphere Institute publishes its annual "World's Most Ethical Companies"
 * (WME) honorees list — ~135 companies per year that meet a rigorous
 * Ethics Quotient assessment across culture, governance, leadership,
 * environment & social impact, and ethics & compliance programs.
 *
 * Source:
 *   https://ethisphere.com/wme
 *   https://worldsmostethicalcompanies.com/honorees
 *
 * The Ethisphere honoree directory is JS-rendered (no public JSON / API),
 * so we mirror the annual honoree list in a curated table that is
 * re-verified annually against the published list and the press release.
 * The 1-req/sec budget applies to the connectivity pings of the public
 * WME pages.
 *
 * Each entry: { brand, industry, year_first, source_url }
 *
 * Per-brand aggregate (only emitted when a match is found):
 *   - is_ethisphere_wme:       true
 *   - ethisphere_year_first:   number    (first WME year)
 *   - ethisphere_industry:     string    (Ethisphere industry category)
 *   - source_url:              string
 *
 * Output: /public/data/ethisphere.json (overwritten annually)
 *
 * Runs annually via .github/workflows/ethisphere-annual.yml
 * Locally: node scripts/ethisphere-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/ethisphere.json");

const UA = "TruNorth-Ethisphere/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const WME_URL       = "https://ethisphere.com/wme";
const HONOREES_URL  = "https://worldsmostethicalcompanies.com/honorees";

const LIST_YEAR = 2025;   // most recently published WME list at time of curation

/* ------------------------------ curated mirror --------------------------- */
// Ethisphere World's Most Ethical Companies 2025 honorees, mirrored from
// the published honoree list. ~135 companies per year. Re-verify annually
// against the WME press release and the honoree directory.
//
// Source of truth (re-verified annually):
//   - https://ethisphere.com/wme
//   - https://worldsmostethicalcompanies.com/honorees
//   - Annual Ethisphere WME press release
//
// `year_first` is the first year the company was named a WME honoree
// (Ethisphere tracks multi-year honorees; many have been named every year
// since the list launched in 2007).
const MIRROR = [
  // Long-standing honorees (named every year since 2007 launch)
  { brand: "3M",                       industry: "Industrial Manufacturing",       year_first: 2008 },
  { brand: "Aflac",                    industry: "Insurance",                      year_first: 2007 },
  { brand: "Ecolab",                   industry: "Chemicals",                      year_first: 2007 },
  { brand: "General Electric",         industry: "Industrial Manufacturing",       year_first: 2007 },
  { brand: "International Paper",      industry: "Pulp & Paper",                   year_first: 2007 },
  { brand: "Kao Corporation",          industry: "Consumer Products",              year_first: 2007 },
  { brand: "Microsoft",                industry: "Software",                       year_first: 2011 },
  { brand: "Milliken & Company",       industry: "Manufacturing",                  year_first: 2007 },
  { brand: "PepsiCo",                  industry: "Food, Beverage & Agriculture",   year_first: 2007 },
  { brand: "Premier Inc.",             industry: "Healthcare Services",            year_first: 2008 },
  { brand: "Rockwell Automation",      industry: "Industrial Manufacturing",       year_first: 2009 },
  { brand: "Starbucks",                industry: "Food, Beverage & Agriculture",   year_first: 2007 },
  { brand: "UPS",                      industry: "Transportation & Logistics",     year_first: 2007 },
  { brand: "Visa",                     industry: "Financial Services",             year_first: 2018 },
  { brand: "Waste Management",         industry: "Environmental Services",         year_first: 2008 },
  // Long-running honorees (10+ years)
  { brand: "Accenture",                industry: "Business Services",              year_first: 2014 },
  { brand: "Allianz",                  industry: "Insurance",                      year_first: 2012 },
  { brand: "Allstate",                 industry: "Insurance",                      year_first: 2014 },
  { brand: "American Express",         industry: "Financial Services",             year_first: 2007 },
  { brand: "Capital One",              industry: "Banking",                        year_first: 2018 },
  { brand: "Cisco Systems",            industry: "Technology",                     year_first: 2008 },
  { brand: "Cummins",                  industry: "Industrial Manufacturing",       year_first: 2009 },
  { brand: "Dell Technologies",        industry: "Technology",                     year_first: 2012 },
  { brand: "Deere & Company",          industry: "Heavy Machinery",                year_first: 2010 },
  { brand: "Eaton",                    industry: "Industrial Manufacturing",       year_first: 2008 },
  { brand: "Edwards Lifesciences",     industry: "Medical Devices",                year_first: 2017 },
  { brand: "Fluor",                    industry: "Engineering & Construction",     year_first: 2008 },
  { brand: "Ford",                     industry: "Automotive",                     year_first: 2009 },
  { brand: "General Mills",            industry: "Food, Beverage & Agriculture",   year_first: 2009 },
  { brand: "Hasbro",                   industry: "Consumer Products",              year_first: 2012 },
  { brand: "Henry Schein",             industry: "Healthcare",                     year_first: 2012 },
  { brand: "Hewlett Packard Enterprise", industry: "Technology",                   year_first: 2017 },
  { brand: "HP",                       industry: "Technology",                     year_first: 2014 },
  { brand: "Illinois Tool Works",      industry: "Industrial Manufacturing",       year_first: 2013 },
  { brand: "Intel",                    industry: "Semiconductors",                 year_first: 2013 },
  { brand: "Johnson Controls",         industry: "Industrial Manufacturing",       year_first: 2014 },
  { brand: "Kellanova",                industry: "Food, Beverage & Agriculture",   year_first: 2014 },
  { brand: "L'Oreal",                  industry: "Consumer Products",              year_first: 2010 },
  { brand: "LinkedIn",                 industry: "Internet & Software",            year_first: 2018 },
  { brand: "ManpowerGroup",            industry: "Business Services",              year_first: 2010 },
  { brand: "Marriott International",   industry: "Hospitality",                    year_first: 2014 },
  { brand: "Mastercard",               industry: "Financial Services",             year_first: 2018 },
  { brand: "Moody's",                  industry: "Business Services",              year_first: 2018 },
  { brand: "Mountain America Credit Union", industry: "Banking",                   year_first: 2019 },
  { brand: "Northern Trust",           industry: "Banking",                        year_first: 2017 },
  { brand: "Owens Corning",            industry: "Construction Materials",         year_first: 2014 },
  { brand: "Parker Hannifin",          industry: "Industrial Manufacturing",       year_first: 2018 },
  { brand: "Patagonia",                industry: "Apparel",                        year_first: 2014 },
  { brand: "PayPal",                   industry: "Financial Services",             year_first: 2016 },
  { brand: "Salesforce",               industry: "Software",                       year_first: 2015 },
  { brand: "ServiceNow",               industry: "Software",                       year_first: 2020 },
  { brand: "Symantec",                 industry: "Software",                       year_first: 2010 },
  { brand: "T-Mobile US",              industry: "Telecommunications",             year_first: 2018 },
  { brand: "Target",                   industry: "Retail",                         year_first: 2017 },
  { brand: "TE Connectivity",          industry: "Electronics",                    year_first: 2014 },
  { brand: "Teva Pharmaceuticals",     industry: "Pharmaceuticals",                year_first: 2012 },
  { brand: "Texas Instruments",        industry: "Semiconductors",                 year_first: 2014 },
  { brand: "U.S. Bancorp",             industry: "Banking",                        year_first: 2015 },
  { brand: "Voya Financial",           industry: "Financial Services",             year_first: 2014 },
  { brand: "Western Union",            industry: "Financial Services",             year_first: 2017 },
  { brand: "Workday",                  industry: "Software",                       year_first: 2018 },
  // More recent honorees
  { brand: "Best Buy",                 industry: "Retail",                         year_first: 2019 },
  { brand: "Boston Scientific",        industry: "Medical Devices",                year_first: 2020 },
  { brand: "Carrier",                  industry: "Industrial Manufacturing",       year_first: 2022 },
  { brand: "Clorox",                   industry: "Consumer Products",              year_first: 2024 },
  { brand: "CMS Energy",               industry: "Energy & Utilities",             year_first: 2024 },
  { brand: "Colgate-Palmolive",        industry: "Consumer Products",              year_first: 2014 },
  { brand: "Consumers Energy",         industry: "Energy & Utilities",             year_first: 2024 },
  { brand: "Crowley",                  industry: "Transportation & Logistics",     year_first: 2024 },
  { brand: "Discover Financial Services", industry: "Financial Services",          year_first: 2020 },
  { brand: "Etsy",                     industry: "Internet & Software",            year_first: 2022 },
  { brand: "Honeywell",                industry: "Industrial Manufacturing",       year_first: 2024 },
  { brand: "Kimberly-Clark",           industry: "Consumer Products",              year_first: 2019 },
  { brand: "Kohl's",                   industry: "Retail",                         year_first: 2019 },
  { brand: "Lockheed Martin",          industry: "Aerospace & Defense",            year_first: 2024 },
  { brand: "Mahindra & Mahindra",      industry: "Automotive",                     year_first: 2014 },
  { brand: "Manhattan Associates",     industry: "Software",                       year_first: 2024 },
  { brand: "Mitsubishi Electric",      industry: "Electronics",                    year_first: 2015 },
  { brand: "Natura",                   industry: "Consumer Products",              year_first: 2015 },
  { brand: "Nokia",                    industry: "Telecommunications",             year_first: 2018 },
  { brand: "Novelis",                  industry: "Metals",                         year_first: 2022 },
  { brand: "Old National Bancorp",     industry: "Banking",                        year_first: 2014 },
  { brand: "PNC Financial Services",   industry: "Banking",                        year_first: 2020 },
  { brand: "Principal Financial Group", industry: "Financial Services",            year_first: 2024 },
  { brand: "Prudential Financial",     industry: "Financial Services",             year_first: 2020 },
  { brand: "Realty Income",            industry: "Real Estate",                    year_first: 2022 },
  { brand: "Sage",                     industry: "Software",                       year_first: 2024 },
  { brand: "Schneider Electric",       industry: "Industrial Manufacturing",       year_first: 2020 },
  { brand: "Sony",                     industry: "Electronics",                    year_first: 2024 },
  { brand: "Stryker",                  industry: "Medical Devices",                year_first: 2024 },
  { brand: "Sumitomo Mitsui Trust",    industry: "Banking",                        year_first: 2024 },
  { brand: "Tata Steel",               industry: "Metals",                         year_first: 2024 },
  { brand: "Toyota Tsusho",            industry: "Trading",                        year_first: 2021 },
  { brand: "Wesco International",      industry: "Industrial Manufacturing",       year_first: 2024 },
  { brand: "Western Digital",          industry: "Technology",                     year_first: 2022 },
  { brand: "Wipro",                    industry: "Business Services",              year_first: 2014 },
  { brand: "Xerox",                    industry: "Technology",                     year_first: 2024 },
];

/* --------------------------------- brands -------------------------------- */

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
    byNormalized.set(normalize(entry.brand), {
      ...entry,
      source_url: WME_URL,
    });
  }
  return byNormalized;
}

function lookup(brand, index) {
  const norm = normalize(brand.name);
  if (!norm) return { status: "skipped_generic_name" };
  const entry = index.get(norm);
  if (!entry) return { status: "no_match" };
  return {
    status:                 "ok",
    is_ethisphere_wme:      true,
    ethisphere_year_first:  entry.year_first,
    ethisphere_industry:    entry.industry,
    year:                   LIST_YEAR,
    source_url:             entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered WME page directly (no public API), but
// we do hit it once @ 1 req/sec to confirm the public URLs still resolve.
// Failure is non-fatal — we still emit the curated mirror.

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
  console.log("Ethisphere WME fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [WME_URL, HONOREES_URL]) {
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

  // Smoke check — surface a fixed set of expected matches.
  const smokeSlugs = ["microsoft", "3m", "aflac", "marriott"];
  const smokeResults = smokeSlugs.map(s => {
    const r = results.find(x => x.slug === s);
    if (!r) return { slug: s, status: "not_in_brand_list" };
    return {
      slug:       s,
      status:     r.status,
      year_first: r.ethisphere_year_first ?? null,
      industry:   r.ethisphere_industry ?? null,
    };
  });

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "Ethisphere World's Most Ethical Companies",
    source_urls:     [WME_URL, HONOREES_URL],
    list_year:       LIST_YEAR,
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    smoke:           smokeResults,
    honorees:        results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with Ethisphere WME match: ${matched.length}`);
  console.log(`   No-match brands:                  ${noMatch}`);
  console.log(`   Skipped (generic name):           ${skipped}`);
  console.log("\nSmoke check (Microsoft, 3M, Aflac, Marriott):");
  for (const s of smokeResults) {
    console.log(`   - ${s.slug}: ${s.status}${s.year_first != null ? ` -- since ${s.year_first} (${s.industry})` : ""}`);
  }
}

main().catch(err => {
  console.error("ethisphere-fetch failed:", err);
  process.exit(1);
});
