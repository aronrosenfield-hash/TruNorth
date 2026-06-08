#!/usr/bin/env node
/**
 * DOL OFLC LCA (H-1B Labor Condition Application) disclosure data — quarterly.
 *
 * OFLC publishes quarterly LCA disclosure XLSX files at the Foreign Labor
 * Performance page:
 *
 *   Landing: https://www.dol.gov/agencies/eta/foreign-labor/performance
 *   Files:   https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/
 *              LCA_Disclosure_Data_FY<YYYY>_Q<1-4>.xlsx
 *
 * Each row = one LCA. ~600K rows per quarter, ~90 columns. We never persist
 * raw rows — we stream the XLSX and aggregate per-employer counts in memory.
 *
 * Captured per employer (after aggregation):
 *   - employer_name (uppercase, as filed)
 *   - lca_count (total filings)
 *   - certified_count (CASE_STATUS = CERTIFIED)
 *   - denied_count, withdrawn_count
 *   - avg_wage_offered (weighted by total_workers when present, USD/year)
 *   - top_occupations (top 5 SOC titles by filing count)
 *   - fiscal_year (e.g. "FY2025")
 *
 * Output:
 *   data/raw/dol-oflc-lca/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --url URL    explicit XLSX URL (overrides DOL_LCA_XLSX_URL env + auto-pick)
 *   --in PATH    local XLSX file (skip download — useful for repro)
 *   --out PATH   override output path
 *   --limit N    cap rows processed (debug)
 *   --fixture    use scripts/fixtures/dol-oflc-lca/sample.csv (CSV shape,
 *                same columns as the XLSX — used by tests + dry runs)
 *
 * Public-domain dataset (US Federal Government, 17 U.S.C. § 105).
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseCSV, todayUTC } from "./lib/csv-mini.mjs";
import { readXlsxRows } from "./lib/xlsx-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/dol-oflc-lca");
const FIXTURE = path.join(__dirname, "fixtures/dol-oflc-lca/sample.csv");

export const LANDING_URL = "https://www.dol.gov/agencies/eta/foreign-labor/performance";
const FILE_BASE = "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs";
const UA = "TruNorth-DOL-OFLC/1.0 (+https://www.trunorthapp.com)";

/** Pick the most recent (FY, Q) combo whose XLSX exists. */
export function defaultXlsxUrl(now = new Date()) {
  // OFLC fiscal year ends Sep 30. We don't know which Q is published yet, so
  // we let the workflow override DOL_LCA_XLSX_URL when a new one appears.
  // Default = most recent Q4 of the prior fiscal year (always exists).
  // Fiscal Year N = Oct (N-1) .. Sep N.
  const m = now.getUTCMonth() + 1; // 1..12
  const y = now.getUTCFullYear();
  const fy = m >= 10 ? y + 1 : y;
  // Default to the most recent completed fiscal year's Q4.
  const completedFy = m >= 10 ? fy - 1 : fy - 1;
  return `${FILE_BASE}/LCA_Disclosure_Data_FY${completedFy}_Q4.xlsx`;
}

/**
 * The LCA disclosure files use these column names (FY2020+, FLAG schema).
 * Names are stable across quarters. We tolerate case + minor variants.
 */
const COL = {
  status: ["CASE_STATUS"],
  employer: ["EMPLOYER_NAME", "EMPLOYER_NAME_1"],
  wageFrom: ["WAGE_RATE_OF_PAY_FROM", "WAGE_RATE_OF_PAY_FROM_1"],
  wageUnit: ["WAGE_UNIT_OF_PAY", "WAGE_UNIT_OF_PAY_1"],
  workers: ["TOTAL_WORKER_POSITIONS", "TOTAL_WORKERS"],
  soc: ["SOC_TITLE", "JOB_TITLE"],
  visa: ["VISA_CLASS"],
  decision: ["DECISION_DATE"],
};

function pick(row, candidates) {
  for (const k of candidates) {
    if (row[k] != null && row[k] !== "") return row[k];
    // case-insensitive fallback
    const found = Object.keys(row).find((rk) => rk.toUpperCase() === k.toUpperCase());
    if (found && row[found] !== "") return row[found];
  }
  return "";
}

