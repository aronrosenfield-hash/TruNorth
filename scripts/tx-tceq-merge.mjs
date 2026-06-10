#!/usr/bin/env node
/**
 * R5-3 — Merge TX TCEQ compliance-history cases into per-slug augment.
 *
 * Reads:    data/raw/tx-tceq/<YYYY-MM-DD>.json   (from tx-tceq-fetch.mjs)
 * Writes:   data/derived/tx-tceq-augment.json    (consumed by apply-augments)
 *
 * Routes each case's `company_brand` field through an audited seed map.
 * No free-text resolution — facility names are too noisy.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/tx-tceq");
const OUT_FILE = path.join(ROOT, "data/derived/tx-tceq-augment.json");

// Audited company_brand → TruNorth slug map.
const BRAND_SEED = {
  "ExxonMobil":              "exxonmobil",
  "Valero Energy":           "valero-energy",
  "Phillips 66":             "phillips-66",
  "Dow Chemical":            "dow-chemical",
  "Marathon Petroleum":      "marathon-petroleum",
  "ConocoPhillips":          "conocophillips",
  "Chevron Phillips Chemical": "chevron-phillips-chemical",
  "Halliburton":             "halliburton",
  "Baker Hughes":            "baker-hughes",
  "Union Pacific":           "union-pacific-railroad",
  "Walmart":                 "walmart",
  "PepsiCo":                 "pepsico",
  "Tesla":                   "tesla",
  "Eastman Chemical":        "eastman-chemical",
  "BASF":                    "basf-usa",
};

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
    const files = (await fs.readdir(RAW_DIR)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

export function classifySeverity(totalPenaltyUsd, caseCount, hasFatalities) {
  if (hasFatalities) return "very_poor";
  if (totalPenaltyUsd >= 5_000_000) return "very_poor";
  if (caseCount >= 3 || totalPenaltyUsd >= 500_000) return "poor";
  return "mixed";
}

const FATALITY_RE = /\bkill(?:ed)?\b|\bdied\b|\bdeath(?:s)?\b|\bfatal/i;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  console.log(`tx-tceq-merge: ${snap.case_count} cases from ${snap.snapshot_date}`);

  const bySlug = new Map();
  const orphans = [];
  for (const c of snap.cases || []) {
    if (!c.company_brand) { orphans.push(c); continue; }
    const slug = BRAND_SEED[c.company_brand];
    if (!slug) { orphans.push(c); continue; }
    const bucket = bySlug.get(slug) || { cases: [], routed_via: "brand-seed" };
    bucket.cases.push(c);
    bySlug.set(slug, bucket);
  }

  const companies = {};
  for (const [slug, { cases, routed_via }] of bySlug) {
    const sorted = [...cases].sort((a, b) => (b.agreed_penalty_usd || 0) - (a.agreed_penalty_usd || 0));
    const totalPenalty = cases.reduce((s, c) => s + (c.agreed_penalty_usd || 0), 0);
    const dates = cases.map(c => c.date).filter(Boolean).sort();
    const hasFatalities = cases.some(c =>
      (c.violation_types || []).some(v => /fatal/i.test(v)) || FATALITY_RE.test(c.summary || ""));
    const violationTypes = Array.from(new Set(cases.flatMap(c => c.violation_types || []))).sort();
    companies[slug] = {
      slug,
      case_count: cases.length,
      total_agreed_penalty_usd: totalPenalty,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
      routed_via,
      severity_tier: classifySeverity(totalPenalty, cases.length, hasFatalities),
      has_fatalities: hasFatalities,
      violation_types: violationTypes,
      top_cases: sorted.slice(0, 3).map(c => ({
        date: c.date,
        facility: c.facility,
        agreed_penalty_usd: c.agreed_penalty_usd,
        violation_types: c.violation_types,
        summary: c.summary,
        url: c.url,
      })),
      source: "tx-tceq",
      source_url: snap.source_url,
    };
  }

  const augment = {
    source: "tx-tceq",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    input: path.relative(ROOT, rawPath),
    matched_slug_count: Object.keys(companies).length,
    orphan_count: orphans.length,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath}  (${augment.matched_slug_count} slugs, ${augment.orphan_count} orphans)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("tx-tceq-merge failed:", err); process.exit(1); });
}
