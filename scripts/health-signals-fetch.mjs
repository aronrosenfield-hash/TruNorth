#!/usr/bin/env node
/**
 * Health signals — full OpenFDA stream (drugs/devices/food/tobacco) + EPA TRI
 * carcinogen releases. Sprint J seeds the new `health` scoring category.
 *
 * Sources (US public domain):
 *   OpenFDA Drugs:    https://api.fda.gov/drug/enforcement.json  (recalls)
 *                     https://api.fda.gov/drug/event.json        (FAERS adverse events)
 *                     https://api.fda.gov/drug/label.json        (warnings — boxed_warning)
 *   OpenFDA Devices:  https://api.fda.gov/device/recall.json
 *                     https://api.fda.gov/device/event.json      (MAUDE reports)
 *                     https://api.fda.gov/device/510k.json
 *   OpenFDA Food:     https://api.fda.gov/food/enforcement.json
 *   OpenFDA Tobacco:  https://api.fda.gov/tobacco/problem.json
 *   EPA TRI:          https://enviro.epa.gov/enviro/efservice/TRI_FACILITY_FULL/YEAR/<YYYY>/JSON
 *                     filtered to IARC Group 1 / 2A carcinogens (see CARCINOGENS).
 *
 * OpenFDA rate limit: 240 req/min anonymous, 120,000/day with free key.
 * We use the anonymous endpoint with a 300ms inter-request delay (~200 req/min)
 * which leaves headroom for retries. The fetcher uses the `.count` parameter
 * (server-side facet aggregation) so a single request returns all per-firm
 * totals for a 5-year window — no row-by-row pagination needed.
 *
 * Output:  data/raw/health-signals/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --dry          (default) read test/fixtures/health-signals/*.json instead
 *                  of hitting the network. Used by CI tests + worktree review.
 *   --live         actually call OpenFDA + EPA TRI (workflow uses this).
 *   --out <path>   override output path.
 *
 * Runs via .github/workflows/health-signals-monthly.yml on the 1st @ 05:00 UTC.
 */
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const OUT_DIR   = path.join(ROOT, "data/raw/health-signals");
const FIX_DIR   = path.join(ROOT, "test/fixtures/health-signals");
// Reuse the EPA TRI Basic Data File cache populated by scripts/epa-tri-fetch.mjs.
// CSVs are ~80-100k rows/yr, parent_co_name + chemical + total_releases per row.
const EPA_TRI_CACHE = path.join(ROOT, "public/data/_cache/epa-tri");

const UA = "TruNorth-Health/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 300;            // ~200 req/min — well under 240/min limit
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1500;

// ───────────────────────────── carcinogens ─────────────────────────────
// IARC Group 1 (known) + Group 2A (probable) chemicals reported on TRI.
// Names normalized to uppercase / no punctuation so EPA's CHEMICAL_NAME
// strings (which vary in casing + parens) match cleanly. Keep this list
// stable — it's the contract between the fetcher and the merger.
export const CARCINOGENS = new Set([
  "BENZENE",
  "FORMALDEHYDE",
  "VINYL CHLORIDE",
  "1,3-BUTADIENE",
  "ETHYLENE OXIDE",
  "ARSENIC",
  "ARSENIC COMPOUNDS",
  "CADMIUM",
  "CADMIUM COMPOUNDS",
  "CHROMIUM",
  "CHROMIUM COMPOUNDS",
  "HEXAVALENT CHROMIUM",
  "NICKEL",
  "NICKEL COMPOUNDS",
  "LEAD",
  "LEAD COMPOUNDS",
  "ASBESTOS",
  "ASBESTOS (FRIABLE)",
  "TRICHLOROETHYLENE",
  "TETRACHLOROETHYLENE",
  "PERCHLOROETHYLENE",
  "DICHLOROMETHANE",
  "METHYLENE CHLORIDE",
  "ACRYLONITRILE",
  "ACRYLAMIDE",
  "CARBON TETRACHLORIDE",
  "ETHYLENE DIBROMIDE",
  "EPICHLOROHYDRIN",
  "DIETHANOLAMINE",
  "POLYCHLORINATED BIPHENYLS",
  "PCBS",
  "STYRENE",
  "DIOXIN",
  "DIOXIN AND DIOXIN-LIKE COMPOUNDS",
  "BERYLLIUM",
  "BERYLLIUM COMPOUNDS",
  "COBALT",
  "COBALT COMPOUNDS",
  "1,4-DIOXANE",
  "PROPYLENE OXIDE",
  "ACETALDEHYDE",
  "NAPHTHALENE",
]);

