#!/usr/bin/env node
/**
 * HUD Fair Housing — merge step.
 *
 * Reads /public/data/hud-fairhousing.json (produced monthly by hud-fetch.mjs)
 * and writes the structured `hud` field into each matching company file.
 *
 * Target schema:
 *   hud: {
 *     totalCharges5y:       number,   // FHEO charges filed in last 5 years
 *     settlementCount5y:    number,
 *     totalSettlementsUsd:  number,   // summed $ across settlements
 *     topViolations:        [{ label, count }],
 *     sampleCases:          [...],
 *     matchedCaseCount:     number,
 *     lastUpdated:          ISO,
 *     source:               "hud-fheo",
 *     sourceUrl:            string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map. Skips entries with no records.
 *
 * Locally: node scripts/hud-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, "..");
const HUD_FILE = path.join(ROOT, "public/data/hud-fairhousing.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "hud-merge-log.json");

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

  company.hud = {
    totalCharges5y:       entry.total_HUD_charges_5y,
    settlementCount5y:    entry.settlement_count_5y,
    totalSettlementsUsd:  entry.total_settlements_usd,
    topViolations:        entry.top_violations,
    sampleCases:          entry.sample_cases,
    matchedCaseCount:     entry.matched_case_count,
    lastUpdated:          now,
    source:               "hud-fheo",
    sourceUrl:            "https://www.hud.gov/program_offices/fair_housing_equal_opp/enforcement",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.hud = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           entry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    charges5y:       entry.total_HUD_charges_5y,
    settlementsUsd:  entry.total_settlements_usd,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("HUD merge starting…");

  const hud = JSON.parse(await fs.readFile(HUD_FILE, "utf-8"));
  const entries = hud.brands || [];
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

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:     now,
    source_file:   "public/data/hud-fairhousing.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map((o) => o.brand),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Orphans: ${orphans.length}`);
  console.log(`Errors:  ${errors.length}`);
}

main().catch((err) => {
  console.error("hud-merge failed:", err);
  process.exit(1);
});
