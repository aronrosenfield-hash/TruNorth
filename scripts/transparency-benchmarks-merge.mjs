#!/usr/bin/env node
/**
 * Transparency benchmarks — Step 2: aggregate the latest fetch snapshot
 * into the augment file consumed by the scoring pipeline.
 *
 * Reads the newest /data/raw/transparency-benchmarks/<YYYY-MM-DD>.json
 * produced by transparency-benchmarks-fetch.mjs, runs slug resolution
 * against the existing slug-aliases + brand-parent-map, and writes:
 *
 *   /data/derived/transparency-benchmarks-augment.json
 *     {
 *       generated_at: iso-8601,
 *       source: "transparency-benchmarks",
 *       company_count: number,
 *       data: {
 *         "<slug>": {
 *           transparency: {
 *             compositeScore: 0–100,
 *             subScores: {
 *               rdr, txnPledge, justCapital, chrb, fashionRevTransparency
 *             },
 *             sourceUrls: []
 *           }
 *         }
 *       }
 *     }
 *
 * Slug resolution order (per TruNorth convention):
 *   1. direct slug match against public/data/companies/<slug>.json
 *   2. slug-aliases.json
 *   3. brand-parent-map.json (roll up to parent)
 *   4. orphan (logged, not written)
 *
 * Flags:
 *   --dry    (default) — print resolution stats, write a preview to
 *                        /tmp/transparency-benchmarks-augment.preview.json.
 *   --apply  — write the canonical /data/derived/ augment file.
 *   --in PATH  — override source snapshot file (defaults to newest in
 *                /data/raw/transparency-benchmarks/).
 *
 * Locally:
 *   node scripts/transparency-benchmarks-merge.mjs
 *   node scripts/transparency-benchmarks-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/transparency-benchmarks");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "transparency-benchmarks-augment.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const IN_OVERRIDE = (() => {
  const i = argv.indexOf("--in");
  return i >= 0 ? argv[i + 1] : null;
})();

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

export function resolveSlug(slug, maps, compDirExists = (s) => existsSync(path.join(COMP_DIR, `${s}.json`))) {
  if (compDirExists(slug)) return { slug, routed_via: "direct" };
  const alias = maps.aliases?.[slug];
  if (alias && compDirExists(alias)) return { slug: alias, routed_via: "alias" };
  const parent = maps.parents?.[slug]?.parent;
  if (parent && compDirExists(parent)) return { slug: parent, routed_via: "parent" };
  return { slug: null, routed_via: "orphan" };
}

// If two source records map to the same resolved slug, take the better
// (higher) composite score and union of sub-scores + source URLs.
// Justification: an alias / brand-rollup shouldn't strip the parent's
// transparency credit just because the brand also has its own row.
export function mergeRecords(a, b) {
  if (!a) return b;
  if (!b) return a;
  const subScores = {};
  for (const k of Object.keys(a.subScores)) {
    const va = a.subScores[k], vb = b.subScores[k];
    if (va == null) subScores[k] = vb;
    else if (vb == null) subScores[k] = va;
    else subScores[k] = Math.max(va, vb);
  }
  const present = Object.values(subScores).filter(v => v != null && Number.isFinite(v));
  const composite = present.length
    ? Math.round(present.reduce((s, x) => s + x, 0) / present.length)
    : null;
  return {
    compositeScore: composite,
    subScores,
    sourceUrls: [...new Set([...a.sourceUrls, ...b.sourceUrls])],
  };
}

export function buildAugment(snapshot, maps, now, compDirExists) {
  const data = {};
  const log = { merged: [], orphans: [], overwrites: 0 };

  for (const rec of snapshot.companies) {
    const { slug: target, routed_via } = resolveSlug(rec.slug, maps, compDirExists);
    if (!target) {
      log.orphans.push({ slug: rec.slug, compositeScore: rec.compositeScore });
      continue;
    }
    const block = {
      compositeScore: rec.compositeScore,
      subScores: { ...rec.subScores },
      sourceUrls: [...rec.sourceUrls],
    };
    if (data[target]) {
      data[target].transparency = mergeRecords(data[target].transparency, block);
      log.overwrites++;
    } else {
      data[target] = { transparency: block };
    }
    log.merged.push({ source_slug: rec.slug, target, routed_via, compositeScore: rec.compositeScore });
  }

  const out = {
    generated_at: now.toISOString(),
    source: "transparency-benchmarks",
    source_url_root: snapshot.sources,
    company_count: Object.keys(data).length,
    data,
  };
  return { out, log };
}

async function findLatestSnapshot() {
  if (IN_OVERRIDE) return path.resolve(IN_OVERRIDE);
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (files.length === 0) return null;
    return path.join(RAW_DIR, files[files.length - 1]);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Transparency benchmarks merge starting... (mode=${DRY ? "DRY" : "APPLY"})`);

  const snapFile = await findLatestSnapshot();
  if (!snapFile || !existsSync(snapFile)) {
    console.error("No snapshot found. Run scripts/transparency-benchmarks-fetch.mjs first.");
    process.exit(2);
  }
  console.log(`Reading ${snapFile}`);
  const snapshot = JSON.parse(await fs.readFile(snapFile, "utf-8"));

  const maps = await loadMaps();
  const now = new Date();
  const compDirExists = (s) => existsSync(path.join(COMP_DIR, `${s}.json`));
  const { out, log } = buildAugment(snapshot, maps, now, compDirExists);

  console.log(`\nResults:`);
  console.log(`  ${log.merged.length} resolved`);
  console.log(`  ${log.orphans.length} orphan (no company file via any route)`);
  console.log(`  ${out.company_count} unique target companies in augment`);
  if (log.overwrites > 0) {
    console.log(`  ${log.overwrites} slug collisions resolved by mergeRecords (took max sub-scores)`);
  }

  // Top + bottom by composite
  const ranked = Object.entries(out.data)
    .map(([slug, v]) => ({ slug, score: v.transparency.compositeScore }))
    .filter(x => x.score != null)
    .sort((a, b) => b.score - a.score);

  console.log(`\n  Top 10:`);
  for (const r of ranked.slice(0, 10)) console.log(`    ${String(r.score).padStart(3)}  ${r.slug}`);
  console.log(`\n  Bottom 10:`);
  for (const r of ranked.slice(-10)) console.log(`    ${String(r.score).padStart(3)}  ${r.slug}`);

  if (log.orphans.length > 0) {
    console.log(`\n  Orphans (no TruNorth company file):`);
    for (const o of log.orphans.slice(0, 20)) {
      console.log(`    ${String(o.compositeScore).padStart(3)}  ${o.slug}`);
    }
    if (log.orphans.length > 20) console.log(`    ...and ${log.orphans.length - 20} more`);
  }

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  } else {
    const preview = "/tmp/transparency-benchmarks-augment.preview.json";
    await fs.writeFile(preview, JSON.stringify(out, null, 2));
    console.log(`\nDRY — wrote preview to ${preview}. Re-run with --apply to publish.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("transparency-benchmarks-merge failed:", err);
    process.exit(1);
  });
}
