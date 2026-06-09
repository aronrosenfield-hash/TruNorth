#!/usr/bin/env node
/**
 * LA County restaurants merger.
 *
 * Reads:
 *   data/raw/la-county-restaurants/<YYYY-MM-DD>.json
 *   public/data/index.json
 *
 * Writes:
 *   data/derived/la-county-restaurants-augment.json
 *
 * Output:
 *   {
 *     _license, _source, _generated_at, _stats: { ... },
 *     companies: {
 *       "<slug>": {
 *         outlet_count, inspection_count,
 *         grade_a, grade_b, grade_c,
 *         b_or_worse_outlets, pct_b_or_worse_outlets,
 *         avg_score, latest_inspection,
 *         sample_violations: [...],
 *         source_url
 *       }
 *     }
 *   }
 *
 * Severity logic — mapped to TruNorth's `health` category:
 *   - pct B-or-worse outlets <  3% AND no C grades → "positive"
 *   - pct B-or-worse outlets <  8%                 → "mixed"   (typical chain)
 *   - pct B-or-worse outlets >= 8% OR any C grade  → "poor"
 *   - pct B-or-worse outlets >= 15% AND ≥3 C       → "very_poor"
 *
 *   These thresholds reflect that the City of LA grade-A rate is ~95%+ —
 *   chains with >5% B/C are notably below baseline.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/la-county-restaurants");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const ALIASES_FILE = path.join(ROOT, "public/data/_meta/slug-aliases.json");
const DEFAULT_OUT = path.join(DERIVED_DIR, "la-county-restaurants-augment.json");
const LICENSE = "City of Los Angeles open data (public domain)";

function parseArgs(argv) {
  const args = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

async function findLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

export function severityFor(chain) {
  const pct = Number(chain.pct_b_or_worse_outlets || 0);
  const c   = Number(chain.grade_c || 0);
  if (pct === 0 && c === 0) return { sc: "positive", severity: "positive" };
  if (pct >= 15 && c >= 3)  return { sc: "very_poor", severity: "negative" };
  if (pct >= 8  || c >= 1)  return { sc: "poor",     severity: "negative" };
  if (pct < 3)              return { sc: "positive", severity: "positive" };
  return { sc: "mixed", severity: "mixed" };
}

export function narrativeFor(chain) {
  const outlets = chain.outlet_count || 0;
  const insp    = chain.inspection_count || 0;
  const b       = chain.grade_b || 0;
  const c       = chain.grade_c || 0;
  const worse   = chain.b_or_worse_outlets || 0;
  const pct     = chain.pct_b_or_worse_outlets || 0;
  const avg     = chain.avg_score || 0;
  const latest  = (chain.latest_inspection || "").slice(0, 4); // year
  const range   = latest ? ` (data through ${latest})` : "";

  if (worse === 0 && c === 0) {
    return `LA City health inspections${range}: all ${outlets.toLocaleString()} LA outlet${outlets === 1 ? "" : "s"} graded A across ${insp.toLocaleString()} inspection${insp === 1 ? "" : "s"} (avg score ${avg}).`;
  }
  const parts = [];
  if (b) parts.push(`${b} B grade${b === 1 ? "" : "s"}`);
  if (c) parts.push(`${c} C grade${c === 1 ? "" : "s"}`);
  const gradeStr = parts.join(", ");
  return `LA City health inspections${range}: ${worse} of ${outlets} LA outlets (${pct}%) received a B or worse grade — ${gradeStr} across ${insp.toLocaleString()} inspections (avg score ${avg}).`;
}

export function buildAugment(raw, slugSet, aliases = {}) {
  const out = {};
  for (const c of (raw.chains || [])) {
    const slug = aliases[c.slug] || c.slug;
    if (!slugSet.has(slug)) continue;
    const sev = severityFor(c);
    out[slug] = {
      outlet_count: c.outlet_count,
      inspection_count: c.inspection_count,
      grade_a: c.grade_a,
      grade_b: c.grade_b,
      grade_c: c.grade_c,
      b_or_worse_outlets: c.b_or_worse_outlets,
      pct_b_or_worse_outlets: c.pct_b_or_worse_outlets,
      avg_score: c.avg_score,
      min_score: c.min_score,
      max_score: c.max_score,
      latest_inspection: c.latest_inspection,
      sample_violations: c.sample_violations || [],
      narrative: narrativeFor(c),
      sc: sev.sc,
      severity: sev.severity,
      source_url: c.source_url,
    };
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inFile = args.in || (await findLatestRaw());
  if (!inFile || !existsSync(inFile)) {
    console.error("No raw LA County restaurants file. Run la-county-restaurants-fetch.mjs first.");
    process.exit(2);
  }
  const raw = JSON.parse(await fs.readFile(inFile, "utf-8"));
  console.log(`LA County restaurants merge — input: ${path.relative(ROOT, inFile)}`);
  console.log(`  raw chains: ${(raw.chains || []).length}`);

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const slugSet = new Set(index.map(c => c.slug));
  let aliases = {};
  try { aliases = JSON.parse(await fs.readFile(ALIASES_FILE, "utf-8")); } catch {}

  const companies = buildAugment(raw, slugSet, aliases);
  const matched = Object.keys(companies).length;
  const bySc = {};
  for (const c of Object.values(companies)) bySc[c.sc] = (bySc[c.sc] || 0) + 1;

  const outFile = args.out || DEFAULT_OUT;
  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const bundle = {
    _license: LICENSE,
    _source: raw._source || "https://data.lacity.org/Community-Economic-Development/Restaurant-and-Market-Health-Inspections/29fd-3paw",
    _generated_at: new Date().toISOString(),
    _source_file: path.relative(ROOT, inFile),
    _stats: {
      raw_chains:       (raw.chains || []).length,
      matched_companies: matched,
      by_severity:       bySc,
    },
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nMatched companies: ${matched}`);
  console.log(`By severity:       ${JSON.stringify(bySc)}`);
  console.log(`Wrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("la-county-restaurants-merge failed:", e); process.exit(1); });
}
