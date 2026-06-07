#!/usr/bin/env node
/**
 * DW-15 — UK ICO (Information Commissioner's Office) fines.
 *
 * The ICO is the UK's GDPR/Data Protection Act 2018 regulator. It
 * publishes its enforcement actions (monetary penalty notices,
 * reprimands, enforcement notices, prosecutions) at:
 *   https://ico.org.uk/action-weve-taken/enforcement/
 *
 * The site exposes an RSS feed and JSON listings, but the schema
 * changes seasonally. This fetcher ingests either:
 *   - JSON payload from --url (the ICO RSS/JSON list), or
 *   - the bundled CSV fixture in scripts/fixtures/uk-ico/.
 *
 * Fields per row:
 *   organisation       string
 *   action_type        string   (Monetary Penalty Notice | Enforcement Notice | Reprimand | Prosecution)
 *   sector             string   (Finance / Health / Retail / Public sector / etc.)
 *   date_issued        ISO date
 *   fine_amount_gbp    number   (0 for non-monetary actions)
 *   url                string   (link to ICO action page)
 *
 * CLI: parallel to disability-in/cftc-enforcement.
 *
 * Auth: none. ICO_API_KEY is reserved for future authenticated bulk
 * access (read via process.env.ICO_API_KEY).
 *
 * Raw output: data/raw/uk-ico/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/uk-ico");
const FIXTURE = path.join(ROOT, "scripts/fixtures/uk-ico/sample.csv");

const SOURCE_URL = "https://ico.org.uk/action-weve-taken/enforcement/";
const UA = "TruNorth-UK-ICO/1.0 (+https://www.trunorthapp.com)";

const API_KEY = process.env.ICO_API_KEY ?? null;

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY  = flag("--apply");
const LIMIT  = Number(val("--limit", 0)) || 0;
const URL_IN = val("--url", null);
const OUT    = val("--out", null);

export function parseGBP(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[£,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function rowsToRecords(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    organisation:    header.indexOf("organisation"),
    action_type:     header.indexOf("action_type"),
    sector:          header.indexOf("sector"),
    date_issued:     header.indexOf("date_issued"),
    fine_amount_gbp: header.indexOf("fine_amount_gbp"),
    url:             header.indexOf("url"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (idx.organisation < 0 || !(r[idx.organisation] || "").trim()) continue;
    out.push({
      organisation:    (r[idx.organisation] || "").trim(),
      action_type:     (r[idx.action_type]  || "").trim(),
      sector:          (r[idx.sector]       || "").trim(),
      date_issued:     (r[idx.date_issued]  || "").trim().slice(0, 10),
      fine_amount_gbp: parseGBP(r[idx.fine_amount_gbp]),
      url:             (r[idx.url]          || "").trim() || SOURCE_URL,
    });
  }
  return out;
}

/** JSON-feed entries (ICO RSS/JSON variant) -> our schema. */
export function jsonToRecords(items) {
  const out = [];
  for (const it of items ?? []) {
    const organisation = it.organisation ?? it.title ?? it.name ?? null;
    if (!organisation) continue;
    out.push({
      organisation,
      action_type:     it.action_type ?? it.type ?? it.category ?? "",
      sector:          it.sector ?? it.industry ?? "",
      date_issued:     (it.date_issued ?? it.date ?? it.published ?? "").slice(0, 10),
      fine_amount_gbp: parseGBP(it.fine_amount_gbp ?? it.amount ?? it.penalty ?? 0),
      url:             it.url ?? it.link ?? SOURCE_URL,
    });
  }
  return out;
}

async function loadInput() {
  if (APPLY && URL_IN) {
    const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "application/json, text/csv, application/rss+xml" } });
    if (!res.ok) throw new Error(`ICO fetch ${res.status} ${res.statusText}`);
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
  console.log(`UK-ICO fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records = await loadInput();
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "uk-ico",
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
  main().catch(err => { console.error("uk-ico-fetch failed:", err); process.exit(1); });
}
