#!/usr/bin/env node
/**
 * FDIC enforcement merge — Step 2.
 *
 * Reads /public/data/fdic-enforcement.json (produced weekly by fdic-fetch.mjs)
 * and writes the structured data into `enriched.fdic` on each matching
 * company JSON.
 *
 * Target schema (enriched.fdic on each company file):
 *   {
 *     bankCertNumbers:           [12345, ...],
 *     bankNames:                 [{ cert, name, state, active, bkclass }],
 *     totalOrders5y:             number,
 *     totalCivilMoneyPenaltyUsd: number,
 *     sampleActions:             [{ id, date, party, type, civil_money_penalty_usd, url }],
 *     lastUpdated:               ISO timestamp,
 *     source:                    "fdic-edos",
 *     sourceUrl:                 "https://orders.fdic.gov",
 *     edosStatus:                "ok" | "edos_unreachable",
 *     edosError?:                string,
 *   }
 *
 * Honors slug-aliases.json + brand-parent-map.json for routing (same
 * convention as cfpb-merge.mjs).
 *
 * Locally: node scripts/fdic-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FDIC_FILE = path.join(ROOT, "public/data/fdic-enforcement.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(META_DIR, "fdic-merge-log.json");

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
  // We merge when we have actionable data — either real EDOS results,
  // or just the BankFind CERT mapping (so the company file reflects
  // that we did look and what we found). Skip pure "no_bank_found".
  if (entry.status === "no_bank_found" || entry.status === "bankfind_error") {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }

  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.fdic = {
    bankCertNumbers:           entry.bank_cert_numbers || [],
    bankNames:                 entry.bank_names || [],
    totalOrders5y:             entry.total_orders_5y ?? null,
    totalCivilMoneyPenaltyUsd: entry.total_civil_money_penalties_usd ?? null,
    sampleActions:             entry.sample_actions || [],
    lastUpdated:               now,
    source:                    "fdic-edos",
    sourceUrl:                 "https://orders.fdic.gov",
    edosStatus:                entry.status,
    ...(entry.edos_error ? { edosError: entry.edos_error } : {}),
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.fdic = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           entry.slug,
    target:          targetSlug,
    routed_via,
    status:          entry.status === "ok" ? "merged" : "merged_partial",
    totalOrders5y:   entry.total_orders_5y ?? null,
    edosStatus:      entry.status,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("FDIC merge starting...");

  const fdic = JSON.parse(await fs.readFile(FDIC_FILE, "utf-8"));
  const entries = fdic.actions || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged        = results.filter(r => r.status === "merged");
  const mergedPartial = results.filter(r => r.status === "merged_partial");
  const skipped       = results.filter(r => r.status === "skipped");
  const orphans       = results.filter(r => r.status === "orphan");
  const errors        = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:               now,
    source_file:             "public/data/fdic-enforcement.json",
    total_brands:            entries.length,
    merged_count:            merged.length,
    merged_partial_count:    mergedPartial.length,
    skipped_count:           skipped.length,
    orphan_count:            orphans.length,
    error_count:             errors.length,
    orphans:                 orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged (with orders):  ${merged.length}`);
  console.log(`Merged (CERT only):    ${mergedPartial.length}`);
  console.log(`Skipped (no bank):     ${skipped.length}`);
  console.log(`Orphan slugs:          ${orphans.length}`);
}

main().catch(err => {
  console.error("fdic-merge failed:", err);
  process.exit(1);
});
