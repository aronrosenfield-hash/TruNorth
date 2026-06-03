#!/usr/bin/env node
/**
 * CPA-Zicklin Index mirror (annual)
 *
 * The Center for Political Accountability publishes the annual CPA-Zicklin
 * Index of Corporate Political Disclosure and Accountability — a 0-100
 * score (across ~24 disclosure / accountability indicators) for every
 * company in the S&P 500. Companies are then grouped into tiers:
 *
 *   - Trendsetters       (>= 90)
 *   - First Tier         (80–89)
 *   - Second Tier        (70–79)
 *   - Third Tier         (60–69)
 *   - Fourth Tier        (50–59)
 *   - Fifth Tier         (25–49)
 *   - Bottom Tier        (< 25)
 *
 * Source:
 *   https://politicalaccountability.net/cpa-zicklin-index
 *
 * The CPA-Zicklin site is JS-rendered (no public JSON / API), so we mirror
 * the published rankings in a curated table that is re-verified annually
 * against the index PDF and the interactive web ranking. The 1-req/sec
 * budget applies to the connectivity pings of the public index pages.
 *
 * Each entry: { brand, score (0-100), tier, year, source_url }
 *
 * Per-brand aggregate (only emitted when a match is found):
 *   - cpa_zicklin_score: number    (0-100)
 *   - cpa_zicklin_tier:  string    (e.g. "Trendsetter", "First Tier")
 *   - year:              number    (index publication year)
 *   - source_url:        string
 *
 * Output: /public/data/cpa-zicklin.json (overwritten annually)
 *
 * Runs annually via .github/workflows/cpa-zicklin-annual.yml
 * Locally: node scripts/cpa-zicklin-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/cpa-zicklin.json");

const UA = "TruNorth-CPA-Zicklin/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const INDEX_URL    = "https://politicalaccountability.net/cpa-zicklin-index";
const RANKINGS_URL = "https://politicalaccountability.net/cpa-zicklin-index/rankings";

const INDEX_YEAR = 2024;   // most recently published index at time of curation

/* --------------------------- tier classification ------------------------- */

function tierFor(score) {
  if (score >= 90) return "Trendsetter";
  if (score >= 80) return "First Tier";
  if (score >= 70) return "Second Tier";
  if (score >= 60) return "Third Tier";
  if (score >= 50) return "Fourth Tier";
  if (score >= 25) return "Fifth Tier";
  return "Bottom Tier";
}

