#!/usr/bin/env node
/**
 * Option B — Step 2: Merge bbb-ratings.json into per-company JSON.
 *
 * Reads /public/data/bbb-ratings.json (produced weekly by bbb-scrape.mjs)
 * and writes the structured `bbb` field into each matching company file.
 *
 * Target schema (matches what App.jsx already reads at line 2496+):
 *   bbb: {
 *     rating:         "A+" | "A" | "B+" | ... | "F" | "NR" | null,
 *     accredited:     boolean | null,
 *     complaintCount: number | null,
 *     profileUrl:     "https://www.bbb.org/us/..."
 *   }
 *
 * Honors slug-aliases.json + brand-parent-map.json so sub-brands route
 * to the correct destination file.
 *
 * Critical: skips entries where rating is null. The scraper's first
 * production runs returned rating=null for all 528 brands (likely
 * Cloudflare bot block — see bbb-scrape.mjs diagnostics). Better to
 * write nothing than to overwrite existing data with null.
 *
 * Locally: node scripts/bbb-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BBB_FILE = path.join(ROOT, "public/data/bbb-ratings.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/bbb-merge-log.json");

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
  // Skip null-rating entries entirely — see file comment.
  if (!brandEntry.rating) {
    return { brand: brandEntry.slug, status: "no_rating", reason: brandEntry.status || "rating_null" };
  }

  const { slug: targetSlug, routed_via } = resolveSlug(brandEntry.slug, maps);
  if (!targetSlug) return { brand: brandEntry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: brandEntry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.bbb = {
    rating:         brandEntry.rating,
    accredited:     brandEntry.accredited ?? null,
    complaintCount: brandEntry.complaints ?? null,
    profileUrl:     brandEntry.profile_url || null,
    ratingScore:    brandEntry.rating_score ?? null,
    lastUpdated:    now,
    source:         "bbb-scrape",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.bbb = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:      brandEntry.slug,
    target:     targetSlug,
    routed_via,
    status:     "merged",
    rating:     brandEntry.rating,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("🏢 BBB merge starting…");

  let bbb;
  try { bbb = JSON.parse(await fs.readFile(BBB_FILE, "utf-8")); }
  catch (e) {
    console.error("❌ Could not read bbb-ratings.json:", e.message);
    process.exit(0);  // Not fatal — workflow can still commit the JSON file even if merge can't run
  }

  const entries = bbb.ratings || [];
  console.log(`📋 ${entries.length} brand entries`);

  const maps = await loadMaps();
  console.log(`🗺️  ${Object.keys(maps.aliases).length} aliases + ${Object.keys(maps.parents).length} parents`);

  const results = [];
  for (const b of entries) {
    results.push(await mergeOne(b, maps, now));
  }

  const merged    = results.filter(r => r.status === "merged");
  const orphans   = results.filter(r => r.status === "orphan");
  const noRating  = results.filter(r => r.status === "no_rating");
  const errors    = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/bbb-ratings.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    no_rating_count:  noRating.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    routing_breakdown: {
      direct: merged.filter(r => r.routed_via === "direct").length,
      alias:  merged.filter(r => r.routed_via === "alias").length,
      parent: merged.filter(r => r.routed_via === "parent").length,
    },
    orphans: orphans.map(o => o.brand),
  }, null, 2));

  console.log(`✅ Wrote ${LOG_FILE}`);
  console.log(`   Merged:        ${merged.length}`);
  console.log(`   No rating:     ${noRating.length}  (scraper returned null — see B-25)`);
  console.log(`   Orphan slugs:  ${orphans.length}`);
}

main().catch(err => {
  console.error("❌ bbb-merge failed:", err);
  process.exit(1);
});
