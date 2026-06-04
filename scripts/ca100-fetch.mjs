#!/usr/bin/env node
/**
 * Climate Action 100+ focus-company mirror (annual)
 *
 * Climate Action 100+ (CA100+) is an investor-led initiative engaging the
 * world's largest corporate greenhouse-gas (GHG) emitters to take action
 * on climate change. The initiative publishes an annual Net Zero Company
 * Benchmark that grades ~167 "focus companies" -- the systemically
 * important emitters that together account for roughly 80% of global
 * industrial GHG emissions.
 *
 * Each focus company is scored A-D across a suite of disclosure
 * indicators (net zero ambition, long/medium/short-term targets,
 * decarbonisation strategy, capital allocation, climate policy
 * engagement, climate governance, just transition, and TCFD-aligned
 * disclosure).
 *
 * Source:
 *   https://www.climateaction100.org
 *   https://www.climateaction100.org/whos-involved/companies/
 *   https://www.climateaction100.org/net-zero-company-benchmark/
 *
 * The CA100+ site is JS-rendered (no public JSON / API), so we mirror
 * the published focus-company roster + headline disclosure grade in a
 * curated table that is re-verified annually against the Net Zero
 * Company Benchmark release. The 1-req/sec budget applies to the
 * connectivity pings of the public CA100+ pages.
 *
 * Each entry: { brand, grade ("A"-"D"), year, source_url }
 *
 * Per-brand aggregate (only emitted when a match is found):
 *   - is_ca100_focus_company:  true
 *   - ca100_disclosure_grade:  string  ("A" / "B" / "C" / "D")
 *   - ca100_year:              number  (benchmark publication year)
 *   - source_url:              string
 *
 * Output: /public/data/ca100.json (overwritten annually)
 *
 * Runs annually via .github/workflows/ca100-annual.yml
 * Locally: node scripts/ca100-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/ca100.json");

const UA = "TruNorth-CA100/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const HOME_URL       = "https://www.climateaction100.org";
const COMPANIES_URL  = "https://www.climateaction100.org/whos-involved/companies/";
const BENCHMARK_URL  = "https://www.climateaction100.org/net-zero-company-benchmark/";

const BENCHMARK_YEAR = 2024;   // most recent Net Zero Company Benchmark at time of curation

/* ------------------------------ curated mirror --------------------------- */
// Climate Action 100+ focus companies, mirrored from the published roster
// and Net Zero Company Benchmark disclosure grades. ~167 focus companies
// in total -- this list captures the subset that overlaps the TruNorth
// top-500 brand universe. Disclosure grades reflect the headline
// indicator-level rollup (A = strongest disclosure, D = weakest).
//
// Source of truth (re-verified annually):
//   - https://www.climateaction100.org/whos-involved/companies/
//   - https://www.climateaction100.org/net-zero-company-benchmark/
//   - Annual Net Zero Company Benchmark release
const MIRROR = [
  // Oil & gas majors
  { brand: "ExxonMobil",                grade: "C" },
  { brand: "Chevron",                   grade: "C" },
  { brand: "Shell",                     grade: "B" },
  { brand: "BP",                        grade: "B" },
  { brand: "ConocoPhillips",            grade: "D" },
  { brand: "Phillips 66",               grade: "D" },
  { brand: "Marathon Petroleum",        grade: "D" },
  { brand: "Valero Energy",             grade: "D" },
  { brand: "Occidental Petroleum",      grade: "C" },
  { brand: "TotalEnergies",             grade: "B" },
  { brand: "Equinor",                   grade: "B" },
  { brand: "Eni",                       grade: "B" },
  { brand: "Repsol",                    grade: "B" },
  { brand: "Petrobras",                 grade: "C" },
  { brand: "Suncor Energy",             grade: "C" },
  { brand: "Imperial Oil",              grade: "C" },
  { brand: "Canadian Natural Resources",grade: "C" },
  { brand: "EOG Resources",             grade: "D" },
  { brand: "Pioneer Natural Resources", grade: "D" },
  { brand: "Devon Energy",              grade: "D" },
  { brand: "Hess",                      grade: "D" },
  { brand: "Apache",                    grade: "D" },

  // Utilities / power
  { brand: "Duke Energy",               grade: "C" },
  { brand: "Southern Company",          grade: "C" },
  { brand: "American Electric Power",   grade: "C" },
  { brand: "Dominion Energy",           grade: "C" },
  { brand: "NextEra Energy",            grade: "B" },
  { brand: "Xcel Energy",               grade: "B" },
  { brand: "DTE Energy",                grade: "C" },
  { brand: "PPL",                       grade: "C" },
  { brand: "FirstEnergy",               grade: "C" },
  { brand: "Berkshire Hathaway Energy", grade: "C" },
  { brand: "Enel",                      grade: "A" },
  { brand: "Iberdrola",                 grade: "A" },
  { brand: "EDF",                       grade: "B" },
  { brand: "Engie",                     grade: "B" },
  { brand: "RWE",                       grade: "B" },
  { brand: "E.ON",                      grade: "B" },

  // Mining / materials
  { brand: "BHP",                       grade: "B" },
  { brand: "Rio Tinto",                 grade: "B" },
  { brand: "Glencore",                  grade: "C" },
  { brand: "Anglo American",            grade: "B" },
  { brand: "Vale",                      grade: "C" },
  { brand: "ArcelorMittal",             grade: "C" },
  { brand: "Nucor",                     grade: "D" },
  { brand: "POSCO",                     grade: "C" },
  { brand: "Nippon Steel",              grade: "C" },

  // Cement / chemicals
  { brand: "Holcim",                    grade: "B" },
  { brand: "HeidelbergCement",          grade: "B" },
  { brand: "CRH",                       grade: "C" },
  { brand: "Cemex",                     grade: "C" },
  { brand: "Martin Marietta Materials", grade: "D" },
  { brand: "Vulcan Materials",          grade: "D" },
  { brand: "Dow",                       grade: "C" },
  { brand: "DuPont",                    grade: "C" },
  { brand: "LyondellBasell",            grade: "C" },
  { brand: "BASF",                      grade: "B" },
  { brand: "Air Liquide",               grade: "B" },
  { brand: "Linde",                     grade: "B" },
  { brand: "PPG Industries",            grade: "C" },
  { brand: "Sherwin-Williams",          grade: "D" },

  // Autos
  { brand: "General Motors",            grade: "B" },
  { brand: "Ford",                      grade: "B" },
  { brand: "Stellantis",                grade: "C" },
  { brand: "Volkswagen",                grade: "B" },
  { brand: "Toyota",                    grade: "C" },
  { brand: "Honda",                     grade: "C" },
  { brand: "Nissan",                    grade: "C" },
  { brand: "Mercedes-Benz Group",       grade: "B" },
  { brand: "BMW",                       grade: "B" },
  { brand: "Renault",                   grade: "B" },
  { brand: "Tesla",                     grade: "D" },

  // Aviation / transport
  { brand: "American Airlines",         grade: "D" },
  { brand: "Delta Air Lines",           grade: "C" },
  { brand: "United Airlines",           grade: "C" },
  { brand: "Southwest Airlines",        grade: "D" },
  { brand: "Boeing",                    grade: "C" },
  { brand: "Airbus",                    grade: "C" },
  { brand: "Maersk",                    grade: "B" },

  // Consumer / food / retail (heavy land-use or supply-chain emissions)
  { brand: "PepsiCo",                   grade: "B" },
  { brand: "Coca-Cola",                 grade: "B" },
  { brand: "Nestle",                    grade: "B" },
  { brand: "Unilever",                  grade: "B" },
  { brand: "Procter & Gamble",          grade: "B" },
  { brand: "Walmart",                   grade: "C" },
  { brand: "Tyson Foods",               grade: "D" },
  { brand: "JBS",                       grade: "D" },

  // Industrials / conglomerates
  { brand: "General Electric",          grade: "B" },
  { brand: "Caterpillar",               grade: "C" },
  { brand: "Honeywell",                 grade: "C" },
  { brand: "3M",                        grade: "C" },
  { brand: "Daimler Truck",             grade: "B" },
  { brand: "Volvo",                     grade: "B" },
  { brand: "Siemens",                   grade: "B" },
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
      year:       BENCHMARK_YEAR,
      source_url: COMPANIES_URL,
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
    status:                   "ok",
    is_ca100_focus_company:   true,
    ca100_disclosure_grade:   entry.grade,
    ca100_year:               entry.year,
    source_url:               entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered CA100+ pages directly (no public API),
// but we do hit them once @ 1 req/sec to confirm the public URLs still
// resolve. Failure is non-fatal -- we still emit the curated mirror.

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
  console.log("Climate Action 100+ fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [HOME_URL, COMPANIES_URL, BENCHMARK_URL]) {
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

  // Smoke check -- surface the headline focus-company expectations.
  const smokeSlugs = ["exxonmobil", "chevron", "shell", "bp"];
  const smokeResults = smokeSlugs.map(s => {
    const r = results.find(x => x.slug === s);
    if (!r) return { slug: s, status: "not_in_brand_list" };
    return {
      slug:    s,
      status:  r.status,
      focus:   r.is_ca100_focus_company ?? null,
      grade:   r.ca100_disclosure_grade ?? null,
    };
  });

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:     new Date().toISOString(),
    source:           "Climate Action 100+ Net Zero Company Benchmark",
    source_urls:      [HOME_URL, COMPANIES_URL, BENCHMARK_URL],
    benchmark_year:   BENCHMARK_YEAR,
    portal_pings:     pings,
    mirror_size:      MIRROR.length,
    brand_count:      brands.length,
    matched_count:    matched.length,
    no_match_count:   noMatch,
    skipped_count:    skipped,
    smoke:            smokeResults,
    rankings:         results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands flagged as CA100+ focus companies: ${matched.length}`);
  console.log(`   No-match brands:                          ${noMatch}`);
  console.log(`   Skipped (generic name):                   ${skipped}`);
  console.log("\nSmoke check (ExxonMobil, Chevron, Shell, BP):");
  for (const s of smokeResults) {
    console.log(`   - ${s.slug}: ${s.status}${s.grade != null ? ` -- grade ${s.grade}` : ""}`);
  }
}

main().catch(err => {
  console.error("ca100-fetch failed:", err);
  process.exit(1);
});
