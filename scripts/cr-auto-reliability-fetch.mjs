#!/usr/bin/env node
/**
 * Consumer Reports — Annual Auto Brand Report Card.
 *
 * CR publishes an annual brand-level vehicle quality ranking combining:
 *   - Road-test scores
 *   - Predicted reliability (from ~330k member surveys / yr)
 *   - Owner-satisfaction survey
 *   - Safety ratings (NHTSA + IIHS overlay)
 *
 * The full numerical scores live behind CR's paywall but the brand ORDER
 * is reported in every major auto outlet's coverage of the press release
 * each December. That ordinal ranking is the source we use.
 *
 * STRATEGY
 *   The 2026 Brand Report Card was released December 2025 by Consumer
 *   Reports' press office:
 *     https://www.consumerreports.org/media-room/press-releases/2025/12/
 *       consumer-reports-releases-its-2026-automotive-brand-report-card-...
 *
 *   We hand-seed the published top-25 overall ranking AND the separate
 *   reliability ranking. The fetcher's job is to:
 *     1. Download the press release page.
 *     2. Verify each brand still appears in the text (catches turnover).
 *     3. Write the seeded record + verification status to raw.
 *
 *   When CR updates the report card next December, bump SEED_YEAR and
 *   replace SEED_RANKING / SEED_RELIABILITY.
 *
 * OUTPUT
 *   data/raw/cr-auto-reliability/<YYYY-MM-DD>.json
 *
 * Locally:
 *   node scripts/cr-auto-reliability-fetch.mjs
 *   node scripts/cr-auto-reliability-fetch.mjs --fixture
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/cr-auto-reliability");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/cr-auto-reliability");

export const SEED_YEAR = 2026; // Report Card "2026" was published December 2025.
export const PRESS_RELEASE_URL =
  "https://www.consumerreports.org/media-room/press-releases/2025/12/consumer-reports-releases-its-2026-automotive-brand-report-card-the-comprehensive-analysis-of-vehicle-quality-to-help-guide-car-shoppers-amid-steep-prices/";
export const LANDING_URL =
  "https://www.consumerreports.org/cars/car-reliability-owner-satisfaction/";

const UA = "TruNorth-CR/1.0 (+https://www.trunorthapp.com; public-records pipeline)";
const FIXTURE_MODE = process.argv.includes("--fixture");

/**
 * 2026 CR Brand Report Card OVERALL ranking (top 25), per CR's
 * December 2025 press release. Position 1 = best.
 */
// Brand → TruNorth slug. Most auto brands carry the `-usa` suffix
// (toyota-usa, honda-usa, etc.) for the consumer-facing US entity.
// Resolution ladder in merge step also tries the bare slug as a parent fallback.
export const SEED_RANKING = [
  { rank:  1, brand: "Subaru",        slugKey: "subaru-usa" },
  { rank:  2, brand: "BMW",           slugKey: "bmw-usa" },
  { rank:  3, brand: "Porsche",       slugKey: "porsche" },
  { rank:  4, brand: "Honda",         slugKey: "honda-motor-co" },
  { rank:  5, brand: "Toyota",        slugKey: "toyota-usa" },
  { rank:  6, brand: "Lexus",         slugKey: "lexus-usa" },
  { rank:  7, brand: "Lincoln",       slugKey: "lincoln-ford" },
  { rank:  8, brand: "Hyundai",       slugKey: "hyundai-usa" },
  { rank:  9, brand: "Acura",         slugKey: "acura-usa" },
  { rank: 10, brand: "Tesla",         slugKey: "tesla" },
  // Mid-pack (per published coverage; CR groups 11-20 without strict order
  // beyond mentioning movers like Audi -10 → 16).
  { rank: 11, brand: "Mazda",         slugKey: "mazda" },
  { rank: 12, brand: "Kia",           slugKey: "kia-usa" },
  { rank: 13, brand: "Buick",         slugKey: "buick" },
  { rank: 14, brand: "Mercedes-Benz", slugKey: "mercedes-benz-usa" },
  { rank: 15, brand: "Genesis",       slugKey: "genesis" },
  { rank: 16, brand: "Audi",          slugKey: "audi-usa" },
  { rank: 17, brand: "Volvo",         slugKey: "volvo" },
  { rank: 18, brand: "Ford",          slugKey: "ford" },
  { rank: 19, brand: "Cadillac",      slugKey: "cadillac" },
  { rank: 20, brand: "Volkswagen",    slugKey: "volkswagen-usa" },
  { rank: 21, brand: "Chevrolet",     slugKey: "chevrolet" },
  // Bottom-5 (CR press release explicitly names these as last):
  { rank: 22, brand: "Dodge",         slugKey: "dodge" },
  { rank: 23, brand: "GMC",           slugKey: "gmc" },
  { rank: 24, brand: "Land Rover",    slugKey: "land-rover" },
  { rank: 25, brand: "Rivian",        slugKey: "rivian-automotive" },
  { rank: 26, brand: "Jeep",          slugKey: "jeep" },
];

