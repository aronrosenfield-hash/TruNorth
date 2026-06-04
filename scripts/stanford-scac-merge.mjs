#!/usr/bin/env node
/**
 * Stanford SCAC — Step 2: Merge stanford-scac.json into per-company JSON.
 *
 * Reads /public/data/stanford-scac.json (produced monthly by
 * stanford-scac-fetch.mjs) and writes the structured `stanfordScac` field
 * into each matching company file.
 *
 * Target schema:
 *   stanfordScac: {
 *     totalClassActionsLifetime: number,
 *     recent24mo:                number,
 *     totalSettlementValueUsd:   number | null,
 *     latestFilingDate:          ISO string | null,
 *     sampleActions:             [{ filingName, date, court, exchange,
 *                                   ticker, caseId, url }],
 *     lastUpdated:               ISO string,
 *     source:                    "stanford-securities-class-action-clearinghouse",
 *     sourceUrl:                 "https://securities.stanford.edu/filings.html"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips brands with
 * status !== "ok" (no_actions / error).
 *
 * Locally: node scripts/stanford-scac-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCAC_FILE = path.join(ROOT, "public/data/stanford-scac.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/stanford-scac-merge-log.json");

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

  company.stanfordScac = {
    totalClassActionsLifetime: entry.total_class_actions_lifetime ?? 0,
    recent24mo:                entry.recent_24mo ?? 0,
    totalSettlementValueUsd:   entry.total_settlement_value_usd ?? null,
    latestFilingDate:          entry.latest_filing_date ?? null,
    sampleActions:             (entry.sample_actions || []).map(a => ({
      filingName: a.filing_name,
      date:       a.date,
      court:      a.court,
      exchange:   a.exchange,
      ticker:     a.ticker,
      caseId:     a.case_id,
      url:        a.url,
    })),
    lastUpdated: now,
    source:      "stanford-securities-class-action-clearinghouse",
    sourceUrl:   "https://securities.stanford.edu/filings.html",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.stanfordScac = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:                     entry.slug,
    target:                    targetSlug,
    routed_via,
    status:                    "merged",
    totalClassActionsLifetime: entry.total_class_actions_lifetime ?? 0,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("Stanford SCAC merge starting…");

  const scac = JSON.parse(await fs.readFile(SCAC_FILE, "utf-8"));
  const entries = scac.filings || [];
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
    source_file:   "public/data/stanford-scac.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged:        merged.map(m => ({ brand: m.brand, target: m.target, routed_via: m.routed_via, totalClassActionsLifetime: m.totalClassActionsLifetime })),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Orphans: ${orphans.length}`);
  console.log(`Errors:  ${errors.length}`);
}

main().catch(err => {
  console.error("stanford-scac-merge failed:", err);
  process.exit(1);
});
