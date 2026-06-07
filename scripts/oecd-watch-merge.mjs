#!/usr/bin/env node
/**
 * Step 2 — Merge oecd-watch.json into per-company JSON.
 *
 * Reads /public/data/oecd-watch.json (produced quarterly by
 * oecd-watch-fetch.mjs) and writes a structured `oecd_watch` field
 * into each matching company file under:
 *
 *   enriched.supply_chain.oecd_watch = {
 *     complaint_count:   int,
 *     recent_complaints: [
 *       { year, country, complainant, issues: [...], outcome }
 *     ],
 *     primary_issue:     string|null,
 *     primary_region:    string|null,
 *     last_updated:      ISO string,
 *     source:            "oecd-watch"
 *   }
 *
 * Brands with status !== "ok" (no complaints found) are skipped.
 *
 * Honors public/data/_meta/slug-aliases.json + brand-parent-map.json.
 *
 * Locally:
 *   node scripts/oecd-watch-merge.mjs              # dry (default — no writes)
 *   node scripts/oecd-watch-merge.mjs --write      # mutate per-company JSON
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/oecd-watch.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/oecd-watch-merge-log.json");

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
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) {
    return { slug, routed_via: "direct" };
  }
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

function buildPayload(brandEntry, now) {
  return {
    complaint_count:   brandEntry.complaint_count,
    recent_complaints: brandEntry.recent_complaints || [],
    primary_issue:     brandEntry.primary_issue || null,
    primary_region:    brandEntry.primary_region || null,
    last_updated:      now,
    source:            "oecd-watch",
  };
}

async function mergeOne(brandEntry, maps, now, doWrite) {
  if (brandEntry.status !== "ok") {
    return { brand: brandEntry.slug, status: "skipped", reason: brandEntry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(brandEntry.slug, maps);
  if (!targetSlug) {
    return { brand: brandEntry.slug, status: "orphan" };
  }

  if (!doWrite) {
    return {
      brand:           brandEntry.slug,
      target:          targetSlug,
      routed_via,
      status:          "would_merge",
      complaint_count: brandEntry.complaint_count,
      primary_issue:   brandEntry.primary_issue,
      primary_region:  brandEntry.primary_region,
    };
  }

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try {
    company = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch (e) {
    return { brand: brandEntry.slug, target: targetSlug, status: "parse_error", error: e.message };
  }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
  if (!company.enriched.supply_chain || typeof company.enriched.supply_chain !== "object") {
    company.enriched.supply_chain = {};
  }
  company.enriched.supply_chain.oecd_watch = buildPayload(brandEntry, now);

  // dataLastUpdated bookkeeping — same convention as uk-msa / asyousow.
  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.oecdWatch = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           brandEntry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    complaint_count: brandEntry.complaint_count,
    primary_issue:   brandEntry.primary_issue,
    primary_region:  brandEntry.primary_region,
  };
}

async function main() {
  const now     = new Date().toISOString();
  const doWrite = process.argv.includes("--write");
  const mode    = doWrite ? "write" : "dry";

  console.log(`OECD Watch merge starting (${mode} mode)...`);

  const src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8"));
  const entries = src.brands || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now, doWrite));
  }

  const merged    = results.filter(r => r.status === "merged");
  const wouldMerge= results.filter(r => r.status === "would_merge");
  const skipped   = results.filter(r => r.status === "skipped");
  const orphans   = results.filter(r => r.status === "orphan");
  const errors    = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:     now,
    mode,
    source_file:   "public/data/oecd-watch.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    would_merge_count: wouldMerge.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged_list:   [...merged, ...wouldMerge].map(r => ({
      brand:           r.brand,
      target:          r.target,
      routed_via:      r.routed_via,
      status:          r.status,
      complaint_count: r.complaint_count,
      primary_issue:   r.primary_issue,
      primary_region:  r.primary_region,
    })),
  }, null, 2));

  console.log(`Merged:                 ${merged.length}`);
  console.log(`   Would merge (dry):   ${wouldMerge.length}`);
  console.log(`   Skipped (no data):   ${skipped.length}`);
  console.log(`   Orphan slugs:        ${orphans.length}`);
  console.log(`   Parse errors:        ${errors.length}`);
  if (orphans.length) console.log(`   Orphans: ${orphans.map(o => o.brand).join(", ")}`);
}

main().catch(err => {
  console.error("oecd-watch-merge failed:", err);
  process.exit(1);
});
