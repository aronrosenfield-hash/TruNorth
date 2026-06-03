#!/usr/bin/env node
/**
 * CPSC — Step 2: Merge cpsc-recalls.json into per-company JSON.
 *
 * Reads /public/data/cpsc-recalls.json (produced weekly by cpsc-fetch.mjs)
 * and writes the structured `cpsc` field into each matching company file.
 *
 * Target schema:
 *   cpsc: {
 *     totalRecalls:        number,
 *     recent24moCount:     number,
 *     topHazards:          [{ label, count }],
 *     sampleRecalls:       [...],
 *     lastUpdated:         ISO,
 *     source:              "cpsc",
 *     sourceUrl:           string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no recalls (or errors) — those would be junk data.
 *
 * Locally: node scripts/cpsc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CPSC_FILE = path.join(ROOT, "public/data/cpsc-recalls.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/cpsc-merge-log.json");

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

  company.cpsc = {
    totalRecalls:     brandEntry.total_recalls,
    recent24moCount:  brandEntry.recent_24mo_count,
    topHazards:       brandEntry.top_hazards,
    sampleRecalls:    brandEntry.sample_recalls,
    lastUpdated:      now,
    source:           "cpsc",
    sourceUrl:        `https://www.cpsc.gov/Recalls?field_rc_manufacturer_value=${encodeURIComponent(brandEntry.name)}`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.cpsc = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:         brandEntry.slug,
    target:        targetSlug,
    routed_via,
    status:        "merged",
    totalRecalls:  brandEntry.total_recalls,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("CPSC merge starting...");

  let cpsc;
  try {
    cpsc = JSON.parse(await fs.readFile(CPSC_FILE, "utf-8"));
  } catch (e) {
    console.error(`Cannot read ${CPSC_FILE}: ${e.message}`);
    console.error("Skipping merge — upstream fetch likely failed.");
    process.exit(0);
  }
  const entries = cpsc.recalls || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged   = results.filter(r => r.status === "merged");
  const skipped  = results.filter(r => r.status === "skipped");
  const orphans  = results.filter(r => r.status === "orphan");
  const errors   = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/cpsc-recalls.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no recalls): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  console.log(`   Parse errors: ${errors.length}`);
}

main().catch(err => {
  console.error("cpsc-merge failed:", err);
  process.exit(1);
});
