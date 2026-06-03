#!/usr/bin/env node
/**
 * FERC enforcement merge — writes enriched.ferc into per-company JSON.
 *
 * Reads /public/data/ferc-enforcement.json (produced weekly by
 * ferc-fetch.mjs) and writes the `ferc` field into each matching company
 * file.
 *
 * Target schema:
 *   enriched.ferc: {
 *     totalEnforcementActions5y: number,
 *     totalCivilPenaltiesUsd:    number,
 *     topViolations:             [{ label, count }],
 *     sampleActions:             [{ date, caption, docket, penaltyUsd,
 *                                   violations, summary, url }],
 *     lastUpdated:               ISO,
 *     source:                    "ferc",
 *     sourceUrl:                 string
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips brands with
 * no FERC actions (status !== "ok") — most non-energy brands.
 *
 * Locally: node scripts/ferc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FERC_FILE = path.join(ROOT, "public/data/ferc-enforcement.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/ferc-merge-log.json");

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

  // The richer per-company enrichment object lives at `company.enriched`
  // in most TruNorth files; create it if missing for backward compatibility.
  if (typeof company.enriched !== "object" || company.enriched === null) {
    company.enriched = {};
  }

  company.enriched.ferc = {
    totalEnforcementActions5y:   brandEntry.total_enforcement_actions_5y,
    totalEnforcementActionsAll:  brandEntry.total_enforcement_actions_all,
    totalCivilPenaltiesUsd:      brandEntry.total_civil_penalties_usd,
    topViolations:               brandEntry.top_violations,
    sampleActions: (brandEntry.sample_actions || []).map(a => ({
      date:        a.date,
      caption:     a.caption,
      docket:      a.docket,
      penaltyUsd:  a.penalty_usd,
      violations:  a.violations,
      summary:     a.summary,
      url:         a.url,
    })),
    lastUpdated: now,
    source:      "ferc",
    sourceUrl:   "https://www.ferc.gov/enforcement-legal/enforcement/civil-penalty-actions",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.ferc = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:                  brandEntry.slug,
    target:                 targetSlug,
    routed_via,
    status:                 "merged",
    actions_5y:             brandEntry.total_enforcement_actions_5y,
    penalties_usd:          brandEntry.total_civil_penalties_usd,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("FERC merge starting...");

  const ferc = JSON.parse(await fs.readFile(FERC_FILE, "utf-8"));
  const entries = ferc.actions || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged   = results.filter(r => r.status === "merged");
  const skipped  = results.filter(r => r.status === "skipped");
  const orphans  = results.filter(r => r.status === "orphan");
  const errors   = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/ferc-enforcement.json",
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    merged_brands:    merged.map(m => ({ brand: m.brand, target: m.target, actions_5y: m.actions_5y, penalties_usd: m.penalties_usd })),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Orphans: ${orphans.length}`);
  if (errors.length) console.log(`Errors:  ${errors.length}`);
}

main().catch(err => {
  console.error("ferc-merge failed:", err);
  process.exit(1);
});
