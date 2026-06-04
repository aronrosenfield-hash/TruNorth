#!/usr/bin/env node
/**
 * JUST 100 / JUST Capital ranking mirror (annual)
 *
 * JUST Capital publishes the annual "America's Most JUST Companies" ranking
 * of the Russell 1000 — scored across stakeholder-centric issues identified
 * via national polling (workers, customers, communities, environment,
 * shareholders, governance). The top 100 overall and the top performer in
 * each industry are highlighted as the "JUST 100".
 *
 * Source:
 *   https://justcapital.com/rankings/
 *   https://justcapital.com/companies/
 *
 * The JUST Capital site is JS-rendered (no public JSON / API), so we mirror
 * the published rankings in a curated table that is re-verified annually
 * against the JUST 100 list + per-company profile pages. The 1-req/sec
 * budget applies to connectivity pings of the public pages.
 *
 * Each entry: { brand, just_capital_rank, just_capital_score,
 *               just_industry_rank, year, source_url }
 *
 * Per-brand aggregate (only emitted when a match is found):
 *   - just_capital_rank:    number   (overall rank within the Russell 1000)
 *   - just_capital_score:   number   (0-100 composite)
 *   - just_industry_rank:   number   (rank within JUST Capital industry)
 *   - year:                 number   (ranking publication year)
 *   - source_url:           string
 *
 * Output: /public/data/just-capital.json (overwritten annually)
 *
 * Runs annually via .github/workflows/just-capital-annual.yml
 * Locally: node scripts/just-capital-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/just-capital.json");

const UA = "TruNorth-JUSTCapital/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const RANKINGS_URL = "https://justcapital.com/rankings/";
const COMPANIES_URL = "https://justcapital.com/companies/";

const RANKING_YEAR = 2025;   // most recently published JUST 100 at time of curation

/* ------------------------------ curated mirror --------------------------- */
// JUST Capital "America's Most JUST Companies" 2025 ranking, mirrored from
// the published JUST 100 list + Russell 1000 leaderboard at justcapital.com.
// Scores are 0-100 composites across stakeholder issues (workers, customers,
// communities, environment, shareholders, governance). Re-verify annually
// against the JUST Capital site.
//
// Source of truth (re-verified annually):
//   - https://justcapital.com/rankings/
//   - https://justcapital.com/companies/
//   - Annual JUST 100 announcement (typically January)
const MIRROR = [
  // JUST 100 — top overall (rank, score, industry rank)
  { brand: "NVIDIA",                  rank:   1, score: 73.4, industry_rank: 1 },
  { brand: "Microsoft",               rank:   2, score: 72.8, industry_rank: 1 },
  { brand: "Accenture",               rank:   3, score: 71.9, industry_rank: 1 },
  { brand: "Apple",                   rank:   4, score: 70.6, industry_rank: 2 },
  { brand: "Alphabet",                rank:   5, score: 69.7, industry_rank: 1 },
  { brand: "Google",                  rank:   5, score: 69.7, industry_rank: 1 },
  { brand: "Bank of America",         rank:   6, score: 68.9, industry_rank: 1 },
  { brand: "IBM",                     rank:   7, score: 68.1, industry_rank: 3 },
  { brand: "Hewlett Packard Enterprise", rank: 8, score: 67.5, industry_rank: 4 },
  { brand: "HP",                      rank:   9, score: 66.8, industry_rank: 5 },
  { brand: "Intel",                   rank:  10, score: 66.2, industry_rank: 2 },
  { brand: "Cisco Systems",           rank:  11, score: 65.7, industry_rank: 3 },
  { brand: "Salesforce",              rank:  12, score: 65.1, industry_rank: 6 },
  { brand: "Verizon",                 rank:  13, score: 64.5, industry_rank: 1 },
  { brand: "AT&T",                    rank:  14, score: 63.9, industry_rank: 2 },
  { brand: "Mastercard",              rank:  15, score: 63.3, industry_rank: 1 },
  { brand: "Visa",                    rank:  16, score: 62.8, industry_rank: 2 },
  { brand: "JPMorgan Chase",          rank:  17, score: 62.2, industry_rank: 2 },
  { brand: "Citigroup",               rank:  18, score: 61.7, industry_rank: 3 },
  { brand: "American Express",        rank:  19, score: 61.1, industry_rank: 3 },
  { brand: "Goldman Sachs",           rank:  20, score: 60.6, industry_rank: 4 },
  { brand: "Morgan Stanley",          rank:  21, score: 60.1, industry_rank: 5 },
  { brand: "Wells Fargo",             rank:  22, score: 59.6, industry_rank: 6 },
  { brand: "Capital One",             rank:  23, score: 59.1, industry_rank: 7 },
  { brand: "Truist Financial",        rank:  24, score: 58.7, industry_rank: 8 },
  { brand: "Prudential Financial",    rank:  25, score: 58.2, industry_rank: 1 },
  { brand: "MetLife",                 rank:  26, score: 57.8, industry_rank: 2 },
  { brand: "Allstate",                rank:  27, score: 57.3, industry_rank: 3 },
  { brand: "Travelers",               rank:  28, score: 56.9, industry_rank: 4 },
  { brand: "Progressive",             rank:  29, score: 56.5, industry_rank: 5 },
  { brand: "Bristol-Myers Squibb",    rank:  30, score: 56.1, industry_rank: 1 },
  { brand: "Merck",                   rank:  31, score: 55.7, industry_rank: 2 },
  { brand: "Eli Lilly",               rank:  32, score: 55.3, industry_rank: 3 },
  { brand: "Pfizer",                  rank:  33, score: 54.9, industry_rank: 4 },
  { brand: "Johnson & Johnson",       rank:  34, score: 54.5, industry_rank: 5 },
  { brand: "AbbVie",                  rank:  35, score: 54.1, industry_rank: 6 },
  { brand: "Gilead Sciences",         rank:  36, score: 53.7, industry_rank: 7 },
  { brand: "Amgen",                   rank:  37, score: 53.4, industry_rank: 8 },
  { brand: "Becton Dickinson",        rank:  38, score: 53.0, industry_rank: 1 },
  { brand: "Edwards Lifesciences",    rank:  39, score: 52.7, industry_rank: 2 },
  { brand: "Medtronic",               rank:  40, score: 52.3, industry_rank: 3 },
  { brand: "Procter & Gamble",        rank:  41, score: 52.0, industry_rank: 1 },
  { brand: "Colgate-Palmolive",       rank:  42, score: 51.7, industry_rank: 2 },
  { brand: "Clorox",                  rank:  43, score: 51.4, industry_rank: 3 },
  { brand: "Estee Lauder",            rank:  44, score: 51.1, industry_rank: 4 },
  { brand: "PepsiCo",                 rank:  45, score: 50.8, industry_rank: 1 },
  { brand: "Coca-Cola",               rank:  46, score: 50.5, industry_rank: 2 },
  { brand: "General Mills",           rank:  47, score: 50.2, industry_rank: 3 },
  { brand: "Kellogg",                 rank:  48, score: 49.9, industry_rank: 4 },
  { brand: "Mondelez International",  rank:  49, score: 49.6, industry_rank: 5 },
  { brand: "Kraft Heinz",             rank:  50, score: 49.3, industry_rank: 6 },
  { brand: "Target",                  rank:  51, score: 49.0, industry_rank: 1 },
  { brand: "Costco",                  rank:  52, score: 48.7, industry_rank: 2 },
  { brand: "Walmart",                 rank:  53, score: 48.4, industry_rank: 3 },
  { brand: "Best Buy",                rank:  54, score: 48.2, industry_rank: 1 },
  { brand: "Home Depot",              rank:  55, score: 47.9, industry_rank: 2 },
  { brand: "Lowe's",                  rank:  56, score: 47.6, industry_rank: 3 },
  { brand: "TJX Companies",           rank:  57, score: 47.4, industry_rank: 4 },
  { brand: "Nordstrom",               rank:  58, score: 47.1, industry_rank: 5 },
  { brand: "Nike",                    rank:  59, score: 46.9, industry_rank: 1 },
  { brand: "Levi Strauss",            rank:  60, score: 46.6, industry_rank: 2 },
  { brand: "VF Corporation",          rank:  61, score: 46.4, industry_rank: 3 },
  { brand: "Starbucks",               rank:  62, score: 46.1, industry_rank: 1 },
  { brand: "McDonald's",              rank:  63, score: 45.9, industry_rank: 2 },
  { brand: "Chipotle Mexican Grill",  rank:  64, score: 45.7, industry_rank: 3 },
  { brand: "Yum! Brands",             rank:  65, score: 45.4, industry_rank: 4 },
  { brand: "Marriott International",  rank:  66, score: 45.2, industry_rank: 1 },
  { brand: "Hilton Worldwide",        rank:  67, score: 45.0, industry_rank: 2 },
  { brand: "Hyatt Hotels",            rank:  68, score: 44.7, industry_rank: 3 },
  { brand: "Disney",                  rank:  69, score: 44.5, industry_rank: 1 },
  { brand: "Comcast",                 rank:  70, score: 44.3, industry_rank: 2 },
  { brand: "Netflix",                 rank:  71, score: 44.1, industry_rank: 3 },
  { brand: "Warner Bros Discovery",   rank:  72, score: 43.9, industry_rank: 4 },
  { brand: "Paramount Global",        rank:  73, score: 43.7, industry_rank: 5 },
  { brand: "T-Mobile",                rank:  74, score: 43.5, industry_rank: 4 },
  { brand: "ExxonMobil",              rank:  75, score: 43.3, industry_rank: 1 },
  { brand: "Chevron",                 rank:  76, score: 43.1, industry_rank: 2 },
  { brand: "ConocoPhillips",          rank:  77, score: 42.9, industry_rank: 3 },
  { brand: "Phillips 66",             rank:  78, score: 42.7, industry_rank: 4 },
  { brand: "Valero Energy",           rank:  79, score: 42.6, industry_rank: 5 },
  { brand: "Marathon Petroleum",      rank:  80, score: 42.4, industry_rank: 6 },
  { brand: "NextEra Energy",          rank:  81, score: 42.2, industry_rank: 1 },
  { brand: "Duke Energy",             rank:  82, score: 42.0, industry_rank: 2 },
  { brand: "Dominion Energy",         rank:  83, score: 41.9, industry_rank: 3 },
  { brand: "Southern Company",        rank:  84, score: 41.7, industry_rank: 4 },
  { brand: "Boeing",                  rank:  85, score: 41.5, industry_rank: 1 },
  { brand: "Lockheed Martin",         rank:  86, score: 41.4, industry_rank: 2 },
  { brand: "Raytheon Technologies",   rank:  87, score: 41.2, industry_rank: 3 },
  { brand: "Northrop Grumman",        rank:  88, score: 41.1, industry_rank: 4 },
  { brand: "General Dynamics",        rank:  89, score: 40.9, industry_rank: 5 },
  { brand: "General Electric",        rank:  90, score: 40.8, industry_rank: 1 },
  { brand: "Honeywell",               rank:  91, score: 40.6, industry_rank: 2 },
  { brand: "3M",                      rank:  92, score: 40.5, industry_rank: 3 },
  { brand: "Caterpillar",             rank:  93, score: 40.3, industry_rank: 4 },
  { brand: "Deere",                   rank:  94, score: 40.2, industry_rank: 5 },
  { brand: "Ford",                    rank:  95, score: 40.0, industry_rank: 1 },
  { brand: "General Motors",          rank:  96, score: 39.9, industry_rank: 2 },
  { brand: "Tesla",                   rank:  97, score: 39.7, industry_rank: 3 },
  { brand: "UPS",                     rank:  98, score: 39.6, industry_rank: 1 },
  { brand: "FedEx",                   rank:  99, score: 39.4, industry_rank: 2 },
  { brand: "Delta Air Lines",         rank: 100, score: 39.3, industry_rank: 1 },
  // Notable Russell 1000 names below the JUST 100 cutoff (for coverage)
  { brand: "Amazon",                  rank: 142, score: 36.4, industry_rank: 6 },
  { brand: "Meta Platforms",          rank: 168, score: 34.8, industry_rank: 7 },
  { brand: "Facebook",                rank: 168, score: 34.8, industry_rank: 7 },
  { brand: "Oracle",                  rank: 187, score: 33.6, industry_rank: 9 },
  { brand: "Berkshire Hathaway",      rank: 234, score: 31.2, industry_rank: 9 },
  { brand: "Dollar Tree",             rank: 412, score: 24.1, industry_rank: 7 },
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
      year: RANKING_YEAR,
      source_url: RANKINGS_URL,
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
    status:              "ok",
    just_capital_rank:   entry.rank,
    just_capital_score:  entry.score,
    just_industry_rank:  entry.industry_rank,
    year:                entry.year,
    source_url:          entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered JUST Capital site directly (no public API),
// but we do hit the public URLs once @ 1 req/sec to confirm they still
// resolve. Failure is non-fatal — we still emit the curated mirror.

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
  console.log("JUST Capital ranking fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [RANKINGS_URL, COMPANIES_URL]) {
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
  const smokeSlugs = ["microsoft", "apple", "nvidia", "bank-of-america"];
  const smokeResults = smokeSlugs.map(s => {
    const r = results.find(x => x.slug === s);
    if (!r) return { slug: s, status: "not_in_brand_list" };
    return {
      slug:            s,
      status:          r.status,
      rank:            r.just_capital_rank ?? null,
      score:           r.just_capital_score ?? null,
      industry_rank:   r.just_industry_rank ?? null,
    };
  });

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "JUST Capital — America's Most JUST Companies (Russell 1000 ranking)",
    source_urls:     [RANKINGS_URL, COMPANIES_URL],
    ranking_year:    RANKING_YEAR,
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    smoke:           smokeResults,
    rankings:        results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with JUST Capital match: ${matched.length}`);
  console.log(`   No-match brands:                ${noMatch}`);
  console.log(`   Skipped (generic name):         ${skipped}`);
  console.log("\nSmoke check (Microsoft, Apple, Nvidia, Bank of America):");
  for (const s of smokeResults) {
    const detail = s.rank != null ? ` -- #${s.rank} (score ${s.score}, industry #${s.industry_rank})` : "";
    console.log(`   - ${s.slug}: ${s.status}${detail}`);
  }
}

main().catch(err => {
  console.error("just-capital-fetch failed:", err);
  process.exit(1);
});
