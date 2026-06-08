#!/usr/bin/env node
/**
 * Climate TRACE — Step 2 (merge).
 *
 * Reads the latest data/raw/climate-trace/<date>.json snapshot and writes
 * data/derived/climate-trace-augment.json keyed by TruNorth brand slug.
 *
 * What it does
 *   1. Joins ownership ← emissions on source_id.
 *   2. Aggregates per (parent_name, year) the equity-weighted kg CO2e:
 *           sum_over_facilities( facility_year_kg * share_percent/100 )
 *      Uses the LATEST year present per parent.
 *   3. Slug-resolves each parent_name against:
 *        a. public/data/index.json (direct slug or exact name match)
 *        b. public/data/_meta/brand-parent-map.json (slug → parent slug)
 *   4. Writes data/derived/climate-trace-augment.json:
 *      {
 *        _license: "CC BY 4.0 — Climate TRACE",
 *        _source_url, _generated_at, _gas, _stats,
 *        companies: {
 *          <slug>: {
 *            environment: {
 *              ghgCo2eKg, ghgCo2eYear,
 *              facilityCount, ownershipPct,
 *              subsectors: [],
 *              sourceUrl: "https://climatetrace.org/data",
 *              _license: "CC BY 4.0 — Climate TRACE",
 *            }
 *          }
 *        },
 *        orphans: [...]   // top emitters with no slug match (for backlog)
 *      }
 *
 * The `_inferred: false` flag is implicit — every record in this file is
 * direct facility-attributed data (Climate TRACE's `owner_grouping` ultimate
 * parent + apportioned share). Downstream consumers should treat any other
 * augment file (e.g. industry-carbon-intensity-augment.json) as inferred.
 *
 * Flags
 *   --in PATH   override input raw file (default: latest in data/raw/climate-trace/)
 *   --out PATH  override output (default: data/derived/climate-trace-augment.json)
 *   --top N     print top-N emitters to stdout after writing (default 10)
 *
 * Locally:
 *   node scripts/climate-trace-merge.mjs
 *   node scripts/climate-trace-merge.mjs --top 20
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug, normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/climate-trace");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_DEFAULT = path.join(ROOT, "data/derived/climate-trace-augment.json");

const args = process.argv.slice(2);
function arg(name, d = null) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
}
const IN_OVERRIDE  = arg("--in");
const OUT_OVERRIDE = arg("--out");
const TOP_N        = arg("--top") ? Number(arg("--top")) : 10;

const LICENSE_STR =
  "CC BY 4.0 — Climate TRACE (https://climatetrace.org/terms). Commercial use permitted with attribution.";
const SOURCE_URL = "https://climatetrace.org/data";

// ─────────────────────── slug normalization ───────────────────────
//
// Mirror the resolver used in src/App.jsx (`resolveBrand`, line 127) plus
// the looser slug formers used by other augment mergers (forest500,
// animal-welfare-union). We provide three forms and try them in order:
//   1. compact alphanumeric only         "the-coca-cola-co" -> "thecocacolaco"
//   2. dash-separated slug               "JBS S.A."         -> "jbs-s-a"
//   3. brand-parent-map alias normalize  "Berkshire Hathaway Energy" -> via map
//
// Returns the canonical company slug from public/data/index.json (or null).
export function compactKey(s) {
  return String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
export function dashSlug(s) {
  return String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build O(1) lookup maps from public/data/index.json. We index by every
 * form Climate TRACE's `parent_name` might land in:
 *   - exact slug
 *   - compactKey(slug)          ("exxon-mobil"   -> "exxonmobil")
 *   - compactKey(name)          ("Exxon Mobil"   -> "exxonmobil")
 *   - dashSlug(name)            ("Exxon Mobil"   -> "exxon-mobil")
 *   - toSlug(name)              ("Exxon Mobil Corporation" -> "exxon-mobil")
 *     ↑ toSlug strips Corp/Inc/PLC/Ltd/SA/SE/etc legal suffixes via the
 *       shared scripts/lib/company-name-normalize.mjs — critical because
 *       Climate TRACE always appends suffixes ("Shell PLC", "Chevron Corp").
 *   - compactKey(toSlug(name))  ("Berkshire Hathaway Inc" -> "berkshirehathaway")
 */
