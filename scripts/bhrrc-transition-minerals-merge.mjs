#!/usr/bin/env node
/**
 * BHRRC Transition Minerals Tracker — merge step.
 *
 * Reads latest data/raw/bhrrc-transition-minerals/<date>.json and writes
 * data/derived/bhrrc-transition-minerals-augment.json keyed by TruNorth
 * slug. Same routing ladder as forest500-merge / farm-welfare-merge:
 *   slugHint → direct → alias → parent → orphan.
 *
 * Output shape (consumable by apply-augments-to-companies.mjs):
 *   companies: {
 *     "<slug>": {
 *       display_name,
 *       minerals: [...],
 *       allegation_count,
 *       countries: [...],
 *       allegation_types: [...],
 *       period,
 *       severity: "low" | "mixed" | "poor" | "very_poor",
 *       _routedVia,
 *     }
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/bhrrc-transition-minerals");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "bhrrc-transition-minerals-augment.json");

const args = process.argv.slice(2);
const IN_OVERRIDE  = (() => { const i = args.indexOf("--in");  return i >= 0 && args[i + 1] ? args[i + 1] : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

/* --------------------------------- helpers ------------------------------ */

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadKnownSlugs() {
  const idx = await tryReadJson(INDEX_FILE);
  if (!Array.isArray(idx)) return new Set();
  return new Set(idx.map(r => r.slug));
}

async function loadMaps() {
  const [aliases, parents] = await Promise.all([
    tryReadJson(path.join(META_DIR, "slug-aliases.json")),
    tryReadJson(path.join(META_DIR, "brand-parent-map.json")),
  ]);
  return { aliases: aliases || {}, parents: parents || {} };
}

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) throw new Error(`Missing ${RAW_DIR}`);
  const files = (await fs.readdir(RAW_DIR)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function severityFor(count) {
  if (!count) return null;
  if (count >= 15) return "very_poor";
  if (count >= 5)  return "poor";
  if (count >= 2)  return "mixed";
  return "low";
}

export function resolveBrand(entry, { knownSlugs, aliases, parents }) {
  if (entry.slugHint && knownSlugs.has(entry.slugHint)) {
    return { slug: entry.slugHint, routedVia: "slugHint" };
  }
  const raw = toSlug(entry.company);
  if (!raw) return { slug: null, routedVia: "orphan" };
  if (knownSlugs.has(raw)) return { slug: raw, routedVia: "direct" };
  if (aliases[raw] && knownSlugs.has(aliases[raw])) {
    return { slug: aliases[raw], routedVia: "alias" };
  }
  if (parents[raw]?.parent && knownSlugs.has(parents[raw].parent)) {
    return { slug: parents[raw].parent, routedVia: "parent" };
  }
  return { slug: null, routedVia: "orphan" };
}

export function buildAugment(entry) {
  return {
    display_name: entry.company,
    minerals: entry.minerals || [],
    allegation_count: entry.allegation_count || 0,
    countries: entry.countries || [],
    allegation_types: entry.allegation_types || [],
    period: entry.period || null,
    sourceUrl: entry.sourceUrl || "https://www.business-humanrights.org/en/from-us/transition-minerals-tracker/",
    severity: severityFor(entry.allegation_count),
  };
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_FILE;
  console.log(`BHRRC merge: ${inFile} → ${outFile}`);

  const src = await tryReadJson(inFile);
  if (!src) { console.error(`Could not parse ${inFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = { slugHint: 0, direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const e of src.entries || []) {
    const { slug, routedVia } = resolveBrand(e, { knownSlugs, ...maps });
    routeCounts[routedVia] = (routeCounts[routedVia] || 0) + 1;
    if (!slug) {
      orphans.push({ company: e.company, minerals: e.minerals, allegation_count: e.allegation_count });
      continue;
    }
    const aug = buildAugment(e);
    aug._routedVia = routedVia;
    // If a slug shows up twice (e.g. Eramet appears as parent + manganese
    // SLN sub-entry), combine into a single entry — sum allegations,
    // dedup countries + types + minerals.
    if (companies[slug]) {
      const cur = companies[slug];
      cur.allegation_count = (cur.allegation_count || 0) + aug.allegation_count;
      const dedup = (arr) => Array.from(new Set([...(arr || [])]));
      cur.minerals          = dedup([...(cur.minerals || []), ...(aug.minerals || [])]);
      cur.countries         = dedup([...(cur.countries || []), ...(aug.countries || [])]);
      cur.allegation_types  = dedup([...(cur.allegation_types || []), ...(aug.allegation_types || [])]);
      cur.severity = severityFor(cur.allegation_count);
    } else {
      companies[slug] = aug;
    }
  }

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    _license: src._license,
    _source_urls: src._source_urls,
    _generated_at: new Date().toISOString(),
    _source_file: path.relative(ROOT, inFile),
    _stats: {
      raw_entries: src.entries?.length || 0,
      matched_companies: Object.keys(companies).length,
      routing: routeCounts,
      orphan_total: orphans.length,
    },
    companies,
    orphans: orphans.slice(0, 200),
  }, null, 2));

  // Severity histogram for visibility in logs.
  const sevHist = { very_poor: 0, poor: 0, mixed: 0, low: 0 };
  for (const v of Object.values(companies)) sevHist[v.severity] = (sevHist[v.severity] || 0) + 1;

  console.log(`\nRaw entries:        ${src.entries?.length || 0}`);
  console.log(`Matched companies:  ${Object.keys(companies).length}`);
  console.log(`  slugHint:         ${routeCounts.slugHint}`);
  console.log(`  direct:           ${routeCounts.direct}`);
  console.log(`  alias:            ${routeCounts.alias}`);
  console.log(`  parent:           ${routeCounts.parent}`);
  console.log(`Orphans:            ${routeCounts.orphan}`);
  console.log(`Severity:           ${JSON.stringify(sevHist)}`);
  console.log(`\n✅ Wrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("bhrrc-transition-minerals-merge failed:", err);
    process.exit(1);
  });
}
