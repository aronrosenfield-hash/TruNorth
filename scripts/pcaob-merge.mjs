#!/usr/bin/env node
/**
 * PCAOB enforcement — Step 2: Merge pcaob-enforcement.json into per-company JSON.
 *
 * Reads /public/data/pcaob-enforcement.json (produced monthly by pcaob-fetch.mjs)
 * and writes the structured `pcaob` field into each matching company file.
 *
 * Target schema:
 *   pcaob: {
 *     totalActionsLifetime:  number,
 *     totalFinesUsd:         number | null,
 *     latestActionDate:      ISO string | null,
 *     sampleActions:         [{ title, date, orderType, firmId, pdfUrl }],
 *     lastUpdated:           ISO string,
 *     source:                "pcaob-enforcement-actions",
 *     sourceUrl:             "https://pcaobus.org/oversight/enforcement/enforcement-actions"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips firms with
 * status !== "ok" (no_actions / error).
 *
 * Locally: node scripts/pcaob-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PCAOB_FILE = path.join(ROOT, "public/data/pcaob-enforcement.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(ROOT, "public/data/_meta/pcaob-merge-log.json");

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

  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { brand: entry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.pcaob = {
    totalActionsLifetime: entry.total_PCAOB_actions_lifetime ?? 0,
    totalFinesUsd:        entry.total_fines_usd ?? null,
    latestActionDate:     entry.latest_action_date ?? null,
    sampleActions:        (entry.sample_actions || []).map(a => ({
      title:     a.title,
      date:      a.date,
      orderType: a.order_type,
      firmId:    a.firm_id,
      pdfUrl:    a.pdf_url,
    })),
    lastUpdated: now,
    source:      "pcaob-enforcement-actions",
    sourceUrl:   "https://pcaobus.org/oversight/enforcement/enforcement-actions",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.pcaob = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:                entry.slug,
    target:               targetSlug,
    routed_via,
    status:               "merged",
    totalActionsLifetime: entry.total_PCAOB_actions_lifetime ?? 0,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("PCAOB merge starting…");

  const pcaob = JSON.parse(await fs.readFile(PCAOB_FILE, "utf-8"));
  const entries = pcaob.firms || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) results.push(await mergeOne(e, maps, now));

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:     now,
    source_file:   "public/data/pcaob-enforcement.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged:        merged.map(m => ({ brand: m.brand, target: m.target, routed_via: m.routed_via, totalActionsLifetime: m.totalActionsLifetime })),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Orphans: ${orphans.length}`);
  console.log(`Errors:  ${errors.length}`);
}

main().catch(err => {
  console.error("pcaob-merge failed:", err);
  process.exit(1);
});
