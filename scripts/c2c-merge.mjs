#!/usr/bin/env node
/**
 * Step 2 -- Merge c2c.json into per-company JSON.
 *
 * Reads /public/data/c2c.json (produced annually by c2c-fetch.mjs) and
 * writes the structured `c2c` field into each matching company file
 * under enriched.c2c. Honors slug-aliases.json + brand-parent-map.json.
 *
 * Target schema (only set when status === "ok"):
 *   enriched.c2c: {
 *     isC2cCertified: boolean,
 *     c2cTier:        "Bronze" | "Silver" | "Gold" | "Platinum",
 *     c2cCategories:  string[],
 *     sinceYear:      number | null,
 *     sourceUrl:      string,
 *     lastUpdated:    ISO string,
 *     source:         "cradle-to-cradle"
 *   }
 *
 * Brands with no C2C match are skipped (the majority).
 *
 * Locally: node scripts/c2c-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const C2C_FILE = path.join(ROOT, "public/data/c2c.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/c2c-merge-log.json");

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
  company.enriched.c2c = {
    isC2cCertified: brandEntry.is_c2c_certified === true,
    c2cTier:        brandEntry.c2c_tier || null,
    c2cCategories:  brandEntry.c2c_categories || [],
    sinceYear:      brandEntry.since_year ?? null,
    sourceUrl:      brandEntry.source_url || null,
    lastUpdated:    now,
    source:         "cradle-to-cradle",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.c2c = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:       brandEntry.slug,
    target:      targetSlug,
    routed_via,
    status:      "merged",
    tier:        brandEntry.c2c_tier,
    categories:  brandEntry.c2c_categories,
    since_year:  brandEntry.since_year,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("Cradle to Cradle merge starting...");

  const c2c = JSON.parse(await fs.readFile(C2C_FILE, "utf-8"));
  const entries = c2c.certifications || [];
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
    source_file:      "public/data/c2c.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    certified_list:   merged.map(r => ({
      brand:       r.brand,
      target:      r.target,
      tier:        r.tier,
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
  console.error("c2c-merge failed:", err);
  process.exit(1);
});