export function buildIndexLookup(indexArray) {
  const bySlug    = new Map();
  const byCompact = new Map();
  const byDash    = new Map();
  const byToSlug  = new Map();
  for (const row of indexArray) {
    if (!row?.slug) continue;
    bySlug.set(row.slug, row.slug);
    byCompact.set(compactKey(row.slug), row.slug);
    if (row.name) {
      byCompact.set(compactKey(row.name), row.slug);
      byDash.set(dashSlug(row.name), row.slug);
      const ts = toSlug(row.name);
      if (ts) {
        byToSlug.set(ts, row.slug);
        byCompact.set(compactKey(ts), row.slug);
      }
    }
    // Also seed toSlug from the slug itself (some index slugs are dashed
    // legal names like "the-coca-cola-co" we want to find via "the coca cola").
    const fromSlug = toSlug(row.slug.replace(/-/g, " "));
    if (fromSlug) byToSlug.set(fromSlug, row.slug);
  }
  return { bySlug, byCompact, byDash, byToSlug };
}

/**
 * 5-tier resolver. Order matters: cheapest + most-specific first.
 *   1. direct dash slug → exact slug match
 *   2. toSlug(name)     → suffix-stripped slug ("Shell PLC" → "shell")
 *   3. name-dash        → exact dash slug from a name field
 *   4. compact          → all-alphanumeric collision
 *   5. parent map       → brand-parent-map.json fallback
 *
 * Returns { slug, routed_via } or { slug:null, routed_via:"orphan" }.
 */
export function resolveParent(parentName, lookup, parentMap) {
  if (!parentName) return { slug: null, routed_via: "orphan" };
  const dash = dashSlug(parentName);
  if (dash && lookup.bySlug.has(dash))   return { slug: lookup.bySlug.get(dash),  routed_via: "direct-slug" };
  const ts = toSlug(parentName);
  if (ts && lookup.bySlug.has(ts))       return { slug: lookup.bySlug.get(ts),    routed_via: "to-slug" };
  if (ts && lookup.byToSlug.has(ts))     return { slug: lookup.byToSlug.get(ts),  routed_via: "to-slug" };
  if (dash && lookup.byDash.has(dash))   return { slug: lookup.byDash.get(dash),  routed_via: "name-dash" };
  const compact = compactKey(parentName);
  if (compact && lookup.byCompact.has(compact)) return { slug: lookup.byCompact.get(compact), routed_via: "compact" };
  // Parent-map fallback: keys are typically compact alphanumeric slugs
  // matching App.jsx:resolveBrand normalization; values' `.parent` is a
  // canonical slug from public/data/index.json.
  if (compact && parentMap[compact]?.parent) {
    return { slug: parentMap[compact].parent, routed_via: "parent-map" };
  }
  if (ts && parentMap[ts]?.parent) {
    return { slug: parentMap[ts].parent, routed_via: "parent-map" };
  }
  if (dash && parentMap[dash]?.parent) {
    return { slug: parentMap[dash].parent, routed_via: "parent-map" };
  }
  return { slug: null, routed_via: "orphan" };
}