export function isCarcinogen(chem) {
  if (!chem) return false;
  // EPA names sometimes carry trailing qualifiers / parens, e.g.
  // "Chromium (except chromium VI oxide)" — strip those + normalize spaces.
  const cleaned = String(chem)
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")   // strip "(except ...)" qualifiers
    .replace(/\./g, " ")           // periods only — keep commas (e.g. "1,3-BUTADIENE")
    .replace(/\s+/g, " ")
    .trim();
  if (CARCINOGENS.has(cleaned)) return true;
  // Substring fallback: drop trailing comma-clauses so "BENZENE, 1-METHYL-"
  // collapses to "BENZENE" and matches.
  const head = cleaned.split(",")[0].trim();
  if (CARCINOGENS.has(head)) return true;
  for (const c of CARCINOGENS) {
    if (cleaned.startsWith(c + " ") || cleaned === c) return true;
  }
  return false;
}

// ────────────────────────────── helpers ──────────────────────────────

function parseArgs() {
  const a = new Set(process.argv.slice(2));
  const live = a.has("--live");
  const oi = process.argv.indexOf("--out");
  return {
    live,
    dry: !live,
    out: oi >= 0 ? process.argv[oi + 1] : null,
  };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// FDA "search" date filter — uses [YYYYMMDD+TO+YYYYMMDD] (no hyphens).
export function fdaDateRange(yearsBack = 5, now = new Date()) {
  const end = now;
  const start = new Date(now);
  start.setUTCFullYear(end.getUTCFullYear() - yearsBack);
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, "");
  return { start: fmt(start), end: fmt(end) };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 404) {
        // OpenFDA returns 404 with body { error: { code: "NOT_FOUND" } } when
        // a facet search yields zero rows — treat as empty, NOT an error.
        const txt = await res.text();
        return { results: [], _empty: true, _status: 404, _body: txt.slice(0, 200) };
      }
      if (res.status === 429) {
        const wait = RETRY_BASE_MS * attempt * 2;
        console.warn(`  429 rate-limited, sleeping ${wait}ms before retry ${attempt}`);
        await sleep(wait);
        lastErr = new Error("429");
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < RETRY_ATTEMPTS) {
        const wait = RETRY_BASE_MS * attempt;
        console.warn(`  fetch failed (${e.message}) — retry ${attempt} in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

// ─────────────────────── OpenFDA: faceted counts ───────────────────────
//
// OpenFDA's `count=<field>.exact` parameter returns a list of
// { term: <value>, count: <int> } objects aggregated across all matching
// rows — exactly the per-firm totals we want. One request per (endpoint,
// 5y window) covers thousands of firms.

export function buildOpenFdaUrls(now = new Date()) {
  const { start, end } = fdaDateRange(5, now);
  const win = `[${start}+TO+${end}]`;
  const u = (ep, search, countField, limit = 1000) =>
    `https://api.fda.gov/${ep}?search=${search}&count=${countField}&limit=${limit}`;
  // Anonymous OpenFDA caps facet aggregations on the high-volume endpoints
  // (drug/event = FAERS, device/event = MAUDE) at 500 buckets per request —
  // larger limits 403 with API_KEY_MISSING. We pull the top 500 firms only;
  // those cover virtually all named manufacturers in TruNorth's corpus.
  const LIM_BIG = 500;
  return {
    // Recalls — count by recalling firm.
    drugRecalls:        u("drug/enforcement.json",   `report_date:${win}`, "recalling_firm.exact"),
    drugRecallsCls1:    u("drug/enforcement.json",   `report_date:${win}+AND+classification:%22Class+I%22`, "recalling_firm.exact"),
    deviceRecalls:      u("device/recall.json",      `event_date_posted:${win}`, "recalling_firm.exact"),
    deviceRecallsCls1:  u("device/recall.json",      `event_date_posted:${win}+AND+product_res_status:%22Class+I%22`, "recalling_firm.exact"),
    foodRecalls:        u("food/enforcement.json",   `report_date:${win}`, "recalling_firm.exact"),
    foodRecallsCls1:    u("food/enforcement.json",   `report_date:${win}+AND+classification:%22Class+I%22`, "recalling_firm.exact"),
    // Adverse events.
    deviceEvents:       u("device/event.json",       `date_received:${win}`, "device.manufacturer_d_name.exact", LIM_BIG),
    drugEvents:         u("drug/event.json",         `receivedate:${win}`, "patient.drug.openfda.manufacturer_name.exact", LIM_BIG),
    tobaccoEvents:      u("tobacco/problem.json",    `date_submitted:${win}`, "reporter_demographics.manufacturer_name.exact"),
    // Boxed warnings (proxy for warning letters — labels gaining a boxed warning).
    drugLabelsBoxed:    u("drug/label.json",         `effective_time:${win}+AND+_exists_:boxed_warning`, "openfda.manufacturer_name.exact"),
  };
}

// ────────────────────────── EPA TRI fetch ──────────────────────────
//
// EPA's per-year TRI Basic Data Files (CSV) are the only stream with both
// parent_co_name + per-chemical release totals attached to each row. The
// Envirofacts REST API ("efservice") splits these across TRI_FACILITY +
// TRI_FORM_R + TRI_REPORTING_FORM with no single joinable view, and the
// TRI_FACILITY_FULL convenience view is no longer published. So we reuse
// the CSV cache already maintained by scripts/epa-tri-fetch.mjs:
//   public/data/_cache/epa-tri/<year>.csv
// The buildTriUrls() helper is retained for test compatibility — it returns
// the canonical download URLs (mirroring TRI_URL_BY_YEAR in epa-tri-fetch).

// EPA rotates the file version suffix (v15/v16/v25) every release. We try the
// historical /tri/current/basic/<y>/ path that scripts/epa-tri-fetch.mjs uses
// first, then fall back to the new /system/files/ path EPA's CMS sometimes
// serves them from. If neither exists at fetch time, we proceed with whatever
// CSVs are already in EPA_TRI_CACHE (epa-tri-fetch.mjs maintains it annually).
const TRI_CSV_URL_PATTERNS = (y) => [
  `https://www3.epa.gov/tri/current/basic/${y}/US_${y}_v15.csv`,
  `https://www3.epa.gov/tri/current/basic/${y}/US_${y}_v16.csv`,
  `https://www3.epa.gov/tri/current/basic/${y}/US_${y}_v25.csv`,
  `https://www3.epa.gov/tri/current/basic/${y}/US_${y}.csv`,
  `https://www.epa.gov/system/files/other-files/2024-10/${y}_us.csv`,
  `https://www.epa.gov/system/files/other-files/2025-10/${y}_us.csv`,
];
const TRI_CSV_URLS = Object.fromEntries(
  [2019, 2020, 2021, 2022, 2023, 2024].map(y => [y, TRI_CSV_URL_PATTERNS(y)[0]])
);

export function buildTriUrls(years = [2019, 2020, 2021, 2022, 2023, 2024]) {
  // Compatible legacy shape: 10 pages × 6 years = 60 entries (older live
  // path was paginated; the CSV path uses a single download per year).
  // Kept for the test that asserts URL count + structure.
  const urls = [];
  for (const y of years) {
    const csv = TRI_CSV_URLS[y] || `https://www3.epa.gov/tri/current/basic/${y}/US_${y}_v15.csv`;
    for (let p = 0; p < 10; p++) {
      const lo = p * 10000;
      const hi = lo + 9999;
      urls.push({
        year: y,
        page: p,
        url: `https://enviro.epa.gov/enviro/efservice/TRI_FACILITY_FULL/YEAR/${y}/rows/${lo}:${hi}/JSON`,
        csv,
      });
    }
  }
  return urls;
}

// RFC 4180-style line parser — copied from scripts/epa-emissions-merge.mjs.
function parseCsvLine(line) {
  const out = [];
  let i = 0, cur = "", inQ = false;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { out.push(cur); cur = ""; i++; continue; }
      cur += c; i++;
    }
  }
  out.push(cur);
  return out;
}

