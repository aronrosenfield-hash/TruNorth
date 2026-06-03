#!/usr/bin/env node
/**
 * OSHA SIR — Step 2: merge osha-sir.json into per-company JSON.
 *
 * Reads /public/data/osha-sir.json (produced monthly by osha-sir-fetch.mjs)
 * and writes the structured `oshaSevereInjury` field into the
 * `enriched` section of each matching company file.
 *
 * Target schema:
 *   enriched.oshaSevereInjury: {
 *     totalSevereInjuries2y:   number,
 *     totalAmputations2y:      number,
 *     totalHospitalizations2y: number,
 *     byYear:                  { [year]: count },
 *     totalRecordsAllTime:     number,
 *     sampleRecords:           [...],
 *     lastUpdated:             ISO,
 *     source:                  "osha-sir",
 *     sourceUrl:               string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing (same pattern as
 * cfpb-merge.mjs). Brands with zero matched SIR records are skipped —
 * we don't write an empty field, since "no record found" can also mean
 * "our matcher didn't catch the corporate variation" rather than a
 * truthful zero.
 *
 * Locally: node scripts/osha-sir-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, "..");
const SIR_FILE = path.join(ROOT, "public/data/osha-sir.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/osha-sir-merge-log.json");

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
  if (entry.status !== "ok" || (entry.total_records_all_time || 0) === 0) {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.oshaSevereInjury = {
    totalSevereInjuries2y:    entry.total_severe_injuries_2y,
    totalAmputations2y:       entry.total_amputations_2y,
    totalHospitalizations2y:  entry.total_hospitalizations_2y,
    byYear:                   entry.by_year,
    totalRecordsAllTime:      entry.total_records_all_time,
    sampleRecords:            entry.sample_records,
    lastUpdated:              now,
    source:                   "osha-sir",
    sourceUrl:                "https://www.osha.gov/severe-injury-reports",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.oshaSevereInjury = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:        entry.slug,
    target:       targetSlug,
    routed_via,
    status:       "merged",
    records_2y:   entry.total_severe_injuries_2y,
    records_all:  entry.total_records_all_time,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("OSHA SIR merge starting...");

  const sir = JSON.parse(await fs.readFile(SIR_FILE, "utf-8"));
  const entries = sir.brands || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged  = results.filter((r) => r.status === "merged");
  const skipped = results.filter((r) => r.status === "skipped");
  const orphans = results.filter((r) => r.status === "orphan");
  const errors  = results.filter((r) => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:     now,
    source_file:   "public/data/osha-sir.json",
    dataset_rows:  sir.dataset_rows,
    source_url:    sir.source_url,
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map((o) => o.brand),
    top_by_records: merged
      .slice()
      .sort((a, b) => b.records_all - a.records_all)
      .slice(0, 20)
      .map((m) => ({ brand: m.brand, target: m.target, records_all: m.records_all, records_2y: m.records_2y })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`  Skipped (no records): ${skipped.length}`);
  console.log(`  Orphan slugs: ${orphans.length}`);
  console.log(`  Parse errors: ${errors.length}`);
}

main().catch((err) => {
  console.error("osha-sir-merge failed:", err);
  process.exit(1);
});
