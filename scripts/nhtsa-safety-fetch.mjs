#!/usr/bin/env node
/**
 * NHTSA 5-Star Safety Ratings — Automotive signal source.
 *
 * The National Highway Traffic Safety Administration publishes its
 * 5-Star New Car Assessment Program ratings via a free, unauthenticated
 * JSON API at api.nhtsa.gov/SafetyRatings. Three endpoint shapes:
 *
 *   1. /SafetyRatings/modelyear/{year}
 *        -> {Results:[{ModelYear, Make, VehicleId:0}]}
 *   2. /SafetyRatings/modelyear/{year}/make/{MAKE}
 *        -> {Results:[{ModelYear, Make, Model, VehicleId:0}]}
 *   3. /SafetyRatings/modelyear/{year}/make/{MAKE}/model/{MODEL}
 *        -> {Results:[{VehicleDescription, VehicleId}]}   (one per trim/drivetrain)
 *   4. /SafetyRatings/VehicleId/{id}
 *        -> {Results:[{OverallRating, RolloverRating, ...}]}  (the actual stars)
 *
 * Walking 2018..2026 across ~40 makes and their ~25 models each, with 2-4
 * variants per model, yields ~40k vehicle-id detail requests. We honor a
 * polite 75ms throttle (~13 req/s) which puts the full walk at roughly
 * 50 minutes — well within a GH Actions slot. CLI flags let you bound this
 * for development.
 *
 * Output:
 *   data/raw/nhtsa-safety/<YYYY-MM-DD>.json
 *
 * Shape:
 *   {
 *     source: "nhtsa-safety",
 *     source_url: "https://api.nhtsa.gov/SafetyRatings",
 *     generated_at, snapshot_date,
 *     year_range: { start, end },
 *     make_count, model_count, vehicle_count,
 *     makes: {
 *       TOYOTA: {
 *         make, vehicle_count, avg_overall_stars,
 *         models: [{ year, make, model, variants: [{description, vehicleId, overallStars, rolloverStars, ...}] }]
 *       },
 *       ...
 *     }
 *   }
 *
 * Flags:
 *   --year YYYY      single model year (default: 2018..2026 sweep)
 *   --limit N        cap number of MAKES processed (debug)
 *   --out PATH       override output path
 *   --fixture        read scripts/fixtures/nhtsa-safety/* instead of the network
 *   --throttle MS    per-request delay in ms (default 75)
 *
 * License: NHTSA data is US Federal Government public domain.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/nhtsa-safety");
const FIXTURE_DIR = path.join(__dirname, "fixtures/nhtsa-safety");

export const API_BASE = "https://api.nhtsa.gov/SafetyRatings";
export const SOURCE_URL = "https://www.nhtsa.gov/ratings";
const UA = "TruNorth-NHTSA-Safety/1.0 (+https://www.trunorthapp.com)";

export const DEFAULT_YEAR_START = 2018;
export const DEFAULT_YEAR_END = 2026;

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * NHTSA returns ratings as numeric strings ("5", "4") plus special
 * values like "Not Rated" or "" when the test wasn't run. Coerce to
 * Number or null so the aggregator can math on them.
 */
