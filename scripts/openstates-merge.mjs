#!/usr/bin/env node
/**
 * OpenStates — Step 2: Merge openstates-bills.json into per-company JSON.
 *
 * Reads /public/data/openstates-bills.json (produced monthly by
 * openstates-fetch.mjs) and writes the structured `openStates` field into
 * each matching company file.
 *
 * Target schema (camelCase to match the rest of enriched data):
 *   openStates: {
 *     totalBills12mo:   number,
 *     topStates:        [{ label, count }],
 *     topTopics:        [{ label, count }],
 *     sampleBills:      [...],
 *     sampledCount:     number,
 *     lastUpdated:      ISO ts,
 *     source:           "openstates",
 *     sourceUrl:        link to openstates.org search,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with no
 * bills found (most non-policy brands).
 *
 * Locally: node scripts/openstates-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OS_FILE  = path.join(ROOT, "public/data/openstates-bills.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/openstates-merge-log.json");

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

  company.openStates = {
    totalBills12mo: brandEntry.total_bills_12mo,
    topStates:      brandEntry.top_states,
    topTopics:      brandEntry.top_topics,
    sampleBills:    brandEntry.sample_bills,
    sampledCount:   brandEntry.sampled_count,
    lastUpdated:    now,
    source:         "openstates",
    sourceUrl:      `https://openstates.org/search/?query=${encodeURIComponent(brandEntry.name)}`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.openStates = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:          brandEntry.slug,
    target:         targetSlug,
    routed_via,
    status:         "merged",
    totalBills12mo: brandEntry.total_bills_12mo,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("🏛️  OpenStates merge starting…");

  const data = JSON.parse(await fs.readFile(OS_FILE, "utf-8"));
  const entries = data.bills || [];
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
    source_file:   "public/data/openstates-bills.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
  }, null, 2));

  console.log(`✅ Merged:                ${merged.length}`);
  console.log(`   Skipped (no bills):    ${skipped.length}`);
  console.log(`   Orphan slugs:          ${orphans.length}`);
  console.log(`   Errors:                ${errors.length}`);
}

main().catch(err => {
  console.error("❌ openstates-merge failed:", err);
  process.exit(1);
});
