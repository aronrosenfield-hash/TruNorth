#!/usr/bin/env node
/**
 * Smithsonian Bird Friendly Coffee — merge step (DW-59).
 *
 * Reads latest data/raw/bird-friendly-coffee/<date>.json and writes
 * data/derived/bird-friendly-coffee-augment.json keyed by TruNorth slug.
 *
 * Output shape (per spec):
 *   companies: {
 *     "<slug>": {
 *       animals: {
 *         birdFriendlyCertified: true,
 *         certYear: <number|null>,
 *         sourceUrl: "https://nationalzoo.si.edu/migratory-birds/bird-friendly-coffee"
 *       },
 *       _sources: ["bird-friendly-coffee"],
 *       _routedVia: "direct" | "alias" | "parent",
 *       _lastUpdated: <iso>
 *     }
 *   }
 *
 * Resolution: direct → alias → parent → orphan (same ladder as
 * better-cotton-merge.mjs).
 *
 * Locally:
 *   node scripts/bird-friendly-coffee-merge.mjs
 *   node scripts/bird-friendly-coffee-merge.mjs --in /tmp/raw.json --out /tmp/a.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/bird-friendly-coffee");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "bird-friendly-coffee-augment.json");

export const SOURCE_URL = "https://nationalzoo.si.edu/migratory-birds/bird-friendly-coffee";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

/* -------------------------------- helpers ------------------------------- */

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

/** Coffee-specific suffix stripper. "Stumptown Coffee Roasters" → "stumptown". */
export function stripCoffeeSuffix(name) {
  if (!name) return name;
  let prev = ""; let cur = String(name).trim();
  const re = /,?\s+(coffee\s+roasters?|coffee\s+co|coffee\s+company|coffee|roasters?|tea\s+company|tea|cafe|cafés?|& tea|and tea|inc|incorporated|llc|ltd|limited|corp|co|company)\.?\s*$/i;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(re, "").trim();
  }
  return cur;
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
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

export function resolveBrand(brand, { knownSlugs, aliases, parents }) {
  const variants = new Set();
  const raw = slugify(brand);
  if (raw) variants.add(raw);
  const stripped = slugify(stripCoffeeSuffix(brand));
  if (stripped) variants.add(stripped);

  for (const v of variants) if (knownSlugs.has(v)) return { slug: v, routedVia: "direct" };
  for (const v of variants) {
    const al = aliases[v];
    if (al && knownSlugs.has(al)) return { slug: al, routedVia: "alias" };
  }
  for (const v of variants) {
    const par = parents[v]?.parent;
    if (par && knownSlugs.has(par)) return { slug: par, routedVia: "parent" };
  }
  return { slug: null, routedVia: "orphan" };
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log("Bird Friendly Coffee merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run bird-friendly-coffee-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = { direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const r of raw.roasters || []) {
    const { slug, routedVia } = resolveBrand(r.brand, { knownSlugs, ...maps });
    routeCounts[routedVia]++;
    if (!slug) {
      orphans.push({ brand: r.brand, country: r.country || null, region: r.region || null });
      continue;
    }
    const incoming = {
      animals: {
        birdFriendlyCertified: true,
        certYear: r.certYear ?? null,
        sourceUrl: SOURCE_URL,
      },
      _sources: ["bird-friendly-coffee"],
      _routedVia: routedVia,
      _lastUpdated: now.toISOString(),
    };
    const cur = companies[slug];
    if (!cur) {
      companies[slug] = incoming;
    } else {
      const RANK = { direct: 0, alias: 1, parent: 2 };
      if (RANK[routedVia] < RANK[cur._routedVia]) {
        companies[slug] = incoming;
      } else if (cur.animals.certYear == null && incoming.animals.certYear != null) {
        cur.animals.certYear = incoming.animals.certYear;
      }
    }
  }

  const payload = {
    _license: raw._license || "Public certification list (Smithsonian Migratory Bird Center); cite source URL.",
    _source_file: path.relative(ROOT, rawFile),
    _source_url: SOURCE_URL,
    _generated_at: now.toISOString(),
    _stats: {
      raw_roasters: raw.roasters?.length || 0,
      matched_companies: Object.keys(companies).length,
      routed_direct: routeCounts.direct,
      routed_alias: routeCounts.alias,
      routed_parent: routeCounts.parent,
      orphans: routeCounts.orphan,
    },
    companies,
    orphans: orphans.slice(0, 200),
    orphan_total: orphans.length,
  };

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  console.log(`\nRaw roasters:       ${payload._stats.raw_roasters}`);
  console.log(`Matched companies:  ${payload._stats.matched_companies}`);
  console.log(`  direct:           ${routeCounts.direct}`);
  console.log(`  alias:            ${routeCounts.alias}`);
  console.log(`  parent:           ${routeCounts.parent}`);
  console.log(`Orphans:            ${routeCounts.orphan}`);
  console.log(`\nWrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("bird-friendly-coffee-merge failed:", err);
    process.exit(1);
  });
}
