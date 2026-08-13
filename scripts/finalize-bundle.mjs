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

// ── V-1: make shelf brands findable by NAME ────────────────────────────────
// The barcode scanner has always loaded brand-parent-map.json, but the text
// search never did — so 4,902 sub-brand names that resolve to an ALREADY-GRADED
// parent (Tide, Oreo, Cheerios, Pampers, Charmin) returned nothing when typed,
// while their siblings (Febreze, Downy, Gillette) resolved fine purely because
// they happened to exist as their own catalog rows.
//
// Design: ONE record, MANY aliases. We do NOT mint thousands of new catalog
// rows — that would inflate the brand count and multiply the same-company
// contradictory-grade problem. Instead each alias becomes a searchable term on
// its PARENT's document, so "Tide" surfaces the Procter & Gamble record.
// Alias keys are squashed lowercase ("oldspice"), which is why App.jsx also
// searches a squashed form of the user's query.
const ALIAS_MAP_PATH = path.join(DATA, "_meta/brand-parent-map.json");
const aliasesByParent = new Map();
let aliasCount = 0;
try {
  const amap = JSON.parse(fs.readFileSync(ALIAS_MAP_PATH, "utf8"));
  const existing = new Set(merged.map((e) => String(e.slug || "").toLowerCase()));
  for (const [alias, info] of Object.entries(amap)) {
    if (!info || info.confidence !== "high") continue;      // high-confidence only
    const a = String(alias).toLowerCase();
    if (existing.has(a)) continue;                           // already its own row
    const parent = String(info.parent || "").toLowerCase();
    if (!parent || !existing.has(parent)) continue;          // parent must exist
    if (!aliasesByParent.has(parent)) aliasesByParent.set(parent, []);
    aliasesByParent.get(parent).push(a);
    aliasCount++;
  }
  console.log(`[finalize-bundle] V-1 alias search: ${aliasCount} shelf-brand names attached to ${aliasesByParent.size} parents`);
} catch (err) {
  console.warn("[finalize-bundle] brand-parent-map unavailable, alias search disabled:", err.message);
}

console.log("[finalize-bundle] rebuilding MiniSearch index with tuned relevance…");
// Phase-9-2026-06-09 tuning: queries like "General Mills" used to return
// fuzzy/prefix matches for thousands of partially-matching companies because
// MiniSearch defaults to OR. Switch to AND + boost name harder so exact
// brand-name hits dominate.
const mini = new MiniSearch({
  // `aliases` is searchable but NOT stored — it exists only so a shelf-brand
  // name resolves to its parent's record. Boosted well below `name` so a real
  // company name always outranks an alias match.
  fields: ["name", "cat", "aliases"],
  storeFields: ["id", "slug", "name", "cat", "grade", "score", "init", "ab", "ac", "sc", "overall", "foreignOwned", "antitrust", "childLabor"],
  searchOptions: {
    boost: { name: 5, aliases: 2 },
    prefix: true,
    fuzzy: 0.2,
    combineWith: "AND",
  },
});
mini.addAll(merged.map((e, i) => {
  const al = aliasesByParent.get(String(e.slug || "").toLowerCase());
  return { ...e, id: e.slug + ":" + i, aliases: al ? al.join(" ") : "" };
}));
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
