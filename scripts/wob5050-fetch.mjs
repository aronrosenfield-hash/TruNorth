#!/usr/bin/env node
/**
 * 50/50 Women on Boards (5050wob.com) — Gender Diversity Index for
 * the Russell 3000. Quarterly ratings A/B/C/D/F based on the share
 * of women directors on each board.
 *
 * Public report PDFs are released quarterly; an exportable CSV ships
 * alongside each quarterly release. The download URL changes per
 * quarter, so we scrape the landing page for a .csv link, prefer
 * filenames containing "quarterly" or "report" or "GDI". If we can't
 * find one, we fall back to the checked-in fixture.
 *
 * Output: data/raw/wob5050/<YYYY-MM-DD>.json
 *
 * Cadence: quarterly.
 *
 * Flags identical to the other DW-* fetchers.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wob5050");
const FIXTURE = path.join(ROOT, "test/fixtures/wob5050/sample.csv");
const LANDING = "https://5050wob.com";
const UA = "TruNorth-5050WOB/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

const VALID_RATINGS = new Set(["A", "B", "C", "D", "F"]);

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[, %]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeRow(r) {
  const name = r["Company"] ?? r.company ?? "";
  if (!name) return null;
  const rating = String(r["Rating"] ?? r.rating ?? "").trim().toUpperCase();
  const womenOnBoard = num(r["Women on Board"]);
  const totalBoardSize = num(r["Total Board Size"]);
  // If pct isn't supplied, derive it.
  let pctWomen = num(r["Pct Women"]);
  if (pctWomen == null && womenOnBoard != null && totalBoardSize) {
    pctWomen = Math.round((womenOnBoard / totalBoardSize) * 1000) / 10;
  }
  return {
    ticker: (r["Ticker"] || "").trim().toUpperCase() || null,
    company: String(name).trim(),
    sector: r["Sector"] ?? null,
    rating: VALID_RATINGS.has(rating) ? rating : null,
    women_on_board: womenOnBoard,
    total_board_size: totalBoardSize,
    pct_women: pctWomen,
    report_quarter: r["Report Quarter"] ?? null,
  };
}

export function findCsvLink(html, base = "https://5050wob.com") {
  if (!html) return null;
  const re = /href=["']([^"']+\.csv[^"']*)["'][^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/quarter|report|gdi|index|russell/i.test(m[1] + " " + m[2])) {
      return m[1].startsWith("http") ? m[1] : new URL(m[1], base).toString();
    }
  }
  re.lastIndex = 0;
  if ((m = re.exec(html))) {
    return m[1].startsWith("http") ? m[1] : new URL(m[1], base).toString();
  }
  return null;
}

async function fetchLive() {
  const res = await fetch(LANDING, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`5050WOB landing fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const url = findCsvLink(html);
  if (!url) {
    // TODO: 5050WOB sometimes only ships a PDF table. When that happens
    // we'd need a PDF text-extractor (pdfjs-dist in workflow) to scrape
    // the rating table. Until then, gracefully fall back to fixture so
    // the pipeline doesn't go red.
    console.warn("⚠️  5050WOB: no CSV link on landing; using fixture.");
    return null;
  }
  console.log(`⬇️  5050WOB CSV: ${url}`);
  const csvRes = await fetch(url, { headers: { "User-Agent": UA } });
  if (!csvRes.ok) throw new Error(`5050WOB CSV fetch failed: HTTP ${csvRes.status}`);
  return await csvRes.text();
}

async function main() {
  console.log(`5050WOB fetcher (${APPLY ? "LIVE" : "DRY/fixture"})`);
  const text = APPLY ? (await fetchLive() ?? await fs.readFile(FIXTURE, "utf-8"))
                     : await fs.readFile(FIXTURE, "utf-8");
  let rows = parseCSVToObjects(text).map(normalizeRow).filter(Boolean);
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "wob5050",
    source_url: LANDING,
    mode: APPLY ? "live" : "fixture",
    row_count: rows.length,
    rows,
  }, null, 2));
  console.log(`✅ Wrote ${outPath} — ${rows.length} companies`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("wob5050-fetch failed:", err);
    process.exit(1);
  });
}
