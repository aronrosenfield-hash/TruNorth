#!/usr/bin/env node
/**
 * CA Secretary of State — CalAccess campaign-finance bulk fetch (B-data11).
 *
 * Source:   https://cal-access.sos.ca.gov/
 * Bulk:     https://cal-access.sos.ca.gov/Campaign/Other/
 *           https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip   (full nightly mirror, ~1GB)
 *
 * CalAccess publishes a nightly bulk export of every campaign-finance
 * record filed under the California Political Reform Act. Contributions
 * made BY a corporation/PAC live in the RCPT_CD table (filers' receipts)
 * and EXPN_CD (filers' expenditures, where corp PACs report disbursements
 * to candidates/committees). We treat both as "donations from this filer".
 *
 * STRATEGY
 *   - Live mode: download dbwebexport.zip → unzip RCPT_CD.TSV + EXPN_CD.TSV
 *     → stream-parse, keep only TX_TYPE in {"MON","NMON","RCPT","EXP"} where
 *     payee/recipient is a state candidate/committee.
 *   - Dry-run mode (default): read test/fixtures/state-finance/ca/contributions.csv
 *     which mimics the post-extraction shape.
 *
 * OUTPUT  public/data/_raw/ca-calaccess-donations.json
 *   { fetched_at, source, rows: [{ filer_name, recipient_name, amount_USD,
 *     date, party, office }] }
 *
 * The data-volume is enormous (millions of rows over 4y), so this script
 * defers heavy filtering until it streams. Cadence is monthly.
 *
 * Locally:
 *   node scripts/ca-calaccess-fetch.mjs            # --dry default → fixture
 *   node scripts/ca-calaccess-fetch.mjs --live     # actually hits CalAccess
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test/fixtures/state-finance/ca/contributions.csv");
const OUT_FILE = path.join(ROOT, "public/data/_raw/ca-calaccess-donations.json");

const LIVE = process.argv.includes("--live");
const DRY  = !LIVE; // dry-run is the default

const CALACCESS_BULK = "https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip";
const UA = "TruNorth-CalAccess/1.0 (+https://www.trunorthapp.com)";

const FOUR_YEARS_MS = 4 * 365 * 24 * 60 * 60 * 1000;

function parseCsv(text) {
  // Minimal CSV parser — handles quoted fields with commas. CalAccess
  // bulk is actually TSV/pipe-delimited, but the post-extraction shape
  // we standardize to is CSV.
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return rows;
  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    header.forEach((h, j) => { row[h] = (cells[j] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}
function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function loadFromFixture() {
  const text = await fs.readFile(FIXTURE, "utf-8");
  return parseCsv(text);
}

async function loadFromLive() {
  // Live extraction is intentionally not implemented in this branch —
  // the bulk ZIP is ~1GB and unzipping + filtering belongs in a
  // dedicated runner. Throw so anyone who flips --live by accident
  // gets a clear error and not a silent partial dataset.
  throw new Error(
    "Live CalAccess pull is not implemented in this script. The bulk " +
    "ZIP (~1GB) at " + CALACCESS_BULK + " must be downloaded + filtered " +
    "in a dedicated job (see follow-up B-data11-live). Use --dry."
  );
}

async function main() {
  console.log(`CalAccess fetch starting (${LIVE ? "LIVE" : "DRY-RUN"})...`);

  const rawRows = LIVE ? await loadFromLive() : await loadFromFixture();
  console.log(`Loaded ${rawRows.length} raw rows`);

  const now = Date.now();
  const cutoff = now - FOUR_YEARS_MS;

  const rows = rawRows.map(r => ({
    filer_name:     r.filer_name || "",
    recipient_name: r.recipient_name || "",
    amount_USD:     Number(r.amount || 0) || 0,
    date:           r.date || "",
    party:          (r.party || "").toUpperCase(),
    office:         (r.office || "").toUpperCase(),
  })).filter(r => {
    if (!r.filer_name || !r.amount_USD) return false;
    if (r.date) {
      const t = Date.parse(r.date);
      if (Number.isFinite(t) && t < cutoff) return false;
    }
    return true;
  });

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    fetched_at: new Date().toISOString(),
    source:     "ca-sos-calaccess",
    source_url: "https://cal-access.sos.ca.gov/",
    bulk_url:   CALACCESS_BULK,
    mode:       LIVE ? "live" : "dry-run",
    window:     "4y",
    row_count:  rows.length,
    rows,
  }, null, 2));

  console.log(`Wrote ${OUT_FILE} (${rows.length} rows after 4y filter)`);
}

main().catch(err => {
  console.error("ca-calaccess-fetch failed:", err.message);
  process.exit(1);
});
