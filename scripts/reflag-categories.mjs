// Reflag every public/data/companies/<slug>.json with a new top-level `flags`
// field that captures per-category applicability + disclosure state.
//
// This is PR-2 of the pre-launch scoring-flags rollout. It is purely ADDITIVE:
// it only writes a new `flags` key — nothing else in the detail JSON changes.
// No UI consumes `flags` yet (that lands in PR-3 behind a feature flag).
//
// Shape:
//   flags: {
//     <category>: { na: true }
//                | { notDisclosed: true }
//                | { _inferred: true, basis: "<sector>" }
//                | undefined        // (implicit — not present in JSON)
//   }
//
// Rules (verified against scoring-engine-audit §4 cat enumeration):
//   na:           per public/data/_meta/category-applicability.json (industry map)
//   execPay:      notDisclosed when no ticker AND not isPublic (no SEC filings)
//   dei:          notDisclosed when no deiBadges entry
//   charity:      notDisclosed when slug not in corporate-giving-augment.companies
//   transparency: notDisclosed when slug not in transparency-benchmarks-augment.data
//                 AND not in wikirate-augment.companies
//   environment:  _inferred when narrative is "No public record found." AND
//                 industry-carbon-intensity-augment.companies[slug] exists
//                 (basis = the company's cat string)
//
// Idempotent: running twice produces identical output (the script overwrites
// `flags` wholesale every time).
//
// Run: node scripts/reflag-categories.mjs
// Test: node --test scripts/reflag-categories.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const COMPANIES_DIR  = path.join(ROOT, "public/data/companies");
const APPLICABILITY  = path.join(ROOT, "public/data/_meta/category-applicability.json");
const OVERRIDES_PATH = path.join(ROOT, "public/data/_meta/category-applicability-overrides.json");
const GIVING_PATH    = path.join(ROOT, "data/derived/corporate-giving-augment.json");
const TRANSPARENCY_P = path.join(ROOT, "data/derived/transparency-benchmarks-augment.json");
const WIKIRATE_P     = path.join(ROOT, "data/derived/wikirate-augment.json");
const CARBON_P       = path.join(ROOT, "data/derived/industry-carbon-intensity-augment.json");

const NO_REC_RE = /^\s*no public record found\.?\s*$/i;

// 11 categories: 9 existing in computeScore + 2 new (transparency, health).
// PR-2 writes flags for all 11; PR-3 wires the UI/grade math.
const CATEGORIES = [
  "political", "charity", "environment", "labor", "dei",
  "animals",   "guns",    "privacy",     "execPay",
  "transparency", "health",
];

// ────────────────────── helpers ──────────────────────

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function safeReadJSON(p) {
  try { return readJSON(p); } catch { return null; }
}

// Build the lookup sets the reflag uses for notDisclosed / _inferred decisions.
export function buildLookups({
  applicability,
  overrides,
  giving,
  transparency,
  wikirate,
  carbon,
}) {
  const naByCat = new Map();
  for (const [cat, rec] of Object.entries(applicability?.industries || {})) {
    naByCat.set(cat, new Set(rec?.na || []));
  }
  // Per-slug overrides take precedence over cat-level applicability.
  // Shape: overrides[slug][category] = "applicable" | "na" | "notDisclosed".
  const overridesBySlug = new Map();
  for (const [slug, perCat] of Object.entries(overrides?.overrides || {})) {
    if (!perCat || typeof perCat !== "object") continue;
    overridesBySlug.set(slug, perCat);
  }
  const giverSlugs = new Set(Object.keys(giving?.companies || {}));
  const transpSlugs = new Set(Object.keys(transparency?.data || {}));
  const wikiSlugs   = new Set(Object.keys(wikirate?.companies || {}));
  const carbonSlugs = new Set(Object.keys(carbon?.companies || {}));
  return { naByCat, overridesBySlug, giverSlugs, transpSlugs, wikiSlugs, carbonSlugs };
}

// Decide the `flags` block for a single company, given the precomputed lookups.
// Pure function — no I/O. Tested directly.
export function computeFlagsForCompany(co, lookups) {
  const { naByCat, overridesBySlug, giverSlugs, transpSlugs, wikiSlugs, carbonSlugs } = lookups;
  const cat = co.cat || "Other";
  const naSet = naByCat.get(cat) || new Set();
  const slugOverrides = (overridesBySlug && overridesBySlug.get(co.slug)) || null;
  const flags = {};

  // 1. Industry-driven NA — short-circuits everything else for that cat.
  for (const k of CATEGORIES) {
    if (naSet.has(k)) flags[k] = { na: true };
  }

  // 1b. Apply per-slug overrides (take precedence over cat-level applicability).
  //     "applicable"   → remove any {na:true} for this cat so real disclosure /
  //                      score logic can run downstream.
  //     "na"           → force {na:true}.
  //     "notDisclosed" → force {notDisclosed:true} (skip further notDisclosed
  //                      checks below for that cat).
  if (slugOverrides) {
    for (const [k, mode] of Object.entries(slugOverrides)) {
      if (!CATEGORIES.includes(k)) continue;
      if (mode === "applicable") {
        delete flags[k];
      } else if (mode === "na") {
        flags[k] = { na: true };
      } else if (mode === "notDisclosed") {
        flags[k] = { notDisclosed: true };
      }
    }
  }

  // 2. Per-company notDisclosed flags (only if NOT already NA).
  const isPublicLike =
    !!co.ticker || co.isPublic === true || !!co.cik;

  if (!flags.execPay && !isPublicLike) {
    flags.execPay = { notDisclosed: true };
  }

  // dei: notDisclosed when no deiBadges present.
  // (Note: no eeoc-dei-augment.json exists in repo today — deiBadges is the
  // disclosure proxy.)
  if (!flags.dei) {
    const hasDeiSignal =
      Array.isArray(co.deiBadges) && co.deiBadges.length > 0;
    if (!hasDeiSignal) flags.dei = { notDisclosed: true };
  }

  if (!flags.charity) {
    if (!giverSlugs.has(co.slug)) flags.charity = { notDisclosed: true };
  }

  if (!flags.transparency) {
    if (!transpSlugs.has(co.slug) && !wikiSlugs.has(co.slug)) {
      flags.transparency = { notDisclosed: true };
    }
  }

  // 3. Environment _inferred fallback.
  //    Only when there is no real environment record (narrative = "No public
  //    record found.") AND the carbon-intensity augment has a sector for us.
  if (!flags.environment) {
    const envNarr = String(co.environment?.s || "");
    const hasNoRec = NO_REC_RE.test(envNarr);
    if (hasNoRec && carbonSlugs.has(co.slug)) {
      flags.environment = { _inferred: true, basis: cat };
    }
  }

  return flags;
}

