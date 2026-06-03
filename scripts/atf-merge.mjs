#!/usr/bin/env node
/**
 * ATF — Step 2: merge atf-firearms.json into per-company JSON.
 *
 * Reads /public/data/atf-firearms.json (produced monthly by atf-fetch.mjs)
 * and writes the structured `atf` field into each matching company file.
 *
 * Target schema:
 *   atf: {
 *     totalInspectionViolations5y: number,
 *     topViolationTypes:           [{ label, count }],
 *     licenseRevocations5y:        number,
 *     industryTotals5y:            { inspections_conducted, warning_letters, ... },
 *     industryShareBasis:          string,
 *     sample:                      [...],
 *     lastUpdated:                 ISO string,
 *     source:                      "atf",
 *     sourceUrl:                   "https://www.atf.gov/firearms/firearms-industry"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips brands marked
 * `not_in_atf_universe` (the vast majority of TruNorth's catalog).
 *
 * Locally: node scripts/atf-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ATF_FILE = path.join(ROOT, "public/data/atf-firearms.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/atf-merge-log.json");

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

  company.atf = {
    totalInspectionViolations5y: brandEntry.total_inspection_violations_5y,
    topViolationTypes:           brandEntry.top_violation_types,
    licenseRevocations5y:        brandEntry.license_revocations_5y,
    industryTotals5y:            brandEntry.industry_totals_5y,
    industryShareBasis:          brandEntry.industry_share_basis,
    sample:                      brandEntry.sample,
    lastUpdated:                 now,
    source:                      "atf",
    sourceUrl:                   "https://www.atf.gov/firearms/firearms-industry",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.atf = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:                       brandEntry.slug,
    target:                      targetSlug,
    routed_via,
    status:                      "merged",
    totalInspectionViolations5y: brandEntry.total_inspection_violations_5y,
    licenseRevocations5y:        brandEntry.license_revocations_5y,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("ATF merge starting...");

  const atf = JSON.parse(await fs.readFile(ATF_FILE, "utf-8"));
  const entries = atf.brands || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) results.push(await mergeOne(e, maps, now));

  const merged  = results.filter((r) => r.status === "merged");
  const skipped = results.filter((r) => r.status === "skipped");
  const orphans = results.filter((r) => r.status === "orphan");
  const errors  = results.filter((r) => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:     now,
    source_file:   "public/data/atf-firearms.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map((o) => o.brand),
    merged:        merged.map((m) => ({
      brand: m.brand, target: m.target, routed_via: m.routed_via,
      revocations: m.licenseRevocations5y, violations: m.totalInspectionViolations5y,
    })),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length} (not_in_atf_universe + errors)`);
  console.log(`Orphans: ${orphans.length}`);
}

main().catch((err) => {
  console.error("atf-merge failed:", err);
  process.exit(1);
});
