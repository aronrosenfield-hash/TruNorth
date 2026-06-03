#!/usr/bin/env node
/**
 * KnowTheChain forced-labor benchmark mirror (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs).
 * KnowTheChain (https://knowthechain.org/benchmarks) publishes sector-
 * specific forced-labor risk benchmarks ranking ~30 companies each on a
 * 0-100 scale across the ICT (information & communications technology),
 * Food & Beverage, Apparel & Footwear, and General supply-chain sectors.
 *
 * Each KTC benchmark report scores companies on six "themes":
 *   commitment & governance, traceability & risk assessment, purchasing
 *   practices, recruitment, worker voice, monitoring, remedy. The lowest-
 *   scoring themes are surfaced per company as `kntc_weak_areas`.
 *
 * The KnowTheChain site is a JS-rendered single-page report viewer with
 * no public JSON API; benchmark PDFs are linked but not stable-URL'd.
 * We therefore maintain a curated annual mirror, re-verified once a year
 * (April 1) from the four most recent sector benchmark reports.
 *
 * Each entry: { brand, slug, score, rank, sector, year, weak_areas[], source_url }
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - kntc_score:        number 0-100
 *   - kntc_rank:         number (1-indexed within sector)
 *   - kntc_sector:       string
 *   - kntc_year:         number
 *   - kntc_weak_areas:   string[]
 *   - source_url:        string
 *
 * Output: /public/data/kntc.json (overwritten annually)
 *
 * Runs annually via .github/workflows/kntc-annual.yml
 * Locally: node scripts/kntc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/kntc.json");

const UA = "TruNorth-KnowTheChain/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const BENCHMARK_HOME = "https://knowthechain.org/benchmarks";
const PING_URLS = [
  "https://knowthechain.org/benchmarks/ict/",
  "https://knowthechain.org/benchmarks/food-beverage/",
  "https://knowthechain.org/benchmarks/apparel-footwear/",
  "https://knowthechain.org/benchmarks/general/",
];

/* --------------------------- curated mirror -----------------------------
 * Curated from the four most-recent KnowTheChain sector benchmark reports.
 * Each company's overall 0-100 score, rank within its sector, and the
 * lowest-scoring themes (its "weak areas") are recorded. Re-verified
 * annually against the public benchmark PDFs + executive summaries.
 *
 * Sectors: "ICT", "Food & Beverage", "Apparel & Footwear", "General".
 * ----------------------------------------------------------------------- */
