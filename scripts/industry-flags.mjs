#!/usr/bin/env node
/**
 * B-15 — Industry-membership flags merger.
 *
 * Walks every per-company JSON in public/data/companies/ and stamps a
 * `co.industry_flags` object based on curated allow-lists per industry:
 *
 *   tobacco            — scripts/industry-allowlists/tobacco.json
 *   fossil_fuel        — scripts/industry-allowlists/fossil-fuel.json
 *   firearms_industry  — scripts/industry-allowlists/firearms-industry.json
 *   alcohol            — scripts/industry-allowlists/alcohol.json
 *
 * MATCH BASIS (deliberately narrow — we'd rather miss a tag than mistag):
 *   1. Direct slug match against the allow-list keys.
 *   2. Slug-alias resolution via public/data/_meta/slug-aliases.json
 *      (e.g. the alias map sends "exxon" -> "exxon-mobil").
 *   3. Sub-brand resolution via public/data/_meta/brand-parent-map.json:
 *      if a company's slug appears as a SUB-BRAND whose parent is on the
 *      list, the sub-brand also gets tagged. (e.g. "budweiser" -> "anheuser-busch"
 *      -> alcohol=true).
 *
 * COLLISION GUARD (steps 2 + 3 only — derived matches):
 *   Generic / common-word slugs collide between a real industry sub-brand and
 *   an UNRELATED well-known company that happens to share the slug. Examples:
 *     "on"        — On Holding (ONON, running-shoe maker, SIC 3021) vs Altria's
 *                   "on!" nicotine pouches  -> would wrongly tag tobacco.
 *     "star"      — Star Holdings (STHO, real-estate lessor, SIC 6519) vs
 *                   Heineken "Star" lager   -> would wrongly tag alcohol.
 *     "patagonia" — Patagonia apparel vs AB InBev "Cerveza Patagonia".
 *     "next"      — Next plc (UK retailer) vs Philip Morris "Next" cigarettes.
 *     "jet"       — Jet (retail) vs Phillips 66 "Jet" petrol stations.
 *   A bare parent_map / alias hit is NOT enough for these. A derived match is
 *   suppressed when EITHER:
 *     (a) the company carries its OWN SIC code that is inconsistent with the
 *         industry (a footwear SIC must never become tobacco; a real-estate /
 *         financial SIC must never become alcohol), OR
 *     (b) the slug is on the AMBIGUOUS_SLUGS denylist and there is no
 *         corroborating in-industry SIC.
 *   Direct slug matches (step 1) are authoritative and bypass the guard — if a
 *   company's literal slug is an allow-list key, we trust it.
 *
 * NO fuzzy name matching. NO substring matching. NO Wikipedia-industry-string
 * scraping (Altria's Wikipedia industry field literally says "tobacco industry"
 * but we deliberately do not use that as a basis — too fragile, too many
 * brand-name collisions). If something's missing, add it to the JSON file.
 *
 * SCHEMA WRITTEN
 *   co.industry_flags = {
 *     tobacco: boolean,
 *     fossil_fuel: boolean,
 *     firearms_industry: boolean,
 *     alcohol: boolean,
 *     sources: {
 *       tobacco?: { matchBasis: "slug" | "parent_map" | "alias", role?: string },
 *       ...
 *     },
 *     lastUpdated: ISO timestamp
 *   }
 *
 * Independent of co.firearms_atf_ffl (B-37) — that field captures
 * federal license disclosure; this captures industry membership. A brand
 * can have FFL=true but firearms_industry=false (e.g. Walmart) and vice
 * versa (a manufacturer with no current FFL on file).
 *
 * USAGE
 *   node scripts/industry-flags.mjs            # write changes to disk
 *   node scripts/industry-flags.mjs --dry      # dry-run, report only
 *
 * EXIT CODES
 *   0 — success
 *   1 — IO or parse error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const COMPANIES_DIR = path.join(REPO_ROOT, "public", "data", "companies");
const ALLOWLISTS_DIR = path.join(__dirname, "industry-allowlists");
const ALIASES_PATH = path.join(REPO_ROOT, "public", "data", "_meta", "slug-aliases.json");
const PARENT_MAP_PATH = path.join(REPO_ROOT, "public", "data", "_meta", "brand-parent-map.json");

export const FLAG_FILES = [
  { flag: "tobacco",           file: "tobacco.json" },
  { flag: "fossil_fuel",       file: "fossil-fuel.json" },
  { flag: "firearms_industry", file: "firearms-industry.json" },
  { flag: "alcohol",           file: "alcohol.json" },
];

/**
 * Generic / ambiguous slugs (common English words or famous unrelated brand
 * names) that are known to collide with an industry sub-brand of the same name
 * via the brand-parent-map. For these, a derived (parent_map/alias) match is
 * only honored when corroborated by an in-industry SIC — see derivedMatchAllowed().
 * Curators: add a slug here when a generic-word company is wrongly tagged.
 */