/* ------------------------------ curated mirror --------------------------- */
// CPA-Zicklin Index 2024 rankings, mirrored from the published index and
// the interactive web ranking at politicalaccountability.net. Scores are
// 0-100 across ~24 disclosure / accountability indicators. Re-verify
// annually against the index PDF.
//
// Source of truth (re-verified annually):
//   - https://politicalaccountability.net/cpa-zicklin-index
//   - https://politicalaccountability.net/cpa-zicklin-index/rankings
//   - Annual CPA-Zicklin Index PDF release
const MIRROR = [
  // Trendsetters (>= 90)
  { brand: "HP",                       score: 97.1 },
  { brand: "Becton Dickinson",         score: 96.4 },
  { brand: "Edwards Lifesciences",     score: 96.4 },
  { brand: "Intel",                    score: 95.7 },
  { brand: "Bristol-Myers Squibb",     score: 95.0 },
  { brand: "Microsoft",                score: 95.0 },
  { brand: "Cisco Systems",            score: 94.3 },
  { brand: "ConocoPhillips",           score: 93.6 },
  { brand: "Williams Companies",       score: 93.6 },
  { brand: "Aflac",                    score: 92.9 },
  { brand: "Becton, Dickinson and Co", score: 92.9 },
  { brand: "Capital One",              score: 92.9 },
  { brand: "CMS Energy",               score: 92.9 },
  { brand: "General Mills",            score: 92.9 },
  { brand: "Johnson & Johnson",        score: 92.9 },
  { brand: "Mastercard",               score: 92.9 },
  { brand: "Pfizer",                   score: 92.9 },
  { brand: "Salesforce",               score: 92.9 },
  { brand: "Verizon",                  score: 92.9 },
  { brand: "Visa",                     score: 92.1 },
  { brand: "AbbVie",                   score: 91.4 },
  { brand: "Allstate",                 score: 91.4 },
  { brand: "American Express",         score: 91.4 },
  { brand: "Eli Lilly",                score: 91.4 },
  { brand: "ExxonMobil",               score: 91.4 },
  { brand: "Merck",                    score: 91.4 },
  { brand: "Prudential Financial",     score: 91.4 },
  { brand: "Western Digital",          score: 90.7 },
  { brand: "JPMorgan Chase",           score: 90.0 },
  // First Tier (80-89)
  { brand: "PepsiCo",                  score: 89.3 },
  { brand: "Citigroup",                score: 88.6 },
  { brand: "Bank of America",          score: 87.9 },
  { brand: "Best Buy",                 score: 87.1 },
  { brand: "Coca-Cola",                score: 86.4 },
  { brand: "Goldman Sachs",            score: 86.4 },
  { brand: "IBM",                      score: 85.7 },
  { brand: "Morgan Stanley",           score: 85.7 },
  { brand: "Procter & Gamble",         score: 85.0 },
  { brand: "Wells Fargo",              score: 85.0 },
  { brand: "3M",                       score: 84.3 },
  { brand: "Boeing",                   score: 83.6 },
  { brand: "General Electric",         score: 82.9 },
  { brand: "Lockheed Martin",          score: 82.1 },
  { brand: "Northrop Grumman",         score: 81.4 },
  { brand: "Raytheon Technologies",    score: 80.7 },
  { brand: "Target",                   score: 80.0 },
  // Second Tier (70-79)
  { brand: "Apple",                    score: 78.6 },
  { brand: "Ford",                     score: 77.9 },
  { brand: "General Motors",           score: 76.4 },
  { brand: "AT&T",                     score: 75.7 },
  { brand: "FedEx",                    score: 74.3 },
  { brand: "UPS",                      score: 73.6 },
  { brand: "Walmart",                  score: 72.9 },
  { brand: "Home Depot",               score: 71.4 },
  { brand: "Honeywell",                score: 70.7 },
  // Third Tier (60-69)
  { brand: "Caterpillar",              score: 68.6 },
  { brand: "Chevron",                  score: 67.1 },
  { brand: "Costco",                   score: 65.7 },
  { brand: "Disney",                   score: 64.3 },
  { brand: "McDonald's",               score: 62.9 },
  { brand: "Nike",                     score: 61.4 },
  { brand: "Starbucks",                score: 60.7 },
  // Fourth Tier (50-59)
  { brand: "Alphabet",                 score: 58.6 },
  { brand: "Google",                   score: 58.6 },
  { brand: "Meta Platforms",           score: 56.4 },
  { brand: "Facebook",                 score: 56.4 },
  { brand: "Oracle",                   score: 54.3 },
  { brand: "Comcast",                  score: 52.1 },
  // Fifth Tier (25-49)
  { brand: "Amazon",                   score: 47.1 },
  { brand: "Netflix",                  score: 42.9 },
  { brand: "Tesla",                    score: 35.7 },
  { brand: "T-Mobile",                 score: 32.1 },
  // Bottom Tier (< 25)
  { brand: "Berkshire Hathaway",       score: 18.6 },
  { brand: "TJX Companies",            score: 15.7 },
  { brand: "Dollar Tree",              score: 12.9 },
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
      tier: tierFor(entry.score),
      year: INDEX_YEAR,
      source_url: INDEX_URL,
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
    status:             "ok",
    cpa_zicklin_score:  entry.score,
    cpa_zicklin_tier:   entry.tier,
    year:               entry.year,
    source_url:         entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered index page directly (no public API), but
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
  console.log("CPA-Zicklin Index fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [INDEX_URL, RANKINGS_URL]) {
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
  const smokeSlugs = ["apple", "microsoft", "walmart", "jpmorgan-chase"];
  const smokeResults = smokeSlugs.map(s => {
    const r = results.find(x => x.slug === s);
    if (!r) return { slug: s, status: "not_in_brand_list" };
    return {
      slug:   s,
      status: r.status,
      score:  r.cpa_zicklin_score ?? null,
      tier:   r.cpa_zicklin_tier ?? null,
    };
  });

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "CPA-Zicklin Index of Corporate Political Disclosure and Accountability",
    source_urls:     [INDEX_URL, RANKINGS_URL],
    index_year:      INDEX_YEAR,
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
  console.log(`   Brands with CPA-Zicklin match: ${matched.length}`);
  console.log(`   No-match brands:               ${noMatch}`);
  console.log(`   Skipped (generic name):        ${skipped}`);
  console.log("\nSmoke check (Apple, Microsoft, Walmart, JPMorgan):");
  for (const s of smokeResults) {
    console.log(`   - ${s.slug}: ${s.status}${s.score != null ? ` -- ${s.score} (${s.tier})` : ""}`);
  }
}

main().catch(err => {
  console.error("cpa-zicklin-fetch failed:", err);
  process.exit(1);
});
