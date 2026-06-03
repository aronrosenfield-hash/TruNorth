#!/usr/bin/env node
/**
 * NHTSA merger — Step 2.
 *
 * Reads /public/data/nhtsa-auto.json (produced weekly by nhtsa-fetch.mjs)
 * and writes the structured `nhtsa` field into each matching company file
 * so the detail-panel UI in src/App.jsx can render it.
 *
 * Target schema on each company (top-level `nhtsa`):
 *   nhtsa: {
 *     totalRecalls:           number,
 *     totalComplaints:        number,
 *     openInvestigationsCount: number,
 *     openInvestigationsNote: string,
 *     topIssues:              [{ label, count }],
 *     mostRecentRecallDate:   "YYYY-MM-DD" | null,
 *     sampleRecentRecalls:    [{ campaign, date, component, summary,
 *                                consequence, remedy, modelYear, model,
 *                                parkIt, parkOutside, overTheAirUpdate }],
 *     yearsCovered:           [Y, Y-1, Y-2, Y-3, Y-4],
 *     lastUpdated:            ISO timestamp,
 *     source:                 "nhtsa",
 *     sourceUrl:              "https://www.nhtsa.gov/recalls?...",
 *   }
 *
 * The field is intentionally named `nhtsa` (not `recalls`) so it does not
 * collide with the legacy `enriched.recalls` field already rendered in the
 * detail panel.
 *
 * Honors slug-aliases + brand-parent-map for routing (same pattern as
 * cfpb-merge.mjs / lawsuits-merge.mjs). Skips brands with no NHTSA data.
 *
 * Locally: node scripts/nhtsa-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NHTSA_FILE = path.join(ROOT, "public/data/nhtsa-auto.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/nhtsa-merge-log.json");

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
  // Common automotive fallbacks: try "-usa", "-motor" suffixes
  for (const suffix of ["-usa", "-motor", "-motors"]) {
    if (existsSync(path.join(COMP_DIR, `${slug}${suffix}.json`))) {
      return { slug: `${slug}${suffix}`, routed_via: `suffix:${suffix}` };
    }
  }
  return { slug: null, routed_via: "orphan" };
}

function buildNhtsaField(entry, now) {
  const sourceUrl = `https://www.nhtsa.gov/recalls?nhtsaId=&make=${encodeURIComponent(entry.nhtsa_make || entry.name)}`;
  return {
    totalRecalls:            entry.total_recalls,
    totalComplaints:         entry.total_complaints,
    openInvestigationsCount: entry.open_investigations_count ?? 0,
    openInvestigationsNote:  entry.open_investigations_note || null,
    topIssues:               entry.top_issues || [],
    mostRecentRecallDate:    entry.most_recent_recall_date || null,
    sampleRecentRecalls:     entry.sample_recent_recalls || [],
    yearsCovered:            entry.years_covered || [],
    modelsSeen:              entry.models_seen ?? null,
    lastUpdated:             now,
    source:                  "nhtsa",
    sourceUrl,
  };
}

async function mergeOne(entry, maps, now) {
  if (entry.status !== "ok") {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.nhtsa = buildNhtsaField(entry, now);

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.nhtsa = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           entry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    totalRecalls:    entry.total_recalls,
    totalComplaints: entry.total_complaints,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("NHTSA merge starting…");

  const nhtsa = JSON.parse(await fs.readFile(NHTSA_FILE, "utf-8"));
  const entries = nhtsa.brands || [];
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
    source_file:   "public/data/nhtsa-auto.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged:        merged.map(m => ({ brand: m.brand, target: m.target, routed_via: m.routed_via, totalRecalls: m.totalRecalls, totalComplaints: m.totalComplaints })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`  Skipped (no data): ${skipped.length}`);
  console.log(`  Orphan slugs:      ${orphans.length}`);
  if (orphans.length) console.log(`  Orphans: ${orphans.map(o => o.brand).join(", ")}`);
}

main().catch(err => {
  console.error("nhtsa-merge failed:", err);
  process.exit(1);
});
