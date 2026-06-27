#!/usr/bin/env node
/**
 * EPA Emissions merge — reads cached GHGRP + TRI year files, aggregates
 * facility data to PARENT_COMPANY, then writes into per-company JSON files
 * under `enriched.environment.*`.
 *
 * Target schema (enriched.environment additions):
 *   ghg_tons_co2e_last_year     number  — most recent reported year, summed
 *   ghg_yoy_trend               [{year, tons_co2e}]  — chronological (older → newer)
 *   tri_releases_lbs_last_year  number  — most recent reported year, summed
 *   tri_top_chemicals           [{chemical, lbs}]    — top 3 by lbs in last year
 *   tri_yoy_trend               [{year, lbs}]        — chronological
 *   epa_emissions_source        "epa-ghgrp+tri"
 *   epa_emissions_last_updated  ISO timestamp
 *
 * Aggregation:
 *   1. Stream each CSV (no full JSON.parse — files can be 100+ MB live).
 *   2. Normalize PARENT_COMPANY name → slug (lowercase, strip Corp/Inc/Co,
 *      hyphenate).
 *   3. Sum within (slug, year) for GHG; sum + per-chemical bucket for TRI.
 *   4. Resolve slug → company JSON via slug-aliases.json + brand-parent-map.json
 *      (same pattern as epa-echo-merge).
 *   5. Skip companies with zero matched facility-rows.
 *
 * Flags:
 *   --dry        (default) write to public/data/_meta/epa-emissions-dry-run.json
 *                instead of mutating per-company JSON. Lists what *would*
 *                be written for the top-50 dry-run brand set.
 *   --apply      mutate public/data/companies/<slug>.json (CI workflow).
 *   --top50      restrict output (dry or apply) to the curated top-50
 *                high-emitter slug list (see TOP_50 below).
 *
 * Locally: node scripts/epa-emissions-merge.mjs --dry --top50
 */
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const GHGRP_DIR  = path.join(ROOT, "public/data/_cache/epa-ghgrp");
const TRI_DIR    = path.join(ROOT, "public/data/_cache/epa-tri");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const DRY_OUT    = path.join(META_DIR, "epa-emissions-dry-run.json");
const LOG_OUT    = path.join(META_DIR, "epa-emissions-merge-log.json");

// Curated 40-brand dry-run set (known high emitters). Used with --top50.
// Slugs are the canonical company-file slugs in public/data/companies/.
const TOP_50 = [
  "exxon-mobil", "chevron", "shell-usa", "bp-usa", "conoco-phillips",
  "valero-energy", "marathon-petroleum", "duke-energy", "southern-company",
  "ge-aerospace", "ge-vernova", "ford", "gm-stellantis", "toyota",
  "dupont", "dow", "basf-corp", "3m", "weyerhaeuser",
  "international-paper", "smurfit-westrock", "archer-daniels-midland",
  "cargill", "tyson-foods", "jbs-usa", "smithfield-foods", "perdue-farms",
  "conagra", "kraft-heinz", "pepsico", "coca-cola", "nestle",
  "anheuser-busch", "molson-coors", "heineken-usa", "alcoa",
  "freeport-mcmoran", "southern-copper", "peabody-energy", "arch-resources",
];

function parseArgs() {
  const a = new Set(process.argv.slice(2));
  return { apply: a.has("--apply"), dry: !a.has("--apply"), top50: a.has("--top50") };
}

