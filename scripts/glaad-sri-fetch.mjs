#!/usr/bin/env node
/**
 * GLAAD Studio Responsibility Index + Where We Are On TV fetcher.
 *
 * SIGNAL
 *   GLAAD Media Institute issues two annual scorecards rating Hollywood
 *   studios, streamers, and broadcast/cable networks on LGBTQ+ inclusion
 *   in their slate. Grades:
 *     Excellent      ≥50% inclusive content
 *     Good           ~40-49%
 *     Fair           ~25-39%
 *     Insufficient   ~15-24%
 *     Poor           ~5-14%
 *     Failing        <5%
 *
 *   This is the only widely cited, structured, per-studio LGBTQ+
 *   representation metric. Complementary to HRC CEI (which scores
 *   *workplace* policies) by scoring *content output*. Fills the brief's
 *   "GLAAD … corporate accountability" gap.
 *
 * SOURCE
 *   https://glaad.org/sri  (Studio Responsibility Index — film studios)
 *   https://glaad.org/whereweareontv  (TV scorecard)
 *
 *   Both are published as PDF reports with summary tables; GLAAD does
 *   not yet ship a structured feed. Fixture maintained annually.
 *
 * LICENSE
 *   Public reports, attribution required.
 *
 * USAGE
 *   node scripts/glaad-sri-fetch.mjs                # try live, fallback
 *   node scripts/glaad-sri-fetch.mjs --fixture
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/glaad-sri");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/glaad-sri");

const DEFAULT_REPORT_URL = "https://glaad.org/sri";
const UA = "TruNorth-GLAAD/1.0 (+https://www.trunorthapp.com; LGBTQ+ media representation transparency)";
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
    throw new Error("live HTML parsing not implemented — using fixture");
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

async function main() {
  console.log(`GLAAD SRI fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);
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
  const studios = Array.isArray(payload.studios) ? payload.studios : [];

  const output = {
    _license: payload._license || "Public — GLAAD reports",
    _source: payload._source_url || DEFAULT_REPORT_URL,
    _generated_at: new Date().toISOString(),
    _mode: mode,
    _vintage: payload._vintage || "2024",
    _studio_count: studios.length,
    studios,
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
  for (const s of studios) counts[s.grade] = (counts[s.grade] || 0) + 1;
  console.log(`  ${studios.length} studios (${mode});`, counts);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("glaad-sri-fetch failed:", err);
    process.exit(1);
  });
}
