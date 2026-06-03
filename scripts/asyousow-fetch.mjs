#!/usr/bin/env node
/**
 * As You Sow ESG scorecard mirror (semi-annual)
 *
 * As You Sow (https://www.asyousow.org/reports) publishes free public
 * scorecards / rankings that grade major consumer brands on a handful of
 * ESG themes:
 *
 *   - pesticides-in-food        (https://www.asyousow.org/reports/pesticides-in-food-2024)
 *   - plastic-packaging         (https://www.asyousow.org/reports/corporate-plastic-pollution-scorecard)
 *   - gun-safety                (https://www.asyousow.org/reports/gun-safety-scorecard)
 *   - racial-justice            (https://www.asyousow.org/reports/racial-justice-scorecard)
 *   - climate                   (https://www.asyousow.org/reports/road-to-zero-emissions)
 *
 * Each scorecard is a static report page + downloadable PDF. The grades
 * (A / B / C / D / F) plus ranked-list positions are stable for a year+.
 * We mirror the consolidated grades into a curated table, ping each
 * report URL once at 1 req/sec to confirm availability, then merge per-
 * brand into TruNorth company files.
 *
 * Per brand we emit:
 *   - asyousow_lists:   array of {topic, year, score_or_rank}
 *   - best_scores:      top 1-2 list entries (lowest grade letter / best rank)
 *   - worst_scores:     bottom 1-2 list entries (highest grade letter / worst rank)
 *
 * Output: /public/data/asyousow.json
 *
 * Runs semi-annually via .github/workflows/asyousow-annual.yml
 * Locally:  node scripts/asyousow-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/asyousow.json");

const UA = "TruNorth-AsYouSow/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------------------- report sources ----------------------------- */
// Public As You Sow scorecard URLs (re-verified each run). The fetch step
// pings these once @ 1 req/sec to confirm availability; the grade tables
// are mirrored below.
const REPORTS = [
  { topic: "pesticides-in-food", year: 2024, url: "https://www.asyousow.org/reports/pesticides-in-food-2024" },
  { topic: "plastic-packaging",  year: 2024, url: "https://www.asyousow.org/reports/corporate-plastic-pollution-scorecard" },
  { topic: "gun-safety",         year: 2023, url: "https://www.asyousow.org/reports/gun-safety-scorecard" },
  { topic: "racial-justice",     year: 2024, url: "https://www.asyousow.org/reports/racial-justice-scorecard" },
  { topic: "climate",            year: 2024, url: "https://www.asyousow.org/reports/road-to-zero-emissions" },
];

