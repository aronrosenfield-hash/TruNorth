#!/usr/bin/env node
/**
 * PHMSA — Step 2: Merge phmsa-incidents.json into per-company JSON.
 *
 * Reads /public/data/phmsa-incidents.json (produced weekly by phmsa-fetch.mjs)
 * and writes the structured `phmsa` field into each matching company file.
 *
 * Target schema (per company JSON):
 *   phmsa: {
 *     totalEnforcementActions:      number,
 *     recent24moActions:            number,
 *     incidentLinkedActions:        number,
 *     fatalitiesTotal:              number | null,
 *     injuriesTotal:                number | null,
 *     proposedPenaltiesTotalUsd:    number,
 *     assessedPenaltiesTotalUsd:    number,
 *     collectedPenaltiesTotalUsd:   number,
 *     totalDamageUsd:               number | null,
 *     sampleIncidents:              [...up to 5],
 *     matchedOperatorNames:         [...],
 *     dataLimited:                  true,
 *     dataLimitedReason:            string,
 *     lastUpdated:                  ISO,
 *     source:                       "phmsa",
 *     sourceUrl:                    string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with no
 * records — those would be junk on non-pipeline brands.
 *
 * Locally: node scripts/phmsa-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PHMSA_FILE = path.join(ROOT, "public/data/phmsa-incidents.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/phmsa-merge-log.json");

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

  const sourceUrl = `https://primis.phmsa.dot.gov/enforcement-data/operators?search=${encodeURIComponent(brandEntry.name)}`;

  company.phmsa = {
    totalEnforcementActions:    brandEntry.total_enforcement_actions,
    recent24moActions:          brandEntry.recent_24mo_actions,
    incidentLinkedActions:      brandEntry.incident_linked_actions,
    fatalitiesTotal:            brandEntry.fatalities_total,
    injuriesTotal:              brandEntry.injuries_total,
    proposedPenaltiesTotalUsd:  brandEntry.proposed_penalties_total_usd,
    assessedPenaltiesTotalUsd:  brandEntry.assessed_penalties_total_usd,
    collectedPenaltiesTotalUsd: brandEntry.collected_penalties_total_usd,
    totalDamageUsd:             brandEntry.total_damage_usd,
    sampleIncidents:            brandEntry.sample_incidents,
    matchedOperatorNames:       brandEntry.matched_operator_names,
    dataLimited:                brandEntry.data_limited === true,
    dataLimitedReason:          brandEntry.data_limited_reason || null,
    lastUpdated:                now,
    source:                     "phmsa",
    sourceUrl,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.phmsa = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:                  brandEntry.slug,
    target:                 targetSlug,
    routed_via,
    status:                 "merged",
    totalEnforcementActions: brandEntry.total_enforcement_actions,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("PHMSA merge starting...");

  const phmsa = JSON.parse(await fs.readFile(PHMSA_FILE, "utf-8"));
  const entries = phmsa.incidents || [];
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
  await fs.writeFile(
    LOG_FILE,
    JSON.stringify(
      {
        merged_at:     now,
        source_file:   "public/data/phmsa-incidents.json",
        total_brands:  entries.length,
        merged_count:  merged.length,
        skipped_count: skipped.length,
        orphan_count:  orphans.length,
        error_count:   errors.length,
        orphans:       orphans.map((o) => o.brand),
      },
      null,
      2,
    ),
  );

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no records): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  console.log(`   Errors: ${errors.length}`);
}

main().catch((err) => {
  console.error("phmsa-merge failed:", err);
  process.exit(1);
});
