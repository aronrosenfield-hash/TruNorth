#!/usr/bin/env node
/**
 * WBA Social — Merge step.
 *
 * Reads the most-recent data/raw/wba-social/<date>.json snapshot, groups
 * by normalized company name, and writes the augment delta to
 * data/derived/wba-social-augment.json.
 *
 * Per-company shape:
 *   {
 *     display_name, industry, headquarters,
 *     rank,
 *     total_score, human_rights_score, decent_work_score, ethics_score,
 *     indicators_met, total_indicators,
 *     score_band: "leader" | "mid" | "laggard",
 *     wbaSocialPercentile: number,   // 0..1, lower rank → higher percentile
 *   }
 *
 * The band thresholds are conservative: leaders are top decile (score
 * >= ~13 of 18), laggards are bottom quartile (<= ~4.5). The exact
 * thresholds are pure data-derived — the merge step computes them per
 * run so they self-adjust as the benchmark evolves.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wba-social");
const OUT_DEFAULT = path.join(ROOT, "data/derived/wba-social-augment.json");

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

/**
 * Compute leader/mid/laggard thresholds from this run's score distribution.
 * Returns { leader, laggard } — score >= leader is "leader", score <=
 * laggard is "laggard", else "mid". Falls back to fixed defaults if there
 * aren't enough rows to compute reliable quantiles.
 */
export function computeBands(scores) {
  const xs = scores.filter(s => typeof s === "number" && Number.isFinite(s)).slice().sort((a, b) => a - b);
  if (xs.length < 10) return { leader: 13, laggard: 4.5 };
  const q = (p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return { leader: q(0.9), laggard: q(0.25) };
}

export function bandFor(score, { leader, laggard }) {
  if (score == null) return null;
  if (score >= leader)  return "leader";
  if (score <= laggard) return "laggard";
  return "mid";
}

export function buildAugment(row, bands, maxRank) {
  return {
    display_name: row.company,
    industry: row.industry,
    headquarters: row.headquarters,
    rank: row.rank,
    total_score: row.total_score,
    human_rights_score: row.human_rights_score,
    decent_work_score: row.decent_work_score,
    ethics_score: row.ethics_score,
    indicators_met: row.indicators_met,
    total_indicators: row.total_indicators,
    score_band: bandFor(row.total_score, bands),
    // Lower rank = higher percentile (rank 1 of 2000 ⇒ percentile 1.0).
    wbaSocialPercentile: (row.rank && maxRank)
      ? Math.round(((maxRank - row.rank + 1) / maxRank) * 1000) / 1000
      : null,
  };
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`WBA Social merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];
  const bands = computeBands(rows.map(r => r.total_score));
  const maxRank = rows.reduce((m, r) => (typeof r.rank === "number" && r.rank > m ? r.rank : m), 0);

  const companies = {};
  for (const r of rows) {
    const key = toSlug(r.company);
    if (!key) continue;
    const incoming = buildAugment(r, bands, maxRank);
    const existing = companies[key];
    // If we see the same company twice, keep the better rank.
    if (!existing || (incoming.rank && (!existing.rank || incoming.rank < existing.rank))) {
      companies[key] = incoming;
    }
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "wba-social",
    source_url: "https://www.worldbenchmarkingalliance.org/publication/social/",
    upstream_file: path.relative(ROOT, inFile),
    bands,
    company_count: Object.keys(companies).length,
    companies,
  }, null, 2));
  console.log(`✅ Wrote ${outFile} — ${Object.keys(companies).length} companies (bands: ${JSON.stringify(bands)})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("wba-social-merge failed:", err);
    process.exit(1);
  });
}
