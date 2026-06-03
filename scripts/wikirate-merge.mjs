#!/usr/bin/env node
/**
 * WikiRate — Step 2: Merge wikirate-metrics.json into per-company JSON.
 *
 * Reads /public/data/wikirate-metrics.json and writes the `wikirate` field
 * into each matching company file. Honors slug-aliases + brand-parent-map.
 *
 * Target schema (company.wikirate):
 *   {
 *     metricsCount:        number,
 *     topMetrics:          [{ topic, value, year, source }],
 *     dataCompletenessPct: number,
 *     wikirateSlug:        string,
 *     lastUpdated:         iso-8601,
 *     source:              "wikirate",
 *     sourceUrl:           "https://wikirate.org/{slug}"
 *   }
 *
 * Locally: node scripts/wikirate-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IN_FILE   = path.join(ROOT, "public/data/wikirate-metrics.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/wikirate-merge-log.json");

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

async function mergeOne(entry, maps, now) {
  if (entry.status !== "ok") {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.wikirate = {
    metricsCount:        entry.wikirate_metrics_count,
    topMetrics:          entry.top_metrics,
    dataCompletenessPct: entry.data_completeness_pct,
    wikirateSlug:        entry.wikirate_slug,
    lastUpdated:         now,
    source:              "wikirate",
    sourceUrl:           `https://wikirate.org/${encodeURIComponent(entry.wikirate_slug)}`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.wikirate = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:        entry.slug,
    target:       targetSlug,
    routed_via,
    status:       "merged",
    metricsCount: entry.wikirate_metrics_count,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("WikiRate merge starting...");

  const payload = JSON.parse(await fs.readFile(IN_FILE, "utf-8"));
  const entries = payload.metrics || [];
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
    merged_at:     now,
    source_file:   "public/data/wikirate-metrics.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`  Skipped (no/not_found): ${skipped.length}`);
  console.log(`  Orphan slugs: ${orphans.length}`);
}

main().catch(err => {
  console.error("wikirate-merge failed:", err);
  process.exit(1);
});
