#!/usr/bin/env node
/**
 * WWF Palm Oil Buyer Scorecard — Merge step.
 *
 * Reads the latest data/raw/wwf-palm-oil/<date>.json snapshot and writes
 * data/derived/wwf-palm-oil-augment.json keyed by slug:
 *
 *   {
 *     environment: {
 *       palmOilScore: 18.5,                // 0-24, null for non-respondents
 *       palmOilTier: "Well on path",       // one of 5 enum values
 *       palmOilCategory: "well_on_path",   // machine slug for the tier
 *       palmOilResponseStatus: "Respondent" | "Non-respondent",
 *       palmOilOwnSupplyChain: 11.2,
 *       palmOilBeyondSupplyChain: 7.3,
 *       palmOilVolumeMT: 12345.6,          // metric tonnes, if reported
 *       palmOilSector: "Food",
 *       palmOilCountry: "United Kingdom",
 *       year: 2024,
 *       sourceUrl: "https://palmoilscorecard.panda.org",
 *       sourceName: "WWF Sustainable Palm Oil Buyer Scorecard",
 *     }
 *   }
 *
 * Slug routing applies the standard chain: direct → slug-aliases → brand-
 * parent-map → orphan. Orphans are logged but never error out — the score
 * sits in the derived JSON and gets picked up if/when the company file or
 * an alias is added in a later pass.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wwf-palm-oil");
const OUT_DEFAULT = path.join(ROOT, "data/derived/wwf-palm-oil-augment.json");
const SOURCE_URL = "https://palmoilscorecard.panda.org";
const SOURCE_NAME = "WWF Sustainable Palm Oil Buyer Scorecard";

// Optional routing maps (only consulted if present in the repo).
const ALIASES_PATH = path.join(ROOT, "public/data/_meta/slug-aliases.json");
const PARENTS_PATH = path.join(ROOT, "public/data/_meta/brand-parent-map.json");
const COMPANIES_DIR = path.join(ROOT, "public/data/companies");

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

async function safeReadJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return fallback; }
}

/** Lowercase machine-friendly tier label for the augment payload. */
export function tierCategory(tier) {
  if (!tier) return null;
  return tier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildAugment(row, year) {
  return {
    environment: {
      palmOilScore: row.total_score,
      palmOilTier: row.tier,
      palmOilCategory: tierCategory(row.tier),
      palmOilResponseStatus: row.response_status,
      palmOilOwnSupplyChain: row.own_supply_chain_score,
      palmOilBeyondSupplyChain: row.beyond_supply_chain_score,
      palmOilVolumeMT: row.total_palm_oil_volume,
      palmOilSector: row.sector,
      palmOilCountry: row.country,
      year,
      sourceUrl: SOURCE_URL,
      sourceName: SOURCE_NAME,
    },
  };
}

/**
 * Resolve a raw slug to a target slug using the standard chain:
 * direct → alias → parent → orphan.
 */
export function makeSlugResolver({ aliases, parents, companyExists }) {
  return function resolveSlug(rawSlug) {
    if (!rawSlug) return null;
    if (companyExists(rawSlug)) return rawSlug;
    if (aliases[rawSlug]) return aliases[rawSlug];
    if (parents[rawSlug]) return parents[rawSlug];
    return null;
  };
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`WWF Palm Oil merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];
  const year = src.year ?? 2024;

  const aliases = await safeReadJson(ALIASES_PATH, {});
  const parents = await safeReadJson(PARENTS_PATH, {});
  const resolve = makeSlugResolver({
    aliases,
    parents,
    companyExists: (slug) => existsSync(path.join(COMPANIES_DIR, `${slug}.json`)),
  });

  const companies = {};
  const orphans = [];
  for (const r of rows) {
    const rawSlug = toSlug(r.company);
    if (!rawSlug) continue;
    const target = resolve(rawSlug) ?? rawSlug;
    if (!resolve(rawSlug)) orphans.push({ company: r.company, slug: rawSlug });
    const augment = buildAugment(r, year);
    // Keep the higher score if multiple rows route to the same slug
    // (e.g. multiple subsidiary entries collapse into a parent).
    if (companies[target]) {
      const prev = companies[target].environment.palmOilScore;
      const cur = augment.environment.palmOilScore;
      if (cur != null && (prev == null || cur > prev)) {
        companies[target] = augment;
      }
    } else {
      companies[target] = augment;
    }
  }

  const stats = {
    "Leading the way": 0,
    "Well on path": 0,
    "Middle of the pack": 0,
    "Lagging behind": 0,
    "Non-respondent": 0,
    "Unknown": 0,
  };
  for (const k of Object.keys(companies)) {
    const t = companies[k].environment.palmOilTier ?? "Unknown";
    stats[t] = (stats[t] || 0) + 1;
  }

  // Top 5 / Bottom 5 (respondents only, by score descending).
  const respondents = Object.entries(companies)
    .filter(([, v]) => v.environment.palmOilScore != null)
    .map(([slug, v]) => ({ slug, score: v.environment.palmOilScore, name: v.environment.palmOilSector ? slug : slug }));
  respondents.sort((a, b) => b.score - a.score);
  const top5 = respondents.slice(0, 5);
  const bottom5 = respondents.slice(-5).reverse();

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "wwf-palm-oil-scorecard",
    source_url: SOURCE_URL,
    source_name: SOURCE_NAME,
    upstream_file: path.relative(ROOT, inFile),
    year,
    scoring_scale: "0-24",
    tiers: {
      "Leading the way": "19.5 - 24",
      "Well on path": "16.5 - 19.49",
      "Middle of the pack": "11 - 16.49",
      "Lagging behind": "0 - 10.99",
      "Non-respondent": "no response submitted",
    },
    company_count: Object.keys(companies).length,
    orphan_count: orphans.length,
    tier_distribution: stats,
    companies,
    orphans,
  }, null, 2));

  console.log(`✅ Wrote ${outFile} — ${Object.keys(companies).length} companies (${JSON.stringify(stats)})`);
  console.log(`   Orphans (no existing company file): ${orphans.length}`);
  console.log(`   Top 5:    ${top5.map(t => `${t.slug}=${t.score}`).join(", ")}`);
  console.log(`   Bottom 5: ${bottom5.map(t => `${t.slug}=${t.score}`).join(", ")}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("wwf-palm-oil-merge failed:", err);
    process.exit(1);
  });
}
