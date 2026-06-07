#!/usr/bin/env node
/**
 * Leaping Bunny — certified cruelty-free brands (quarterly) — B-14.
 *
 *   https://www.leapingbunny.org/shopping-guide
 *
 * Leaping Bunny is the gold-standard cruelty-free certification — every
 * certified brand has signed a binding pledge that neither the brand nor
 * its ingredient suppliers test on animals at any stage of production.
 *
 * STRATEGY
 *   1. The Leaping Bunny shopping guide is a paginated listing keyed by
 *      brand-letter (A–Z + 0–9). We fetch each letter page in turn.
 *   2. Each brand entry sits inside a list item (or table row) with the
 *      brand name in the first anchor + an optional "parent company"
 *      sub-line. Some entries surface a certification date.
 *   3. We tolerate three template variants the site has used:
 *      <li class="brand-entry">, <div class="shopping-brand">,
 *      <tr class="brand-row">. Parsing is permissive regex (no cheerio
 *      dependency — consistent with ca-ag-fetch.mjs).
 *
 * THROTTLE / POLITENESS
 *   - 2 req/sec (REQ_DELAY_MS = 2000) — Leaping Bunny is a small nonprofit
 *   - Honest UA identifying TruNorth + this pipeline
 *   - Retry on 5xx with exponential backoff (3 tries)
 *
 * OUTPUT
 *   public/data/_raw/leaping-bunny.json
 *   {
 *     generated_at,
 *     source_url,
 *     brand_count,
 *     certified_brands: [{ brand, parent_company?, certification_date? }]
 *   }
 *
 * Runs quarterly via .github/workflows/leaping-bunny-quarterly.yml.
 *
 * Locally:
 *   node scripts/leaping-bunny-fetch.mjs             # live scrape (DO NOT in worktree)
 *   node scripts/leaping-bunny-fetch.mjs --fixture   # use fixture HTML
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const OUT_FILE = path.join(RAW_DIR, "leaping-bunny.json");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/cruelty-free");

const LB_BASE = "https://www.leapingbunny.org";
const LB_GUIDE_PATH = "/shopping-guide";
const REQ_DELAY_MS = 2000; // 2s — be respectful to a small nonprofit
const UA = "TruNorth-LeapingBunny/1.0 (+https://www.trunorthapp.com; data pipeline for cruelty-free certification transparency)";
const FIXTURE_MODE = process.argv.includes("--fixture");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(["0-9"]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchText(url, attempt = 0) {
  if (FIXTURE_MODE) {
    const letter = (url.split("letter=")[1] || "").split("&")[0] || "guide";
    const candidate = path.join(FIXTURE_DIR, `leaping-bunny-${decodeURIComponent(letter)}.html`);
    if (existsSync(candidate)) return fs.readFile(candidate, "utf-8");
    return "";
  }
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

// Decode common HTML entities (deliberately no dependency).
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  // Accented Latin (the ones that appear in cosmetics-brand names)
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ntilde: "ñ", ccedil: "ç", szlig: "ß",
  Eacute: "É", Aacute: "Á", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…",
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

// Each brand row in the shopping guide is rendered as one of:
//   <li class="brand-entry">
//     <a class="brand-name" href="...">Brand Name</a>
//     <span class="parent-company">parent: Some Holding Co.</span>
//     <span class="certification-date">2018-04-12</span>
//   </li>
//   <div class="shopping-brand">...</div>
//   <tr class="brand-row">...</tr>
export function parseLeapingBunnyPage(html) {
  if (!html) return [];

  const items = [];
  const blockRe = /<(li|div|tr)\b[^>]*class="(?:[^"]*\s)?(?:brand-entry|shopping-brand|brand-row)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];

    // Brand name: prefer an explicit .brand-name element; fall back to first anchor.
    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|h\d)[^>]*class="[^"]*\bbrand-name\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|h\d)>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    // Parent company (optional)
    let parent_company = null;
    const parentMatch =
      inner.match(/<[^>]*class="[^"]*\bparent-company\b[^"]*"[^>]*>([\s\S]*?)<\//i)
      || inner.match(/(?:parent\s*company|owned\s*by)\s*[:\-]\s*([^<\n]+)/i);
    if (parentMatch) {
      parent_company = stripTags(parentMatch[1]).replace(/^(?:parent(?:\s*company)?|owned\s*by)\s*[:\-]?\s*/i, "").trim();
      if (!parent_company) parent_company = null;
    }

    // Certification date (optional, ISO or freeform)
    let certification_date = null;
    const dateMatch =
      inner.match(/<[^>]*class="[^"]*\bcertification-date\b[^"]*"[^>]*>([\s\S]*?)<\//i)
      || inner.match(/(?:certified\s*(?:on|since)|certification\s*date)\s*[:\-]\s*([A-Za-z0-9 ,\-\/]+)/i);
    if (dateMatch) {
      const raw = stripTags(dateMatch[1]).replace(/^(?:certified\s*(?:on|since)|certification\s*date)\s*[:\-]?\s*/i, "").trim();
      certification_date = normalizeDate(raw) || (raw || null);
    }

    items.push({ brand, parent_company, certification_date });
  }

  // Dedupe per page.
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const key = `${it.brand.toLowerCase()}|${(it.parent_company || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }
  return deduped;
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

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`Leaping Bunny fetcher starting (fixture=${FIXTURE_MODE})...`);

  const allBrands = [];
  for (const letter of LETTERS) {
    const url = `${LB_BASE}${LB_GUIDE_PATH}?letter=${encodeURIComponent(letter)}`;
    let html = "";
    try { html = await fetchText(url); }
    catch (err) {
      console.error(`  [${letter}] fetch failed: ${err.message}`);
      continue;
    }
    const items = parseLeapingBunnyPage(html);
    console.log(`  [${letter}] ${items.length} brands`);
    allBrands.push(...items);
    if (!FIXTURE_MODE) await sleep(REQ_DELAY_MS);
  }

  // Final dedupe across letters.
  const byKey = new Map();
  for (const it of allBrands) {
    const key = `${it.brand.toLowerCase()}|${(it.parent_company || "").toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, it);
  }
  const certified_brands = [...byKey.values()].sort((a, b) => a.brand.localeCompare(b.brand));

  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_url: `${LB_BASE}${LB_GUIDE_PATH}`,
    brand_count: certified_brands.length,
    certified_brands,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE} (${certified_brands.length} brands)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("leaping-bunny-fetch failed:", err);
    process.exit(1);
  });
}
