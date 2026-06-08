#!/usr/bin/env node
/**
 * Cornell ILR Labor Action Tracker — fetcher.
 *
 * Source:
 *   https://striketracker.ilr.cornell.edu
 *
 * Academic project run jointly by the Cornell ILR School and University of
 * Illinois LER School. Tracks US strikes, labor protests, and (rare)
 * lockouts since 2021. The live tracker exposes its dataset as a single
 * JSON file at /labor_actions.json — that is what we ingest.
 *
 * Suggested citation (per /suggested-citation.html):
 *   Kallas, J., Iyer, D. K., & Friedman, E. (2024). "Labor Action
 *   Tracker." Cornell University ILR School & University of Illinois LER
 *   School. Retrieved from striketracker.ilr.cornell.edu.
 *
 * License:
 *   The project is academic / public-facing and the data is published
 *   without paywall or login. The research team distributes spreadsheet
 *   copies on email request. We treat the data as CC-BY (Creative Commons
 *   Attribution) and always cite the source URL plus the formal citation
 *   above. This matches how peer projects (e.g. Bonica DIME, AsYouSow)
 *   are handled in this repo. If the team formally relicenses we will
 *   update _license here.
 *
 * SCHEMA (per https://striketracker.ilr.cornell.edu/methodology):
 *   - Employer                 string (may be "" for multi-employer rally;
 *                              may contain "X; Y" for joint targets)
 *   - Labor_Organization       string (may be "X; Y")
 *   - Local                    string
 *   - Industry                 string[]
 *   - Bargaining_Unit_Size     number | null  (discontinued early 2022)
 *   - Approximate_Number_of_Participants  number | null
 *   - Start_date / End_date    "YYYY-MM-DD"
 *   - Duration                 number (days for our purposes)
 *   - Authorized               "Y" | "" (strikes only)
 *   - Action_type              "Strike" | "Protest"  (lockouts are folded
 *                              into Strike in their current schema)
 *   - Worker_demands           string[]
 *   - locations                [{ id, Lat/Lng, Address, City, State, Zip }]
 *   - sources                  string[] (citation URLs)
 *   - Notes                    string
 *
 * Standalone usage:
 *   node scripts/cornell-ilr-fetch.mjs
 *   node scripts/cornell-ilr-fetch.mjs --fixture
 *   node scripts/cornell-ilr-fetch.mjs --out /tmp/test.json
 *
 * Output:
 *   data/raw/cornell-ilr/<YYYY-MM-DD>.json
 *
 * Runs monthly via .github/workflows/cornell-ilr-monthly.yml.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/cornell-ilr");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/cornell-ilr");

const SOURCE_URL = "https://striketracker.ilr.cornell.edu";
const DATA_URL   = "https://striketracker.ilr.cornell.edu/labor_actions.json";
const UA = "TruNorth-LaborActionTracker/1.0 (+https://www.trunorthapp.com; data pipeline for labour-rights transparency)";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4000;

const CITATION = "Kallas, J., Iyer, D. K., & Friedman, E. (2024). \"Labor Action Tracker.\" Cornell University ILR School & University of Illinois LER School. Retrieved from striketracker.ilr.cornell.edu";
const LICENSE  = "CC-BY — Cornell ILR";

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── fetch ────────────────────────────────────────────────────────────────
async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
      },
      redirect: "follow",
    });
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const backoff = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  ${res.status} for ${url} — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const backoff = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  fetch error "${err.message}" — retrying in ${backoff}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

// ─── parsing helpers (exported for tests) ─────────────────────────────────

/**
 * Split a Cornell ILR "Employer" string into individual employer names.
 * Their schema sometimes packs joint targets with "; ", e.g.
 * "Uber; Lyft" or "McDonald's; Burger King". Empty / whitespace strings
 * return [] so we can skip "multi-employer rally" rows that have no
 * specific target.
 */
export function splitEmployers(raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s.split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
}

/**
 * Split labor organisations the same way. Returns [] for empty.
 */
export function splitUnions(raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s.split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
}

/**
 * Normalise an action_type into one of "strike" | "protest" | "lockout"
 * (lowercase). The live tracker only emits "Strike" and "Protest", but
 * we preserve "Lockout" handling in case the schema gains it. Returns
 * "unknown" for anything we don't recognise.
 */
export function normalizeActionType(raw) {
  if (!raw) return "unknown";
  const s = String(raw).trim().toLowerCase();
  if (s === "strike") return "strike";
  if (s === "protest") return "protest";
  if (s === "lockout") return "lockout";
  return "unknown";
}

/**
 * Build a flat per-employer view of a raw action record. One Cornell row
 * with employers "Uber; Lyft" yields TWO records — one per employer —
 * sharing the same action metadata (date, location, etc.). Merging
 * downstream dedupes per slug.
 */
