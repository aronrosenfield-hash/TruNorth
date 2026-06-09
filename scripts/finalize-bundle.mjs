#!/usr/bin/env node
/**
 * Finalize-bundle: merges out-of-band company files into index.json and
 * rebuilds search-index.json with relevance-tuned MiniSearch options.
 *
 * Background (2026-06-09): hybrid-pipeline/build-split-bundle.mjs is the
 * canonical bundle builder. It reads from raw.json (the hybrid-pipeline's
 * source of truth) and OVERWRITES public/data/companies/*, index.json, and
 * search-index.json. But company files added directly to public/data/
 * (e.g. PR #64's bush-brothers.json + 51 others added by post-launch agents)
 * are NOT in raw.json, so the rebuild silently drops them.
 *
 * This script MUST run after build-split-bundle.mjs. It:
 *   1. Scans public/data/companies/*.json for orphans (file on disk, not in
 *      index.json).
 *   2. Builds compact index entries for each orphan matching build-split's
 *      shape.
 *   3. Merges into index.json (alphabetical sort preserved).
 *   4. Rebuilds search-index.json with MiniSearch tuned for relevance:
 *        - combineWith: "AND" (multi-word queries must match all tokens —
 *          fixes "General Mills" not appearing for that query)
 *        - boost: { name: 5 } (was 2 — strengthens exact-name dominance)
 *        - prefix + fuzzy stay enabled
 *
 * Idempotent + safe to re-run. No network. ~2s on the full 11k catalog.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA = path.join(ROOT, "public/data");
const COMP = path.join(DATA, "companies");
const INDEX_OUT = path.join(DATA, "index.json");
const SEARCH_OUT = path.join(DATA, "search-index.json");
const META_OUT = path.join(DATA, "meta.json");

function scoreGrade(n, realCats) {
  // Build 57 (S2 + signal-count cap): A≥65 ∧ ≥3 sig, B≥55 ∧ ≥2 sig.
  // Must stay in sync with src/App.jsx scoreGrade and
  // scripts/rebake-scoring.mjs gradeFromOverall.
  if (n == null) return "?";
  let g;
  if (n >= 65) g = "A";
  else if (n >= 55) g = "B";
  else if (n >= 45) g = "C";
  else if (n >= 30) g = "D";
  else g = "F";
  if (typeof realCats === "number") {
    if (realCats < 2 && (g === "A" || g === "B")) g = "C";
    else if (realCats < 3 && g === "A") g = "B";
  }
  return g;
}

function indexEntryFromCompanyFile(slug, d) {
  // Mirrors hybrid-pipeline/build-split-bundle.mjs shape.
  return {
    id:      d.id || slug,
    slug,
    name:    d.name,
    cat:     d.cat,
    init:    d.init,
    grade:   scoreGrade(d.overall, d.realCats),
    score:   d.overall,
    overall: d.overall,
    realCats: typeof d.realCats === "number" ? d.realCats : null,
    ab:      d.ab,
    ac:      d.ac,
    sc:      d.sc || {},
    foreignOwned:  !!d.foreignOwned,
    foreignCountry: d.foreignCountry || null,
    antitrust:     !!d.antitrust,
    childLabor:    !!d.childLabor,
    stillInRussia: !!d.stillInRussia,
    competitors: Array.isArray(d.competitors) ? d.competitors : [],
    logoUrl: d.logoUrl || null,
    hasRecall: !!(d.recalls?.recalls?.length),
    recallSeverity: d.recalls?.severityMax || null,
    bdsListed: !!(d.ownership?.bdsListed),
  };
}

console.log("[finalize-bundle] scanning…");

// Build 55: re-derive ENTIRE index from per-company files. The old behavior
// of reading existing index.json and adding orphans missed cases where the
// company file's `overall` / `sc.*` / `flags` changed after a rebake. Now
// we treat the company files as the source of truth and regenerate every
// entry. Drops stale entries for files that no longer exist.
const allFiles = fs.readdirSync(COMP).filter(f => f.endsWith(".json"));
const merged = [];
let resyncedFromFiles = 0;
for (const f of allFiles) {
  const slug = f.replace(/\.json$/, "");
  try {
    const d = JSON.parse(fs.readFileSync(path.join(COMP, f), "utf8"));
    if (!d.name) continue;
    merged.push(indexEntryFromCompanyFile(slug, d));
    resyncedFromFiles++;
  } catch (err) {
    console.warn(`[finalize-bundle] skipping malformed ${f}: ${err.message}`);
  }
}
console.log(`[finalize-bundle] re-derived ${resyncedFromFiles} index entries from company files`);
merged.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
fs.writeFileSync(INDEX_OUT, JSON.stringify(merged));
console.log(`[finalize-bundle] wrote ${INDEX_OUT}: ${merged.length} entries`);

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
