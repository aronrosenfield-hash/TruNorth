#!/usr/bin/env node
/**
 * DOJ FCPA merge — writes enriched.dojFcpa into each matching company file.
 *
 * Reads /public/data/doj-fcpa.json (produced monthly by doj-fcpa-fetch.mjs)
 * and writes a structured `dojFcpa` block under `enriched` per company.
 *
 * Target schema (under company.enriched.dojFcpa):
 *   {
 *     totalActionsLifetime: number,
 *     totalFinesUsd:        number,
 *     sampleActions: [
 *       { date, type, allegation, fineUsd, url }
 *     ],
 *     lastUpdated: ISO timestamp,
 *     source:      "doj-fcpa",
 *     sourceUrl:   "https://www.justice.gov/criminal/criminal-fraud/foreign-corrupt-practices-act"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no actions.
 *
 * Locally: node scripts/doj-fcpa-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FCPA_FILE = path.join(ROOT, "public/data/doj-fcpa.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(META_DIR, "doj-fcpa-merge-log.json");

const SOURCE_URL = "https://www.justice.gov/criminal/criminal-fraud/foreign-corrupt-practices-act";

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

  // Build sampleActions; if multiple source brands route to the same
  // target (e.g. brand-parent rollup), accumulate.
  const incoming = {
    totalActionsLifetime: entry.total_FCPA_actions_lifetime || 0,
    totalFinesUsd:        entry.total_fines_usd || 0,
    sampleActions: (entry.sample_actions || []).map(a => ({
      date:       a.date,
      type:       a.type,
      allegation: a.allegation,
      fineUsd:    a.fine_usd || 0,
      url:        a.url,
    })),
    lastUpdated: now,
    source:      "doj-fcpa",
    sourceUrl:   SOURCE_URL,
  };

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
  const prev = company.enriched.dojFcpa;
  if (prev && prev.lastUpdated === now) {
    // Already written this run (e.g. duplicate brand-parent routing) → sum.
    const seen = new Set(prev.sampleActions.map(a => a.url));
    const merged = prev.sampleActions.slice();
    for (const a of incoming.sampleActions) {
      if (!seen.has(a.url)) { merged.push(a); seen.add(a.url); }
    }
    merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    company.enriched.dojFcpa = {
      totalActionsLifetime: prev.totalActionsLifetime + incoming.totalActionsLifetime,
      totalFinesUsd:        prev.totalFinesUsd + incoming.totalFinesUsd,
      sampleActions:        merged.slice(0, 5),
      lastUpdated:          now,
      source:               "doj-fcpa",
      sourceUrl:            SOURCE_URL,
    };
  } else {
    company.enriched.dojFcpa = incoming;
  }

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.dojFcpa = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:    entry.slug,
    target:   targetSlug,
    routed_via,
    status:   "merged",
    actions:  entry.total_FCPA_actions_lifetime,
    fines:    entry.total_fines_usd,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("DOJ FCPA merge starting…");

  const doc = JSON.parse(await fs.readFile(FCPA_FILE, "utf-8"));
  const entries = doc.actions || [];
  console.log(`${entries.length} brand entries (${doc.brands_with_actions} with hits)`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/doj-fcpa.json",
    generated_at:     doc.generated_at,
    cases_scanned:    doc.cases_scanned,
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    total_fines_usd:  merged.reduce((s, r) => s + (r.fines || 0), 0),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`  Skipped (no actions): ${skipped.length}`);
  console.log(`  Orphan slugs:         ${orphans.length}`);
  console.log(`  Parse errors:         ${errors.length}`);
}

main().catch(err => {
  console.error("doj-fcpa-merge failed:", err);
  process.exit(1);
});
