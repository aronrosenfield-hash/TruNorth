#!/usr/bin/env node
/**
 * UK HSE (Health and Safety Executive) — prosecutions and convictions
 * against employers for workplace health-and-safety failings.
 *
 * Source: https://resources.hse.gov.uk/convictions-history/
 *         https://press.hse.gov.uk/
 *
 * The HSE Convictions History database is queryable but does not publish
 * bulk JSON. This fetcher reads:
 *   - JSON from --url (HSE search export), or
 *   - the bundled CSV fixture under scripts/fixtures/uk-hse/.
 *
 * Fields per row:
 *   defendant    string
 *   offence      string   (Fatal injury | Workplace transport | Asbestos | ...)
 *   fine_gbp     number
 *   date         ISO date  (sentence date)
 *   url          string
 *
 * Raw output: data/raw/uk-hse/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/uk-hse");
const FIXTURE = path.join(ROOT, "scripts/fixtures/uk-hse/sample.csv");

const SOURCE_URL = "https://resources.hse.gov.uk/convictions-history/";
const UA = "TruNorth-UK-HSE/1.0 (+https://www.trunorthapp.com)";

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
    defendant: header.indexOf("defendant"),
    offence:   header.indexOf("offence"),
    fine_gbp:  header.indexOf("fine_gbp"),
    date:      header.indexOf("date"),
    url:       header.indexOf("url"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (idx.defendant < 0 || !(r[idx.defendant] || "").trim()) continue;
    out.push({
      defendant: (r[idx.defendant] || "").trim(),
      offence:   (r[idx.offence]   || "").trim(),
      fine_gbp:  parseGBP(r[idx.fine_gbp]),
      date:      (r[idx.date]      || "").trim().slice(0, 10),
      url:       (r[idx.url]       || "").trim() || SOURCE_URL,
    });
  }
  return out;
}

export function jsonToRecords(items) {
  const out = [];
  for (const it of items ?? []) {
    const defendant = it.defendant ?? it.respondent ?? it.title ?? it.name ?? null;
    if (!defendant) continue;
    out.push({
      defendant,
      offence:  it.offence  ?? it.summary ?? it.charge ?? "",
      fine_gbp: parseGBP(it.fine_gbp ?? it.fine ?? it.penalty ?? 0),
      date:     (it.date ?? it.sentence_date ?? it.published ?? "").slice(0, 10),
      url:      it.url ?? it.link ?? SOURCE_URL,
    });
  }
  return out;
}

async function loadInput() {
  if (APPLY && URL_IN) {
    const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "application/json, text/csv" } });
    if (!res.ok) throw new Error(`UK HSE fetch ${res.status} ${res.statusText}`);
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
  console.log(`UK-HSE fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records = await loadInput();
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "uk-hse",
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
  main().catch(err => { console.error("uk-hse-fetch failed:", err); process.exit(1); });
}
