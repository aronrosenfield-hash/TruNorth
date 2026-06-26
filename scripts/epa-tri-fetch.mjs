#!/usr/bin/env node
/**
 * EPA Toxics Release Inventory (TRI) — annual chemical releases per facility.
 *
 * Pulls EPA's "TRI Basic Data File" (one denormalized national CSV per
 * reporting year) and caches it for the shared epa-emissions-merge step,
 * which sums ON-SITE + OFF-SITE releases to PARENT_COMPANY and writes
 * enriched.environment.tri_* into per-company JSON. Fetches the most-recent
 * released year + 3 prior so the merge can build a 4-year trend.
 *
 * Source (Envirofacts bulk download — public domain, no key required):
 *   https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download/<YEAR>_US/csv
 * (~55 MB / ~77k rows per year; the server rejects HEAD/Range and streams
 * the full file, so each year is a single buffered GET. EPA posts a reporting
 * year the following autumn — RY2024 posted Oct 2025.)
 *
 * The raw EPA header prefixes every column with an ordinal ("15. PARENT CO
 * NAME"). We strip that prefix and normalise to UPPER_SNAKE on write so the
 * merge's pick() matches with no per-year aliasing — e.g.
 *   "15. PARENT CO NAME"        -> PARENT_CO_NAME
 *   "37. CHEMICAL"              -> CHEMICAL
 *   "65. ON-SITE RELEASE TOTAL" -> ON-SITE_RELEASE_TOTAL
 *   "107. TOTAL RELEASES"       -> TOTAL_RELEASES   (on-site + off-site, lbs)
 * Data rows are written verbatim (the merge's CSV parser handles quoting).
 *
 * NOTE: a small share of rows (PFAS, dioxins) report in grams, not pounds
 * (col "UNIT OF MEASURE"). v1 sums TOTAL_RELEASES as-is to match the existing
 * merge; those rows are mass-negligible against the pound totals. Unit-aware
 * summing is a tracked follow-up (see BACKLOG).
 *
 * Cache:   public/data/_cache/epa-tri/<year>.csv   (header normalised)
 * Output:  none — fetch only seeds the cache; epa-emissions-merge reads it.
 *
 * Flags:
 *   --dry          (default) skip live downloads; seed from test/fixtures/epa/tri-*
 *   --live         actually hit EPA (workflow uses this)
 *   --years N      number of years to fetch (default 4: latest released + 3 prior)
 *
 * Runs via .github/workflows/epa-emissions-annual.yml (alongside GHGRP).
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
const BASE_URL  = "https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download";

function parseArgs() {
  const a = new Set(process.argv.slice(2));
  const live = a.has("--live");
  const dry  = !live; // default = dry
  const yIdx = process.argv.indexOf("--years");
  const years = yIdx >= 0 ? Number(process.argv[yIdx + 1]) : 4;
  return { dry, live, years };
}

function targetYears(n) {
  // EPA posts a reporting year's TRI data the following autumn (RY2024 posted
  // Oct 2025). So the latest fully-available year is (current year - 1) only
  // after ~October, else (current year - 2). The merge tolerates a year whose
  // file 404s (not yet posted), so this is a best-effort window.
  const now = new Date();
  const latest = now.getUTCMonth() >= 9 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
  return Array.from({ length: n }, (_, i) => latest - i);
}

// "15. PARENT CO NAME" -> "PARENT_CO_NAME". Strip the leading ordinal, collapse
// whitespace to underscores, keep hyphens, uppercase — so epa-emissions-merge's
// pick() matches (PARENT_CO_NAME / CHEMICAL / TOTAL_RELEASES / ON-SITE_RELEASE_TOTAL).
function normalizeHeaderCell(cell) {
  return String(cell)
    .replace(/^\s*\d+\.\s*/, "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();
}

function normalizeHeaderLine(line) {
  // The EPA header row has no quoted/embedded-comma columns, so a plain split
  // is safe here (data rows are written through untouched).
  return line.split(",").map(normalizeHeaderCell).join(",");
}

// Envirofacts intermittently 500s on these on-demand downloads; retry with
// backoff before giving up on a year.
async function fetchBuffer(url, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(240_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      console.warn(`    attempt ${i}/${attempts} failed: ${e.message}`);
      if (i < attempts) await new Promise(r => setTimeout(r, 4000 * i));
    }
  }
  throw lastErr;
}

async function downloadYear(year) {
  const url  = `${BASE_URL}/${year}_US/csv`;
  const dest = path.join(CACHE_DIR, `${year}.csv`);
  if (existsSync(dest)) {
    const st = await fs.stat(dest);
    if (st.size > 1024) {
      console.log(`  [${year}] cache hit (${(st.size / 1024 / 1024).toFixed(1)} MB) — skip`);
      return { year, status: "cached", path: dest };
    }
  }
  console.log(`  [${year}] downloading ${url} …`);
  const raw = (await fetchBuffer(url)).toString("utf-8");
  const nl  = raw.indexOf("\n");
  if (nl < 0) throw new Error(`No newline in TRI ${year} download (${raw.length} B) — endpoint may be down`);
  const header = normalizeHeaderLine(raw.slice(0, nl).replace(/\r$/, ""));
  // Guard against empty / garbage / renamed-schema downloads (the sandboxed-fetch
  // lesson): refuse to cache a file the merge can't aggregate.
  if (!/(^|,)PARENT_CO_NAME(,|$)/.test(header) || !/(^|,)TOTAL_RELEASES(,|$)/.test(header)) {
    throw new Error(`TRI ${year} header missing expected columns after normalise: ${header.slice(0, 200)}`);
  }
  const body = raw.slice(nl + 1);
  if (body.length < 1024) throw new Error(`TRI ${year} body suspiciously small (${body.length} B) — refusing to cache`);
  const out = header + "\n" + body;
  await fs.writeFile(dest, out);
  console.log(`  [${year}] saved ${(Buffer.byteLength(out) / 1024 / 1024).toFixed(1)} MB → ${path.relative(ROOT, dest)}`);
  return { year, status: "downloaded", path: dest, bytes: Buffer.byteLength(out) };
}

async function seedFromFixtures(years) {
  // Copy bundled fixtures into the cache so the merge runs with no network.
  // Used by the default --dry mode and CI smoke tests.
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
  console.log(`\nTRI fetch done — ${ok}/${ys.length} years available in cache.`);
  // Fail loudly if a live run produced nothing at all, so the workflow surfaces
  // it instead of silently merging stale/empty data.
  if (live && ok === 0) process.exit(1);
}

main().catch(e => { console.error("epa-tri-fetch failed:", e); process.exit(1); });
