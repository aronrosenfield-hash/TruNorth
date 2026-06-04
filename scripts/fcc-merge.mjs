#!/usr/bin/env node
/**
 * FCC Consumer Complaints — Step 2: Merge fcc-complaints.json into per-company JSON.
 *
 * Reads /public/data/fcc-complaints.json (produced weekly by fcc-fetch.mjs)
 * and writes the structured `fcc` field into each matching company file.
 *
 * Target schema (when status === "ok"):
 *   fcc: {
 *     totalComplaints24mo:  number,
 *     topCategories:        [{ label, count }],   // issue (wireless, internet, robocalls...)
 *     topMethods:           [{ label, count }],   // method (phone, internet, TV)
 *     sampleComplaints:     [...],
 *     sampledCount:         number,
 *     lastUpdated:          ISO,
 *     source:               "fcc",
 *     sourceUrl:            string,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips entries with
 * no complaints — those would be junk data on non-telecom brands.
 *
 * NOTE — dataset limitation: as of 2017 the FCC's CGB Consumer Complaints
 * dataset (3xyp-aqkj) has no carrier/company column. The current fetcher
 * records every brand as status="no_company_attribution" and this merger
 * skips writing per-company fcc fields in that state. We still record the
 * industry-wide aggregate to `public/data/_meta/fcc-merge-log.json` so the
 * dashboard / future schema-change branch has the audit trail. If the FCC
 * restores carrier attribution (or we switch to a FOIA-derived feed), the
 * fetcher will start emitting status="ok" entries and this merger will
 * write them through unchanged.
 *
 * Locally: node scripts/fcc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FCC_FILE = path.join(ROOT, "public/data/fcc-complaints.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(ROOT, "public/data/_meta/fcc-merge-log.json");

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

  company.fcc = {
    totalComplaints24mo: brandEntry.total_complaints_24mo,
    topCategories:       brandEntry.top_categories,
    topMethods:          brandEntry.top_methods,
    sampleComplaints:    brandEntry.sample_complaints,
    sampledCount:        brandEntry.sampled_count,
    lastUpdated:         now,
    source:              "fcc",
    sourceUrl:           `https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj`,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.fcc = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:               brandEntry.slug,
    target:              targetSlug,
    routed_via,
    status:              "merged",
    totalComplaints24mo: brandEntry.total_complaints_24mo,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("📡 FCC merge starting…");

  const fcc = JSON.parse(await fs.readFile(FCC_FILE, "utf-8"));
  const entries = fcc.complaints || [];
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
    merged_at:         now,
    source_file:       "public/data/fcc-complaints.json",
    dataset_limitation: fcc.dataset_limitation || null,
    total_brands:      entries.length,
    merged_count:      merged.length,
    skipped_count:     skipped.length,
    orphan_count:      orphans.length,
    error_count:       errors.length,
    industry_total_complaints_24mo: fcc.industry_total_complaints_24mo ?? null,
    industry_top_categories:        fcc.industry_top_categories ?? null,
    industry_top_methods:           fcc.industry_top_methods ?? null,
    orphans:           orphans.map(o => o.brand),
  }, null, 2));

  console.log(`✅ Merged: ${merged.length}`);
  console.log(`   Skipped (no complaints): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
}

main().catch(err => {
  console.error("❌ fcc-merge failed:", err);
  process.exit(1);
});
