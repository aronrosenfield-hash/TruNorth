#!/usr/bin/env node
/**
 * UK Gender Pay Gap Service — annual fetcher.
 *
 * The UK's Gender Pay Gap reporting service (https://gender-pay-gap.service.gov.uk)
 * is a public government registry. Every UK employer with 250+ employees must
 * report their gender pay gap annually. The full dataset is downloadable as a
 * single CSV per snapshot year:
 *
 *   https://gender-pay-gap.service.gov.uk/viewing/download-data/<year>
 *
 * Reporting years run April–April: the "2024" file covers snapshot dates
 * 2024-04-05 (private) / 2024-03-31 (public). Public sector employers must
 * publish by 30 March of the following year; private/voluntary sector by
 * 4 April. We pull the most recently completed reporting year (and fall
 * back two years if the current year isn't yet published).
 *
 * For each TruNorth brand we match by name (case-insensitive, lightly
 * normalised) against the CSV's EmployerName column and surface the four
 * core metrics:
 *
 *   - uk_gpg_mean_pct          — DiffMeanHourlyPercent
 *   - uk_gpg_median_pct        — DiffMedianHourlyPercent
 *   - uk_gpg_bonus_pct_male    — MaleBonusPercent
 *   - uk_gpg_bonus_pct_female  — FemaleBonusPercent
 *
 * plus reporting year and per-employer source URL.
 *
 * Output: /public/data/uk-gpg.json
 *
 * Runs annually via .github/workflows/uk-gpg-annual.yml (1 Apr 19:00 UTC).
 * Locally: node scripts/uk-gpg-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/uk-gpg.json");

const GPG_BASE = "https://gender-pay-gap.service.gov.uk";
const UA = "TruNorth-UK-GPG/1.0 (+https://www.trunorthapp.com)";

// Reporting-year format on the service is the *starting* year of the
// snapshot (e.g. "2024" => snapshot 2024-04 → published by 2025-04).
// We try the most recently completed year first, then walk back.
function candidateYears() {
  const now = new Date();
  // After April we have last year's data published.
  const current = now.getUTCMonth() >= 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
  return [current, current - 1, current - 2];
}

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

// Minimal CSV parser. The GPG download is a vanilla, comma-separated UTF-8
// CSV with double-quoted fields and CRLF line endings. We avoid a dep.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") {
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      }
      else if (c === "\r") { /* skip */ }
      else { field += c; }
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    for (let i = 0; i < headers.length; i++) o[headers[i]] = r[i] ?? "";
    return o;
  });
}

