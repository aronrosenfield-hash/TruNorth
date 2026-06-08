#!/usr/bin/env node
/**
 * DW-14 — CFTC enforcement actions (monthly).
 *
 * The U.S. Commodity Futures Trading Commission publishes enforcement
 * actions (market manipulation, fraud, anti-money-laundering failures,
 * swap-dealer registration issues) as press releases at:
 *   https://www.cftc.gov/PressRoom/PressReleases
 *
 * There is no first-party JSON API for enforcement actions. However,
 * OpenSanctions mirrors CFTC actions as a structured JSON entity feed.
 * This pipeline ingests either:
 *   - a JSON file fetched from --url (OpenSanctions CFTC mirror), or
 *   - the bundled CSV fixture in scripts/fixtures/cftc-enforcement/.
 *
 * Fields per row:
 *   respondent      string   - named entity (firm or individual)
 *   violation       string   - statute/section + 1-line description
 *   civil_penalty   number   - USD penalty
 *   date            ISO date - order date
 *   url             string   - link to the CFTC press release
 *
 * CLI:
 *   node scripts/cftc-enforcement-fetch.mjs                  # dry, fixture
 *   node scripts/cftc-enforcement-fetch.mjs --apply --url <X>
 *   node scripts/cftc-enforcement-fetch.mjs --limit 50
 *
 * Auth: none. CFTC_OS_API_KEY is reserved for future OpenSanctions
 * paid-tier access (read via process.env.CFTC_OS_API_KEY).
 *
 * Raw output:
 *   data/raw/cftc-enforcement/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./disability-in-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cftc-enforcement");
const FIXTURE = path.join(ROOT, "scripts/fixtures/cftc-enforcement/sample.csv");

const SOURCE_URL = "https://www.cftc.gov/PressRoom/PressReleases";
const UA = "TruNorth-CFTC/1.0 (+https://www.trunorthapp.com)";

// Reserved for OpenSanctions paid mirror API key when/if we upgrade.
const API_KEY = process.env.CFTC_OS_API_KEY ?? null;

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY  = flag("--apply");
const LIMIT  = Number(val("--limit", 0)) || 0;
const URL_IN = val("--url", null);
const OUT    = val("--out", null);

/** Parse a number that may be "$1,200,000.00" or "1200000". */
export function parseUSD(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** CSV header: respondent,violation,civil_penalty,date,url */
export function rowsToRecords(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    respondent:    header.indexOf("respondent"),
    violation:     header.indexOf("violation"),
    civil_penalty: header.indexOf("civil_penalty"),
    date:          header.indexOf("date"),
    url:           header.indexOf("url"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (idx.respondent < 0 || !(r[idx.respondent] || "").trim()) continue;
    out.push({
      respondent:    (r[idx.respondent] || "").trim(),
      violation:     (r[idx.violation]  || "").trim(),
      civil_penalty: parseUSD(r[idx.civil_penalty]),
      date:          (r[idx.date]       || "").trim(),
      url:           (r[idx.url]        || "").trim() || SOURCE_URL,
    });
  }
  return out;
}

/** OpenSanctions JSON entities -> our schema. Each entity has properties{} list. */
export function entitiesToRecords(entities) {
  const out = [];
  for (const e of entities ?? []) {
    const p = e?.properties ?? {};
    const respondent =
      (p.name?.[0]) ?? (p.subject?.[0]) ?? (p.party?.[0]) ?? null;
    if (!respondent) continue;
    const penalty = parseUSD(p.amount?.[0] ?? p.fineAmount?.[0] ?? p.penalty?.[0] ?? null);
    out.push({
      respondent,
      violation:     (p.description?.[0] ?? p.summary?.[0] ?? "").trim(),
      civil_penalty: penalty,
      date:          (p.date?.[0] ?? p.startDate?.[0] ?? "").slice(0, 10),
      url:           (p.sourceUrl?.[0] ?? p.url?.[0] ?? SOURCE_URL),
    });
  }
  return out;
}

async function loadInput() {
  if (APPLY && URL_IN) {
    const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "application/json, text/csv" } });
    if (!res.ok) throw new Error(`CFTC fetch ${res.status} ${res.statusText}`);
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    if (ct.includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")) {
      const j = JSON.parse(body);
      const list = Array.isArray(j) ? j : (j.entities ?? j.results ?? j.data ?? []);
      return entitiesToRecords(list);
    }
    return rowsToRecords(parseCsv(body));
  }
  if (!existsSync(FIXTURE)) throw new Error(`No fixture at ${FIXTURE}`);
  return rowsToRecords(parseCsv(await fs.readFile(FIXTURE, "utf-8")));
}

async function main() {
  console.log(`CFTC-enforcement fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records = await loadInput();
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source:        "cftc-enforcement",
    source_url:    SOURCE_URL,
    fetched_at:    new Date().toISOString(),
    mode:          APPLY ? "apply" : "dry",
    record_count:  records.length,
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
    console.error("cftc-enforcement-fetch failed:", err);
    process.exit(1);
  });
}
