#!/usr/bin/env node
/**
 * exec-political-donations — Step 2: emit a slug-keyed augment file the
 * front-end loader merges into each company's political block.
 *
 * Reads /public/data/exec-political-donations.json (written by the fetcher
 * every run, --dry or --apply) and writes:
 *
 *   data/derived/exec-political-donations-augment.json
 *
 * Shape (per the sprint spec):
 *
 *   {
 *     "<slug>": {
 *       "political": {
 *         "execDonationLean": "D+9" | "R+5" | "split" | "minimal",
 *         "totalUsd": 920000,
 *         "donorCount": 24,
 *         "year": 2024,
 *         "sources": ["https://..."]
 *       }
 *     },
 *     ...
 *   }
 *
 * Slug-matching uses the same resolveSlug chain as usaspending-merge.mjs
 * so we silently absorb aliases / brand-parent rollups.
 *
 * NEUTRALITY: the merger does NOT mark D vs R as positive or negative —
 * the front-end's quiz preference applies that interpretation.
 *
 * Flags:
 *   --dry      (default) — log what would be written; touch nothing.
 *   --apply    — write the augment + merge log to disk.
 *
 * Locally:
 *   node scripts/exec-political-donations-merge.mjs            # dry
 *   node scripts/exec-political-donations-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT, "public/data/exec-political-donations.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/exec-political-donations-augment.json");
const LOG_FILE = path.join(META_DIR, "exec-political-donations-merge-log.json");

const argv = new Set(process.argv.slice(2));
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

// Identical resolution chain as usaspending-merge.mjs.
export function resolveSlug(slug, maps) {
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) {
    return { slug, routed_via: "direct" };
  }
  const alias = maps.aliases?.[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents?.[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

// Build the per-slug augment value. Compact, neutral, no editorial copy.
export function buildAugmentValue(record) {
  return {
    political: {
      execDonationLean: record.execDonationLean,
      totalUsd: record.totalUsd,
      donorCount: record.donorCount,
      year: record.year,
      sources: record.sources || [],
    },
  };
}

function leanBucket(label) {
  if (!label) return "minimal";
  if (label === "split") return "split";
  if (label === "minimal") return "minimal";
  if (label.startsWith("D")) return "D";
  if (label.startsWith("R")) return "R";
  return "minimal";
}

async function main() {
  const now = new Date().toISOString();
  console.log(`exec-political-donations merge starting... (mode=${DRY ? "DRY" : "APPLY"})`);

  if (!existsSync(SRC_FILE)) {
    console.error(`Missing ${SRC_FILE}. Run exec-political-donations-fetch.mjs first.`);
    process.exit(2);
  }
  const src = JSON.parse(await fs.readFile(SRC_FILE, "utf-8"));
  const records = src.companies || [];
  console.log(`Loaded ${records.length} company records (generated_at=${src._generated_at})`);

  const maps = await loadMaps();

  const augment = {};
  const log = {
    merged_at: now,
    source_file: "public/data/exec-political-donations.json",
    total_records: records.length,
    merged: 0,
    by_route: { direct: 0, alias: 0, parent: 0, orphan: 0 },
    by_lean:  { D: 0, R: 0, split: 0, minimal: 0 },
    orphans:  [],
  };

  for (const r of records) {
    const { slug: target, routed_via } = resolveSlug(r.slug, maps);
    log.by_route[routed_via]++;
    if (!target) {
      log.orphans.push({ slug: r.slug, lean: r.execDonationLean, totalUsd: r.totalUsd });
      continue;
    }
    augment[target] = buildAugmentValue(r);
    log.merged++;
    log.by_lean[leanBucket(r.execDonationLean)]++;
  }

  console.log(`\nResults:`);
  console.log(`  ${log.merged} ${DRY ? "WOULD augment" : "augmented"}`);
  console.log(`  routes: direct=${log.by_route.direct} alias=${log.by_route.alias} parent=${log.by_route.parent} orphan=${log.by_route.orphan}`);
  console.log(`  lean:   D=${log.by_lean.D} R=${log.by_lean.R} split=${log.by_lean.split} minimal=${log.by_lean.minimal}`);

  if (APPLY) {
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    const augmentPayload = {
      _license: "U.S. public domain (FEC + SEC) — 17 USC 105",
      _sources: src._sources,
      _generated_at: now,
      _source_file: "public/data/exec-political-donations.json",
      _stats: {
        merged: log.merged,
        by_route: log.by_route,
        by_lean: log.by_lean,
      },
      companies: augment,
    };
    await fs.writeFile(OUT_FILE, JSON.stringify(augmentPayload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);

    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify(log, null, 2));
    console.log(`Wrote ${LOG_FILE}`);
  } else {
    console.log(`\nDRY — no files written. Re-run with --apply.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("exec-political-donations-merge failed:", err);
    process.exit(1);
  });
}
