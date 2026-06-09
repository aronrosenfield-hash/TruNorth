#!/usr/bin/env node
/**
 * B-37c — ATF FFL download helper.
 *
 * 2026-06-09: investigated auto-downloading the ATF FFL monthly CSVs.
 * Conclusion: atf.gov is fronted by Akamai bot detection; ALL non-browser
 * requests return HTTP 403 (Reference #18.cc06d217.* from errors.edgesuite.net).
 * Confirmed with multiple User-Agent strings (curl, Chrome, Safari) and
 * full browser-realistic headers. Akamai's bot detection requires real
 * JavaScript execution + cookie acquisition flow.
 *
 * Realistic paths to auto-download:
 *   1. Playwright/Puppeteer in GH Actions — heavy infra (~150MB browser
 *      install each run), brittle to Akamai signature updates.
 *   2. Run from a residential IP via a proxy service — costs $$ and ToS-
 *      adjacent.
 *   3. Manual download once a month, drop into public/data/_raw/atf-ffl/.
 *
 * For now: option 3. This helper prints what's expected, what's present,
 * and what's missing, so the monthly manual download takes < 5 minutes.
 *
 * USAGE
 *   node scripts/atf-download-helper.mjs
 *
 * EXIT
 *   0 — all expected license types present
 *   1 — missing files
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "public/data/_raw/atf-ffl");

const LICENSE_TYPES = [
  { code: "01", label: "Dealer in Firearms (other than destructive devices)" },
  { code: "02", label: "Pawnbroker in Firearms (other than destructive devices)" },
  { code: "03", label: "Collector of Curios and Relics" },
  { code: "06", label: "Manufacturer of Ammunition for Firearms" },
  { code: "07", label: "Manufacturer of Firearms (other than destructive devices)" },
  { code: "08", label: "Importer of Firearms (other than destructive devices)" },
  { code: "09", label: "Dealer in Destructive Devices" },
  { code: "10", label: "Manufacturer of Destructive Devices" },
  { code: "11", label: "Importer of Destructive Devices" },
];

const SOURCE_URL = "https://www.atf.gov/firearms/listing-federal-firearms-licensees";

function listExisting() {
  if (!fs.existsSync(RAW_DIR)) {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    return [];
  }
  return fs.readdirSync(RAW_DIR).filter((f) => /\.(csv|txt)$/i.test(f));
}

function detectLicenseType(filename) {
  // Common ATF filename patterns:
  //   0625-type-01-ffl.csv
  //   ffl-listing-2026-04-01.csv
  //   type-07-...
  const m = filename.match(/(?:type[-_]?)(\d{2})/i) || filename.match(/-(\d{2})-ffl/i) || filename.match(/^(\d{2})-/);
  return m ? m[1] : null;
}

function main() {
  const existing = listExisting();
  const byType = new Map();
  for (const f of existing) {
    const t = detectLicenseType(f);
    if (t) byType.set(t, f);
  }

  console.log("=".repeat(72));
  console.log("ATF FFL monthly download helper");
  console.log("=".repeat(72));
  console.log("");
  console.log("Source:  " + SOURCE_URL);
  console.log("Target:  " + path.relative(ROOT, RAW_DIR) + "/");
  console.log("");
  console.log("STATUS PER LICENSE TYPE:");
  console.log("-".repeat(72));

  let missing = 0;
  for (const lt of LICENSE_TYPES) {
    const got = byType.get(lt.code);
    if (got) {
      const stat = fs.statSync(path.join(RAW_DIR, got));
      const size = (stat.size / 1024).toFixed(0) + " KB";
      const date = stat.mtime.toISOString().slice(0, 10);
      console.log(`  type-${lt.code}  ✅  ${got}  (${size}, modified ${date})`);
    } else {
      console.log(`  type-${lt.code}  ❌  ${lt.label.slice(0, 50)}`);
      missing++;
    }
  }

  console.log("");
  if (missing === 0) {
    console.log("All 9 license types present. Ready to run:");
    console.log("  node scripts/atf-fetch.mjs");
    console.log("  node scripts/atf-merge.mjs");
    process.exit(0);
  } else {
    console.log("=".repeat(72));
    console.log(`MISSING ${missing} of 9 license-type files.`);
    console.log("");
    console.log("MANUAL DOWNLOAD STEPS:");
    console.log("  1. Open " + SOURCE_URL + " in a browser");
    console.log("  2. Scroll to 'Listings of Federal Firearms Licensees by Type'");
    console.log("  3. Click each per-type CSV/TXT link (one per FFL type 01-11)");
    console.log("  4. Save into:  " + path.relative(ROOT, RAW_DIR) + "/");
    console.log("     (filename can keep ATF's default — the helper auto-detects type-NN)");
    console.log("  5. Re-run this helper to verify:");
    console.log("       node scripts/atf-download-helper.mjs");
    console.log("");
    console.log("WHY NO AUTO-DOWNLOAD:  atf.gov is behind Akamai bot detection.");
    console.log("All non-browser User-Agents (curl, GitHub Actions) get HTTP 403.");
    console.log("Auto-download would require headless browser infra (Playwright).");
    console.log("");
    process.exit(1);
  }
}

main();
