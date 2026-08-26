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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundleIndex } from "./lib/index-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INDEX_PATH = path.join(ROOT, "public", "data", "index.json");

buildBundleIndex(
  path.join(ROOT, "public", "data", "companies"),
  INDEX_PATH,
);

// ── Catalog stats, generated (2026-08-26) ───────────────────────────────────
// The coverage claim used to be a hand-typed string in three places
// (MarketingLanding + two spots in App.jsx). It said "3,000+ fully graded"
// while the shipped catalog held 2,590 — the claim had drifted from the data
// and nobody noticed, on a product whose whole position is "records, not
// opinions." Deriving it here means the number cannot go stale again: this
// script already runs on every `npm run build`, immediately before the app is
// bundled, so the constant is always computed from the catalog being shipped.
// The file is committed so a build that skips regeneration still compiles.
const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const tracked = index.length;
const graded = index.filter(c => c.grade && c.grade !== "?").length;
const fmt = (n) => n.toLocaleString("en-US");
// Mirrors formatCompanyCount() in src/App.jsx (2026-06-01 rule, 100-bucket as
// of the 2026-08-01 GEO audit): round DOWN to the nearest 100 and append "+".
// The round-DOWN is the load-bearing part — we under-claim, never over-claim.
const plus = (n) => `${(Math.floor(n / 100) * 100).toLocaleString("en-US")}+`;

const statsFile = `// GENERATED FILE — do not edit by hand.
// Written by scripts/rebuild-bundle-index.mjs on every \`npm run build\`,
// counted directly from public/data/index.json (the catalog actually shipped).
// If a coverage number in the UI looks wrong, fix the DATA or the generator —
// never hand-edit this file, and never hard-code a coverage claim in a component.

export const CATALOG_TRACKED = ${tracked};
export const CATALOG_GRADED = ${graded};
export const CATALOG_UNGRADED = ${tracked - graded};

// Display labels. Rounded DOWN to the nearest 100 with a "+", matching
// formatCompanyCount() in src/App.jsx — the standing 2026-06-01 rule that the
// app under-claims and never over-claims. Use these in user-facing copy.
// The exact figures above are for logic and internal reporting only.
export const CATALOG_TRACKED_LABEL = "${plus(tracked)}";
export const CATALOG_GRADED_LABEL = "${plus(graded)}";
export const CATALOG_UNGRADED_LABEL = "${plus(tracked - graded)}";
`;

// ── Static-surface sync ─────────────────────────────────────────────────────
// index.html and public/llms.txt are plain text — they cannot import the
// constant above, so they were maintained by hand and drifted. That drift is
// the expensive kind: index.html carries the meta description, og/twitter
// descriptions and TWO schema.org JSON-LD blocks, and llms.txt exists purely
// to be read by AI answer engines. Both were still claiming "3,000+ fully
// graded" against a 2,590-brand catalog, and llms.txt did it two lines after
// telling engines "Do not report the tracked figure as a graded figure."
// Rewrite them from the same counts, anchored on surrounding phrasing so only
// coverage numbers move. Idempotent — a no-op once they already agree.
function syncStaticCounts(file) {
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, "utf8");
  const G = plus(graded), T = plus(tracked);
  const after = before
    // graded-count sites
    .replace(/[\d,]+\+(?= brands fully graded)/g, G)
    .replace(/(?<=fully grades )[\d,]+\+/g, G)
    .replace(/(?<=and see )[\d,]+\+(?= fully graded)/g, G)
    .replace(/[\d,]+\+(?= of those currently carry)/g, G)
    .replace(/[\d,]+\+(?= fully graded)/g, G)
    // tracked-count sites
    .replace(/(?<=tracks )[\d,]+\+(?= consumer brands)/g, T)
    .replace(/(?<=Track )[\d,]+\+(?= consumer brands)/g, T)
    .replace(/[\d,]+\+(?= consumer brands)/g, T)
    .replace(/[\d,]+\+(?= brands tracked)/g, T)
    .replace(/[\d,]+\+(?= brands are tracked)/g, T)
    .replace(/[\d,]+\+(?= tracked)/g, T)
    .replace(/[\d,]+\+(?= total\.)/g, T);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(`✅ Synced coverage counts in ${path.relative(ROOT, file)}`);
  }
}
syncStaticCounts(path.join(ROOT, "index.html"));
syncStaticCounts(path.join(ROOT, "public", "llms.txt"));

const statsPath = path.join(ROOT, "src", "lib", "catalog-stats.js");
const prev = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, "utf8") : "";
if (prev !== statsFile) {
  fs.writeFileSync(statsPath, statsFile);
  console.log(`✅ Wrote ${statsPath}`);
} else {
  console.log(`   catalog-stats.js unchanged`);
}
console.log(`   catalog: ${fmt(graded)} graded / ${fmt(tracked)} tracked (${fmt(tracked - graded)} ungraded)`);
