#!/usr/bin/env node
/**
 * EPA Toxics Release Inventory (TRI) — annual chemical releases per facility.
 *
 * Pulls the publicly-posted "TRI Basic Data Files" CSVs for the most-recent
 * reporting year + 3 prior years (so the merge step can compute a 4-year
 * trend). EPA typically releases the prior reporting year in March.
 *
 * Source landing page:  https://www.epa.gov/toxics-release-inventory-tri-program/
 *                         tri-basic-data-files-calendar-years-1987-present
 * Direct CSV pattern (per-year microsite path):
 *   https://www3.epa.gov/tri/current/basic/<YYYY>/US_<YYYY>_v##.csv
 *
 * ~21,000 facilities report annually (any covered facility with >10K lbs
 * manufactured / >25K lbs processed of a listed chemical). Each row =
 * one facility × chemical × year; we sum within (PARENT_COMPANY_NAME,
 * YEAR) and track top-3 chemicals by lbs.
 *
 * Cache:   public/data/_cache/epa-tri/<year>.csv
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
const CACHE_DIR = path.join(ROOT, "public/data/_cache/epa-tri");
const FIX_DIR   = path.join(ROOT, "test/fixtures/epa");
const UA        = "TruNorth-TRI/1.0 (+https://www.trunorthapp.com)";

// TRI per-year URLs. EPA rotates a version suffix (v15, v16…) each year —
// keep this table current.
const TRI_URL_BY_YEAR = {
  2024: "https://www3.epa.gov/tri/current/basic/2024/US_2024_v15.csv",
  2023: "https://www3.epa.gov/tri/current/basic/2023/US_2023_v15.csv",
  2022: "https://www3.epa.gov/tri/current/basic/2022/US_2022_v15.csv",
  2021: "https://www3.epa.gov/tri/current/basic/2021/US_2021_v15.csv",
};

function parseArgs() {
  const a = new Set(process.argv.slice(2));
  const live = a.has("--live");
  const dry  = !live;
  const yIdx = process.argv.indexOf("--years");
  const years = yIdx >= 0 ? Number(process.argv[yIdx + 1]) : 4;
  return { dry, live, years };
}

function targetYears(n) {
  const latest = new Date().getUTCFullYear() - 1;
  return Array.from({ length: n }, (_, i) => latest - i);
}

async function downloadYear(year) {
  const url = TRI_URL_BY_YEAR[year];
  if (!url) throw new Error(`No URL pattern for TRI year ${year} — update TRI_URL_BY_YEAR`);
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
  const results = [];
  for (const y of years) {
    const src = path.join(FIX_DIR, `tri-${y}-sample.csv`);
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

  console.log(`TRI fetch — mode=${live ? "LIVE" : "DRY"}, years=${ys.join(",")}`);

  let results;
  if (dry) results = await seedFromFixtures(ys);
  else {
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
  console.log(`\nTRI fetch done — ${ok}/${ys.length} years available in cache.`);
}

main().catch(e => { console.error("epa-tri-fetch failed:", e); process.exit(1); });
