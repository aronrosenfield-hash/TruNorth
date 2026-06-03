#!/usr/bin/env node
/**
 * GDELT — Step 2: merge /public/data/gdelt.json into per-company JSON.
 *
 * Writes enriched.gdelt onto each matching /public/data/companies/<slug>.json:
 *   gdelt: {
 *     totalMentions:        number,
 *     topCountries:         [{ label, count }],
 *     topLanguages:         [{ label, count }],
 *     topDomains:           [{ label, count }],
 *     avgTone:              number | null,    // V2TONE-weighted bin mean
 *     toneSampleSize:       number,
 *     toneDistribution:     [{ bin, count }],
 *     internationalExposure: boolean,         // ≥3 non-US countries
 *     nonUsCountryCount:    number,
 *     sampleArticles:       [...],            // up to 10
 *     lastUpdated:          ISO string,
 *     source:               "gdelt-doc-2.0",
 *     sourceUrl:            search URL for the brand
 *   }
 *
 * Routes through slug-aliases.json + brand-parent-map.json so that, e.g.,
 * news about a sub-brand lands on its parent's company file. Mirrors the
 * routing used by news-extracted-merge.mjs and cfpb-merge.mjs.
 *
 * Skips brands where status !== "ok" or total_mentions === 0 — empty
 * GDELT records would be junk overhead in the company files.
 *
 * Locally: node scripts/gdelt-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GDELT_FILE = path.join(ROOT, "public/data/gdelt.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(META_DIR, "gdelt-merge-log.json");

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
  if (!brandEntry.total_mentions || brandEntry.total_mentions === 0) {
    return { brand: brandEntry.slug, status: "skipped", reason: "no_mentions" };
  }

  const { slug: targetSlug, routed_via } = resolveSlug(brandEntry.slug, maps);
  if (!targetSlug) return { brand: brandEntry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: brandEntry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.gdelt = {
    totalMentions:         brandEntry.total_mentions,
    cappedAt:              brandEntry.capped_at,
    topCountries:          brandEntry.top_countries || [],
    topLanguages:          brandEntry.top_languages || [],
    topDomains:            brandEntry.top_domains || [],
    avgTone:               brandEntry.tone?.avg_tone ?? null,
    toneSampleSize:        brandEntry.tone?.sample_size ?? 0,
    toneDistribution:      brandEntry.tone?.distribution || [],
    internationalExposure: !!brandEntry.international_exposure,
    nonUsCountryCount:     brandEntry.non_us_country_count || 0,
    sampleArticles:        brandEntry.sample_articles || [],
    lastUpdated:           now,
    source:                "gdelt-doc-2.0",
    sourceUrl:             `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent('"' + brandEntry.name + '"')}&mode=artlist&format=html&timespan=30d`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated
      ? { legacy: company.dataLastUpdated }
      : {};
  }
  company.dataLastUpdated.gdelt = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:         brandEntry.slug,
    target:        targetSlug,
    routed_via,
    status:        "merged",
    totalMentions: brandEntry.total_mentions,
    intl:          !!brandEntry.international_exposure,
  };
}

async function main() {
  console.log("🔀 GDELT merge starting...");
  if (!existsSync(GDELT_FILE)) {
    console.error(`❌ ${GDELT_FILE} not found — run gdelt-fetch.mjs first`);
    process.exit(1);
  }
  const data = JSON.parse(await fs.readFile(GDELT_FILE, "utf-8"));
  const brands = data.brands || [];
  console.log(`📋 ${brands.length} brand entries in gdelt.json`);

  const maps = await loadMaps();
  console.log(`🗺️  Loaded ${Object.keys(maps.aliases).length} slug aliases + ${Object.keys(maps.parents).length} parent mappings`);

  const now = new Date().toISOString();
  const results = [];
  let i = 0;
  for (const brand of brands) {
    const r = await mergeOne(brand, maps, now);
    results.push(r);
    i++;
    if (i % 50 === 0) console.log(`  …${i}/${brands.length}`);
  }

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");
  const intl    = merged.filter(r => r.intl);

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:    now,
    source_file:  "gdelt.json",
    brand_count:  brands.length,
    merged_count: merged.length,
    skipped_count: skipped.length,
    orphan_count: orphans.length,
    error_count:  errors.length,
    intl_count:   intl.length,
    orphans:      orphans.map(o => o.brand),
    errors,
    sample_merged: merged.slice(0, 10),
  }, null, 2));

  console.log(`\n✅ GDELT merge complete`);
  console.log(`   Merged:        ${merged.length}`);
  console.log(`   Skipped:       ${skipped.length}  (errors or zero mentions)`);
  console.log(`   Orphans:       ${orphans.length}`);
  console.log(`   Parse errors:  ${errors.length}`);
  console.log(`   International: ${intl.length}`);
}

main().catch(err => {
  console.error("❌ gdelt-merge failed:", err);
  process.exit(1);
});