// Parent-company name → slug. Strips common corporate suffixes, lowercases,
// and substitutes whitespace/punctuation with hyphens. Tuned against the
// PARENT_COMPANY column conventions used in GHGRP + TRI.
const SUFFIX_RE = /\b(corporation|corp|company|companies|incorporated|inc|llc|lp|plc|usa|us|north america|north american|holdings|group|the)\b/gi;
function slugifyParent(name) {
  if (!name) return null;
  let s = String(name).toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(SUFFIX_RE, " ");
  s = s.replace(/[.,'"]/g, " ");
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s || null;
}

// Hand-tuned synonyms — handles parents whose corporate name doesn't slugify
// to the file slug. Keep small; prefer the slug-aliases + brand-parent-map
// resolution chain below.
const PARENT_SYNONYMS = {
  "exxon-mobil": "exxon-mobil",
  "chevron": "chevron",
  "shell-oil": "shell-usa",
  "shell": "shell-usa",
  "bp-products": "bp-usa",
  "bp": "bp-usa",
  "conoco-phillips": "conoco-phillips",
  "conocophillips": "conoco-phillips",
  "valero-energy": "valero-energy",
  "marathon-petroleum": "marathon-petroleum",
  "duke-energy": "duke-energy",
  "southern": "southern-company",
  "ge-vernova": "ge-vernova",
  "ge-aerospace": "ge-aerospace",
  "ford-motor": "ford",
  "ford": "ford",
  "general-motors": "gm-stellantis",
  "gm": "gm-stellantis",
  "stellantis": "gm-stellantis",
  "toyota-motor": "toyota",
  "toyota-motor-sales": "toyota",
  "dupont-de-nemours": "dupont",
  "dupont": "dupont",
  "dow-chemical": "dow",
  "dow": "dow",
  "basf": "basf-corp",
  "3m": "3m",
  "weyerhaeuser": "weyerhaeuser",
  "international-paper": "international-paper",
  "smurfit-westrock": "smurfit-westrock",
  "westrock": "smurfit-westrock",
  "archer-daniels-midland": "archer-daniels-midland",
  "adm": "archer-daniels-midland",
  "cargill": "cargill",
  "tyson-foods": "tyson-foods",
  "tyson": "tyson-foods",
  "jbs": "jbs-usa",
  "jbs-usa": "jbs-usa",
  "smithfield-foods": "smithfield-foods",
  "perdue-farms": "perdue-farms",
  "conagra-brands": "conagra",
  "conagra": "conagra",
  "kraft-heinz": "kraft-heinz",
  "pepsico": "pepsico",
  "coca-cola": "coca-cola",
  "nestle": "nestle",
  "anheuser-busch": "anheuser-busch",
  "molson-coors-beverage": "molson-coors",
  "molson-coors": "molson-coors",
  "heineken": "heineken-usa",
  "alcoa": "alcoa",
  "freeport-mcmoran": "freeport-mcmoran",
  "southern-copper": "southern-copper",
  "peabody-energy": "peabody-energy",
  "arch-resources": "arch-resources",
};

// Minimal RFC 4180-style CSV parser — handles double-quoted fields and
// embedded commas/quotes. Used on a per-line basis from a streaming reader.
function parseCsvLine(line) {
  const out = [];
  let i = 0, cur = "", inQ = false;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { out.push(cur); cur = ""; i++; continue; }
      cur += c; i++;
    }
  }
  out.push(cur);
  return out;
}

async function streamCsv(file, onRow) {
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header = null;
  let rowCount = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!header) { header = cells.map(h => h.trim().toUpperCase()); continue; }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    onRow(row);
    rowCount++;
  }
  return rowCount;
}

// Tolerant column getter — picks the first present key (EPA renames columns
// between years; e.g. PARENT_COMPANY vs PARENT_COMPANY_NAME).
function pick(row, ...keys) {
  for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k];
  return null;
}

async function aggregateGhgrp(years) {
  // perSlug[slug] = { byYear: {YYYY: tons}, parentNames: Set<string> }
  const perSlug = new Map();
  for (const y of years) {
    const f = path.join(GHGRP_DIR, `${y}.csv`);
    if (!existsSync(f)) { console.log(`  GHGRP ${y}: missing`); continue; }
    let rows = 0;
    await streamCsv(f, row => {
      const parent = pick(row, "PARENT_COMPANY", "PARENT_COMPANY_NAME", "PARENT_COMPANIES");
      const tonsRaw = pick(row, "GHG_QUANTITY_METRIC_TONS_CO2E", "GHG_QUANTITY", "GHG_QUANTITY_(METRIC_TONS_CO2E)", "TOTAL_REPORTED_DIRECT_EMISSIONS");
      if (!parent || !tonsRaw) return;
      const tons = Number(String(tonsRaw).replace(/,/g, ""));
      if (!Number.isFinite(tons)) return;
      const slug = PARENT_SYNONYMS[slugifyParent(parent)] || slugifyParent(parent);
      if (!slug) return;
      if (!perSlug.has(slug)) perSlug.set(slug, { byYear: {}, parentNames: new Set() });
      const e = perSlug.get(slug);
      e.byYear[y] = (e.byYear[y] || 0) + tons;
      e.parentNames.add(parent);
      rows++;
    });
    console.log(`  GHGRP ${y}: ${rows} rows aggregated`);
  }
  return perSlug;
}

