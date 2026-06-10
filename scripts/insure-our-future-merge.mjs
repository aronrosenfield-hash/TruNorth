#!/usr/bin/env node
/**
 * Insure Our Future — merge step.
 *
 * Reads latest data/raw/insure-our-future/<date>.json and writes
 * data/derived/insure-our-future-augment.json keyed by TruNorth slug.
 *
 * Maps to category: environment (insurer climate underwriting policy).
 *
 * Severity ladder (driven by tier + score):
 *   leading      (score ≥ 5.0)  → positive   (sc=good)
 *   progressing  (3.0 ≤ s < 5.0)→ mixed
 *   weak         (1.0 ≤ s < 3.0)→ concern    (sc=poor)
 *   very-weak    (s < 1.0)      → landmark   (sc=very_poor)
 *
 * Output shape consumable by apply-augments-to-companies.mjs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/insure-our-future");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "insure-our-future-augment.json");
const PARKED_FILE = path.join(DERIVED_DIR, "insure-our-future-parked.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

export function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); } catch { return null; }
}
async function loadMaps() {
  const [aliases, parents] = await Promise.all([
    tryReadJson(path.join(META_DIR, "slug-aliases.json")),
    tryReadJson(path.join(META_DIR, "brand-parent-map.json")),
  ]);
  return { aliases: aliases || {}, parents: parents || {} };
}
async function loadKnownSlugs() {
  const idx = await tryReadJson(INDEX_FILE);
  if (!Array.isArray(idx)) return new Set();
  return new Set(idx.map(r => r.slug));
}
async function latestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

export function resolveBrand(entry, { knownSlugs, aliases, parents }) {
  if (entry.slugHint && knownSlugs.has(entry.slugHint)) {
    return { slug: entry.slugHint, routedVia: "slugHint" };
  }
  const raw = slugify(entry.brand);
  if (raw && knownSlugs.has(raw)) return { slug: raw, routedVia: "direct" };
  if (raw && aliases[raw] && knownSlugs.has(aliases[raw])) {
    return { slug: aliases[raw], routedVia: "alias" };
  }
  if (raw && parents[raw]?.parent && knownSlugs.has(parents[raw].parent)) {
    return { slug: parents[raw].parent, routedVia: "parent" };
  }
  return { slug: null, routedVia: "orphan" };
}

/** tier + score → severity tag */
export function tierToSeverity(tier, score) {
  if (tier === "leading" || (typeof score === "number" && score >= 5.0)) return "positive";
  if (tier === "progressing" || (typeof score === "number" && score >= 3.0)) return "mixed";
  if (tier === "weak" || (typeof score === "number" && score >= 1.0)) return "concern";
  return "landmark";
}

async function main() {
  console.log("insure-our-future merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) { console.error(`No snapshot in ${RAW_DIR}.`); process.exit(2); }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const parked = [];
  const routeCounts = { slugHint: 0, direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const e of raw.entries || []) {
    const { slug, routedVia } = resolveBrand(e, { knownSlugs, ...maps });
    routeCounts[routedVia]++;
    if (!slug) {
      parked.push({
        brand: e.brand,
        tier: e.tier,
        score: e.score,
        note: "No matching TruNorth slug; insurer indexed by Insure Our Future but absent from index.",
      });
      continue;
    }

    // De-dup if a brand resolves to a slug we've already populated (e.g.
    // "The Hartford..." duplicate alias rows).
    if (companies[slug]) continue;

    const severity = tierToSeverity(e.tier, e.score);
    const head = `Insure Our Future 2024 scorecard: ${e.score.toFixed(1)}/10 (${e.tier}).`;
    const subs = [];
    if (e.coalUnderwriting) subs.push(`coal underwriting ${e.coalUnderwriting}`);
    if (e.oilgasUnderwriting) subs.push(`oil & gas underwriting ${e.oilgasUnderwriting}`);
    const subStr = subs.length ? ` Sub-scores: ${subs.join("; ")}.` : "";
    const tail = e.summary ? ` ${e.summary}` : "";
    const narrative = `${head}${subStr}${tail}`.trim();

    companies[slug] = {
      _sources: ["insure-our-future"],
      _routedVia: routedVia,
      _entries: 1,
      _lastUpdated: now.toISOString(),
      environment: {
        bestStatus: severity,
        narrative,
        year: e.year,
        score: e.score,
        tier: e.tier,
        sourceUrl: raw._source_urls?.scorecard || "https://global.insure-our-future.com/scorecard/",
      },
    };
  }

  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const payload = {
    _license: raw._license,
    _source_file: path.relative(ROOT, rawFile),
    _source_urls: raw._source_urls,
    _generated_at: now.toISOString(),
    _stats: {
      raw_entries: (raw.entries || []).length,
      matched_companies: Object.keys(companies).length,
      routed_slugHint: routeCounts.slugHint,
      routed_direct:   routeCounts.direct,
      routed_alias:    routeCounts.alias,
      routed_parent:   routeCounts.parent,
      parked:          parked.length,
    },
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`insure-our-future merge: wrote ${outFile}`);
  console.log(`  raw entries:        ${payload._stats.raw_entries}`);
  console.log(`  matched companies:  ${payload._stats.matched_companies}`);
  console.log(`  parked (no slug):   ${payload._stats.parked}`);
  if (parked.length) {
    await fs.writeFile(PARKED_FILE, JSON.stringify(parked, null, 2));
    console.log(`  parked logged:      ${PARKED_FILE}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("insure-our-future-merge failed:", err); process.exit(1); });
}