// ─────────────────────── parent filters ───────────────────────
//
// Climate TRACE ownership rows include passive equity holders (index funds,
// sovereign wealth funds, small-share retail investors, state governments)
// as "ultimate parents" of any facility whose listed parent has those funds
// in its cap table. For TruNorth's "who is operationally responsible"
// framing, those rows are NOISE — Vanguard does not RUN coal plants, it
// merely holds index-tracking shares of Duke + Southern + AEP. Counting
// them double-counts a coal plant under both the actual utility AND every
// passive holder. We exclude these at merge time.
//
// We exclude on:
//   - exact match against ASSET_MANAGER_EXCLUDE
//   - parent_entity_type === "state" (governments — facilities should be
//     attributed to the state-owned operator below them in the chain)
//   - placeholder names ("small shareholder(s)", "natural person(s)",
//     "unknown", "trust", "treasury", "various")
// Slugs (toSlug-style, suffix-stripped) of pure asset managers / sovereign
// holders whose passive-equity stakes should NOT be counted as operational
// emissions. We match on `toSlug(parent_name)` so suffix variations all hit.
const ASSET_MANAGER_EXCLUDE = new Set([
  // Big-3 passive index managers
  "vanguard", "the-vanguard-group", "vanguard-group",
  "blackrock",
  "state-street", "state-street-global-advisors",
  "fidelity", "fmr", "fidelity-management-research",
  "fidelity-management-and-research",
  // Pension / sovereign wealth / large institutional
  "norges-bank", "saudi-arabian-monetary-authority",
  "abu-dhabi-investment-authority", "qatar-investment-authority",
  "public-investment-fund", // Saudi PIF
  "peoples-bank-of-china", "people-s-bank-of-china",
  "geode-capital-management",
  // Japanese megabanks frequently appear as ultimate owners of utility/
  // industrial groups via keiretsu cross-holdings — operational emissions
  // belong to the operating subsidiary, not the bank.
  "mitsubishi-ufj-financial-group", "sumitomo-mitsui-financial-group",
  "mizuho-financial-group", "nomura-holdings",
]);
const PLACEHOLDER_PATTERNS = [
  /^small shareholder/i,
  /^natural person/i,
  /^unknown$/i,
  /^trust$/i,
  /^various$/i,
  /^treasury/i,
  /^government of /i,  // state ownership — facility attributed to the state-owned operator directly
  /^state of /i,
  /^republic of /i,
];

export function isExcludedParent(name, entityType) {
  if (!name) return true;
  for (const p of PLACEHOLDER_PATTERNS) if (p.test(name)) return true;
  if (entityType === "state") return true;
  const ts = toSlug(name);
  if (ts && ASSET_MANAGER_EXCLUDE.has(ts)) return true;
  return false;
}

