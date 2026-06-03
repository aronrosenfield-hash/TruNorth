#!/usr/bin/env node
/**
 * Option D — Step 2: Merge cfpb-complaints.json into per-company JSON.
 *
 * Reads /public/data/cfpb-complaints.json (produced weekly by cfpb-fetch.mjs)
 * and writes the structured `cfpb` field into each matching company file.
 *
 * Target schema:
 *   cfpb: {
 *     totalComplaints:    number,
 *     recent12moCount:    number,
 *     timelyResponseRate: number | null   (0-100)
 *     topIssues:          [{ label, count }],
 *     topProducts:        [{ label, count }],
 *     sampleComplaints:   [...]
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no complaints — those would be junk data on non-financial brands.
 *
 * Locally: node scripts/cfpb-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CFPB_FILE = path.join(ROOT, "public/data/cfpb-complaints.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/cfpb-merge-log.json");

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

  company.cfpb = {
    totalComplaints:    brandEntry.total_complaints,
    recent12moCount:    brandEntry.recent_12mo_count,
    timelyResponseRate: brandEntry.timely_response_rate,
    topIssues:          brandEntry.top_issues,
    topProducts:        brandEntry.top_products,
    topResponseTypes:   brandEntry.top_response_types,
    sampleComplaints:   brandEntry.sample_complaints,
    sampledCount:       brandEntry.sampled_count,
    lastUpdated:        now,
    source:             "cfpb",
    sourceUrl:          `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(brandEntry.name)}`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.cfpb = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           brandEntry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    totalComplaints: brandEntry.total_complaints,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("📋 CFPB merge starting…");

  const cfpb = JSON.parse(await fs.readFile(CFPB_FILE, "utf-8"));
  const entries = cfpb.complaints || [];
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
    source_file:      "public/data/cfpb-complaints.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
  }, null, 2));

  console.log(`✅ Merged: ${merged.length}`);
  console.log(`   Skipped (no complaints): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
}

main().catch(err => {
  console.error("❌ cfpb-merge failed:", err);
  process.exit(1);
});
