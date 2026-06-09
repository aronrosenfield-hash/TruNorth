#!/usr/bin/env node
/**
 * product-safety-deep-fetch — Round-4 multi-source product safety / ingredient
 * certification fleet.
 *
 * Consolidates positive-signal certification directories from sources whose
 * brand lists are public but small enough that one fetcher is enough:
 *
 *   - EWG VERIFIED Mark              https://www.ewg.org/ewgverified/
 *   - Made Safe Certified            https://madesafe.org/pages/products
 *   - Good Housekeeping Seal         https://www.goodhousekeeping.com/institute/about-the-institute/a22148/about-good-housekeeping-seal/
 *   - GoodGuide (archived)           https://web.archive.org/web/2021*\/goodguide.com (historical brand scores)
 *   - NSF International              https://info.nsf.org/Certified/Listings.asp
 *   - GREENGUARD (UL low-VOC)        https://spot.ul.com/greenguard/
 *   - WaterSense Product Search      https://www.epa.gov/watersense/product-search
 *   - Certified Vegan (vegan.org)    https://vegan.org/certification/
 *   - Vegan Society Trademark        https://www.vegansociety.com/the-vegan-trademark/trademark-holders
 *
 * EWG Skin Deep (cosmetics) and EWG Food Scores get their own fetchers
 * (ewg-skin-deep-fetch / ewg-food-fetch) because the per-product datasets
 * are large enough to warrant separate raw stores + per-brand rollups.
 *
 * SHAPE — output is a uniform record stream so the merger can route every
 * record through one alias index:
 *
 *   {
 *     source: "ewg-verified" | "made-safe" | ...
 *     brand:  "Beautycounter",
 *     product_count?: 92,        // verified-mark product tally
 *     avg_score?: 8.2,           // GoodGuide-style 1-10 (higher = better)
 *     source_url: "https://...",
 *   }
 *
 * STRATEGY for LIVE mode
 *   Each source has a public brand directory page (HTML). We fetch each
 *   page with a polite 2s delay + identifying UA. Parse is permissive
 *   regex (no cheerio — same convention as ca-ag / leaping-bunny).
 *
 *   If LIVE fetch fails or --fixture is passed, fall back to the bundled
 *   sample so the rest of the pipeline can run in dev / CI.
 *
 * FLAGS
 *   --fixture   read scripts/fixtures/product-safety-deep/sample.json
 *   --limit N   cap records per source
 *   --out PATH  override default raw path
 *   --sources csv  comma-separated source allowlist (default: all)
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/product-safety-deep");
const FIXTURE = path.join(__dirname, "fixtures/product-safety-deep/sample.json");

const SOURCE_URLS = {
  "ewg-verified":           "https://www.ewg.org/ewgverified/",
  "made-safe":              "https://madesafe.org/pages/products",
  "good-housekeeping-seal": "https://www.goodhousekeeping.com/institute/about-the-institute/a22148/about-good-housekeeping-seal/",
  "goodguide":              "https://web.archive.org/web/2021*/goodguide.com",
  "nsf":                    "https://info.nsf.org/Certified/Listings.asp",
  "greenguard":             "https://spot.ul.com/greenguard/",
  "watersense":             "https://www.epa.gov/watersense/product-search",
  "vegan-org":              "https://vegan.org/certification/",
  "vegan-society":          "https://www.vegansociety.com/the-vegan-trademark/trademark-holders",
};

const ALL_SOURCES = Object.keys(SOURCE_URLS);

const UA = "TruNorth-ProductSafetyDeep/1.0 (+https://www.trunorthapp.com; positive-signal certification aggregation)";
const REQ_DELAY_MS = 2000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* --------------------------- normalization ----------------------------- */

export function normalizeRecord(raw) {
  if (!raw) return null;
  const source = String(raw.source || "").trim().toLowerCase();
  const brand = String(raw.brand || raw.brand_name || raw.name || "").trim();
  if (!source || !brand) return null;
  const out = {
    source,
    brand,
    source_url: SOURCE_URLS[source] || raw.source_url || "",
  };
  if (raw.product_count != null) out.product_count = Number(raw.product_count) || 0;
  if (raw.avg_score != null) {
    const n = Number(raw.avg_score);
    if (Number.isFinite(n)) out.avg_score = n;
  }
  return out;
}

