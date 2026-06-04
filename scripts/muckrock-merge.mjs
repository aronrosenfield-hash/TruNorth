#!/usr/bin/env node
/**
 * MuckRock FOIA — Step 2: Merge muckrock-foia.json into per-company JSON.
 *
 * Reads /public/data/muckrock-foia.json (produced monthly by muckrock-fetch.mjs)
 * and writes the structured `muckrock` field into each matching company file.
 *
 * Target schema:
 *   muckrock: {
 *     totalRequests:     number,
 *     completedRequests: number,
 *     topTopics:         [{ label, count }],
 *     topAgencies:       [{ label, count }],
 *     topStatuses:       [{ label, count }],
 *     sampleRequests:    [{ id, title, status, date_submitted, agency_name, jurisdiction, url }],
 *     sampledCount:      number,
 *     lastUpdated:       ISO,
 *     source:            "muckrock",
 *     sourceUrl:         "https://www.muckrock.com/foi/?q=<brand>"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * zero requests — those would be empty junk on per-company pages.
 *
 * Locally: node scripts/muckrock-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MUCKROCK_FILE = path.join(ROOT, "public/data/muckrock-foia.json");
const COMP_DIR      = path.join(ROOT, "public/data/companies");
const META_DIR      = path.join(ROOT, "public/data/_meta");
const LOG_FILE      = path.join(ROOT, "public/data/_meta/muckrock-merge-log.json");

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
  if (entry.status !== "ok") {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  if (!entry.total_muckrock_requests || entry.total_muckrock_requests === 0) {
    return { brand: entry.slug, status: "skipped", reason: "zero_requests" };
  }

  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.muckrock = {
    totalRequests:     entry.total_muckrock_requests,
    completedRequests: entry.completed_requests,
    topTopics:         entry.top_topics,
    topAgencies:       entry.top_agencies,
    topStatuses:       entry.top_statuses,
    sampleRequests:    entry.sample_requests,
    sampledCount:      entry.sampled_count,
    lastUpdated:       now,
    source:            "muckrock",
    sourceUrl:         `https://www.muckrock.com/foi/?q=${encodeURIComponent(entry.name)}`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.muckrock = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:          entry.slug,
    target:         targetSlug,
    routed_via,
    status:         "merged",
    totalRequests:  entry.total_muckrock_requests,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("MuckRock merge starting...");

  const data = JSON.parse(await fs.readFile(MUCKROCK_FILE, "utf-8"));
  const entries = data.requests || [];
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
    merged_at:      now,
    source_file:    "public/data/muckrock-foia.json",
    total_brands:   entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    orphans:        orphans.map(o => o.brand),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped: ${skipped.length}`);
  console.log(`   Orphans: ${orphans.length}`);
  console.log(`   Errors:  ${errors.length}`);
}

main().catch(err => {
  console.error("muckrock-merge failed:", err);
  process.exit(1);
});