export function normalizeAction(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return [];

  const employers = splitEmployers(rawRow.Employer);
  if (employers.length === 0) return []; // multi-employer rally; skip

  const unions = splitUnions(rawRow.Labor_Organization);
  const actionType = normalizeActionType(rawRow.Action_type);

  // First location is the canonical address for display.
  const loc = Array.isArray(rawRow.locations) && rawRow.locations.length > 0
    ? rawRow.locations[0]
    : null;

  // Top citation source — first non-empty.
  const sourceUrl = Array.isArray(rawRow.sources)
    ? (rawRow.sources.find(s => typeof s === "string" && s.trim().length > 0) || null)
    : null;

  // Action permalink on the tracker (deep link by id).
  const trackerUrl = rawRow.id != null
    ? `${SOURCE_URL}/#action-${rawRow.id}`
    : SOURCE_URL;

  const base = {
    actionId:        rawRow.id,
    actionType,
    startDate:       rawRow.Start_date || null,
    endDate:         rawRow.End_date || null,
    durationDays:    Number.isFinite(rawRow.Duration) ? rawRow.Duration : null,
    authorized:      rawRow.Authorized === "Y" ? true : (rawRow.Authorized === "" ? null : false),
    numWorkers:      Number.isFinite(rawRow.Approximate_Number_of_Participants) ? rawRow.Approximate_Number_of_Participants : null,
    bargainingUnitSize: Number.isFinite(rawRow.Bargaining_Unit_Size) ? rawRow.Bargaining_Unit_Size : null,
    unions,
    numUnions:       unions.length,
    industry:        Array.isArray(rawRow.Industry) ? rawRow.Industry : [],
    demands:         Array.isArray(rawRow.Worker_demands) ? rawRow.Worker_demands : [],
    locationCount:   Array.isArray(rawRow.locations) ? rawRow.locations.length : 0,
    city:            loc?.City || null,
    state:           loc?.State || null,
    zip:             loc?.Zip || null,
    sourceUrl,
    trackerUrl,
    notes:           rawRow.Notes || "",
  };

  return employers.map(emp => ({ ...base, employer: emp }));
}

// ─── core ─────────────────────────────────────────────────────────────────

/**
 * Transform the raw labor_actions.json blob (an object keyed by id) into
 * an array of flat per-employer action records. Multi-employer rows are
 * expanded.
 */
export function flattenLaborActions(rawObj) {
  if (!rawObj || typeof rawObj !== "object") return [];
  const out = [];
  for (const key of Object.keys(rawObj)) {
    out.push(...normalizeAction(rawObj[key]));
  }
  return out;
}

async function loadSource() {
  if (FIXTURE_MODE) {
    console.log(`  Loading fixture ${path.join(FIXTURE_DIR, "sample.json")}`);
    const text = await fs.readFile(path.join(FIXTURE_DIR, "sample.json"), "utf-8");
    return JSON.parse(text);
  }
  console.log(`  GET ${DATA_URL}`);
  return await fetchJson(DATA_URL);
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Cornell ILR Labor Action Tracker fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);

  const raw = await loadSource();
  const rawCount = Object.keys(raw || {}).length;
  console.log(`  Loaded ${rawCount} raw action rows`);

  const actions = flattenLaborActions(raw);
  console.log(`  Flattened to ${actions.length} per-employer records (skipped rows with empty Employer)`);

  // Stats
  const byType = { strike: 0, protest: 0, lockout: 0, unknown: 0 };
  let workerSum = 0;
  for (const a of actions) {
    byType[a.actionType] = (byType[a.actionType] || 0) + 1;
    workerSum += (a.numWorkers || 0);
  }

  const output = {
    _license:      LICENSE,
    _citation:     CITATION,
    _source:       SOURCE_URL,
    _data_url:     DATA_URL,
    _generated_at: new Date().toISOString(),
    _raw_count:    rawCount,
    _record_count: actions.length,
    _by_action_type: byType,
    _total_workers_reported: workerSum,
    actions,
  };

  let outPath;
  if (OUT_OVERRIDE) {
    outPath = OUT_OVERRIDE;
  } else {
    await fs.mkdir(RAW_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    outPath = path.join(RAW_DIR, `${today}.json`);
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  ${actions.length} per-employer records`);
  console.log(`  By type: strike=${byType.strike} protest=${byType.protest} lockout=${byType.lockout} unknown=${byType.unknown}`);
  console.log(`  Total reported workers involved (sum, double-counted across joint events): ${workerSum.toLocaleString()}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("cornell-ilr-fetch failed:", err);
    process.exit(1);
  });
}
