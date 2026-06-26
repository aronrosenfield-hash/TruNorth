#!/usr/bin/env node
/**
 * SEC EDGAR XBRL Frames — GAAP effective tax rate (annual, public companies).
 *
 * The SEC's XBRL "frames" API exposes one financial concept across ALL
 * registrants for a single reporting period, drawn from their filed 10-Ks.
 * This is US-government public-domain data. The API REQUIRES a descriptive
 * User-Agent that includes a contact email; requests without one are blocked
 * (HTTP 403 / connection reset), so we always send one.
 *
 * We pull three concepts for one calendar year and JOIN them by CIK:
 *   - EffectiveIncomeTaxRateContinuingOperations (uom "pure", a decimal)
 *   - IncomeTaxExpenseBenefit (USD)
 *   - IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItems
 *       NoncontrollingInterest (USD, the pretax income)
 *
 * Per company we emit:
 *   { effectiveTaxRate, taxExpenseUsd, pretaxIncomeUsd, year, cik,
 *     source: "SEC EDGAR XBRL" }
 *
 * Output (DERIVED AUGMENT, keyed by TruNorth company slug):
 *   data/derived/sec-tax-augment.json
 *
 * IMPORTANT — distinct from ITEP:
 *   This is the GAAP *effective* tax rate from a single year's 10-K. It is a
 *   DIFFERENT metric from the existing ITEP augment (enriched.tax), which is a
 *   curated multi-year CASH *federal* rate. This augment lives under its own
 *   top-level shape (`sec.tax`) and must NOT overwrite or be conflated with
 *   enriched.tax. Its value is breadth (thousands of public filers) + a
 *   complementary, independently-sourced metric.
 *
 * Matching — NAME-ONLY caveat:
 *   The brand index (public/data/index.json) carries NO cik/ticker field
 *   (verified: 0 of 12,845 entries), so we cannot CIK-match. We reuse the
 *   ITEP merge's name matching (buildIndexLookup / matchCompanyToIndex /
 *   nameVariants) against the index, then fall back to the brand-parent-map.
 *   Name matching of SEC legal entity names ("AAR CORP", "ALPHABET INC.") to
 *   consumer-brand slugs is approximate; we keep the matched CIK + entityName
 *   in the output so a downstream reviewer can spot-check precision.
 *
 * Flags:
 *   --apply         — write data/derived/sec-tax-augment.json (else dry-run).
 *   --year YYYY      — force a calendar year (default: try 2024, else 2023).
 *   --cache          — reuse any *.json the fetcher already downloaded into
 *                      data/raw/sec-tax/ instead of re-hitting the SEC.
 *
 * NEVER writes public/data/companies/*.json. NEVER commits.
 *
 * Locally:
 *   node scripts/sec-tax-fetch.mjs            # dry-run, prints summary
 *   node scripts/sec-tax-fetch.mjs --apply    # write the augment
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildIndexLookup,
  matchCompanyToIndex,
  matchViaParentMap,
} from "./itep-tax-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/sec-tax");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "sec-tax-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const SOURCE = "SEC EDGAR XBRL";
const UA = "TruNorth/1.0 contact@trunorthapp.com";
const FRAMES_BASE = "https://data.sec.gov/api/xbrl/frames/us-gaap";
const LANDING = "https://www.sec.gov/search-filings/edgar-application-programming-interfaces";

// The three GAAP concepts we join, with their unit-of-measure path segment.
const CONCEPTS = {
  effectiveTaxRate: { tag: "EffectiveIncomeTaxRateContinuingOperations", uom: "pure" },
  taxExpenseUsd:    { tag: "IncomeTaxExpenseBenefit", uom: "USD" },
  pretaxIncomeUsd:  {
    tag: "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    uom: "USD",
  },
};

// A frame is considered "real" only if it clears this row count — guards
// against a too-early year that returns an empty/sparse stub.
const MIN_ROWS = 500;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const USE_CACHE = argv.includes("--cache");
const FORCE_YEAR = (() => {
  const i = argv.indexOf("--year");
  return i >= 0 ? Number(argv[i + 1]) : null;
})();

// ─────────────────────────── fetch ──────────────────────────────────

async function fetchFrame(tag, uom, year) {
  const url = `${FRAMES_BASE}/${tag}/${uom}/CY${year}.json`;
  const cacheFile = path.join(RAW_DIR, `${tag}.${uom}.CY${year}.json`);

  if (USE_CACHE && existsSync(cacheFile)) {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
    console.log(`  [cache] ${tag} CY${year}: ${(cached.data || []).length} rows`);
    return cached;
  }

  console.log(`  GET ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (res.status === 404) {
    console.log(`    404 — no frame for CY${year}.`);
    return null;
  }
  if (!res.ok) throw new Error(`SEC frames fetch failed (${tag} CY${year}): HTTP ${res.status}`);

  const text = await res.text();
  if (!text || text.length < 50) {
    throw new Error(`SEC frames returned empty body (${tag} CY${year}, ${text.length} bytes)`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`SEC frames returned non-JSON (${tag} CY${year})`); }

  const rows = (json.data || []).length;
  console.log(`    ${rows} rows (${text.length.toLocaleString()} bytes)`);

  // Persist the raw snapshot so --cache works and the pull is auditable.
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(cacheFile, text);
  return json;
}

/**
 * Pull all three concepts for `year`. Returns null if the rate frame is
 * missing or too sparse (so the caller can fall back to an earlier year).
 */
