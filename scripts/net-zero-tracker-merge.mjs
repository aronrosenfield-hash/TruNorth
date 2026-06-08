#!/usr/bin/env node
/**
 * Net Zero Tracker — Merge step.
 *
 * Reads the most recent data/raw/net-zero-tracker/<date>.json (produced by
 * scripts/net-zero-tracker-fetch.mjs), slugifies company names, and writes
 * augmentation deltas to data/derived/net-zero-tracker-augment.json keyed
 * by slug.
 *
 * Output shape (per the DW spec):
 *   {
 *     generated_at: ISO,
 *     source: "net-zero-tracker",
 *     source_url: "https://zerotracker.net",
 *     company_count: N,
 *     companies: {
 *       "<slug>": {
 *         display_name: "...",
 *         environment: {
 *           netZeroPledge: {
 *             targetYear: 2030,
 *             qualityGrade: "A" | "B" | "C" | "D" | "F" | null,
 *             status: "committed" | "in-progress" | "achieved" | "missed" | "none",
 *             sourceUrl: "https://..."
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * A downstream merger (separate task) will fan-out this augment file into
 * per-company JSON under public/data/companies/.
 *
 * Dedup rule when multiple rows hit the same slug (rare — usually just
 * different subsidiaries of the same parent): keep the *better* grade.
 * Tie-break with sooner target_year (more ambitious).
 *
 * Flags:
 *   --in PATH    — read this file instead of the newest in data/raw/net-zero-tracker/
 *   --out PATH   — override default data/derived/net-zero-tracker-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/net-zero-tracker");
const OUT_FILE_DEFAULT = path.join(ROOT, "data/derived/net-zero-tracker-augment.json");

const args = process.argv.slice(2);
const IN_OVERRIDE = (() => {
  const i = args.indexOf("--in");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();
const OUT_OVERRIDE = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) {
    throw new Error(`Missing raw dir ${RAW_DIR}. Run net-zero-tracker-fetch.mjs first.`);
  }
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No raw files in ${RAW_DIR}. Run net-zero-tracker-fetch.mjs first.`);
  }
  return path.join(RAW_DIR, files[files.length - 1]);
}

/**
 * Build the per-company augment block in the {environment:{netZeroPledge:...}}
 * nested shape requested by the DW spec.
 */
export function buildAugmentBlock(row) {
  return {
    display_name: row.company,
    environment: {
      netZeroPledge: {
        targetYear: row.target_year ?? null,
        qualityGrade: row.quality_grade ?? null,
        status: row.status,
        sourceUrl: row.source_url ?? null,
      },
    },
  };
}

const GRADE_RANK = { A: 5, B: 4, C: 3, D: 2, F: 1 };

/**
 * Pick the better of two augment blocks. Higher grade wins; tie-break on
 * sooner target_year (more ambitious); tie-break further on row presence
 * of a sourceUrl.
 */
export function pickBetter(a, b) {
  const aGrade = GRADE_RANK[a.environment.netZeroPledge.qualityGrade] ?? 0;
  const bGrade = GRADE_RANK[b.environment.netZeroPledge.qualityGrade] ?? 0;
  if (aGrade !== bGrade) return aGrade > bGrade ? a : b;
  const aYr = a.environment.netZeroPledge.targetYear ?? 9999;
  const bYr = b.environment.netZeroPledge.targetYear ?? 9999;
  if (aYr !== bYr) return aYr < bYr ? a : b;
  if (!a.environment.netZeroPledge.sourceUrl && b.environment.netZeroPledge.sourceUrl) return b;
  return a;
}

export function groupByCompany(rows) {
  const out = {};
  for (const row of rows) {
    const key = toSlug(row.company);
    if (!key) continue;
    const incoming = buildAugmentBlock(row);
    const existing = out[key];
    out[key] = existing ? pickBetter(existing, incoming) : incoming;
  }
  return out;
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_FILE_DEFAULT;
  console.log(`NZT merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];
  const companies = groupByCompany(rows);
  const keys = Object.keys(companies);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "net-zero-tracker",
    source_url: "https://zerotracker.net",
    license: src.license || "Open data — free for non-commercial use with attribution to Net Zero Tracker.",
    upstream_file: path.relative(ROOT, inFile),
    company_count: keys.length,
    companies,
  }, null, 2));

  console.log(`✅ Wrote ${outFile} — ${keys.length} unique companies`);

  // Quick stats so CI logs are useful at a glance.
  const byGrade  = { A:0, B:0, C:0, D:0, F:0, null:0 };
  const byStatus = {};
  for (const k of keys) {
    const c = companies[k].environment.netZeroPledge;
    const g = c.qualityGrade ?? "null";
    byGrade[g] = (byGrade[g] || 0) + 1;
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }
  console.log(`   By grade : ${JSON.stringify(byGrade)}`);
  console.log(`   By status: ${JSON.stringify(byStatus)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("net-zero-tracker-merge failed:", err);
    process.exit(1);
  });
}
