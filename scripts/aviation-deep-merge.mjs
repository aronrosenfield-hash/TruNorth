#!/usr/bin/env node
/**
 * Aviation deep — merge raw airline snapshot into a per-slug augment
 * file that feeds the apply-augments-to-companies writer.
 *
 * Reads:   data/raw/aviation-deep/<latest>.json
 * Writes:  data/derived/aviation-deep-augment.json
 *
 * Output shape (keyed by slug):
 *   {
 *     source: "aviation-deep",
 *     companies: {
 *       "delta-air-lines": {
 *         aviation: {
 *           name, iata, atcrPeriod,
 *           complaintsPer100k, onTimePct, mishandledBagRate,
 *           cancellationPct, oversalesPer10k,
 *           dotEnforcementCount, dotPenaltyUsdTotal,
 *           dotLatestAction: { year, summary, penaltyUsd, sourceUrl },
 *           ntsbIncidents5yr, safetySummary,
 *           severity: "very_poor"|"poor"|"mixed"|"neutral"|"positive",
 *           sourceUrls: [...]
 *         }
 *       }
 *     }
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_URLS, severityFor } from "./aviation-deep-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/aviation-deep");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE = path.join(ROOT, "data/derived/aviation-deep-augment.json");

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

export function buildAviationBlock(a) {
  const actions = Array.isArray(a.dot_enforcement_actions) ? a.dot_enforcement_actions : [];
  const penaltyTotal = actions.reduce((s, x) => s + (x.penalty_usd || 0), 0);
  const latest = actions.length
    ? [...actions].sort((x, y) => (y.year || 0) - (x.year || 0))[0]
    : null;
  return {
    name: a.name,
    iata: a.iata,
    atcrPeriod: a.atcr_period,
    complaintsPer100k: a.complaints_per_100k_passengers,
    onTimePct: a.on_time_pct,
    mishandledBagRate: a.mishandled_bag_rate,
    cancellationPct: a.cancellation_pct,
    oversalesPer10k: a.oversales_per_10k,
    dotEnforcementCount: actions.length,
    dotPenaltyUsdTotal: penaltyTotal,
    dotLatestAction: latest ? {
      year: latest.year,
      summary: latest.summary,
      penaltyUsd: latest.penalty_usd || null,
      sourceUrl: latest.source_url,
    } : null,
    ntsbIncidents5yr: a.ntsb_incidents_5yr ?? null,
    safetySummary: a.safety_summary || null,
    severity: severityFor(a),
    sourceUrls: [SOURCE_URLS.atcr, SOURCE_URLS.bts, SOURCE_URLS.enforcement, SOURCE_URLS.ntsb],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.raw || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot under ${RAW_DIR}. Run scripts/aviation-deep-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const indexSlugs = await loadIndexSlugs();

  const companies = {};
  const orphans = [];
  for (const a of (snap.airlines || [])) {
    if (indexSlugs.size > 0 && !indexSlugs.has(a.slug)) {
      orphans.push(a.slug);
      continue;
    }
    companies[a.slug] = { aviation: buildAviationBlock(a) };
  }

  const augment = {
    source: "aviation-deep",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    airline_count: snap.airline_count,
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
  console.log(`  matched=${augment.matched_slug_count} / airlines=${augment.airline_count} (orphans=${orphans.length})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("aviation-deep-merge failed:", err); process.exit(1); });
}
