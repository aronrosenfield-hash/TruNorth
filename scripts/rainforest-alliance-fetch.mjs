#!/usr/bin/env node
/**
 * Rainforest Alliance — certified-companies directory (quarterly) — B-data7.
 *
 *   https://www.rainforest-alliance.org/find-certified/
 *
 * The Rainforest Alliance "Find Certified" directory lists producers AND
 * retail brands whose supply chains meet the Sustainable Agriculture
 * Standard. We focus on the brand/company surface — the producer side is
 * upstream of consumer-facing TruNorth slugs.
 *
 * STRATEGY
 *   1. Paginated grid of <article class="ra-company-card"> entries.
 *   2. Each card has: company name, 1..N product tags, optional cert-since
 *      date. We dedupe across pages by company name.
 *   3. Permissive regex; tolerates <article|li|div> wrappers.
 *
 * DRY-RUN
 *   --dry (default) and --fixture both skip network calls. Set --live to
 *   actually scrape — guarded explicitly so worktree agents never hit it.
 *
 * THROTTLE / POLITENESS
 *   - 2 req/sec (REQ_DELAY_MS = 2000)
 *   - Honest UA identifying TruNorth + this pipeline
 *   - Retry on 5xx with exponential backoff (3 tries)
 *
 * OUTPUT
 *   public/data/_raw/rainforest-alliance.json
 *   {
 *     generated_at,
 *     source_url,
 *     brand_count,
 *     certified_brands: [{ brand, products: ["coffee","chocolate"], certification_date? }]
 *   }
 *
 * Runs quarterly via .github/workflows/sustainability-certs-quarterly.yml.
 *
 * Locally:
 *   node scripts/rainforest-alliance-fetch.mjs              # dry-run
 *   node scripts/rainforest-alliance-fetch.mjs --fixture    # use fixture HTML
 *   node scripts/rainforest-alliance-fetch.mjs --live       # live scrape (CI only)
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "public/data/_raw");
const OUT_FILE    = path.join(RAW_DIR, "rainforest-alliance.json");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/sustainability-certs");

const RA_BASE = "https://www.rainforest-alliance.org";
const RA_PATH = "/find-certified/";
const REQ_DELAY_MS = 2000;
const MAX_PAGES = 80;
const UA = "TruNorth-RainforestAlliance/1.0 (+https://www.trunorthapp.com; data pipeline for sustainability-certification transparency)";

const FIXTURE_MODE = process.argv.includes("--fixture");
const LIVE_MODE    = process.argv.includes("--live");
const DRY_MODE     = !FIXTURE_MODE && !LIVE_MODE;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------ fetcher --------------------------------- */

