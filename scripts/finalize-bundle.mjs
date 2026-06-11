#!/usr/bin/env node
/**
 * Finalize-bundle: re-derives index.json from per-company files and
 * rebuilds search-index.json with relevance-tuned MiniSearch options.
 * Run manually after rebakes (rebake-scoring.mjs, inherit-from-parent.mjs,
 * enrich-negative-signals.mjs, …).
 *
 * The index entry shape + scoreGrade live in scripts/lib/index-entry.mjs,
 * shared with scripts/rebuild-bundle-index.mjs (the npm-run-build
 * generator) — both produce byte-identical index.json by construction.
 * This script additionally:
 *   1. Rebuilds search-index.json with MiniSearch tuned for relevance:
 *        - combineWith: "AND" (multi-word queries must match all tokens —
 *          fixes "General Mills" not appearing for that query)
 *        - boost: { name: 5 } (was 2 — strengthens exact-name dominance)
 *        - prefix + fuzzy stay enabled
 *   2. Stamps meta.json with companyCount + finalizeStamp.
 *
 * Idempotent + safe to re-run. No network. ~2s on the full 11k catalog.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import { buildBundleIndex } from "./lib/index-entry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA = path.join(ROOT, "public/data");
const SEARCH_OUT = path.join(DATA, "search-index.json");
const META_OUT = path.join(DATA, "meta.json");

const merged = buildBundleIndex(
  path.join(DATA, "companies"),
  path.join(DATA, "index.json"),
  { tag: "finalize-bundle" },
);

console.log("[finalize-bundle] rebuilding MiniSearch index with tuned relevance…");
// Phase-9-2026-06-09 tuning: queries like "General Mills" used to return
// fuzzy/prefix matches for thousands of partially-matching companies because
// MiniSearch defaults to OR. Switch to AND + boost name harder so exact
// brand-name hits dominate.
const mini = new MiniSearch({
  fields: ["name", "cat"],
  storeFields: ["id", "slug", "name", "cat", "grade", "score", "init", "ab", "ac", "sc", "overall", "foreignOwned", "antitrust", "childLabor"],
  searchOptions: {
    boost: { name: 5 },
    prefix: true,
    fuzzy: 0.2,
    combineWith: "AND",
  },
});
mini.addAll(merged.map((e, i) => ({ ...e, id: e.slug + ":" + i })));
fs.writeFileSync(SEARCH_OUT, JSON.stringify(mini.toJSON()));
const searchKb = (fs.statSync(SEARCH_OUT).size / 1024).toFixed(1);
console.log(`[finalize-bundle] wrote ${SEARCH_OUT}: ${searchKb} KB`);

// Update meta.json version stamp
let meta = {};
try { meta = JSON.parse(fs.readFileSync(META_OUT, "utf8")); } catch {}
meta.companyCount = merged.length;
meta.finalizeStamp = new Date().toISOString();
fs.writeFileSync(META_OUT, JSON.stringify(meta));

console.log(`\n✅ Done. Index: ${merged.length} entries · search-index: ${searchKb} KB`);
