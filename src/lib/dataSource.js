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
import { Capacitor } from "@capacitor/core";

const ENABLED = String(import.meta.env.VITE_USE_SPLIT_BUNDLE ?? "true").toLowerCase() !== "false";

// H4 (2026-06-11 tech review): on native iOS, relative /data/ paths resolve
// to assets FROZEN into the .ipa at build time — installed apps never saw a
// nightly data refresh between App Store releases, despite this file's old
// comments claiming otherwise. Native now fetches LIVE production data first
// (CORS enabled on /data/* in vercel.json) and falls back to the bundled
// copy when offline. Web behavior is unchanged (relative = same origin).
const REMOTE_BASE = "https://www.trunorthapp.com";
const IS_NATIVE = (() => {
  try { return Capacitor.isNativePlatform() === true; } catch { return false; }
})();

// Staleness signal for the UI: "live" | "bundled" | null (web/unknown).
// App.jsx shows a data-may-be-stale banner when this lands on "bundled".
let nativeDataSource = null;
export function getNativeDataSource() { return IS_NATIVE ? nativeDataSource : null; }

// Funnel fix (2026-06-12 review): the same .ipa-frozen-origin problem that hit
// /data/* also silently broke EVERY /api/* POST on native — fetch("/api/subscribe")
// resolves to capacitor://localhost/api/subscribe (no server there), so on-device
// email capture, Pro-waitlist signups, and corrections were lost while the UI
// reported success. Route API calls to the real origin on native; web stays
// same-origin relative. Vercel CORS + the per-route OPTIONS handlers allow the
// capacitor:// origin.
export function apiUrl(path) {
  return IS_NATIVE ? REMOTE_BASE + path : path;
}

export { fetchData as fetchAppData }; // App.jsx routes its own /data/ fetches through this

async function fetchData(path, { timeoutMs = 12_000 } = {}) {
  if (IS_NATIVE) {
    try {
      const r = await fetch(REMOTE_BASE + path, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) {
        if (nativeDataSource !== "bundled") nativeDataSource = "live";
        return r;
      }
    } catch { /* offline / blocked → bundled copy below */ }
    nativeDataSource = "bundled";
    return fetch(path);
  }
  return fetch(path);
}

let indexPromise = null;
let searchPromise = null;
let aliasMap = {};   // legacy/duplicate slug -> canonical slug (slug-aliases.json)
const detailCache = new Map();

export function isSplitBundleEnabled() {
  return ENABLED;
}

/** Legacy/merged slug → canonical slug. Loaded with the index. The client used
 *  to ignore slug-aliases.json (it was pipeline-only), so merged duplicates and
 *  old deep-links (e.g. /company/exxon → exxon-mobil after the 2026-07 dedup)
 *  404'd to home. Now the client resolves them. */
export function getAliasMap() { return aliasMap; }
export function resolveAlias(slug) { return (slug && aliasMap[slug]) || slug; }

/** Load the compact list of all companies. Renders the home screen quickly.
 *  Also loads the small slug-alias map so deep-link resolution has it ready by
 *  the time the company list renders (awaited together — aliases are tiny). */
export async function loadCompanyIndex() {
  if (!indexPromise) {
    indexPromise = Promise.all([
      fetchData("/data/index.json").then(r => {
        if (!r.ok) throw new Error(`index.json HTTP ${r.status}`);
        return r.json();
      }),
      fetchData("/data/_meta/slug-aliases.json")
        .then(r => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ]).then(([idx, aliases]) => { aliasMap = aliases || {}; return idx; });
  }
  return indexPromise;
}

/** Load and rehydrate the MiniSearch index. Called lazily after first paint. */
export async function loadSearchIndex() {
  if (!searchPromise) {
    searchPromise = fetchData("/data/search-index.json")
      .then(r => {
        if (!r.ok) throw new Error(`search-index.json HTTP ${r.status}`);
        // H2 fix: MiniSearch.loadJSON takes the raw STRING — the old
        // r.json() → JSON.stringify() → loadJSON re-parse round-tripped 6MB
        // through the main thread three times.
        return r.text();
      })
      .then(text => MiniSearch.loadJSON(text, {
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
  const canon = aliasMap[slug] || slug;   // redirect merged/legacy slugs to canonical
  if (detailCache.has(canon)) return detailCache.get(canon);
  const p = fetchData(`/data/companies/${canon}.json`)
    .then(r => {
      if (!r.ok) throw new Error(`${canon}.json HTTP ${r.status}`);
      return r.json();
    })
    .catch(err => {
      // Don't poison the cache on transient failures
      detailCache.delete(canon);
      throw err;
    });
  detailCache.set(canon, p);
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
//   2. /data/_meta/feature-flags.json (runtime fetch) — as of the H4 fix
//      (2026-06-11) native iOS fetches this LIVE from production via
//      fetchData(), so a Vercel redeploy genuinely flips iOS without a new
//      App Store submission. (Before H4 this comment was wrong: the fetch
//      resolved to the copy frozen inside the .ipa.) Offline launches fall
//      back to the bundled copy, i.e. the flag state at build time.
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
    featureFlagsPromise = fetchData("/data/_meta/feature-flags.json")
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
    brandParentPromise = fetchData("/data/_meta/brand-parent-map.json")
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
    upcCachePromise = fetchData("/data/_meta/upc-to-slug.json")
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  return upcCachePromise;
}
