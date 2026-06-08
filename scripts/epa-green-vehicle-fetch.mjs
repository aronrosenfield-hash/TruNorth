#!/usr/bin/env node
/**
 * EPA Green Vehicle Guide + ZEV eligibility — annual.
 *
 * The EPA / DOE jointly publish fueleconomy.gov, which mirrors the entire
 * Green Vehicle Guide as a downloadable CSV (40k+ vehicle variants going
 * back to 1984). The dataset is US public domain.
 *
 *   Landing page: https://www.fueleconomy.gov/feg/download.shtml
 *   CSV (gzip):   https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip
 *   Single CSV:   https://www.fueleconomy.gov/feg/epadata/vehicles.csv
 *
 * Per-vehicle fields we keep (all already in the upstream CSV):
 *   - make, model, year
 *   - fuelType1 / fuelType2 / atvType   (used to derive EV / PHEV / hybrid)
 *   - comb08                            (combined MPG, gas equivalent)
 *   - combE                             (combined MPGe — populated for EVs/PHEVs)
 *   - co2TailpipeGpm                    (grams of CO2 per mile, tailpipe)
 *   - zevEligible                       (DERIVED — see isZevEligible below)
 *
 * ZEV eligibility (CARB + EPA Tier 3 Bin 0):
 *   A vehicle is ZEV-eligible if its tailpipe CO2 is 0 g/mi and it has no
 *   conventional fuel pathway. In the fueleconomy.gov schema that is:
 *     - fuelType1 === "Electricity" (battery EV), OR
 *     - fuelType1 === "Hydrogen"    (fuel-cell EV)
 *   PHEVs are EXPLICITLY NOT ZEV-eligible — CARB classifies them under
 *   Transitional ZEV (TZEV). We tag them separately as "is_phev".
 *
 * Output:
 *   data/raw/epa-green-vehicle/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N      cap rows (for testing)
 *   --out PATH     override output path
 *   --fixture      read bundled fixture instead of hitting the network
 *   --year YYYY    only keep vehicles with model year >= YYYY
 *                  (default: current calendar year - 5)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";
import { todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/epa-green-vehicle");
const FIXTURE = path.join(__dirname, "fixtures/epa-green-vehicle/sample.csv");

export const DOWNLOAD_PAGE = "https://www.fueleconomy.gov/feg/download.shtml";
export const CSV_URL       = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv";

const UA = "TruNorth-EPAGreenVehicle/1.0 (+https://www.trunorthapp.com)";

// ─────────────────────────────────────── derivations ──

/**
 * EV (battery) when fuelType1 is Electricity AND there's no secondary
 * conventional fuel pathway (so PHEVs that have Electricity in fuelType2
 * are correctly excluded).
 */
export function isEV(row) {
  return (
    String(row.fuelType1 || "").toLowerCase() === "electricity" &&
    !row.fuelType2
  );
}

/**
 * Hydrogen fuel-cell EV — also zero tailpipe, also ZEV-eligible.
 */
export function isFCEV(row) {
  return String(row.fuelType1 || "").toLowerCase() === "hydrogen";
}

/**
 * Plug-in hybrid — burns gas AND charges from the grid. CARB calls this
 * TZEV (Transitional ZEV); it is NOT ZEV-eligible.
 */
export function isPHEV(row) {
  const atv = String(row.atvType || "").toLowerCase();
  if (atv.includes("plug-in hybrid")) return true;
  // Older rows used the boolean `phevBlended` column without an atvType.
  if (row.phevBlended === true || row.phevBlended === "true") return true;
  return false;
}

/**
 * Conventional hybrid (non-pluggable, e.g. Prius LE).
 */
export function isHybrid(row) {
  const atv = String(row.atvType || "").toLowerCase();
  return atv === "hybrid";
}

/**
 * Anything electrified: EV, FCEV, PHEV, or HEV.
 */
export function isElectrified(row) {
  return isEV(row) || isFCEV(row) || isPHEV(row) || isHybrid(row);
}

