#!/usr/bin/env node
/**
 * Eviction Lab — merge raw landlord snapshot into a per-slug augment
 * file that feeds the apply-augments-to-companies writer.
 *
 * Reads:   data/raw/eviction-lab/<latest>.json
 * Writes:  data/derived/eviction-lab-augment.json
 *
 * Output shape (keyed by slug):
 *   {
 *     source: "eviction-lab",
 *     companies: {
 *       "invitation-homes": {
 *         landlord: {
 *           name, landlordType, estUnits,
 *           actionCount, penaltyUsdTotal,
 *           latestAction: { year, type, regulator, summary, penaltyUsd, sourceUrl },
 *           evictionSignal,
 *           severity, notes,
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
import { SOURCE_URLS, severityFor } from "./eviction-lab-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/eviction-lab");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE = path.join(ROOT, "data/derived/eviction-lab-augment.json");

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

export function buildLandlordBlock(l) {
  const actions = Array.isArray(l.actions) ? l.actions : [];
  const penaltyTotal = actions.reduce((s, x) => s + (x.penalty_usd || 0), 0);
  const latest = actions.length
    ? [...actions].sort((x, y) => (y.year || 0) - (x.year || 0))[0]
    : null;
  return {
    name: l.name,
    landlordType: l.landlord_type,
    estUnits: l.est_units ?? null,
    actionCount: actions.length,
    penaltyUsdTotal: penaltyTotal,
    latestAction: latest ? {
      year: latest.year,
      type: latest.type,
      regulator: latest.regulator,
      summary: latest.summary,
      penaltyUsd: latest.penalty_usd || null,
      sourceUrl: latest.source_url,
    } : null,
    evictionSignal: l.eviction_signal || null,
    severity: severityFor(l),
    notes: l.notes || null,
    sourceUrls: [
      SOURCE_URLS.evictionLab,
      SOURCE_URLS.dojRealPage,
      SOURCE_URLS.houseOversight,
      SOURCE_URLS.atlantaFed,
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.raw || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot under ${RAW_DIR}. Run scripts/eviction-lab-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const indexSlugs = await loadIndexSlugs();

  const companies = {};
  const orphans = [];
  for (const l of (snap.landlords || [])) {
    if (indexSlugs.size > 0 && !indexSlugs.has(l.slug)) {
      orphans.push(l.slug);
      continue;
    }
    companies[l.slug] = { landlord: buildLandlordBlock(l) };
  }

  const augment = {
    source: "eviction-lab",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    landlord_count: snap.landlord_count,
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
  console.log(`  matched=${augment.matched_slug_count} / landlords=${augment.landlord_count} (orphans=${orphans.length})`);
  if (orphans.length) console.log(`  orphan slugs: ${orphans.join(", ")}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("eviction-lab-merge failed:", err); process.exit(1); });
}
