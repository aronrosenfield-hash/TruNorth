// Rebuild public/data/index.json from the per-company JSON files.
// Adds an `excl` array per company that lists categories whose narrative text
// says "No public record found" — so computeScore() can apply the same
// exclusion logic to the BUNDLE (collapsed row) as it does to the DETAIL
// (expanded row). Without this, the grade flickers from one letter to
// another when the user taps a brand.
//
// Why: index.json is the compact list shipped in the JS bundle, used by
// Top Picks list rendering, search index, etc. Per-company JSON files are
// lazy-loaded on detail expand. Both should produce the same grade.
//
// Run: node scripts/rebuild-bundle-index.mjs
// Auto-runs via npm run build (added to package.json scripts.build).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPANIES_DIR = path.join(ROOT, "public", "data", "companies");
const OUT_PATH      = path.join(ROOT, "public", "data", "index.json");
const NO_REC_RE     = /^\s*no public record found\.?\s*$/i;

// Same key list as App.jsx computeScore — keep in sync if categories change.
const CATEGORIES = [
  "political","charity","environment","labor","dei","animals","guns","privacy","execPay"
];

const files = fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json"));
console.log(`[bundle-index] reading ${files.length} company files`);

const entries = [];
let withExcl = 0;
for (const file of files) {
  const slug = file.slice(0, -5); // strip .json
  let co;
  try {
    co = JSON.parse(fs.readFileSync(path.join(COMPANIES_DIR, file), "utf-8"));
  } catch (err) {
    console.warn(`[bundle-index] skip ${slug} — parse error: ${err.message}`);
    continue;
  }

  // Compute the exclusion array — which categories should be excluded from
  // weighted scoring because they say "No public record found".
  const excl = CATEGORIES.filter(k => NO_REC_RE.test(String(co[k]?.s || "")));
  if (excl.length) withExcl++;

  // Compact bundle entry shape. Includes everything App.jsx renders from the
  // index for Top Picks / Search results / typeahead — plus the new `excl`.
  entries.push({
    id:             co.id || slug,
    slug,
    name:           co.name,
    cat:            co.cat,
    init:           co.init,
    grade:          co.grade,
    score:          co.score,
    overall:        co.overall,
    ab:             co.ab,
    ac:             co.ac,
    sc:             co.sc,
    excl,                                  // NEW — for parity with detail
    foreignOwned:   co.foreignOwned,
    foreignCountry: co.foreignCountry,
    antitrust:      co.antitrust,
    childLabor:     co.childLabor,
    stillInRussia:  co.stillInRussia,
    competitors:    co.competitors,
    logoUrl:        co.logoUrl,
    hasRecall:      co.recalls?.recalls?.length > 0,
    recallSeverity: co.recalls?.severityMax,
    bdsListed:      co.bdsListed,
  });
}

// Sort by name for stable diffs
entries.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

fs.writeFileSync(OUT_PATH, JSON.stringify(entries));
console.log(`[bundle-index] wrote ${entries.length} entries to ${OUT_PATH}`);
console.log(`[bundle-index] ${withExcl} have at least one excluded category`);
