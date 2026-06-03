#!/usr/bin/env node
/**
 * FRA — Federal Railroad Administration safety data (weekly)
 *
 * For each US railroad reporting to the FRA, queries the official DOT
 * open data portal (Socrata) for accident/incident reports filed under
 * 49 CFR Part 225 ("Form FRA F 6180.54"), then aggregates a 5-year
 * window of:
 *   - total_incidents_5y
 *   - fatalities_5y
 *   - hazmat_releases_5y      (sum of `hazmatreleasedcars`)
 *   - sample_incidents (5 most recent)
 *
 * Output: /public/data/fra-incidents.json (overwritten weekly).
 *
 * Strategy: enumerate distinct railroad names from the dataset, then
 * for each name slugify and let the merger route to our company slugs
 * via slug-aliases + brand-parent-map (same pattern as cfpb-fetch.mjs).
 *
 * Source dataset:
 *   - Page: https://railroads.dot.gov/safety-data
 *   - Public site: https://safetydata.fra.dot.gov/officeofsafety
 *   - Socrata JSON: https://data.transportation.gov/resource/85tf-25kj.json
 *     (FRA Equipment Accident/Incident — Form F 6180.54)
 *
 * Free, no auth. Courtesy 1 req/sec, UA "TruNorth-FRA/1.0".
 *
 * Runs via .github/workflows/fra-weekly.yml Mon 08:00 UTC.
 * Locally: node scripts/fra-fetch.mjs
 *
 * Smoke-test (subset): SMOKE=1 node scripts/fra-fetch.mjs
 *   → only fetches Norfolk Southern, Union Pacific, CSX, BNSF.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/fra-incidents.json");

const FRA_BASE = "https://data.transportation.gov/resource/85tf-25kj.json";
const UA = "TruNorth-FRA/1.0 (+https://www.trunorthapp.com)";
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const REQ_DELAY_MS = 1000;

const SMOKE_NAMES = [
  "Norfolk Southern Railway Company",
  "Union Pacific Railroad Company",
  "CSX Transportation",
  "BNSF Railway Company",
];

// Slugify identical to TruNorth's company file convention: lowercase,
// non-alphanumerics → "-", collapse + trim.
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fraFetch(query) {
  const url = `${FRA_BASE}?${query}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`FRA ${res.status} for ${url}`);
  }
  return res.json();
}

// Enumerate every distinct reporting railroad name in the dataset.
async function listRailroads() {
  const q = "$select=distinct%20reportingrailroadname,reporting_railroad_class&$limit=50000";
  const rows = await fraFetch(q);
  return rows
    .map(r => ({
      name: r.reportingrailroadname,
      class: r.reporting_railroad_class || null,
    }))
    .filter(r => r.name);
}

// Aggregate counts for a single railroad over the 5-year window.
async function aggregateRailroad(railroadName, cutoffIso) {
  // Single SoQL query — Socrata returns sums + count atomically.
  const where =
    `reportingrailroadname=%27${encodeURIComponent(railroadName).replace(/'/g, "%27%27")}%27` +
    `%20AND%20date%20%3E%20%27${cutoffIso}%27`;
  const q =
    `$select=count(*),sum(totalpersonskilled),sum(hazmatreleasedcars)` +
    `&$where=${where}`;
  const agg = await fraFetch(q);
  return {
    total_incidents_5y: Number(agg[0]?.count ?? 0),
    fatalities_5y:      Number(agg[0]?.sum_totalpersonskilled ?? 0),
    hazmat_releases_5y: Number(agg[0]?.sum_hazmatreleasedcars ?? 0),
  };
}

// Pull the 5 most-recent incidents for a railroad (in the 5y window).
async function sampleIncidents(railroadName, cutoffIso) {
  const where =
    `reportingrailroadname=%27${encodeURIComponent(railroadName).replace(/'/g, "%27%27")}%27` +
    `%20AND%20date%20%3E%20%27${cutoffIso}%27`;
  const q =
    `$select=date,accidenttype,statename,countyname,trainspeed,totalpersonskilled,` +
    `totalpersonsinjured,hazmatreleasedcars,totaldamagecost,primaryaccidentcause,accidentnumber` +
    `&$where=${where}&$order=date%20DESC&$limit=5`;
  const rows = await fraFetch(q);
  return rows.map(r => ({
    date:               r.date ? r.date.slice(0, 10) : null,
    accident_type:      r.accidenttype ?? null,
    state:              r.statename ?? null,
    county:             r.countyname ?? null,
    train_speed_mph:    r.trainspeed != null ? Number(r.trainspeed) : null,
    persons_killed:     Number(r.totalpersonskilled ?? 0),
    persons_injured:    Number(r.totalpersonsinjured ?? 0),
    hazmat_released_cars: Number(r.hazmatreleasedcars ?? 0),
    damage_cost_usd:    Number(r.totaldamagecost ?? 0),
    primary_cause:      r.primaryaccidentcause ?? null,
    accident_number:    r.accidentnumber ?? null,
  }));
}

async function fetchOne(railroad, cutoffIso) {
  try {
    const agg = await aggregateRailroad(railroad.name, cutoffIso);
    await new Promise(r => setTimeout(r, REQ_DELAY_MS));
    let samples = [];
    if (agg.total_incidents_5y > 0) {
      samples = await sampleIncidents(railroad.name, cutoffIso);
    }
    return {
      slug:               slugify(railroad.name),
      name:               railroad.name,
      railroad_class:     railroad.class,
      status:             agg.total_incidents_5y > 0 ? "ok" : "no_incidents",
      ...agg,
      sample_incidents:   samples,
      fetched_at:         new Date().toISOString(),
    };
  } catch (err) {
    return {
      slug:   slugify(railroad.name),
      name:   railroad.name,
      status: "error",
      error:  err.message,
    };
  }
}

async function main() {
  console.log("FRA safety fetcher starting...");
  const smoke = process.env.SMOKE === "1";

  const cutoffIso = new Date(Date.now() - FIVE_YEARS_MS)
    .toISOString().slice(0, 19);
  console.log(`5-year cutoff: ${cutoffIso}`);

  let railroads;
  if (smoke) {
    railroads = SMOKE_NAMES.map(n => ({ name: n, class: "Class I" }));
    console.log(`SMOKE mode — ${railroads.length} railroads`);
  } else {
    railroads = await listRailroads();
    console.log(`Loaded ${railroads.length} distinct railroads from FRA`);
    await new Promise(r => setTimeout(r, REQ_DELAY_MS));
  }

  const results = [];
  for (let i = 0; i < railroads.length; i++) {
    const r = await fetchOne(railroads[i], cutoffIso);
    results.push(r);
    if (i % 25 === 0) console.log(`  ...${i}/${railroads.length}`);
    await new Promise(r => setTimeout(r, REQ_DELAY_MS));
  }

  const withIncidents = results.filter(r => r.status === "ok").length;
  const noIncidents   = results.filter(r => r.status === "no_incidents").length;
  const errors        = results.filter(r => r.status === "error").length;

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:           new Date().toISOString(),
    cutoff_date:            cutoffIso,
    window_years:           5,
    railroad_count:         railroads.length,
    with_incidents_count:   withIncidents,
    no_incidents_count:     noIncidents,
    error_count:            errors,
    source: {
      portal:   "https://railroads.dot.gov/safety-data",
      site:     "https://safetydata.fra.dot.gov/officeofsafety",
      dataset:  "https://data.transportation.gov/resource/85tf-25kj.json",
      form:     "FRA F 6180.54",
    },
    railroads: results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With incidents: ${withIncidents}`);
  console.log(`   No incidents:   ${noIncidents}`);
  console.log(`   Errors:         ${errors}`);
}

main().catch(err => {
  console.error("fra-fetch failed:", err);
  process.exit(1);
});