/** Top-10 reliability-only ranking, per CR. */
export const SEED_RELIABILITY = [
  { rank: 1,  brand: "Toyota",  slugKey: "toyota-usa" },
  { rank: 2,  brand: "Subaru",  slugKey: "subaru-usa" },
  { rank: 3,  brand: "Lexus",   slugKey: "lexus-usa" },
  { rank: 4,  brand: "Honda",   slugKey: "honda-motor-co" },
  { rank: 5,  brand: "BMW",     slugKey: "bmw-usa" },
  { rank: 6,  brand: "Nissan",  slugKey: "nissan-technical-center-north-america" },
  { rank: 7,  brand: "Acura",   slugKey: "acura-usa" },
  { rank: 8,  brand: "Kia",     slugKey: "kia-usa" },
  { rank: 9,  brand: "Buick",   slugKey: "buick" },
  { rank: 10, brand: "Tesla",   slugKey: "tesla" },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPageText(url) {
  if (FIXTURE_MODE) {
    const fx = path.join(FIXTURE_DIR, "sample.html");
    if (!existsSync(fx)) return { ok: true, text: "" };
    return { ok: true, text: await fs.readFile(fx, "utf-8") };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      if (!res.ok) {
        if (res.status >= 500 && attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        return { ok: false, text: "", blocker: `http_${res.status}` };
      }
      return { ok: true, text: await res.text() };
    } catch (err) {
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
      return { ok: false, text: "", blocker: `network:${err.message}` };
    }
  }
  return { ok: false, text: "", blocker: "exhausted_retries" };
}

export function verifyBrand(text, brand) {
  if (!text) return false;
  // Word-boundary, case-insensitive. Mercedes-Benz needs escaping.
  const safe = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${safe}\\b`, "i").test(text);
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  console.log(`[cr] fetching ${FIXTURE_MODE ? "fixture" : PRESS_RELEASE_URL}`);
  const { ok, text, blocker } = await fetchPageText(PRESS_RELEASE_URL);
  if (!ok) {
    console.warn(`[cr] WARN: ${blocker} — proceeding with seed only`);
  }

  let verifiedOverall = 0, missingOverall = 0;
  const overall = SEED_RANKING.map(b => {
    const ver = ok ? verifyBrand(text, b.brand) : false;
    if (ver) verifiedOverall++; else missingOverall++;
    return { ...b, verified: ver };
  });

  let verifiedRel = 0;
  const reliability = SEED_RELIABILITY.map(b => {
    const ver = ok ? verifyBrand(text, b.brand) : false;
    if (ver) verifiedRel++;
    return { ...b, verified: ver };
  });

  const today = new Date().toISOString().slice(0, 10);
  const out = {
    _license: "Consumer Reports — press release citation",
    _source: "cr-auto-reliability",
    _source_url: PRESS_RELEASE_URL,
    _landing_url: LANDING_URL,
    _seed_year: SEED_YEAR,
    _generated_at: new Date().toISOString(),
    _stats: {
      overall_total: SEED_RANKING.length,
      overall_verified: verifiedOverall,
      reliability_total: SEED_RELIABILITY.length,
      reliability_verified: verifiedRel,
      fetch_ok: ok,
    },
    overall,
    reliability,
  };
  const outPath = path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`[cr] wrote ${outPath} — overall ${verifiedOverall}/${SEED_RANKING.length} verified, reliability ${verifiedRel}/${SEED_RELIABILITY.length} verified`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
