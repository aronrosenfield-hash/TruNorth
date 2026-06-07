#!/usr/bin/env node
/**
 * TX Ethics Commission — campaign-finance bulk fetch (B-data11).
 *
 * Source:   https://www.ethics.state.tx.us/data/search/cf/
 * Bulk:     https://www.ethics.state.tx.us/data/search/cf/TEC_CF_CSV.zip
 *           (full DB export: contribs.csv, expend.csv, cover.csv, filers.csv;
 *            updated nightly, ~250MB)
 *
 * The Texas Ethics Commission's bulk download contains every campaign-finance
 * record reported to TEC. Contributions BY a corporation/PAC are in
 * contribs.csv with payerName = company/PAC, payeeName = candidate/committee.
 *
 * STRATEGY
 *   - Live mode: fetch the bulk ZIP, extract contribs.csv, filter to records
 *     payerType in {CORP,LLC,PAC,ASSOC}. Unimplemented in this branch.
 *   - Dry-run mode (default): read fixture CSV.
 *
 * OUTPUT  public/data/_raw/tx-ethics-donations.json
 *
 * Locally:
 *   node scripts/tx-ethics-fetch.mjs            # --dry default
 *   node scripts/tx-ethics-fetch.mjs --live     # not implemented
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test/fixtures/state-finance/tx/contributions.csv");
const OUT_FILE = path.join(ROOT, "public/data/_raw/tx-ethics-donations.json");

const LIVE = process.argv.includes("--live");
const DRY  = !LIVE;

const TEC_BULK = "https://www.ethics.state.tx.us/data/search/cf/TEC_CF_CSV.zip";
const UA = "TruNorth-TEC/1.0 (+https://www.trunorthapp.com)";
const FOUR_YEARS_MS = 4 * 365 * 24 * 60 * 60 * 1000;

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return rows;
  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  // TX fixture uses camelCase headers; normalize them.
  const map = {
    "filername": "filer_name",
    "recipientname": "recipient_name",
    "contributionamount": "amount",
    "contributiondate": "date",
    "recipientparty": "party",
    "recipientoffice": "office",
  };
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    header.forEach((h, j) => {
      const key = map[h] || h;
      row[key] = (cells[j] ?? "").trim();
    });
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
    "Live TEC pull is not implemented in this script. The bulk ZIP at " +
    TEC_BULK + " is ~250MB and should be downloaded + filtered in a dedicated " +
    "runner. Use --dry."
  );
}

async function main() {
  console.log(`TEC fetch starting (${LIVE ? "LIVE" : "DRY-RUN"})...`);

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
    source:     "tx-ethics-commission",
    source_url: "https://www.ethics.state.tx.us/data/search/cf/",
    bulk_url:   TEC_BULK,
    mode:       LIVE ? "live" : "dry-run",
    window:     "4y",
    row_count:  rows.length,
    rows,
  }, null, 2));

  console.log(`Wrote ${OUT_FILE} (${rows.length} rows after 4y filter)`);
}

main().catch(err => {
  console.error("tx-ethics-fetch failed:", err.message);
  process.exit(1);
});
