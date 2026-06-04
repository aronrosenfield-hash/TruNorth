#!/usr/bin/env node
/**
 * DOJ ATR merge — writes enriched.dojAtr into each matching company file.
 *
 * Reads /public/data/doj-atr.json (produced monthly by doj-atr-fetch.mjs)
 * and writes a structured `dojAtr` block under `enriched` per company.
 *
 * Target schema (under company.enriched.dojAtr):
 *   {
 *     totalMattersLifetime: number,
 *     recent24mo:           number,
 *     topCaseTypes: [
 *       { type, count }
 *     ],
 *     sampleMatters: [
 *       { date, type, kind, name, url }
 *     ],
 *     lastUpdated: ISO timestamp,
 *     source:      "doj-atr",
 *     sourceUrl:   "https://www.justice.gov/atr/case-document"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no matters. When multiple source brands route to the same target
 * (parent-rollup), counts and sample_matters are accumulated.
 *
 * Locally: node scripts/doj-atr-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ATR_FILE = path.join(ROOT, "public/data/doj-atr.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "doj-atr-merge-log.json");

const SOURCE_URL = "https://www.justice.gov/atr/case-document";

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

function mergeTypeCounts(a, b) {
  const map = new Map();
  for (const t of a || []) map.set(t.type, (map.get(t.type) || 0) + t.count);
  for (const t of b || []) map.set(t.type, (map.get(t.type) || 0) + t.count);
  return [...map.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([type, count]) => ({ type, count }));
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

  const incoming = {
    totalMattersLifetime: entry.total_antitrust_matters_lifetime || 0,
    recent24mo:           entry.recent_24mo || 0,
    topCaseTypes:         (entry.top_case_types || []).map(t => ({ type: t.type, count: t.count })),
    sampleMatters: (entry.sample_matters || []).map(a => ({
      date: a.date,
      type: a.type,
      kind: a.kind,
      name: a.name,
      url:  a.url,
    })),
    lastUpdated: now,
    source:      "doj-atr",
    sourceUrl:   SOURCE_URL,
  };

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
  const prev = company.enriched.dojAtr;
  if (prev && prev.lastUpdated === now) {
    // Same-run accumulation across parent-rollups.
    const seen = new Set(prev.sampleMatters.map(a => a.url));
    const merged = prev.sampleMatters.slice();
    for (const a of incoming.sampleMatters) {
      if (!seen.has(a.url)) { merged.push(a); seen.add(a.url); }
    }
    merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    company.enriched.dojAtr = {
      totalMattersLifetime: prev.totalMattersLifetime + incoming.totalMattersLifetime,
      recent24mo:           prev.recent24mo + incoming.recent24mo,
      topCaseTypes:         mergeTypeCounts(prev.topCaseTypes, incoming.topCaseTypes),
      sampleMatters:        merged.slice(0, 5),
      lastUpdated:          now,
      source:               "doj-atr",
      sourceUrl:            SOURCE_URL,
    };
  } else {
    company.enriched.dojAtr = incoming;
  }

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.dojAtr = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:      entry.slug,
    target:     targetSlug,
    routed_via,
    status:     "merged",
    matters:    entry.total_antitrust_matters_lifetime,
    recent24mo: entry.recent_24mo,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("DOJ ATR merge starting…");

  const doc = JSON.parse(await fs.readFile(ATR_FILE, "utf-8"));
  const entries = doc.matters || [];
  console.log(`${entries.length} brand entries (${doc.brands_with_matters} with hits)`);

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
    source_file:      "public/data/doj-atr.json",
    generated_at:     doc.generated_at,
    cases_scanned:    doc.cases_scanned,
    total_brands:     entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => o.brand),
    total_matters:    merged.reduce((s, r) => s + (r.matters || 0), 0),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`  Skipped (no matters): ${skipped.length}`);
  console.log(`  Orphan slugs:         ${orphans.length}`);
  console.log(`  Parse errors:         ${errors.length}`);
}

main().catch(err => {
  console.error("doj-atr-merge failed:", err);
  process.exit(1);
});