export function parseStars(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/not rated/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

/**
 * One /VehicleId/{id} payload -> compact record we keep in the snapshot.
 * Heavy/inert fields (crash test image URLs, video URLs) are dropped.
 */
export function parseVehicleDetail(detail) {
  return {
    vehicleId: detail.VehicleId,
    description: detail.VehicleDescription || "",
    modelYear: detail.ModelYear,
    make: detail.Make,
    model: detail.Model,
    overallStars: parseStars(detail.OverallRating),
    frontCrashStars: parseStars(detail.OverallFrontCrashRating),
    sideCrashStars: parseStars(detail.OverallSideCrashRating),
    rolloverStars: parseStars(detail.RolloverRating),
    rolloverProbability: typeof detail.RolloverPossibility === "number" ? detail.RolloverPossibility : null,
    complaintsCount: typeof detail.ComplaintsCount === "number" ? detail.ComplaintsCount : null,
    recallsCount: typeof detail.RecallsCount === "number" ? detail.RecallsCount : null,
    investigationCount: typeof detail.InvestigationCount === "number" ? detail.InvestigationCount : null,
  };
}

/**
 * Build the per-make rollup used in the snapshot.
 * `models` is the flat list of [{year, make, model, variants:[parsedVehicleDetail]}].
 */
export function buildMakeRollup(make, models) {
  let starsSum = 0;
  let starsCount = 0;
  let vehicleCount = 0;
  for (const m of models) {
    for (const v of m.variants) {
      vehicleCount++;
      if (v.overallStars !== null) {
        starsSum += v.overallStars;
        starsCount++;
      }
    }
  }
  return {
    make,
    model_count: models.length,
    vehicle_count: vehicleCount,
    rated_vehicle_count: starsCount,
    avg_overall_stars: starsCount > 0 ? Number((starsSum / starsCount).toFixed(2)) : null,
    models,
  };
}

export function buildSnapshot(yearStart, yearEnd, makesObj) {
  let modelCount = 0;
  let vehicleCount = 0;
  for (const r of Object.values(makesObj)) {
    modelCount += r.model_count;
    vehicleCount += r.vehicle_count;
  }
  return {
    source: "nhtsa-safety",
    source_url: SOURCE_URL,
    api_base: API_BASE,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    year_range: { start: yearStart, end: yearEnd },
    make_count: Object.keys(makesObj).length,
    model_count: modelCount,
    vehicle_count: vehicleCount,
    makes: makesObj,
    license: "US Federal Government public domain (NHTSA)",
  };
}

// ───────────────────────── network ─────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`NHTSA ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function listMakes(year, throttleMs) {
  const data = await fetchJson(`${API_BASE}/modelyear/${year}`);
  await wait(throttleMs);
  return (data.Results || []).map(r => r.Make).filter(Boolean);
}

async function listModels(year, make, throttleMs) {
  const enc = encodeURIComponent(make);
  const data = await fetchJson(`${API_BASE}/modelyear/${year}/make/${enc}`);
  await wait(throttleMs);
  return (data.Results || []).map(r => r.Model).filter(Boolean);
}

async function listVariants(year, make, model, throttleMs) {
  const enc = encodeURIComponent(make);
  const encModel = encodeURIComponent(model);
  const data = await fetchJson(`${API_BASE}/modelyear/${year}/make/${enc}/model/${encModel}`);
  await wait(throttleMs);
  return (data.Results || []).filter(r => r.VehicleId);
}

async function fetchVehicleDetail(vehicleId, throttleMs) {
  const data = await fetchJson(`${API_BASE}/VehicleId/${vehicleId}`);
  await wait(throttleMs);
  const first = (data.Results || [])[0];
  return first ? parseVehicleDetail(first) : null;
}

// ───────────────────────── fixture path ─────────────────────────

async function loadFixtureFile(name) {
  return JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, name), "utf-8"));
}

/**
 * Fixture mode wires together the saved API responses so the script
 * exercises the same parse + rollup code path as the live walk, but
 * without any network. Used by the unit test and by `--fixture` locally.
 */
