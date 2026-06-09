#!/usr/bin/env node
/**
 * ASIC (Australian Securities and Investments Commission) — enforcement
 * actions (civil penalties, criminal proceedings, infringement notices,
 * and greenwashing actions).
 *
 * Source: https://asic.gov.au/about-asic/news-centre/find-a-media-release/
 *         https://asic.gov.au/about-asic/asic-investigations-and-enforcement/
 *
 * ASIC publishes media releases but no structured CSV / API. This fetcher
 * reads:
 *   - JSON from --url (ASIC press-release feed), or
 *   - the bundled CSV fixture under scripts/fixtures/asic/.
 *
 * Fields per row:
 *   respondent   string
 *   action_type  string   (AML/CTF | Greenwashing | Fees-for-no-service | ...)
 *   penalty_aud  number
 *   date         ISO date
 *   url          string
 *
 * Raw output: data/raw/asic/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/asic");
const FIXTURE = path.join(ROOT, "scripts/fixtures/asic/sample.csv");

const SOURCE_URL = "https://asic.gov.au/about-asic/news-centre/find-a-media-release/";
const UA = "TruNorth-ASIC/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY  = flag("--apply");
const LIMIT  = Number(val("--limit", 0)) || 0;
const URL_IN = val("--url", null);
const OUT    = val("--out", null);

export function parseAUD(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[A$,\s]/gi, "");
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
    penalty_aud: header.indexOf("penalty_aud"),
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
      penalty_aud: parseAUD(r[idx.penalty_aud]),
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
      action_type: it.action_type ?? it.type ?? it.category ?? "",
      penalty_aud: parseAUD(it.penalty_aud ?? it.fine ?? it.penalty ?? 0),
      date:        (it.date ?? it.published ?? "").slice(0, 10),
      url:         it.url ?? it.link ?? SOURCE_URL,
    });
  }
  return out;
}

async function loadInput() {
  if (APPLY && URL_IN) {
    const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "application/json, text/csv" } });
    if (!res.ok) throw new Error(`ASIC fetch ${res.status} ${res.statusText}`);
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
  console.log(`ASIC fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records = await loadInput();
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "asic",
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
  main().catch(err => { console.error("asic-fetch failed:", err); process.exit(1); });
}