// ─────────────────────── aggregation ───────────────────────
//
// We aggregate per (parent_name, year). Each row in `emissions` is a single
// (source_id, year, gas) sum. We pair every facility-year with EVERY parent
// row that references that source_id, multiplying by share_percent/100.
//
// Per spec (research doc §1.9), Climate TRACE's `overall_share_percent` is
// the ultimate-parent equity share through the full chain — equity-weighted
// apportionment is the industry standard for JV emissions.
//
// We choose the LATEST year per parent (most-recent reportable year) so the
// merged record represents "current annual emissions" and not a cumulative
// total. If a parent reports e.g. only 2023 for one facility and 2024 for
// another, we use 2024 emissions only (do not back-fill from 2023).
export function aggregateByParent(snapshot) {
  const ownByFacility = new Map(); // source_id -> [{parent_name, share, subsector, ...}]
  for (const o of snapshot.ownership || []) {
    let arr = ownByFacility.get(o.source_id);
    if (!arr) { arr = []; ownByFacility.set(o.source_id, arr); }
    arr.push(o);
  }

  // Build per-(parent_name, year) totals and per-parent facility metadata.
  const byParent = new Map(); // parent_name -> {years:Map(year->kg), facilities:Set, subsectors:Set, shareSum:Map(year->[w,sum]), iso3:Set}

  for (const em of snapshot.emissions || []) {
    const owners = ownByFacility.get(em.source_id);
    if (!owners) continue;
    for (const ow of owners) {
      if (isExcludedParent(ow.parent_name, ow.parent_entity_type)) continue;
      const share = ow.share_percent / 100;
      const apportioned = em.kg_co2e * share;
      let entry = byParent.get(ow.parent_name);
      if (!entry) {
        entry = {
          parent_name: ow.parent_name,
          parent_hq_country: ow.parent_hq_country,
          parent_lei: ow.parent_lei,
          years: new Map(),
          facilities: new Set(),
          facilityYearKeys: new Set(),
          subsectors: new Set(),
          iso3: new Set(),
          shareWeighted: new Map(), // year -> {weightedShare, totalKg}
        };
        byParent.set(ow.parent_name, entry);
      }
      entry.years.set(em.year, (entry.years.get(em.year) || 0) + apportioned);
      entry.facilityYearKeys.add(`${em.source_id}|${em.year}`);
      entry.facilities.add(em.source_id);
      if (em.subsector) entry.subsectors.add(em.subsector);
      if (em.iso3_country) entry.iso3.add(em.iso3_country);
      const yEntry = entry.shareWeighted.get(em.year) || { wShare: 0, raw: 0 };
      yEntry.wShare += em.kg_co2e * share;
      yEntry.raw    += em.kg_co2e;
      entry.shareWeighted.set(em.year, yEntry);
    }
  }

  // Collapse to per-parent record using LATEST year.
  const records = [];
  for (const entry of byParent.values()) {
    const years = [...entry.years.keys()].sort((a, b) => b - a);
    if (!years.length) continue;
    const latestYear = years[0];
    const kg = entry.years.get(latestYear);
    // Average ownership share across all facility-years that contributed in
    // the latest year (weighted by facility raw kg) — gives a representative
    // "% of these emissions actually attributed to this parent" number.
    const yw = entry.shareWeighted.get(latestYear);
    const avgShare = yw && yw.raw > 0 ? yw.wShare / yw.raw : null;
    // Count facilities that ACTIVELY reported in the latest year.
    const facilitiesLatestYear = new Set(
      [...entry.facilityYearKeys]
        .filter(k => k.endsWith(`|${latestYear}`))
        .map(k => k.split("|")[0])
    );
    records.push({
      parent_name: entry.parent_name,
      parent_hq_country: entry.parent_hq_country,
      parent_lei: entry.parent_lei,
      ghgCo2eKg: Math.round(kg),
      ghgCo2eYear: latestYear,
      facilityCount: facilitiesLatestYear.size,
      ownershipPct: avgShare != null ? Math.round(avgShare * 1000) / 10 : null, // 0..100, 1 decimal
      subsectors: [...entry.subsectors].sort(),
      iso3Countries: [...entry.iso3].sort(),
      yearsAvailable: years,
    });
  }
  records.sort((a, b) => b.ghgCo2eKg - a.ghgCo2eKg);
  return records;
}

// ─────────────────────── file helpers ───────────────────────

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) throw new Error(`Missing ${RAW_DIR}`);
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

function fmtKg(kg) {
  if (kg == null) return "—";
  if (kg >= 1e12) return `${(kg / 1e12).toFixed(2)} Bt CO2e`;
  if (kg >= 1e9)  return `${(kg / 1e9).toFixed(2)} Mt CO2e`;
  if (kg >= 1e6)  return `${(kg / 1e6).toFixed(2)} kt CO2e`;
  if (kg >= 1e3)  return `${(kg / 1e3).toFixed(1)} t CO2e`;
  return `${kg} kg CO2e`;
}

// ─────────────────────────── runner ───────────────────────────