async function runFixture(yearStart, yearEnd) {
  const makesResp = await loadFixtureFile("makes-2023.json");
  const makesByName = {};
  for (const m of makesResp.Results || []) {
    if (m.Make !== "TOYOTA") continue;
    const modelsResp = await loadFixtureFile("models-toyota-2023.json");
    const modelsForMake = [];
    for (const md of (modelsResp.Results || []).slice(0, 1)) {  // CAMRY only — enough to test
      const variantsResp = await loadFixtureFile("variants-toyota-camry-2023.json");
      const detailFiles = [
        "toyota-camry-2023.json",
        "toyota-camry-2023-awd.json",
        "toyota-camry-2023-awd-later.json",
      ];
      const variants = [];
      for (const f of detailFiles) {
        const d = (await loadFixtureFile(f)).Results?.[0];
        if (d) variants.push(parseVehicleDetail(d));
      }
      modelsForMake.push({ year: 2023, make: md.Make, model: md.Model, variants });
    }
    makesByName[m.Make] = buildMakeRollup(m.Make, modelsForMake);
  }
  return buildSnapshot(yearStart, yearEnd, makesByName);
}

// ───────────────────────── live walker ─────────────────────────

async function runLive({ yearStart, yearEnd, limit, throttleMs, onProgress }) {
  const allMakes = new Set();
  for (let y = yearStart; y <= yearEnd; y++) {
    try {
      const makes = await listMakes(y, throttleMs);
      makes.forEach(m => allMakes.add(m));
    } catch (e) {
      console.warn(`  WARN listMakes(${y}) failed: ${e.message}`);
    }
  }
  let makesToWalk = [...allMakes].sort();
  if (limit && limit > 0) makesToWalk = makesToWalk.slice(0, limit);
  console.log(`  Found ${allMakes.size} unique makes across ${yearStart}..${yearEnd}; walking ${makesToWalk.length}.`);

  const makesObj = {};
  for (let mi = 0; mi < makesToWalk.length; mi++) {
    const make = makesToWalk[mi];
    const modelEntries = [];
    for (let y = yearStart; y <= yearEnd; y++) {
      let models;
      try { models = await listModels(y, make, throttleMs); }
      catch (e) {
        // Many make/year combos return 404; treat as empty.
        continue;
      }
      for (const model of models) {
        let variants;
        try { variants = await listVariants(y, make, model, throttleMs); }
        catch { continue; }
        const detailRows = [];
        for (const v of variants) {
          try {
            const d = await fetchVehicleDetail(v.VehicleId, throttleMs);
            if (d) detailRows.push(d);
          } catch (e) {
            // Single-vehicle failure: skip, don't abort the make.
          }
        }
        if (detailRows.length > 0) {
          modelEntries.push({ year: y, make, model, variants: detailRows });
        }
      }
    }
    makesObj[make] = buildMakeRollup(make, modelEntries);
    if (onProgress) onProgress(mi + 1, makesToWalk.length, make, makesObj[make]);
  }
  return buildSnapshot(yearStart, yearEnd, makesObj);
}

// ───────────────────────── CLI ─────────────────────────

function parseArgs(argv) {
  const out = {
    year: null,
    limit: null,
    outPath: null,
    fixture: false,
    throttle: 75,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--year") out.year = Number(argv[++i]);
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--fixture") out.fixture = true;
    else if (a === "--throttle") out.throttle = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const yearStart = args.year || DEFAULT_YEAR_START;
  const yearEnd = args.year || DEFAULT_YEAR_END;
  console.log(`NHTSA Safety fetcher starting... mode=${args.fixture ? "FIXTURE" : "LIVE"} years=${yearStart}..${yearEnd} throttle=${args.throttle}ms`);

  const snap = args.fixture
    ? await runFixture(yearStart, yearEnd)
    : await runLive({
        yearStart, yearEnd,
        limit: args.limit,
        throttleMs: args.throttle,
        onProgress: (i, n, make, roll) => {
          const avg = roll.avg_overall_stars ?? "—";
          console.log(`  ${String(i).padStart(3)}/${n}  ${make.padEnd(20)}  models=${String(roll.model_count).padStart(3)} vehicles=${String(roll.vehicle_count).padStart(4)} avg=${avg}`);
        },
      });

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  makes=${snap.make_count}  models=${snap.model_count}  vehicles=${snap.vehicle_count}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("nhtsa-safety-fetch failed:", err);
    process.exit(1);
  });
}
