#!/usr/bin/env node
/**
 * Better Cotton Initiative — merge step (DW-57).
 *
 * Reads the latest data/raw/better-cotton/<date>.json snapshot and writes
 * data/derived/better-cotton-augment.json keyed by TruNorth company slug.
 *
 * RESOLUTION LADDER
 *   1. direct — slugified brand matches public/data/index.json slug
 *   2. alias  — public/data/_meta/slug-aliases.json
 *   3. parent — public/data/_meta/brand-parent-map.json (sub-brand → parent)
 *   4. orphan — recorded for later mapping; not emitted into companies{}
 *
 * Output shape (per spec):
 *   companies: {
 *     "<slug>": {
 *       environment: {
 *         betterCottonMember: true,
 *         memberSince: <number|null>,
 *         sourceUrl: "https://bettercotton.org/who-we-are/members/"
 *       },
 *       _sources: ["better-cotton"],
 *       _routedVia: "direct" | "alias" | "parent",
 *       _lastUpdated: <iso>
 *     }
 *   }
 *
 * NEVER mutates per-company JSON. The augment file is a derived sidecar
 * (same pattern as au-fair-work-augment.json / animal-welfare-union-
 * augment.json). Downstream scoring reads this file separately.
 *
 * Locally:
 *   node scripts/better-cotton-merge.mjs
 *   node scripts/better-cotton-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/better-cotton");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "better-cotton-augment.json");

export const SOURCE_URL = "https://bettercotton.org/who-we-are/members/";

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

/** Strip apparel/retail corporate suffixes so "Nike, Inc." → "nike".
 *  Applied iteratively to handle stacked suffixes like "Burberry Group plc". */
export function stripCorporateSuffix(name) {
  if (!name) return name;
  let prev = "";
  let cur = String(name).trim();
  const re = /,?\s+(inc|incorporated|llc|ltd|limited|plc|corp|corporation|co|company|sa|s\.a\.|nv|n\.v\.|ag|ab|group|holdings?|brands?|international|intl|sas|sasu|gmbh|kg|kgaa|spa|s\.p\.a\.|pty\s+ltd|pty)\.?\s*$/i;
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
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

/* Resolve a brand to a known slug. Tries: direct, suffix-stripped direct,
 * alias, parent. Returns { slug, routedVia } where slug is null for orphans. */
export function resolveBrand(brand, { knownSlugs, aliases, parents }) {
  const variants = new Set();
  const raw = slugify(brand);
  if (raw) variants.add(raw);
  const stripped = slugify(stripCorporateSuffix(brand));
  if (stripped) variants.add(stripped);

  for (const v of variants) {
    if (knownSlugs.has(v)) return { slug: v, routedVia: "direct" };
  }
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
  console.log("Better Cotton merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run better-cotton-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) {
    console.error(`Could not parse ${rawFile}`);
    process.exit(2);
  }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = { direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const m of raw.members || []) {
    const { slug, routedVia } = resolveBrand(m.brand, { knownSlugs, ...maps });
    routeCounts[routedVia]++;
    if (!slug) {
      orphans.push({ brand: m.brand, country: m.country || null });
      continue;
    }
    // First-write-wins-for-direct: if a direct hit already exists, never
    // downgrade it to a parent route. Prefer the entry with a memberSince.
    const cur = companies[slug];
    const incoming = {
      environment: {
        betterCottonMember: true,
        memberSince: m.memberSince ?? null,
        sourceUrl: SOURCE_URL,
      },
      _sources: ["better-cotton"],
      _routedVia: routedVia,
      _lastUpdated: now.toISOString(),
    };
    if (!cur) {
      companies[slug] = incoming;
    } else {
      const RANK = { direct: 0, alias: 1, parent: 2 };
      if (RANK[routedVia] < RANK[cur._routedVia]) {
        companies[slug] = incoming;
      } else if (cur.environment.memberSince == null && incoming.environment.memberSince != null) {
        cur.environment.memberSince = incoming.environment.memberSince;
      }
    }
  }

  const payload = {
    _license: raw._license || "Public membership directory (bettercotton.org); cite source URL.",
    _source_file: path.relative(ROOT, rawFile),
    _source_url: SOURCE_URL,
    _generated_at: now.toISOString(),
    _stats: {
      raw_members: raw.members?.length || 0,
      matched_companies: Object.keys(companies).length,
      routed_direct: routeCounts.direct,
      routed_alias: routeCounts.alias,
      routed_parent: routeCounts.parent,
      orphans: routeCounts.orphan,
    },
    companies,
    orphans: orphans.slice(0, 500),
    orphan_total: orphans.length,
  };

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  console.log(`\nRaw members:        ${payload._stats.raw_members}`);
  console.log(`Matched companies:  ${payload._stats.matched_companies}`);
  console.log(`  direct:           ${routeCounts.direct}`);
  console.log(`  alias:            ${routeCounts.alias}`);
  console.log(`  parent:           ${routeCounts.parent}`);
  console.log(`Orphans:            ${routeCounts.orphan}`);
  console.log(`\nWrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("better-cotton-merge failed:", err);
    process.exit(1);
  });
}
