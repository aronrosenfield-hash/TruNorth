#!/usr/bin/env node
/**
 * A Greener World — Animal Welfare Approved (AWA) — merge step.
 *
 * Reads latest data/raw/awa/<date>.json and writes
 * data/derived/awa-augment.json keyed by TruNorth slug.
 *
 * Output shape (per spec):
 *   companies: {
 *     "<slug>": {
 *       animals: {
 *         awaCertified: true,
 *         productCategories: ["beef","eggs"],   // union across all entries
 *         sourceUrl: "https://agreenerworld.org/programs/certified-animal-welfare-approved/"
 *       },
 *       _sources: ["awa"],
 *       _routedVia: "direct" | "alias" | "parent",
 *       _farms: 3,  // # of underlying farms matched to this slug
 *       _lastUpdated: <iso>
 *     }
 *   }
 *
 * IMPORTANT: AWA certifies FARMS, not corporate brands. A single consumer
 * brand (e.g. Niman Ranch) is fed by dozens of small AWA farms. The merger
 * therefore:
 *   1. Tries to resolve each farm name directly to a known slug.
 *   2. If the farm is a sub-brand of a parent retail brand (brand-parent-
 *      map), routes via parent and accumulates product categories.
 *   3. Falls back to orphans for truly small farms with no consumer match.
 *
 * Resolution ladder: direct → alias → parent → orphan.
 *
 * Locally:
 *   node scripts/awa-merge.mjs
 *   node scripts/awa-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/awa");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "awa-augment.json");

export const SOURCE_URL = "https://agreenerworld.org/directory/";

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

/** Farm-name suffix stripper. "Pete & Gerry's Family Farm" → "pete-and-gerrys". */
export function stripFarmSuffix(name) {
  if (!name) return name;
  let prev = ""; let cur = String(name).trim();
  const re = /,?\s+(family\s+farm|family\s+farms|farms?|ranch|dairy|creamery|orchards?|estate|llc|inc|incorporated|co|company|ltd)\.?\s*$/i;
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
  if (!Array.isArray(idx)) return { knownSlugs: new Set(), slugCats: new Map() };
  return {
    knownSlugs: new Set(idx.map(r => r.slug)),
    slugCats: new Map(idx.map(r => [r.slug, r.cat || null])),
  };
}

/**
 * AWA certifies meat/dairy/egg producers. A farm name that fuzzy-matches a
 * non-food TruNorth company ("Staples Farm" → staples, the office retailer)
 * must NOT light up that brand. Only these index categories may receive the
 * awaCertified flag.
 */
export const FOOD_CATS = new Set([
  "Food & Beverage", "Grocery", "Consumer Goods", "Hospitality",
]);

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
  const stripped = slugify(stripFarmSuffix(brand));
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
  console.log("AWA merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run awa-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const { knownSlugs, slugCats } = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = { direct: 0, alias: 0, parent: 0, orphan: 0 };
  let categoryRejected = 0;

  for (const f of raw.farms || []) {
    let { slug, routedVia } = resolveBrand(f.brand, { knownSlugs, ...maps });
    if (slug) {
      const cat = slugCats.get(slug);
      if (cat && !FOOD_CATS.has(cat)) {
        // Non-food company — almost certainly a name collision, not an
        // AWA-certified producer. Demote to orphan.
        categoryRejected++;
        slug = null;
        routedVia = "orphan";
      }
    }
    routeCounts[routedVia]++;
    if (!slug) {
      orphans.push({
        brand: f.brand,
        state: f.state || null,
        country: f.country || null,
        productCategories: f.productCategories || [],
      });
      continue;
    }
    const cur = companies[slug];
    if (!cur) {
      companies[slug] = {
        animals: {
          awaCertified: true,
          productCategories: [...(f.productCategories || [])],
          sourceUrl: SOURCE_URL,
        },
        _sources: ["awa"],
        _routedVia: routedVia,
        _farms: 1,
        _lastUpdated: now.toISOString(),
      };
    } else {
      // Union of product categories.
      const set = new Set(cur.animals.productCategories);
      for (const c of (f.productCategories || [])) set.add(c);
      cur.animals.productCategories = [...set].sort();
      cur._farms += 1;
      const RANK = { direct: 0, alias: 1, parent: 2 };
      if (RANK[routedVia] < RANK[cur._routedVia]) cur._routedVia = routedVia;
    }
  }

  const matchedCount = Object.keys(companies).length;
  const payload = {
    _license: raw._license || "Public certification list (A Greener World / Animal Welfare Approved); cite source URL.",
    _source_file: path.relative(ROOT, rawFile),
    _source_url: SOURCE_URL,
    _generated_at: now.toISOString(),
    ...(matchedCount === 0 && (raw.farms?.length || 0) > 0 ? {
      _note: "0 matched companies is expected: the AGW directory lists small local " +
        "producers (farm stores/CSAs), which rarely overlap the TruNorth consumer-brand " +
        "catalog. Raw farm count is the pipeline health signal.",
    } : {}),
    _stats: {
      raw_farms: raw.farms?.length || 0,
      matched_companies: Object.keys(companies).length,
      routed_direct: routeCounts.direct,
      routed_alias: routeCounts.alias,
      routed_parent: routeCounts.parent,
      orphans: routeCounts.orphan,
      category_rejected: categoryRejected,
      // Propagate the raw snapshot's health so an empty augment is
      // self-explanatory (fetch failure vs genuinely zero records).
      raw_status: raw._status || null,
      ...(raw._empty_reason ? { raw_empty_reason: raw._empty_reason } : {}),
      ...(raw._note ? { raw_note: raw._note } : {}),
    },
    companies,
    orphans: orphans.slice(0, 500),
    orphan_total: orphans.length,
  };

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  console.log(`\nRaw farms:          ${payload._stats.raw_farms}`);
  console.log(`Matched companies:  ${payload._stats.matched_companies}`);
  console.log(`  direct:           ${routeCounts.direct}`);
  console.log(`  alias:            ${routeCounts.alias}`);
  console.log(`  parent:           ${routeCounts.parent}`);
  console.log(`Orphans:            ${routeCounts.orphan}`);
  console.log(`\nWrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("awa-merge failed:", err);
    process.exit(1);
  });
}
