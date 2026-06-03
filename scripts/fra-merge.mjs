#!/usr/bin/env node
/**
 * FRA — Step 2: Merge fra-incidents.json into per-company JSON.
 *
 * Reads /public/data/fra-incidents.json (produced weekly by fra-fetch.mjs)
 * and writes a structured `fra` field into each matching company file.
 *
 * Target schema (enriched.fra):
 *   fra: {
 *     totalIncidents5y:    number,
 *     fatalities5y:        number,
 *     hazmatReleases5y:    number,
 *     railroadClass:       string | null,    ("Class I" etc.)
 *     sampleIncidents:     [{date,accident_type,state,...}],
 *     fraReportingName:    string,           (exact FRA name we matched)
 *     lastUpdated:         iso string,
 *     source:              "fra",
 *     sourceUrl:           string,
 *   }
 *
 * Routing: tries in order
 *   1. direct slug match
 *   2. slug-aliases.json
 *   3. brand-parent-map.json
 *   4. progressive suffix stripping ("-railway-company" → "-railway" → "")
 *
 * Skips entries with no incidents or in error state.
 *
 * Locally: node scripts/fra-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FRA_FILE = path.join(ROOT, "public/data/fra-incidents.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "fra-merge-log.json");

// Suffix tokens we'll progressively strip when looking for a matching
// company file. Order matters — longest/most-specific first.
const SUFFIX_STRIPS = [
  "-railway-company",
  "-railroad-company",
  "-rr-company",
  "-and-railway-company",
  "-and-railroad-company",
  "-railway",
  "-railroad",
  "-company",
  "-corporation",
  "-corp",
  "-inc",
  "-llc",
];

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

function fileForSlug(slug) {
  if (!slug) return null;
  const p = path.join(COMP_DIR, `${slug}.json`);
  return existsSync(p) ? p : null;
}

// Resolve an FRA-derived slug to a real company file via direct → alias →
// parent → suffix-stripping fallbacks.
function resolveSlug(rawSlug, maps) {
  if (fileForSlug(rawSlug)) return { slug: rawSlug, routed_via: "direct" };

  const alias = maps.aliases[rawSlug];
  if (alias && fileForSlug(alias)) return { slug: alias, routed_via: "alias" };

  const parent = maps.parents[rawSlug]?.parent;
  if (parent && fileForSlug(parent)) return { slug: parent, routed_via: "parent" };

  // Progressive suffix stripping.
  for (const suf of SUFFIX_STRIPS) {
    if (rawSlug.endsWith(suf)) {
      const stripped = rawSlug.slice(0, -suf.length);
      if (fileForSlug(stripped)) return { slug: stripped, routed_via: `strip:${suf}` };
      // Also try replacing the suffix with common alt variants.
      for (const alt of ["-railway", "-railroad", ""]) {
        if (suf === alt) continue;
        const swapped = stripped + alt;
        if (fileForSlug(swapped)) return { slug: swapped, routed_via: `swap:${suf}->${alt}` };
      }
    }
  }

  return { slug: null, routed_via: "orphan" };
}

async function mergeOne(entry, maps, now) {
  if (entry.status !== "ok") {
    return { fra_slug: entry.slug, status: "skipped", reason: entry.status };
  }

  const { slug: targetSlug, routed_via } = resolveSlug(entry.slug, maps);
  if (!targetSlug) return { fra_slug: entry.slug, fra_name: entry.name, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try {
    company = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch (e) {
    return { fra_slug: entry.slug, target: targetSlug, status: "parse_error", error: e.message };
  }

  // If a company file already has FRA data from another reporting entity
  // (e.g. parent receiving multiple subsidiaries) — combine by taking the
  // larger set. Simple precedence: keep whichever has more incidents.
  const existing = company.fra;
  const incoming = {
    totalIncidents5y:  entry.total_incidents_5y,
    fatalities5y:      entry.fatalities_5y,
    hazmatReleases5y:  entry.hazmat_releases_5y,
    railroadClass:     entry.railroad_class,
    sampleIncidents:   entry.sample_incidents,
    fraReportingName:  entry.name,
    lastUpdated:       now,
    source:            "fra",
    sourceUrl:         "https://safetydata.fra.dot.gov/officeofsafety",
  };

  if (existing && existing.totalIncidents5y >= incoming.totalIncidents5y) {
    // Keep existing — it's the larger reporting entity for this parent.
    return {
      fra_slug:    entry.slug,
      target:      targetSlug,
      routed_via,
      status:      "merged_secondary",
      kept_existing_from: existing.fraReportingName,
    };
  }

  company.fra = incoming;

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.fra = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    fra_slug:           entry.slug,
    fra_name:           entry.name,
    target:             targetSlug,
    routed_via,
    status:             "merged",
    totalIncidents5y:   entry.total_incidents_5y,
    fatalities5y:       entry.fatalities_5y,
    hazmatReleases5y:   entry.hazmat_releases_5y,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("FRA merge starting...");

  const fra = JSON.parse(await fs.readFile(FRA_FILE, "utf-8"));
  const entries = fra.railroads || [];
  console.log(`${entries.length} railroad entries`);

  const maps = await loadMaps();

  // Sort by total_incidents descending so larger reporting entities win
  // when routed_via="parent" collisions happen.
  entries.sort((a, b) => (b.total_incidents_5y || 0) - (a.total_incidents_5y || 0));

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged    = results.filter(r => r.status === "merged");
  const secondary = results.filter(r => r.status === "merged_secondary");
  const skipped   = results.filter(r => r.status === "skipped");
  const orphans   = results.filter(r => r.status === "orphan");
  const errors    = results.filter(r => r.status === "parse_error");

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/fra-incidents.json",
    total_railroads:  entries.length,
    merged_count:     merged.length,
    merged_secondary_count: secondary.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    orphans:          orphans.map(o => ({ slug: o.fra_slug, name: o.fra_name })),
    merged:           merged.map(m => ({
      fra_name:         m.fra_name,
      target:           m.target,
      routed_via:       m.routed_via,
      totalIncidents5y: m.totalIncidents5y,
    })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`   Secondary (kept larger existing): ${secondary.length}`);
  console.log(`   Skipped (no incidents/error):     ${skipped.length}`);
  console.log(`   Orphan slugs:                     ${orphans.length}`);
  console.log(`   Parse errors:                     ${errors.length}`);
}

main().catch(err => {
  console.error("fra-merge failed:", err);
  process.exit(1);
});
