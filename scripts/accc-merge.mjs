#!/usr/bin/env node
/**
 * ACCC — Step 2: merge accc-enforcement.json into per-company JSON.
 *
 * Reads /public/data/accc-enforcement.json (produced monthly by
 * accc-fetch.mjs) and writes the structured `accc` field into each
 * matching company file.
 *
 * Target schema:
 *   accc: {
 *     totalAcccActions5y: number,
 *     totalFinesAud:      number,
 *     sampleActions:      [{ date, type, allegation, fine_aud, url }],
 *     lastUpdated:        ISO string,
 *     source:             "accc",
 *     sourceUrl:          "https://www.accc.gov.au"
 *   }
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips brands marked
 * `no_actions`.
 *
 * Locally: node scripts/accc-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ACCC_FILE = path.join(ROOT, "public/data/accc-enforcement.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/accc-merge-log.json");

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

  company.accc = {
    totalAcccActions5y: brandEntry.total_accc_actions_5y,
    totalFinesAud:      brandEntry.total_fines_aud,
    sampleActions:      brandEntry.sample_actions,
    lastUpdated:        now,
    source:             "accc",
    sourceUrl:          "https://www.accc.gov.au",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.accc = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:              brandEntry.slug,
    target:             targetSlug,
    routed_via,
    status:             "merged",
    totalAcccActions5y: brandEntry.total_accc_actions_5y,
    totalFinesAud:      brandEntry.total_fines_aud,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("ACCC merge starting...");

  const accc = JSON.parse(await fs.readFile(ACCC_FILE, "utf-8"));
  const entries = accc.brands || [];
  console.log(`${entries.length} brand entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) results.push(await mergeOne(e, maps, now));

  const merged  = results.filter((r) => r.status === "merged");
  const skipped = results.filter((r) => r.status === "skipped");
  const orphans = results.filter((r) => r.status === "orphan");
  const errors  = results.filter((r) => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:      now,
    source_file:    "public/data/accc-enforcement.json",
    total_brands:   entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    orphans:        orphans.map((o) => o.brand),
    merged:         merged.map((m) => ({
      brand:   m.brand,
      target:  m.target,
      routed_via: m.routed_via,
      actions: m.totalAcccActions5y,
      fines_aud: m.totalFinesAud,
    })),
  }, null, 2));

  console.log(`Merged:  ${merged.length}`);
  console.log(`Skipped: ${skipped.length} (no_actions + errors)`);
  console.log(`Orphans: ${orphans.length}`);
}

main().catch((err) => {
  console.error("accc-merge failed:", err);
  process.exit(1);
});
