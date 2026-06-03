#!/usr/bin/env node
/**
 * CDC FoodNet — Step 2: Merge cdc-foodnet-outbreaks.json into per-company JSON.
 *
 * Reads /public/data/cdc-foodnet-outbreaks.json (produced monthly by
 * cdc-foodnet-fetch.mjs) and writes the structured `cdcFoodOutbreaks` field
 * onto each matching company file under enriched.cdcFoodOutbreaks.
 *
 * Target schema (per-company):
 *   enriched.cdcFoodOutbreaks: {
 *     totalOutbreaks5y:       number,
 *     totalOutbreaksAllTime:  number,
 *     totalIllnesses5y:       number,
 *     totalHospitalizations5y:number,
 *     totalDeaths5y:          number,
 *     sampleOutbreaks:        [{ year, product, pathogen, illnesses,
 *                                hospitalizations, deaths, url }],
 *     lastUpdated:            ISO date,
 *     source:                 "cdc-foodborne",
 *     sourceUrl:              "https://www.cdc.gov/foodborne-outbreaks/outbreaks/index.html",
 *   }
 *
 * Honors slug-aliases.json + brand-parent-map.json — same routing rules as
 * cfpb-merge / lawsuits-merge. Skips brands with zero outbreaks (most non-food
 * brands).
 *
 * Locally: node scripts/cdc-foodnet-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/cdc-foodnet-outbreaks.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "cdc-foodnet-merge-log.json");

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
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) {
    return { slug, routed_via: "direct" };
  }
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
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
  catch (e) {
    return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message };
  }

  company.enriched = company.enriched || {};
  company.enriched.cdcFoodOutbreaks = {
    totalOutbreaks5y:        entry.total_outbreaks_5y,
    totalOutbreaksAllTime:   entry.total_outbreaks_all_time,
    totalIllnesses5y:        entry.total_illnesses_5y,
    totalHospitalizations5y: entry.total_hospitalizations_5y,
    totalDeaths5y:           entry.total_deaths_5y,
    sampleOutbreaks:         entry.sample_outbreaks,
    lastUpdated:             now,
    source:                  "cdc-foodborne",
    sourceUrl:               "https://www.cdc.gov/foodborne-outbreaks/outbreaks/index.html",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated
      ? { legacy: company.dataLastUpdated }
      : {};
  }
  company.dataLastUpdated.cdcFoodOutbreaks = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:             entry.slug,
    target:            targetSlug,
    routed_via,
    status:            "merged",
    totalOutbreaks5y:  entry.total_outbreaks_5y,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("CDC FoodNet merge starting…");

  const src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8"));
  const entries = src.outbreaks || [];
  console.log(`${entries.length} brand entries from fetch`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged   = results.filter((r) => r.status === "merged");
  const skipped  = results.filter((r) => r.status === "skipped");
  const orphans  = results.filter((r) => r.status === "orphan");
  const errors   = results.filter((r) => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:       now,
    source_file:     "public/data/cdc-foodnet-outbreaks.json",
    total_brands:    entries.length,
    merged_count:    merged.length,
    skipped_count:   skipped.length,
    orphan_count:    orphans.length,
    error_count:     errors.length,
    orphans:         orphans.map((o) => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`  Skipped (no outbreaks): ${skipped.length}`);
  console.log(`  Orphan slugs: ${orphans.length}`);
  if (errors.length) console.log(`  Errors: ${errors.length}`);
}

main().catch((err) => {
  console.error("cdc-foodnet-merge failed:", err);
  process.exit(1);
});
