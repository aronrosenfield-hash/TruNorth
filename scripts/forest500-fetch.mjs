#!/usr/bin/env node
/**
 * Forest 500 — the 350 companies + 150 financial institutions with the
 * largest tropical-deforestation exposure across soy/palm/beef/timber/pulp.
 *
 * https://forest500.org — annual scorecard publication. Each year produces:
 *   - An overall report (PDF)
 *   - Per-commodity CSVs (soy.csv, palm.csv, beef.csv, timber.csv, pulp.csv)
 *   - An overall scores CSV
 *
 * The exact filename/path changes per year ("/research/2024/" → /2025/ etc).
 * We scrape the landing for any href ending in .csv with "score" or
 * "scorecard" in the URL/text. If we can't find one, we fall back to a
 * checked-in fixture.
 *
 * Output: data/raw/forest500/<YYYY-MM-DD>.json
 *
 * Cadence: annual (typically published Jan-Mar).
 *
 * Flags identical to sbti-fetch.mjs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/forest500");
const FIXTURE = path.join(ROOT, "test/fixtures/forest500/sample.csv");
const LANDING = "https://forest500.org";
const UA = "TruNorth-Forest500/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

/**
 * Map a "Score N/A" cell to null, a numeric score to a Number.
 */
function num(v) {
  if (v == null || v === "" || /^n\/?a$/i.test(String(v).trim())) return null;
  const n = Number(String(v).replace(/[, %]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeRow(r) {
  const name = r["Company"] ?? r.company ?? "";
  if (!name) return null;
  const commoditiesRaw = r["Commodities Exposed"] ?? r.commodities ?? "";
  const commodities = String(commoditiesRaw)
    .split(/[,;\/]/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return {
    company: String(name).trim(),
    country: r["Country"] ?? null,
    sector: r["Sector"] ?? null,
    entity_type: (r["Type"] || "").toLowerCase().includes("financial") ? "financial_institution" : "company",
    overall_score_2024: num(r["Overall Score 2024"]),
    soy_score: num(r["Soy Score"]),
    palm_score: num(r["Palm Oil Score"]),
    beef_score: num(r["Beef Score"]),
    timber_score: num(r["Timber Score"]),
    pulp_score: num(r["Pulp & Paper Score"]),
    commodities,
  };
}

export function findCsvLink(html, base = "https://forest500.org") {
  if (!html) return null;
  const re = /href=["']([^"']+\.csv[^"']*)["'][^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/score|forest500|companies|annual/i.test(m[1] + " " + m[2])) {
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
  if (!res.ok) throw new Error(`Forest500 landing fetch failed: HTTP ${res.status}`);
  const url = findCsvLink(await res.text());
  if (!url) {
    // TODO: If Forest500 ships scorecards only as Excel in a given year,
    // add an xlsx unpacker here. For now: graceful fixture fallback.
    console.warn("⚠️  Forest500: no CSV link on landing; using fixture.");
    return null;
  }
  console.log(`⬇️  Forest500 CSV: ${url}`);
  const csvRes = await fetch(url, { headers: { "User-Agent": UA } });
  if (!csvRes.ok) throw new Error(`Forest500 CSV fetch failed: HTTP ${csvRes.status}`);
  return await csvRes.text();
}

async function main() {
  console.log(`Forest 500 fetcher (${APPLY ? "LIVE" : "DRY/fixture"})`);
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
    source: "forest500",
    source_url: LANDING,
    mode: APPLY ? "live" : "fixture",
    row_count: rows.length,
    rows,
  }, null, 2));
  console.log(`✅ Wrote ${outPath} — ${rows.length} entities`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("forest500-fetch failed:", err);
    process.exit(1);
  });
}
