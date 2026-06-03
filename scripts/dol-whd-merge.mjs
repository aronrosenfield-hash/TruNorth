#!/usr/bin/env node
/**
 * DOL WHD merge — reads /public/data/dol-whd.json and writes the structured
 * `enriched.dolWhd` field into each matching company file under
 * public/data/companies/.
 *
 * Target schema (enriched.dolWhd):
 *   enriched.dolWhd: {
 *     totalCases5y:           number,
 *     totalBackWagesOwedUsd:  number,
 *     totalEmployeesAffected: number,
 *     topViolationTypes:      [{ label, count }],
 *     byYear:                 { "2021": 12, "2022": 9, ... },
 *     sampleCases:            [...],
 *     totalRecordsAllTime:    number,
 *     lastUpdated:            ISO timestamp,
 *     source:                 "dol-whd",
 *     sourceUrl:              DOL WHD search URL,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no records (zero-data is not useful for tiny/non-US brands).
 *
 * Locally: node scripts/dol-whd-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const WHD_FILE   = path.join(ROOT, "public/data/dol-whd.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/dol-whd-merge-log.json");

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

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.dolWhd = {
    totalCases5y:           entry.total_whd_cases_5y,
    totalBackWagesOwedUsd:  entry.total_back_wages_owed_usd,
    totalEmployeesAffected: entry.total_employees_affected,
    topViolationTypes:      entry.top_violation_types,
    byYear:                 entry.by_year,
    sampleCases:            entry.sample_cases,
    totalRecordsAllTime:    entry.total_records_all_time,
    lastUpdated:            now,
    source:                 "dol-whd",
    sourceUrl:              `https://enforcedata.dol.gov/views/search.php?agency=whd&keyword=${encodeURIComponent(entry.name)}`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.dolWhd = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:            entry.slug,
    target:           targetSlug,
    routed_via,
    status:           "merged",
    cases5y:          entry.total_whd_cases_5y,
    backWagesUsd:     entry.total_back_wages_owed_usd,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("DOL WHD merge starting…");

  const whd = JSON.parse(await fs.readFile(WHD_FILE, "utf-8"));
  if (whd.status === "source_unavailable") {
    console.warn("DOL WHD source was unavailable on last fetch — nothing to merge.");
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify({
      merged_at:     now,
      source_file:   "public/data/dol-whd.json",
      status:        "source_unavailable",
      merged_count:  0,
    }, null, 2));
    return;
  }

  const entries = whd.brands || [];
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
    source_file:      "public/data/dol-whd.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`Skipped (no records): ${skipped.length}`);
  console.log(`Orphan slugs: ${orphans.length}`);
  console.log(`Parse errors: ${errors.length}`);
}

main().catch(err => {
  console.error("dol-whd-merge failed:", err);
  process.exit(1);
});
