#!/usr/bin/env node
/**
 * Forest 500 — Merge step.
 *
 * Reads the latest data/raw/forest500/<date>.json snapshot and writes
 * data/derived/forest500-augment.json with per-company augmentation:
 *
 *   {
 *     display_name, country, sector, entity_type,
 *     overall_score, score_year,
 *     commodity_scores: { soy, palm, beef, timber, pulp },
 *     commodities_exposed: ["soy", "palm", ...],
 *     forest500Tier: "leader" | "midpack" | "laggard",
 *     hasDeforestationExposure: true,
 *   }
 *
 * Tiers (out of 100): leader >= 70, laggard <= 25, else midpack. These
 * thresholds reflect Forest500's published methodology rubric.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/forest500");
const OUT_DEFAULT = path.join(ROOT, "data/derived/forest500-augment.json");

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

export function tierFor(score) {
  if (score == null) return null;
  if (score >= 70) return "leader";
  if (score <= 25) return "laggard";
  return "midpack";
}

export function buildAugment(row) {
  return {
    display_name: row.company,
    country: row.country,
    sector: row.sector,
    entity_type: row.entity_type,
    overall_score: row.overall_score_2024,
    score_year: 2024,
    commodity_scores: {
      soy: row.soy_score,
      palm: row.palm_score,
      beef: row.beef_score,
      timber: row.timber_score,
      pulp: row.pulp_score,
    },
    commodities_exposed: row.commodities || [],
    forest500Tier: tierFor(row.overall_score_2024),
    hasDeforestationExposure: true,
  };
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`Forest500 merge: ${inFile} → ${outFile}`);

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
    source: "forest500",
    source_url: "https://forest500.org",
    upstream_file: path.relative(ROOT, inFile),
    company_count: Object.keys(companies).length,
    companies,
  }, null, 2));

  const stats = { leader: 0, midpack: 0, laggard: 0, unknown: 0 };
  for (const k of Object.keys(companies)) {
    const t = companies[k].forest500Tier ?? "unknown";
    stats[t] = (stats[t] || 0) + 1;
  }
  console.log(`✅ Wrote ${outFile} — ${Object.keys(companies).length} companies (${JSON.stringify(stats)})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("forest500-merge failed:", err);
    process.exit(1);
  });
}
