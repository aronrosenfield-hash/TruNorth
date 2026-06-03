#!/usr/bin/env node
/**
 * CDC FoodNet / NORS — monthly per-brand outbreak fetcher
 *
 * For each brand in /public/data/top-500-brands.txt, finds CDC-published
 * named foodborne outbreak investigations linked to that brand (or its
 * product). Source of truth: CDC's `full-outbreak-list.csv` (the same
 * file backing https://www.cdc.gov/foodborne-outbreaks/outbreaks/index.html ).
 *
 * Why not the SODA "NORS" dataset on data.cdc.gov (5xkq-dg7x)?
 *   - The public NORS file is intentionally stripped of brand identifiers.
 *     It exposes only state / setting / etiology / illness counts.
 *     We confirmed this directly — there is no brand_or_product_name
 *     column. Useful for aggregate baselines, useless for per-brand match.
 *
 * Why not BEAM / NEARS?
 *   - BEAM (jbhn-e8xn): pathogen isolates by state, no brand.
 *   - NEARS (x66v-w5ka): retrospective investigation methods study,
 *     small (~900 rows), establishment type only, no brand.
 *
 * What this script does:
 *   1. Fetches CDC's full-outbreak-list.csv (~228 named outbreaks since 2006).
 *   2. For each outbreak, fetches the detail page and extracts illness +
 *      hospitalization + death counts via regex.
 *   3. For each brand in top-500, scans every outbreak's product label,
 *      detail-page text, and URL slug for the brand name (case-insensitive,
 *      word-boundary). Brand → matched outbreaks.
 *   4. Per brand, computes 5y aggregates + sample outbreaks.
 *
 * Output: /public/data/cdc-foodnet-outbreaks.json
 *
 * Most non-food brands return 0 matches — that's expected. The merger
 * skips those.
 *
 * Rate limit: 1 req/sec to cdc.gov (228 outbreak pages + 1 CSV ~= 4 min).
 * Locally: node scripts/cdc-foodnet-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/cdc-foodnet-outbreaks.json");

const CDC_CSV_URL =
  "https://www.cdc.gov/foodborne-outbreaks/media/files/2024/04/full-outbreak-list.csv";
const CDC_BASE = "https://www.cdc.gov";
const UA = "TruNorth-CDC/1.0 (+https://www.trunorthapp.com)";
const RATE_MS = 1000;
const FIVE_YEAR_CUTOFF = new Date().getFullYear() - 5;

const HEADERS = { "User-Agent": UA, "Accept": "text/html,*/*" };

// ---------- helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name, category] = l.split("|").map((s) => s.trim());
      return { slug, name, category };
    })
    .filter((b) => b.slug && b.name);
}

// Tiny CSV parser that handles RFC-4180 doubled quotes for CDC's file.
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractHref(htmlCell) {
  const m = /href="([^"]+)"/i.exec(htmlCell || "");
  return m ? m[1] : null;
}

// ---------- CSV → normalized outbreak list ----------

async function fetchOutbreakIndex() {
  console.log("Fetching CDC outbreak index CSV…");
  const res = await fetch(CDC_CSV_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  // Header: Contaminated Food, Germ, Year
  const [header, ...data] = rows;
  if (!header || header[0].trim() !== "Contaminated Food") {
    console.warn("Unexpected CSV header:", header);
  }
  const outbreaks = data
    .filter((r) => r.length >= 3 && r[0])
    .map((r) => {
      const productHtml = r[0];
      const germHtml = r[1];
      const yearRaw = (r[2] || "").trim();
      return {
        product: stripTags(productHtml),
        pathogen: stripTags(germHtml),
        year: parseInt(yearRaw, 10) || null,
        urlPath: extractHref(productHtml),
      };
    })
    .filter((o) => o.product && o.year);
  console.log(`  parsed ${outbreaks.length} outbreaks`);
  return outbreaks;
}

// Extract illness / hospitalization / death counts from an outbreak detail page.
async function enrichOutbreakDetail(outbreak) {
  if (!outbreak.urlPath) return outbreak;
  const url = outbreak.urlPath.startsWith("http")
    ? outbreak.urlPath
    : CDC_BASE + outbreak.urlPath;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return { ...outbreak, detailStatus: `http_${res.status}` };
    const html = await res.text();
    const text = stripTags(html);

    // CDC outbreak pages express counts in two layouts:
    //   (a) "Fast Facts" colon cards:  "Cases : 104 Hospitalizations : 34"
    //   (b) inline cards:               "104 Hospitalizations"
    //   (c) older prose:                "Total ill: 47"
    // We try (a) then fall back to (b)/(c).
    const colon = (label) => {
      const re = new RegExp(`${label}\\s*[:\\-]\\s*(\\d[\\d,]*)`, "i");
      const m = text.match(re);
      return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
    };
    const card = (label) => {
      const re = new RegExp(`(\\d[\\d,]*)\\s+${label}\\b`, "i");
      const m = text.match(re);
      return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
    };

    return {
      ...outbreak,
      detailUrl: url,
      illnesses:
        colon("(?:Total Ill(?:nesses?)?|People (?:infected|Ill)|Illnesses?|Sick|Cases?)") ??
        card("(?:Illnesses?|People|Sick|Cases?)"),
      hospitalizations:
        colon("Hospitalizations?") ?? card("Hospitalizations?"),
      deaths:
        colon("Deaths?") ?? card("Deaths?"),
      detailStatus: "ok",
    };
  } catch (err) {
    return { ...outbreak, detailStatus: `error:${err.message}` };
  }
}

