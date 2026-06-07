#!/usr/bin/env node
/**
 * Sustainability-certs merger — B-data7.
 *
 * Reads two raw snapshots:
 *   public/data/_raw/fair-trade.json         (positive supply-chain signal)
 *   public/data/_raw/rainforest-alliance.json (positive supply-chain signal)
 *
 * Per TruNorth brand, resolves matches via the same routing the cruelty-free
 * merger uses (see scripts/cruelty-free-merge.mjs):
 *   0. Hand-curated SUSTAINABILITY_OVERRIDES (rare mismatches)
 *   1. Direct slug match (slug-from-brand-name == co.slug)
 *   2. slug-aliases.json
 *   3. brand-parent-map.json (route a certified sub-brand to its parent)
 *
 * Writes co.enriched.supply_chain_certs = {
 *   fair_trade: {
 *     certified: bool,
 *     products:  ["coffee","chocolate"],
 *     certification_date?: "YYYY-MM-DD",
 *     last_verified: "YYYY-MM-DD",
 *     routed_via: "direct"|"alias"|"parent"|"override"
 *   } | null,
 *   rainforest_alliance: { ...same shape... } | null,
 *   sources: ["fair-trade","rainforest-alliance"],
 *   last_verified: "YYYY-MM-DD"
 * }
 *
 * Both are POSITIVE signals (no conflict logic needed — a brand can be
 * certified by both, by either, or by neither).
 *
 * Orphans (rows in either feed that don't resolve to a TruNorth company)
 * are written to public/data/_meta/sustainability-certs-unmatched.json
 * for human review.
 *
 * DRY-RUN
 *   --dry (default) prints the per-slug plan to stdout WITHOUT touching
 *   company files. Pass --apply to write changes.
 *
 * Locally:
 *   node scripts/sustainability-certs-merge.mjs                    # dry plan
 *   node scripts/sustainability-certs-merge.mjs --apply             # write
 *   node scripts/sustainability-certs-merge.mjs --slugs s1,s2,s3   # filter
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const FT_FILE  = path.join(RAW_DIR, "fair-trade.json");
const RA_FILE  = path.join(RAW_DIR, "rainforest-alliance.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const UNMATCHED_FILE = path.join(META_DIR, "sustainability-certs-unmatched.json");
const LOG_FILE       = path.join(META_DIR, "sustainability-certs-merge-log.json");

const APPLY_MODE = process.argv.includes("--apply");
const slugsArg = process.argv.find(a => a.startsWith("--slugs="));
const SLUG_FILTER = slugsArg
  ? new Set(slugsArg.slice("--slugs=".length).split(",").map(s => s.trim()).filter(Boolean))
  : null;

// Hand-curated brand-slug overrides. Keys are slugified brand name from the
// source feed; values are the target TruNorth company slug. Most B-data7
// targets resolve via the alias/parent maps — overrides are for the truly
// exceptional cases where the brand name simply doesn't slugify cleanly.
const SUSTAINABILITY_OVERRIDES = {
  // Fair Trade USA spellings → TruNorth slugs
  "ben-and-jerrys":   "ben-and-jerry-s",
  "ben-jerrys":       "ben-and-jerry-s",
  "peets-coffee":     "peet-s-coffee",
  "trader-joes":      "trader-joe-s",
  "trader-joe-s":     "trader-joe-s",
  "whole-foods-market": "whole-foods-market",

  // Rainforest Alliance spellings → TruNorth slugs.
  // Nestlé slugifies to "nestl" in the universe (NFKD strips the accent).
  "nestle":           "nestl",
  "nestl":            "nestl",
  "mars":             "mars",
  "mondelez":         "mondelez-international",
  "mondelez-international": "mondelez-international",
  "dole":             "dole-food",
  "dole-food":        "dole-food",
  "dole-food-company": "dole-food",
};

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Strip apostrophes entirely so "Peet's" → "peets" (then route via
    // overrides/aliases to the actual TruNorth slug "peet-s-coffee").
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  const aliases = await tryReadJson(path.join(META_DIR, "slug-aliases.json")) || {};
  const parents = await tryReadJson(path.join(META_DIR, "brand-parent-map.json")) || {};
  return { aliases, parents };
}

export function resolveSlug(brandName, maps) {
  const brandSlug = slugify(brandName);
  if (SUSTAINABILITY_OVERRIDES[brandSlug]) {
    const tgt = SUSTAINABILITY_OVERRIDES[brandSlug];
    if (existsSync(path.join(COMP_DIR, `${tgt}.json`))) {
      return { slug: tgt, routed_via: "override" };
    }
  }
  if (brandSlug && existsSync(path.join(COMP_DIR, `${brandSlug}.json`))) {
    return { slug: brandSlug, routed_via: "direct" };
  }
  const alias = maps.aliases[brandSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[brandSlug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

function addCert(map, slug, key, payload) {
  if (!map.has(slug)) map.set(slug, {});
  const entry = map.get(slug);
  if (!entry[key]) entry[key] = payload;
  else {
    // Merge product lists if a brand has multiple feed rows.
    const prev = entry[key];
    for (const p of payload.products || []) {
      if (!prev.products.includes(p)) prev.products.push(p);
    }
    if (!prev.certification_date && payload.certification_date) {
      prev.certification_date = payload.certification_date;
    }
  }
}

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  console.log(`Sustainability-certs merge starting (mode=${APPLY_MODE ? "apply" : "dry"}${SLUG_FILTER ? `, slug-filter=${SLUG_FILTER.size}` : ""})...`);

  const ft = await tryReadJson(FT_FILE);
  const ra = await tryReadJson(RA_FILE);

  if (!ft && !ra) {
    console.error("No raw files found at:");
    console.error(`  ${FT_FILE}`);
    console.error(`  ${RA_FILE}`);
    console.error("Run the fetchers first (with --fixture or --live).");
    process.exit(1);
  }

  const maps = await loadMaps();
  const slugToCerts = new Map();
  const unmatched = { fair_trade: [], rainforest_alliance: [] };

  // --- Fair Trade USA ---
  if (ft?.certified_brands) {
    for (const b of ft.certified_brands) {
      const { slug, routed_via } = resolveSlug(b.brand, maps);
      if (!slug) {
        unmatched.fair_trade.push({ brand: b.brand, products: b.products || [] });
        continue;
      }
      addCert(slugToCerts, slug, "fair_trade", {
        certified: true,
        products: [...(b.products || [])],
        certification_date: b.certification_date || null,
        last_verified: today,
        routed_via,
      });
    }
  }

  // --- Rainforest Alliance ---
  if (ra?.certified_brands) {
    for (const b of ra.certified_brands) {
      const { slug, routed_via } = resolveSlug(b.brand, maps);
      if (!slug) {
        unmatched.rainforest_alliance.push({ brand: b.brand, products: b.products || [] });
        continue;
      }
      addCert(slugToCerts, slug, "rainforest_alliance", {
        certified: true,
        products: [...(b.products || [])],
        certification_date: b.certification_date || null,
        last_verified: today,
        routed_via,
      });
    }
  }

  // --- Write per-company JSON ---
  const planned = [];
  for (const [slug, certs] of slugToCerts.entries()) {
    if (SLUG_FILTER && !SLUG_FILTER.has(slug)) continue;

    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) {
      // Shouldn't happen — resolveSlug only returns slugs whose file exists.
      continue;
    }

    const sources = [];
    if (certs.fair_trade)          sources.push("fair-trade");
    if (certs.rainforest_alliance) sources.push("rainforest-alliance");

    const payload = {
      fair_trade:           certs.fair_trade          || null,
      rainforest_alliance:  certs.rainforest_alliance || null,
      sources,
      last_verified:        today,
    };

    planned.push({ slug, payload });

    if (!APPLY_MODE) continue;

    let co;
    try { co = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch (err) {
      console.error(`  parse_error: ${slug} (${err.message})`);
      continue;
    }
    if (!co.enriched || typeof co.enriched !== "object") co.enriched = {};
    co.enriched.supply_chain_certs = payload;

    if (typeof co.dataLastUpdated !== "object" || co.dataLastUpdated === null) {
      co.dataLastUpdated = co.dataLastUpdated ? { legacy: co.dataLastUpdated } : {};
    }
    co.dataLastUpdated.supply_chain_certs = now.toISOString();

    await fs.writeFile(file, JSON.stringify(co));
  }

  // --- Logs ---
  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(UNMATCHED_FILE, JSON.stringify({
    generated_at: now.toISOString(),
    fair_trade_unmatched_count: unmatched.fair_trade.length,
    rainforest_alliance_unmatched_count: unmatched.rainforest_alliance.length,
    ...unmatched,
  }, null, 2));

  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at: now.toISOString(),
    mode: APPLY_MODE ? "apply" : "dry",
    sources: ["public/data/_raw/fair-trade.json", "public/data/_raw/rainforest-alliance.json"],
    planned_count: planned.length,
    sample: planned.slice(0, 25),
    slug_filter: SLUG_FILTER ? [...SLUG_FILTER] : null,
  }, null, 2));

  console.log(`Planned: ${planned.length} companies${APPLY_MODE ? " (applied)" : " (dry-run, no files touched)"}`);
  console.log(`Unmatched Fair Trade: ${unmatched.fair_trade.length}`);
  console.log(`Unmatched Rainforest Alliance: ${unmatched.rainforest_alliance.length}`);

  if (!APPLY_MODE) {
    console.log("\nDRY-RUN sample (first 10):");
    for (const p of planned.slice(0, 10)) {
      const ft = p.payload.fair_trade?.certified ? `FT[${(p.payload.fair_trade.products || []).join(",")}]` : "-";
      const ra = p.payload.rainforest_alliance?.certified ? `RA[${(p.payload.rainforest_alliance.products || []).join(",")}]` : "-";
      console.log(`  ${p.slug.padEnd(32)} ${ft.padEnd(40)} ${ra}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("sustainability-certs-merge failed:", err);
    process.exit(1);
  });
}
