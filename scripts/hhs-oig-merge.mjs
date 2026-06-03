#!/usr/bin/env node
/**
 * HHS OIG merge — Step 2.
 *
 * Reads /public/data/hhs-oig.json (produced monthly by hhs-oig-fetch.mjs)
 * and writes the structured `hhsOig` field into each matching company file.
 *
 * Target schema (enriched.hhsOig):
 *   hhsOig: {
 *     isExcluded:             bool,
 *     exclusionCount:         number,
 *     exclusionSample:        [{ busname, exclDate, exclType, city, state }],
 *     recentFraudActions24mo: number,
 *     sampleActions:          [{ date, title, actionType, fineAmount, url }],
 *     lastUpdated:            ISO,
 *     source:                 "hhs-oig",
 *     sourceUrl:              "https://oig.hhs.gov/fraud/enforcement/"
 *   }
 *
 * Honors slug-aliases + brand-parent-map. Brands with no exclusion and no
 * recent action are skipped (no noise on non-healthcare brands).
 *
 * Locally: node scripts/hhs-oig-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OIG_FILE = path.join(ROOT, "public/data/hhs-oig.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/hhs-oig-merge-log.json");

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
  // Skip non-healthcare brands with no signal.
  if (!entry.is_excluded && entry.recent_fraud_actions_24mo === 0) {
    return { brand: entry.slug, status: "skipped", reason: "no_signal" };
  }

  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.hhsOig = {
    isExcluded:             entry.is_excluded,
    exclusionCount:         entry.exclusion_count,
    exclusionSample:        entry.exclusion_sample,
    recentFraudActions24mo: entry.recent_fraud_actions_24mo,
    sampleActions:          entry.sample_actions.map(a => ({
      date:       a.date,
      title:      a.title,
      actionType: a.action_type,
      fineAmount: a.fine_amount,
      url:        a.url,
    })),
    lastUpdated: now,
    source:      "hhs-oig",
    sourceUrl:   "https://oig.hhs.gov/fraud/enforcement/",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.hhsOig = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:             entry.slug,
    target:            targetSlug,
    routed_via,
    status:            "merged",
    isExcluded:        entry.is_excluded,
    exclusionCount:    entry.exclusion_count,
    recentActions24mo: entry.recent_fraud_actions_24mo,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("📋 HHS OIG merge starting…");

  const oig = JSON.parse(await fs.readFile(OIG_FILE, "utf-8"));
  const entries = oig.results || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();
  const results = [];
  for (const e of entries) results.push(await mergeOne(e, maps, now));

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/hhs-oig.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    merged_brands:    merged.map(m => ({
      brand: m.brand, target: m.target, routed_via: m.routed_via,
      isExcluded: m.isExcluded, exclusionCount: m.exclusionCount,
      recentActions24mo: m.recentActions24mo,
    })),
  }, null, 2));

  console.log(`✅ Merged: ${merged.length}`);
  console.log(`   Skipped (no signal): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  console.log(`   Errors: ${errors.length}`);
}

main().catch(err => {
  console.error("❌ hhs-oig-merge failed:", err);
  process.exit(1);
});
