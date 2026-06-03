#!/usr/bin/env node
/**
 * DOL OFCCP merge — writes enriched.dolOfccp into each matching company.
 *
 * Reads /public/data/dol-ofccp.json (produced monthly by dol-ofccp-fetch.mjs)
 * and writes a structured `dolOfccp` block into each matching company file.
 *
 * Target schema (when there are hits):
 *   dolOfccp: {
 *     totalActions5y:     number,
 *     totalBackPayUsd:    number | null,
 *     topViolationTypes:  [{ label, count }],
 *     sampleCases:        [{ title, url, date, backPayUsd, violationTypes, location, snippet }],
 *     lastUpdated:        ISO,
 *     source:             "dol-ofccp",
 *     sourceUrl:          link to OFCCP newsroom landing page
 *   }
 *
 * Honors slug-aliases + brand-parent-map. Skips entries with no actions
 * (those would just be empty noise on non-contractor brands).
 *
 * Locally: node scripts/dol-ofccp-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/dol-ofccp.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/dol-ofccp-merge-log.json");

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

  company.dolOfccp = {
    totalActions5y:     entry.total_ofccp_actions_5y,
    totalBackPayUsd:    entry.total_back_pay_owed_usd,
    topViolationTypes:  entry.top_violation_types,
    sampleCases:        (entry.sample_cases || []).map(c => ({
      title:           c.title,
      url:             c.url,
      date:            c.date,
      backPayUsd:      c.back_pay_usd,
      violationTypes:  c.violation_types,
      location:        c.location,
      snippet:         c.snippet,
    })),
    lastUpdated: now,
    source:      "dol-ofccp",
    sourceUrl:   "https://www.dol.gov/agencies/ofccp/enforcement",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.dolOfccp = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           entry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    actions5y:       entry.total_ofccp_actions_5y,
    backPayUsd:      entry.total_back_pay_owed_usd,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("⚖️  DOL OFCCP merge starting…");

  let src;
  try { src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8")); }
  catch (e) {
    console.error(`❌ Cannot read ${SRC_FILE}: ${e.message}`);
    console.error("   Did dol-ofccp-fetch.mjs run successfully first?");
    process.exit(1);
  }

  const entries = src.actions || [];
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
    merged_at:      now,
    source_file:    "public/data/dol-ofccp.json",
    total_brands:   entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    orphans:        orphans.map(o => o.brand),
    merged_sample:  merged.slice(0, 10),
  }, null, 2));

  console.log(`✅ Merged: ${merged.length}`);
  console.log(`   Skipped (no actions): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  if (errors.length) console.log(`   Errors: ${errors.length}`);
}

main().catch(err => {
  console.error("❌ dol-ofccp-merge failed:", err);
  process.exit(1);
});
