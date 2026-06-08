#!/usr/bin/env node
/**
 * WBA Social Benchmark — World Benchmarking Alliance's annual ranking of
 * ~2,000 "most influential" global companies on 18 human-rights / decent-
 * work / ethics indicators.
 *
 * Source landing page: https://www.worldbenchmarkingalliance.org/publication/social/
 * The page exposes downloadable Excel + CSV files via a "Download data"
 * widget. The exact URL changes per release (annual), so we scrape the
 * landing for the most-recent CSV/XLSX link and prefer CSV. If only XLSX
 * is published in a given year, we fall back to a checked-in fixture and
 * leave a TODO for maintenance to drop in a one-shot XLSX→CSV converter.
 *
 * Output: data/raw/wba-social/<YYYY-MM-DD>.json
 *
 * Cadence: annual (typically published Q2 each year).
 *
 * Flags:
 *   (no args)        → dry run from fixture
 *   --apply / --live → hit worldbenchmarkingalliance.org
 *   --limit N        → cap output rows
 *   --out PATH       → override raw output path
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wba-social");
const FIXTURE = path.join(ROOT, "test/fixtures/wba-social/sample.csv");
const LANDING = "https://www.worldbenchmarkingalliance.org/publication/social/";
const UA = "TruNorth-WBA-Social/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const OUT_OVERRIDE = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

export function normalizeRow(r) {
  const name = r["Company"] ?? r.company ?? r["Company Name"] ?? "";
  if (!name) return null;
  const num = (k) => {
    const v = r[k];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(String(v).replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return {
    company: String(name).trim(),
    headquarters: r["Headquarters"] ?? r.country ?? null,
    industry: r["Industry"] ?? r.sector ?? null,
    rank: num("Rank"),
    total_score: num("Total Score"),
    human_rights_score: num("Respecting Human Rights Score"),
    decent_work_score: num("Providing Decent Work Score"),
    ethics_score: num("Acting Ethically Score"),
    indicators_met: num("Indicators Met"),
    total_indicators: num("Total Indicators"),
  };
}

export function findDataLink(html, base = "https://www.worldbenchmarkingalliance.org") {
  if (!html) return null;
  // Prefer .csv > .xlsx if present.
  const csvRe = /href=["']([^"']+\.csv[^"']*)["']/gi;
  let m;
  while ((m = csvRe.exec(html))) {
    if (/social|benchmark/i.test(m[1])) {
      return m[1].startsWith("http") ? m[1] : new URL(m[1], base).toString();
    }
  }
  // Fallback to any CSV.
  csvRe.lastIndex = 0;
  if ((m = csvRe.exec(html))) {
    return m[1].startsWith("http") ? m[1] : new URL(m[1], base).toString();
  }
  return null;
}

async function fetchLive() {
  const res = await fetch(LANDING, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`WBA landing fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const url = findDataLink(html);
  if (!url) {
    // TODO: WBA frequently publishes XLSX-only. Add an xlsx reader (e.g.
    // node-stream-zip + a tiny XML parser of xl/sharedStrings.xml +
    // xl/worksheets/sheet1.xml) or call out to a one-shot Python CLI.
    console.warn("⚠️  WBA: no .csv link on landing; falling back to fixture.");
    return null;
  }
  console.log(`⬇️  WBA CSV: ${url}`);
  const csvRes = await fetch(url, { headers: { "User-Agent": UA } });
  if (!csvRes.ok) throw new Error(`WBA CSV fetch failed: HTTP ${csvRes.status}`);
  return await csvRes.text();
}

async function main() {
  console.log(`WBA Social fetcher (${APPLY ? "LIVE" : "DRY/fixture"})`);
  const text = APPLY ? (await fetchLive() ?? await fs.readFile(FIXTURE, "utf-8"))
                     : await fs.readFile(FIXTURE, "utf-8");
  const raw = parseCSVToObjects(text);
  let rows = raw.map(normalizeRow).filter(Boolean);
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "wba-social",
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
    console.error("wba-social-fetch failed:", err);
    process.exit(1);
  });
}