/**
 * CARB ZEV eligibility: battery-EV or fuel-cell EV. Tailpipe must be 0 g/mi.
 */
export function isZevEligible(row) {
  if (!(isEV(row) || isFCEV(row))) return false;
  const co2 = Number(row.co2TailpipeGpm);
  // Empty / unknown CO2 → trust the fuel-type classification. Real 0
  // values from the CSV also pass.
  if (Number.isFinite(co2) && co2 > 0) return false;
  return true;
}

function toInt(v) {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function toFloat(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Take a raw upstream CSV row (already an object via parseCSVToObjects)
 * and return a compact, typed record we can serialize 40k times without
 * the file blowing past a few MB.
 */
export function normalizeRow(row) {
  const ev = isEV(row);
  const fcev = isFCEV(row);
  const phev = isPHEV(row);
  const hybrid = isHybrid(row);
  // Combined MPGe: per the fueleconomy.gov data dictionary, comb08 is
  // already MPG-equivalent for the primary fuel type (so battery-EVs
  // already report MPGe here, ~100-130). combE is kWh per 100 miles
  // (electricity *consumption*), NOT a fuel-economy figure — don't use
  // it for our MPGe rollup or Rivians look slower than a Camry.
  // For PHEVs we still take comb08 (gasoline MPG); the electric portion
  // is captured by the is_phev flag separately.
  const mpge = toInt(row.comb08);
  return {
    make: String(row.make || "").trim(),
    model: String(row.model || "").trim(),
    year: toInt(row.year),
    fuel_type: String(row.fuelType1 || "").trim(),
    mpge,
    co2_g_per_mi: toFloat(row.co2TailpipeGpm),
    is_ev: ev,
    is_fcev: fcev,
    is_phev: phev,
    is_hybrid: hybrid,
    zev_eligible: isZevEligible(row),
  };
}

export function buildSnapshot(vehicles, sourceUrl = CSV_URL) {
  const evCount = vehicles.filter(v => v.is_ev || v.is_fcev).length;
  const zevCount = vehicles.filter(v => v.zev_eligible).length;
  return {
    source: "epa-green-vehicle",
    source_url: sourceUrl,
    license: "US public domain (EPA / DOE fueleconomy.gov)",
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    vehicle_count: vehicles.length,
    ev_count: evCount,
    zev_eligible_count: zevCount,
    vehicles,
  };
}

// ─────────────────────────────────────── network ──

async function fetchCSV(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/csv,*/*" },
  });
  if (!res.ok) throw new Error(`EPA Green Vehicle ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: false, year: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--fixture") out.fixture = true;
    else if (argv[i] === "--year") out.year = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const minYear = args.year ?? (new Date().getUTCFullYear() - 5);
  console.log(`EPA Green Vehicle fetcher starting... (${args.fixture ? "FIXTURE" : "LIVE"}, year>=${minYear})`);

  let csvText;
  let sourceUrl = CSV_URL;
  if (args.fixture) {
    csvText = await fs.readFile(FIXTURE, "utf-8");
    sourceUrl = `file://${FIXTURE}`;
  } else {
    try {
      csvText = await fetchCSV(CSV_URL);
    } catch (err) {
      console.warn(`Live CSV fetch failed (${err.message}) — falling back to fixture.`);
      csvText = await fs.readFile(FIXTURE, "utf-8");
      sourceUrl = `file://${FIXTURE}`;
    }
  }

  const rows = parseCSVToObjects(csvText);
  let vehicles = rows.map(normalizeRow)
    .filter(v => v.make && v.model)
    .filter(v => v.year == null || v.year >= minYear);

  if (args.limit && args.limit > 0) vehicles = vehicles.slice(0, args.limit);

  const snap = buildSnapshot(vehicles, sourceUrl);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(
    `Wrote ${outPath} (${snap.vehicle_count} vehicles, ${snap.ev_count} EV/FCEV, ${snap.zev_eligible_count} ZEV-eligible)`
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("epa-green-vehicle-fetch failed:", err);
    process.exit(1);
  });
}
