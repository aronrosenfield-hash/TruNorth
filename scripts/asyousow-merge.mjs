#!/usr/bin/env node
/**
 * Step 2 -- Merge asyousow.json into per-company JSON.
 *
 * Reads /public/data/asyousow.json (produced semi-annually by
 * asyousow-fetch.mjs) and writes the structured `asYouSow` field into
 * each matching company file under enriched.asYouSow. Honors
 * slug-aliases.json + brand-parent-map.json.
 *
 * Target schema (only set when status === "ok"):
 *   enriched.asYouSow: {
 *     lists:        [{topic, year, scoreOrRank, sourceUrl}, ...],
 *     bestScores:   [{topic, year, scoreOrRank, sourceUrl}, ...],
 *     worstScores:  [{topic, year, scoreOrRank, sourceUrl}, ...],
 *     lastUpdated:  ISO string,
 *     source:       "as-you-sow"
 *   }
 *
 * Brands with no As You Sow listing match are skipped.
 *
 * Locally: node scripts/asyousow-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AYS_FILE = path.join(ROOT, "public/data/asyousow.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/asyousow-merge-log.json");

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

function toCamelEntry(e) {
  return {
    topic:       e.topic,
    year:        e.year,
    scoreOrRank: e.score_or_rank,
    sourceUrl:   e.source_url || null,
  };
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
  company.enriched.asYouSow = {
    lists:       (brandEntry.asyousow_lists || []).map(toCamelEntry),
    bestScores:  (brandEntry.best_scores  || []).map(toCamelEntry),
    worstScores: (brandEntry.worst_scores || []).map(toCamelEntry),
    lastUpdated: now,
    source:      "as-you-sow",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.asYouSow = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:       brandEntry.slug,
    target:      targetSlug,
    routed_via,
    status:      "merged",
    list_count:  brandEntry.asyousow_lists?.length || 0,
    topics:      (brandEntry.asyousow_lists || []).map(l => l.topic),
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("As You Sow merge starting...");

  const ays = JSON.parse(await fs.readFile(AYS_FILE, "utf-8"));
  const entries = ays.rankings || [];
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
    source_file:      "public/data/asyousow.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    merged_list:      merged.map(r => ({
      brand:      r.brand,
      target:     r.target,
      list_count: r.list_count,
      topics:     r.topics,
    })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no match): ${skipped.length}`);
  console.log(`   Orphan slugs:       ${orphans.length}`);
  console.log(`   Parse errors:       ${errors.length}`);
}

main().catch(err => {
  console.error("asyousow-merge failed:", err);
  process.exit(1);
});
