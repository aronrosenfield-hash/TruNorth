#!/usr/bin/env node
/**
 * DEA Diversion merge — writes the enriched `dea` field to per-company JSON.
 *
 * Input:  /public/data/dea-actions.json (produced by dea-fetch.mjs)
 * Output: /public/data/companies/<slug>.json (each gets a `dea` field)
 *
 * Schema written to each company:
 *   dea: {
 *     totalActions5y:   number,
 *     totalMentions5y:  number,
 *     sampleActions:    [{ date, type, allegation, fineOrRevocation, url, documentNumber }],
 *     lastUpdated:      ISO timestamp,
 *     source:           "dea",
 *     sourceUrl:        link back to the FR DEA notices listing,
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips brands with no
 * title-matched actions (mentions_only / no_actions / error).
 *
 * Locally: node scripts/dea-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEA_FILE = path.join(ROOT, "public/data/dea-actions.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "dea-merge-log.json");

const DEA_FR_LISTING = "https://www.federalregister.gov/documents/search?conditions%5Bagencies%5D%5B%5D=drug-enforcement-administration&order=newest";

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
  // Skip brands without any title-matched DEA actions. We still write merges
  // for brands where total_DEA_actions_5y === 0 only if we got "ok" — i.e.
  // we'd never get here. mentions_only is intentionally skipped because the
  // counted FR hits may all be incidental mentions in unrelated cases.
  if (brandEntry.status !== "ok") {
    return { brand: brandEntry.slug, status: "skipped", reason: brandEntry.status };
  }
  const { slug: targetSlug, routed_via } = resolveSlug(brandEntry.slug, maps);
  if (!targetSlug) return { brand: brandEntry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: brandEntry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.dea = {
    totalActions5y:   brandEntry.total_DEA_actions_5y,
    totalMentions5y:  brandEntry.total_mentions_5y,
    sampleActions:    (brandEntry.sample_actions || []).map(a => ({
      date:             a.date,
      type:             a.type,
      allegation:       a.allegation,
      fineOrRevocation: a.fine_or_revocation,
      documentNumber:   a.document_number,
      url:              a.url,
    })),
    lastUpdated:      now,
    source:           "dea",
    sourceUrl:        DEA_FR_LISTING,
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.dea = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           brandEntry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    totalActions5y:  brandEntry.total_DEA_actions_5y,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("DEA merge starting…");

  const dea = JSON.parse(await fs.readFile(DEA_FILE, "utf-8"));
  const entries = dea.actions || [];
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
    source_file:   "public/data/dea-actions.json",
    total_brands:  entries.length,
    merged_count:  merged.length,
    skipped_count: skipped.length,
    orphan_count:  orphans.length,
    error_count:   errors.length,
    orphans:       orphans.map(o => o.brand),
    merged:        merged.map(m => ({ brand: m.brand, target: m.target, routed_via: m.routed_via, totalActions5y: m.totalActions5y })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Skipped (no/mentions-only actions): ${skipped.length}`);
  console.log(`   Orphan slugs: ${orphans.length}`);
  console.log(`   Errors:       ${errors.length}`);
}

main().catch(err => {
  console.error("dea-merge failed:", err);
  process.exit(1);
});
