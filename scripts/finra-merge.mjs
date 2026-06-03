#!/usr/bin/env node
/**
 * FINRA BrokerCheck — Step 2: Merge finra-disclosures.json into per-company JSON.
 *
 * Reads /public/data/finra-disclosures.json (produced weekly by finra-fetch.mjs)
 * and writes the structured `finra` field into each matching company file.
 *
 * Target schema:
 *   finra: {
 *     firmId:                     string,
 *     firmName:                   string,
 *     isBrokerDealer:             boolean,
 *     totalDisclosures:           number,
 *     totalRegulatoryEvents:      number,
 *     totalCivilEvents:           number,
 *     totalArbitrations:          number,
 *     totalDisciplinaryActions5y: number | null,
 *     totalFinesUsd:              number | null,
 *     sampleActions:              [{ label, url, description }],
 *     brokercheckUrl:             string,
 *     lastUpdated:                ISO string,
 *     source:                     "finra-brokercheck",
 *     sourceUrl:                  string
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips firms with
 * status !== "ok" (not_found / no_disclosures / error) — non-broker-dealers
 * generate no signal and would clutter the UI.
 *
 * Locally: node scripts/finra-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FINRA_FILE = path.join(ROOT, "public/data/finra-disclosures.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/finra-merge-log.json");

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
  // Skip everything except firms with at least one disclosure on file.
  // "no_disclosures" (clean record) is also worth recording for broker-dealers,
  // but only if we matched a real BD firm — non-BD slugs (e.g. Coca-Cola)
  // never show up here because they don't match the BrokerCheck search.
  if (entry.status !== "ok" && entry.status !== "no_disclosures") {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  // For "no_disclosures", only merge if it's actually a broker-dealer.
  if (entry.status === "no_disclosures" && !entry.is_broker_dealer) {
    return { brand: entry.slug, status: "skipped", reason: "not_a_broker_dealer" };
  }

  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.finra = {
    firmId:                     entry.firm_id,
    firmName:                   entry.firm_name,
    isBrokerDealer:             Boolean(entry.is_broker_dealer),
    totalDisclosures:           entry.total_disclosures ?? 0,
    totalRegulatoryEvents:      entry.total_regulatory_events ?? 0,
    totalCivilEvents:           entry.total_civil_events ?? 0,
    totalArbitrations:          entry.total_arbitrations ?? 0,
    totalDisciplinaryActions5y: entry.total_disciplinary_actions_5y ?? null,
    totalFinesUsd:              entry.total_fines_usd ?? null,
    sampleActions:              entry.sample_actions || [],
    brokercheckUrl:             entry.brokercheck_url || `https://brokercheck.finra.org/firm/summary/${encodeURIComponent(entry.firm_id)}`,
    lastUpdated:                now,
    source:                     "finra-brokercheck",
    sourceUrl:                  entry.brokercheck_url || `https://brokercheck.finra.org/firm/summary/${encodeURIComponent(entry.firm_id)}`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.finra = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:            entry.slug,
    target:           targetSlug,
    routed_via,
    status:           "merged",
    totalDisclosures: entry.total_disclosures ?? 0,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("FINRA merge starting…");

  const finra = JSON.parse(await fs.readFile(FINRA_FILE, "utf-8"));
  const entries = finra.firms || [];
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
    source_file:   "public/data/finra-disclosures.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged:        merged.map(m => ({ brand: m.brand, target: m.target, routed_via: m.routed_via, totalDisclosures: m.totalDisclosures })),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Orphans: ${orphans.length}`);
  console.log(`Errors:  ${errors.length}`);
}

main().catch(err => {
  console.error("finra-merge failed:", err);
  process.exit(1);
});
