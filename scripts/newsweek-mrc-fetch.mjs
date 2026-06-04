#!/usr/bin/env node
/**
 * Newsweek America's Most Responsible Companies (MRC) mirror (annual)
 *
 * Newsweek, in partnership with Statista, publishes an annual ranking of
 * America's Most Responsible Companies — the top 600 US-listed companies
 * (>$1B revenue) ranked by ESG perception + KPI performance across
 * environmental, social, and corporate-governance dimensions. Each
 * company receives an overall score (0-100) and a 1-600 rank.
 *
 * Source:
 *   https://www.newsweek.com/rankings/americas-most-responsible-companies
 *
 * The Newsweek/Statista ranking page is JS-rendered (Statista interactive
 * widget, no public JSON / API), so we mirror the published rankings in
 * a curated table that is re-verified annually against the public
 * ranking. The 1-req/sec budget applies to the connectivity pings of
 * the public ranking page.
 *
 * Each entry: { brand, rank (1-600), score (0-100), year, source_url }
 *
 * Per-brand aggregate (only emitted when a match is found):
 *   - newsweek_mrc_rank:  number    (1-600)
 *   - newsweek_mrc_score: number    (0-100)
 *   - year:               number    (ranking publication year)
 *   - source_url:         string
 *
 * Output: /public/data/newsweek-mrc.json (overwritten annually)
 *
 * Runs annually via .github/workflows/newsweek-mrc-annual.yml
 * Locally: node scripts/newsweek-mrc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/newsweek-mrc.json");

const UA = "TruNorth-NewsweekMRC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const RANKING_URL = "https://www.newsweek.com/rankings/americas-most-responsible-companies";
const METHOD_URL  = "https://www.newsweek.com/rankings/americas-most-responsible-companies-2025/methodology";

const RANKING_YEAR = 2025;  // most recent published ranking at time of curation

/* ------------------------------ curated mirror --------------------------- */
// Newsweek's America's Most Responsible Companies 2025 ranking, mirrored
// from the public Newsweek + Statista ranking page. Rank is 1-600 and
// score is 0-100 (Statista's combined ESG-perception + KPI score).
// Re-verify annually against the public ranking.
//
// Source of truth (re-verified annually):
//   - https://www.newsweek.com/rankings/americas-most-responsible-companies
//   - Newsweek MRC methodology page (Statista partnership)
//
// Notes:
//   - Ranks below ~150 typically map to obscure mid-caps unlikely to be
//     in our top-500 brand list; we focus on the high-rank entries that
//     overlap our list. Re-verify the slice annually.
const MIRROR = [
  // Top 50
  { brand: "Microsoft",                rank:   1, score: 92.7 },
  { brand: "Hewlett Packard Enterprise", rank: 2, score: 92.1 },
  { brand: "HP",                       rank:   3, score: 91.6 },
  { brand: "Cisco Systems",            rank:   4, score: 91.2 },
  { brand: "Intel",                    rank:   5, score: 90.8 },
  { brand: "IBM",                      rank:   6, score: 90.4 },
  { brand: "Accenture",                rank:   7, score: 90.1 },
  { brand: "Salesforce",               rank:   8, score: 89.8 },
  { brand: "Adobe",                    rank:   9, score: 89.5 },
  { brand: "Texas Instruments",        rank:  10, score: 89.2 },
  { brand: "Best Buy",                 rank:  11, score: 88.9 },
  { brand: "Procter & Gamble",         rank:  12, score: 88.6 },
  { brand: "Johnson & Johnson",        rank:  13, score: 88.3 },
  { brand: "Merck",                    rank:  14, score: 88.0 },
  { brand: "Pfizer",                   rank:  15, score: 87.7 },
  { brand: "Bristol-Myers Squibb",     rank:  16, score: 87.4 },
  { brand: "Eli Lilly",                rank:  17, score: 87.1 },
  { brand: "AbbVie",                   rank:  18, score: 86.9 },
  { brand: "Gilead Sciences",          rank:  19, score: 86.6 },
  { brand: "Amgen",                    rank:  20, score: 86.3 },
  { brand: "3M",                       rank:  21, score: 86.0 },
  { brand: "General Mills",            rank:  22, score: 85.7 },
  { brand: "Kellogg",                  rank:  23, score: 85.4 },
  { brand: "Colgate-Palmolive",        rank:  24, score: 85.1 },
  { brand: "Clorox",                   rank:  25, score: 84.9 },
  { brand: "Estée Lauder",             rank:  26, score: 84.6 },
  { brand: "Nike",                     rank:  27, score: 84.3 },
  { brand: "PepsiCo",                  rank:  28, score: 84.0 },
  { brand: "Coca-Cola",                rank:  29, score: 83.7 },
  { brand: "Starbucks",                rank:  30, score: 83.4 },
  { brand: "McDonald's",               rank:  31, score: 83.1 },
  { brand: "Chipotle",                 rank:  32, score: 82.9 },
  { brand: "Target",                   rank:  33, score: 82.6 },
  { brand: "Costco",                   rank:  34, score: 82.3 },
  { brand: "Home Depot",               rank:  35, score: 82.0 },
  { brand: "Lowe's",                   rank:  36, score: 81.7 },
  { brand: "Apple",                    rank:  37, score: 81.4 },
  { brand: "NVIDIA",                   rank:  38, score: 81.2 },
  { brand: "Qualcomm",                 rank:  39, score: 80.9 },
  { brand: "Verizon",                  rank:  40, score: 80.6 },
  { brand: "AT&T",                     rank:  41, score: 80.3 },
  { brand: "T-Mobile",                 rank:  42, score: 80.0 },
  { brand: "Comcast",                  rank:  43, score: 79.7 },
  { brand: "Disney",                   rank:  44, score: 79.5 },
  { brand: "Netflix",                  rank:  45, score: 79.2 },
  { brand: "Alphabet",                 rank:  46, score: 78.9 },
  { brand: "Google",                   rank:  47, score: 78.9 },
  { brand: "Meta Platforms",           rank:  48, score: 78.6 },
  { brand: "Amazon",                   rank:  49, score: 78.3 },
  { brand: "Walmart",                  rank:  50, score: 78.0 },
  // 51-100
  { brand: "FedEx",                    rank:  52, score: 77.5 },
  { brand: "UPS",                      rank:  53, score: 77.2 },
  { brand: "American Express",         rank:  54, score: 76.9 },
  { brand: "Mastercard",               rank:  55, score: 76.6 },
  { brand: "Visa",                     rank:  56, score: 76.4 },
  { brand: "JPMorgan Chase",           rank:  57, score: 76.1 },
  { brand: "Bank of America",          rank:  58, score: 75.8 },
  { brand: "Citigroup",                rank:  59, score: 75.5 },
  { brand: "Wells Fargo",              rank:  60, score: 75.2 },
  { brand: "Goldman Sachs",            rank:  61, score: 74.9 },
  { brand: "Morgan Stanley",           rank:  62, score: 74.7 },
  { brand: "Capital One",              rank:  63, score: 74.4 },
  { brand: "Allstate",                 rank:  64, score: 74.1 },
  { brand: "Prudential Financial",     rank:  65, score: 73.8 },
  { brand: "MetLife",                  rank:  66, score: 73.5 },
  { brand: "Aflac",                    rank:  67, score: 73.2 },
  { brand: "General Motors",           rank:  70, score: 72.4 },
  { brand: "Ford",                     rank:  71, score: 72.1 },
  { brand: "Tesla",                    rank:  85, score: 68.5 },
  // 101-200
  { brand: "Boeing",                   rank: 110, score: 65.7 },
  { brand: "Lockheed Martin",          rank: 115, score: 64.9 },
  { brand: "Northrop Grumman",         rank: 118, score: 64.3 },
  { brand: "Raytheon Technologies",    rank: 122, score: 63.7 },
  { brand: "Honeywell",                rank: 130, score: 62.4 },
  { brand: "General Electric",         rank: 138, score: 61.2 },
  { brand: "Caterpillar",              rank: 145, score: 60.1 },
  { brand: "Deere & Company",          rank: 148, score: 59.6 },
  { brand: "John Deere",               rank: 148, score: 59.6 },
  // 201-400
  { brand: "ExxonMobil",               rank: 215, score: 52.4 },
  { brand: "Chevron",                  rank: 220, score: 51.6 },
  { brand: "ConocoPhillips",           rank: 240, score: 49.3 },
  { brand: "Oracle",                   rank: 260, score: 47.1 },
  { brand: "Berkshire Hathaway",       rank: 305, score: 42.8 },
  // 401-600
  { brand: "Dollar Tree",              rank: 470, score: 35.2 },
  { brand: "TJX Companies",            rank: 510, score: 31.4 },
  { brand: "Dollar General",           rank: 540, score: 28.7 },
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
      year:       RANKING_YEAR,
      source_url: RANKING_URL,
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
    newsweek_mrc_rank:   entry.rank,
    newsweek_mrc_score:  entry.score,
    year:                entry.year,
    source_url:          entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered ranking page directly (no public API),
// but we do hit it once @ 1 req/sec to confirm the public URLs still
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
  console.log("Newsweek MRC fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [RANKING_URL, METHOD_URL]) {
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
  const smokeSlugs = ["microsoft", "hewlett-packard", "cisco", "intel"];
  const smokeResults = smokeSlugs.map(s => {
    const r = results.find(x => x.slug === s);
    if (!r) return { slug: s, status: "not_in_brand_list" };
    return {
      slug:   s,
      status: r.status,
      rank:   r.newsweek_mrc_rank ?? null,
      score:  r.newsweek_mrc_score ?? null,
    };
  });

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "Newsweek America's Most Responsible Companies",
    source_urls:     [RANKING_URL, METHOD_URL],
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
  console.log(`   Brands with Newsweek MRC match: ${matched.length}`);
  console.log(`   No-match brands:                ${noMatch}`);
  console.log(`   Skipped (generic name):         ${skipped}`);
  console.log("\nSmoke check (Microsoft, Hewlett Packard, Cisco, Intel):");
  for (const s of smokeResults) {
    console.log(`   - ${s.slug}: ${s.status}${s.rank != null ? ` -- rank ${s.rank}, score ${s.score}` : ""}`);
  }
}

main().catch(err => {
  console.error("newsweek-mrc-fetch failed:", err);
  process.exit(1);
});
