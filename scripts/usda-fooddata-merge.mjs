#!/usr/bin/env node
/**
 * USDA FoodData Central — merge filtered rows into TWO outputs:
 *
 * 1.  public/data/_meta/brand-parent-map.json   (augmented)
 *     - Adds entries of the form
 *       "<normKey(brandName)>": { parent: "<existing-slug>", confidence: "...", source: "usda-fooddata" }
 *     - Only when slug-of(brandOwner) matches a real slug in
 *       public/data/index.json.
 *     - Does NOT overwrite existing HIGH-confidence entries (unless --force).
 *     - Default confidence is "medium" (USDA's brandOwner field is mostly
 *       legal-entity strings — strong signal but not curated).
 *
 * 2.  data/derived/usda-fooddata-augment.json   (new file)
 *     - Keyed by canonical 14-digit GTIN.
 *     - Value: { brandName, brandOwner, parentSlug } where parentSlug is
 *       the resolved index.json slug for that brandOwner, or null.
 *     - This is what the scanner's "direct UPC → company" fast path will
 *       read at app start.
 *
 * Inputs:
 *   public/data/_cache/usda-fooddata/branded-foods.json
 *     (an array of { gtin, brandName, brandOwner }, produced by
 *      usda-fooddata-fetch.mjs)
 *
 * Flags:
 *   --dry           (default) print stats, do not touch disk.
 *   --apply         write the augmented map + augment file.
 *   --force         allow overwriting existing HIGH-confidence map entries.
 *   --src PATH      read filtered rows from PATH (default cache file).
 *
 * Locally:
 *   node scripts/usda-fooddata-merge.mjs                   # dry
 *   node scripts/usda-fooddata-merge.mjs --apply           # write
 */

import fs from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_JSON   = path.join(ROOT, "public/data/index.json");
const MAP_JSON     = path.join(ROOT, "public/data/_meta/brand-parent-map.json");
const AUGMENT_JSON = path.join(ROOT, "data/derived/usda-fooddata-augment.json");
const LOG_JSON     = path.join(ROOT, "public/data/_meta/usda-fooddata-merge-log.json");
const DEFAULT_SRC  = path.join(ROOT, "public/data/_cache/usda-fooddata/branded-foods.json");

const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function arg(name, fb=null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i+1] : fb;
}
const APPLY = flag("--apply");
const DRY   = !APPLY;
const FORCE = flag("--force");
const SRC   = arg("--src", DEFAULT_SRC);

// Normalization matches App.jsx:127 resolveBrand.
export function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Best-effort: turn a USDA brand_owner legal-entity string into a slug
 * that might exist in public/data/index.json. We try several
 * normalizations because USDA uses inconsistent capitalization, "INC"
 * vs "Inc.", trailing "LLC"/"CO" etc.
 *
 * Returns an ARRAY of candidate slugs (most-specific first) so the caller
 * can probe several. Caller checks each against the slugSet.
 */
