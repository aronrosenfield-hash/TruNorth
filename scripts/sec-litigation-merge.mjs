#!/usr/bin/env node
/**
 * Step 2: Merge sec-litigation.json into per-company JSON.
 *
 * Reads /public/data/sec-litigation.json (produced weekly by
 * sec-litigation-fetch.mjs) and writes `enriched.secLitigation` into each
 * matching company file.
 *
 * Target schema (under `enriched.secLitigation`):
 *   totalReleasesLifetime: number
 *   recent24mo:            number
 *   latestReleaseDate:     ISO string | null
 *   sampleReleases:        [{ lr, date, caption, summary, url }]
 *   lastUpdated:           ISO string
 *   source:                "sec"
 *   sourceUrl:             SEC search URL
 *
 * Honors slug-aliases + brand-parent-map. Skips brands with no releases
 * to avoid bloating non-financial companies.
 *
 * Locally: node scripts/sec-litigation-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/sec-litigation.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/sec-litigation-merge-log.json");

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

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.secLitigation = {
    totalReleasesLifetime: entry.total_releases_lifetime,
    recent24mo:            entry.recent_24mo,
    latestReleaseDate:     entry.latest_release_date,
    sampleReleases:        entry.sample_releases,
    lastUpdated:           now,
    source:                "sec",
    sourceUrl:             `https://www.sec.gov/cgi-bin/srqsb?text=${encodeURIComponent('"' + entry.name + '"')}+form-type%3DLitigation+Release`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.secLitigation = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:       entry.slug,
    target:      targetSlug,
    routed_via,
    status:      "merged",
    total:       entry.total_releases_lifetime,
    recent_24mo: entry.recent_24mo,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("SEC Litigation merge starting…");

  const src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8"));
  const entries = src.releases || [];
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
    merged_at:     now,
    source_file:   "public/data/sec-litigation.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no releases): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  console.log(`   Errors: ${errors.length}`);
}

main().catch(err => {
  console.error("sec-litigation-merge failed:", err);
  process.exit(1);
});
