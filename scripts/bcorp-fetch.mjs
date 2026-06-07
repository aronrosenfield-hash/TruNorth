#!/usr/bin/env node
/**
 * B Lab — Certified B Corporation directory (quarterly) — B-data5.
 *
 *   https://www.bcorporation.net/find-a-b-corp/
 *
 * B Lab's "Find a B Corp" directory lists every Certified B Corporation
 * (~7,800 globally). Each entry has a name, country, industry, certification
 * date, an Overall Impact Score (0–200), and five sub-category scores:
 * Community, Customers, Environment, Governance, Workers.
 *
 * STRATEGY
 *   1. The directory is a paginated server-rendered listing. We page from
 *      ?page=1 forward until pagination-next disappears or page yields zero
 *      results.
 *   2. B Lab does not publish a stable public JSON dump. We parse the HTML
 *      permissively (regex; no cheerio dependency — consistent with
 *      leaping-bunny-fetch.mjs / ca-ag-fetch.mjs).
 *   3. We tolerate three template variants the site has used:
 *      <li class="bcorp-entry">, <div class="bcorp-entry">, <tr class="bcorp-entry">.
 *   4. Each HTML page is cached to public/data/_cache/bcorp/page-NN.html so a
 *      partial run can be resumed without re-hitting B Lab.
 *
 * THROTTLE / POLITENESS
 *   - 2 req/sec (REQ_DELAY_MS = 2000) — B Lab is a nonprofit
 *   - Honest UA identifying TruNorth + this pipeline
 *   - Retry on 5xx with exponential backoff (3 tries)
 *   - --dry default: NO live network calls; reads fixtures only
 *
 * OUTPUT
 *   public/data/_raw/bcorp.json
 *   {
 *     generated_at, source_url, brand_count,
 *     certified_brands: [{
 *       brand, country, industry, certification_date,
 *       overall_score, scores: { community, customers, environment, governance, workers },
 *       recertification_due
 *     }]
 *   }
 *
 * Runs quarterly via .github/workflows/bcorp-quarterly.yml (15 Mar/Jun/Sep/Dec).
 *
 * Locally:
 *   node scripts/bcorp-fetch.mjs              # DRY (fixtures only — default)
 *   node scripts/bcorp-fetch.mjs --live       # live scrape (CI only)
 *   node scripts/bcorp-fetch.mjs --fixture    # alias for --dry
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR   = path.join(ROOT, "public/data/_raw");
const OUT_FILE  = path.join(RAW_DIR, "bcorp.json");
const CACHE_DIR = path.join(ROOT, "public/data/_cache/bcorp");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/bcorp");

const BCORP_BASE = "https://www.bcorporation.net";
const BCORP_PATH = "/find-a-b-corp/";
const REQ_DELAY_MS = 2000;
const UA = "TruNorth-BCorp/1.0 (+https://www.trunorthapp.com; data pipeline for B Corp certification transparency)";

// DRY default. --live opts into network calls; --fixture is an alias for dry.
const LIVE_MODE = process.argv.includes("--live");
const DRY_MODE  = !LIVE_MODE; // default DRY

const MAX_PAGES = 400; // ~7,800 brands at ~20/page → ~390 pages, +headroom

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchPageHtml(pageNum) {
  if (DRY_MODE) {
    const fx = path.join(FIXTURE_DIR, `bcorp-page-${pageNum}.html`);
    if (existsSync(fx)) return fs.readFile(fx, "utf-8");
    return ""; // no more fixtures → stops the loop
  }
  // live: cache-first
  const cacheFile = path.join(CACHE_DIR, `page-${String(pageNum).padStart(3, "0")}.html`);
  if (existsSync(cacheFile)) {
    return fs.readFile(cacheFile, "utf-8");
  }
  const url = `${BCORP_BASE}${BCORP_PATH}?page=${pageNum}`;
  const html = await fetchTextWithRetry(url);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, html);
  return html;
}

async function fetchTextWithRetry(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    if (res.status >= 500 && attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchTextWithRetry(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchTextWithRetry(url, attempt + 1);
    }
    throw err;
  }
}

/* ------------------------------- parser --------------------------------- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ntilde: "ñ", ccedil: "ç", szlig: "ß",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…",
  ndash: "–", mdash: "—", trade: "™", reg: "®", copy: "©",
};

function decode(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

function stripTags(s) {
  return decode(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function pickClassValue(inner, cls) {
  // Match <ANYTAG class="...cls...">VALUE</ANYTAG>
  const re = new RegExp(
    `<[a-z0-9]+\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[a-z0-9]+>`,
    "i"
  );
  const m = inner.match(re);
  return m ? stripTags(m[1]) : null;
}

function toNumber(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let mm = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mm) return `${mm[1]}-${mm[2]}-${mm[3]}`;
  mm = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mm) {
    const months = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
    const mo = months[mm[1].toLowerCase().slice(0,3)];
    if (mo) return `${mm[3]}-${mo}-${String(mm[2]).padStart(2,"0")}`;
  }
  mm = t.match(/^(\d{4})$/);
  if (mm) return `${mm[1]}-01-01`;
  return null;
}

// Each directory row is rendered as one of:
//   <li class="bcorp-entry">…</li>
//   <div class="bcorp-entry">…</div>
//   <tr class="bcorp-entry">…</tr>
export function parseBcorpPage(html) {
  if (!html) return [];
  const out = [];
  const blockRe = /<(li|div|tr)\b[^>]*class="(?:[^"]*\s)?bcorp-entry(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];

    // Brand name
    let brand = pickClassValue(inner, "bcorp-name");
    if (!brand) {
      // fallback: first anchor
      const a = inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
      if (a) brand = stripTags(a[1]);
    }
    if (!brand) continue;

    const country  = pickClassValue(inner, "bcorp-country") || null;
    const industry = pickClassValue(inner, "bcorp-industry") || null;
    const certRaw  = pickClassValue(inner, "bcorp-certification-date");
    const recRaw   = pickClassValue(inner, "bcorp-recertification-due");

    const certification_date = certRaw ? (normalizeDate(certRaw) || certRaw) : null;
    const recertification_due = recRaw ? (normalizeDate(recRaw) || recRaw) : null;

    const overall_score = toNumber(pickClassValue(inner, "bcorp-overall-score"));
    const scores = {
      community:   toNumber(pickClassValue(inner, "bcorp-score-community")),
      customers:   toNumber(pickClassValue(inner, "bcorp-score-customers")),
      environment: toNumber(pickClassValue(inner, "bcorp-score-environment")),
      governance:  toNumber(pickClassValue(inner, "bcorp-score-governance")),
      workers:     toNumber(pickClassValue(inner, "bcorp-score-workers")),
    };

    out.push({
      brand,
      country,
      industry,
      certification_date,
      overall_score,
      scores,
      recertification_due,
    });
  }

  // Dedupe per page on brand+country.
  const seen = new Set();
  const dedup = [];
  for (const it of out) {
    const k = `${it.brand.toLowerCase()}|${(it.country || "").toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(it);
  }
  return dedup;
}

function hasNextPage(html) {
  return /class="[^"]*\bpagination-next\b[^"]*"/i.test(html);
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`B Corp fetcher starting (mode=${DRY_MODE ? "DRY" : "LIVE"})...`);

  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let html = "";
    try { html = await fetchPageHtml(page); }
    catch (err) {
      console.error(`  [page ${page}] fetch failed: ${err.message}`);
      break;
    }
    if (!html) {
      console.log(`  [page ${page}] empty/missing → stop`);
      break;
    }
    const items = parseBcorpPage(html);
    console.log(`  [page ${page}] ${items.length} entries`);
    all.push(...items);

    // Stop if no entries AND no Next link (defensive against template changes)
    if (items.length === 0 && !hasNextPage(html)) break;
    // Stop on last page (no Next link).
    if (!hasNextPage(html)) {
      console.log(`  [page ${page}] no pagination-next → last page`);
      break;
    }
    if (!DRY_MODE) await sleep(REQ_DELAY_MS);
  }

  // Cross-page dedupe
  const byKey = new Map();
  for (const it of all) {
    const k = `${it.brand.toLowerCase()}|${(it.country || "").toLowerCase()}`;
    if (!byKey.has(k)) byKey.set(k, it);
  }
  const certified_brands = [...byKey.values()].sort((a, b) => a.brand.localeCompare(b.brand));

  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_url: `${BCORP_BASE}${BCORP_PATH}`,
    brand_count: certified_brands.length,
    mode: DRY_MODE ? "dry" : "live",
    certified_brands,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE} (${certified_brands.length} brands)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("bcorp-fetch failed:", err);
    process.exit(1);
  });
}
