#!/usr/bin/env node
/**
 * Step 2 -- Merge ca100.json into per-company JSON.
 *
 * Reads /public/data/ca100.json (produced annually by ca100-fetch.mjs)
 * and writes the structured `ca100` field into each matching company
 * file under enriched.ca100. Honors slug-aliases.json +
 * brand-parent-map.json.
 *
 * Target schema (only set when status === "ok"):
 *   enriched.ca100: {
 *     isFocusCompany:    true,
 *     disclosureGrade:   string,    // "A" / "B" / "C" / "D"
 *     year:              number,    // benchmark publication year
 *     sourceUrl:         string,
 *     lastUpdated:       ISO string,
 *     source:            "climate-action-100"
 *   }
 *
 * Brands with no CA100+ match are skipped (the majority of the top-500
 * brand list is not on the focus-company roster -- CA100+ targets
 * ~167 systemically important emitters).
 *
 * Locally: node scripts/ca100-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CA100_FILE = path.join(ROOT, "public/data/ca100.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/ca100-merge-log.json");

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
  company.enriched.ca100 = {
    isFocusCompany:   true,
    disclosureGrade:  brandEntry.ca100_disclosure_grade,
    year:             brandEntry.ca100_year,
    sourceUrl:        brandEntry.source_url || null,
    lastUpdated:      now,
    source:           "climate-action-100",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.ca100 = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:      brandEntry.slug,
    target:     targetSlug,
    routed_via,
    status:     "merged",
    grade:      brandEntry.ca100_disclosure_grade,
    year:       brandEntry.ca100_year,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("Climate Action 100+ merge starting...");

  const ca = JSON.parse(await fs.readFile(CA100_FILE, "utf-8"));
  const entries = ca.rankings || [];
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
    merged_at:       now,
    source_file:     "public/data/ca100.json",
    benchmark_year:  ca.benchmark_year ?? null,
    total_brands:    entries.length,
    merged_count:    merged.length,
    skipped_count:   skipped.length,
    orphan_count:    orphans.length,
    error_count:     errors.length,
    orphans:         orphans.map(o => o.brand),
    ranked_list:     merged.map(r => ({
      brand:  r.brand,
      target: r.target,
      grade:  r.grade,
      year:   r.year,
    })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no match): ${skipped.length}`);
  console.log(`   Orphan slugs:       ${orphans.length}`);
  console.log(`   Parse errors:       ${errors.length}`);
}

main().catch(err => {
  console.error("ca100-merge failed:", err);
  process.exit(1);
});