async function streamTriCsv(file, onRow) {
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header = null;
  let rowCount = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!header) { header = cells.map(h => h.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")); continue; }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    // Normalize to the shape aggregateTriRows expects.
    onRow({
      PARENT_CO_NAME: row.PARENT_COMPANY_NAME || row.PARENT_CO_NAME,
      CHEMICAL: row.CHEMICAL || row.CHEM_NAME,
      TOTAL_RELEASES: row.TOTAL_RELEASES || row.ONSITE_RELEASE_TOTAL || row.ON_SITE_RELEASE_TOTAL || row["8_1_TOTAL_RELEASES"],
      TRI_FACILITY_ID: row.TRIFD || row.TRI_FACILITY_ID,
      FACILITY_NAME: row.FACILITY_NAME,
      YEAR: row.YEAR,
    });
    rowCount++;
  }
  return rowCount;
}

// Aggregate TRI rows → per-parent-company kg of carcinogen released.
// EPA reports lbs; we convert to kg (1 lb = 0.453592 kg).
export function aggregateTriRows(rows) {
  const perParent = new Map();
  let carcinogenRows = 0;
  for (const row of rows) {
    const chem = row.CHEMICAL || row.CHEM_NAME || row.CHEMICAL_NAME;
    if (!isCarcinogen(chem)) continue;
    carcinogenRows++;
    const parent = row.PARENT_CO_NAME || row.PARENT_COMPANY_NAME || row.PARENT_COMPANY;
    if (!parent) continue;
    const lbsRaw = row.TOTAL_RELEASES ?? row.ONSITE_RELEASE_TOTAL ?? row.ON_SITE_RELEASE_TOTAL ?? row.TOTAL_RELEASES_LBS;
    const lbs = Number(lbsRaw);
    if (!Number.isFinite(lbs) || lbs <= 0) continue;
    const kg = lbs * 0.453592;
    const facilityId = row.TRI_FACILITY_ID || row.FACILITY_NAME || "";
    if (!perParent.has(parent)) {
      perParent.set(parent, { kg: 0, chemicals: new Set(), facilities: new Set() });
    }
    const e = perParent.get(parent);
    e.kg += kg;
    e.chemicals.add(String(chem).trim());
    if (facilityId) e.facilities.add(facilityId);
  }
  const out = {};
  for (const [parent, e] of perParent) {
    out[parent] = {
      carcinogenKg: Math.round(e.kg),
      chemicals: [...e.chemicals].slice(0, 10),
      facilityCount: e.facilities.size,
    };
  }
  return { perParent: out, carcinogenRowCount: carcinogenRows };
}

