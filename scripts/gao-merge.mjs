#!/usr/bin/env node
/**
 * GAO reports — Step 2: Merge gao-reports.json into per-company JSON.
 *
 * Reads /public/data/gao-reports.json (produced monthly by gao-fetch.mjs)
 * and writes the structured `gao` field into each matching company file.
 *
 * Target schema:
 *   gao: {
 *     totalReports5y:    number,
 *     totalBidProtests:  number,
 *     topTopics:         [{ topic, count }],
 *     sampleReports:     [{ title, url, date, gaoId, type, topics, snippet }],
 *     lastUpdated:       ISO string,
 *     source:            "gao-reports-testimonies",
 *     sourceUrl:         "https://www.gao.gov/reports-testimonies"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips brands with
 * status !== "ok" (no_match / error).
 *
 * Locally: node scripts/gao-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAO_FILE = path.join(ROOT, "public/data/gao-reports.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/gao-merge-log.json");

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

  company.gao = {
    totalReports5y:   entry.total_GAO_reports_5y ?? 0,
    totalBidProtests: entry.total_bid_protests ?? 0,
    topTopics:        entry.top_topics || [],
    sampleReports:    (entry.sample_reports || []).map(r => ({
      title:   r.title,
      url:     r.url,
      date:    r.date,
      gaoId:   r.gao_id,
      type:    r.type,
      topics:  r.topics,
      snippet: r.snippet,
    })),
    lastUpdated: now,
    source:      "gao-reports-testimonies",
    sourceUrl:   "https://www.gao.gov/reports-testimonies",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.gao = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:            entry.slug,
    target:           targetSlug,
    routed_via,
    status:           "merged",
    totalReports5y:   entry.total_GAO_reports_5y ?? 0,
    totalBidProtests: entry.total_bid_protests ?? 0,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("GAO merge starting…");

  const gao = JSON.parse(await fs.readFile(GAO_FILE, "utf-8"));
  const entries = gao.reports || [];
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
    source_file:   "public/data/gao-reports.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged:        merged.map(m => ({
      brand: m.brand, target: m.target, routed_via: m.routed_via,
      totalReports5y: m.totalReports5y, totalBidProtests: m.totalBidProtests,
    })),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Orphans: ${orphans.length}`);
  console.log(`Errors:  ${errors.length}`);
}

main().catch(err => {
  console.error("gao-merge failed:", err);
  process.exit(1);
});
