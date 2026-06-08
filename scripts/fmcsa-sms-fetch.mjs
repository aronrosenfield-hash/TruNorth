#!/usr/bin/env node
/**
 * FMCSA SMS — Safety Measurement System (monthly).
 *
 * Every US motor carrier with a USDOT number gets a monthly safety scorecard
 * across the seven FMCSA "Behavior Analysis and Safety Improvement Categories"
 * (BASICs). This pipeline ingests the monthly bulk snapshot and maps it onto
 * TruNorth slugs so brands like Amazon Logistics, FedEx, UPS, Walmart
 * Transportation, JB Hunt, Schneider, etc. carry a `labor.fmcsaSafetyScores`
 * signal in their company file.
 *
 * BASICs captured (each is a 0-100 percentile rank within the carrier's
 * safety-event group — HIGHER = WORSE relative to peers):
 *
 *   - unsafeDriving         (speeding, reckless, lane changes, texting)
 *   - hoursOfService        (drive-time / rest violations)
 *   - vehicleMaintenance    (brakes, tires, lights, defects)
 *   - controlledSubstances  (alcohol & drug testing failures)
 *   - hazmat                (HazMat handling — visibility restricted on some)
 *   - crashIndicator        (state-reportable crashes — visibility restricted)
 *
 * Also captured per-carrier:
 *
 *   - dotNumber             USDOT primary key
 *   - carrierName, parentName, city, state
 *   - fleetSize, driverCount
 *   - outOfServiceRate      % of roadside inspections resulting in OOS order
 *   - alertCount            BASICs above the FMCSA Intervention Threshold
 *
 * ── SOURCE ENDPOINTS (FMCSA Data Dissemination Program, public domain) ──
 *
 *   SMS landing page:
 *     https://ai.fmcsa.dot.gov/SMS/
 *   Catalog & request page:
 *     https://www.fmcsa.dot.gov/registration/fmcsa-data-dissemination-program
 *   Monthly SMS results (the canonical "SMS Pass/Property" data set):
 *     https://ai.fmcsa.dot.gov/SMS/files/SMS_AQ_PassProperty.zip
 *   Census-level carrier registry (for parent + fleet size join):
 *     https://ai.fmcsa.dot.gov/SMS/files/SMS_AQ_CensusCarrierData.zip
 *
 * SOURCE REALITY (2026-06): the SMS landing page itself loads from a Cloudflare-
 * fronted host; the bulk ZIPs are large (Pass/Property is ~300MB; Census is
 * ~50MB) and FMCSA historically rate-limits anonymous downloads to a handful
 * per IP per day. The official Data Dissemination Program also distributes the
 * same files via SFTP to registered users; that path is preferable for CI but
 * requires a one-time email registration that's out-of-scope for this PR.
 *
 * We therefore follow the codebase convention used by PHMSA / Brazil Lista
 * Suja / DOL WHD: a `--dry` mode that reads the most recent snapshot from
 * `data/raw/fmcsa-sms/` (or emits a synthetic preview keyed to known carrier
 * names), and a `--apply` mode that performs the real network fetch + stream-
 * parse. Both write `data/raw/fmcsa-sms/<YYYY-MM>.json`.
 *
 * The real-fetch path tries Pass/Property first (richer — BASICs included);
 * Census is used to backfill parentName / fleetSize when Pass/Property is
 * partial. If both URLs 403 from CI (Akamai/Cloudflare TLS-fingerprint
 * fingerprinting) we surface the failure and exit non-zero so the workflow
 * doesn't silently produce an empty merge.
 *
 * Stream-parsing is implemented in-process — we don't load the whole TXT
 * into a single string. The ZIPs use STORE or DEFLATE methods, both of
 * which the system `unzip` binary handles. We shell out to `unzip` for the
 * extraction step (same pattern as msha-fetch.mjs / dol-whd-fetch.mjs) and
 * stream-read the extracted TXT line-by-line.
 *
 * Flags:
 *   --apply        — perform the real network fetch and write the snapshot.
 *   --dry          — (default) read the most recent snapshot in data/raw/
 *                    if present, otherwise emit a synthetic 12-row preview
 *                    covering known large carriers (Amazon/FedEx/UPS/...).
 *   --out PATH     — write to PATH instead of the default snapshot path.
 *   --max N        — cap parsed rows at N (for spot-checks; 0 = unlimited).
 *
 * Locally:
 *   node scripts/fmcsa-sms-fetch.mjs                  # dry
 *   node scripts/fmcsa-sms-fetch.mjs --apply          # real fetch (300MB+)
 *   node scripts/fmcsa-sms-fetch.mjs --apply --out /tmp/test.json
 *
 * License: US Federal public-domain (49 USC 504, FMCSA Data Dissemination
 * Program). No attribution required, but we tag every record with
 * `_license` for downstream traceability.
 */

