#!/usr/bin/env node
/**
 * EEOC + voluntary DEI — Step 2: Merge into a slug-keyed augment file.
 *
 * Reads the most recent data/raw/eeoc-dei/<YYYY-MM-DD>.json and writes
 * a TruNorth-conventional augment file at:
 *   data/derived/eeoc-dei-augment.json
 *
 * The augment file is keyed by TruNorth company slug (after alias /
 * brand-parent resolution) and each value is the public-facing
 * structure consumed by the company JSON rebuilder:
 *
 *   {
 *     "<slug>": {
 *       "dei": {
 *         "womenAllRolesPct":        45,
 *         "womenLeadershipPct":      38,
 *         "racialEthnicMinorityPct": 52,
 *         "source":                  "voluntary-corporate-disclosure",
 *         "year":                    2023,
 *         "sourceUrl":               "https://...",
 *         "eeocCorroboratingSource": "https://www.eeoc.gov/..."
 *       }
 *     }
 *   }
 *
 * This file mirrors the wikirate-augment.json convention so downstream
 * grading code can read both without per-source plumbing.
 *
 * Flags:
 *   --dry      (default) — diff & report, don't touch disk.
 *   --apply    — write the augment file + the merge log.
 *
 * Locally:
 *   node scripts/eeoc-dei-merge.mjs
 *   node scripts/eeoc-dei-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/eeoc-dei");
const OUT_DIR  = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(OUT_DIR, "eeoc-dei-augment.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "eeoc-dei-merge-log.json");

const EEOC_AGGREGATE_URL =
  "https://www.eeoc.gov/statistics/employment/eeo1-public-use-aggregate-reports";

const argv  = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const DRY   = !APPLY;

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

// Resolve a registry slug -> real TruNorth slug via direct / alias / parent.
// Pure (no I/O beyond existsSync) — exported for tests.
export function resolveSlug(slug, maps, compDir = COMP_DIR) {
  if (existsSync(path.join(compDir, `${slug}.json`))) {
    return { slug, routed_via: "direct" };
  }
  const alias = maps.aliases?.[slug];
  if (alias && existsSync(path.join(compDir, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents?.[slug]?.parent;
  if (parent && existsSync(path.join(compDir, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

// Build the public-facing `dei` block from a raw record.
// Drops internal fields, adds the EEOC corroborating-source URL.
export function buildDeiBlock(rawRec) {
  const d = rawRec.dei || {};
  return {
    womenAllRolesPct:        d.womenAllRolesPct ?? null,
    womenLeadershipPct:      d.womenLeadershipPct ?? null,
    racialEthnicMinorityPct: d.racialEthnicMinorityPct ?? null,
    source:                  d.source || "voluntary-corporate-disclosure",
    year:                    d.year ?? null,
    sourceUrl:               d.sourceUrl ?? null,
    eeocCorroboratingSource: EEOC_AGGREGATE_URL,
  };
}

// Find the newest raw JSON file (YYYY-MM-DD.json) under data/raw/eeoc-dei.
async function newestRawFile() {
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return path.join(RAW_DIR, files[files.length - 1]);
}

async function main() {
  const now = new Date().toISOString();
  console.log(`EEOC + DEI merger starting... (mode=${DRY ? "DRY" : "APPLY"})`);

  const rawFile = await newestRawFile();
  if (!rawFile) {
    console.error(`No raw JSON files found under ${RAW_DIR}. Run scripts/eeoc-dei-fetch.mjs first.`);
    process.exit(2);
  }
  console.log(`Reading ${rawFile}`);

  const raw = JSON.parse(await fs.readFile(rawFile, "utf-8"));
  const sourceCompanies = raw.companies || {};
  const sourceSlugs = Object.keys(sourceCompanies);
  console.log(`${sourceSlugs.length} source records`);

  const maps = await loadMaps();

  const augment = {};
  let direct = 0, alias = 0, parent = 0, orphan = 0;
  const orphanList = [];
  const mergedList = [];

  for (const sourceSlug of sourceSlugs) {
    const rec = sourceCompanies[sourceSlug];
    const { slug: targetSlug, routed_via } = resolveSlug(sourceSlug, maps);

    if (!targetSlug) {
      orphan++;
      orphanList.push({ source_slug: sourceSlug, name: rec._name });
      continue;
    }

    if (routed_via === "direct") direct++;
    else if (routed_via === "alias") alias++;
    else if (routed_via === "parent") parent++;

    // Last-write-wins on parent/alias collisions — last source slug
    // routed to a given target wins. Log it so the operator can see.
    if (augment[targetSlug]) {
      mergedList.push({
        source_slug: sourceSlug,
        target_slug: targetSlug,
        routed_via,
        status: "collision_overwrite",
        prior_source: augment[targetSlug]._meta?.source_slug,
      });
    } else {
      mergedList.push({
        source_slug: sourceSlug,
        target_slug: targetSlug,
        routed_via,
        status: "merged",
      });
    }

    augment[targetSlug] = {
      dei: buildDeiBlock(rec),
      _meta: {
        source_slug: sourceSlug,
        routed_via,
        merged_at: now,
      },
    };
  }

  // Stats summary
  console.log(`\nRoute breakdown:`);
  console.log(`  direct: ${direct}`);
  console.log(`  alias:  ${alias}`);
  console.log(`  parent: ${parent}`);
  console.log(`  orphan: ${orphan}`);
  console.log(`  total covered: ${Object.keys(augment).length}`);

  if (orphan > 0) {
    console.log(`\nOrphan source slugs (no TruNorth company file):`);
    for (const o of orphanList.slice(0, 30)) {
      console.log(`  - ${o.source_slug}  (${o.name})`);
    }
    if (orphanList.length > 30) console.log(`  ... and ${orphanList.length - 30} more`);
  }

  if (DRY) {
    console.log(`\nDRY RUN — no files written. Re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
    return;
  }

  // APPLY: write augment + merge log.
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(META_DIR, { recursive: true });

  const out = {
    _license:    "US public domain (EEOC aggregate) + cited voluntary corporate disclosures",
    _source:     EEOC_AGGREGATE_URL,
    _source_file: path.relative(ROOT, rawFile),
    _generated_at: now,
    _stats: {
      source_records: sourceSlugs.length,
      matched_companies: Object.keys(augment).length,
      route_direct: direct,
      route_alias:  alias,
      route_parent: parent,
      orphan_count: orphan,
    },
    companies: augment,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE}`);

  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      path.relative(ROOT, rawFile),
    augment_file:     path.relative(ROOT, OUT_FILE),
    total_records:    sourceSlugs.length,
    matched:          Object.keys(augment).length,
    orphans:          orphanList,
    routes:           mergedList,
  }, null, 2));
  console.log(`Wrote ${LOG_FILE}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("eeoc-dei-merge failed:", err);
    process.exit(1);
  });
}
