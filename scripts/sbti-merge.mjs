#!/usr/bin/env node
/**
 * SBTi — Merge step.
 *
 * Reads the most recent data/raw/sbti/<date>.json (produced by
 * scripts/sbti-fetch.mjs), normalizes company names, and writes
 * augmentation deltas to data/derived/sbti-augment.json keyed by
 * normalized company name.
 *
 * The augment file shape is:
 *   {
 *     generated_at: ISO,
 *     source: "sbti",
 *     source_url: "...",
 *     row_count: N,
 *     companies: {
 *       "<normalized-name>": {
 *         display_name: "...",
 *         sector: "...",
 *         country: "...",
 *         target_type: "1.5°C" | "Well-below 2°C" | "Net-Zero" | null,
 *         target_year: 2030,
 *         status: "committed" | "approved" | "removed",
 *         net_zero_committed: boolean,
 *         net_zero_year: number | null,
 *         date_published: "YYYY-MM-DD",
 *         hasScienceBasedTarget: boolean,           // approved or committed
 *         scienceBasedTargetActive: boolean,        // approved (not removed)
 *       }
 *     }
 *   }
 *
 * A downstream merger (separate task) will fan-out this augment file into
 * per-company JSON under public/data/companies/. By writing only the
 * delta here, we keep the augment file diff-friendly and small.
 *
 * Flags:
 *   --in PATH    — read this file instead of the newest in data/raw/sbti/
 *   --out PATH   — override default data/derived/sbti-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/sbti");
const OUT_FILE_DEFAULT = path.join(ROOT, "data/derived/sbti-augment.json");

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
    throw new Error(`Missing raw dir ${RAW_DIR}. Run sbti-fetch.mjs first.`);
  }
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No raw files in ${RAW_DIR}. Run sbti-fetch.mjs first.`);
  }
  return path.join(RAW_DIR, files[files.length - 1]);
}

/**
 * Build the per-company augment block. Pure function for ease of testing.
 */
export function buildAugmentBlock(row) {
  const active = row.status === "approved";
  const present = row.status === "approved" || row.status === "committed";
  return {
    display_name: row.company,
    sector: row.sector,
    country: row.country,
    target_type: row.target_type,
    target_year: row.target_year,
    status: row.status,
    net_zero_committed: !!row.net_zero_committed,
    net_zero_year: row.net_zero_year,
    date_published: row.date_published,
    hasScienceBasedTarget: present,
    scienceBasedTargetActive: active,
  };
}

/**
 * Group rows by normalized name. If duplicates exist (e.g. same company
 * with both a near-term and net-zero entry), prefer "approved" > "committed"
 * > "removed", with the most-recent date_published breaking ties.
 */
export function groupByCompany(rows) {
  const STATUS_RANK = { approved: 3, committed: 2, removed: 1, unknown: 0 };
  const out = {};
  for (const row of rows) {
    const key = toSlug(row.company);
    if (!key) continue;
    const incoming = buildAugmentBlock(row);
    const existing = out[key];
    if (!existing) { out[key] = incoming; continue; }
    const incRank = STATUS_RANK[incoming.status] ?? 0;
    const exRank  = STATUS_RANK[existing.status] ?? 0;
    if (incRank > exRank) {
      out[key] = incoming;
    } else if (incRank === exRank) {
      const exDate = Date.parse(existing.date_published || 0) || 0;
      const inDate = Date.parse(incoming.date_published || 0) || 0;
      if (inDate > exDate) out[key] = incoming;
    }
  }
  return out;
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_FILE_DEFAULT;
  console.log(`SBTi merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];
  const companies = groupByCompany(rows);
  const keys = Object.keys(companies);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "sbti",
    source_url: "https://sciencebasedtargets.org/companies-taking-action",
    upstream_file: path.relative(ROOT, inFile),
    company_count: keys.length,
    companies,
  }, null, 2));

  console.log(`✅ Wrote ${outFile} — ${keys.length} unique companies`);
  // Quick coverage breakdown
  const stats = { approved: 0, committed: 0, removed: 0, unknown: 0 };
  for (const k of keys) stats[companies[k].status] = (stats[companies[k].status] || 0) + 1;
  console.log(`   ${JSON.stringify(stats)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("sbti-merge failed:", err);
    process.exit(1);
  });
}
