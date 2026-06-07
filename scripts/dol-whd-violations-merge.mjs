#!/usr/bin/env node
/**
 * DW-10 — DOL WHD violations merge.
 *
 * Reads latest /data/raw/dol-whd-violations/<date>.json, attributes each
 * case to a TruNorth slug via trade name → normalised alias index, and
 * writes:
 *
 *   data/derived/dol-whd-violations-augment.json
 *
 * Per-slug shape:
 *   {
 *     slug,
 *     case_count,
 *     total_back_wages_usd,
 *     total_employees_affected,
 *     total_civil_penalty_usd,
 *     sample_cases: [...top 5 by back_wages_usd],
 *     earliest, latest,
 *     source, source_url
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/dol-whd-violations");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/dol-whd-violations-augment.json");

function parseArgs(argv) {
  const out = { rawPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") out.rawPath = argv[++i];
    else if (argv[i] === "--out") out.outPath = argv[++i];
  }
  return out;
}

async function loadLatestRaw() {
  try {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadCompanySlugs() {
  if (!existsSync(COMP_DIR)) return [];
  return (await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
}

async function loadParentMap() {
  try { return JSON.parse(await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8")); }
  catch { return {}; }
}

export function buildAliasIndex(slugs, parentMap) {
  const idx = new Map();
  for (const slug of slugs) {
    const n = normalizeCompanyName(slug.replace(/-/g, " "));
    if (n) idx.set(n, slug);
    for (const a of parentMap[slug]?.aliases || []) {
      const nn = normalizeCompanyName(a);
      if (nn) idx.set(nn, slug);
    }
  }
  return idx;
}

/**
 * Trade names like "Walmart Supercenter #1234" or "Amazon Fulfillment BHM1"
 * are establishment names, not legal names. We match against the prefix
 * (substring containment of any alias) AND the legal_name field.
 */
export function matchCase(c, aliasIdx) {
  const candidates = [];
  if (c.trade_name) candidates.push(normalizeCompanyName(c.trade_name));
  if (c.legal_name) candidates.push(normalizeCompanyName(c.legal_name));
  for (const cand of candidates) {
    if (!cand) continue;
    if (aliasIdx.has(cand)) return aliasIdx.get(cand);
    for (const [alias, slug] of aliasIdx) {
      if (alias.length < 4) continue;
      if (cand.includes(alias)) return slug;
    }
  }
  return null;
}

export function aggregateForSlug(slug, cases, sourceUrl) {
  const sorted = [...cases].sort((a, b) => (b.back_wages_usd || 0) - (a.back_wages_usd || 0));
  const dates = cases.flatMap(c => [c.findings_start_date, c.findings_end_date]).filter(Boolean).sort();
  return {
    slug,
    case_count: cases.length,
    total_back_wages_usd: cases.reduce((s, c) => s + (c.back_wages_usd || 0), 0),
    total_employees_affected: cases.reduce((s, c) => s + (c.employees_affected || 0), 0),
    total_civil_penalty_usd: cases.reduce((s, c) => s + (c.civil_penalty_usd || 0), 0),
    sample_cases: sorted.slice(0, 5).map(c => ({
      case_id: c.case_id,
      trade_name: c.trade_name,
      back_wages_usd: c.back_wages_usd,
      employees_affected: c.employees_affected,
      civil_penalty_usd: c.civil_penalty_usd,
      findings_end_date: c.findings_end_date,
    })),
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    source: "dol-whd-violations",
    source_url: sourceUrl,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const slugs = await loadCompanySlugs();
  const idx = buildAliasIndex(slugs, await loadParentMap());

  const buckets = {};
  for (const c of snap.cases || []) {
    const slug = matchCase(c, idx);
    if (!slug) continue;
    (buckets[slug] ||= []).push(c);
  }

  const companies = {};
  for (const [slug, cases] of Object.entries(buckets)) {
    companies[slug] = aggregateForSlug(slug, cases, snap.source_url);
  }

  const augment = {
    source: "dol-whd-violations",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    matched_slug_count: Object.keys(companies).length,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath} (${augment.matched_slug_count} slugs / ${snap.case_count} cases)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("dol-whd-violations-merge failed:", err);
    process.exit(1);
  });
}
