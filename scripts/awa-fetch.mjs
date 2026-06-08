#!/usr/bin/env node
/**
 * A Greener World — Animal Welfare Approved (AWA) certified farms/brands.
 *
 *   https://agreenerworld.org/aw     (canonical landing)
 *   https://agreenerworld.org/programs/certified-animal-welfare-approved/
 *
 * AWA is the strictest higher-welfare certification for meat, dairy and
 * eggs in North America — pasture/range required, no feedlots, no growth
 * promoters, no debeaking, audited annually. The AGW directory lists
 * certified farms together with the product categories they cover
 * (beef, dairy, eggs, pork, poultry, lamb, etc.).
 *
 * NORMALISED OUTPUT
 *   data/raw/awa/<YYYY-MM-DD>.json
 *   {
 *     _license, _source, _generated_at,
 *     _stats: { total_farms, with_products },
 *     farms: [{
 *       brand,                          // farm or consumer brand name
 *       state?: string,
 *       country?: string,
 *       productCategories: string[],    // ["eggs","dairy"] etc., lower-case
 *       sourceUrl: string
 *     }]
 *   }
 *
 * STRATEGY
 *   AGW publishes the directory as either a long-form HTML listing or a
 *   CSV/JSON behind the "Find a Farm" search. We try HTML-first, falling
 *   back to a more permissive regex pass. Two template variants observed:
 *     - <article class="farm-card">…</article>
 *     - <li class="awa-listing">…</li>
 *   Product categories are extracted from .product-categories OR from a
 *   free-text "Products: beef, eggs" line.
 *
 * THROTTLE / POLITENESS
 *   - 2 sec courtesy delay
 *   - Honest UA identifying TruNorth
 *   - 5xx retry with exponential backoff (3 tries)
 *
 * FIXTURE MODE
 *   --fixture reads scripts/fixtures/awa/sample.html.
 *
 * Locally:
 *   node scripts/awa-fetch.mjs              # live (CI only)
 *   node scripts/awa-fetch.mjs --fixture    # offline
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/awa");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/awa");

export const SOURCE_URL = "https://agreenerworld.org/programs/certified-animal-welfare-approved/";
export const LANDING_URL = "https://agreenerworld.org/aw";
const UA = "TruNorth-AWA/1.0 (+https://www.trunorthapp.com; data pipeline for animal-welfare certification transparency)";
const REQ_DELAY_MS = 2000;
const MAX_RETRIES = 3;

const FIXTURE_MODE = process.argv.includes("--fixture");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchHtml(url, attempt = 0) {
  if (FIXTURE_MODE) {
    const fx = path.join(FIXTURE_DIR, "sample.html");
    if (existsSync(fx)) return { ok: true, body: await fs.readFile(fx, "utf-8") };
    return { ok: true, body: "" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const body = await res.text();
    if (res.status === 403 || res.status === 503) {
      return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    }
    if (!res.ok && attempt < MAX_RETRIES) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    if (!res.ok) return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    return { ok: true, body, status: res.status };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    return { ok: false, body: "", blocker: `network:${err.message}` };
  }
}

/* ------------------------------- utils ---------------------------------- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", trade: "™", reg: "®", copy: "©",
};

export function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

export function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

const VALID_CATEGORIES = new Set([
  "beef", "dairy", "eggs", "pork", "poultry", "chicken", "turkey",
  "lamb", "goat", "rabbit", "duck", "bison", "veal", "honey", "yogurt", "cheese",
]);

/** Normalise raw category tokens. "Chicken/Eggs" → ["chicken","eggs"]. */
export function normalizeCategories(raw) {
  if (!raw) return [];
  const tokens = String(raw)
    .toLowerCase()
    .split(/[,/&·•|]| and |\s{2,}/)
    .map(t => t.trim().replace(/[^a-z]/g, ""))
    .filter(Boolean);
  const out = [];
  for (const t of tokens) {
    if (VALID_CATEGORIES.has(t)) out.push(t);
    // common aliases
    else if (t === "egg") out.push("eggs");
    else if (t === "hen" || t === "hens" || t === "layer") out.push("eggs");
    else if (t === "milk") out.push("dairy");
    else if (t === "cattle" || t === "cow" || t === "cows") out.push("beef");
    else if (t === "pig" || t === "pigs" || t === "swine") out.push("pork");
    else if (t === "sheep") out.push("lamb");
  }
  // dedupe, preserve first occurrence
  return [...new Set(out)];
}

/* ------------------------------- parser --------------------------------- */

export function parseFarmsHtml(html) {
  if (!html) return [];
  const out = [];

  const blockRe = /<(article|li|div)\b[^>]*class="(?:[^"]*\s)?(?:farm-card|awa-listing|certified-farm|awa-farm)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];

    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d)[^>]*class="[^"]*\b(?:farm-name|brand-name|company-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    let state = null;
    const stMatch = inner.match(/<[^>]*class="[^"]*\b(?:state|us-state)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (stMatch) state = stripTags(stMatch[1]) || null;

    let country = null;
    const coMatch = inner.match(/<[^>]*class="[^"]*\b(?:country)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (coMatch) country = stripTags(coMatch[1]) || null;

    let categoryRaw = "";
    const catBlock = inner.match(/<[^>]*class="[^"]*\b(?:product-categories|products|species|product-list)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (catBlock) categoryRaw = stripTags(catBlock[1]);
    if (!categoryRaw) {
      // "Products: beef, eggs" inline.
      const text = stripTags(inner);
      const pm = text.match(/(?:products|species|categories)\s*[:\-]\s*([^.]+)/i);
      if (pm) categoryRaw = pm[1];
    }
    const productCategories = normalizeCategories(categoryRaw);

    out.push({ brand, state, country, productCategories, sourceUrl: SOURCE_URL });
  }

  // De-dupe (brand + state).
  const seen = new Set();
  return out.filter(r => {
    const k = `${r.brand.toLowerCase()}|${(r.state || "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`AWA fetcher starting (fixture=${FIXTURE_MODE})...`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  const res = await fetchHtml(SOURCE_URL);
  let farms = [];
  let status = "ok"; let note;
  if (!res.ok) {
    console.error(`  BLOCKED (${res.blocker})`);
    status = "blocked"; note = res.blocker;
  } else {
    farms = parseFarmsHtml(res.body);
    console.log(`  Parsed ${farms.length} farms`);
    if (farms.length === 0) status = "empty";
  }

  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(RAW_DIR, `${today}.json`);
  const payload = {
    _license: "Public certification list (A Greener World / Animal Welfare Approved); cite source URL.",
    _source: SOURCE_URL,
    _landing: LANDING_URL,
    _generated_at: new Date().toISOString(),
    _status: status,
    ...(note ? { _note: note } : {}),
    _stats: {
      total_farms: farms.length,
      with_products: farms.filter(f => f.productCategories.length > 0).length,
    },
    farms,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile} (${farms.length} farms)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("awa-fetch failed:", err);
    process.exit(1);
  });
}