// Normalise an employer name for matching: lowercase, strip punctuation,
// drop common UK corporate suffixes (plc, ltd, limited, llp, group, uk, etc.).
const SUFFIXES = [
  "plc", "limited", "ltd", "llp", "lp", "llc", "inc", "incorporated",
  "corporation", "corp", "company", "co", "group", "holdings", "holding",
  "uk", "u k", "europe", "international", "services", "the",
];
function normName(s) {
  let n = String(s || "").toLowerCase();
  n = n.replace(/&/g, " and ");
  n = n.replace(/[^a-z0-9 ]+/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  // strip trailing suffix tokens, repeatedly.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (n === suf) break;
      if (n.endsWith(" " + suf)) { n = n.slice(0, -suf.length - 1).trim(); changed = true; }
    }
  }
  return n;
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchYear(year) {
  // The service exposes the bulk CSV at this canonical download URL.
  const url = `${GPG_BASE}/viewing/download-data/${year}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/csv,application/octet-stream,*/*" },
    redirect: "follow",
  });
  if (!res.ok) return { ok: false, status: res.status, url };
  const text = await res.text();
  // Sanity: header should contain "EmployerName" and "DiffMeanHourlyPercent".
  if (!/EmployerName/i.test(text) || !/DiffMeanHourlyPercent/i.test(text)) {
    return { ok: false, status: 0, url, reason: "unexpected_payload" };
  }
  return { ok: true, url, text };
}

function buildIndex(rows) {
  // Map normalised name -> array of row objects (some employers report
  // multiple legal entities; we'll surface the largest by employee band).
  const idx = new Map();
  for (const r of rows) {
    const key = normName(r.EmployerName);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(r);
  }
  return idx;
}

function pickPrimary(matches) {
  // Prefer the entry with the largest employee size band; ties broken by
  // first occurrence (which is alphabetical in the source CSV).
  const sizeRank = {
    "Less than 250": 0,
    "250 to 499": 1,
    "500 to 999": 2,
    "1000 to 4999": 3,
    "5000 to 19,999": 4,
    "20,000 or more": 5,
  };
  return [...matches].sort((a, b) => (sizeRank[b.EmployerSize] ?? -1) - (sizeRank[a.EmployerSize] ?? -1))[0];
}

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function matchBrand(brand, index) {
  const candidates = new Set();
  candidates.add(normName(brand.name));
  // Try a couple of slug-derived variants so e.g. "goldman-sachs-uk" still
  // hits "Goldman Sachs".
  candidates.add(normName(brand.slug.replace(/-/g, " ")));
  candidates.add(normName(brand.slug.replace(/-uk$/, "").replace(/-/g, " ")));

  for (const k of candidates) {
    if (k && index.has(k)) return { key: k, matches: index.get(k), how: "exact" };
  }
  // Looser pass: a normalised candidate is a prefix of an indexed key
  // (e.g. "hsbc" -> "hsbc bank", "hsbc uk bank"). Choose the shortest
  // matching key for stability.
  const keys = [...index.keys()];
  for (const k of [...candidates].filter(Boolean)) {
    const hits = keys
      .filter(idxKey => idxKey === k || idxKey.startsWith(k + " "))
      .sort((a, b) => a.length - b.length);
    if (hits.length) return { key: hits[0], matches: index.get(hits[0]), how: "prefix" };
  }
  return null;
}

function projectMetrics(row, year, employerId) {
  // EmployerId is the service's stable identifier; if absent (older
  // snapshots) we link to the search results page.
  const sourceUrl = employerId
    ? `${GPG_BASE}/Employer/${employerId}`
    : `${GPG_BASE}/viewing/search-results?search=${encodeURIComponent(row.EmployerName)}`;
  return {
    employer_name:          row.EmployerName,
    employer_size:          row.EmployerSize || null,
    uk_gpg_mean_pct:        num(row.DiffMeanHourlyPercent),
    uk_gpg_median_pct:      num(row.DiffMedianHourlyPercent),
    uk_gpg_bonus_pct_male:  num(row.MaleBonusPercent),
    uk_gpg_bonus_pct_female:num(row.FemaleBonusPercent),
    diff_mean_bonus_pct:    num(row.DiffMeanBonusPercent),
    diff_median_bonus_pct:  num(row.DiffMedianBonusPercent),
    female_top_quartile:    num(row.FemaleTopQuartile),
    female_upper_mid_quartile: num(row.FemaleUpperMiddleQuartile),
    female_lower_mid_quartile: num(row.FemaleLowerMiddleQuartile),
    female_lower_quartile:  num(row.FemaleLowerQuartile),
    year,
    source_url:             sourceUrl,
  };
}

async function main() {
  console.log("UK Gender Pay Gap fetcher starting…");
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  // Walk candidate years (1 req/sec courtesy) until one resolves.
  let snapshot = null;
  for (const y of candidateYears()) {
    console.log(`  trying reporting year ${y}…`);
    const r = await fetchYear(y);
    await delay(1000);
    if (r.ok) { snapshot = { year: y, ...r }; break; }
    console.log(`   year ${y} unavailable (status=${r.status} ${r.reason || ""})`);
  }
  if (!snapshot) {
    throw new Error("No UK GPG snapshot CSV available for any candidate year");
  }
  console.log(`Using reporting year ${snapshot.year} from ${snapshot.url}`);

  const rows = parseCsv(snapshot.text);
  console.log(`Parsed ${rows.length} employer rows`);
  const idx = buildIndex(rows);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    const m = matchBrand(brand, idx);
    if (!m) {
      results.push({ slug: brand.slug, name: brand.name, status: "not_found_in_uk_gpg" });
      continue;
    }
    const primary = pickPrimary(m.matches);
    const metrics = projectMetrics(primary, snapshot.year, primary.EmployerId);
    results.push({
      slug:    brand.slug,
      name:    brand.name,
      status:  "ok",
      match_how: m.how,
      match_key: m.key,
      reporting_count: m.matches.length,
      ...metrics,
      scraped_at: new Date().toISOString(),
    });
    if (i % 50 === 0) console.log(`  …${i}/${brands.length}`);
  }

  const ok        = results.filter(r => r.status === "ok").length;
  const notFound  = results.filter(r => r.status === "not_found_in_uk_gpg").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    reporting_year: snapshot.year,
    source: "uk-gpg-service",
    source_csv_url: snapshot.url,
    brand_count: brands.length,
    matched_count: ok,
    not_found_count: notFound,
    employer_row_count: rows.length,
    employers: results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Matched:   ${ok}`);
  console.log(`   Not found: ${notFound}`);
}

main().catch(err => {
  console.error("uk-gpg-fetch failed:", err);
  process.exit(1);
});
