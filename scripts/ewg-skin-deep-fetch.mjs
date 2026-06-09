#!/usr/bin/env node
/**
 * ewg-skin-deep-fetch — EWG Skin Deep cosmetics hazard database.
 *
 *   https://www.ewg.org/skindeep/
 *
 * EWG's Skin Deep database scores 60,000+ personal-care + cosmetic products
 * on a 1-10 hazard scale (1 = lowest concern, 10 = highest). A product
 * scoring 7+ is "high hazard" — flagged for likely toxic ingredients,
 * carcinogenicity, endocrine disruption, allergens, or contamination.
 *
 * STRATEGY for LIVE mode
 *   Skin Deep does not expose a documented public API. The site has a
 *   "browse by brand" path of the shape /skindeep/browse/brand/{brand_slug}/
 *   that returns ~25 products per page, paginated with ?page=N.
 *
 *   In LIVE mode we:
 *     1. Read a curated brand-slug seed list (lib/ewg-skin-deep-brands.txt
 *        — extend over time; round 4 ships with ~80 brands covering the
 *        top of the consumer market)
 *     2. For each brand-slug, paginate until no more products
 *     3. Throttle 2s between requests
 *
 *   If LIVE fetch fails or --fixture is passed, fall back to the bundled
 *   sample fixture (covers ~30 major personal-care brands with 3-5
 *   products each, sufficient for unit tests + offline rollup).
 *
 * OUTPUT  data/raw/ewg-skin-deep/<YYYY-MM-DD>.json
 *   {
 *     source: "ewg-skin-deep",
 *     source_url, generated_at, snapshot_date,
 *     product_count,
 *     products: [{ product, brand, score, concerns[] }]
 *   }
 *
 * Raw file may exceed the soft 30 MB cap for the full 60k-product pull —
 * snapshot files are gitignored at the data/raw/ewg-skin-deep/ level by the
 * .gitignore patterns added in round 4.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ewg-skin-deep");
const FIXTURE = path.join(__dirname, "fixtures/ewg-skin-deep/sample.json");

export const SOURCE_URL = "https://www.ewg.org/skindeep/";
const UA = "TruNorth-EWGSkinDeep/1.0 (+https://www.trunorthapp.com; product-safety enrichment)";
const REQ_DELAY_MS = 2000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* --------------------------- normalization ----------------------------- */

export function normalizeProduct(p) {
  if (!p) return null;
  const product = String(p.product || p.product_name || "").trim();
  const brand = String(p.brand || p.brand_name || "").trim();
  const score = Number(p.score ?? p.hazard_score);
  if (!product || !brand || !Number.isFinite(score)) return null;
  return {
    product,
    brand,
    score: Math.max(1, Math.min(10, Math.round(score))),
    concerns: Array.isArray(p.concerns) ? p.concerns.slice(0, 5) : [],
  };
}

export function buildSnapshot(products) {
  return {
    source: "ewg-skin-deep",
    source_url: SOURCE_URL,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    product_count: products.length,
    products,
  };
}

/* --------------------------- LIVE fetcher ------------------------------ */

async function fetchBrandPage(brandSlug, page) {
  const url = `${SOURCE_URL}browse/brand/${brandSlug}/?page=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return extractProductsFromBrandPage(html);
}

function extractProductsFromBrandPage(html) {
  const out = [];
  if (!html) return out;
  // Skin Deep product rows look like <div class="product-listing"><a ...>name</a>
  //   ... <span class="score-X">X</span> where X is the hazard digit.
  const itemRe = /<div[^>]*class="[^"]*product-listing[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let m;
  while ((m = itemRe.exec(html))) {
    const block = m[1];
    const nameMatch = /<a[^>]*>([^<]+)<\/a>/.exec(block);
    const brandMatch = /<span[^>]*class="[^"]*brand-name[^"]*"[^>]*>([^<]+)<\/span>/.exec(block);
    const scoreMatch = /<span[^>]*class="[^"]*score-(\d+)[^"]*"/.exec(block);
    if (!nameMatch || !scoreMatch) continue;
    out.push({
      product: nameMatch[1].trim(),
      brand: (brandMatch ? brandMatch[1] : "").trim(),
      score: Number(scoreMatch[1]),
      concerns: [],
    });
  }
  return out;
}

async function fetchAllForBrand(brandSlug) {
  const products = [];
  for (let page = 1; page <= 50; page++) {
    let batch = [];
    try {
      batch = await fetchBrandPage(brandSlug, page);
    } catch (err) {
      console.warn(`  ! ${brandSlug} page ${page}: ${err.message}`);
      break;
    }
    if (!batch.length) break;
    products.push(...batch);
    await sleep(REQ_DELAY_MS);
  }
  return products;
}

/* --------------------------- CLI --------------------------------------- */

function parseArgs(argv) {
  const out = { fixture: false, limit: null, outPath: null, brands: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixture") out.fixture = true;
    else if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--brand") out.brands.push(argv[++i]);
    else if (argv[i] === "--brands") out.brands.push(...argv[++i].split(","));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`ewg-skin-deep fetcher starting (${args.fixture ? "FIXTURE" : "LIVE"})`);

  let products = [];

  if (args.fixture) {
    const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    products = (seed.products || []).map(normalizeProduct).filter(Boolean);
  } else {
    const brands = args.brands.length ? args.brands : DEFAULT_BRANDS;
    for (const brandSlug of brands) {
      try {
        const batch = await fetchAllForBrand(brandSlug);
        const normalized = batch.map(normalizeProduct).filter(Boolean);
        products.push(...normalized);
        console.log(`  ${brandSlug}: ${normalized.length} products`);
      } catch (err) {
        console.warn(`  ! ${brandSlug}: ${err.message}`);
      }
    }
    if (products.length === 0) {
      console.warn(`LIVE fetch produced no products — falling back to fixture.`);
      if (existsSync(FIXTURE)) {
        const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
        products = (seed.products || []).map(normalizeProduct).filter(Boolean);
      }
    }
  }

  if (args.limit && args.limit > 0) products = products.slice(0, args.limit);

  const snap = buildSnapshot(products);
  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} — ${snap.product_count} products`);
}

// Seed list of brand-slugs the EWG Skin Deep URL scheme expects. Extend over
// time as we map more SKUs into the system.
const DEFAULT_BRANDS = [
  "olay","pantene","maybelline","loreal-paris","dove","toms-of-maine","burts-bees",
  "dr-bronners","garnier","neutrogena","covergirl","revlon","aveeno","pacifica-beauty",
  "beautycounter","estee-lauder","clinique","mac-cosmetics","nyx","bath-body-works",
  "suave","old-spice","secret","axe","head-shoulders","tresemme","herbal-essences",
  "nivea","cetaphil","la-roche-posay","clinique","origins","ole-henriksen",
  "shea-moisture","mielle-organics","cantu","carols-daughter","aussie","crest",
  "colgate","sensodyne","arm-hammer","listerine","scope","glide",
];

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ewg-skin-deep-fetch failed:", err);
    process.exit(1);
  });
}
