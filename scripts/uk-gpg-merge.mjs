#!/usr/bin/env node
/**
 * UK Gender Pay Gap — merge step.
 *
 * Reads /public/data/uk-gpg.json (produced annually by uk-gpg-fetch.mjs)
 * and writes a structured `ukGpg` field into each matching per-company
 * file under /public/data/companies/.
 *
 * Honors slug-aliases + brand-parent-map for routing (so e.g. a brand
 * that resolves to a parent company gets its GPG data attached to the
 * parent's profile). Skips entries with no UK GPG match — most US-only
 * brands will be skipped, which is fine; the UI conditions on presence.
 *
 * Target schema:
 *   ukGpg: {
 *     meanPct:           number,
 *     medianPct:         number,
 *     bonusPctMale:      number,
 *     bonusPctFemale:    number,
 *     diffMeanBonusPct:  number,
 *     diffMedianBonusPct:number,
 *     femaleQuartiles:   { top, upperMid, lowerMid, lower },
 *     employerName:      string,
 *     employerSize:      string,
 *     reportingCount:    number,
 *     year:              number,
 *     sourceUrl:         string,
 *     lastUpdated:       ISO timestamp,
 *     source:            "uk-gpg-service",
 *   }
 *
 * Locally: node scripts/uk-gpg-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GPG_FILE = path.join(ROOT, "public/data/uk-gpg.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/uk-gpg-merge-log.json");

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

  company.ukGpg = {
    meanPct:           entry.uk_gpg_mean_pct,
    medianPct:         entry.uk_gpg_median_pct,
    bonusPctMale:      entry.uk_gpg_bonus_pct_male,
    bonusPctFemale:    entry.uk_gpg_bonus_pct_female,
    diffMeanBonusPct:  entry.diff_mean_bonus_pct,
    diffMedianBonusPct:entry.diff_median_bonus_pct,
    femaleQuartiles: {
      top:      entry.female_top_quartile,
      upperMid: entry.female_upper_mid_quartile,
      lowerMid: entry.female_lower_mid_quartile,
      lower:    entry.female_lower_quartile,
    },
    employerName:    entry.employer_name,
    employerSize:    entry.employer_size,
    reportingCount:  entry.reporting_count,
    year:            entry.year,
    sourceUrl:       entry.source_url,
    lastUpdated:     now,
    source:          "uk-gpg-service",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.ukGpg = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:       entry.slug,
    target:      targetSlug,
    routed_via,
    status:      "merged",
    meanPct:     entry.uk_gpg_mean_pct,
    medianPct:   entry.uk_gpg_median_pct,
    year:        entry.year,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("UK GPG merge starting…");

  const gpg = JSON.parse(await fs.readFile(GPG_FILE, "utf-8"));
  const entries = gpg.employers || [];
  console.log(`${entries.length} brand entries (reporting year ${gpg.reporting_year})`);

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
    source_file:   "public/data/uk-gpg.json",
    reporting_year: gpg.reporting_year,
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (not in UK GPG): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  console.log(`   Errors: ${errors.length}`);
}

main().catch(err => {
  console.error("uk-gpg-merge failed:", err);
  process.exit(1);
});
