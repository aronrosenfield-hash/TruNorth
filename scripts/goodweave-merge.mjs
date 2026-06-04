#!/usr/bin/env node
/**
 * Step 2 -- Merge goodweave.json into per-company JSON.
 *
 * Reads /public/data/goodweave.json (produced annually by
 * goodweave-fetch.mjs) and writes the structured `goodWeave` field into
 * each matching company file under enriched.goodWeave. Honors
 * slug-aliases.json + brand-parent-map.json.
 *
 * Target schema (only set when status === "ok"):
 *   enriched.goodWeave: {
 *     isGoodWeaveCertified: boolean,
 *     gwCategories:         string[],
 *     sinceYear:            number | null,
 *     sourceUrl:            string,
 *     lastUpdated:          ISO string,
 *     source:               "goodweave"
 *   }
 *
 * Brands with no GoodWeave match are skipped (the majority).
 *
 * Locally: node scripts/goodweave-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GW_FILE  = path.join(ROOT, "public/data/goodweave.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/goodweave-merge-log.json");

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

function resolveSlug(slug, maps) {
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) return { slug, routed_via: "direct" };
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return { slug: alias, routed_via: "alias" };
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return { slug: parent, routed_via: "parent" };
  return { slug: null, routed_via: "orphan" };
}

async function mergeOne(brandEntry, maps, now) {
  if (brandEntry.status !== "ok") {
    return { brand: brandEntry.slug, status: "skipped", reason: brandEntry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(brandEntry.slug, maps);
  if (!targetSlug) return { brand: brandEntry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: brandEntry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
  company.enriched.goodWeave = {
    isGoodWeaveCertified: brandEntry.is_goodweave_certified === true,
    gwCategories:         brandEntry.gw_categories || [],
    sinceYear:            brandEntry.since_year ?? null,
    sourceUrl:            brandEntry.source_url || null,
    lastUpdated:          now,
    source:               "goodweave",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.goodWeave = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:        brandEntry.slug,
    target:       targetSlug,
    routed_via,
    status:       "merged",
    categories:   brandEntry.gw_categories,
    since_year:   brandEntry.since_year,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("GoodWeave merge starting...");

  const gw = JSON.parse(await fs.readFile(GW_FILE, "utf-8"));
  const entries = gw.certifications || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/goodweave.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    certified_list:   merged.map(r => ({
      brand:       r.brand,
      target:      r.target,
      categories:  r.categories,
      since_year:  r.since_year,
    })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no match): ${skipped.length}`);
  console.log(`   Orphan slugs:       ${orphans.length}`);
  console.log(`   Parse errors:       ${errors.length}`);
}

main().catch(err => {
  console.error("goodweave-merge failed:", err);
  process.exit(1);
});
