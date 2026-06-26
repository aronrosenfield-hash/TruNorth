#!/usr/bin/env node
/**
 * EPA Greenhouse Gas Reporting Program (GHGRP) — annual facility-level CO2e
 * downloader.
 *
 * Builds one CSV per reporting year of every large emitter's total reported
 * CO2e, keyed to its PARENT_COMPANY, so the shared epa-emissions-merge step
 * can re-aggregate to parent and write enriched.environment.ghg_* into the
 * per-company JSON (latest year + up to 3 prior = a 4-year trend).
 *
 * Source (EPA Envirofacts REST API — public domain, no key required). We join
 * two tables on facility_id + year and append /CSV for CSV output:
 *
 *   ghg_emitter_facilities          → facility_id, facility_name, parent_company,
 *                                      year (~7,544 facilities/yr; parent populated)
 *   pub_facts_sector_ghg_emission   → facility_id, year, co2e_emission (metric tons),
 *                                      ONE ROW PER gas/subsector (~26k rows/yr) — so
 *                                      co2e MUST be summed per (facility_id, year)
 *
 *   https://data.epa.gov/efservice/ghg_emitter_facilities/year/<YEAR>/CSV
 *   https://data.epa.gov/efservice/pub_facts_sector_ghg_emission/year/<YEAR>/CSV
 *
 * Envirofacts caps rows per request, so we PAGE with inclusive row ranges
 *   .../year/<YEAR>/rows/0:9999/CSV  then 10000:19999, … until a page returns
 * no data rows (a fully past-the-end page comes back completely empty). Every
 * page repeats the header, so each page's header is skipped on parse. The
 * /excel variant 500s — never use it; CSV only. Envirofacts also intermittently
 * 500s, so each page fetch retries with backoff.
 *
 * parent_company carries an ownership suffix, e.g. "PUGET HOLDINGS LLC (100%)"
 * or multi-owner "DIAMOND GENERATING CORPORATION (14.00002%); SOMECO (86%)".
 * We strip the " (NN%)" suffix and, for multi-owner strings, keep the FIRST
 * owner (before the first ";") as the parent.
 *
 * Available years: 2021, 2022, 2023 ONLY. RY2024 is not released until ~Oct
 * 2026 — querying it returns 0 rows, which is handled gracefully (the year is
 * skipped, not fabricated).
 *
 * For each year we write ONE ROW PER FACILITY-YEAR (parent company + that
 * facility's TOTAL summed CO2e + the year). The merge re-aggregates to parent.
 *
 * Cache:   public/data/_cache/epa-ghgrp/<year>.csv   (gitignored)
 * Output:  none — fetch only seeds the cache; epa-emissions-merge reads it.
 * Header:  PARENT_COMPANY,GHG_QUANTITY_METRIC_TONS_CO2E,REPORTING_YEAR,FACILITY_ID,FACILITY_NAME
 *
 * Flags:
 *   --dry          (default) skip live downloads; seed from test/fixtures/epa/ghgrp-*
 *   --live         actually hit EPA (workflow uses this)
 *   --years N      number of years to fetch (default 4: latest available + 3 prior,
 *                  clamped to the 2021–2023 window that actually exists)
 *
 * Runs via .github/workflows/epa-emissions-annual.yml (alongside TRI).
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
const EFSERVICE = "https://data.epa.gov/efservice";

// Reporting years that actually exist in Envirofacts. RY2024 returns 0 rows
// until EPA publishes it (~Oct 2026); querying outside this window is a no-op.
const LATEST_YEAR   = 2023;
const EARLIEST_YEAR = 2021;
const PAGE_SIZE     = 10_000;          // Envirofacts row-range page width
const MAX_PAGES     = 50;              // safety stop (~500k rows) — never reached today
// Refuse to overwrite a year's cache with an implausibly small download (the
// sandboxed-fetch lesson). A real year is ~7,000+ facility rows.
const MIN_FACILITY_ROWS = 500;

function parseArgs() {
  const a = new Set(process.argv.slice(2));
  const live = a.has("--live");
  const dry  = !live; // default = dry
  const yIdx = process.argv.indexOf("--years");
  const years = yIdx >= 0 ? Number(process.argv[yIdx + 1]) : 4;
  return { dry, live, years };
}

function targetYears(n) {
  // Latest available reporting year is fixed at LATEST_YEAR (EPA releases a
  // reporting year ~10 months out). Walk back `n` years but clamp to the
  // 2021–2023 window — never emit a year EPA hasn't published.
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = LATEST_YEAR - i;
    if (y < EARLIEST_YEAR) break;
    out.push(y);
  }
  return out;
}

// Strip Envirofacts' ownership suffix from parent_company. Examples:
//   "PUGET HOLDINGS LLC (100%)"                         -> "PUGET HOLDINGS LLC"
//   "DIAMOND GENERATING CORPORATION (14.00002%); X (86%)" -> "DIAMOND GENERATING CORPORATION"
//   "US GOVERNMENT (%)"                                  -> "US GOVERNMENT"  (empty pct)
// Multi-owner strings are ";"-separated; we take the FIRST owner.
function cleanParent(raw) {
  if (!raw) return "";
  let s = String(raw).split(";")[0];          // first owner only
  s = s.replace(/\s*\([\d.]*%\)\s*$/, "");     // drop trailing "(NN%)" or "(%)"
  return s.trim();
}

// Minimal RFC 4180 CSV line parser — handles quoted fields with embedded
// commas/quotes (facility names like "Nucor Steel Sedalia, LLC").
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

// Quote a single CSV field if it contains a comma, quote, or newline.
function csvField(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Envirofacts intermittently 500s; retry each page with backoff before failing
// the year. Mirrors epa-tri-fetch.mjs's fetchBuffer style.
async function fetchText(url, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      console.warn(`    attempt ${i}/${attempts} failed: ${e.message}`);
      if (i < attempts) await new Promise(r => setTimeout(r, 4000 * i));
    }
  }
  throw lastErr;
}

// Page an Envirofacts table by inclusive row ranges, parsing each page's
// (repeated) header and yielding objects keyed by lower-cased column name.
// Stops when a page returns no data rows (a past-the-end page is empty).
async function* pageTable(table, year) {
  for (let p = 0; p < MAX_PAGES; p++) {
    const lo = p * PAGE_SIZE;
    const hi = lo + PAGE_SIZE - 1;
    const url = `${EFSERVICE}/${table}/year/${year}/rows/${lo}:${hi}/CSV`;
    const text = await fetchText(url);
    const lines = text.split(/\r?\n/).filter(l => l.length > 0);
    if (lines.length <= 1) return;            // empty page (header-only or blank) — done
    const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    let yielded = 0;
    for (let li = 1; li < lines.length; li++) {
      const cells = parseCsvLine(lines[li]);
      const row = {};
      for (let c = 0; c < header.length; c++) row[header[c]] = cells[c];
      yield row;
      yielded++;
    }
    // A full page means there may be more; a short page is the last one.
    if (yielded < PAGE_SIZE) return;
  }
  console.warn(`    ${table} ${year}: hit MAX_PAGES (${MAX_PAGES}) — truncating`);
}

async function downloadYear(year) {
  if (year < EARLIEST_YEAR || year > LATEST_YEAR) {
    console.log(`  [${year}] not yet published by EPA (window ${EARLIEST_YEAR}–${LATEST_YEAR}) — skip`);
    return { year, status: "unavailable" };
  }
  const dest = path.join(CACHE_DIR, `${year}.csv`);
  if (existsSync(dest)) {
    const st = await fs.stat(dest);
    if (st.size > 1024) {
      console.log(`  [${year}] cache hit (${(st.size / 1024 / 1024).toFixed(2)} MB) — skip`);
      return { year, status: "cached", path: dest };
    }
  }

  // 1) facilities → facility_id -> { parent, name }
  console.log(`  [${year}] fetching ghg_emitter_facilities …`);
  const facilities = new Map();
  for await (const row of pageTable("ghg_emitter_facilities", year)) {
    const id = row.facility_id;
    if (!id) continue;
    const parent = cleanParent(row.parent_company);
    if (!parent) continue;                    // no parent → can't attribute
    facilities.set(id, { parent, name: row.facility_name || "" });
  }
  console.log(`  [${year}] facilities with parent: ${facilities.size}`);
  if (facilities.size < MIN_FACILITY_ROWS) {
    throw new Error(`only ${facilities.size} facilities for ${year} (< ${MIN_FACILITY_ROWS}) — refusing to cache`);
  }

  // 2) emissions → sum co2e per facility_id
  console.log(`  [${year}] fetching pub_facts_sector_ghg_emission …`);
  const co2eById = new Map();
  let emisRows = 0;
  for await (const row of pageTable("pub_facts_sector_ghg_emission", year)) {
    const id = row.facility_id;
    if (!id) continue;
    const v = Number(row.co2e_emission);
    if (!Number.isFinite(v) || v === 0) continue;
    co2eById.set(id, (co2eById.get(id) || 0) + v);
    emisRows++;
  }
  console.log(`  [${year}] emission rows summed: ${emisRows} → ${co2eById.size} facilities`);

  // 3) join → one CSV row per facility with both a parent and positive CO2e
  const header = "PARENT_COMPANY,GHG_QUANTITY_METRIC_TONS_CO2E,REPORTING_YEAR,FACILITY_ID,FACILITY_NAME";
  const out = [header];
  for (const [id, { parent, name }] of facilities) {
    const tons = co2eById.get(id);
    if (!tons || tons <= 0) continue;
    out.push([
      csvField(parent),
      Math.round(tons),
      year,
      csvField(id),
      csvField(name),
    ].join(","));
  }
  const dataRows = out.length - 1;
  if (dataRows < MIN_FACILITY_ROWS) {
    throw new Error(`only ${dataRows} joined facility-rows for ${year} (< ${MIN_FACILITY_ROWS}) — refusing to cache`);
  }

  const body = out.join("\n") + "\n";
  await fs.writeFile(dest, body);
  console.log(`  [${year}] saved ${dataRows} facility rows (${(Buffer.byteLength(body) / 1024 / 1024).toFixed(2)} MB) → ${path.relative(ROOT, dest)}`);
  return { year, status: "downloaded", path: dest, rows: dataRows };
}

async function seedFromFixtures(years) {
  // Copy bundled fixtures into the cache so the merge runs with no network.
  // Used by the default --dry mode and CI smoke tests.
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

  const ok = results.filter(r => ["downloaded", "cached", "fixture"].includes(r.status)).length;
  console.log(`\nGHGRP fetch done — ${ok}/${ys.length} years available in cache.`);
  // Fail loudly if a live run produced nothing usable, so the workflow surfaces
  // it instead of silently merging stale/empty data.
  if (live && ok === 0) process.exit(1);
}

main().catch(e => { console.error("epa-ghgrp-fetch failed:", e); process.exit(1); });
