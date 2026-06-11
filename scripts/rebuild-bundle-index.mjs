// Rebuild public/data/index.json from the per-company JSON files.
//
// Why: index.json is the compact list shipped in the JS bundle, used by
// Top Picks list rendering, search index, etc. Per-company JSON files are
// lazy-loaded on detail expand. Both must produce the same grade — the
// entries carry `excl` + `flags` so computeScore() gets identical inputs
// on the collapsed row and the expanded detail (no grade flicker on tap).
//
// All entry-shape logic lives in scripts/lib/index-entry.mjs, shared with
// scripts/finalize-bundle.mjs (the manual post-rebake step that also
// rebuilds search-index.json + meta.json). Change the shape there only.
//
// Run: node scripts/rebuild-bundle-index.mjs
// Auto-runs via npm run build (added to package.json scripts.build).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundleIndex } from "./lib/index-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

buildBundleIndex(
  path.join(ROOT, "public", "data", "companies"),
  path.join(ROOT, "public", "data", "index.json"),
);