export const AMBIGUOUS_SLUGS = new Set([
  "on",        // On Holding (ONON, footwear) vs Altria "on!" pouches
  "star",      // Star Holdings (STHO, real estate) vs Heineken "Star"
  "patagonia", // Patagonia apparel vs AB InBev "Cerveza Patagonia"
  "next",      // Next plc (UK retailer) vs Philip Morris "Next" cigarettes
  "jet",       // Jet (retail) vs Phillips 66 "Jet" petrol
]);

/**
 * SIC code ranges [lo, hi] (inclusive) that DEFINE each industry. Used to
 * corroborate or veto derived matches: a company that carries its OWN SIC
 * (i.e. it is a distinct EDGAR filer, not just a brand routed to a parent)
 * is industry-consistent only if that SIC falls inside one of these ranges.
 */
export const INDUSTRY_SIC_RANGES = {
  // Major group 21 — Tobacco Products.
  tobacco: [[2100, 2199]],
  // Beverages (malt/beer/wine/liquor) + wholesale + drinking places + liquor stores.
  alcohol: [[2080, 2085], [5180, 5182], [5810, 5813], [5921, 5921]],
  // Coal/oil & gas extraction, petroleum refining, pipelines, gas utilities,
  // petroleum wholesale, fuel dealers.
  fossil_fuel: [
    [1200, 1399], [2900, 2999], [4610, 4619],
    [4922, 4925], [4931, 4932], [5170, 5172], [5983, 5983],
  ],
  // Ordnance & accessories (incl. small arms 3484, ammunition 3482), guided
  // missiles, sporting-goods wholesale/retail.
  firearms_industry: [[3480, 3489], [3760, 3769], [5091, 5091], [5941, 5941]],
};

/**
 * @returns {true|false|null} true = SIC is in-industry, false = SIC present but
 * outside the industry, null = no usable SIC on the company.
 */
export function sicInIndustry(sic, flag) {
  const n = typeof sic === "number" ? sic : Number(sic);
  if (!Number.isFinite(n)) return null;
  const ranges = INDUSTRY_SIC_RANGES[flag] || [];
  for (const [lo, hi] of ranges) {
    if (n >= lo && n <= hi) return true;
  }
  return false;
}

/**
 * Guard for derived (parent_map / alias) matches against generic-slug
 * collisions. Returns whether the derived flag should be applied.
 */