import fs from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/fmcsa-sms");

const LANDING_URL = "https://ai.fmcsa.dot.gov/SMS/";
const PASS_PROPERTY_ZIP =
  "https://ai.fmcsa.dot.gov/SMS/files/SMS_AQ_PassProperty.zip";
const CENSUS_ZIP =
  "https://ai.fmcsa.dot.gov/SMS/files/SMS_AQ_CensusCarrierData.zip";

const UA =
  "TruNorth-FMCSA-SMS/1.0 (+https://www.trunorthapp.com; contact@trunorthapp.com)";
const REQUEST_TIMEOUT_MS = 15 * 60_000; // 15 min for ~300MB downloads
const LICENSE_TAG =
  "US Federal public-domain (49 USC 504, FMCSA Data Dissemination Program)";

// ─────────────────────────── CLI ────────────────────────────────────
const argv = process.argv.slice(2);
function flagArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const OUT_PATH = flagArg("--out");
const MAX_ROWS = Number(flagArg("--max") || 0);

// ─────────────────────────── normalization ──────────────────────────

/**
 * Uppercase, strip punctuation, collapse whitespace, drop common US
 * corporate suffixes. Used for both carrier-name → slug routing and
 * for dedup keys.
 */
export function normalizeName(s) {
  if (s == null) return "";
  let out = String(s).toUpperCase();
  out = out
    .replace(/[.,'’"`/&()-]/g, " ")
    .replace(/\b(LLC|LP|LLP|INC|CORP|CO|CORPORATION|COMPANY|LTD|LIMITED|HOLDINGS|GROUP|ENTERPRISES|SERVICES|SYSTEM|SYSTEMS|TRANSPORT|TRANSPORTATION|LOGISTICS|FREIGHT|TRUCKING|EXPRESS|CARRIERS|CARRIER)\b/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/**
 * Parse a numeric field from FMCSA's text dumps — handles "", "N/A",
 * percent symbols, and embedded commas. Returns null on any failure.
 */
export function parseNum(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (str === "" || /^(n\/?a|null|none)$/i.test(str)) return null;
  const n = Number(str.replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a BASIC percentile. FMCSA encodes "no data" as either an empty
 * field OR a sentinel like "-1" / "999". Anything outside 0..100 → null.
 */
export function parseBasic(s) {
  const n = parseNum(s);
  if (n == null) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/**
 * Map a row from FMCSA's tab/pipe-delimited text into our canonical shape.
 * The actual column names vary between releases ("BASIC_PCT_UNSAFE",
 * "UnsafeDrivingPercentile", etc.) so we look for several aliases.
 *
 * The `row` arg is an object keyed by lower-case header name.
 */
export function shapeRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
      const kl = k.toLowerCase();
      for (const rk of Object.keys(row)) {
        if (rk.toLowerCase() === kl && row[rk] != null && String(row[rk]).trim() !== "") {
          return String(row[rk]).trim();
        }
      }
    }
    return "";
  };

  const dotNumber = get("dot_number", "dotnumber", "usdot", "dot");
  if (!dotNumber) return null;

  const carrierName = get(
    "legal_name", "legalname", "carrier_name", "carriername", "name", "dba_name",
  );
  if (!carrierName) return null;

  const parentName = get(
    "parent_name", "parentname", "parent_dot_legal_name", "parent_legal_name",
  ) || carrierName;

  return {
    dotNumber: String(dotNumber).replace(/\D+/g, ""),
    carrierName,
    parentName,
    city: get("city", "phy_city", "physical_city"),
    state: get("state", "phy_state", "physical_state"),
    fleetSize: parseNum(get("total_power_units", "power_units", "fleet_size", "totalpowerunits")),
    driverCount: parseNum(get("total_drivers", "driver_count", "totaldrivers")),
    outOfServiceRate: parseNum(get(
      "vehicle_oos_pct", "veh_oos_rate", "oos_rate", "out_of_service_rate",
    )),
    basics: {
      unsafeDriving:        parseBasic(get("unsafe_driving_percentile", "unsafedrivingpercentile", "basic_pct_unsafe")),
      hoursOfService:       parseBasic(get("hos_compliance_percentile", "hourofservicepercentile", "hoursofservicepercentile", "basic_pct_hos")),
      vehicleMaintenance:   parseBasic(get("vehicle_maint_percentile", "vehiclemaintpercentile", "vehiclemaintenancepercentile", "basic_pct_veh")),
      controlledSubstances: parseBasic(get("controlled_subst_percentile", "controlledsubstancespercentile", "basic_pct_drug")),
      hazmat:               parseBasic(get("hm_compliance_percentile", "hazmatcompliancepercentile", "hazmatpercentile", "basic_pct_hm")),
      crashIndicator:       parseBasic(get("crash_indicator_percentile", "crashindicatorpercentile", "basic_pct_crash")),
    },
    alertCount: parseNum(get("alert_count", "alertcount", "ntl_alert_count")) ?? 0,
  };
}

// ─────────────────────────── delimited parser ───────────────────────

/**
 * Pick a delimiter from the header line. FMCSA Pass/Property historically
 * ships pipe-delimited (`|`); other DDP files ship tab-delimited. We sniff
 * by counting candidates in the first line and picking the winner.
 */
export function sniffDelimiter(headerLine) {
  const cands = [
    { c: "\t", n: (headerLine.match(/\t/g) || []).length },
    { c: "|",  n: (headerLine.match(/\|/g) || []).length },
    { c: ",",  n: (headerLine.match(/,/g) || []).length },
  ];
  cands.sort((a, b) => b.n - a.n);
  return cands[0].n > 0 ? cands[0].c : "|";
}

/**
 * Stream-parse a delimited text file. Yields shaped row objects (after
 * shapeRow). Skips header. Stops at `maxRows` if > 0.
 *
 * Designed so the entire file is never loaded into memory at once —
 * critical because the SMS pass/property TXT is ~1.2GB uncompressed.
 */
export async function* streamRows(filePath, { maxRows = 0 } = {}) {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  let header = null;
  let delim = "|";
  let n = 0;
  for await (const rawLine of rl) {
    if (!rawLine) continue;
    if (!header) {
      delim = sniffDelimiter(rawLine);
      header = rawLine.split(delim).map((h) => h.trim().toLowerCase());
      continue;
    }
    const cols = rawLine.split(delim);
    if (cols.length < 2) continue;
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = cols[i] ?? "";
    const shaped = shapeRow(obj);
    if (!shaped) continue;
    yield shaped;
    n++;
    if (maxRows > 0 && n >= maxRows) break;
  }
}

// ─────────────────────────── network ────────────────────────────────

async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "application/zip,application/octet-stream,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
  } finally { clearTimeout(t); }
}

/**
 * Stream-download a URL to disk. Returns { bytes, contentType }.
 */
async function downloadTo(url, destPath) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct = res.headers.get("content-type") || "";
  if (!res.body) throw new Error(`empty body for ${url}`);
  const handle = await fs.open(destPath, "w");
  try {
    await pipeline(Readable.fromWeb(res.body), handle.createWriteStream());
  } finally { await handle.close(); }
  const stat = await fs.stat(destPath);
  return { bytes: stat.size, contentType: ct };
}

/**
 * Extract a ZIP into destDir using the system `unzip` binary, returning
 * the path to the first .txt/.csv file inside.
 */
async function unzipTo(zipPath, destDir) {
  await execFileP("unzip", ["-o", zipPath, "-d", destDir], { maxBuffer: 1024 * 1024 * 1024 });
  const files = await fs.readdir(destDir);
  // Prefer the largest TXT (Pass/Property has many auxiliary files).
  const candidates = [];
  for (const f of files) {
    if (!/\.(txt|csv)$/i.test(f)) continue;
    const st = await fs.stat(path.join(destDir, f));
    if (st.isFile()) candidates.push({ f, size: st.size });
  }
  candidates.sort((a, b) => b.size - a.size);
  if (!candidates.length) throw new Error(`no .txt/.csv inside ${zipPath}`);
  return path.join(destDir, candidates[0].f);
}

// ─────────────────────────── snapshot loader ────────────────────────

function currentYearMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function latestSnapshot() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

// ─────────────────────────── census join ────────────────────────────

/**
 * Build an index { dotNumber → {parentName, fleetSize, driverCount} }
 * from a Census-file stream, so we can backfill rows whose Pass/Property
 * line was missing parent / fleet data.
 */
async function buildCensusIndex(txtPath, { maxRows = 0 } = {}) {
  const idx = new Map();
  for await (const row of streamRows(txtPath, { maxRows })) {
    if (!row.dotNumber) continue;
    idx.set(row.dotNumber, {
      parentName: row.parentName,
      fleetSize: row.fleetSize,
      driverCount: row.driverCount,
      city: row.city,
      state: row.state,
    });
  }
  return idx;
}

// ─────────────────────────── synthetic preview ──────────────────────
/**
 * 12-row preview used by --dry when no cached snapshot exists. These
 * names cover the carriers most likely to be in TruNorth's index so
 * the merger exercises end-to-end without network traffic.
 */
export const SYNTH_ROWS = [
  { dotNumber: "900001", carrierName: "AMAZON LOGISTICS INC", parentName: "AMAZON COM INC", city: "SEATTLE", state: "WA", fleetSize: 22500, driverCount: 24800, outOfServiceRate: 8.4, basics: { unsafeDriving: 78, hoursOfService: 65, vehicleMaintenance: 91, controlledSubstances: 12, hazmat: null, crashIndicator: 82 }, alertCount: 3 },
  { dotNumber: "900002", carrierName: "FEDERAL EXPRESS CORPORATION", parentName: "FEDEX CORP", city: "MEMPHIS", state: "TN", fleetSize: 45000, driverCount: 55000, outOfServiceRate: 4.1, basics: { unsafeDriving: 35, hoursOfService: 28, vehicleMaintenance: 42, controlledSubstances: 8, hazmat: 21, crashIndicator: 33 }, alertCount: 0 },
  { dotNumber: "900003", carrierName: "UNITED PARCEL SERVICE INC", parentName: "UNITED PARCEL SERVICE INC", city: "ATLANTA", state: "GA", fleetSize: 119000, driverCount: 102000, outOfServiceRate: 3.8, basics: { unsafeDriving: 28, hoursOfService: 22, vehicleMaintenance: 31, controlledSubstances: 5, hazmat: 18, crashIndicator: 24 }, alertCount: 0 },
  { dotNumber: "900004", carrierName: "WALMART TRANSPORTATION LLC", parentName: "WALMART INC", city: "BENTONVILLE", state: "AR", fleetSize: 12100, driverCount: 13500, outOfServiceRate: 3.2, basics: { unsafeDriving: 18, hoursOfService: 14, vehicleMaintenance: 19, controlledSubstances: 3, hazmat: null, crashIndicator: 16 }, alertCount: 0 },
  { dotNumber: "900005", carrierName: "JB HUNT TRANSPORT INC", parentName: "J B HUNT TRANSPORT SERVICES INC", city: "LOWELL", state: "AR", fleetSize: 14800, driverCount: 16200, outOfServiceRate: 5.0, basics: { unsafeDriving: 44, hoursOfService: 38, vehicleMaintenance: 51, controlledSubstances: 9, hazmat: 27, crashIndicator: 41 }, alertCount: 1 },
  { dotNumber: "900006", carrierName: "SCHNEIDER NATIONAL CARRIERS INC", parentName: "SCHNEIDER NATIONAL INC", city: "GREEN BAY", state: "WI", fleetSize: 11200, driverCount: 12800, outOfServiceRate: 4.6, basics: { unsafeDriving: 39, hoursOfService: 33, vehicleMaintenance: 45, controlledSubstances: 7, hazmat: 24, crashIndicator: 36 }, alertCount: 0 },
  { dotNumber: "900007", carrierName: "KNIGHT TRANSPORTATION INC", parentName: "KNIGHT SWIFT TRANSPORTATION HOLDINGS INC", city: "PHOENIX", state: "AZ", fleetSize: 9800, driverCount: 10500, outOfServiceRate: 6.2, basics: { unsafeDriving: 52, hoursOfService: 47, vehicleMaintenance: 58, controlledSubstances: 11, hazmat: null, crashIndicator: 49 }, alertCount: 1 },
  { dotNumber: "900008", carrierName: "WERNER ENTERPRISES INC", parentName: "WERNER ENTERPRISES INC", city: "OMAHA", state: "NE", fleetSize: 7600, driverCount: 8200, outOfServiceRate: 5.4, basics: { unsafeDriving: 41, hoursOfService: 36, vehicleMaintenance: 48, controlledSubstances: 6, hazmat: 19, crashIndicator: 38 }, alertCount: 0 },
  { dotNumber: "900009", carrierName: "OLD DOMINION FREIGHT LINE INC", parentName: "OLD DOMINION FREIGHT LINE INC", city: "THOMASVILLE", state: "NC", fleetSize: 11000, driverCount: 12000, outOfServiceRate: 2.9, basics: { unsafeDriving: 22, hoursOfService: 18, vehicleMaintenance: 25, controlledSubstances: 2, hazmat: 11, crashIndicator: 19 }, alertCount: 0 },
  { dotNumber: "900010", carrierName: "XPO LOGISTICS FREIGHT INC", parentName: "XPO INC", city: "GREENWICH", state: "CT", fleetSize: 8400, driverCount: 9100, outOfServiceRate: 7.1, basics: { unsafeDriving: 61, hoursOfService: 54, vehicleMaintenance: 72, controlledSubstances: 13, hazmat: 33, crashIndicator: 57 }, alertCount: 2 },
  { dotNumber: "900011", carrierName: "RYDER TRUCK RENTAL INC", parentName: "RYDER SYSTEM INC", city: "MIAMI", state: "FL", fleetSize: 6200, driverCount: 6800, outOfServiceRate: 4.4, basics: { unsafeDriving: 31, hoursOfService: 27, vehicleMaintenance: 36, controlledSubstances: 5, hazmat: 16, crashIndicator: 29 }, alertCount: 0 },
  { dotNumber: "900012", carrierName: "LANDSTAR RANGER INC", parentName: "LANDSTAR SYSTEM INC", city: "JACKSONVILLE", state: "FL", fleetSize: 13500, driverCount: 12100, outOfServiceRate: 5.8, basics: { unsafeDriving: 48, hoursOfService: 42, vehicleMaintenance: 55, controlledSubstances: 8, hazmat: 22, crashIndicator: 44 }, alertCount: 1 },
];

// ─────────────────────────── runner ─────────────────────────────────

async function realFetch() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fmcsa-sms-"));
  try {
    console.log(`  → downloading Pass/Property (~300MB): ${PASS_PROPERTY_ZIP}`);
    const passZip = path.join(tmp, "pass-property.zip");
    const passMeta = await downloadTo(PASS_PROPERTY_ZIP, passZip);
    console.log(`     ${(passMeta.bytes / 1e6).toFixed(1)}MB, ${passMeta.contentType}`);
    const passTxt = await unzipTo(passZip, tmp);

    // Courtesy delay.
    await new Promise((r) => setTimeout(r, 1000));

    console.log(`  → downloading Census (~50MB): ${CENSUS_ZIP}`);
    const censusZip = path.join(tmp, "census.zip");
    let censusIndex = new Map();
    try {
      const censusMeta = await downloadTo(CENSUS_ZIP, censusZip);
      console.log(`     ${(censusMeta.bytes / 1e6).toFixed(1)}MB, ${censusMeta.contentType}`);
      const censusTxt = await unzipTo(censusZip, tmp);
      censusIndex = await buildCensusIndex(censusTxt, { maxRows: MAX_ROWS });
      console.log(`     census carriers indexed: ${censusIndex.size}`);
    } catch (err) {
      console.warn(`  ! census fetch failed (${err.message}); proceeding without backfill`);
    }

    console.log(`  → stream-parsing Pass/Property…`);
    const rows = [];
    let n = 0;
    for await (const row of streamRows(passTxt, { maxRows: MAX_ROWS })) {
      // Backfill parent / fleet from census if missing.
      if (censusIndex.size) {
        const c = censusIndex.get(row.dotNumber);
        if (c) {
          if (!row.parentName || row.parentName === row.carrierName) row.parentName = c.parentName || row.parentName;
          if (row.fleetSize == null) row.fleetSize = c.fleetSize;
          if (row.driverCount == null) row.driverCount = c.driverCount;
          if (!row.city) row.city = c.city;
          if (!row.state) row.state = c.state;
        }
      }
      rows.push(row);
      n++;
      if (n % 100_000 === 0) console.log(`     …${n.toLocaleString()} rows`);
    }
    console.log(`     total parsed: ${rows.length.toLocaleString()}`);
    return { rows, sourceUrl: PASS_PROPERTY_ZIP, sourceKind: "fmcsa-ddp-zip" };
  } finally {
    try { await fs.rm(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  console.log(
    `fmcsa-sms fetcher starting… (mode=${DRY ? "DRY (no network)" : "APPLY (real fetch)"})`,
  );

  let snapshot;
  let sourceUrl;
  let sourceKind;

  if (DRY) {
    const latest = await latestSnapshot();
    if (latest) {
      console.log(`Reading cached snapshot: ${path.relative(ROOT, latest)}`);
      snapshot = JSON.parse(await fs.readFile(latest, "utf-8"));
    } else {
      console.log("No cached snapshot — emitting synthetic 12-row preview.");
      snapshot = {
        _synthetic: true,
        _license: LICENSE_TAG,
        sourceUrl: LANDING_URL,
        sourceKind: "synthetic",
        snapshotDate: currentYearMonth(),
        fetchedAt: new Date().toISOString(),
        rowCount: SYNTH_ROWS.length,
        rows: SYNTH_ROWS,
      };
    }
  } else {
    const { rows, sourceUrl: u, sourceKind: k } = await realFetch();
    sourceUrl = u;
    sourceKind = k;
    snapshot = {
      _license: LICENSE_TAG,
      sourceUrl,
      sourceKind,
      landingPage: LANDING_URL,
      snapshotDate: currentYearMonth(),
      fetchedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows,
    };
  }

  const outPath = OUT_PATH
    ? path.resolve(OUT_PATH)
    : path.join(RAW_DIR, `${snapshot.snapshotDate || currentYearMonth()}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));

  console.log(`Wrote ${path.relative(ROOT, outPath)} (${snapshot.rowCount} carriers).`);
  if (DRY) {
    console.log(
      "(DRY — no network traffic. Re-run with --apply to fetch the real ~300MB monthly snapshot.)",
    );
  } else {
    console.log(`  Source: ${sourceKind} → ${sourceUrl}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("fmcsa-sms-fetch failed:", err);
    process.exit(1);
  });
}