// ---------- brand → outbreak matching ----------

// Build a regex that matches a brand name as a whole word/phrase,
// case-insensitive, tolerant of optional apostrophes ("McDonalds" vs
// "McDonald's") and whitespace/dash variation ("Coca-Cola" vs "Coca Cola").
function brandRegex(name) {
  // 1. Escape regex specials FIRST (before we add our own special chars).
  let s = name.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  // 2. Make any apostrophe optional.
  s = s.replace(/['’]/g, "['’]?");
  // 3. Allow flexible whitespace/dash between words.
  s = s.replace(/[-\s]+/g, "[-\\s]+");
  return new RegExp(`(?:^|[^A-Za-z0-9])${s}(?:'s)?(?:$|[^A-Za-z0-9])`, "i");
}

function matchOutbreaks(brand, outbreaks) {
  // Skip brands whose name is so short or generic it'd false-match
  // (e.g. "Apple", "Subway" — though Subway is legit, "Apple" is risky).
  // Heuristic: minimum 4 chars, and word must not be a common-noun
  // food item present in CSV product labels.
  if (brand.name.length < 4) return [];
  const COMMON = new Set([
    "apple", "egg", "eggs", "milk", "beef", "pork", "fish", "rice",
    "corn", "salt", "soup", "salad", "bread", "cake", "ham",
  ]);
  if (COMMON.has(brand.name.toLowerCase())) return [];

  const re = brandRegex(brand.name);
  return outbreaks.filter(
    (o) => re.test(o.product) || re.test(o.urlPath || "")
  );
}

function aggregateForBrand(brand, outbreaks) {
  const matched = matchOutbreaks(brand, outbreaks);
  const recent = matched.filter((o) => o.year >= FIVE_YEAR_CUTOFF);

  const sum = (arr, k) => arr.reduce((a, o) => a + (Number.isFinite(o[k]) ? o[k] : 0), 0);

  return {
    slug: brand.slug,
    name: brand.name,
    status: matched.length === 0 ? "no_outbreaks" : "ok",
    total_outbreaks_5y:        recent.length,
    total_outbreaks_all_time:  matched.length,
    total_illnesses_5y:        sum(recent, "illnesses"),
    total_hospitalizations_5y: sum(recent, "hospitalizations"),
    total_deaths_5y:           sum(recent, "deaths"),
    sample_outbreaks: matched
      .slice() // copy
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .slice(0, 5)
      .map((o) => ({
        year:     o.year,
        product:  o.product,
        pathogen: o.pathogen,
        illnesses:        o.illnesses ?? null,
        hospitalizations: o.hospitalizations ?? null,
        deaths:           o.deaths ?? null,
        url:      o.detailUrl || (o.urlPath ? CDC_BASE + o.urlPath : null),
      })),
    scraped_at: new Date().toISOString(),
  };
}

// ---------- main ----------

async function main() {
  console.log("CDC FoodNet/NORS outbreak fetcher starting…");

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  // 1. Fetch the master CSV index.
  let outbreaks = await fetchOutbreakIndex();
  await sleep(RATE_MS);

  // 2. Enrich each outbreak with illness/hospitalization counts.
  //    We only need counts for outbreaks in the last 5y to support the
  //    headline aggregates. Older ones can still serve as "sample_outbreaks"
  //    without counts.
  const enriched = [];
  const needCounts = outbreaks.filter((o) => o.year >= FIVE_YEAR_CUTOFF);
  console.log(`Enriching ${needCounts.length} recent outbreaks with counts (5y)…`);
  for (let i = 0; i < needCounts.length; i++) {
    enriched.push(await enrichOutbreakDetail(needCounts[i]));
    if (i % 25 === 0) console.log(`  …${i}/${needCounts.length}`);
    await sleep(RATE_MS);
  }
  // Older outbreaks pass through without detail enrichment.
  const enrichedMap = new Map(enriched.map((o) => [o.urlPath, o]));
  outbreaks = outbreaks.map((o) => enrichedMap.get(o.urlPath) || o);

  // 3. For each brand, find matching outbreaks + aggregate.
  console.log("Matching brands to outbreaks…");
  const results = brands.map((b) => aggregateForBrand(b, outbreaks));

  const withMatch = results.filter((r) => r.status === "ok").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date().toISOString(),
    source:              "CDC Foodborne Outbreaks (full-outbreak-list.csv)",
    source_url:          CDC_CSV_URL,
    five_year_cutoff:    FIVE_YEAR_CUTOFF,
    total_outbreaks_in_index: outbreaks.length,
    brand_count:         brands.length,
    with_outbreaks_count: withMatch,
    no_outbreaks_count:   brands.length - withMatch,
    outbreaks:           results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with outbreaks: ${withMatch}`);
  console.log(`   Brands with none:      ${brands.length - withMatch}`);
}

main().catch((err) => {
  console.error("cdc-foodnet-fetch failed:", err);
  process.exit(1);
});
