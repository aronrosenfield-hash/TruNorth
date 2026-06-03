#!/usr/bin/env node
/**
 * GitHub Security Advisories — Step 2: Merge github-advisories.json
 * into per-company JSON under enriched.githubAdvisories.
 *
 * The fetcher already writes each brand keyed by its TruNorth slug, but
 * we still honor slug-aliases.json + brand-parent-map.json so that a
 * brand whose slug shifted (or sub-brand) routes to the correct file.
 *
 * Locally: node scripts/github-advisories-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/github-advisories.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "github-advisories-merge-log.json");

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

function resolveSlug(brandSlug, maps) {
  if (existsSync(path.join(COMP_DIR, `${brandSlug}.json`))) {
    return { slug: brandSlug, routed_via: "direct" };
  }
  const alias = maps.aliases[brandSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[brandSlug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

async function mergeOne(entry, maps, now) {
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) {
    return { brand: entry.brand, slug: entry.slug, status: "orphan" };
  }

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) {
    return { brand: entry.brand, target: targetSlug, status: "parse_error", error: e.message };
  }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.githubAdvisories = {
    brand:           entry.brand,
    affects:         entry.affects,
    totalAdvisories: entry.total_advisories,
    recent24mo:      entry.recent_24mo,
    criticalCount:   entry.critical_count,
    topCategories:   entry.top_categories,
    sample:          entry.sample,
    lastUpdated:     now,
    source:          "github-advisories",
    sourceUrl:       "https://github.com/advisories",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.githubAdvisories = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           entry.brand,
    slug:            entry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    totalAdvisories: entry.total_advisories,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("GitHub Advisories merge starting...");

  const src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8"));
  const entries = src.brands || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    if (e.error) {
      results.push({ brand: e.brand, slug: e.slug, status: "fetch_error", error: e.error });
      continue;
    }
    results.push(await mergeOne(e, maps, now));
  }

  const merged   = results.filter(r => r.status === "merged");
  const orphans  = results.filter(r => r.status === "orphan");
  const errors   = results.filter(r => r.status === "parse_error" || r.status === "fetch_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:      now,
    source_file:    "public/data/github-advisories.json",
    total_brands:   entries.length,
    merged_count:   merged.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    merged_brands:  merged.map(m => ({
      brand: m.brand, target: m.target, routed_via: m.routed_via, advisories: m.totalAdvisories,
    })),
    orphans:        orphans.map(o => ({ brand: o.brand, slug: o.slug })),
    errors,
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`Orphans: ${orphans.length}`);
  console.log(`Errors: ${errors.length}`);
  if (merged.length > 0) {
    console.log("\nMerges:");
    for (const m of merged.sort((a, b) => b.totalAdvisories - a.totalAdvisories)) {
      console.log(`  ${m.totalAdvisories.toString().padStart(4)} ${m.brand} -> ${m.target} (${m.routed_via})`);
    }
  }
}

main().catch(err => {
  console.error("github-advisories-merge failed:", err);
  process.exit(1);
});