export function derivedMatchAllowed(flag, sic, slug) {
  const consistent = sicInIndustry(sic, flag); // true | false | null
  if (consistent === false) return false;      // own SIC contradicts the industry
  if (consistent === true) return true;        // own SIC corroborates the industry
  // No usable own SIC: trust the curated map unless the slug is a known collider.
  if (AMBIGUOUS_SLUGS.has(slug)) return false;
  return true;
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadAllowlist(filePath) {
  const raw = loadJSON(filePath);
  // Strip _comment, _format keys.
  const out = {};
  for (const [slug, entry] of Object.entries(raw)) {
    if (slug.startsWith("_")) continue;
    out[slug] = entry;
  }
  return out;
}

/**
 * Load the allow-lists + alias map + parent map into a single context object.
 * Pure data — the classify() function takes this so it stays unit-testable.
 */
export function buildContext() {
  const allowlists = {};
  for (const { flag, file } of FLAG_FILES) {
    const p = path.join(ALLOWLISTS_DIR, file);
    if (!fs.existsSync(p)) {
      throw new Error(`[industry-flags] missing allow-list: ${p}`);
    }
    allowlists[flag] = loadAllowlist(p);
  }
  const aliases = fs.existsSync(ALIASES_PATH) ? loadJSON(ALIASES_PATH) : {};
  const parentMap = fs.existsSync(PARENT_MAP_PATH) ? loadJSON(PARENT_MAP_PATH) : {};
  return { allowlists, aliases, parentMap };
}

/**
 * Decide each industry flag for one company. Pure function over the context.
 * @returns {{ flags: Record<string, boolean>, sources: Record<string, object> }}
 */
export function classify(co, ctx) {
  const { allowlists, aliases, parentMap } = ctx;
  const slug = (co.slug || "").toLowerCase();
  if (!slug) return { flags: {}, sources: {} };

  const sic = co.sic;
  const flags = {};
  const sources = {};

  for (const { flag } of FLAG_FILES) {
    const list = allowlists[flag];

    // 1. Direct slug match — authoritative, bypasses the collision guard.
    if (list[slug]) {
      flags[flag] = true;
      sources[flag] = { matchBasis: "slug", role: list[slug].role || list[slug].subsector || null };
      continue;
    }

    // 2. Alias resolution — does the alias target appear in the list? (guarded)
    const alias = aliases[slug] || null;
    if (alias && list[alias]) {
      if (derivedMatchAllowed(flag, sic, slug)) {
        flags[flag] = true;
        sources[flag] = { matchBasis: "alias", role: list[alias].role || list[alias].subsector || null, aliasOf: alias };
        continue;
      }
      flags[flag] = false;
      continue;
    }

    // 3. Parent-map: is this a sub-brand whose parent is on the list? (guarded)
    const pe = parentMap[slug];
    const parent = pe && typeof pe === "object" ? pe.parent : null;
    if (parent && list[parent]) {
      if (derivedMatchAllowed(flag, sic, slug)) {
        flags[flag] = true;
        sources[flag] = { matchBasis: "parent_map", role: list[parent].role || list[parent].subsector || null, parent };
        continue;
      }
      flags[flag] = false;
      continue;
    }

    flags[flag] = false;
  }

  return { flags, sources };
}

function main() {
  const DRY = process.argv.includes("--dry") || process.argv.includes("--dry-run");
  if (DRY) console.log("[industry-flags] DRY-RUN — no files will be modified.\n");

  let ctx;
  try {
    ctx = buildContext();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { allowlists } = ctx;

  console.log("[industry-flags] allow-list sizes:");
  for (const { flag } of FLAG_FILES) {
    console.log(`  ${flag.padEnd(20)} ${Object.keys(allowlists[flag]).length}`);
  }
  console.log("");

  // --- walk companies ---
  const files = fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json"));
  console.log(`[industry-flags] scanning ${files.length.toLocaleString()} company files...`);

  const matches = { tobacco: [], fossil_fuel: [], firearms_industry: [], alcohol: [] };
  let touched = 0;
  let errors = 0;

  for (const file of files) {
    const full = path.join(COMPANIES_DIR, file);
    let co;
    try {
      co = loadJSON(full);
    } catch (e) {
      console.warn(`  parse error: ${file} — ${e.message}`);
      errors++;
      continue;
    }

    // Skip files that don't look like company entries (no name/slug).
    if (!co || typeof co !== "object" || (!co.name && !co.slug)) continue;

    // Make sure slug is populated — most files have it, but fall back to filename.
    if (!co.slug) co.slug = file.replace(/\.json$/, "");

    const { flags, sources } = classify(co, ctx);
    const anyTrue = Object.values(flags).some(v => v === true);

    if (anyTrue) {
      for (const [flag, on] of Object.entries(flags)) {
        if (on) matches[flag].push({ slug: co.slug, name: co.name, basis: sources[flag] });
      }
    }

    // Decide whether the current file's industry_flags differs from new.
    const existing = co.industry_flags || null;
    const next = {
      tobacco: !!flags.tobacco,
      fossil_fuel: !!flags.fossil_fuel,
      firearms_industry: !!flags.firearms_industry,
      alcohol: !!flags.alcohol,
      sources,
      lastUpdated: new Date().toISOString(),
    };

    const sameFlags =
      existing &&
      existing.tobacco === next.tobacco &&
      existing.fossil_fuel === next.fossil_fuel &&
      existing.firearms_industry === next.firearms_industry &&
      existing.alcohol === next.alcohol;

    if (!anyTrue && !existing) continue; // nothing to write
    if (sameFlags) continue;             // no functional change

    touched++;
    if (!DRY) {
      co.industry_flags = next;
      fs.writeFileSync(full, JSON.stringify(co));
    }
  }

  // --- report ---
  console.log("");
  console.log("[industry-flags] match counts per flag:");
  for (const { flag } of FLAG_FILES) {
    console.log(`  ${flag.padEnd(20)} ${matches[flag].length}`);
  }
  console.log("");

  for (const { flag } of FLAG_FILES) {
    const top = matches[flag].slice(0, 10);
    if (top.length === 0) continue;
    console.log(`[industry-flags] top ${top.length} matches for ${flag}:`);
    for (const m of top) {
      const basis = m.basis?.matchBasis || "?";
      const extra = m.basis?.parent ? ` (via parent ${m.basis.parent})` :
                    m.basis?.aliasOf ? ` (via alias ${m.basis.aliasOf})` : "";
      console.log(`  - ${m.slug.padEnd(40)} ${m.name || "?"}  [${basis}]${extra}`);
    }
    console.log("");
  }

  console.log(`[industry-flags] touched ${touched} file(s).${DRY ? " (dry-run — no writes)" : ""}`);
  if (errors > 0) console.log(`[industry-flags] ${errors} parse error(s).`);
}

// Only run the walker when invoked directly (so the test can import classify()).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
