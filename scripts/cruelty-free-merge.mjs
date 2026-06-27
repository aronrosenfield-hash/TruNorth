#!/usr/bin/env node
/**
 * Cruelty-free merger (weekly) — B-14.
 *
 * Reads two raw snapshots:
 *   public/data/_raw/leaping-bunny.json  (certified — strong positive signal)
 *   public/data/_raw/peta-bwb.json       (do_test + dont_test — both signals)
 *
 * Per TruNorth brand, resolves matches via:
 *   1. Direct slug match (slug-from-brand-name == co.slug)
 *   2. slug-aliases.json
 *   3. brand-parent-map.json (route a certified sub-brand to its parent)
 *   4. Hand-curated CRUELTY_FREE_OVERRIDES (rare mismatches)
 *
 * Writes co.enriched.cruelty_free = {
 *   leaping_bunny:    true | false | null,
 *   peta_dont_test:   true | false | null,
 *   peta_do_test:     true | false | null,
 *   last_verified:    "YYYY-MM-DD",
 *   sources:          ["leaping-bunny", "peta-bwb"],
 *   parent_company?:  string,
 *   certification_date?: string,
 *   routed_via:       "direct" | "alias" | "parent" | "override"
 * }
 *
 * Conflict policy:
 *   - leaping_bunny=true wins over peta_do_test=true (Leaping Bunny pledge is
 *     stricter than PETA's BWB DO-test database, which sometimes lists a
 *     parent company whose specific sub-brand IS certified). When both are
 *     true the merger logs a conflict.
 *
 * Orphans (rows in either feed that don't resolve to a TruNorth company)
 * are written to public/data/_meta/cruelty-free-unmatched.json for human
 * review. Many will be small indie brands not in our top-N universe —
 * that's expected.
 *
 * Locally: node scripts/cruelty-free-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const LB_FILE  = path.join(RAW_DIR, "leaping-bunny.json");
const PETA_FILE = path.join(RAW_DIR, "peta-bwb.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const UNMATCHED_FILE = path.join(META_DIR, "cruelty-free-unmatched.json");
const LOG_FILE       = path.join(META_DIR, "cruelty-free-merge-log.json");

// Hand-curated brand-slug overrides. Keys are the slugified brand name from
// the source feed; values are the target TruNorth company slug.
const CRUELTY_FREE_OVERRIDES = {
  "estee-lauder":   "est-e-lauder",
  "estee-lauder-companies": "est-e-lauder",
  "mac":            "mac-cosmetics",
  "mac-cosmetics":  "mac-cosmetics",
  // (loreal handled by slug-aliases.json — no override needed)
  "burts-bees":     "burt-s-bees",
  "lush-cosmetics": "lush",
  "lush-fresh-handmade-cosmetics": "lush",
  "the-body-shop":  "body-shop",
  "kvd-vegan-beauty": "kat-von-d",
  "kat-von-d-beauty": "kat-von-d",
  "elf-cosmetics":      "e-l-f-beauty",
  "e-l-f-cosmetics":    "e-l-f-beauty",
  "e-l-f":              "e-l-f-beauty",
};

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Strip apostrophes (curly + straight) entirely so "L'Oréal" → "loreal"
    // not "l-oreal" — matches the slug-aliases convention.
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
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

export function resolveSlug(brandName, parentName, maps) {
  const brandSlug = slugify(brandName);
  // 0. override beats everything
  if (CRUELTY_FREE_OVERRIDES[brandSlug]) {
    const tgt = CRUELTY_FREE_OVERRIDES[brandSlug];
    if (existsSync(path.join(COMP_DIR, `${tgt}.json`))) {
      return { slug: tgt, routed_via: "override" };
    }
  }
  // 1. direct file match
  if (brandSlug && existsSync(path.join(COMP_DIR, `${brandSlug}.json`))) {
    return { slug: brandSlug, routed_via: "direct" };
  }
  // 2. slug-aliases
  const alias = maps.aliases[brandSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  // 3. brand-parent-map
  const parent = maps.parents[brandSlug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  // NOTE: We deliberately do NOT auto-route to the feed-provided parent_company
  //       string when the brand itself doesn't resolve. A single LB-certified
  //       sub-brand (e.g. "Love Beauty and Planet") does NOT mean the parent
  //       holding company (Unilever) is itself certified. Parent routing must
  //       go through the curated brand-parent-map.json (high-confidence edge).
  return { slug: null, routed_via: "orphan", parent_seen: parentName || null };
}

// Merge a single brand signal into the in-memory map of slug → cruelty_free.
function applySignal(map, slug, key, value, meta) {
  if (!map.has(slug)) {
    map.set(slug, {
      leaping_bunny:  null,
      peta_dont_test: null,
      peta_do_test:   null,
      sources: [],
      meta: {},
    });
  }
  const entry = map.get(slug);
  // null → value, true wins over false for "positive" keys
  if (value === true || (entry[key] !== true && value === false)) {
    entry[key] = value;
  }
  if (meta?.source && !entry.sources.includes(meta.source)) {
    entry.sources.push(meta.source);
  }
  if (meta?.parent_company && !entry.meta.parent_company) {
    entry.meta.parent_company = meta.parent_company;
  }
  if (meta?.certification_date && !entry.meta.certification_date) {
    entry.meta.certification_date = meta.certification_date;
  }
  if (meta?.routed_via && !entry.meta.routed_via) {
    entry.meta.routed_via = meta.routed_via;
  }
}

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  console.log("Cruelty-free merge starting...");

  const lb   = await tryReadJson(LB_FILE);
  const peta = await tryReadJson(PETA_FILE);

  if (!lb && !peta) {
    // B-64: Leaping Bunny / PETA BWB are a QUARTERLY source. The weekly merge
    // legitimately has nothing to do until those fetchers have populated
    // public/data/_raw/, so skip cleanly (exit 0) rather than red-X'ing the
    // weekly cron every week between quarterly refreshes.
    console.warn("No raw cruelty-free files yet (quarterly fetchers haven't run) — nothing to merge, skipping.");
    process.exit(0);
  }

  const maps = await loadMaps();
  const slugToSignals = new Map();
  const unmatched = { leaping_bunny: [], peta_do_test: [], peta_dont_test: [] };

  // --- Leaping Bunny (positive) ---
  if (lb?.certified_brands) {
    for (const b of lb.certified_brands) {
      const { slug, routed_via } = resolveSlug(b.brand, b.parent_company, maps);
      if (!slug) {
        unmatched.leaping_bunny.push({ brand: b.brand, parent: b.parent_company || null });
        continue;
      }
      applySignal(slugToSignals, slug, "leaping_bunny", true, {
        source: "leaping-bunny",
        parent_company: b.parent_company || null,
        certification_date: b.certification_date || null,
        routed_via,
      });
    }
  }

  // --- PETA DON'T test (positive) ---
  if (peta?.dont_test) {
    for (const b of peta.dont_test) {
      const { slug, routed_via } = resolveSlug(b.brand, b.parent_company, maps);
      if (!slug) {
        unmatched.peta_dont_test.push({ brand: b.brand, parent: b.parent_company || null });
        continue;
      }
      applySignal(slugToSignals, slug, "peta_dont_test", true, {
        source: "peta-bwb",
        parent_company: b.parent_company || null,
        routed_via,
      });
    }
  }

  // --- PETA DO test (negative) ---
  if (peta?.do_test) {
    for (const b of peta.do_test) {
      const { slug, routed_via } = resolveSlug(b.brand, b.parent_company, maps);
      if (!slug) {
        unmatched.peta_do_test.push({ brand: b.brand, parent: b.parent_company || null });
        continue;
      }
      applySignal(slugToSignals, slug, "peta_do_test", true, {
        source: "peta-bwb",
        parent_company: b.parent_company || null,
        routed_via,
      });
    }
  }

  // --- Write per-company JSON ---
  const merged = [];
  const conflicts = [];
  for (const [slug, sig] of slugToSignals.entries()) {
    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) continue;
    let co;
    try { co = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch (err) {
      console.error(`  parse_error: ${slug} (${err.message})`);
      continue;
    }
    if (!co.enriched || typeof co.enriched !== "object") co.enriched = {};

    // Conflict: leaping_bunny=true beats peta_do_test=true; record the conflict.
    if (sig.leaping_bunny === true && sig.peta_do_test === true) {
      conflicts.push({ slug, note: "leaping_bunny=true AND peta_do_test=true; LB wins, peta_do_test cleared" });
      sig.peta_do_test = false;
    }

    const payload = {
      leaping_bunny:  sig.leaping_bunny,
      peta_dont_test: sig.peta_dont_test,
      peta_do_test:   sig.peta_do_test,
      last_verified:  today,
      sources:        sig.sources,
    };
    if (sig.meta.parent_company)     payload.parent_company = sig.meta.parent_company;
    if (sig.meta.certification_date) payload.certification_date = sig.meta.certification_date;
    if (sig.meta.routed_via)         payload.routed_via = sig.meta.routed_via;

    co.enriched.cruelty_free = payload;

    if (typeof co.dataLastUpdated !== "object" || co.dataLastUpdated === null) {
      co.dataLastUpdated = co.dataLastUpdated ? { legacy: co.dataLastUpdated } : {};
    }
    co.dataLastUpdated.cruelty_free = now.toISOString();

    await fs.writeFile(file, JSON.stringify(co));
    merged.push({ slug, ...payload });
  }

  // --- Logs ---
  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(UNMATCHED_FILE, JSON.stringify({
    generated_at: now.toISOString(),
    leaping_bunny_unmatched_count: unmatched.leaping_bunny.length,
    peta_dont_test_unmatched_count: unmatched.peta_dont_test.length,
    peta_do_test_unmatched_count: unmatched.peta_do_test.length,
    ...unmatched,
  }, null, 2));
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at: now.toISOString(),
    sources: ["public/data/_raw/leaping-bunny.json", "public/data/_raw/peta-bwb.json"],
    merged_count: merged.length,
    conflict_count: conflicts.length,
    conflicts,
    merged_sample: merged.slice(0, 25),
  }, null, 2));

  console.log(`Merged: ${merged.length} companies`);
  console.log(`Conflicts (LB beats PETA do_test): ${conflicts.length}`);
  console.log(`Unmatched LB: ${unmatched.leaping_bunny.length}`);
  console.log(`Unmatched PETA dont_test: ${unmatched.peta_dont_test.length}`);
  console.log(`Unmatched PETA do_test: ${unmatched.peta_do_test.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("cruelty-free-merge failed:", err);
    process.exit(1);
  });
}
