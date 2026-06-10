#!/usr/bin/env node
/**
 * R5-2 — Merge CPUC enforcement cases into per-slug augment.
 *
 * Reads:    data/raw/cpuc/<YYYY-MM-DD>.json   (from cpuc-fetch.mjs)
 * Writes:   data/derived/cpuc-augment.json    (consumed by apply-augments)
 *
 * Routes each case's `utility_brand` field through an audited seed map
 * (BRAND_SEED). No free-text resolution is used — CPUC respondent names
 * are corporate legal entities (e.g. "Pacific Bell Telephone Company")
 * that must be mapped to consumer brand slugs (e.g. "atandt") by hand.
 *
 * Augment companies[slug] carries:
 *   - action_count, total_citation_usd
 *   - by_category: { environment, health, political }
 *   - severity_tier: very_poor | poor | mixed
 *   - top_actions[]: top 3 by citation_usd
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cpuc");
const OUT_FILE = path.join(ROOT, "data/derived/cpuc-augment.json");

// Audited utility_brand → TruNorth slug map. Only these brands are scored.
const BRAND_SEED = {
  "PG&E":                     "pgande",
  "Southern California Edison": "southern-california-edison",
  "Edison International":     "edison-international",
  "Southern California Gas":  "southern-california-gas",
  "Sempra":                   "sempra",
  "AT&T":                     "atandt",
  "Verizon":                  "verizon",
  "Comcast":                  "comcast",
  "Spectrum":                 "charter-communications",
  "T-Mobile":                 "t-mobile-us",
  "Frontier Communications":  "frontier-communications",
  "Cox Communications":       "cox-communications",
  "PacifiCorp":               "pacificorp",
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

export function classifySeverity(totalCitationUsd, caseCount, hasFatalities) {
  if (hasFatalities) return "very_poor";
  if (totalCitationUsd >= 100_000_000) return "very_poor";
  if (caseCount >= 3 || totalCitationUsd >= 25_000_000) return "poor";
  return "mixed";
}

const FATALITY_RE = /\bkill(?:ed)?\b|\bdied\b|\bdeath(?:s)?\b|\bfatal/i;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  console.log(`cpuc-merge: ${snap.case_count} cases from ${snap.snapshot_date}`);

  const bySlug = new Map();
  const orphans = [];
  for (const c of snap.cases || []) {
    if (!c.utility_brand) { orphans.push(c); continue; }
    const slug = BRAND_SEED[c.utility_brand];
    if (!slug) { orphans.push(c); continue; }
    const bucket = bySlug.get(slug) || { cases: [], routed_via: "brand-seed" };
    bucket.cases.push(c);
    bySlug.set(slug, bucket);
  }

  const companies = {};
  for (const [slug, { cases, routed_via }] of bySlug) {
    const sorted = [...cases].sort((a, b) => (b.citation_usd || 0) - (a.citation_usd || 0));
    const totalCitation = cases.reduce((s, c) => s + (c.citation_usd || 0), 0);
    const byCategory = {};
    for (const c of cases) {
      const cat = c.category || "environment";
      if (!byCategory[cat]) byCategory[cat] = { case_count: 0, total_citation_usd: 0 };
      byCategory[cat].case_count += 1;
      byCategory[cat].total_citation_usd += (c.citation_usd || 0);
    }
    const dates = cases.map(c => c.date).filter(Boolean).sort();
    const hasFatalities = cases.some(c => FATALITY_RE.test(c.summary || ""));
    companies[slug] = {
      slug,
      action_count: cases.length,
      total_citation_usd: totalCitation,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
      routed_via,
      severity_tier: classifySeverity(totalCitation, cases.length, hasFatalities),
      has_fatalities: hasFatalities,
      by_category: byCategory,
      top_actions: sorted.slice(0, 3).map(c => ({
        date: c.date,
        category: c.category,
        citation_usd: c.citation_usd,
        decision: c.decision,
        summary: c.summary,
        url: c.url,
      })),
      source: "cpuc",
      source_url: snap.source_url,
    };
  }

  const augment = {
    source: "cpuc",
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
  main().catch(err => { console.error("cpuc-merge failed:", err); process.exit(1); });
}