export function brandOwnerCandidates(brandOwner) {
  const s0 = String(brandOwner || "").trim();
  if (!s0) return [];
  // Strip common corporate suffixes (case-insensitive).
  const stripped = s0
    .replace(/[,]+/g, " ")
    .replace(/\b(incorporated|inc\.?|corp\.?|corporation|co\.?|company|llc|l\.l\.c\.|ltd\.?|limited|sa|s\.a\.|nv|n\.v\.|plc|gmbh|kg|the)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const k1 = normKey(s0);
  const k2 = normKey(stripped);
  const k3 = normKey(stripped.split(/\s+/)[0] || "");        // first word, e.g. "Mondelez"
  const k4 = normKey(stripped.split(/\s+/).slice(0, 2).join(" ")); // first two
  // De-dupe while preserving order. Skip too-short tokens.
  const seen = new Set();
  return [k2, k4, k3, k1].filter(k => k && k.length >= 3 && !seen.has(k) && seen.add(k));
}

/**
 * Read the streamed JSON-array file in one slurp. We accept this cost on
 * the merge side because the filtered file is ~600 MB and machines that
 * run this script (CI ubuntu-latest, the maintainer's laptop) have plenty
 * of RAM. If this ever becomes a problem we can switch to a JSON-lines
 * format on the fetch side.
 *
 * Returns an iterable.
 */
async function readFilteredRows(srcPath) {
  const buf = await fs.readFile(srcPath, "utf-8");
  return JSON.parse(buf);
}

async function main() {
  console.log(`USDA FoodData merge starting... (mode=${DRY ? "DRY" : "APPLY"}${FORCE ? ", FORCE" : ""})`);

  if (!existsSync(SRC)) {
    console.error(`Missing ${SRC}. Run scripts/usda-fooddata-fetch.mjs first.`);
    process.exit(2);
  }
  if (!existsSync(INDEX_JSON)) {
    console.error(`Missing ${INDEX_JSON}.`);
    process.exit(2);
  }

  const index = JSON.parse(await fs.readFile(INDEX_JSON, "utf-8"));
  const slugSet = new Set(index.map(c => c.slug).filter(Boolean));
  // Pre-build a "first-token of a slug → slug" hint table for prefix matches.
  // E.g. "mondelez-international" has first-token "mondelez", so a brand owner
  // candidate of "mondelez" can resolve via this hint. Skips ambiguous prefixes
  // (those that map to >1 slug — we don't want "general" matching the wrong
  // "general-mills" vs "general-electric").
  const prefixHint = new Map(); // norm(firstToken) -> slug | "__ambiguous__"
  for (const c of index) {
    if (!c.slug) continue;
    const tok = String(c.slug).split("-")[0];
    const k = normKey(tok);
    if (!k || k.length < 4) continue;
    if (prefixHint.has(k)) prefixHint.set(k, "__ambiguous__");
    else prefixHint.set(k, c.slug);
  }
  console.log(`Loaded ${slugSet.size.toLocaleString()} company slugs from index.json`);

  const existingMap = existsSync(MAP_JSON)
    ? JSON.parse(await fs.readFile(MAP_JSON, "utf-8"))
    : {};
  const beforeCount = Object.keys(existingMap).filter(k => !k.startsWith("_")).length;
  console.log(`Existing brand-parent-map: ${beforeCount.toLocaleString()} entries`);

  const rows = await readFilteredRows(SRC);
  console.log(`Loaded ${rows.length.toLocaleString()} USDA branded-foods rows`);

  // Build a "brandOwner string → resolved parent slug" cache so we only do
  // the suffix-stripping + slugSet probing once per unique owner.
  const ownerSlugCache = new Map();
  function resolveOwner(brandOwner) {
    if (ownerSlugCache.has(brandOwner)) return ownerSlugCache.get(brandOwner);
    const cands = brandOwnerCandidates(brandOwner);
    let hit = null;
    // Pass 1: exact slug hits.
    for (const k of cands) {
      if (slugSet.has(k)) { hit = k; break; }
    }
    // Pass 2: unambiguous prefix hint (e.g. "mondelez" -> "mondelez-international").
    if (!hit) {
      for (const k of cands) {
        const hinted = prefixHint.get(k);
        if (hinted && hinted !== "__ambiguous__") { hit = hinted; break; }
      }
    }
    ownerSlugCache.set(brandOwner, hit);
    return hit;
  }

  // ── Pass 1: brand-parent-map augmentation ────────────────────────────
  const newMap = { ...existingMap };
  let added = 0, skippedNoParent = 0, skippedConflict = 0, skippedNoBrand = 0;
  const ownerHits = new Map(); // owner → count, for log

  for (const r of rows) {
    if (!r?.brandName) { skippedNoBrand++; continue; }
    const k = normKey(r.brandName);
    if (!k) { skippedNoBrand++; continue; }
    const parentSlug = resolveOwner(r.brandOwner);
    if (!parentSlug) { skippedNoParent++; continue; }

    ownerHits.set(r.brandOwner, (ownerHits.get(r.brandOwner) || 0) + 1);

    const existing = newMap[k];
    if (existing && !k.startsWith("_")) {
      if (existing.confidence === "high" && !FORCE) {
        skippedConflict++;
        continue;
      }
      // medium-or-lower: replace only if our parent matches OR we're FORCE
      if (existing.parent === parentSlug) continue;
      if (!FORCE) { skippedConflict++; continue; }
    }
    newMap[k] = { parent: parentSlug, confidence: "medium", source: "usda-fooddata" };
    added++;
  }
  const afterCount = Object.keys(newMap).filter(k => !k.startsWith("_")).length;

  // ── Pass 2: GTIN → owner augment file ────────────────────────────────
  // Keyed by canonical 14-digit GTIN. If the same GTIN appears twice (it
  // shouldn't, but USDA sometimes has duplicates from re-imports) the LAST
  // record wins. parentSlug may be null when the owner doesn't map to a
  // shipped company.
  const augment = {};
  for (const r of rows) {
    if (!r?.gtin) continue;
    augment[r.gtin] = {
      brandName: r.brandName || "",
      brandOwner: r.brandOwner || "",
      parentSlug: resolveOwner(r.brandOwner),
    };
  }
  const augmentResolved = Object.values(augment).filter(v => v.parentSlug).length;

  // ── Report ───────────────────────────────────────────────────────────
  console.log(`\nbrand-parent-map:`);
  console.log(`  ${beforeCount.toLocaleString()} -> ${afterCount.toLocaleString()} entries (${added.toLocaleString()} added)`);
  console.log(`  ${skippedConflict.toLocaleString()} skipped (existing high-confidence entry kept)`);
  console.log(`  ${skippedNoParent.toLocaleString()} skipped (brandOwner does not match any TruNorth slug)`);
  console.log(`  ${skippedNoBrand.toLocaleString()} skipped (no brandName)`);

  console.log(`\nGTIN augment file:`);
  console.log(`  ${Object.keys(augment).length.toLocaleString()} unique GTINs`);
  console.log(`  ${augmentResolved.toLocaleString()} resolve to a TruNorth parent slug`);

  console.log(`\nTop 10 brand owners by row count:`);
  const top = [...ownerHits.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10);
  for (const [owner, n] of top) {
    console.log(`  ${String(n).padStart(6)}  ${owner}`);
  }

  if (DRY) {
    console.log(`\nDRY — no files written. Re-run with --apply.`);
    return;
  }

  // Sort the map alphabetically (matches build-brand-parent-map.mjs).
  const sortedKeys = Object.keys(newMap).sort();
  const ordered = {};
  for (const k of sortedKeys) ordered[k] = newMap[k];

  await fs.mkdir(path.dirname(MAP_JSON), { recursive: true });
  await fs.writeFile(MAP_JSON, JSON.stringify(ordered, null, 2) + "\n");
  console.log(`\nWrote ${MAP_JSON}`);

  await fs.mkdir(path.dirname(AUGMENT_JSON), { recursive: true });
  await fs.writeFile(AUGMENT_JSON, JSON.stringify(augment));
  console.log(`Wrote ${AUGMENT_JSON}`);

  await fs.writeFile(LOG_JSON, JSON.stringify({
    merged_at: new Date().toISOString(),
    src: path.relative(ROOT, SRC),
    rows_in: rows.length,
    map_before: beforeCount,
    map_after: afterCount,
    map_added: added,
    map_skipped_conflict: skippedConflict,
    map_skipped_no_parent: skippedNoParent,
    map_skipped_no_brand: skippedNoBrand,
    augment_gtins: Object.keys(augment).length,
    augment_resolved: augmentResolved,
    top_owners: top.map(([o, n]) => ({ owner: o, rows: n })),
  }, null, 2) + "\n");
  console.log(`Wrote ${LOG_JSON}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("usda-fooddata-merge failed:", err);
    process.exit(1);
  });
}
