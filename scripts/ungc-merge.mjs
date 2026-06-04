#!/usr/bin/env node
/**
 * Step 2 -- Merge ungc.json into per-company JSON.
 *
 * Reads /public/data/ungc.json (produced annually by ungc-fetch.mjs) and
 * writes the structured `ungc` field into each matching company file
 * under enriched.ungc. Honors slug-aliases.json + brand-parent-map.json.
 *
 * Target schema (only set when status === "ok"):
 *   enriched.ungc: {
 *     isUngcParticipant: boolean,
 *     ungcJoinedYear:    number | null,
 *     ungcCopStatus:     "active" | "non-communicating" | "expelled" | null,
 *     sourceUrl:         string,
 *     lastUpdated:       ISO string,
 *     source:            "un-global-compact"
 *   }
 *
 * Brands with no UNGC match are skipped (the majority).
 *
 * Locally: node scripts/ungc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UNGC_FILE = path.join(ROOT, "public/data/ungc.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/ungc-merge-log.json");

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

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
  company.enriched.ungc = {
    isUngcParticipant: brandEntry.is_ungc_participant === true,
    ungcJoinedYear:    brandEntry.ungc_joined_year ?? null,
    ungcCopStatus:     brandEntry.ungc_cop_status ?? null,
    sourceUrl:         brandEntry.source_url || null,
    lastUpdated:       now,
    source:            "un-global-compact",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.ungc = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:        brandEntry.slug,
    target:       targetSlug,
    routed_via,
    status:       "merged",
    joined_year:  brandEntry.ungc_joined_year,
    cop_status:   brandEntry.ungc_cop_status,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("UN Global Compact merge starting...");

  const ungc = JSON.parse(await fs.readFile(UNGC_FILE, "utf-8"));
  const entries = ungc.participants || [];
  console.log(`${entries.length} brand entries`);

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
    merged_at:        now,
    source_file:      "public/data/ungc.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    participant_list: merged.map(r => ({
      brand:       r.brand,
      target:      r.target,
      joined_year: r.joined_year,
      cop_status:  r.cop_status,
    })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no match): ${skipped.length}`);
  console.log(`   Orphan slugs:       ${orphans.length}`);
  console.log(`   Parse errors:       ${errors.length}`);
}

main().catch(err => {
  console.error("ungc-merge failed:", err);
  process.exit(1);
});
