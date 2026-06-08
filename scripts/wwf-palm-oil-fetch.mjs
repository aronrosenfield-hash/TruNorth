#!/usr/bin/env node
/**
 * WWF Palm Oil Buyer Scorecard — annual scrape.
 *
 * Source: https://palmoilscorecard.panda.org (WWF, public)
 * License: Public scorecard, cited with source URL on every record.
 *
 * Methodology (2024 cycle):
 *   - WWF approached ~285 of the largest global palm-oil buyers
 *   - Each scored 0-24 on commitments, sourcing, traceability, accountability
 *   - Tiers:
 *       Non-respondent      (no response submitted, score 0)
 *       Lagging behind       0 - 10.99
 *       Middle of the pack  11 - 16.49
 *       Well on path        16.5 - 19.49
 *       Leading the way     19.5 - 24
 *
 * WWF publishes a downloadable XLSX at /WWF_POBS_<YEAR>_full_results.xlsx
 * with one row per company plus dozens of sub-criterion columns. We extract
 * the per-company summary fields: name, country, region, sector, response
 * status, total score, own-supply-chain score, beyond-supply-chain score.
 *
 * Cadence: annual (WWF publishes roughly every 1-2 years; we run quarterly
 * via the workflow so a methodology revision is picked up promptly).
 *
 * Output: data/raw/wwf-palm-oil/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --apply / --live    fetch the live XLSX (otherwise: use fixture)
 *   --limit N           cap the number of rows written (debug)
 *   --out <path>        override the raw JSON output path
 *   --year YYYY         override the year guessed for the live URL
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "./lib/xlsx-minimal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wwf-palm-oil");
const FIXTURE = path.join(ROOT, "test/fixtures/wwf-palm-oil/sample.xlsx");
const LANDING = "https://palmoilscorecard.panda.org";
const SCORES_PAGE = "https://palmoilscorecard.panda.org/scores";
const UA = "TruNorth-WWF-PalmOil/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();
const YEAR_OVERRIDE = (() => { const i = args.indexOf("--year"); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null; })();

const KNOWN_YEAR = 2024; // The most recent published cycle as of 2026-06.

/**
 * Map a score (or "0" for Non-respondents) into the WWF tier label.
 * Returns null for null/undefined inputs.
 */
export function scoreTier(score, responseStatus) {
  if (responseStatus && /non[- ]?respondent/i.test(responseStatus)) return "Non-respondent";
  if (score == null || !Number.isFinite(Number(score))) return null;
  const s = Number(score);
  if (s >= 19.5) return "Leading the way";
  if (s >= 16.5) return "Well on path";
  if (s >= 11)   return "Middle of the pack";
  return "Lagging behind";
}

/**
 * Build the per-row record we serialize. Pass `header` array + 1 cell row.
 * Returns null for blank rows.
 */
export function normalizeRow(row, headerIndex) {
  if (!row || row.length === 0) return null;
  const get = (h) => {
    const i = headerIndex[h];
    return i == null ? null : row[i] ?? null;
  };
  const name = get("Company name");
  if (!name || typeof name !== "string") return null;
  const score = toNum(get("Total score (out of 24)"));
  const responseStatus = (get("Response status") || "").toString().trim() || null;
  return {
    company: name.trim().replace(/\s+/g, " "),
    country: (get("Country of HQ") || "").toString().trim() || null,
    region: (get("Region of HQ") || "").toString().trim() || null,
    sector: (get("Sector") || "").toString().trim() || null,
    response_status: responseStatus,
    total_score: score,
    own_supply_chain_score: toNum(get("\"Own supply chain\" score")),
    beyond_supply_chain_score: toNum(get("\"Beyond supply chain\" score")),
    total_palm_oil_volume: toNum(get("Total palm oil volume purchased")),
    tier: scoreTier(score, responseStatus),
  };
}

function toNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? round(v) : null;
  const s = String(v).trim();
  if (!s || /^n\/?a$/i.test(s)) return null;
  const n = Number(s.replace(/[, %]/g, ""));
  return Number.isFinite(n) ? round(n) : null;
}

function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Scrape the WWF landing page for the most recent XLSX results link.
 * Falls back to constructing the canonical URL by year if no match found.
 */