async function main() {
  const inFile  = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`Climate TRACE merge: ${inFile} → ${outFile}`);

  const snap = await tryReadJson(inFile);
  if (!snap) throw new Error(`Failed to parse ${inFile}`);

  const indexArr = (await tryReadJson(INDEX_FILE)) || [];
  const parentMap = (await tryReadJson(path.join(META_DIR, "brand-parent-map.json"))) || {};
  const lookup = buildIndexLookup(indexArr);
  console.log(`  index entries: ${indexArr.length.toLocaleString()}, parent-map entries: ${Object.keys(parentMap).filter(k => k !== "_doc").length.toLocaleString()}`);

  // Aggregate to parent-level records, then slug-resolve.
  const records = aggregateByParent(snap);
  console.log(`  aggregated to ${records.length.toLocaleString()} unique ultimate parents`);

  const companies = {};      // slug -> environment record
  const slugDupes = new Map(); // slug -> array of (parent_name) we collapsed
  const orphans = [];
  const routingStats = { "direct-slug": 0, "to-slug": 0, "name-dash": 0, "compact": 0, "parent-map": 0, "orphan": 0 };

  for (const rec of records) {
    const { slug, routed_via } = resolveParent(rec.parent_name, lookup, parentMap);
    routingStats[routed_via] = (routingStats[routed_via] || 0) + 1;
    if (!slug) {
      orphans.push({
        parent_name: rec.parent_name,
        parent_hq_country: rec.parent_hq_country,
        ghgCo2eKg: rec.ghgCo2eKg,
        ghgCo2eYear: rec.ghgCo2eYear,
        facilityCount: rec.facilityCount,
        subsectors: rec.subsectors,
      });
      continue;
    }
    // If two Climate TRACE parents map to the same TruNorth slug (e.g. an
    // intermediate holding + ultimate listed parent), keep the LARGER
    // emissions number — it's the more inclusive aggregate.
    const prev = companies[slug];
    if (prev) {
      const arr = slugDupes.get(slug) || [];
      arr.push(rec.parent_name);
      slugDupes.set(slug, arr);
      if (rec.ghgCo2eKg <= (prev.environment?.ghgCo2eKg || 0)) continue;
    }
    companies[slug] = {
      environment: {
        ghgCo2eKg:      rec.ghgCo2eKg,
        ghgCo2eYear:    rec.ghgCo2eYear,
        facilityCount:  rec.facilityCount,
        ownershipPct:   rec.ownershipPct,
        subsectors:     rec.subsectors,
        iso3Countries:  rec.iso3Countries,
        yearsAvailable: rec.yearsAvailable,
        parentNameClimateTrace: rec.parent_name,
        parentHqCountry:        rec.parent_hq_country,
        parentLei:              rec.parent_lei,
        routedVia:              routed_via,
        sourceUrl:              SOURCE_URL,
        _license:               LICENSE_STR,
      },
    };
  }

  const stats = {
    raw_ownership_rows:    snap.ownership?.length || 0,
    raw_emissions_rows:    snap.emissions?.length || 0,
    unique_parents:        records.length,
    matched_slugs:         Object.keys(companies).length,
    orphan_parents:        orphans.length,
    slug_collisions:       slugDupes.size,
    routing:               routingStats,
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    _license:      LICENSE_STR,
    _source_url:   SOURCE_URL,
    _generated_at: new Date().toISOString(),
    _upstream_file: path.relative(ROOT, inFile),
    _gas:          snap._gas || null,
    _stats:        stats,
    companies,
    orphans:       orphans.slice(0, 100),  // top-100 orphan emitters for backlog inspection
  }, null, 2));

  console.log(`\n✅ Wrote ${outFile}`);
  console.log(`  matched brand-parents: ${stats.matched_slugs.toLocaleString()}`);
  console.log(`  orphan parents:        ${stats.orphan_parents.toLocaleString()}`);
  console.log(`  routing breakdown:     ${JSON.stringify(stats.routing)}`);

  if (TOP_N > 0) {
    console.log(`\nTop ${TOP_N} matched emitters in our index:`);
    const matched = Object.entries(companies)
      .map(([slug, c]) => ({ slug, ...c.environment }))
      .sort((a, b) => b.ghgCo2eKg - a.ghgCo2eKg)
      .slice(0, TOP_N);
    for (const r of matched) {
      console.log(
        `  ${fmtKg(r.ghgCo2eKg).padStart(14)}  ${String(r.ghgCo2eYear).padStart(4)}  ${r.slug.padEnd(35)} <- ${r.parentNameClimateTrace} (${r.routedVia})`
      );
    }
    if (orphans.length) {
      console.log(`\nTop ${Math.min(TOP_N, orphans.length)} orphans (unmatched, candidates for parent-map):`);
      for (const o of orphans.slice(0, TOP_N)) {
        console.log(`  ${fmtKg(o.ghgCo2eKg).padStart(14)}  ${String(o.ghgCo2eYear).padStart(4)}  ${o.parent_name}`);
      }
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("climate-trace-merge failed:", err);
    process.exit(1);
  });
}