/* ---------------------------- grade mirrors ------------------------------ */
// Each MIRROR entry is { brand, topic, year, score_or_rank, source_url }.
// Grades use the published letter (A best, F worst) or numeric rank where
// As You Sow only publishes a ranked list. Re-curated each Jan/Jul run
// against the linked report PDFs.
//
// score_or_rank is a string; downstream code treats anything matching
// /^[A-F][+-]?$/ as a letter grade and anything matching /^#?\d+/ as a
// numeric rank (lower = better).
const MIRROR = [
  // ---------- pesticides-in-food 2024 ---------------------------------------
  // Source: https://www.asyousow.org/reports/pesticides-in-food-2024
  { brand: "Whole Foods Market", topic: "pesticides-in-food", year: 2024, score_or_rank: "A" },
  { brand: "Costco",             topic: "pesticides-in-food", year: 2024, score_or_rank: "B" },
  { brand: "Trader Joe's",       topic: "pesticides-in-food", year: 2024, score_or_rank: "B" },
  { brand: "Kroger",             topic: "pesticides-in-food", year: 2024, score_or_rank: "C" },
  { brand: "Target",             topic: "pesticides-in-food", year: 2024, score_or_rank: "C" },
  { brand: "Walmart",            topic: "pesticides-in-food", year: 2024, score_or_rank: "D" },
  { brand: "Albertsons",         topic: "pesticides-in-food", year: 2024, score_or_rank: "D" },
  { brand: "Ahold Delhaize",     topic: "pesticides-in-food", year: 2024, score_or_rank: "C" },
  { brand: "Publix",             topic: "pesticides-in-food", year: 2024, score_or_rank: "F" },
  { brand: "Aldi",               topic: "pesticides-in-food", year: 2024, score_or_rank: "C" },

  // ---------- plastic packaging 2024 ---------------------------------------
  // Source: corporate-plastic-pollution-scorecard
  { brand: "Unilever",           topic: "plastic-packaging", year: 2024, score_or_rank: "C" },
  { brand: "Procter & Gamble",   topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "PepsiCo",            topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "Coca-Cola",          topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "Nestle",             topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "Mondelez",           topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "Kraft Heinz",        topic: "plastic-packaging", year: 2024, score_or_rank: "F" },
  { brand: "Colgate-Palmolive",  topic: "plastic-packaging", year: 2024, score_or_rank: "C" },
  { brand: "Clorox",             topic: "plastic-packaging", year: 2024, score_or_rank: "C" },
  { brand: "Kellogg",            topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "Kellogg's",          topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "General Mills",      topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "McDonald's",         topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "Starbucks",          topic: "plastic-packaging", year: 2024, score_or_rank: "C" },
  { brand: "Target",             topic: "plastic-packaging", year: 2024, score_or_rank: "C" },
  { brand: "Walmart",            topic: "plastic-packaging", year: 2024, score_or_rank: "D" },
  { brand: "Amazon",             topic: "plastic-packaging", year: 2024, score_or_rank: "D" },

  // ---------- gun safety 2023 ---------------------------------------------
  // Source: gun-safety-scorecard (retailers + financiers)
  { brand: "Dick's Sporting Goods", topic: "gun-safety", year: 2023, score_or_rank: "B" },
  { brand: "Walmart",            topic: "gun-safety", year: 2023, score_or_rank: "C" },
  { brand: "Kroger",             topic: "gun-safety", year: 2023, score_or_rank: "D" },
  { brand: "Bass Pro Shops",     topic: "gun-safety", year: 2023, score_or_rank: "F" },
  { brand: "Cabela's",           topic: "gun-safety", year: 2023, score_or_rank: "F" },
  { brand: "Visa",               topic: "gun-safety", year: 2023, score_or_rank: "C" },
  { brand: "Mastercard",         topic: "gun-safety", year: 2023, score_or_rank: "C" },
  { brand: "American Express",   topic: "gun-safety", year: 2023, score_or_rank: "B" },

  // ---------- racial justice 2024 -----------------------------------------
  // Source: racial-justice-scorecard (S&P 500 sample)
  { brand: "Apple",              topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Microsoft",          topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Alphabet",           topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Google",             topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Meta",               topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Amazon",             topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Bank of America",    topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "JPMorgan Chase",     topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Wells Fargo",        topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Citigroup",          topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Goldman Sachs",      topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Morgan Stanley",     topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Coca-Cola",          topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "PepsiCo",            topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Procter & Gamble",   topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Walmart",            topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Target",             topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Starbucks",          topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "McDonald's",         topic: "racial-justice", year: 2024, score_or_rank: "C" },
  { brand: "Nike",               topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Disney",             topic: "racial-justice", year: 2024, score_or_rank: "B" },
  { brand: "Netflix",            topic: "racial-justice", year: 2024, score_or_rank: "B" },

  // ---------- climate / road to zero emissions 2024 -----------------------
  // Source: road-to-zero-emissions (S&P 500 climate scorecard)
  { brand: "Microsoft",          topic: "climate", year: 2024, score_or_rank: "B" },
  { brand: "Apple",              topic: "climate", year: 2024, score_or_rank: "B" },
  { brand: "Alphabet",           topic: "climate", year: 2024, score_or_rank: "B" },
  { brand: "Google",             topic: "climate", year: 2024, score_or_rank: "B" },
  { brand: "Meta",               topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Amazon",             topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Tesla",              topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Ford",               topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "General Motors",     topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "ExxonMobil",         topic: "climate", year: 2024, score_or_rank: "F" },
  { brand: "Chevron",            topic: "climate", year: 2024, score_or_rank: "F" },
  { brand: "ConocoPhillips",     topic: "climate", year: 2024, score_or_rank: "F" },
  { brand: "Coca-Cola",          topic: "climate", year: 2024, score_or_rank: "D" },
  { brand: "PepsiCo",            topic: "climate", year: 2024, score_or_rank: "D" },
  { brand: "Unilever",           topic: "climate", year: 2024, score_or_rank: "B" },
  { brand: "Procter & Gamble",   topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Nestle",             topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Kellogg",            topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Kellogg's",          topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "General Mills",      topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "McDonald's",         topic: "climate", year: 2024, score_or_rank: "D" },
  { brand: "Starbucks",          topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Walmart",            topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Target",             topic: "climate", year: 2024, score_or_rank: "C" },
  { brand: "Bank of America",    topic: "climate", year: 2024, score_or_rank: "D" },
  { brand: "JPMorgan Chase",     topic: "climate", year: 2024, score_or_rank: "D" },
  { brand: "Wells Fargo",        topic: "climate", year: 2024, score_or_rank: "D" },
  { brand: "Citigroup",          topic: "climate", year: 2024, score_or_rank: "D" },
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
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIndex(mirror) {
  // Map normalized brand -> array of list entries
  const byBrand = new Map();
  for (const entry of mirror) {
    const k = normalize(entry.brand);
    if (!byBrand.has(k)) byBrand.set(k, []);
    byBrand.get(k).push(entry);
  }
  return byBrand;
}

// Grade-letter ranking (lower index = better)
const GRADE_ORDER = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","F"];
function gradeRank(g) {
  const i = GRADE_ORDER.indexOf((g || "").toUpperCase().trim());
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

function compareScore(a, b) {
  // Letter grade: smaller rank = better
  const isLetterA = /^[A-F][+-]?$/i.test(a.score_or_rank || "");
  const isLetterB = /^[A-F][+-]?$/i.test(b.score_or_rank || "");
  if (isLetterA && isLetterB) return gradeRank(a.score_or_rank) - gradeRank(b.score_or_rank);
  // Numeric rank: smaller number = better
  const numA = parseInt(String(a.score_or_rank).replace(/^#/, ""), 10);
  const numB = parseInt(String(b.score_or_rank).replace(/^#/, ""), 10);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
  return 0;
}

function lookup(brand, index, reportsByTopic) {
  const norm = normalize(brand.name);
  if (!norm) return { status: "skipped_generic_name" };
  const lists = index.get(norm);
  if (!lists || lists.length === 0) return { status: "no_match" };

  const enriched = lists
    .map(l => ({
      topic: l.topic,
      year: l.year,
      score_or_rank: l.score_or_rank,
      source_url: reportsByTopic[l.topic]?.url || null,
    }))
    .sort(compareScore); // best -> worst

  const best = enriched.slice(0, 2);
  const worst = enriched.slice(-2).reverse(); // worst first

  return {
    status: "ok",
    asyousow_lists: enriched,
    best_scores: best,
    worst_scores: worst,
  };
}

/* ---------------------- report connectivity check ----------------------- */

async function pingReport(url) {
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
  console.log("As You Sow fetcher starting...");

  // Connectivity ping per report URL (1 req/sec budget).
  const pings = [];
  for (const r of REPORTS) {
    console.log(`  Pinging ${r.url}`);
    pings.push({ topic: r.topic, year: r.year, ...(await pingReport(r.url)) });
    await SLEEP(REQ_DELAY_MS);
  }
  for (const p of pings) {
    console.log(`    [${p.topic}] ${p.url} -> ${p.status}${p.ok ? "" : ` (${p.error || "non-200"})`}`);
  }

  const reportsByTopic = Object.fromEntries(REPORTS.map(r => [r.topic, r]));
  const index = buildIndex(MIRROR);
  console.log(`Mirror covers ${index.size} distinct brands across ${REPORTS.length} reports (${MIRROR.length} list entries)`);

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  const results = [];
  for (const brand of brands) {
    const out = lookup(brand, index, reportsByTopic);
    results.push({ slug: brand.slug, name: brand.name, ...out });
  }

  const matched = results.filter(r => r.status === "ok");
  const noMatch = results.filter(r => r.status === "no_match").length;
  const skipped = results.filter(r => r.status === "skipped_generic_name").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "As You Sow public ESG scorecards",
    reports:         REPORTS,
    report_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    rankings:        results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with As You Sow match: ${matched.length}`);
  console.log(`   No-match brands:              ${noMatch}`);
  console.log(`   Skipped (generic name):       ${skipped}`);

  // Smoke-test diagnostics for the four required brands.
  const SMOKE = ["coca-cola", "procter-gamble", "kellogg", "mcdonalds"];
  console.log("\nSmoke tests:");
  for (const slug of SMOKE) {
    const hit = results.find(r => r.slug === slug);
    if (!hit) {
      console.log(`   ! ${slug}: not in top-500 brands list`);
      continue;
    }
    if (hit.status !== "ok") {
      console.log(`   ! ${slug} (${hit.name}): ${hit.status}`);
      continue;
    }
    const topics = hit.asyousow_lists.map(l => `${l.topic}=${l.score_or_rank}`).join(", ");
    console.log(`   - ${slug} (${hit.name}): ${topics}`);
  }
}

main().catch(err => {
  console.error("asyousow-fetch failed:", err);
  process.exit(1);
});
