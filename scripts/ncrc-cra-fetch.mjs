#!/usr/bin/env node
/**
 * NCRC / FFIEC Community Reinvestment Act (CRA) rating fetcher.
 *
 * SIGNAL
 *   Every federally-insured depository institution receives a CRA
 *   examination by FDIC, OCC, or the Federal Reserve every 1-5 years.
 *   The Federal Financial Institutions Examination Council (FFIEC)
 *   publishes the ratings publicly. Ratings are:
 *     Outstanding             — top tier (~10% of banks)
 *     Satisfactory            — majority band
 *     Needs to Improve        — warning band
 *     Substantial Noncompliance — failing
 *
 *   NCRC (National Community Reinvestment Coalition) tracks downgrade
 *   trends; the largest US banks' CRA history is essential context for
 *   "is this bank actually serving low-income communities, or extracting
 *   from them?" Fills the brief's "affordable housing / community impact"
 *   gap.
 *
 * SOURCE
 *   Primary:  https://www.ffiec.gov/craratings/default.aspx  (HTML search)
 *   Mirror :  https://ncrc.org/cra-rating-database (curated)
 *
 *   FFIEC offers ratings as a downloadable PDF per exam, no JSON API.
 *   For prototype we ship a curated fixture of the ~33 largest US banks.
 *
 * LICENSE
 *   FFIEC ratings are public records, attribution courtesy only.
 *
 * USAGE
 *   node scripts/ncrc-cra-fetch.mjs                # try live, fallback
 *   node scripts/ncrc-cra-fetch.mjs --fixture      # use sample.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/ncrc-cra");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/ncrc-cra");

const DEFAULT_REPORT_URL = "https://www.ffiec.gov/craratings/default.aspx";
const UA = "TruNorth-NCRC-CRA/1.0 (+https://www.trunorthapp.com; community reinvestment transparency)";
const TIMEOUT_MS = 15000;

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

async function loadFixture() {
  const f = path.join(FIXTURE_DIR, "sample.json");
  return JSON.parse(await fs.readFile(f, "utf-8"));
}

async function fetchLive() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DEFAULT_REPORT_URL, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // The FFIEC ratings search form requires per-bank POST queries
    // with the institution's RSSD ID — not a single JSON endpoint.
    // For the prototype we keep the curated fixture.
    throw new Error("FFIEC per-bank search not implemented — using fixture");
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

async function main() {
  console.log(`NCRC CRA fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);
  let payload;
  let mode = "fixture";

  if (!FIXTURE_MODE) {
    try { payload = await fetchLive(); mode = "live"; }
    catch (err) {
      console.warn(`  live fetch failed (${err.message}) — using fixture`);
      payload = await loadFixture();
    }
  } else {
    payload = await loadFixture();
  }

  const banks = Array.isArray(payload.banks) ? payload.banks : [];

  const output = {
    _license: payload._license || "Public — FFIEC CRA records",
    _source: payload._source_url || DEFAULT_REPORT_URL,
    _generated_at: new Date().toISOString(),
    _mode: mode,
    _vintage: payload._vintage || "2024",
    _bank_count: banks.length,
    banks,
  };

  let outPath;
  if (OUT_OVERRIDE) outPath = OUT_OVERRIDE;
  else {
    await fs.mkdir(RAW_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    outPath = path.join(RAW_DIR, `${today}.json`);
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  const counts = {};
  for (const b of banks) counts[b.rating] = (counts[b.rating] || 0) + 1;
  console.log(`  ${banks.length} banks (${mode});`, counts);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ncrc-cra-fetch failed:", err);
    process.exit(1);
  });
}