export function buildSnapshot(records, opts = {}) {
  const recordsByBrand = new Map();
  for (const r of records) {
    const key = `${r.source}::${r.brand.toLowerCase()}`;
    const prev = recordsByBrand.get(key);
    if (!prev) recordsByBrand.set(key, r);
    else if ((r.product_count || 0) > (prev.product_count || 0)) recordsByBrand.set(key, r);
  }
  const dedup = [...recordsByBrand.values()];
  const sourceCounts = {};
  for (const r of dedup) {
    sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
  }
  return {
    source: "product-safety-deep",
    generated_at: new Date().toISOString(),
    snapshot_date: opts.snapshot_date || todayUTC(),
    source_urls: SOURCE_URLS,
    source_counts: sourceCounts,
    total_record_count: dedup.length,
    records: dedup,
  };
}

/* --------------------------- fetching ---------------------------------- */

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Very small permissive extractor — pulls brand names from anchor tags on
 * the certification directory pages. Each source has its own template so we
 * key off either a known wrapper class or fall back to all <a>s under a
 * "brands" / "trademark-holders" heading.
 *
 * This is intentionally lenient: the merger does the actual brand→slug
 * matching, so over-collecting here just creates orphans, not bad merges.
 */
function extractBrandsFromHtml(source, html) {
  const out = [];
  if (!html) return out;

  // Common patterns across the 9 sites — each item looks like
  // <a class="brand-card">Name</a> or <li class="trademark-holder">Name</li>.
  const patterns = [
    /<a[^>]*class="[^"]*(?:brand|holder|certif|verified)[^"]*"[^>]*>([^<]+)<\/a>/gi,
    /<li[^>]*class="[^"]*(?:brand|holder|certif|verified)[^"]*"[^>]*>([^<]+)<\/li>/gi,
    /<div[^>]*class="[^"]*(?:brand-name|company-name)[^"]*"[^>]*>([^<]+)<\/div>/gi,
    /<h[1-6][^>]*class="[^"]*(?:brand|product-brand)[^"]*"[^>]*>([^<]+)<\/h[1-6]>/gi,
  ];
  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) {
      const brand = m[1].replace(/&amp;/g, "&").replace(/&#039;/g, "'").trim();
      if (brand.length < 2 || brand.length > 80) continue;
      const key = brand.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source, brand });
    }
  }
  return out;
}

async function fetchSource(source) {
  const url = SOURCE_URLS[source];
  if (!url) return [];
  try {
    const html = await fetchHtml(url);
    const brands = extractBrandsFromHtml(source, html);
    return brands;
  } catch (err) {
    console.warn(`  ! ${source}: ${err.message}`);
    return [];
  }
}

/* --------------------------- CLI --------------------------------------- */

function parseArgs(argv) {
  const out = { fixture: false, limit: null, outPath: null, sources: ALL_SOURCES.slice() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixture") out.fixture = true;
    else if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--sources") {
      out.sources = argv[++i].split(",").map(s => s.trim()).filter(s => ALL_SOURCES.includes(s));
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`product-safety-deep fetcher starting (${args.fixture ? "FIXTURE" : "LIVE"}) — ${args.sources.length} sources`);

  let records = [];

  if (args.fixture) {
    if (!existsSync(FIXTURE)) {
      console.error(`Fixture not found: ${FIXTURE}`);
      process.exit(2);
    }
    const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    records = (seed.records || [])
      .filter(r => args.sources.includes(r.source))
      .map(normalizeRecord)
      .filter(Boolean);
  } else {
    for (const source of args.sources) {
      try {
        const fetched = await fetchSource(source);
        const normalized = fetched.map(normalizeRecord).filter(Boolean);
        records.push(...normalized);
        console.log(`  ${source}: ${normalized.length} brand records`);
      } catch (err) {
        console.warn(`  ! ${source}: ${err.message}`);
      }
      await sleep(REQ_DELAY_MS);
    }
    if (records.length === 0) {
      console.warn(`LIVE fetch produced no records — falling back to fixture.`);
      if (existsSync(FIXTURE)) {
        const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
        records = (seed.records || [])
          .filter(r => args.sources.includes(r.source))
          .map(normalizeRecord)
          .filter(Boolean);
      }
    }
  }

  if (args.limit && args.limit > 0) records = records.slice(0, args.limit);

  const snap = buildSnapshot(records);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} — ${snap.total_record_count} records across ${Object.keys(snap.source_counts).length} sources`);
  for (const [s, n] of Object.entries(snap.source_counts)) console.log(`  · ${s}: ${n}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("product-safety-deep-fetch failed:", err);
    process.exit(1);
  });
}