// ─────────────────────── runner ───────────────────────

async function main({ dryRun = false } = {}) {
  const t0 = Date.now();

  const applicability  = readJSON(APPLICABILITY);
  const overrides      = safeReadJSON(OVERRIDES_PATH) || { overrides: {} };
  const giving         = safeReadJSON(GIVING_PATH)    || { companies: {} };
  const transparency   = safeReadJSON(TRANSPARENCY_P) || { data: {} };
  const wikirate       = safeReadJSON(WIKIRATE_P)     || { companies: {} };
  const carbon         = safeReadJSON(CARBON_P)       || { companies: {} };

  const lookups = buildLookups({ applicability, overrides, giving, transparency, wikirate, carbon });
  const overrideSlugCount = Object.keys(overrides?.overrides || {}).length;
  if (overrideSlugCount) console.log(`[reflag] loaded ${overrideSlugCount} per-slug applicability overrides`);

  const files = fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json"));
  console.log(`[reflag] reading ${files.length} company files`);

  let written = 0;
  let unchanged = 0;
  const naByCat = new Map();
  const notDiscByCat = new Map();
  const inferredByCat = new Map();
  const unknownCats = new Map();

  for (const file of files) {
    const slug = file.slice(0, -5);
    const fp = path.join(COMPANIES_DIR, file);
    let co;
    try {
      co = JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch (err) {
      console.warn(`[reflag] skip ${slug} — parse error: ${err.message}`);
      continue;
    }
    if (!co.slug) co.slug = slug; // safety — flags lookups expect it
    if (co.cat && !lookups.naByCat.has(co.cat)) {
      unknownCats.set(co.cat, (unknownCats.get(co.cat) || 0) + 1);
    }

    const flags = computeFlagsForCompany(co, lookups);

    // Tally
    for (const [k, v] of Object.entries(flags)) {
      if (v?.na)           naByCat.set(k, (naByCat.get(k) || 0) + 1);
      if (v?.notDisclosed) notDiscByCat.set(k, (notDiscByCat.get(k) || 0) + 1);
      if (v?._inferred)    inferredByCat.set(k, (inferredByCat.get(k) || 0) + 1);
    }

    // Idempotent compare: only write if `flags` changed.
    const prev = co.flags;
    const sameAsPrev = prev && JSON.stringify(prev) === JSON.stringify(flags);
    if (sameAsPrev) { unchanged++; continue; }

    co.flags = flags;

    if (!dryRun) {
      // IMPORTANT: per-company files are stored MINIFIED (single line, no
      // trailing newline) — see sampling of public/data/companies/*.json.
      // Pretty-printing would balloon the repo by ~1.8M lines of whitespace
      // and obscure real diffs. Keep `JSON.stringify(co)` (no indent arg).
      fs.writeFileSync(fp, JSON.stringify(co));
    }
    written++;
  }

  const elapsedMs = Date.now() - t0;
  console.log(`[reflag] done in ${elapsedMs}ms — wrote ${written}, unchanged ${unchanged}`);

  // Counts
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`[reflag] totals: na=${sum(naByCat)}  notDisclosed=${sum(notDiscByCat)}  _inferred=${sum(inferredByCat)}`);

  const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`).join("  ");
  console.log(`[reflag] na by cat:           ${fmt(naByCat)}`);
  console.log(`[reflag] notDisclosed by cat: ${fmt(notDiscByCat)}`);
  console.log(`[reflag] _inferred by cat:    ${fmt(inferredByCat)}`);

  if (unknownCats.size) {
    console.warn(`[reflag] WARN: ${unknownCats.size} unknown cat values not in applicability map:`);
    for (const [c, n] of unknownCats) console.warn(`         ${c}: ${n}`);
  }
}

// Entrypoint
const invoked = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "");
if (invoked) {
  const dryRun = process.argv.includes("--dry-run");
  main({ dryRun }).catch(err => {
    console.error("[reflag] FATAL:", err);
    process.exit(1);
  });
}

export { CATEGORIES, NO_REC_RE };