async function aggregateTri(years) {
  // perSlug[slug] = { byYear: {YYYY: lbs}, byYearChem: {YYYY: {chem: lbs}}, parentNames: Set }
  const perSlug = new Map();
  for (const y of years) {
    const f = path.join(TRI_DIR, `${y}.csv`);
    if (!existsSync(f)) { console.log(`  TRI ${y}: missing`); continue; }
    let rows = 0;
    await streamCsv(f, row => {
      const parent = pick(row, "PARENT_COMPANY_NAME", "PARENT_CO_NAME", "PARENT_COMPANY", "PARENT COMPANY NAME");
      const chem   = pick(row, "CHEMICAL", "CHEMICAL_NAME", "CHEM_NAME");
      const lbsRaw = pick(row, "TOTAL_RELEASES_LBS", "TOTAL_RELEASES", "ON-SITE_RELEASE_TOTAL", "ON_SITE_RELEASE_TOTAL");
      if (!parent || !lbsRaw) return;
      const lbs = Number(String(lbsRaw).replace(/,/g, ""));
      if (!Number.isFinite(lbs)) return;
      const slug = PARENT_SYNONYMS[slugifyParent(parent)] || slugifyParent(parent);
      if (!slug) return;
      if (!perSlug.has(slug)) perSlug.set(slug, { byYear: {}, byYearChem: {}, parentNames: new Set() });
      const e = perSlug.get(slug);
      e.byYear[y] = (e.byYear[y] || 0) + lbs;
      const yc = (e.byYearChem[y] = e.byYearChem[y] || {});
      if (chem) yc[chem] = (yc[chem] || 0) + lbs;
      e.parentNames.add(parent);
      rows++;
    });
    console.log(`  TRI ${y}: ${rows} rows aggregated`);
  }
  return perSlug;
}

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

function resolveSlug(slug, maps) {
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) return { slug, via: "direct" };
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return { slug: alias, via: "alias" };
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return { slug: parent, via: "parent" };
  return { slug: null, via: "orphan" };
}

function buildPayload(slug, ghg, tri) {
  const years = new Set([
    ...Object.keys(ghg?.byYear || {}),
    ...Object.keys(tri?.byYear || {}),
  ].map(Number)).size === 0
    ? []
    : [...new Set([...Object.keys(ghg?.byYear || {}), ...Object.keys(tri?.byYear || {})].map(Number))].sort();

  const ghgTrend = ghg ? Object.keys(ghg.byYear).map(Number).sort()
    .map(y => ({ year: y, tons_co2e: Math.round(ghg.byYear[y]) })) : [];
  const triTrend = tri ? Object.keys(tri.byYear).map(Number).sort()
    .map(y => ({ year: y, lbs: Math.round(tri.byYear[y]) })) : [];

  const ghgLast = ghgTrend.length ? ghgTrend[ghgTrend.length - 1] : null;
  const triLast = triTrend.length ? triTrend[triTrend.length - 1] : null;

  let triTopChems = [];
  if (tri && triLast) {
    const yc = tri.byYearChem[triLast.year] || {};
    triTopChems = Object.entries(yc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([chemical, lbs]) => ({ chemical, lbs: Math.round(lbs) }));
  }

  return {
    slug,
    ghg_tons_co2e_last_year: ghgLast ? ghgLast.tons_co2e : null,
    ghg_last_year:           ghgLast ? ghgLast.year : null,
    ghg_yoy_trend:           ghgTrend,
    tri_releases_lbs_last_year: triLast ? triLast.lbs : null,
    tri_last_year:           triLast ? triLast.year : null,
    tri_top_chemicals:       triTopChems,
    tri_yoy_trend:           triTrend,
    parent_names_matched:    [...new Set([
      ...(ghg ? [...ghg.parentNames] : []),
      ...(tri ? [...tri.parentNames] : []),
    ])],
  };
}