export function findXlsxLink(html, base = LANDING, year = KNOWN_YEAR) {
  if (html) {
    const re = /href=["']([^"']+\.xlsx[^"']*)["']/gi;
    const matches = [];
    let m;
    while ((m = re.exec(html))) matches.push(m[1]);
    // Prefer a results/scorecard XLSX, then most recent year, then any.
    const scored = matches.map((u) => {
      const lower = u.toLowerCase();
      let pri = 99;
      if (/(full[_-]?results?|scorecard|pobs)/i.test(lower)) pri = 0;
      else if (/(score|palm|wwf)/i.test(lower)) pri = 1;
      const yMatch = /(20\d{2})/.exec(lower);
      const y = yMatch ? parseInt(yMatch[1], 10) : 0;
      return { u, pri, y };
    });
    scored.sort((a, b) => a.pri - b.pri || b.y - a.y);
    if (scored.length) {
      const best = scored[0].u;
      return best.startsWith("http") ? best : new URL(best, base).toString();
    }
  }
  // Fallback to the canonical URL pattern WWF has used (2024 cycle).
  return new URL(`/WWF_POBS_${year}_full_results.xlsx`, base).toString();
}

async function fetchLive(year) {
  // Scrape both the landing + scores page in case the XLSX link moves.
  const candidates = [SCORES_PAGE, LANDING];
  let html = "";
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) { html += "\n" + await res.text(); }
    } catch (e) {
      console.warn(`⚠️  WWF: failed to fetch ${url}: ${e.message}`);
    }
  }
  const xlsxUrl = findXlsxLink(html, LANDING, year);
  console.log(`⬇️  WWF Palm Oil XLSX: ${xlsxUrl}`);
  const res = await fetch(xlsxUrl, { headers: { "User-Agent": UA, Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*" } });
  if (!res.ok) throw new Error(`WWF XLSX fetch failed: HTTP ${res.status}`);
  const arr = await res.arrayBuffer();
  return { buf: Buffer.from(arr), url: xlsxUrl };
}

/**
 * Locate the header row in the parsed XLSX. The WWF sheet has merged "group"
 * headers on row 1 (e.g. "COMMITMENTS", "PURCHASING SUSTAINABLE PALM OIL")
 * and real column headers on row 2. Look for the row containing "Company name".
 */
export function locateHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] || [];
    if (r.some(c => typeof c === "string" && /^company name$/i.test(c.trim()))) {
      const index = {};
      r.forEach((cell, idx) => {
        if (typeof cell === "string" && cell.trim()) index[cell.trim()] = idx;
      });
      return { rowIdx: i, index };
    }
  }
  throw new Error("WWF Palm Oil: could not locate header row (expected 'Company name')");
}

async function main() {
  console.log(`WWF Palm Oil Buyer Scorecard fetcher (${APPLY ? "LIVE" : "DRY/fixture"})`);
  const year = YEAR_OVERRIDE ?? KNOWN_YEAR;
  let buf, sourceUrl;
  if (APPLY) {
    try {
      const live = await fetchLive(year);
      buf = live.buf;
      sourceUrl = live.url;
    } catch (e) {
      console.warn(`⚠️  Live fetch failed (${e.message}); falling back to fixture.`);
      buf = await fs.readFile(FIXTURE);
      sourceUrl = `fixture:${path.relative(ROOT, FIXTURE)}`;
    }
  } else {
    buf = await fs.readFile(FIXTURE);
    sourceUrl = `fixture:${path.relative(ROOT, FIXTURE)}`;
  }

  const { rows, sheetName } = readXlsx(buf);
  const { rowIdx, index } = locateHeader(rows);
  let parsed = rows
    .slice(rowIdx + 1)
    .map(r => normalizeRow(r, index))
    .filter(Boolean);
  if (LIMIT) parsed = parsed.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "wwf-palm-oil-scorecard",
    source_url: LANDING,
    upstream_xlsx: sourceUrl,
    year,
    sheet_name: sheetName,
    mode: APPLY ? "live" : "fixture",
    row_count: parsed.length,
    scoring_scale: "0-24",
    tiers: {
      "Leading the way": "19.5 - 24",
      "Well on path": "16.5 - 19.49",
      "Middle of the pack": "11 - 16.49",
      "Lagging behind": "0 - 10.99",
      "Non-respondent": "no response submitted",
    },
    rows: parsed,
  }, null, 2));
  console.log(`✅ Wrote ${outPath} — ${parsed.length} brands`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("wwf-palm-oil-fetch failed:", err);
    process.exit(1);
  });
}