async function fetchText(url, attempt = 0) {
  if (FIXTURE_MODE) {
    const m = url.match(/[?&]page=(\d+)/);
    const page = m ? m[1] : "1";
    const candidate = path.join(FIXTURE_DIR, `rainforest-alliance-page-${page}.html`);
    if (existsSync(candidate)) return fs.readFile(candidate, "utf-8");
    return "";
  }
  if (DRY_MODE) return "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    if (res.status >= 500 && attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

/* ------------------------------- parser --------------------------------- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å",
  iacute: "í", oacute: "ó", ouml: "ö", uacute: "ú", uuml: "ü",
  ntilde: "ñ", ccedil: "ç",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", trade: "™", reg: "®", copy: "©",
};

function decode(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

function stripTags(s) {
  return decode(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function normalizeDate(s) {
  if (!s) return null;
  const trimmed = String(s).trim();
  let mm = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mm) return `${mm[1]}-${mm[2]}-${mm[3]}`;
  mm = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mm) {
    const months = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
    const mo = months[mm[1].toLowerCase().slice(0,3)];
    if (mo) return `${mm[3]}-${mo}-${String(mm[2]).padStart(2,"0")}`;
  }
  mm = trimmed.match(/^(\d{4})$/);
  if (mm) return `${mm[1]}-01-01`;
  return null;
}

// Same canonical product map as Fair Trade — keep downstream consumers
// blissfully ignorant of which feed each tag came from.
const PRODUCT_CANONICAL = {
  "coffee": "coffee",
  "cocoa": "chocolate",
  "chocolate": "chocolate",
  "tea": "tea",
  "sugar": "sugar",
  "bananas": "bananas",
  "banana": "bananas",
  "pineapple": "pineapple",
  "cotton": "cotton",
  "palm oil": "palm_oil",
  "palm": "palm_oil",
  "spices": "spices",
  "vanilla": "vanilla",
  "hazelnut": "hazelnut",
  "hazelnuts": "hazelnut",
  "honey": "honey",
};

function canonProduct(raw) {
  const k = String(raw || "").trim().toLowerCase();
  return PRODUCT_CANONICAL[k] || k.replace(/\s+/g, "_") || null;
}

export function parseRainforestAlliancePage(html) {
  if (!html) return [];

  const items = [];
  const blockRe = /<(article|li|div)\b[^>]*class="(?:[^"]*\s)?(?:ra-company-card|ra-result-card|ra-brand-card)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];

    let brand = "";
    const nameMatch =
      inner.match(/<(?:h\d|a|span)[^>]*class="[^"]*\bra-company-name\b[^"]*"[^>]*>([\s\S]*?)<\/(?:h\d|a|span)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    // Strip "Inc.", "Incorporated", "Ltd.", "Limited", trailing commas — keep
    // the canonical brand name. (E.g. "Mars, Incorporated" → "Mars")
    brand = brand
      .replace(/,?\s*(Incorporated|Inc\.?|Ltd\.?|Limited|LLC|N\.V\.|S\.A\.|GmbH|PLC|Corp\.?|Corporation)\s*$/i, "")
      .trim();

    const products = [];
    const tagRe = /<(?:li|span|a)[^>]*class="[^"]*\bra-tag\b[^"]*"[^>]*>([\s\S]*?)<\/(?:li|span|a)>/gi;
    let tm;
    while ((tm = tagRe.exec(inner)) !== null) {
      const raw = stripTags(tm[1]);
      const c = canonProduct(raw);
      if (c && !products.includes(c)) products.push(c);
    }

    let certification_date = null;
    const dateMatch =
      inner.match(/<[^>]*class="[^"]*\bra-cert-since\b[^"]*"[^>]*>([\s\S]*?)<\//i)
      || inner.match(/(?:certified\s*since|certification\s*date)\s*[:\-]?\s*([A-Za-z0-9 ,\-\/]+)/i);
    if (dateMatch) {
      const raw = stripTags(dateMatch[1]).replace(/^(?:certified\s*since|certification\s*date)\s*[:\-]?\s*/i, "").trim();
      certification_date = normalizeDate(raw) || (raw || null);
    }

    items.push({ brand, products, certification_date });
  }

  const byKey = new Map();
  for (const it of items) {
    const k = it.brand.toLowerCase();
    if (!byKey.has(k)) { byKey.set(k, it); continue; }
    const prev = byKey.get(k);
    for (const p of it.products) if (!prev.products.includes(p)) prev.products.push(p);
    if (!prev.certification_date && it.certification_date) prev.certification_date = it.certification_date;
  }
  return [...byKey.values()];
}

export function hasNextPage(html) {
  if (!html) return false;
  return /class="[^"]*ra-pagination-next[^"]*"/i.test(html);
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`Rainforest Alliance fetcher starting (mode=${LIVE_MODE ? "live" : FIXTURE_MODE ? "fixture" : "dry"})...`);

  if (DRY_MODE) {
    console.log("DRY-RUN: skipping network. Use --fixture to test parsers, --live to scrape upstream.");
    console.log("No output file written.");
    return;
  }

  const allBrands = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${RA_BASE}${RA_PATH}?page=${page}`;
    let html = "";
    try { html = await fetchText(url); }
    catch (err) {
      console.error(`  [page ${page}] fetch failed: ${err.message}`);
      break;
    }
    const items = parseRainforestAlliancePage(html);
    console.log(`  [page ${page}] ${items.length} brands`);

    for (const it of items) {
      const k = it.brand.toLowerCase();
      if (!allBrands.has(k)) { allBrands.set(k, it); continue; }
      const prev = allBrands.get(k);
      for (const p of it.products) if (!prev.products.includes(p)) prev.products.push(p);
      if (!prev.certification_date && it.certification_date) prev.certification_date = it.certification_date;
    }

    if (!hasNextPage(html) || items.length === 0) break;
    if (!FIXTURE_MODE) await sleep(REQ_DELAY_MS);
  }

  const certified_brands = [...allBrands.values()].sort((a, b) => a.brand.localeCompare(b.brand));

  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_url: `${RA_BASE}${RA_PATH}`,
    brand_count: certified_brands.length,
    certified_brands,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE} (${certified_brands.length} brands)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("rainforest-alliance-fetch failed:", err);
    process.exit(1);
  });
}
