#!/usr/bin/env node
/**
 * EU DG Competition antitrust merge — writes the `euAntitrust` field
 * into each matching company JSON under `enriched`.
 *
 * Reads /public/data/eu-antitrust.json (produced monthly by
 * eu-antitrust-fetch.mjs) and writes the structured field per brand.
 *
 * Target schema:
 *   enriched.euAntitrust: {
 *     totalActionsLifetime:   number,
 *     totalFinesEur:          number,
 *     sampleDecisions:        [...up to 5],
 *     lastUpdated:            ISO,
 *     source:                 "eu-dg-comp",
 *     sourceUrl:              string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map (same pattern as
 * fed-reserve-merge.mjs, occ-merge.mjs). Skips entries with no actions.
 *
 * Locally: node scripts/eu-antitrust-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/eu-antitrust.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/eu-antitrust-merge-log.json");

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
  if (entry.status !== "ok" || !entry.total_EU_antitrust_actions_lifetime) {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.euAntitrust = {
    totalActionsLifetime: entry.total_EU_antitrust_actions_lifetime,
    totalFinesEur:        entry.total_fines_eur,
    sampleDecisions:      entry.sample_decisions,
    lastUpdated:          now,
    source:               "eu-dg-comp",
    sourceUrl:            entry.source_url,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.euAntitrust = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:     entry.slug,
    target:    targetSlug,
    routed_via,
    status:    "merged",
    actions:   entry.total_EU_antitrust_actions_lifetime,
    fines_eur: entry.total_fines_eur,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("EU DG Comp antitrust merge starting...");

  const src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8"));
  const entries = src.brands || [];
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
    merged_at:         now,
    source_file:       "public/data/eu-antitrust.json",
    decisions_scanned: src.decisions_scanned,
    total_brands:      entries.length,
    merged_count:      merged.length,
    skipped_count:     skipped.length,
    orphan_count:      orphans.length,
    error_count:       errors.length,
    orphans:           orphans.map((o) => o.brand),
    top_by_fines:      merged
      .slice()
      .sort((a, b) => (b.fines_eur || 0) - (a.fines_eur || 0))
      .slice(0, 20)
      .map((m) => ({
        brand:     m.brand,
        target:    m.target,
        actions:   m.actions,
        fines_eur: m.fines_eur,
      })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no actions): ${skipped.length}`);
  console.log(`   Orphan slugs:         ${orphans.length}`);
  console.log(`   Parse errors:         ${errors.length}`);
}

main().catch((err) => {
  console.error("eu-antitrust-merge failed:", err);
  process.exit(1);
});
