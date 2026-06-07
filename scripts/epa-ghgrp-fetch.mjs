#!/usr/bin/env node
/**
 * EPA Greenhouse Gas Reporting Program (GHGRP) — annual facility-level CO2e
 * downloader.
 *
 * Pulls the publicly-posted "GHGRP – Subpart A – Direct Emitters" CSVs for
 * the most-recent reporting year + 3 prior years (so the merge step can
 * compute a 4-year YoY trend). EPA posts the prior reporting year in
 * March each year (so the workflow runs Apr 1).
 *
 * Source landing page:  https://www.epa.gov/ghgreporting/data-sets
 * Bulk data archive:    https://www.epa.gov/ghgreporting/ghgrp-data-sets
 * Direct CSV pattern    (varies slightly per year — EPA changes the path):
 *   https://www.epa.gov/sites/default/files/ghgreporting/
 *     ghgp_data_<YEAR>_us_ghg_emissions_by_facility.csv
 *
 * ~8,000 large emitters report annually (any facility >25,000 metric tons
 * CO2e). Each row = one facility-year-subpart combo; we sum within
 * (FACILITY_ID, PARENT_COMPANY, REPORTING_YEAR).
 *
 * Cache:   public/data/_cache/epa-ghgrp/<year>.csv
 * Output:  none — fetch only seeds the cache; merge script reads it.
 *
 * Flags:
 *   --dry          (default) skip live downloads; use test/fixtures/epa/*
 *   --live         actually hit EPA (workflow uses this)
 *   --years N      number of years to fetch (default 4: current + 3 prior)
 *
 * Runs via .github/workflows/epa-emissions-annual.yml on Apr 1.
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "public/data/_cache/epa-ghgrp");
const FIX_DIR   = path.join(ROOT, "test/fixtures/epa");
const UA        = "TruNorth-GHGRP/1.0 (+https://www.trunorthapp.com)";

// EPA's CSV URLs change each year (different microsite paths). Maintain a
// per-year override map; fall back to the standard pattern. The 4 years
// hardcoded below correspond to reporting years 2021–2024 (data released
// 2022–2025). Workflow callers should update once a year.
const GHGRP_URL_BY_YEAR = {
  2024: "https://www.epa.gov/system/files/other-files/2025-10/ghgp_data_2024.csv",
  2023: "https://www.epa.gov/system/files/other-files/2024-10/ghgp_data_2023.csv",
  2022: "https://www.epa.gov/system/files/other-files/2023-10/ghgp_data_2022.csv",
  2021: "https://www.epa.gov/system/files/other-files/2022-10/ghgp_data_2021.csv",
};

function parseArgs() {
  const a = new Set(process.argv.slice(2));
  const live = a.has("--live");
  const dry  = !live; // default = dry
  const yIdx = process.argv.indexOf("--years");
  const years = yIdx >= 0 ? Number(process.argv[yIdx + 1]) : 4;
  return { dry, live, years };
}

function targetYears(n) {
  // Latest fully-reported year is current year - 1 (EPA releases prior-year data
  // in spring). Run on Apr 1 in workflow.
  const latest = new Date().getUTCFullYear() - 1;
  return Array.from({ length: n }, (_, i) => latest - i);
}

async function downloadYear(year) {
  const url = GHGRP_URL_BY_YEAR[year];
  if (!url) throw new Error(`No URL pattern for GHGRP year ${year} — update GHGRP_URL_BY_YEAR`);
  const dest = path.join(CACHE_DIR, `${year}.csv`);
  if (existsSync(dest)) {
    const st = await fs.stat(dest);
    if (st.size > 1024) {
      console.log(`  [${year}] cache hit (${(st.size / 1024 / 1024).toFixed(1)} MB) — skip`);
      return { year, status: "cached", path: dest };
    }
  }
  console.log(`  [${year}] downloading ${url} …`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  console.log(`  [${year}] saved ${(buf.length / 1024 / 1024).toFixed(1)} MB → ${path.relative(ROOT, dest)}`);
  return { year, status: "downloaded", path: dest, bytes: buf.length };
}

async function seedFromFixtures(years) {
  // Copy bundled fixtures to the cache so the merge step runs with no
  // network access. Used by the default --dry mode and by CI smoke tests.
  const results = [];
  for (const y of years) {
    const src = path.join(FIX_DIR, `ghgrp-${y}-sample.csv`);
    const dst = path.join(CACHE_DIR, `${y}.csv`);
    if (!existsSync(src)) {
      console.log(`  [${y}] no fixture (${path.relative(ROOT, src)}) — skipping`);
      results.push({ year: y, status: "no_fixture" });
      continue;
    }
    await fs.copyFile(src, dst);
    const st = await fs.stat(dst);
    console.log(`  [${y}] fixture copied (${st.size} B) → ${path.relative(ROOT, dst)}`);
    results.push({ year: y, status: "fixture", path: dst, bytes: st.size });
  }
  return results;
}

async function main() {
  const { dry, live, years } = parseArgs();
  const ys = targetYears(years);
  await fs.mkdir(CACHE_DIR, { recursive: true });

  console.log(`GHGRP fetch — mode=${live ? "LIVE" : "DRY"}, years=${ys.join(",")}`);

  let results;
  if (dry) {
    results = await seedFromFixtures(ys);
  } else {
    results = [];
    for (const y of ys) {
      try { results.push(await downloadYear(y)); }
      catch (e) {
        console.warn(`  [${y}] failed: ${e.message}`);
        results.push({ year: y, status: "error", error: e.message });
      }
    }
  }

  const ok = results.filter(r => r.status === "downloaded" || r.status === "cached" || r.status === "fixture").length;
  console.log(`\nGHGRP fetch done — ${ok}/${ys.length} years available in cache.`);
}

main().catch(e => { console.error("epa-ghgrp-fetch failed:", e); process.exit(1); });
