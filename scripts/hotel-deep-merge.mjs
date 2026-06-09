#!/usr/bin/env node
/**
 * Hotel deep merge.
 *
 * Reads:   data/raw/hotel-deep/<latest>.json
 * Writes:  data/derived/hotel-deep-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_URLS, severityFor } from "./hotel-deep-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/hotel-deep");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE = path.join(ROOT, "data/derived/hotel-deep-augment.json");

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

export function buildHotelBlock(h) {
  const disputes = Array.isArray(h.unite_here_disputes) ? h.unite_here_disputes : [];
  const decrees = Array.isArray(h.ada_consent_decrees) ? h.ada_consent_decrees : [];
  return {
    name: h.name,
    uniteHereDisputes: disputes.map(d => ({
      year: d.year, summary: d.summary, sourceUrl: d.source_url,
    })),
    cdcOutbreaks5yr: h.cdc_outbreaks_5yr ?? 0,
    adaConsentDecrees: decrees.map(d => ({
      year: d.year, summary: d.summary, sourceUrl: d.source_url,
    })),
    greenCertifiedPropertyCount: h.green_certified_property_count ?? 0,
    otherCertifications: h.other_certifications || [],
    notes: h.notes || null,
    severity: severityFor(h),
    sourceUrls: [SOURCE_URLS.uniteHere, SOURCE_URLS.cdcNors, SOURCE_URLS.ada, SOURCE_URLS.greenKey],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.raw || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot under ${RAW_DIR}. Run scripts/hotel-deep-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const indexSlugs = await loadIndexSlugs();

  const companies = {};
  const orphans = [];
  for (const h of (snap.hotels || [])) {
    if (indexSlugs.size > 0 && !indexSlugs.has(h.slug)) {
      orphans.push(h.slug);
      continue;
    }
    companies[h.slug] = { hotel: buildHotelBlock(h) };
  }

  const augment = {
    source: "hotel-deep",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    hotel_count: snap.hotel_count,
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
  console.log(`  matched=${augment.matched_slug_count} / chains=${augment.hotel_count} (orphans=${orphans.length})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("hotel-deep-merge failed:", err); process.exit(1); });
}
