#!/usr/bin/env node
/**
 * Fed Reserve merge — writes the `fedReserve` field into each matching
 * company JSON under `enriched`.
 *
 * Reads /public/data/fed-reserve-enforcement.json (produced monthly by
 * fed-reserve-fetch.mjs) and writes the structured field per brand.
 *
 * Target schema:
 *   enriched.fedReserve: {
 *     totalActions:               number,
 *     totalActions5y:             number,
 *     totalPenaltiesDollars:      number,   // all-time
 *     totalPenalties5yDollars:    number,
 *     topActionTypes:             [{ label, count }],
 *     sampleActions:              [...up to 5],
 *     lastUpdated:                ISO,
 *     source:                     "fed-reserve",
 *     sourceUrl:                  string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map (same pattern as occ-merge.mjs,
 * msha-merge.mjs). Skips entries with no actions — vast majority of
 * non-bank brands return zero results.
 *
 * Locally: node scripts/fed-reserve-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const FED_FILE   = path.join(ROOT, "public/data/fed-reserve-enforcement.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/fed-reserve-merge-log.json");

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
  if (entry.status !== "ok" || !entry.total_fed_actions) {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.fedReserve = {
    totalActions:            entry.total_fed_actions,
    totalActions5y:          entry.total_fed_actions_5y,
    totalPenaltiesDollars:   entry.total_penalties_dollars,
    totalPenalties5yDollars: entry.total_penalties_5y_dollars,
    topActionTypes:          entry.top_action_types,
    sampleActions:           entry.sample_actions,
    lastUpdated:             now,
    source:                  "fed-reserve",
    sourceUrl:               entry.source_url,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.fedReserve = now;

  await fs.writeFile(file, JSON.stringify(company, null, /\n {2}/.test(await fs.readFile(file, "utf-8").catch(() => "")) ? 2 : 0));

  return {
    brand:        entry.slug,
    target:       targetSlug,
    routed_via,
    status:       "merged",
    actions:      entry.total_fed_actions,
    actions5y:    entry.total_fed_actions_5y,
    penalties:    entry.total_penalties_dollars,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("Fed Reserve merge starting...");

  const fed = JSON.parse(await fs.readFile(FED_FILE, "utf-8"));
  const entries = fed.brands || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged  = results.filter((r) => r.status === "merged");
  const skipped = results.filter((r) => r.status === "skipped");
  const orphans = results.filter((r) => r.status === "orphan");
  const errors  = results.filter((r) => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:      now,
    source_file:    "public/data/fed-reserve-enforcement.json",
    csv_row_count:  fed.csv_row_count,
    total_brands:   entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    orphans:        orphans.map((o) => o.brand),
    top_by_actions: merged
      .slice()
      .sort((a, b) => b.actions - a.actions)
      .slice(0, 20)
      .map((m) => ({
        brand:     m.brand,
        target:    m.target,
        actions:   m.actions,
        actions5y: m.actions5y,
        penalties: m.penalties,
      })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no actions): ${skipped.length}`);
  console.log(`   Orphan slugs:         ${orphans.length}`);
  console.log(`   Parse errors:         ${errors.length}`);
}

main().catch((err) => {
  console.error("fed-reserve-merge failed:", err);
  process.exit(1);
});
