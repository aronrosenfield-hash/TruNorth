#!/usr/bin/env node
/**
 * Step 2: Merge doj-mentions.json into per-company JSON.
 *
 * Reads /public/data/doj-mentions.json (produced weekly by doj-fetch.mjs)
 * and writes the structured `doj` field into each matching company file.
 *
 * Target schema:
 *   doj: {
 *     totalMentions90d:    number,
 *     antitrustMentions:   number,
 *     fraudMentions:       number,
 *     criminalMentions:    number,
 *     recentReleases:      [{ title, url, date, components, categories, snippet }],
 *     lastUpdated:         ISO timestamp,
 *     source:              "doj",
 *     sourceUrl:           "https://www.justice.gov/news?type=press_release",
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no mentions.
 *
 * Locally: node scripts/doj-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOJ_FILE = path.join(ROOT, "public/data/doj-mentions.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "doj-merge-log.json");

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

  company.doj = {
    totalMentions90d:  brandEntry.total_doj_mentions_90d,
    antitrustMentions: brandEntry.antitrust_mentions,
    fraudMentions:     brandEntry.fraud_mentions,
    criminalMentions:  brandEntry.criminal_mentions,
    recentReleases:    brandEntry.recent_releases,
    lastUpdated:       now,
    source:            "doj",
    sourceUrl:         "https://www.justice.gov/news?type=press_release",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.doj = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:        brandEntry.slug,
    target:       targetSlug,
    routed_via,
    status:       "merged",
    mentions90d:  brandEntry.total_doj_mentions_90d,
    antitrust:    brandEntry.antitrust_mentions,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("⚖️  DOJ merge starting…");

  const doj = JSON.parse(await fs.readFile(DOJ_FILE, "utf-8"));
  const entries = doj.mentions || [];
  console.log(`${entries.length} brand entries (${doj.brands_with_mentions} with hits)`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:       now,
    source_file:     "public/data/doj-mentions.json",
    window_start:    doj.window_start,
    window_end:      doj.window_end,
    releases_scanned: doj.releases_scanned,
    total_brands:    entries.length,
    merged_count:    merged.length,
    skipped_count:   skipped.length,
    orphan_count:    orphans.length,
    error_count:     errors.length,
    orphans:         orphans.map(o => o.brand),
  }, null, 2));

  console.log(`✅ Merged: ${merged.length}`);
  console.log(`   Skipped (no mentions): ${skipped.length}`);
  console.log(`   Orphan slugs:          ${orphans.length}`);
  console.log(`   Parse errors:          ${errors.length}`);
}

main().catch(err => {
  console.error("❌ doj-merge failed:", err);
  process.exit(1);
});
