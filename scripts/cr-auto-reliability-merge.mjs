#!/usr/bin/env node
/**
 * Consumer Reports Auto Brand Report Card — merge step.
 *
 * Reads latest data/raw/cr-auto-reliability/<date>.json and writes
 * data/derived/cr-auto-reliability-augment.json keyed by TruNorth slug.
 *
 * Per-slug payload (lives under "health" category for consumer-safety
 * + reliability is the closest semantic fit; vehicle reliability has
 * downstream health/safety implications and TruNorth has no dedicated
 * "quality" category):
 *
 *   {
 *     health: {
 *       crBrandRank: 5,           // overall report-card rank
 *       crReliabilityRank: 1,     // separate reliability-only rank, if top-10
 *       crTier: "top10"|"bottom5"|"midpack",
 *       seedYear: 2026,
 *       sourceUrl: "...press release URL...",
 *     },
 *     _sources: ["cr-auto-reliability"],
 *     _routedVia: "direct" | "alias" | "parent",
 *     _lastUpdated: <iso>,
 *   }
 *
 * Tier rules:
 *   - rank ≤ 10                                     → "top10"
 *   - rank > 20 (CR press release names worst 5)    → "bottom5"
 *   - else                                          → "midpack"
 *
 * Locally:
 *   node scripts/cr-auto-reliability-merge.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/cr-auto-reliability");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "cr-auto-reliability-augment.json");

export const SOURCE_URL =
  "https://www.consumerreports.org/cars/car-reliability-owner-satisfaction/";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

export function tierFor(rank) {
  if (!rank || rank < 1) return "midpack";
  if (rank <= 10) return "top10";
  if (rank >= 22) return "bottom5";
  return "midpack";
}

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

export function resolveSlug(slugKey, { knownSlugs, aliases, parents }) {
  if (!slugKey) return null;
  if (knownSlugs.has(slugKey)) return { slug: slugKey, routedVia: "direct" };
  if (aliases[slugKey] && knownSlugs.has(aliases[slugKey])) {
    return { slug: aliases[slugKey], routedVia: "alias" };
  }
  if (parents[slugKey] && knownSlugs.has(parents[slugKey])) {
    return { slug: parents[slugKey], routedVia: "parent" };
  }
  return null;
}

async function main() {
  const raw = await latestRawFile();
  if (!raw) { console.error("[cr-merge] no raw file"); process.exit(1); }
  const data = JSON.parse(await fs.readFile(raw, "utf-8"));
  const { aliases, parents } = await loadMaps();
  const knownSlugs = await loadKnownSlugs();
  const now = new Date().toISOString();

  const companies = {};
  const orphans = [];

  // Overall ranking pass.
  for (const b of data.overall || []) {
    const r = resolveSlug(b.slugKey, { knownSlugs, aliases, parents });
    if (!r) { orphans.push({ slugKey: b.slugKey, brand: b.brand, kind: "overall" }); continue; }
    companies[r.slug] = companies[r.slug] || {
      health: {},
      _sources: ["cr-auto-reliability"],
      _routedVia: r.routedVia,
      _lastUpdated: now,
    };
    companies[r.slug].health.crBrandRank = b.rank;
    companies[r.slug].health.crTier = tierFor(b.rank);
    companies[r.slug].health.brand = b.brand;
    companies[r.slug].health.seedYear = data._seed_year;
    companies[r.slug].health.sourceUrl = data._source_url;
  }

  // Reliability-only top-10 overlay.
  for (const b of data.reliability || []) {
    const r = resolveSlug(b.slugKey, { knownSlugs, aliases, parents });
    if (!r) { orphans.push({ slugKey: b.slugKey, brand: b.brand, kind: "reliability" }); continue; }
    companies[r.slug] = companies[r.slug] || {
      health: {},
      _sources: ["cr-auto-reliability"],
      _routedVia: r.routedVia,
      _lastUpdated: now,
    };
    companies[r.slug].health.crReliabilityRank = b.rank;
    companies[r.slug].health.brand = companies[r.slug].health.brand || b.brand;
    companies[r.slug].health.seedYear = companies[r.slug].health.seedYear || data._seed_year;
    companies[r.slug].health.sourceUrl = companies[r.slug].health.sourceUrl || data._source_url;
  }

  const out = {
    _license: "Consumer Reports — press release citation",
    _source: "cr-auto-reliability",
    _source_url: SOURCE_URL,
    _seed_year: data._seed_year,
    _generated_at: now,
    _matched_slugs: Object.keys(companies).length,
    _orphans: orphans,
    companies,
  };
  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`[cr-merge] wrote ${outPath} — ${Object.keys(companies).length} slugs, ${orphans.length} orphans`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
