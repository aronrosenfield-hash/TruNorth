#!/usr/bin/env node
/**
 * B Corp merger (quarterly) — B-data5.
 *
 * Reads:
 *   public/data/_raw/bcorp.json   (written by scripts/bcorp-fetch.mjs)
 *
 * Per TruNorth brand, resolves matches via:
 *   1. Hand-curated BCORP_OVERRIDES (e.g. "Danone North America" → "danone")
 *   2. Direct slug match (slug-from-brand-name == co.slug)
 *   3. slug-aliases.json
 *   4. brand-parent-map.json
 *
 * Writes co.enriched.bcorp_certification = {
 *   certified:           true,
 *   certification_date:  "YYYY-MM-DD",
 *   overall_score:       151.4,
 *   scores: { community, customers, environment, governance, workers },
 *   recertification_due: "YYYY-MM-DD" | null,
 *   country:             "United States",
 *   industry:            "Apparel & Footwear",
 *   sources:             ["bcorp"],
 *   routed_via:          "direct" | "alias" | "parent" | "override",
 *   last_verified:       "YYYY-MM-DD"
 * }
 *
 * IMPORTANT: We do NOT auto-route a sub-brand listing to a parent holding co
 * via the feed-provided parent string. Parent routing only happens through the
 * curated brand-parent-map.json (high-confidence edge). E.g., "Athleta (Gap
 * Inc.)" certified does NOT make Gap Inc. itself a B Corp.
 *
 * Modes:
 *   node scripts/bcorp-merge.mjs              # DRY default — counts, no writes
 *   node scripts/bcorp-merge.mjs --apply      # actually write co.enriched updates
 *   node scripts/bcorp-merge.mjs --dry-run-top50  # legacy alias for DRY
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const BCORP_FILE = path.join(RAW_DIR, "bcorp.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const UNMATCHED_FILE = path.join(META_DIR, "bcorp-unmatched.json");
const LOG_FILE       = path.join(META_DIR, "bcorp-merge-log.json");

const APPLY = process.argv.includes("--apply");

// Hand-curated overrides. Keys are slugified brand-feed names; values are
// the target TruNorth company slug.
const BCORP_OVERRIDES = {
  // Sub-brand listings that should NOT be auto-routed via the directory's
  // parent string. Only added here when we're confident the certification
  // applies to a TruNorth-tracked entity (e.g. Danone North America is the
  // certified Public Benefit Corporation, not all of Danone S.A.).
  "danone-north-america":     "danone",
  "ben-and-jerrys-homemade":  "ben-and-jerry-s",
  "ben-and-jerrys":           "ben-and-jerry-s",
  "athleta-gap":              null, // explicit no-route: Gap parent is not certified
  // Common name variants
  "patagonia":                "patagonia",
  "allbirds":                 "allbirds",
  "hyatt-hotels":             "hyatt",
  "hyatt-hotels-corporation": "hyatt",
  "kind":                     null, // KIND LLC — not in universe yet; explicit
};

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    // Strip common corporate suffixes BEFORE collapsing whitespace.
    .replace(/\b(inc|incorporated|llc|l\.l\.c|ltd|limited|co|corp|corporation|company|pbc|gmbh|s\.a|sa|ag|plc|holdings?)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  const aliases = await tryReadJson(path.join(META_DIR, "slug-aliases.json")) || {};
  const parents = await tryReadJson(path.join(META_DIR, "brand-parent-map.json")) || {};
  return { aliases, parents };
}

export function resolveSlug(brandName, maps) {
  const brandSlug = slugify(brandName);

  // 0. override beats everything (including explicit "no route" via null)
  if (Object.prototype.hasOwnProperty.call(BCORP_OVERRIDES, brandSlug)) {
    const tgt = BCORP_OVERRIDES[brandSlug];
    if (tgt === null) return { slug: null, routed_via: "override_skip" };
    if (existsSync(path.join(COMP_DIR, `${tgt}.json`))) {
      return { slug: tgt, routed_via: "override" };
    }
  }

  // 1. direct file match
  if (brandSlug && existsSync(path.join(COMP_DIR, `${brandSlug}.json`))) {
    return { slug: brandSlug, routed_via: "direct" };
  }

  // 2. slug-aliases.json
  const alias = maps.aliases[brandSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }

  // 3. brand-parent-map.json (curated parent edge)
  const parent = maps.parents[brandSlug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }

  return { slug: null, routed_via: "orphan" };
}

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  console.log(`B Corp merge starting (apply=${APPLY})...`);

  const raw = await tryReadJson(BCORP_FILE);
  if (!raw || !Array.isArray(raw.certified_brands)) {
    console.error(`No raw B Corp file found at ${BCORP_FILE}. Run scripts/bcorp-fetch.mjs first.`);
    process.exit(1);
  }

  const maps = await loadMaps();

  const matched = [];        // { slug, brand_feed, routed_via, payload }
  const unmatched = [];      // { brand, country, slug_attempt }
  const skipped = [];        // override_skip
  const conflicts = [];      // duplicate slug from two different feed brands

  const slugToEntry = new Map();

  for (const b of raw.certified_brands) {
    const r = resolveSlug(b.brand, maps);
    if (r.routed_via === "override_skip") {
      skipped.push({ brand: b.brand, reason: "override_skip" });
      continue;
    }
    if (!r.slug) {
      unmatched.push({ brand: b.brand, country: b.country, slug_attempt: slugify(b.brand) });
      continue;
    }
    const payload = {
      certified: true,
      certification_date: b.certification_date || null,
      overall_score: b.overall_score ?? null,
      scores: b.scores || {},
      recertification_due: b.recertification_due || null,
      country: b.country || null,
      industry: b.industry || null,
      sources: ["bcorp"],
      routed_via: r.routed_via,
      last_verified: today,
    };
    if (slugToEntry.has(r.slug)) {
      conflicts.push({
        slug: r.slug,
        kept_brand: slugToEntry.get(r.slug).brand_feed,
        dropped_brand: b.brand,
        note: "two feed entries resolve to same TruNorth slug; keeping first",
      });
      continue;
    }
    slugToEntry.set(r.slug, { brand_feed: b.brand, routed_via: r.routed_via, payload });
    matched.push({ slug: r.slug, brand_feed: b.brand, routed_via: r.routed_via });
  }

  // --- Apply (or dry-print) ---
  let written = 0;
  for (const [slug, entry] of slugToEntry.entries()) {
    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) continue;
    if (!APPLY) continue;

    let co;
    try { co = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch (err) {
      console.error(`  parse_error: ${slug} (${err.message})`);
      continue;
    }
    if (!co.enriched || typeof co.enriched !== "object") co.enriched = {};
    co.enriched.bcorp_certification = entry.payload;

    if (typeof co.dataLastUpdated !== "object" || co.dataLastUpdated === null) {
      co.dataLastUpdated = co.dataLastUpdated ? { legacy: co.dataLastUpdated } : {};
    }
    co.dataLastUpdated.bcorp_certification = now.toISOString();

    await fs.writeFile(file, JSON.stringify(co));
    written++;
  }

  // --- Logs ---
  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(UNMATCHED_FILE, JSON.stringify({
    generated_at: now.toISOString(),
    unmatched_count: unmatched.length,
    unmatched,
  }, null, 2));
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at: now.toISOString(),
    apply: APPLY,
    raw_brand_count: raw.brand_count ?? raw.certified_brands.length,
    matched_count: matched.length,
    written_count: written,
    skipped_count: skipped.length,
    unmatched_count: unmatched.length,
    conflict_count: conflicts.length,
    conflicts,
    matched_sample: matched.slice(0, 50),
  }, null, 2));

  console.log(`Raw entries:    ${raw.certified_brands.length}`);
  console.log(`Matched:        ${matched.length}`);
  console.log(`Written:        ${written} ${APPLY ? "" : "(dry — pass --apply to write)"}`);
  console.log(`Override-skip:  ${skipped.length}`);
  console.log(`Unmatched:      ${unmatched.length}`);
  console.log(`Conflicts:      ${conflicts.length}`);
  if (matched.length > 0) {
    console.log(`\nFirst matches:`);
    for (const m of matched.slice(0, 25)) {
      console.log(`  ${m.slug.padEnd(28)} ← ${m.brand_feed} (${m.routed_via})`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("bcorp-merge failed:", err);
    process.exit(1);
  });
}
