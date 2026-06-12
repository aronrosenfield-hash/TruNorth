// Shared bundle-index builder — the ONE place that defines the compact
// index.json entry shape and the score→grade mapping.
//
// History: scripts/rebuild-bundle-index.mjs (npm run build) and
// scripts/finalize-bundle.mjs (manual post-rebake) each carried their own
// copy of this logic and kept drifting apart (2026-06-11: finalize had
// dropped `excl`, rebuild was reading a `grade` field company files don't
// carry). Both now import from here. If the entry shape or thresholds
// change, change them here only.
//
// Consumers of the entry shape: App.jsx Top Picks / search results /
// typeahead render straight from index.json; finalize-bundle feeds these
// entries to MiniSearch for search-index.json.

import fs from "node:fs";
import path from "node:path";

// Same key list as App.jsx computeScore — keep in sync if categories change.
export const CATEGORIES = [
  "political","charity","environment","labor","dei","animals","guns","privacy","execPay"
];

const NO_REC_RE = /^\s*no public record found\.?\s*$/i;

// SCORING V3 (2026-06-11): company files carry only `overall` (already
// evidence-shrunk by rebake-scoring.mjs); the letter grade is derived here.
// Thresholds frozen from the one-time V3 recalibration — keep in sync with
// src/App.jsx scoreGrade and scripts/rebake-scoring.mjs gradeFromOverall.
export function scoreGrade(n) {
  if (n == null) return "?";
  if (n >= 63) return "A";
  if (n >= 56) return "B";
  if (n >= 46) return "C";
  if (n >= 41) return "D";
  return "F";
}

// Compact bundle entry built from a per-company detail JSON. Includes
// everything App.jsx renders from the index — plus `excl` and `flags` so
// computeScore() gets identical inputs on the collapsed row and the
// expanded detail (no grade flicker on tap).
// Review fix (2026-06-11): the EDGAR expansion added 1,583 NYSE/Nasdaq
// mid-caps — correct for coverage, wrong for a consumer shopping app's
// DEFAULT browse/discovery surfaces (search "a" shouldn't surface regional
// banks above Adidas). consumerFacing=false marks entries the app down-ranks
// in search and hides from Browse unless "Show all companies" is on.
// Heuristic: consumer-sector cats are consumer by default; B2B-leaning cats
// (and the zero-data EDGAR cohort) need consumer EVIDENCE — a store
// footprint, curated logo, recall history, or UPC/brand-map presence proxy.
const CONSUMER_CATS = new Set([
  "Retail", "Grocery", "Food & Beverage", "Consumer Goods",
  "Apparel & Fashion", "Beauty & Personal Care", "Hospitality",
  "Automotive", "Sports & Outdoor", "Travel & Transportation",
]);
function isConsumerFacing(co) {
  const evidence = !!(co.storeFootprint || co.logoUrl || co.recalls?.recalls?.length || co.upcCount || co.products);
  if (co.addedBy === "edgar-expansion-2026-06" && (co.realCats ?? 0) === 0 && !evidence) return false;
  if (CONSUMER_CATS.has(co.cat)) return true;
  // Tech / Entertainment / Healthcare / Financial / Energy / Mfg / Professional:
  // consumer only with evidence (Netflix has a logo + products; a midcap
  // drilling servicer doesn't).
  return evidence;
}

export function indexEntryFromCompanyFile(slug, co) {
  // Categories whose narrative says "No public record found" are excluded
  // from weighted scoring; mirror that decision into the bundle.
  const excl = CATEGORIES.filter(k => NO_REC_RE.test(String(co[k]?.s || "")));

  // PR-2: per-category flags (na / notDisclosed / _inferred), authored in
  // detail JSON by scripts/reflag-categories.mjs. Omitted when empty so the
  // bundle stays small.
  const flags = co.flags && typeof co.flags === "object" && Object.keys(co.flags).length > 0
    ? co.flags
    : undefined;

  return {
    id:             co.id || slug,
    slug,
    name:           co.name,
    cat:            co.cat,
    init:           co.init,
    grade:          scoreGrade(co.overall),
    score:          co.overall,
    overall:        co.overall,
    realCats:       typeof co.realCats === "number" ? co.realCats : null,
    // V3: per-category continuous scores baked by rebake-scoring.mjs — the
    // client scores collapsed index rows and expanded detail identically.
    ...(co.csc ? { csc: co.csc } : {}),
    ab:             co.ab,
    ac:             co.ac,
    sc:             co.sc,
    excl,
    flags,
    foreignOwned:   co.foreignOwned,
    foreignCountry: co.foreignCountry,
    antitrust:      co.antitrust,
    childLabor:     co.childLabor,
    stillInRussia:  co.stillInRussia,
    competitors:    co.competitors,
    logoUrl:        co.logoUrl,
    hasRecall:      co.recalls?.recalls?.length > 0,
    ...(isConsumerFacing(co) ? {} : { consumerFacing: false }),
    recallSeverity: co.recalls?.severityMax,
    // bdsListed lives at ownership.bdsListed in company files (never
    // top-level). Emit a compact boolean only when set.
    ...(co.ownership?.bdsListed ? { bdsListed: true } : {}),
  };
}

// Full pipeline: read every company file, build entries, sort by name for
// stable diffs, write index.json. Both generator scripts call this, so
// their outputs are byte-identical by construction.
export function buildBundleIndex(companiesDir, outPath, { tag = "bundle-index" } = {}) {
  const files = fs.readdirSync(companiesDir).filter(f => f.endsWith(".json"));
  console.log(`[${tag}] reading ${files.length} company files`);

  const entries = [];
  let withExcl = 0;
  let withFlags = 0;
  for (const file of files) {
    const slug = file.slice(0, -5); // strip .json
    let co;
    try {
      co = JSON.parse(fs.readFileSync(path.join(companiesDir, file), "utf-8"));
    } catch (err) {
      console.warn(`[${tag}] skip ${slug} — parse error: ${err.message}`);
      continue;
    }
    if (!co.name) {
      console.warn(`[${tag}] skip ${slug} — no name field`);
      continue;
    }
    const entry = indexEntryFromCompanyFile(slug, co);
    if (entry.excl.length) withExcl++;
    if (entry.flags) withFlags++;
    entries.push(entry);
  }

  entries.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  fs.writeFileSync(outPath, JSON.stringify(entries));
  console.log(`[${tag}] wrote ${entries.length} entries to ${outPath}`);
  console.log(`[${tag}] ${withExcl} have at least one excluded category`);
  console.log(`[${tag}] ${withFlags} have at least one PR-2 flag`);
  return entries;
}
