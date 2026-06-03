#!/usr/bin/env node
/**
 * Step 2 -- Merge kntc.json into per-company JSON.
 *
 * Reads /public/data/kntc.json (produced annually by kntc-fetch.mjs) and
 * writes the structured `knowTheChain` field into each matching company
 * file under enriched.knowTheChain. Honors slug-aliases.json +
 * brand-parent-map.json.
 *
 * Target schema (only set when status === "ok"):
 *   enriched.knowTheChain: {
 *     score:        number 0-100,
 *     rank:         number,
 *     sector:       string,
 *     year:         number,
 *     weakAreas:    string[],
 *     sourceUrl:    string,
 *     lastUpdated:  ISO string,
 *     source:       "knowthechain"
 *   }
 *
 * Brands with no benchmark match are skipped (the majority).
 *
 * Locally: node scripts/kntc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const KTC_FILE = path.join(ROOT, "public/data/kntc.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/kntc-merge-log.json");

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
  company.enriched.knowTheChain = {
    score:        brandEntry.kntc_score,
    rank:         brandEntry.kntc_rank,
    sector:       brandEntry.kntc_sector,
    year:         brandEntry.kntc_year,
    weakAreas:    brandEntry.kntc_weak_areas || [],
    sourceUrl:    brandEntry.source_url || null,
    lastUpdated:  now,
    source:       "knowthechain",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.knowTheChain = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:       brandEntry.slug,
    target:      targetSlug,
    routed_via,
    status:      "merged",
    score:       brandEntry.kntc_score,
    rank:        brandEntry.kntc_rank,
    sector:      brandEntry.kntc_sector,
    year:        brandEntry.kntc_year,
    weak_areas:  brandEntry.kntc_weak_areas,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("KnowTheChain merge starting...");

  const ktc = JSON.parse(await fs.readFile(KTC_FILE, "utf-8"));
  const entries = ktc.benchmarks || [];
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
    source_file:      "public/data/kntc.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    benchmarked_list: merged.map(r => ({
      brand:       r.brand,
      target:      r.target,
      sector:      r.sector,
      year:        r.year,
      score:       r.score,
      rank:        r.rank,
      weak_areas:  r.weak_areas,
    })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no match): ${skipped.length}`);
  console.log(`   Orphan slugs:       ${orphans.length}`);
  console.log(`   Parse errors:       ${errors.length}`);
}

main().catch(err => {
  console.error("kntc-merge failed:", err);
  process.exit(1);
});