async function mergeOne(slug, payload, maps, now, apply) {
  const r = resolveSlug(slug, maps);
  if (!r.slug) return { slug, status: "orphan" };
  const file = path.join(COMP_DIR, `${r.slug}.json`);
  if (!apply) return { slug, target: r.slug, via: r.via, status: "would_merge", payload };

  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { slug, target: r.slug, via: r.via, status: "parse_error", error: e.message }; }

  company.enriched = company.enriched || {};
  company.enriched.environment = company.enriched.environment || {};
  Object.assign(company.enriched.environment, {
    ghg_tons_co2e_last_year:    payload.ghg_tons_co2e_last_year,
    ghg_last_year:              payload.ghg_last_year,
    ghg_yoy_trend:              payload.ghg_yoy_trend,
    tri_releases_lbs_last_year: payload.tri_releases_lbs_last_year,
    tri_last_year:              payload.tri_last_year,
    tri_top_chemicals:          payload.tri_top_chemicals,
    tri_yoy_trend:              payload.tri_yoy_trend,
    epa_emissions_source:       "epa-ghgrp+tri",
    epa_emissions_last_updated: now,
  });

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.epaEmissions = now;

  await fs.writeFile(file, JSON.stringify(company, null, /\n {2}/.test(await fs.readFile(file, "utf-8").catch(() => "")) ? 2 : 0));
  return { slug, target: r.slug, via: r.via, status: "merged" };
}

async function main() {
  const { apply, dry, top50 } = parseArgs();
  const now = new Date().toISOString();
  console.log(`EPA emissions merge — mode=${apply ? "APPLY" : "DRY"}${top50 ? " top50" : ""}`);

  const yearsToScan = [2024, 2023, 2022, 2021];
  console.log("Aggregating GHGRP …"); const ghgMap = await aggregateGhgrp(yearsToScan);
  console.log("Aggregating TRI …");   const triMap = await aggregateTri(yearsToScan);
  console.log(`GHGRP slugs: ${ghgMap.size} • TRI slugs: ${triMap.size}`);

  const allSlugs = new Set([...ghgMap.keys(), ...triMap.keys()]);
  const targetSlugs = top50 ? [...allSlugs].filter(s => TOP_50.includes(s)) : [...allSlugs];

  const maps = await loadMaps();
  const results = [];
  for (const slug of targetSlugs) {
    const payload = buildPayload(slug, ghgMap.get(slug), triMap.get(slug));
    if (payload.ghg_tons_co2e_last_year == null && payload.tri_releases_lbs_last_year == null) continue;
    results.push(await mergeOne(slug, payload, maps, now, apply));
  }

  await fs.mkdir(META_DIR, { recursive: true });
  if (dry) {
    await fs.writeFile(DRY_OUT, JSON.stringify({
      generated_at: now,
      mode: "dry",
      top50,
      ghgrp_slug_count: ghgMap.size,
      tri_slug_count:   triMap.size,
      candidate_count:  results.length,
      results,
    }, null, 2));
    console.log(`Dry-run written → ${path.relative(ROOT, DRY_OUT)} (${results.length} candidates)`);
  } else {
    const merged  = results.filter(r => r.status === "merged");
    const orphans = results.filter(r => r.status === "orphan");
    const errors  = results.filter(r => r.status === "parse_error");
    await fs.writeFile(LOG_OUT, JSON.stringify({
      merged_at: now,
      merged_count: merged.length,
      orphan_count: orphans.length,
      error_count:  errors.length,
      orphans:      orphans.map(o => o.slug),
    }, null, 2));
    console.log(`Merged: ${merged.length} • orphans: ${orphans.length} • errors: ${errors.length}`);
  }
}

main().catch(e => { console.error("epa-emissions-merge failed:", e); process.exit(1); });
