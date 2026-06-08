#!/usr/bin/env node
/**
 * DW-7 — OFAC SDN (Specially Designated Nationals) — daily snapshot.
 *
 * Treasury publishes the full SDN list as a flat CSV at:
 *   https://www.treasury.gov/ofac/downloads/sdn.csv
 *
 * The CSV uses positional placeholders like "-0-" for missing fields and
 * keeps the rich metadata (DOB, nationality, alt-names, vessel info) in a
 * free-text Remarks column. We retain the raw row + a couple of extracted
 * fields (name, type, program) — the merger does the brand-name matching.
 *
 * Output (per-day raw snapshot):
 *   data/raw/ofac-sdn/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N    cap rows emitted (debug)
 *   --out PATH   write to a specific path instead of the dated raw file
 *   --fixture    parse the bundled fixture CSV instead of hitting the network
 *
 * Runs daily via .github/workflows/ofac-sdn-daily.yml.
 *
 * No API key required. No auth.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV, todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ofac-sdn");
const FIXTURE = path.join(__dirname, "fixtures/ofac-sdn/sample.csv");

export const SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const UA = "TruNorth-OFAC-SDN/1.0 (+https://www.trunorthapp.com)";

// SDN CSV ships WITHOUT a header row; columns are positional. Order taken
// from https://www.treasury.gov/ofac/downloads/readme.txt
const SDN_COLUMNS = [
  "ent_num", "SDN_Name", "SDN_Type", "Program", "Title",
  "Call_Sign", "Vess_type", "Tonnage", "GRT", "Vess_flag",
  "Vess_owner", "Remarks",
];

/** Treasury uses "-0-" everywhere for null. Normalise to empty string. */
export function denull(v) {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "-0-" ? "" : s;
}

/**
 * Parse a parsed-CSV row (object keyed by header) into our shape.
 * Tolerates BOTH header-prefixed CSV (our fixture) AND header-less SDN
 * (production), where we will have pre-mapped positional columns to header
 * names before calling.
 */
export function parseSdnRow(row) {
  const name = denull(row.SDN_Name);
  const type = denull(row.SDN_Type).toLowerCase(); // "entity" | "individual" | "vessel" | "aircraft"
  const program = denull(row.Program);
  const remarks = denull(row.Remarks);
  return {
    ent_num: denull(row.ent_num),
    name,
    type,
    program,
    remarks,
    // The CSV doesn't have a stable "sanction date" column for older entries;
    // for recent entries Treasury embeds it inside Remarks as "Listing date".
    sanction_date: extractListingDate(remarks),
  };
}

/** Pull "Listing date 16 Mar 2022" → "2022-03-16" if present. */
export function extractListingDate(remarks) {
  if (!remarks) return null;
  const m = remarks.match(/Listing date[: ]+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i);
  if (!m) return null;
  const MON = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06",
                jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
  const mm = MON[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

/**
 * Build the snapshot envelope. Filters out individuals (we only ever
 * merge entity-type matches against consumer brands; the individual
 * records bloat the file by ~10x with no signal).
 */
export function buildSnapshot(rows) {
  const entities = rows.filter(r => r.type === "entity" || r.type === "vessel" || r.type === "aircraft");
  return {
    source: "ofac-sdn",
    source_url: SDN_URL,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    total_rows: rows.length,
    entity_rows: entities.length,
    individual_rows: rows.length - entities.length,
    entities,
  };
}

async function fetchSdnCsv() {
  const res = await fetch(SDN_URL, { headers: { "User-Agent": UA, "Accept": "text/csv" } });
  if (!res.ok) throw new Error(`OFAC SDN ${res.status} ${res.statusText}`);
  return res.text();
}

/** Convert header-less SDN CSV into header-prefixed rows. */
function parseSdnCsv(text) {
  // Treasury's sdn.csv ships header-less. We synthesise one then parse.
  const synthHeader = SDN_COLUMNS.join(",") + "\n";
  return parseCSV(synthHeader + text);
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
  console.log(`OFAC SDN fetcher starting... (${args.fixture ? "FIXTURE" : "LIVE"})`);

  let csvText;
  if (args.fixture) {
    csvText = await fs.readFile(FIXTURE, "utf-8");
  } else {
    csvText = await fetchSdnCsv();
  }

  let rawRows;
  if (args.fixture) {
    // Fixture has a header row; parse directly.
    rawRows = parseCSV(csvText);
  } else {
    rawRows = parseSdnCsv(csvText);
  }

  let parsed = rawRows.map(parseSdnRow);
  if (args.limit && args.limit > 0) parsed = parsed.slice(0, args.limit);

  const snap = buildSnapshot(parsed);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  total=${snap.total_rows} entities=${snap.entity_rows} individuals=${snap.individual_rows}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ofac-sdn-fetch failed:", err);
    process.exit(1);
  });
}