async function fetchYear(year) {
  console.log(`\nFetching SEC XBRL frames for CY${year} ...`);
  const rate = await fetchFrame(CONCEPTS.effectiveTaxRate.tag, CONCEPTS.effectiveTaxRate.uom, year);
  if (!rate || (rate.data || []).length < MIN_ROWS) {
    console.log(`  CY${year} effective-rate frame is missing/sparse (${(rate?.data || []).length} rows < ${MIN_ROWS}).`);
    return null;
  }
  // Polite ~1 req/sec spacing between SEC calls.
  await sleep(350);
  const expense = await fetchFrame(CONCEPTS.taxExpenseUsd.tag, CONCEPTS.taxExpenseUsd.uom, year);
  await sleep(350);
  const pretax = await fetchFrame(CONCEPTS.pretaxIncomeUsd.tag, CONCEPTS.pretaxIncomeUsd.uom, year);
  return { rate, expense, pretax };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── join ───────────────────────────────────

/**
 * Join the three frames by CIK. The frames API can carry more than one row
 * per CIK (different fiscal-year-end alignments); we keep the first seen for
 * each CIK in each frame — for a calendar frame these are already the
 * period-aligned values, so first-wins is stable.
 */
function joinByCik({ rate, expense, pretax }, year) {
  const expByCik = new Map();
  for (const r of expense?.data || []) if (!expByCik.has(r.cik)) expByCik.set(r.cik, r.val);
  const preByCik = new Map();
  for (const r of pretax?.data || []) if (!preByCik.has(r.cik)) preByCik.set(r.cik, r.val);

  const out = [];
  const seen = new Set();
  for (const r of rate.data || []) {
    if (seen.has(r.cik)) continue;
    seen.add(r.cik);
    out.push({
      cik: r.cik,
      entityName: r.entityName,
      effectiveTaxRate: r.val,
      taxExpenseUsd: expByCik.has(r.cik) ? expByCik.get(r.cik) : null,
      pretaxIncomeUsd: preByCik.has(r.cik) ? preByCik.get(r.cik) : null,
      year,
    });
  }
  return out;
}

// ─────────────────────────── merge → slugs ──────────────────────────

function mergeToSlugs(companies, { index, parentMap }) {
  const byName = buildIndexLookup(index);
  const augment = {};
  const collisions = [];
  let direct = 0;
  let parent = 0;
  let orphan = 0;

  for (const c of companies) {
    let slug = matchCompanyToIndex(c.entityName, byName);
    let route = "direct";
    if (!slug) {
      slug = matchViaParentMap(c.entityName, parentMap);
      if (slug) route = "parent";
    }
    if (!slug) { orphan++; continue; }

    const payload = {
      effectiveTaxRate: c.effectiveTaxRate ?? null,
      taxExpenseUsd: c.taxExpenseUsd ?? null,
      pretaxIncomeUsd: c.pretaxIncomeUsd ?? null,
      year: c.year,
      cik: c.cik,
      source: SOURCE,
    };

    if (augment[slug]) {
      // Two different SEC entities mapped to one slug. Keep the one with the
      // larger pretax income (the real parent issuer dwarfs a same-named sub),
      // and record the collision for the report.
      collisions.push({ slug, kept: augment[slug].sec.tax.cik, dropped: c.cik, name: c.entityName });
      const prev = augment[slug].sec.tax;
      const prevSize = Math.abs(prev.pretaxIncomeUsd ?? 0);
      const curSize = Math.abs(payload.pretaxIncomeUsd ?? 0);
      if (curSize > prevSize) augment[slug] = { sec: { tax: payload } };
      continue;
    }
    if (route === "direct") direct++; else parent++;
    augment[slug] = { sec: { tax: payload } };
  }

  return { augment, stats: { direct, parent, orphan, collisions } };
}

async function loadJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

// ─────────────────────────── main ───────────────────────────────────

async function main() {
  console.log(`sec-tax fetch starting... (mode=${APPLY ? "APPLY" : "DRY"})`);

  // Year selection: forced, else CY2024 with CY2023 fallback.
  const yearOrder = FORCE_YEAR ? [FORCE_YEAR] : [2024, 2023];
  let frames = null;
  let year = null;
  for (const y of yearOrder) {
    frames = await fetchYear(y);
    if (frames) { year = y; break; }
    console.log(`  Falling back from CY${y}...`);
  }
  if (!frames) {
    console.error(`No usable SEC frame found for years: ${yearOrder.join(", ")}`);
    process.exit(2);
  }

  const companies = joinByCik(frames, year);
  const withExpense = companies.filter((c) => c.taxExpenseUsd != null).length;
  const withPretax = companies.filter((c) => c.pretaxIncomeUsd != null).length;
  console.log(
    `\nJoined ${companies.length} companies by CIK for CY${year} ` +
      `(${withExpense} have tax-expense, ${withPretax} have pretax-income).`,
  );

  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  console.log(`Loaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).`);

  const { augment, stats } = mergeToSlugs(companies, { index, parentMap });
  const matchCount = Object.keys(augment).length;

  console.log("\nResults:");
  console.log(`  Direct name matches:    ${stats.direct}`);
  console.log(`  Parent-map matches:     ${stats.parent}`);
  console.log(`  Orphans (no slug):      ${stats.orphan}`);
  console.log(`  Distinct matched slugs: ${matchCount}`);
  if (stats.collisions.length) {
    console.log(`  Slug collisions (>1 CIK → 1 slug): ${stats.collisions.length}`);
    for (const c of stats.collisions.slice(0, 5)) {
      console.log(`    ${c.slug}: kept cik=${c.kept}, dropped cik=${c.dropped} (${c.name})`);
    }
  }

  // A few examples for the log.
  const examples = Object.entries(augment).slice(0, 8).map(([slug, v]) => {
    const t = v.sec.tax;
    const rate = t.effectiveTaxRate == null ? "?" : `${(t.effectiveTaxRate * 100).toFixed(1)}%`;
    return `    ${slug.padEnd(22)} rate=${rate.padStart(7)}  cik=${t.cik}  (${companyName(companies, t.cik)})`;
  });
  if (examples.length) {
    console.log("\n  Examples (slug → effective tax rate):");
    console.log(examples.join("\n"));
  }

  const out = {
    _source: SOURCE,
    _metric: "GAAP effective income-tax rate (continuing operations), single fiscal year from 10-K filings",
    _note: "DISTINCT from ITEP enriched.tax (curated multi-year CASH federal rate). Do not conflate.",
    sourceUrl: LANDING,
    year,
    generatedAt: new Date().toISOString(),
    matchCount,
    orphanCount: stats.orphan,
    collisionCount: stats.collisions.length,
    ...augment,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)} (${matchCount} slugs).`);
    console.log("  (Derived augment only — no company-file writes, no commits.)");
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

function companyName(companies, cik) {
  const c = companies.find((x) => x.cik === cik);
  return c ? c.entityName : "?";
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("sec-tax-fetch failed:", err);
    process.exit(1);
  });
}

export { joinByCik, mergeToSlugs };