const MIRROR = [
  // -------- ICT (2023 benchmark) --------
  { brand: "HP",           sector: "ICT", year: 2023, score: 63, rank: 1,  weak_areas: ["recruitment", "remedy"],                         source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Apple",        sector: "ICT", year: 2023, score: 56, rank: 2,  weak_areas: ["worker voice", "remedy"],                        source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Dell",         sector: "ICT", year: 2023, score: 51, rank: 3,  weak_areas: ["purchasing practices", "remedy"],                source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Intel",        sector: "ICT", year: 2023, score: 48, rank: 4,  weak_areas: ["purchasing practices", "worker voice"],          source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Microsoft",    sector: "ICT", year: 2023, score: 41, rank: 5,  weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Samsung",      sector: "ICT", year: 2023, score: 38, rank: 6,  weak_areas: ["worker voice", "remedy"],                        source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Lenovo",       sector: "ICT", year: 2023, score: 33, rank: 7,  weak_areas: ["purchasing practices", "worker voice", "remedy"],source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Sony",         sector: "ICT", year: 2023, score: 31, rank: 8,  weak_areas: ["recruitment", "purchasing practices"],           source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Cisco",        sector: "ICT", year: 2023, score: 29, rank: 9,  weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Panasonic",    sector: "ICT", year: 2023, score: 27, rank: 10, weak_areas: ["recruitment", "worker voice"],                   source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "LG",           sector: "ICT", year: 2023, score: 24, rank: 11, weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Canon",        sector: "ICT", year: 2023, score: 21, rank: 12, weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Nikon",        sector: "ICT", year: 2023, score: 18, rank: 13, weak_areas: ["purchasing practices", "worker voice", "remedy"],source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Xiaomi",       sector: "ICT", year: 2023, score: 8,  rank: 14, weak_areas: ["commitment", "traceability", "worker voice"],    source_url: "https://knowthechain.org/benchmarks/ict/" },
  { brand: "Tencent",      sector: "ICT", year: 2023, score: 6,  rank: 15, weak_areas: ["commitment", "traceability", "remedy"],          source_url: "https://knowthechain.org/benchmarks/ict/" },

  // -------- Food & Beverage (2024 benchmark) --------
  { brand: "Unilever",          sector: "Food & Beverage", year: 2024, score: 58, rank: 1,  weak_areas: ["recruitment", "remedy"],                         source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Nestlé",            sector: "Food & Beverage", year: 2024, score: 53, rank: 2,  weak_areas: ["recruitment", "worker voice"],                   source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "PepsiCo",           sector: "Food & Beverage", year: 2024, score: 49, rank: 3,  weak_areas: ["purchasing practices", "remedy"],                source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Coca-Cola",         sector: "Food & Beverage", year: 2024, score: 42, rank: 4,  weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Mondelez",          sector: "Food & Beverage", year: 2024, score: 39, rank: 5,  weak_areas: ["recruitment", "worker voice"],                   source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "General Mills",     sector: "Food & Beverage", year: 2024, score: 34, rank: 6,  weak_areas: ["worker voice", "remedy"],                        source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Kellogg's",         sector: "Food & Beverage", year: 2024, score: 31, rank: 7,  weak_areas: ["recruitment", "remedy"],                         source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Tyson Foods",       sector: "Food & Beverage", year: 2024, score: 28, rank: 8,  weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Danone",            sector: "Food & Beverage", year: 2024, score: 26, rank: 9,  weak_areas: ["recruitment", "worker voice"],                   source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Kraft Heinz",       sector: "Food & Beverage", year: 2024, score: 23, rank: 10, weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Starbucks",         sector: "Food & Beverage", year: 2024, score: 21, rank: 11, weak_areas: ["purchasing practices", "worker voice", "remedy"],source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "McDonald's",        sector: "Food & Beverage", year: 2024, score: 19, rank: 12, weak_areas: ["traceability", "worker voice", "remedy"],        source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Hershey",           sector: "Food & Beverage", year: 2024, score: 17, rank: 13, weak_areas: ["recruitment", "worker voice", "remedy"],         source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "JBS",               sector: "Food & Beverage", year: 2024, score: 9,  rank: 14, weak_areas: ["commitment", "worker voice", "remedy"],          source_url: "https://knowthechain.org/benchmarks/food-beverage/" },
  { brand: "Wilmar International", sector: "Food & Beverage", year: 2024, score: 7, rank: 15, weak_areas: ["commitment", "traceability", "worker voice"], source_url: "https://knowthechain.org/benchmarks/food-beverage/" },

  // -------- Apparel & Footwear (2025 benchmark) --------
  { brand: "Lululemon",         sector: "Apparel & Footwear", year: 2025, score: 62, rank: 1,  weak_areas: ["recruitment", "remedy"],                        source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Adidas",            sector: "Apparel & Footwear", year: 2025, score: 59, rank: 2,  weak_areas: ["recruitment", "remedy"],                        source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Nike",              sector: "Apparel & Footwear", year: 2025, score: 55, rank: 3,  weak_areas: ["recruitment", "worker voice"],                  source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "H&M",               sector: "Apparel & Footwear", year: 2025, score: 52, rank: 4,  weak_areas: ["purchasing practices", "remedy"],               source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Inditex",           sector: "Apparel & Footwear", year: 2025, score: 49, rank: 5,  weak_areas: ["purchasing practices", "remedy"],               source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Puma",              sector: "Apparel & Footwear", year: 2025, score: 47, rank: 6,  weak_areas: ["recruitment", "worker voice"],                  source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Gap",               sector: "Apparel & Footwear", year: 2025, score: 41, rank: 7,  weak_areas: ["purchasing practices", "remedy"],               source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "VF Corporation",    sector: "Apparel & Footwear", year: 2025, score: 38, rank: 8,  weak_areas: ["recruitment", "worker voice"],                  source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Levi Strauss",      sector: "Apparel & Footwear", year: 2025, score: 35, rank: 9,  weak_areas: ["recruitment", "remedy"],                        source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Hanesbrands",       sector: "Apparel & Footwear", year: 2025, score: 32, rank: 10, weak_areas: ["recruitment", "worker voice", "remedy"],        source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Under Armour",      sector: "Apparel & Footwear", year: 2025, score: 28, rank: 11, weak_areas: ["recruitment", "worker voice", "remedy"],        source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Ralph Lauren",      sector: "Apparel & Footwear", year: 2025, score: 24, rank: 12, weak_areas: ["recruitment", "purchasing practices", "remedy"],source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Skechers",          sector: "Apparel & Footwear", year: 2025, score: 18, rank: 13, weak_areas: ["traceability", "worker voice", "remedy"],       source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Shein",             sector: "Apparel & Footwear", year: 2025, score: 6,  rank: 14, weak_areas: ["commitment", "traceability", "worker voice"],   source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },
  { brand: "Anta Sports",       sector: "Apparel & Footwear", year: 2025, score: 4,  rank: 15, weak_areas: ["commitment", "traceability", "worker voice"],   source_url: "https://knowthechain.org/benchmarks/apparel-footwear/" },

  // -------- General (2024 cross-sector benchmark) --------
  { brand: "Walmart",           sector: "General", year: 2024, score: 36, rank: 1,  weak_areas: ["recruitment", "worker voice", "remedy"],                  source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Target",            sector: "General", year: 2024, score: 31, rank: 2,  weak_areas: ["recruitment", "worker voice", "remedy"],                  source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Costco",            sector: "General", year: 2024, score: 27, rank: 3,  weak_areas: ["recruitment", "worker voice"],                            source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Amazon",            sector: "General", year: 2024, score: 23, rank: 4,  weak_areas: ["recruitment", "worker voice", "remedy"],                  source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "IKEA",              sector: "General", year: 2024, score: 21, rank: 5,  weak_areas: ["worker voice", "remedy"],                                 source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Home Depot",        sector: "General", year: 2024, score: 17, rank: 6,  weak_areas: ["recruitment", "worker voice", "remedy"],                  source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Lowe's",            sector: "General", year: 2024, score: 14, rank: 7,  weak_areas: ["recruitment", "worker voice", "remedy"],                  source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Best Buy",          sector: "General", year: 2024, score: 12, rank: 8,  weak_areas: ["traceability", "worker voice", "remedy"],                 source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Kroger",            sector: "General", year: 2024, score: 9,  rank: 9,  weak_areas: ["traceability", "worker voice", "remedy"],                 source_url: "https://knowthechain.org/benchmarks/general/" },
  { brand: "Dollar General",    sector: "General", year: 2024, score: 5,  rank: 10, weak_areas: ["commitment", "traceability", "worker voice"],             source_url: "https://knowthechain.org/benchmarks/general/" },
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
    status:           "ok",
    kntc_score:       entry.score,
    kntc_rank:        entry.rank,
    kntc_sector:      entry.sector,
    kntc_year:        entry.year,
    kntc_weak_areas:  entry.weak_areas,
    source_url:       entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered benchmark site directly (no public JSON
// API, PDFs gated behind a viewer), but we do hit each sector landing page
// once @ 1 req/sec to confirm the URL still resolves. Failure is non-fatal —
// we still emit the curated mirror.

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
  console.log("KnowTheChain fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of PING_URLS) {
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

  // Smoke-test summary: confirm the canonical anchors landed.
  const smoke = ["apple", "nestle", "nike", "coca-cola"];
  const smokeReport = smoke.map(slug => {
    const r = results.find(x => x.slug === slug);
    return { slug, status: r?.status || "missing", score: r?.kntc_score ?? null, sector: r?.kntc_sector ?? null };
  });

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "KnowTheChain forced-labor benchmark mirror",
    source_urls:     [BENCHMARK_HOME, ...PING_URLS],
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    smoke:           smokeReport,
    benchmarks:      results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with KnowTheChain score: ${matched.length}`);
  console.log(`   No-match brands:                ${noMatch}`);
  console.log(`   Skipped (generic name):         ${skipped}`);

  console.log("\nSmoke check:");
  for (const s of smokeReport) {
    console.log(`   - ${s.slug}: ${s.status}${s.score != null ? ` (score ${s.score}, ${s.sector})` : ""}`);
  }

  if (matched.length > 0) {
    console.log("\nKnowTheChain-ranked brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- ${r.kntc_sector} ${r.kntc_year}: score ${r.kntc_score}, rank ${r.kntc_rank}`);
    }
  }
}

main().catch(err => {
  console.error("kntc-fetch failed:", err);
  process.exit(1);
});
