#!/usr/bin/env node
/**
 * ewg-food-fetch — EWG Food Scores database.
 *
 *   https://www.ewg.org/foodscores/
 *
 * Scores 80,000+ packaged foods on a 1-10 scale combining nutrition,
 * ingredient concerns (artificial additives, residues, contaminants), and
 * degree of processing. Lower = better. A score of 7+ is flagged as
 * high-concern.
 *
 * Architecturally identical to ewg-skin-deep-fetch.mjs — separate scripts
 * because the URL scheme + downstream category routing differ.
 *
 * LIVE strategy: hit /foodscores/products?brand=<brand-slug>&page=N until
 * empty. Throttle 2s. Identifying UA.
 *
 * FLAGS: --fixture / --limit / --out / --brand / --brands
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ewg-food");
const FIXTURE = path.join(__dirname, "fixtures/ewg-food/sample.json");

export const SOURCE_URL = "https://www.ewg.org/foodscores/";
const UA = "TruNorth-EWGFood/1.0 (+https://www.trunorthapp.com; product-safety enrichment)";
const REQ_DELAY_MS = 2000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function normalizeProduct(p) {
  if (!p) return null;
  const product = String(p.product || p.product_name || "").trim();
  const brand = String(p.brand || p.brand_name || "").trim();
  const score = Number(p.score ?? p.food_score);
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
    source: "ewg-food",
    source_url: SOURCE_URL,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    product_count: products.length,
    products,
  };
}

async function fetchBrandPage(brandSlug, page) {
  const url = `${SOURCE_URL}products/?brand=${encodeURIComponent(brandSlug)}&page=${page}`;
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
  const itemRe = /<div[^>]*class="[^"]*product-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let m;
  while ((m = itemRe.exec(html))) {
    const block = m[1];
    const nameMatch = /<a[^>]*>([^<]+)<\/a>/.exec(block);
    const brandMatch = /<span[^>]*class="[^"]*brand[^"]*"[^>]*>([^<]+)<\/span>/.exec(block);
    const scoreMatch = /data-score="(\d+)"|class="[^"]*score-(\d+)/.exec(block);
    if (!nameMatch || !scoreMatch) continue;
    out.push({
      product: nameMatch[1].trim(),
      brand: (brandMatch ? brandMatch[1] : "").trim(),
      score: Number(scoreMatch[1] || scoreMatch[2]),
      concerns: [],
    });
  }
  return out;
}

async function fetchAllForBrand(brandSlug) {
  const products = [];
  for (let page = 1; page <= 100; page++) {
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

const DEFAULT_BRANDS = [
  "lays","doritos","cheetos","annies","amys-kitchen","kraft","oscar-mayer",
  "kelloggs","general-mills","nature-valley","larabar","clif-bar","rxbar",
  "coca-cola","pepsi","lacroix","stonyfield","chobani","yoplait",
  "hot-pockets","digiorno","hellmanns","heinz","campbells","kashi",
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`ewg-food fetcher starting (${args.fixture ? "FIXTURE" : "LIVE"})`);

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
    if (!products.length) {
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

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ewg-food-fetch failed:", err);
    process.exit(1);
  });
}
