#!/usr/bin/env node
/**
 * Step 2 -- Merge newsweek-mrc.json into per-company JSON.
 *
 * Reads /public/data/newsweek-mrc.json (produced annually by
 * newsweek-mrc-fetch.mjs) and writes the structured `newsweekMrc` field
 * into each matching company file under enriched.newsweekMrc. Honors
 * slug-aliases.json + brand-parent-map.json.
 *
 * Target schema (only set when status === "ok"):
 *   enriched.newsweekMrc: {
 *     rank:         number,    // 1-600
 *     score:        number,    // 0-100
 *     year:         number,    // ranking publication year
 *     sourceUrl:    string,
 *     lastUpdated:  ISO string,
 *     source:       "newsweek-mrc"
 *   }
 *
 * Brands with no Newsweek MRC match are skipped (most of the top-500
 * brand list lies outside the 600-company ranking, or is a private /
 * non-US-listed brand).
 *
 * Locally: node scripts/newsweek-mrc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MRC_FILE = path.join(ROOT, "public/data/newsweek-mrc.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/newsweek-mrc-merge-log.json");

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
  company.enriched.newsweekMrc = {
    rank:        brandEntry.newsweek_mrc_rank,
    score:       brandEntry.newsweek_mrc_score,
    year:        brandEntry.year,
    sourceUrl:   brandEntry.source_url || null,
    lastUpdated: now,
    source:      "newsweek-mrc",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.newsweekMrc = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:      brandEntry.slug,
    target:     targetSlug,
    routed_via,
    status:     "merged",
    rank:       brandEntry.newsweek_mrc_rank,
    score:      brandEntry.newsweek_mrc_score,
    year:       brandEntry.year,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("Newsweek MRC merge starting...");

  const mrc = JSON.parse(await fs.readFile(MRC_FILE, "utf-8"));
  const entries = mrc.rankings || [];
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
    merged_at:      now,
    source_file:    "public/data/newsweek-mrc.json",
    ranking_year:   mrc.ranking_year ?? null,
    total_brands:   entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    orphans:        orphans.map(o => o.brand),
    ranked_list:    merged.map(r => ({
      brand:  r.brand,
      target: r.target,
      rank:   r.rank,
      score:  r.score,
      year:   r.year,
    })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no match): ${skipped.length}`);
  console.log(`   Orphan slugs:       ${orphans.length}`);
  console.log(`   Parse errors:       ${errors.length}`);
}

main().catch(err => {
  console.error("newsweek-mrc-merge failed:", err);
  process.exit(1);
});