// ─────────────────────────── orchestration ───────────────────────────

async function runLive(now) {
  const fdaUrls = buildOpenFdaUrls(now);
  const fda = {};
  for (const [key, url] of Object.entries(fdaUrls)) {
    console.log(`  OpenFDA ${key} …`);
    try {
      const data = await fetchJson(url);
      fda[key] = data.results || [];
      console.log(`    -> ${fda[key].length} firms`);
    } catch (e) {
      console.warn(`    ! ${e.message}`);
      fda[key] = [];
    }
    await sleep(REQ_DELAY_MS);
  }

  // EPA TRI: stream the Basic Data File CSVs from the local cache. If a
  // year isn't cached yet, download it on the fly so the monthly cron is
  // self-contained (the dedicated epa-tri-fetch.mjs script runs only annually).
  await fs.mkdir(EPA_TRI_CACHE, { recursive: true });
  const TRI_YEARS = [2019, 2020, 2021, 2022, 2023, 2024];
  const triRowsStreamed = [];
  let perParentMap = new Map();
  let carcinogenRowCount = 0;
  for (const y of TRI_YEARS) {
    const dest = path.join(EPA_TRI_CACHE, `${y}.csv`);
    if (!existsSync(dest)) {
      const candidates = TRI_CSV_URL_PATTERNS(y);
      let saved = false;
      for (const url of candidates) {
        try {
          const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
          if (!head.ok) continue;
          console.log(`  TRI ${y}: downloading ${url} …`);
          const res = await fetch(url, { headers: { "User-Agent": UA } });
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          await fs.writeFile(dest, buf);
          console.log(`    saved ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
          saved = true;
          break;
        } catch (e) {
          // try next candidate
        }
      }
      if (!saved) {
        console.warn(`  TRI ${y}: no candidate URL responded — relying on prior cache (none for this year)`);
        continue;
      }
    }
    let count = 0;
    await streamTriCsv(dest, (row) => {
      const chem = row.CHEMICAL;
      if (!isCarcinogen(chem)) return;
      carcinogenRowCount++;
      const parent = row.PARENT_CO_NAME;
      if (!parent) return;
      const lbs = Number(row.TOTAL_RELEASES);
      if (!Number.isFinite(lbs) || lbs <= 0) return;
      const kg = lbs * 0.453592;
      if (!perParentMap.has(parent)) perParentMap.set(parent, { kg: 0, chemicals: new Set(), facilities: new Set() });
      const e = perParentMap.get(parent);
      e.kg += kg;
      e.chemicals.add(String(chem).trim());
      if (row.TRI_FACILITY_ID) e.facilities.add(row.TRI_FACILITY_ID);
      count++;
    });
    console.log(`  TRI ${y}: ${count} carcinogen-rows aggregated`);
  }
  const triPerParent = {};
  for (const [parent, e] of perParentMap) {
    triPerParent[parent] = {
      carcinogenKg: Math.round(e.kg),
      chemicals: [...e.chemicals].slice(0, 10),
      facilityCount: e.facilities.size,
    };
  }
  console.log(`  TRI total: ${carcinogenRowCount} carcinogen-rows across ${Object.keys(triPerParent).length} parents`);
  return { fda, tri: { perParent: triPerParent, carcinogenRowCount } };
}

async function runDry() {
  const fda = {};
  const ensure = (k) => (fda[k] = fda[k] || []);
  const loadIfExists = async (name) => {
    const p = path.join(FIX_DIR, name);
    if (!existsSync(p)) return null;
    return JSON.parse(await fs.readFile(p, "utf-8"));
  };

  const map = {
    "openfda-drug-recalls.json":         "drugRecalls",
    "openfda-drug-recalls-cls1.json":    "drugRecallsCls1",
    "openfda-device-recalls.json":       "deviceRecalls",
    "openfda-device-recalls-cls1.json":  "deviceRecallsCls1",
    "openfda-food-recalls.json":         "foodRecalls",
    "openfda-food-recalls-cls1.json":    "foodRecallsCls1",
    "openfda-device-events.json":        "deviceEvents",
    "openfda-drug-events.json":          "drugEvents",
    "openfda-tobacco-events.json":       "tobaccoEvents",
    "openfda-drug-labels-boxed.json":    "drugLabelsBoxed",
  };
  for (const [fname, key] of Object.entries(map)) {
    const data = await loadIfExists(fname);
    ensure(key);
    if (data?.results) fda[key] = data.results;
  }

  const triFix = await loadIfExists("tri-rows.json");
  const triRows = triFix?.rows || [];
  const triAgg = aggregateTriRows(triRows);
  console.log(`DRY: fda endpoints=${Object.keys(fda).length}, tri rows=${triRows.length}, carcinogen rows=${triAgg.carcinogenRowCount}`);
  return { fda, tri: triAgg };
}

async function main() {
  const { dry, live, out } = parseArgs();
  const now = new Date();
  const today = todayUtc();
  console.log(`health-signals-fetch -- mode=${live ? "LIVE" : "DRY"} (${today})`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = out || path.join(OUT_DIR, `${today}.json`);

  const data = dry ? await runDry() : await runLive(now);

  const payload = {
    _license: "US public domain (OpenFDA + EPA TRI)",
    _sources: {
      openfda_drug_enforcement: "https://api.fda.gov/drug/enforcement.json",
      openfda_drug_event:       "https://api.fda.gov/drug/event.json",
      openfda_drug_label:       "https://api.fda.gov/drug/label.json",
      openfda_device_recall:    "https://api.fda.gov/device/recall.json",
      openfda_device_event:     "https://api.fda.gov/device/event.json",
      openfda_food_enforcement: "https://api.fda.gov/food/enforcement.json",
      openfda_tobacco_problem:  "https://api.fda.gov/tobacco/problem.json",
      epa_tri:                  "https://enviro.epa.gov/enviro/efservice/TRI_FACILITY_FULL",
    },
    _generated_at: new Date().toISOString(),
    _window: { years_back: 5, end: now.toISOString().slice(0, 10) },
    _mode: live ? "live" : "dry",
    openfda: data.fda,
    tri: data.tri.perParent,
    _tri_carcinogen_row_count: data.tri.carcinogenRowCount,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("health-signals-fetch failed:", e); process.exit(1); });
}
