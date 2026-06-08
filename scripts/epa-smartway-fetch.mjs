#!/usr/bin/env node
/**
 * EPA SmartWay Carrier Partner List — quarterly.
 *
 * EPA's SmartWay Transport Partnership publishes a public list of freight
 * carriers (truck, rail, multimodal, barge) that have committed to and
 * report against the program's clean-trucking efficiency standards.
 * ~3,800 active carrier partners.
 *
 *   https://www.epa.gov/smartway/smartway-carrier-partner-list
 *
 * The partner list is offered as a downloadable XLSX (and historically
 * CSV) on the EPA SmartWay site. EPA does not currently expose a stable
 * machine-readable JSON endpoint, so this pipeline:
 *
 *   1. (live mode) GETs the published CSV/XLSX export URL when it
 *      resolves and parses CSV via scripts/lib/csv-mini.mjs.
 *   2. (default) reads the bundled fixture which mirrors the EPA export
 *      columns: Partner Name, Parent Company, Fleet Size, Partnership
 *      Year, Partnership Tier.
 *
 * License: US federal public domain (EPA SmartWay).
 *
 * Output:
 *   data/raw/epa-smartway/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N       cap rows (debugging)
 *   --out PATH      override output path
 *   --fixture       force fixture mode (skip network)
 *   --csv PATH      read a local CSV file instead of fixture/network
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayUTC } from "./lib/csv-mini.mjs";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/epa-smartway");
const FIXTURE = path.join(__dirname, "fixtures/epa-smartway/sample.csv");

export const SOURCE_URL =
  "https://www.epa.gov/smartway/smartway-carrier-partner-list";
// EPA periodically rotates the published CSV slug. Production should
// resolve the canonical export link from the page above; we keep a
// best-known direct link as a hint.
export const CSV_HINT_URL =
  "https://www.epa.gov/system/files/documents/smartway-carrier-partner-list.csv";

const UA = "TruNorth-EpaSmartWay/1.0 (+https://www.trunorthapp.com)";

/* ---------------------------- normalization ----------------------------- */

function toInt(v) {
  if (v == null || v === "") return null;
  const n = parseInt(String(v).replace(/[, ]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  return "";
}

export function normalizeCarrier(row) {
  return {
    carrier_name: pick(row, "Partner Name", "Carrier Name", "Company Name", "Partner"),
    parent_company: pick(row, "Parent Company", "Parent", "Holding Company"),
    fleet_size: toInt(pick(row, "Fleet Size", "Number of Trucks", "Vehicles", "Truck Count")),
    partnership_year: toInt(pick(row, "Partnership Year", "Partner Since", "Year Joined", "Join Year")),
    partnership_tier: pick(row, "Partnership Tier", "Tier", "Partner Type", "Category"),
  };
}

export function buildSnapshot(carriers) {
  return {
    source: "epa-smartway",
    source_url: SOURCE_URL,
    license: "US federal public domain (EPA SmartWay)",
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    carrier_count: carriers.length,
    carriers,
  };
}

/* ------------------------------- network -------------------------------- */

async function fetchCsv(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/csv,application/octet-stream;q=0.8,*/*;q=0.5" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`EPA SmartWay ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  if (!/text\/csv|application\/(octet-stream|vnd\.ms-excel)/i.test(ct) && !ct.includes("text/plain")) {
    throw new Error(`Unexpected content-type for SmartWay CSV: ${ct}`);
  }
  return res.text();
}

/* --------------------------------- args --------------------------------- */

function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: false, csvPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--fixture") out.fixture = true;
    else if (argv[i] === "--csv") out.csvPath = argv[++i];
  }
  return out;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.fixture ? "FIXTURE" : args.csvPath ? "LOCAL-CSV" : "LIVE";
  console.log(`EPA SmartWay fetcher starting... (${mode})`);

  let csvText = "";
  if (args.fixture) {
    csvText = await fs.readFile(FIXTURE, "utf-8");
  } else if (args.csvPath) {
    csvText = await fs.readFile(args.csvPath, "utf-8");
  } else {
    try {
      csvText = await fetchCsv(CSV_HINT_URL);
    } catch (err) {
      console.warn(`Live CSV fetch failed (${err.message}) — falling back to fixture.`);
      csvText = await fs.readFile(FIXTURE, "utf-8");
    }
  }

  const rows = parseCSVToObjects(csvText);
  let carriers = rows.map(normalizeCarrier).filter(c => c.carrier_name);

  if (args.limit && args.limit > 0) carriers = carriers.slice(0, args.limit);

  const snap = buildSnapshot(carriers);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap.carrier_count} carriers)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("epa-smartway-fetch failed:", err);
    process.exit(1);
  });
}
