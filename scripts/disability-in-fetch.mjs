#!/usr/bin/env node
/**
 * DW-13 — Disability:IN Disability Equality Index (DEI) ratings.
 *
 * Disability:IN partners with the American Association of People with
 * Disabilities (AAPD) each year to publish the Disability Equality Index
 * — a 0-100 benchmark scoring Fortune-1000+ companies on disability
 * inclusion (culture, leadership, accessibility, employment practices,
 * community engagement, supplier diversity).
 *
 * Source landing:
 *   https://disabilityin.org/what-we-do/disability-equality-index/
 *
 * The official top-scorers list ("Best Places to Work for Disability
 * Inclusion") is published annually as a press release + companies-listed
 * page. There is NO machine-readable API; this fetcher consumes a
 * curated, snapshot CSV maintained in /scripts/fixtures/disability-in/
 * (refreshed manually each summer when the new top-scorers list drops)
 * or a remote URL passed via --url.
 *
 * Fields per row (CSV header):
 *   company,dei_score,year
 *
 * CLI:
 *   node scripts/disability-in-fetch.mjs                 # dry, uses fixture
 *   node scripts/disability-in-fetch.mjs --apply         # real fetch (needs --url)
 *   node scripts/disability-in-fetch.mjs --url <CSV URL> --apply
 *   node scripts/disability-in-fetch.mjs --limit 25      # cap to first N rows
 *   node scripts/disability-in-fetch.mjs --out path.json # custom raw output
 *
 * Auth: none (public listings). If Disability:IN ever requires a key
 * for bulk programmatic access it would be DISABILITY_IN_API_KEY,
 * referenced via process.env.DISABILITY_IN_API_KEY below.
 *
 * Raw output:
 *   data/raw/disability-in/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/disability-in");
const FIXTURE = path.join(ROOT, "scripts/fixtures/disability-in/sample.csv");

const SOURCE_URL = "https://disabilityin.org/what-we-do/disability-equality-index/";
const UA = "TruNorth-DisabilityIN/1.0 (+https://www.trunorthapp.com)";

// Reserved for future bulk-export auth. Currently public-listing-only.
const API_KEY = process.env.DISABILITY_IN_API_KEY ?? null;

const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function val(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const APPLY  = flag("--apply");
const LIMIT  = Number(val("--limit", 0)) || 0;
const URL_IN = val("--url", null);
const OUT    = val("--out", null);

/**
 * Minimal CSV parser — RFC-4180 lite. Handles quoted fields, embedded
 * commas inside quotes, and "" escape inside quoted fields. Returns
 * Array<Array<string>>.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

/**
 * Convert parsed CSV rows (incl. header) to typed records.
 *   company,dei_score,year -> { company, dei_score, year }
 */
export function rowsToRecords(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rec = {};
    for (let c = 0; c < header.length; c++) rec[header[c]] = (r[c] ?? "").trim();
    if (!rec.company) continue;
    out.push({
      company:   rec.company,
      dei_score: rec.dei_score === "" ? null : Number(rec.dei_score),
      year:      rec.year ? Number(rec.year) : null,
    });
  }
  return out;
}

async function loadCsv() {
  if (APPLY && URL_IN) {
    const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "text/csv" } });
    if (!res.ok) throw new Error(`Disability:IN fetch ${res.status} ${res.statusText}`);
    return res.text();
  }
  if (!existsSync(FIXTURE)) {
    throw new Error(`No fixture at ${FIXTURE} and no --url provided.`);
  }
  return fs.readFile(FIXTURE, "utf-8");
}

async function main() {
  console.log(`Disability:IN fetcher (${APPLY ? "APPLY" : "DRY"})`);
  const csv = await loadCsv();
  const rows = parseCsv(csv);
  let records = rowsToRecords(rows);
  if (LIMIT > 0) records = records.slice(0, LIMIT);

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "disability-in",
    source_url: SOURCE_URL,
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };

  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} records -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("disability-in-fetch failed:", err);
    process.exit(1);
  });
}
