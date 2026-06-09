#!/usr/bin/env node
/**
 * Telecom deep merge.
 *
 * Reads:   data/raw/telecom-deep/<latest>.json
 * Writes:  data/derived/telecom-deep-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_URLS, severityFor } from "./telecom-deep-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/telecom-deep");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE = path.join(ROOT, "data/derived/telecom-deep-augment.json");

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

export function buildTelecomBlock(c) {
  const actions = Array.isArray(c.fcc_enforcement_actions) ? c.fcc_enforcement_actions : [];
  const totalPenalty = actions.reduce((s, a) => s + (a.penalty_usd || 0), 0);
  const privacyCount = actions.filter(a => a.category === "privacy").length;
  const latest = actions.length
    ? [...actions].sort((x, y) => (y.year || 0) - (x.year || 0))[0]
    : null;
  return {
    name: c.name,
    fccEnforcementCount: actions.length,
    fccPenaltyUsdTotal: totalPenalty,
    privacyActionCount: privacyCount,
    latestAction: latest ? {
      year: latest.year, summary: latest.summary, category: latest.category,
      penaltyUsd: latest.penalty_usd || null, sourceUrl: latest.source_url,
    } : null,
    fccComplaintsSignal: c.fcc_complaints_signal || "moderate",
    notes: c.notes || null,
    severity: severityFor(c),
    sourceUrls: [SOURCE_URLS.fccEnforcement, SOURCE_URLS.fccComplaints, SOURCE_URLS.ftc, SOURCE_URLS.doj],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.raw || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot under ${RAW_DIR}. Run scripts/telecom-deep-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const indexSlugs = await loadIndexSlugs();

  const companies = {};
  const orphans = [];
  for (const c of (snap.carriers || [])) {
    if (indexSlugs.size > 0 && !indexSlugs.has(c.slug)) {
      orphans.push(c.slug);
      continue;
    }
    companies[c.slug] = { telecom: buildTelecomBlock(c) };
  }

  const augment = {
    source: "telecom-deep",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    carrier_count: snap.carrier_count,
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
  console.log(`  matched=${augment.matched_slug_count} / carriers=${augment.carrier_count} (orphans=${orphans.length})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("telecom-deep-merge failed:", err); process.exit(1); });
}
