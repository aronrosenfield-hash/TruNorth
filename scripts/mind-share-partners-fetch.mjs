#!/usr/bin/env node
/**
 * Mental Health at Work Pledge — workplace-mental-health coalition signatories.
 *
 * SIGNAL
 *   Three overlapping public commitment programs:
 *     - Mental Health at Work Pledge (Mind Share Partners + SHRM,
 *       launched 2022) — a 5-pillar commitment for US employers.
 *     - One Mind at Work CEO Pledge (operating since 2017) — focused on
 *       Fortune-500 CEOs publicly committing to gold-standard mental
 *       health policy.
 *     - APA Foundation Center for Workplace Mental Health "Notable
 *       Practices" recognition.
 *
 *   Combined these are the closest US analogue to a public workplace-
 *   mental-health certification. Fills the brief's explicit gap.
 *
 * SOURCE
 *   https://www.mindsharepartners.org/mental-health-at-work-pledge
 *   https://onemind.org/onemindatwork/
 *
 *   Neither program ships a JSON feed; both publish their signatory
 *   list on HTML pages. Fixture maintained quarterly.
 *
 * LICENSE
 *   Public coalition lists, attribution courtesy.
 *
 * USAGE
 *   node scripts/mind-share-partners-fetch.mjs                # try live
 *   node scripts/mind-share-partners-fetch.mjs --fixture
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/mind-share-partners");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/mind-share-partners");

const DEFAULT_URL = "https://www.mindsharepartners.org/mental-health-at-work-pledge";
const UA = "TruNorth-MindShare/1.0 (+https://www.trunorthapp.com; workplace mental health transparency)";
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
    const res = await fetch(DEFAULT_URL, {
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
  console.log(`Mind Share Partners fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);
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
  const signatories = Array.isArray(payload.signatories) ? payload.signatories : [];

  const output = {
    _license: payload._license || "Public coalition list",
    _source: payload._source_url || DEFAULT_URL,
    _generated_at: new Date().toISOString(),
    _mode: mode,
    _vintage: payload._vintage || "2024",
    _signatory_count: signatories.length,
    signatories,
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
  console.log(`  ${signatories.length} signatories (${mode})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("mind-share-partners-fetch failed:", err);
    process.exit(1);
  });
}
