#!/usr/bin/env node
/**
 * DW-8 — BIS Entity List (export-control restricted entities) — weekly.
 *
 * Commerce Dept's Bureau of Industry & Security publishes the Entity List
 * (parties subject to specific export license requirements) along with the
 * Consolidated Screening List feed at trade.gov:
 *
 *   Landing:   https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/entity-list
 *   CSL CSV:   https://api.trade.gov/static/consolidated_screening_list/consolidated.csv
 *   CSL JSON:  https://data.trade.gov/consolidated_screening_list/v1/search?sources=EL
 *
 * The trade.gov CSV is the easiest unauthenticated path — no API key, no
 * pagination, full list ~3500 entries refreshed daily. We filter to
 * source="Entity List (EL) - Bureau of Industry and Security" rows.
 *
 * NOTE: trade.gov's JSON API DOES support an API key (TRADE_GOV_API_KEY)
 * for higher rate limits, but the CSV bulk file is unauthenticated and
 * always sufficient for our weekly snapshot use case. If a future feature
 * needs the JSON API, the key would be wired up here:
 *     const KEY = process.env.TRADE_GOV_API_KEY; // optional, free at trade.gov
 *
 * Output:
 *   data/raw/bis-entity-list/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N
 *   --out PATH
 *   --fixture       use scripts/fixtures/bis-entity-list/sample.csv
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV, todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/bis-entity-list");
const FIXTURE = path.join(__dirname, "fixtures/bis-entity-list/sample.csv");

export const CSL_URL = "https://api.trade.gov/static/consolidated_screening_list/consolidated.csv";
const UA = "TruNorth-BIS-EntityList/1.0 (+https://www.trunorthapp.com)";

/**
 * Convert one CSL CSV row to our shape. The CSL aggregates multiple
 * federal restricted-party lists (Entity List, Denied Persons, MEU, SSI,
 * etc.) and exposes a "source" column to disambiguate.
 *
 * For DW-8 we want ONLY the Entity List rows. The merger filters again
 * defensively, but the fetcher does the heavy filter so the raw file
 * stays small (~250kB vs ~5MB).
 */
export function parseBisRow(row) {
  return {
    entity: (row.Entity || row.name || "").trim(),
    country: (row.Country || row.country || "").trim(),
    license_requirement: (row["License Requirement"] || row.license_requirement || "").trim(),
    license_policy: (row["License Policy"] || row.license_policy || "").trim(),
    fr_citation: (row["FR Citation"] || row.federal_register_notice || "").trim(),
    effective_date: (row["Effective Date"] || row.start_date || "").trim() || null,
    last_update: (row["Last Update"] || row.end_date || "").trim() || null,
    source_list: (row["Source List"] || row.source || "Entity List").trim(),
  };
}

/** Treat anything mentioning "Entity List" as DW-8 scope. */
export function isEntityListRow(row) {
  const src = (row["Source List"] || row.source || "").toLowerCase();
  return src.includes("entity list");
}

export function buildSnapshot(entities) {
  const byCountry = {};
  for (const e of entities) {
    const c = e.country || "Unknown";
    byCountry[c] = (byCountry[c] || 0) + 1;
  }
  return {
    source: "bis-entity-list",
    source_url: CSL_URL,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    entity_count: entities.length,
    by_country: byCountry,
    entities,
  };
}

async function fetchCsl() {
  const res = await fetch(CSL_URL, { headers: { "User-Agent": UA, "Accept": "text/csv" } });
  if (!res.ok) throw new Error(`BIS CSL ${res.status} ${res.statusText}`);
  return res.text();
}

function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--fixture") out.fixture = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`BIS Entity List fetcher starting... (${args.fixture ? "FIXTURE" : "LIVE"})`);

  const csv = args.fixture
    ? await fs.readFile(FIXTURE, "utf-8")
    : await fetchCsl();

  const all = parseCSV(csv);
  const filtered = all.filter(isEntityListRow);
  let parsed = filtered.map(parseBisRow);
  if (args.limit && args.limit > 0) parsed = parsed.slice(0, args.limit);

  const snap = buildSnapshot(parsed);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap.entity_count} entity-list rows, ${all.length} total scanned)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("bis-entity-list-fetch failed:", err);
    process.exit(1);
  });
}
