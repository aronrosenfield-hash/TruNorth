#!/usr/bin/env node
/**
 * NZ Commerce Commission — Fair Trading Act / Commerce Act enforcement
 * actions (misleading conduct, cartel, mergers).
 *
 * Source: https://comcom.govt.nz/news-and-media/media-releases
 *
 * The Commission publishes press releases but no structured CSV / API.
 * This fetcher reads:
 *   - JSON from --url, or
 *   - the bundled CSV fixture under scripts/fixtures/nz-comcom/.
 *
 * Fields per row:
 *   respondent   string
 *   action_type  string
 *   penalty_nzd  number   (court-ordered penalty in NZD)
 *   date         ISO date
 *   url          string
 *
 * Raw output: data/raw/nz-comcom/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/nz-comcom");
const FIXTURE = path.join(ROOT, "scripts/fixtures/nz-comcom/sample.csv");

const SOURCE_URL = "https://comcom.govt.nz/news-and-media/media-releases";
const UA = "TruNorth-NZ-ComCom/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY  = flag("--apply");
const LIMIT  = Number(val("--limit", 0)) || 0;
const URL_IN = val("--url", null);
const OUT    = val("--out", null);

export function parseNZD(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[NZ$,\s]/gi, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function rowsToRecords(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    respondent:  header.indexOf("respondent"),
    action_type: header.indexOf("action_type"),
    penalty_nzd: header.indexOf("penalty_nzd"),
    date:        header.indexOf("date"),
    url:         header.indexOf("url"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (idx.respondent < 0 || !(r[idx.respondent] || "").trim()) continue;
    out.push({
      respondent:  (r[idx.respondent]  || "").trim(),
      action_type: (r[idx.action_type] || "").trim(),
      penalty_nzd: parseNZD(r[idx.penalty_nzd]),
      date:        (r[idx.date]        || "").trim().slice(0, 10),
      url:         (r[idx.url]         || "").trim() || SOURCE_URL,
    });
  }
  return out;
}

export function jsonToRecords(items) {
  const out = [];
  for (const it of items ?? []) {
    const respondent = it.respondent ?? it.title ?? it.name ?? null;
    if (!respondent) continue;
    out.push({
      respondent,
      action_type: it.action_type ?? it.type ?? "",
      penalty_nzd: parseNZD(it.penalty_nzd ?? it.fine ?? it.penalty ?? 0),
      date:        (it.date ?? it.published ?? "").slice(0, 10),
      url:         it.url ?? it.link ?? SOURCE_URL,
    });
  }
  return out;
}

async function loadInput() {
  if (APPLY && URL_IN) {
    const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "application/json, text/csv" } });
    if (!res.ok) throw new Error(`NZ ComCom fetch ${res.status} ${res.statusText}`);
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    if (ct.includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")) {
      const j = JSON.parse(body);
      return jsonToRecords(Array.isArray(j) ? j : (j.items ?? j.results ?? j.data ?? []));
    }
    return rowsToRecords(parseCSV(body));
  }
  if (!existsSync(FIXTURE)) throw new Error(`No fixture at ${FIXTURE}`);
  return rowsToRecords(parseCSV(await fs.readFile(FIXTURE, "utf-8")));
}

async function main() {
  console.log(`NZ-ComCom fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records = await loadInput();
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "nz-comcom",
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
  main().catch(err => { console.error("nz-comcom-fetch failed:", err); process.exit(1); });
}
