#!/usr/bin/env node
/**
 * NY State Board of Elections — campaign-finance bulk fetch (B-data11).
 *
 * Source:   https://publicreporting.elections.ny.gov/
 * Bulk:     https://publicreporting.elections.ny.gov/DownloadCampaignFinanceData/DownloadCampaignFinanceData
 *           (returns a per-cycle ZIP of CSVs: contributions, expenditures,
 *            committees, candidates)
 *
 * The NYSBOE "Public Reporting" site exposes bulk downloads per filing
 * cycle. Contributions BY a corporation/PAC live in the contributions
 * CSV (filer = donor org → recipient = NY candidate/committee).
 *
 * STRATEGY
 *   - Live mode: would post to the DownloadCampaignFinanceData form with
 *     a cycle parameter, follow the redirect, save ZIP, unzip the
 *     contributions CSV. Intentionally unimplemented in this branch.
 *   - Dry-run mode (default): read fixture CSV.
 *
 * OUTPUT  public/data/_raw/ny-elections-donations.json
 *
 * Locally:
 *   node scripts/ny-elections-fetch.mjs            # --dry default
 *   node scripts/ny-elections-fetch.mjs --live     # not implemented
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test/fixtures/state-finance/ny/contributions.csv");
const OUT_FILE = path.join(ROOT, "public/data/_raw/ny-elections-donations.json");

const LIVE = process.argv.includes("--live");
const DRY  = !LIVE;

const NYSBOE_BULK = "https://publicreporting.elections.ny.gov/DownloadCampaignFinanceData/DownloadCampaignFinanceData";
const UA = "TruNorth-NYSBOE/1.0 (+https://www.trunorthapp.com)";
const FOUR_YEARS_MS = 4 * 365 * 24 * 60 * 60 * 1000;

function parseCsv(text) {
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
  throw new Error(
    "Live NYSBOE pull is not implemented in this script. The DownloadCampaignFinanceData " +
    "endpoint at " + NYSBOE_BULK + " returns multi-hundred-MB cycle ZIPs that should be " +
    "fetched + filtered in a dedicated runner. Use --dry."
  );
}

async function main() {
  console.log(`NYSBOE fetch starting (${LIVE ? "LIVE" : "DRY-RUN"})...`);

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
    source:     "ny-state-board-of-elections",
    source_url: "https://publicreporting.elections.ny.gov/",
    bulk_url:   NYSBOE_BULK,
    mode:       LIVE ? "live" : "dry-run",
    window:     "4y",
    row_count:  rows.length,
    rows,
  }, null, 2));

  console.log(`Wrote ${OUT_FILE} (${rows.length} rows after 4y filter)`);
}

main().catch(err => {
  console.error("ny-elections-fetch failed:", err.message);
  process.exit(1);
});
