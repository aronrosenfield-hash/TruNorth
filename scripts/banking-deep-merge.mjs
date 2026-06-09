#!/usr/bin/env node
/**
 * Banking deep merge.
 *
 * Reads:   data/raw/banking-deep/<latest>.json
 * Writes:  data/derived/banking-deep-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_URLS, severityFor } from "./banking-deep-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/banking-deep");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE = path.join(ROOT, "data/derived/banking-deep-augment.json");

function parseArgs(argv) {
  const out = { raw: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") out.raw = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
  }
  return out;
}

async function loadLatestRaw() {
  try {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadIndexSlugs() {
  if (!existsSync(INDEX_FILE)) return new Set();
  const arr = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  return new Set(arr.map(c => c.slug));
}

export function buildBankingBlock(b) {
  const actions = Array.isArray(b.enforcement_actions) ? b.enforcement_actions : [];
  const totalPenalty = actions.reduce((s, a) => s + (a.penalty_usd || 0), 0);
  const latest = actions.length
    ? [...actions].sort((x, y) => (y.year || 0) - (x.year || 0))[0]
    : null;
  return {
    name: b.name,
    craGrade: b.cra_grade || null,
    craYear: b.cra_year || null,
    enforcementCount: actions.length,
    penaltyUsdTotal: totalPenalty,
    latestAction: latest ? {
      year: latest.year, regulator: latest.regulator, summary: latest.summary,
      penaltyUsd: latest.penalty_usd || null, sourceUrl: latest.source_url,
    } : null,
    notes: b.notes || null,
    severity: severityFor(b),
    sourceUrls: [SOURCE_URLS.occ, SOURCE_URLS.cra, SOURCE_URLS.fdic, SOURCE_URLS.fed],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.raw || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot under ${RAW_DIR}. Run scripts/banking-deep-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const indexSlugs = await loadIndexSlugs();

  const companies = {};
  const orphans = [];
  for (const b of (snap.banks || [])) {
    if (indexSlugs.size > 0 && !indexSlugs.has(b.slug)) {
      orphans.push(b.slug);
      continue;
    }
    companies[b.slug] = { banking: buildBankingBlock(b) };
  }

  const augment = {
    source: "banking-deep",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    bank_count: snap.bank_count,
    matched_slug_count: Object.keys(companies).length,
    orphan_count: orphans.length,
    orphans,
    companies,
    license: snap.license,
  };

  const outPath = args.out || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  matched=${augment.matched_slug_count} / banks=${augment.bank_count} (orphans=${orphans.length})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("banking-deep-merge failed:", err); process.exit(1); });
}
