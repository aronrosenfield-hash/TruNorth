#!/usr/bin/env node
/**
 * DW-16 — Singapore MAS (Monetary Authority of Singapore) enforcement.
 *
 * MAS publishes financial-services enforcement actions (banking,
 * insurance, capital-markets, AML/CFT, market misconduct) at:
 *   https://www.mas.gov.sg/regulation/enforcement/enforcement-actions
 *
 * The site exposes an enforcement-actions listing (HTML) plus an RSS
 * feed at /rss/enforcement-actions. This fetcher ingests either:
 *   - JSON payload from --url (MAS RSS-as-JSON or OpenSanctions mirror),
 *   - the bundled CSV fixture in scripts/fixtures/mas-singapore/.
 *
 * Fields per row:
 *   entity         string
 *   action_type    string   (Composition | Civil penalty | Reprimand | Prohibition Order | Prosecution)
 *   amount_sgd     number   (0 for non-monetary)
 *   date           ISO date
 *   url            string
 *
 * Auth: none. MAS_API_KEY is reserved for future authenticated bulk
 * access (read via process.env.MAS_API_KEY).
 *
 * Raw output: data/raw/mas-singapore/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/mas-singapore");
const FIXTURE = path.join(ROOT, "scripts/fixtures/mas-singapore/sample.csv");

const SOURCE_URL = "https://www.mas.gov.sg/regulation/enforcement/enforcement-actions";
const UA = "TruNorth-MAS-SG/1.0 (+https://www.trunorthapp.com)";

const API_KEY = process.env.MAS_API_KEY ?? null;

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY  = flag("--apply");
const LIMIT  = Number(val("--limit", 0)) || 0;
const URL_IN = val("--url", null);
const OUT    = val("--out", null);

export function parseSGD(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[S$,\s]/gi, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function rowsToRecords(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    entity:      header.indexOf("entity"),
    action_type: header.indexOf("action_type"),
    amount_sgd:  header.indexOf("amount_sgd"),
    date:        header.indexOf("date"),
    url:         header.indexOf("url"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (idx.entity < 0 || !(r[idx.entity] || "").trim()) continue;
    out.push({
      entity:      (r[idx.entity]      || "").trim(),
      action_type: (r[idx.action_type] || "").trim(),
      amount_sgd:  parseSGD(r[idx.amount_sgd]),
      date:        (r[idx.date]        || "").trim().slice(0, 10),
      url:         (r[idx.url]         || "").trim() || SOURCE_URL,
    });
  }
  return out;
}

export function jsonToRecords(items) {
  const out = [];
  for (const it of items ?? []) {
    const entity = it.entity ?? it.title ?? it.name ?? it.respondent ?? null;
    if (!entity) continue;
    out.push({
      entity,
      action_type: it.action_type ?? it.type ?? it.category ?? "",
      amount_sgd:  parseSGD(it.amount_sgd ?? it.amount ?? it.penalty ?? 0),
      date:        (it.date ?? it.published ?? "").slice(0, 10),
      url:         it.url ?? it.link ?? SOURCE_URL,
    });
  }
  return out;
}

async function loadInput() {
  if (APPLY && URL_IN) {
    const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "application/json, text/csv, application/rss+xml" } });
    if (!res.ok) throw new Error(`MAS fetch ${res.status} ${res.statusText}`);
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
  console.log(`MAS-Singapore fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records = await loadInput();
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "mas-singapore",
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
  main().catch(err => { console.error("mas-singapore-fetch failed:", err); process.exit(1); });
}