function toFloat(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toInt(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Math.trunc(v);
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize wage to annual USD. */
export function annualizeWage(amount, unit) {
  const n = toFloat(amount);
  if (!n) return 0;
  const u = String(unit || "").trim().toUpperCase();
  if (!u || u.startsWith("Y") || u === "ANNUAL") return n;
  if (u.startsWith("M")) return n * 12;      // Month
  if (u.startsWith("B")) return n * 26;      // Bi-weekly
  if (u.startsWith("W")) return n * 52;      // Week
  if (u.startsWith("H")) return n * 2080;    // Hour (40h × 52w)
  return n;
}

/**
 * Per-row update of a Map<string, EmployerAgg>.
 *
 * Aggregation is online — we never hold all rows. The Map keys are the
 * normalized (upper-trimmed) employer name; the value records counts
 * and a small bag of top occupations.
 */
export function ingestRow(row, agg) {
  const employer = String(pick(row, COL.employer) || "").trim();
  if (!employer) return;
  const visa = String(pick(row, COL.visa) || "H-1B").trim().toUpperCase();
  // OFLC LCA files contain H-1B, H-1B1 (Chile/Singapore), and E-3 (Australia).
  // All are "H-1B-family" temporary work visas filed via Form ETA-9035. Keep
  // them all (and drop completely empty rows, which the XLSX trails with).
  if (!visa) return;
  if (!(/^H-1B/.test(visa) || /^E-3/.test(visa))) return;

  const key = employer.toUpperCase();
  let e = agg.get(key);
  if (!e) {
    e = {
      employer_name: employer,
      lca_count: 0,
      certified_count: 0,
      denied_count: 0,
      withdrawn_count: 0,
      wage_sum: 0,
      wage_weighted_sum: 0,
      wage_weights: 0,
      wage_n: 0,
      occupations: new Map(),
      visa_classes: new Map(),
    };
    agg.set(key, e);
  }
  e.lca_count += 1;
  const status = String(pick(row, COL.status) || "").trim().toUpperCase();
  if (status === "CERTIFIED" || status === "CERTIFIED-EXPIRED") e.certified_count += 1;
  else if (status === "DENIED") e.denied_count += 1;
  else if (status === "WITHDRAWN" || status === "CERTIFIED-WITHDRAWN") e.withdrawn_count += 1;

  const wage = annualizeWage(pick(row, COL.wageFrom), pick(row, COL.wageUnit));
  const workers = Math.max(1, toInt(pick(row, COL.workers)));
  if (wage > 0) {
    e.wage_sum += wage;
    e.wage_n += 1;
    e.wage_weighted_sum += wage * workers;
    e.wage_weights += workers;
  }
  const soc = String(pick(row, COL.soc) || "").trim();
  if (soc) e.occupations.set(soc, (e.occupations.get(soc) || 0) + 1);
  if (visa) e.visa_classes.set(visa, (e.visa_classes.get(visa) || 0) + 1);
}

export function finalizeAgg(agg, { fiscalYear, sourceUrl }) {
  const employers = [];
  for (const e of agg.values()) {
    const avgWage = e.wage_weights > 0
      ? Math.round(e.wage_weighted_sum / e.wage_weights)
      : (e.wage_n > 0 ? Math.round(e.wage_sum / e.wage_n) : 0);
    const top = [...e.occupations.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, count]) => ({ title, count }));
    employers.push({
      employer_name: e.employer_name,
      lca_count: e.lca_count,
      certified_count: e.certified_count,
      denied_count: e.denied_count,
      withdrawn_count: e.withdrawn_count,
      avg_wage_offered_usd: avgWage,
      wage_sample_size: e.wage_n,
      top_occupations: top,
      visa_classes: [...e.visa_classes.entries()].sort((a, b) => b[1] - a[1])
        .map(([v, n]) => ({ visa: v, count: n })),
      fiscal_year: fiscalYear,
    });
  }
  employers.sort((a, b) => b.lca_count - a.lca_count);
  return employers;
}

export function buildSnapshot(employers, { fiscalYear, sourceUrl, fileName }) {
  return {
    source: "dol-oflc-lca",
    source_url: sourceUrl,
    landing_url: LANDING_URL,
    file_name: fileName,
    fiscal_year: fiscalYear,
    license: "US public domain (17 U.S.C. § 105)",
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    employer_count: employers.length,
    total_lcas: employers.reduce((s, e) => s + e.lca_count, 0),
    total_certified: employers.reduce((s, e) => s + e.certified_count, 0),
    employers,
  };
}

function parseArgs(argv) {
  const out = { url: null, in: null, outPath: null, limit: null, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") out.url = argv[++i];
    else if (argv[i] === "--in") out.in = argv[++i];
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--fixture") out.fixture = true;
  }
  return out;
}

function fyFromUrl(url) {
  const m = /FY(\d{4})(?:_Q(\d))?/i.exec(url || "");
  return m ? `FY${m[1]}${m[2] ? `_Q${m[2]}` : ""}` : "unknown";
}

async function downloadTo(url, destPath) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "*/*", "Referer": LANDING_URL },
  });
  if (!res.ok) throw new Error(`DOL OFLC LCA ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
  return buf.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || process.env.DOL_LCA_XLSX_URL || defaultXlsxUrl();
  const mode = args.fixture ? "FIXTURE" : (args.in ? "LOCAL" : "LIVE");
  console.log(`DOL OFLC LCA fetcher starting... (${mode})`);

  const agg = new Map();
  let rowsSeen = 0;
  let fiscalYear = "unknown";
  let sourceUrl = url;
  let fileName = "fixture";

  if (args.fixture) {
    const text = await fs.readFile(FIXTURE, "utf-8");
    const rows = parseCSV(text);
    for (const row of rows) {
      if (args.limit && rowsSeen >= args.limit) break;
      ingestRow(row, agg);
      rowsSeen++;
    }
    fiscalYear = "FIXTURE";
    sourceUrl = "fixture://scripts/fixtures/dol-oflc-lca/sample.csv";
    fileName = "sample.csv";
  } else {
    let xlsxPath = args.in;
    if (!xlsxPath) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lca-"));
      xlsxPath = path.join(tmpDir, path.basename(url));
      console.log(`Downloading ${url} ...`);
      const bytes = await downloadTo(url, xlsxPath);
      console.log(`Downloaded ${(bytes / 1e6).toFixed(1)} MB`);
    } else {
      console.log(`Using local file ${xlsxPath}`);
    }
    fileName = path.basename(xlsxPath);
    fiscalYear = fyFromUrl(args.in ? fileName : url);
    await readXlsxRows(xlsxPath, {
      sheet: 1,
      onRow: (row) => {
        if (args.limit && rowsSeen >= args.limit) return;
        ingestRow(row, agg);
        rowsSeen++;
      },
    });
  }

  console.log(`Ingested ${rowsSeen} rows → ${agg.size} distinct employers`);
  const employers = finalizeAgg(agg, { fiscalYear, sourceUrl });
  const snap = buildSnapshot(employers, { fiscalYear, sourceUrl, fileName });

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap.employer_count} employers, ${snap.total_lcas} LCAs, ${snap.total_certified} certified)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("dol-oflc-lca-fetch failed:", err);
    process.exit(1);
  });
}
