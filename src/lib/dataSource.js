// Phase 3.1 — Split-bundle data source.
//
// Backed by the static JSON artifacts produced by hybrid-pipeline/build-split-bundle.mjs:
//   /data/index.json              — compact list (135 KB for 718 companies)
//   /data/search-index.json       — MiniSearch serialized index (~221 KB)
//   /data/companies/<slug>.json   — full per-company detail (~4 KB each)
//   /data/meta.json               — bundle version metadata
//
// Phase 4.11: Split-bundle is now the DEFAULT (production has 6,050 companies
// in the split bundle; the legacy companies.js monolith only has 718 stale
// entries and is just a fallback if the split bundle fetch fails).
// Explicitly set VITE_USE_SPLIT_BUNDLE=false to opt out (e.g. for debugging).

import MiniSearch from "minisearch";

const ENABLED = String(import.meta.env.VITE_USE_SPLIT_BUNDLE ?? "true").toLowerCase() !== "false";

let indexPromise = null;
let searchPromise = null;
const detailCache = new Map();

export function isSplitBundleEnabled() {
  return ENABLED;
}

/** Load the compact list of all companies. Renders the home screen quickly. */
export async function loadCompanyIndex() {
  if (!indexPromise) {
    indexPromise = fetch("/data/index.json")
      .then(r => {
        if (!r.ok) throw new Error(`index.json HTTP ${r.status}`);
        return r.json();
      });
  }
  return indexPromise;
}

/** Load and rehydrate the MiniSearch index. Called lazily after first paint. */
export async function loadSearchIndex() {
  if (!searchPromise) {
    searchPromise = fetch("/data/search-index.json")
      .then(r => {
        if (!r.ok) throw new Error(`search-index.json HTTP ${r.status}`);
        return r.json();
      })
      .then(json => MiniSearch.loadJSON(JSON.stringify(json), {
        fields: ["name", "cat"],
        storeFields: ["id", "slug", "name", "cat", "grade", "score", "init", "ab", "ac", "political"],
        searchOptions: { boost: { name: 2 }, prefix: true, fuzzy: 0.2 },
      }));
  }
  return searchPromise;
}

/** Lazy-load full detail for one company. Cached in-memory for the session. */
export async function loadCompanyDetail(slug) {
  if (!slug) return null;
  if (detailCache.has(slug)) return detailCache.get(slug);
  const p = fetch(`/data/companies/${slug}.json`)
    .then(r => {
      if (!r.ok) throw new Error(`${slug}.json HTTP ${r.status}`);
      return r.json();
    })
    .catch(err => {
      // Don't poison the cache on transient failures
      detailCache.delete(slug);
      throw err;
    });
  detailCache.set(slug, p);
  return p;
}

/** Prefetch a small number of likely-tapped companies so they're warm in cache. */
export function warmDetailCache(slugs, limit = 6) {
  if (!Array.isArray(slugs)) return;
  slugs.slice(0, limit).forEach(s => { loadCompanyDetail(s).catch(() => {}); });
}

// ─── Feature flags (PR-3) ────────────────────────────────────────────────────
// Two layers of control so we can roll back at any speed:
//   1. VITE_SCORING_FLAGS_ENABLED (env, build-time) — set on Vercel, redeploy.
//      Best for web (one click in Vercel UI, ~2 min to propagate). Cannot
//      reach iOS once a build is in Apple's review queue.
//   2. /data/_meta/feature-flags.json (runtime fetch) — bundled into the iOS
//      app at build time but FETCHED FRESH on each launch from the bundle
//      assets, so a Vercel redeploy of public/data/_meta/feature-flags.json
//      can flip iOS WITHOUT a new App Store submission… provided the user's
//      installed build already includes this fetch path. Once 1.0.1 is in
//      everyone's hands, this is the only iOS kill switch we have.
//
// Effective flag = (env === 'true') OR (runtime.scoringFlagsEnabled === true).
// Default is OFF: unset env + JSON value `false` ⇒ flag off ⇒ pixel-identical
// to today's UI.

const ENV_SCORING_FLAGS = String(import.meta.env?.VITE_SCORING_FLAGS_ENABLED ?? "")
  .toLowerCase() === "true";

let featureFlagsPromise = null;
// Cached resolved value so synchronous code (computeScore is called 280K+
// times per Top Picks render) doesn't pay a Promise tax.
let featureFlagsResolved = { scoringFlagsEnabled: false };

/** Lazy-load /data/_meta/feature-flags.json. Returns {} on fetch failure. */
export async function loadFeatureFlags() {
  if (!featureFlagsPromise) {
    featureFlagsPromise = fetch("/data/_meta/feature-flags.json")
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then(json => {
        // Strip the _doc key (it's documentation, not a flag).
        const flags = { ...(json || {}) };
        delete flags._doc;
        featureFlagsResolved = { ...featureFlagsResolved, ...flags };
        return featureFlagsResolved;
      });
  }
  return featureFlagsPromise;
}

/**
 * Synchronous check used by the scoring engine (computeScore is hot).
 * Returns true iff either the env-var OR the cached runtime flag is on.
 * Safe to call before loadFeatureFlags() resolves — defaults to OFF.
 */
export function featureFlagsEnabled() {
  return ENV_SCORING_FLAGS || featureFlagsResolved.scoringFlagsEnabled === true;
}

let brandParentPromise = null;
let upcCachePromise = null;

/**
 * Load the brand → parent-slug fallback map. Used by the in-store barcode
 * scanner: Open Food Facts often returns a sub-brand like "Oreo" or
 * "Nabisco" that isn't a top-level company in our index, but maps to a
 * parent (Mondelez International) that IS. Without this fallback the
 * scanner shows "no match" for very recognizable products.
 *
 * Shape: { [normalizedBrandKey]: { parent: "<slug>", confidence: "high"|"medium"|"low" } }
 * Normalization: lowercase, alphanumeric-only (same as App.jsx resolveBrand()).
 * Returns {} on fetch failure so callers can degrade gracefully.
 */
export async function loadBrandParentMap() {
  if (!brandParentPromise) {
    brandParentPromise = fetch("/data/_meta/brand-parent-map.json")
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  return brandParentPromise;
}

/**
 * Load the static UPC → parent-slug cache shipped with the app. Used by the
 * in-store barcode scanner so the most common ~3-5k US grocery / household
 * UPCs resolve INSTANTLY, with no network round-trip to Open Food Facts.
 * In-store cell reception is unreliable, and a cached hit also makes the
 * scanner feel snappier than the ~300-800 ms OFF API call.
 *
 * Shape: { [upc: string]: { slug: "<parent-slug>", brand: "<OFF brand>", name: "<product>" } }
 * Built by scripts/build-upc-cache.mjs (monthly). Returns {} on fetch failure
 * so callers degrade gracefully back to the live OFF lookup.
 */
export async function loadUpcCache() {
  if (!upcCachePromise) {
    upcCachePromise = fetch("/data/_meta/upc-to-slug.json")
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  return upcCachePromise;
}
