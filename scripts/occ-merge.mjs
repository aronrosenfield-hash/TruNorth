#!/usr/bin/env node
/**
 * OCC merge — writes the `occ` field into each matching company JSON.
 *
 * Reads /public/data/occ-enforcement.json (produced weekly by occ-fetch.mjs)
 * and merges it into /public/data/companies/<slug>.json.
 *
 * Target schema:
 *   occ: {
 *     totalEnforcementActions5y:        number,
 *     totalCivilMoneyPenaltiesDollars:  number,   // all-time, the requested figure
 *     totalCivilMoneyPenalties5yDollars: number,
 *     topSubjectMatters:                [{ label, count }],
 *     topActionTypes:                   [{ label, count }],
 *     sampleActions:                    [...up to 5],
 *     lastUpdated:                      ISO ts,
 *     source:                           "occ",
 *     sourceUrl:                        OCC search URL
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no actions — those would be empty noise on non-bank brands.
 *
 * Locally: node scripts/occ-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OCC_FILE = path.join(ROOT, "public/data/occ-enforcement.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/occ-merge-log.json");

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

  company.occ = {
    totalEnforcementActions:           brandEntry.total_enforcement_actions,
    totalEnforcementActions5y:         brandEntry.total_enforcement_actions_5y,
    totalCivilMoneyPenaltiesDollars:   brandEntry.total_civil_money_penalties_dollars,
    totalCivilMoneyPenalties5yDollars: brandEntry.total_civil_money_penalties_5y_dollars,
    topSubjectMatters:                 brandEntry.top_subject_matters,
    topActionTypes:                    brandEntry.top_action_types,
    sampleActions:                     brandEntry.sample_actions,
    sampledCount:                      brandEntry.sampled_count,
    lastUpdated:                       now,
    source:                            "occ",
    sourceUrl:                         brandEntry.source_url,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.occ = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:                  brandEntry.slug,
    target:                 targetSlug,
    routed_via,
    status:                 "merged",
    totalActions:           brandEntry.total_enforcement_actions,
    totalActions5y:         brandEntry.total_enforcement_actions_5y,
    totalCMPDollars:        brandEntry.total_civil_money_penalties_dollars,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("OCC merge starting...");

  const occ = JSON.parse(await fs.readFile(OCC_FILE, "utf-8"));
  const entries = occ.actions || [];
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
    merged_at:     now,
    source_file:   "public/data/occ-enforcement.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no actions): ${skipped.length}`);
  console.log(`   Orphan slugs:         ${orphans.length}`);
}

main().catch(err => {
  console.error("occ-merge failed:", err);
  process.exit(1);
});
