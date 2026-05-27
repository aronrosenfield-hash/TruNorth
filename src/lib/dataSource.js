// Phase 3.1 — Split-bundle data source.
//
// Backed by the static JSON artifacts produced by hybrid-pipeline/build-split-bundle.mjs:
//   /data/index.json              — compact list (135 KB for 718 companies)
//   /data/search-index.json       — MiniSearch serialized index (~221 KB)
//   /data/companies/<slug>.json   — full per-company detail (~4 KB each)
//   /data/meta.json               — bundle version metadata
//
// Feature-flagged: set VITE_USE_SPLIT_BUNDLE=true to enable in App.jsx. The
// default (off) keeps the legacy monolithic companies.js import alive so we
// can roll this out gradually.

import MiniSearch from "minisearch";

const ENABLED = String(import.meta.env.VITE_USE_SPLIT_BUNDLE || "").toLowerCase() === "true";

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
