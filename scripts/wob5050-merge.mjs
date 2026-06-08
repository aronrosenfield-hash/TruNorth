#!/usr/bin/env node
/**
 * 50/50 Women on Boards — Merge step.
 *
 * Reads latest data/raw/wob5050/<date>.json and writes
 * data/derived/wob5050-augment.json. Per-company shape:
 *
 *   {
 *     display_name, ticker, sector,
 *     rating: "A"|"B"|"C"|"D"|"F",
 *     women_on_board, total_board_size, pct_women,
 *     report_quarter,
 *     boardParityScore: 0..1     // computed: pct_women clipped at 50%, /50.
 *   }
 *
 * boardParityScore is a 0..1 normalized score where 50%+ women = 1.0,
 * which mirrors 5050WOB's own threshold rubric for "A" rating.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wob5050");
const OUT_DEFAULT = path.join(ROOT, "data/derived/wob5050-augment.json");

const args = process.argv.slice(2);
const IN_OVERRIDE = (() => { const i = args.indexOf("--in"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) throw new Error(`Missing ${RAW_DIR}`);
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function parityScore(pctWomen) {
  if (pctWomen == null) return null;
  const clipped = Math.min(50, Math.max(0, pctWomen));
  return Math.round((clipped / 50) * 1000) / 1000;
}

export function buildAugment(row) {
  return {
    display_name: row.company,
    ticker: row.ticker,
    sector: row.sector,
    rating: row.rating,
    women_on_board: row.women_on_board,
    total_board_size: row.total_board_size,
    pct_women: row.pct_women,
    report_quarter: row.report_quarter,
    boardParityScore: parityScore(row.pct_women),
  };
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`5050WOB merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];

  const companies = {};
  for (const r of rows) {
    const key = toSlug(r.company);
    if (!key) continue;
    companies[key] = buildAugment(r);
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "wob5050",
    source_url: "https://5050wob.com",
    upstream_file: path.relative(ROOT, inFile),
    company_count: Object.keys(companies).length,
    companies,
  }, null, 2));

  const stats = { A: 0, B: 0, C: 0, D: 0, F: 0, unknown: 0 };
  for (const k of Object.keys(companies)) {
    const g = companies[k].rating || "unknown";
    stats[g] = (stats[g] || 0) + 1;
  }
  console.log(`✅ Wrote ${outFile} — ${Object.keys(companies).length} (${JSON.stringify(stats)})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("wob5050-merge failed:", err);
    process.exit(1);
  });
}
