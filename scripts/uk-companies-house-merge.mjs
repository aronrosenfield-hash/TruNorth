#!/usr/bin/env node
/**
 * Step 2 — Merge uk-companies-house.json into per-company JSON.
 *
 * Reads /public/data/uk-companies-house.json (produced quarterly by
 * uk-companies-house-fetch.mjs) and writes a structured `ukOwnership`
 * field into each matching company file under enriched.ukOwnership.
 * Honors slug-aliases.json + brand-parent-map.json for routing.
 *
 * Target schema (only set when status === "ok" or "ok_dry"):
 *   enriched.ukOwnership: {
 *     companyNumber:           string,    // CH number (zero-padded, can be SC###/RC### for UK regions)
 *     incorporated:            string,    // ISO date — date_of_creation
 *     status:                  string,    // active / dissolved / liquidation / ...
 *     companyType:             string,    // plc / ltd / royal-charter / ...
 *     sicCodes:                string[],  // Standard Industrial Classification codes
 *     officers:                [{ name, role, appointed }],
 *     latestFilingDate:        string,    // ISO date
 *     latestFilingDescription: string,
 *     registeredOfficeAddress: string,
 *     sourceUrl:               string,
 *     lastUpdated:             ISO string,
 *     source:                  "uk-companies-house"
 *   }
 *
 * Modes:
 *   --dry      (default) — read input, resolve targets, log what WOULD be
 *                          merged, but do NOT modify per-company JSON.
 *   --write    — actually persist changes.
 *
 * If the input file is itself a dry-run synth (mode === "dry-run-synth"),
 * --write is rejected to prevent polluting production data.
 *
 * Locally: node scripts/uk-companies-house-merge.mjs           # DRY-RUN
 *          node scripts/uk-companies-house-merge.mjs --write   # persist
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CH_FILE = path.join(ROOT, "public/data/uk-companies-house.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/uk-companies-house-merge-log.json");

const argv = new Set(process.argv.slice(2));
const WRITE = argv.has("--write");
const DRY = !WRITE;

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

async function mergeOne(entry, maps, now, write) {
  if (entry.status !== "ok" && entry.status !== "ok_dry") {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  const ukOwnership = {
    companyNumber:           entry.company_number,
    incorporated:            entry.incorporated || null,
    status:                  entry.company_status || null,
    companyType:             entry.company_type || null,
    sicCodes:                entry.sic_codes || [],
    officers:                entry.officers || [],
    latestFilingDate:        entry.latest_filing_date || null,
    latestFilingDescription: entry.latest_filing_description || null,
    registeredOfficeAddress: entry.registered_office_address || null,
    sourceUrl:               entry.source_url || null,
    lastUpdated:             now,
    source:                  "uk-companies-house",
  };

  if (write) {
    if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
    company.enriched.ukOwnership = ukOwnership;
    if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
      company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
    }
    company.dataLastUpdated.ukOwnership = now;
    await fs.writeFile(file, JSON.stringify(company));
  }

  return {
    brand:          entry.slug,
    target:         targetSlug,
    routed_via,
    status:         write ? "merged" : "merged_dry",
    company_number: entry.company_number,
    incorporated:   entry.incorporated,
    officers:       entry.officers?.length || 0,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log(`UK Companies House merge — mode: ${DRY ? "DRY-RUN (no writes)" : "WRITE"}`);

  const ch = JSON.parse(await fs.readFile(CH_FILE, "utf-8"));
  const entries = ch.companies || [];
  console.log(`${entries.length} brand entries (input mode: ${ch.mode})`);

  if (WRITE && ch.mode === "dry-run-synth") {
    console.error("ERROR: input uk-companies-house.json is a DRY-RUN synth; refusing to --write to production data.");
    console.error("Run `node scripts/uk-companies-house-fetch.mjs --live` first.");
    process.exit(1);
  }

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now, WRITE));
  }

  const merged  = results.filter(r => r.status === "merged" || r.status === "merged_dry");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:     now,
    mode:          WRITE ? "write" : "dry-run",
    input_mode:    ch.mode,
    source_file:   "public/data/uk-companies-house.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    routed_list:   merged.map(r => ({
      brand:          r.brand,
      target:         r.target,
      routed_via:     r.routed_via,
      company_number: r.company_number,
      incorporated:   r.incorporated,
      officers:       r.officers,
    })),
  }, null, 2));

  console.log(`Merged ${WRITE ? "(written)" : "(dry-run)"}: ${merged.length}`);
  console.log(`   Skipped (no input):  ${skipped.length}`);
  console.log(`   Orphan slugs:        ${orphans.length}`);
  console.log(`   Parse errors:        ${errors.length}`);
  if (orphans.length) {
    console.log(`   Orphans: ${orphans.map(o => o.brand).join(", ")}`);
  }
}

main().catch(err => {
  console.error("uk-companies-house-merge failed:", err);
  process.exit(1);
});
