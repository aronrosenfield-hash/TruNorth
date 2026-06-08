#!/usr/bin/env node
/**
 * Textile Exchange — Step 2: Slug-match the certified-brand bundle
 * against TruNorth's apparel-and-fashion parents and emit the augment
 * file used by the per-company environment score.
 *
 * Reads:
 *   data/raw/textile-exchange/<YYYY-MM-DD>.json   (latest, or --in)
 *   public/data/index.json                        (master 11k-company list)
 *   public/data/_meta/slug-aliases.json           (optional)
 *   public/data/_meta/brand-parent-map.json       (optional, subsidiary->parent)
 *
 * Writes:
 *   data/derived/textile-exchange-augment.json
 *
 * Output shape (one slug per matched apparel parent):
 *   {
 *     "_source":     "Textile Exchange — Standards (RCS/GRS/RWS/RDS/RMS)",
 *     "_source_url": "https://textileexchange.org/standards/",
 *     "_license":    "Public certification registry — Textile Exchange",
 *     "_generated_at": "...",
 *     "_stats": { ... },
 *     "companies": {
 *       "<slug>": {
 *         "environment": {
 *           "textileExchangeCerts": [{ "type": "GRS", "year": 2019 }, ...],
 *           "certCount": 4,
 *           "sourceUrl": "https://textileexchange.org/standards/"
 *         }
 *       }
 *     }
 *   }
 *
 * Locally:
 *   node scripts/textile-exchange-merge.mjs                   # use latest raw
 *   node scripts/textile-exchange-merge.mjs --in <file>       # specific input
 *   node scripts/textile-exchange-merge.mjs --out <file>      # custom output
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/textile-exchange");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR = path.join(ROOT, "public/data/_meta");
const DEFAULT_OUT = path.join(DERIVED_DIR, "textile-exchange-augment.json");

const SOURCE_URL = "https://textileexchange.org/standards/";
const LICENSE = "Public certification registry — Textile Exchange";
const APPAREL_CAT = "Apparel & Fashion";

/* ---------------------------------- CLI --------------------------------- */
export function parseArgs(argv) {
  const args = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

async function findLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

/* ------------------------- name normalization --------------------------- */
// Textile Exchange brand names: "Nike", "H&M", "Levi Strauss & Co.",
// "VF Corporation", etc. TruNorth slugs are lower-kebab-case with most
// punctuation stripped. Mirrors the same normalization the wikirate
// merger uses, kept inline so the two pipelines stay independent.
const CORPORATE_SUFFIX_TAIL = new RegExp(
  "[\\s,]+(?:" +
    "& Co|and Co|Co|" +
    "Inc|Incorporated|Corp|Corporation|Company|" +
    "LLC|LP|Ltd|Limited|" +
    "Holdings|Holding|Group|" +
    "AG|SA|S\\.A|S\\.A\\.S|SAS|NV|N\\.V|BV|B\\.V|" +
    "PLC|p\\.l\\.c|GmbH|SE|AB|OYJ|PJSC|PCL|KK|K\\.K|S\\.p\\.A|SpA" +
  ")\\.?$",
  "i"
);

export function normalizeCompanyName(name) {
  if (!name) return "";
  let s = String(name).trim();
  s = s.replace(/^the\s+/i, "").trim();
  let prev;
  do {
    prev = s;
    s = s.replace(CORPORATE_SUFFIX_TAIL, "")
         .replace(/[.,]+$/, "")
         .replace(/\.com$/i, "")
         .trim();
  } while (s !== prev && s.length);
  return s;
}

export function toSlug(name) {
  return normalizeCompanyName(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[–—]/g, "-")
    .replace(/[/\\.]/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------- matcher -------------------------------- */
// Builds a lookup keyed by many candidate slugs, restricted to apparel
// parents (cat === "Apparel & Fashion"). Indexing by display name, the
// suffix-stripped name, the apparent slug, and split halves of any
// "X / Y" combined name maximizes hit rate against the curated mirror
// without false-positives against unrelated categories.
export function buildIndex(indexJson, maps = { aliases: {}, parents: {} }) {
  const apparel = indexJson.filter(c => c.cat === APPAREL_CAT);
  const apparelSlugs = new Set(apparel.map(c => c.slug));
  const lookup = new Map();
  const add = (key, slug) => {
    if (!key || !slug) return;
    if (!lookup.has(key)) lookup.set(key, slug);
  };
  for (const c of apparel) {
    add(c.slug, c.slug);
    add(toSlug(c.name), c.slug);
    add(toSlug(normalizeCompanyName(c.name)), c.slug);
    // "Zara / Inditex" — index each half so either label matches.
    if (c.name && c.name.includes("/")) {
      for (const part of c.name.split("/")) {
        add(toSlug(part), c.slug);
      }
    }
  }
  // Aliases: {external_label: trunorth_slug}; only apply if the target
  // slug is apparel — keeps cross-cat aliases from leaking in.
  for (const [from, to] of Object.entries(maps.aliases || {})) {
    if (apparelSlugs.has(to)) {
      add(toSlug(from), to);
      add(from, to);
    }
  }
  // Subsidiary -> parent. Same apparel guard.
  for (const [child, info] of Object.entries(maps.parents || {})) {
    const parent = info?.parent;
    if (parent && apparelSlugs.has(parent)) {
      add(toSlug(child), parent);
      add(child, parent);
    }
  }
  return lookup;
}

export function matchBrand(name, lookup) {
  const candidates = [
    toSlug(name),
    toSlug(normalizeCompanyName(name)),
  ];
  if (/^the\s+/i.test(name)) {
    candidates.push(toSlug(name.replace(/^the\s+/i, "")));
  }
  candidates.push(toSlug(String(name).replace(/&/g, "and")));
  for (const c of candidates) {
    if (lookup.has(c)) return { slug: lookup.get(c), matched_on: c };
  }
  return null;
}

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

/* ------------------------------ core merge ------------------------------ */
// Collapses raw rows into one entry per matched apparel slug. Multiple
// rows on the same (brand, cert_type) are deduped to the earliest year
// — that matches Textile Exchange's own brand pages, which list the
// year of *initial* certification rather than the latest renewal.
export function buildAugment(rows, lookup) {
  const companies = {};
  const orphans = new Map();
  let matchedRows = 0;
  for (const row of rows) {
    const hit = matchBrand(row.brand, lookup);
    if (!hit) {
      orphans.set(row.brand, (orphans.get(row.brand) || 0) + 1);
      continue;
    }
    matchedRows++;
    const slug = hit.slug;
    if (!companies[slug]) {
      companies[slug] = {
        environment: {
          textileExchangeCerts: [],
          certCount: 0,
          sourceUrl: row.source_url || SOURCE_URL,
        },
      };
    }
    const env = companies[slug].environment;
    const existing = env.textileExchangeCerts.find(c => c.type === row.cert_type);
    if (existing) {
      // Keep the earliest year on (slug, type) collisions.
      if (row.since_year != null && (existing.year == null || row.since_year < existing.year)) {
        existing.year = row.since_year;
      }
    } else {
      env.textileExchangeCerts.push({ type: row.cert_type, year: row.since_year ?? null });
    }
  }
  // Final tally + stable sort by cert type for diff-friendly output.
  const ORDER = ["RCS", "GRS", "RWS", "RDS", "RMS"];
  for (const slug of Object.keys(companies)) {
    const env = companies[slug].environment;
    env.textileExchangeCerts.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    env.certCount = env.textileExchangeCerts.length;
  }
  const topOrphans = [...orphans.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([brand, count]) => ({ brand, count }));
  return {
    companies,
    stats: {
      matched_rows: matchedRows,
      orphan_rows: rows.length - matchedRows,
      unique_orphan_brands: orphans.size,
      matched_companies: Object.keys(companies).length,
    },
    top_orphans: topOrphans,
  };
}

/* -------------------------------- runner -------------------------------- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inFile = args.in || (await findLatestRaw());
  if (!inFile || !existsSync(inFile)) {
    console.error("No raw Textile Exchange file. Run textile-exchange-fetch.mjs first, or pass --in.");
    process.exit(2);
  }

  console.log("Textile Exchange merge starting...");
  console.log(`  Source: ${inFile}`);

  const raw = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = raw.rows || [];
  console.log(`  ${rows.length} raw cert rows loaded`);

  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const apparelCount = indexJson.filter(c => c.cat === APPAREL_CAT).length;
  console.log(`  ${apparelCount} apparel parents in index`);

  const maps = await loadMaps();
  const lookup = buildIndex(indexJson, maps);

  const { companies, stats, top_orphans } = buildAugment(rows, lookup);

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = args.out || DEFAULT_OUT;
  const bundle = {
    _source:       "Textile Exchange — Standards (RCS/GRS/RWS/RDS/RMS)",
    _source_url:   SOURCE_URL,
    _license:      LICENSE,
    _generated_at: new Date().toISOString(),
    _source_file:  path.relative(ROOT, inFile),
    _stats: {
      raw_row_count:        rows.length,
      matched_row_count:    stats.matched_rows,
      orphan_row_count:     stats.orphan_rows,
      unique_orphan_count:  stats.unique_orphan_brands,
      matched_companies:    stats.matched_companies,
      apparel_universe:     apparelCount,
    },
    top_orphans,
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));

  // Top-N by certCount for the operator summary.
  const topByCount = Object.entries(companies)
    .map(([slug, v]) => ({ slug, count: v.environment.certCount,
                           types: v.environment.textileExchangeCerts.map(c => c.type).join("/") }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
    .slice(0, 10);

  console.log(`\nResults:`);
  console.log(`  matched rows:        ${stats.matched_rows}`);
  console.log(`  orphan rows:         ${stats.orphan_rows}  (${stats.unique_orphan_brands} distinct brands)`);
  console.log(`  matched apparel cos: ${stats.matched_companies}`);
  console.log(`\nTop 10 by cert count:`);
  for (const r of topByCount) console.log(`  ${String(r.count).padStart(2)}  ${r.slug.padEnd(35)} [${r.types}]`);
  if (top_orphans.length) {
    console.log(`\nTop orphan brand labels (consider slug-aliases.json):`);
    for (const o of top_orphans) console.log(`  ${String(o.count).padStart(2)}  ${o.brand}`);
  }
  console.log(`\nWrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("textile-exchange-merge failed:", err);
    process.exit(1);
  });
}
