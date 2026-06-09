#!/usr/bin/env node
/**
 * CDP (Carbon Disclosure Project) Climate Change A-List fetcher.
 *
 * SIGNAL
 *   Annual environmental-disclosure score band (A through F) published
 *   by CDP for every company that submits — or fails to submit — a
 *   response to the CDP climate-change questionnaire. The A-List itself
 *   is published as a press release each February. CDP is the most
 *   widely cited investor-grade climate-disclosure rubric (used by 600+
 *   asset managers with $130T AUM).
 *
 *   Score bands:
 *     A   leadership (top band)
 *     A-  leadership
 *     B   management
 *     B-  management
 *     C   awareness
 *     C-  awareness
 *     D   disclosure
 *     D-  disclosure
 *     F   failure to disclose
 *
 *   This is complementary to SBTi (target validation) and Net Zero Tracker
 *   (pledge tracking) — CDP tests whether a company actually discloses
 *   verified data behind those pledges.
 *
 * SOURCE
 *   https://www.cdp.net/en/companies/companies-scores
 *   CDP exposes scores via a searchable HTML directory but no documented
 *   public JSON API. We rely on the annual A-List PDF + companion CSV
 *   posted to https://www.cdp.net/en/scores. Until CDP ships a stable
 *   feed, we ship a fixture that we hand-refresh annually.
 *
 * LICENSE / ToS
 *   The scores themselves are published openly with attribution. CDP
 *   restricts bulk redistribution of unscored questionnaire content,
 *   which we do not touch. We cite cdp.net per row.
 *
 * USAGE
 *   node scripts/cdp-climate-fetch.mjs                # try live, fallback
 *   node scripts/cdp-climate-fetch.mjs --fixture      # use sample.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/cdp-climate");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/cdp-climate");

const DEFAULT_REPORT_URL = "https://www.cdp.net/en/companies/companies-scores";
const UA = "TruNorth-CDP/1.0 (+https://www.trunorthapp.com; climate disclosure transparency)";
const TIMEOUT_MS = 15000;

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

async function loadFixture() {
  const f = path.join(FIXTURE_DIR, "sample.json");
  const text = await fs.readFile(f, "utf-8");
  return JSON.parse(text);
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
    // CDP's score directory is JS-rendered with no documented JSON
    // feed. Until that changes, fall back to the curated fixture.
    throw new Error("live HTML parsing not implemented — using fixture");
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

async function main() {
  console.log(`CDP Climate fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);

  let payload;
  let mode = "fixture";

  if (!FIXTURE_MODE) {
    try {
      payload = await fetchLive();
      mode = "live";
    } catch (err) {
      console.warn(`  live fetch failed (${err.message}) — using fixture`);
      payload = await loadFixture();
    }
  } else {
    payload = await loadFixture();
  }

  const companies = Array.isArray(payload.companies) ? payload.companies : [];

  const output = {
    _license: payload._license || "Public — CDP scores",
    _source: payload._source_url || DEFAULT_REPORT_URL,
    _generated_at: new Date().toISOString(),
    _mode: mode,
    _vintage: payload._vintage || "2024",
    _company_count: companies.length,
    companies,
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
  const aList = companies.filter(c => c.score === "A").length;
  const failures = companies.filter(c => c.score === "F").length;
  console.log(`  ${companies.length} companies (${mode}); ${aList} A-List, ${failures} F (declined to disclose)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("cdp-climate-fetch failed:", err);
    process.exit(1);
  });
}
