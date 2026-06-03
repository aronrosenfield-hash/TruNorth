#!/usr/bin/env node
/**
 * MSHA — Step 2: merge msha-incidents.json into per-company JSON.
 *
 * Reads /public/data/msha-incidents.json (produced weekly by msha-fetch.mjs)
 * and writes the structured `msha` field into the `enriched` section of
 * each matching company file.
 *
 * Target schema:
 *   enriched.msha: {
 *     totalCitations:           number,
 *     totalPenaltiesUsd:        number,
 *     significantSubstantial:   number,
 *     fatalities5y:             number,
 *     totalAccidents:           number,
 *     sampleCitations:          [...],
 *     sampleFatalities:         [...],
 *     lastUpdated:              ISO,
 *     source:                   "msha",
 *     sourceUrl:                string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing (same pattern as
 * cfpb-merge.mjs, osha-sir-merge.mjs). Brands with zero matched MSHA
 * records are skipped — most TruNorth brands have no mining ops at all.
 *
 * Locally: node scripts/msha-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const MSHA_FILE = path.join(ROOT, "public/data/msha-incidents.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/msha-merge-log.json");

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
  if (entry.status !== "ok" || (entry.total_citations || 0) + (entry.total_accidents || 0) === 0) {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.msha = {
    totalCitations:         entry.total_citations,
    totalPenaltiesUsd:      entry.total_penalties_usd,
    significantSubstantial: entry.significant_substantial,
    fatalities5y:           entry.fatalities_5y,
    totalAccidents:         entry.total_accidents,
    sampleCitations:        entry.sample_citations,
    sampleFatalities:       entry.sample_fatalities,
    lastUpdated:            now,
    source:                 "msha",
    sourceUrl:              "https://www.msha.gov/data-reports",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.msha = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:       entry.slug,
    target:      targetSlug,
    routed_via,
    status:      "merged",
    citations:   entry.total_citations,
    fatalities5y: entry.fatalities_5y,
    penalties:   entry.total_penalties_usd,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("MSHA merge starting...");

  const msha = JSON.parse(await fs.readFile(MSHA_FILE, "utf-8"));
  const entries = msha.brands || [];
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
    merged_at:      now,
    source_file:    "public/data/msha-incidents.json",
    violations_rows: msha.violations_rows,
    accidents_rows:  msha.accidents_rows,
    source_urls:    msha.source_urls,
    total_brands:   entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    orphans:        orphans.map((o) => o.brand),
    top_by_citations: merged
      .slice()
      .sort((a, b) => b.citations - a.citations)
      .slice(0, 20)
      .map((m) => ({
        brand:        m.brand,
        target:       m.target,
        citations:    m.citations,
        fatalities5y: m.fatalities5y,
        penalties:    m.penalties,
      })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`  Skipped (no records): ${skipped.length}`);
  console.log(`  Orphan slugs: ${orphans.length}`);
  console.log(`  Parse errors: ${errors.length}`);
}

main().catch((err) => {
  console.error("msha-merge failed:", err);
  process.exit(1);
});
