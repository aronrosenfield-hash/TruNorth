#!/usr/bin/env node
/**
 * NRC merge — writes enriched.nrc into per-company JSON.
 *
 * Reads /public/data/nrc-events.json (produced weekly by nrc-fetch.mjs)
 * and writes the structured `nrc` field into each matching company file.
 *
 * Honors slug-aliases + brand-parent-map for routing.
 *
 * Target schema (on company JSON):
 *   nrc: {
 *     totalEvents5y:     number,
 *     totalViolations5y: number,
 *     topCategories:     [{ label, count }],
 *     topActionTypes:    [{ label, count }],
 *     sampleEvents:      [...],
 *     sampleViolations:  [...],
 *     yearsCovered:      [number],
 *     lastUpdated:       ISO,
 *     source:            "nrc",
 *     sourceUrl:         "https://www.nrc.gov/reading-rm/doc-collections/event-status/event/"
 *   }
 *
 * Locally: node scripts/nrc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NRC_FILE = path.join(ROOT, "public/data/nrc-events.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/nrc-merge-log.json");

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

async function mergeOne(op, maps, now, yearsCovered) {
  if (op.status !== "ok") {
    return { brand: op.slug, status: "skipped", reason: op.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(op.slug, maps);
  if (!targetSlug) return { brand: op.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: op.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.nrc = {
    totalEvents5y:     op.total_events_5y,
    totalViolations5y: op.total_violations_5y,
    topCategories:     op.top_categories,
    topActionTypes:    op.top_action_types,
    sampleEvents:      op.sample_events,
    sampleViolations:  op.sample_violations,
    yearsCovered,
    lastUpdated:       now,
    source:            "nrc",
    sourceUrl:         "https://www.nrc.gov/reading-rm/doc-collections/event-status/",
    enforcementUrl:    "https://www.nrc.gov/reading-rm/doc-collections/enforcement/",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.nrc = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:             op.slug,
    target:            targetSlug,
    routed_via,
    status:            "merged",
    totalEvents5y:     op.total_events_5y,
    totalViolations5y: op.total_violations_5y,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("📋 NRC merge starting…");

  const nrc = JSON.parse(await fs.readFile(NRC_FILE, "utf-8"));
  const ops = nrc.operators || [];
  const yearsCovered = nrc.years_covered || [];
  console.log(`${ops.length} operator entries`);

  const maps = await loadMaps();

  const results = [];
  for (const op of ops) {
    results.push(await mergeOne(op, maps, now, yearsCovered));
  }

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:     now,
    source_file:   "public/data/nrc-events.json",
    years_covered: yearsCovered,
    total_brands:  ops.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged_brands: merged.map(m => ({
      brand: m.brand, target: m.target, routed_via: m.routed_via,
      events: m.totalEvents5y, violations: m.totalViolations5y,
    })),
  }, null, 2));

  console.log(`✅ Merged: ${merged.length}`);
  console.log(`   Skipped (no records): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  if (errors.length) console.log(`   Errors: ${errors.length}`);
}

main().catch(err => {
  console.error("❌ nrc-merge failed:", err);
  process.exit(1);
});
