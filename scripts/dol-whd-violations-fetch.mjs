#!/usr/bin/env node
/**
 * DW-10 — DOL Wage and Hour Division compliance actions — monthly.
 *
 * The Department of Labor's enforcement data portal publishes the WHISARD
 * (Wage Hour Investigative Support and Reporting Database) as a bulk CSV
 * containing every concluded compliance action since FY2005.
 *
 *   Landing:   https://enforcedata.dol.gov/views/data_summary.php
 *   Bulk CSV:  https://enforcedata.dol.gov/data_catalog.php?data_id=whisard
 *              (the exact static URL is rotated by DOL — the landing page
 *              hosts the latest link). We accept an override via env:
 *                DOL_WHD_CSV_URL
 *
 * Fields we care about:
 *   trade_nm                — establishment trade name (matches consumer brand)
 *   legal_name              — corporate legal name
 *   case_violtn_cnt         — number of violation citations on this case
 *   bw_atp_amt              — back wages agreed-to-pay (USD)
 *   ee_violtd_cnt           — employees affected
 *   cmp_assd_amt            — civil money penalty assessed (USD)
 *   findings_start_date / findings_end_date
 *   naics_code
 *   act_id_flsa             — Y/N flag for FLSA jurisdiction
 *
 * Output:
 *   data/raw/dol-whd-violations/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N
 *   --out PATH
 *   --fixture   use scripts/fixtures/dol-whd-violations/sample.csv
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV, todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/dol-whd-violations");
const FIXTURE = path.join(__dirname, "fixtures/dol-whd-violations/sample.csv");

export const DEFAULT_CSV_URL =
  process.env.DOL_WHD_CSV_URL ||
  "https://enforcedata.dol.gov/data_catalog.php?data_id=whisard&format=csv";
const UA = "TruNorth-DOL-WHD/1.0 (+https://www.trunorthapp.com)";

export function parseWhdRow(row) {
  return {
    trade_name: (row.trade_nm || row.trade_name || "").trim(),
    legal_name: (row.legal_name || row.legal_nm || "").trim(),
    case_id: (row.case_id || "").trim(),
    case_violation_count: toInt(row.case_violtn_cnt || row.case_violation_count),
    back_wages_usd: toFloat(row.bw_atp_amt || row.back_wages_usd),
    employees_affected: toInt(row.ee_violtd_cnt || row.employees_affected),
    civil_penalty_usd: toFloat(row.cmp_assd_amt || row.civil_penalty_usd),
    findings_start_date: (row.findings_start_date || "").trim() || null,
    findings_end_date: (row.findings_end_date || "").trim() || null,
    naics_code: (row.naics_code || "").trim() || null,
    flsa: (row.act_id_flsa || "").trim().toUpperCase() === "Y",
  };
}

function toInt(v) {
  if (v == null || v === "") return 0;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
function toFloat(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function buildSnapshot(rows) {
  return {
    source: "dol-whd-violations",
    source_url: "https://enforcedata.dol.gov/views/data_summary.php",
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    case_count: rows.length,
    total_back_wages_usd: rows.reduce((s, r) => s + (r.back_wages_usd || 0), 0),
    total_employees_affected: rows.reduce((s, r) => s + (r.employees_affected || 0), 0),
    total_civil_penalty_usd: rows.reduce((s, r) => s + (r.civil_penalty_usd || 0), 0),
    cases: rows,
  };
}

async function fetchCsv() {
  const res = await fetch(DEFAULT_CSV_URL, { headers: { "User-Agent": UA, "Accept": "text/csv" } });
  if (!res.ok) throw new Error(`DOL WHD ${res.status} ${res.statusText}`);
  return res.text();
}

function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--fixture") out.fixture = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`DOL WHD fetcher starting... (${args.fixture ? "FIXTURE" : "LIVE"})`);

  const csv = args.fixture
    ? await fs.readFile(FIXTURE, "utf-8")
    : await fetchCsv();

  let rows = parseCSV(csv).map(parseWhdRow);
  if (args.limit && args.limit > 0) rows = rows.slice(0, args.limit);

  const snap = buildSnapshot(rows);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap.case_count} cases, $${(snap.total_back_wages_usd/1e6).toFixed(2)}M back wages)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("dol-whd-violations-fetch failed:", err);
    process.exit(1);
  });
}
