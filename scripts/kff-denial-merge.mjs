#!/usr/bin/env node
/**
 * KFF/CMS denial-rate merger — produces a per-slug augment file that
 * feeds the apply-augments-to-companies writer.
 *
 * Reads:   data/raw/kff-denial/<latest>.json
 * Writes:  data/derived/kff-denial-augment.json
 *
 * Output shape (keyed by slug):
 *   {
 *     source: "kff-denial",
 *     companies: {
 *       "unitedhealth-group": {
 *         denial: {
 *           parent, planYear,
 *           inNetworkClaims, inNetworkDenials, inNetworkDenialRate,
 *           issuerCount, stateCount,
 *           severity, sourceUrls: [...]
 *         }
 *       }
 *     }
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_URLS, severityFor, PARENT_TO_SLUG } from "./kff-denial-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/kff-denial");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE = path.join(ROOT, "data/derived/kff-denial-augment.json");

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

export function buildDenialBlock(p) {
  return {
    parent: p.parent,
    planYear: p.plan_year,
    inNetworkClaims: p.in_network_claims,
    inNetworkDenials: p.in_network_denials,
    inNetworkDenialRate: p.in_network_denial_rate,
    issuerCount: p.issuer_count,
    stateCount: Array.isArray(p.states) ? p.states.length : null,
    severity: p.severity || severityFor(p),
    sourceUrls: [SOURCE_URLS.kffBrief, SOURCE_URLS.cmsPuf, SOURCE_URLS.cmsPufDataset],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.raw || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot under ${RAW_DIR}. Run scripts/kff-denial-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const indexSlugs = await loadIndexSlugs();

  const companies = {};
  const orphans = [];
  for (const p of (snap.parents || [])) {
    const slug = p.slug || PARENT_TO_SLUG[p.parent];
    if (!slug) {
      orphans.push(p.parent);
      continue;
    }
    if (indexSlugs.size > 0 && !indexSlugs.has(slug)) {
      orphans.push(`${p.parent} → ${slug} (not in index)`);
      continue;
    }
    companies[slug] = { denial: buildDenialBlock(p) };
  }

  const augment = {
    source: "kff-denial",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    plan_year: snap.plan_year,
    parent_count: snap.parent_count,
    matched_slug_count: Object.keys(companies).length,
    orphan_count: orphans.length,
    orphans: orphans.slice(0, 60),
    companies,
    license: snap.license,
  };

  const outPath = args.out || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  matched=${augment.matched_slug_count} / parents=${augment.parent_count} (orphans=${orphans.length})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("kff-denial-merge failed:", err); process.exit(1); });
}
