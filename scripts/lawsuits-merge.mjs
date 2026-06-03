#!/usr/bin/env node
/**
 * Option C — Step 2: Merge lawsuits.json into per-company JSON.
 *
 * Reads /public/data/lawsuits.json (produced weekly by courtlistener-fetch.mjs)
 * and writes the structured `litigation_courtlistener` field into each
 * matching /public/data/companies/<slug>.json so the detail panel UI
 * can display lawsuit data.
 *
 * Target schema on each company (matches what App.jsx already reads):
 *   litigation_courtlistener: {
 *     caseCount24mo:    number,
 *     classActionCount: number,
 *     mostRecentCase:   "YYYY-MM-DD",
 *     cases: [{
 *       caseName, dateFiled, court, natureOfSuit, isClassAction, sourceUrl
 *     }]
 *   }
 *
 * Source-side caveats from CourtListener:
 *   - total_hits is *all-time* not 24mo. We approximate caseCount24mo
 *     by counting recent_cases whose dateFiled is within 24 months.
 *   - isClassAction we detect from caseName containing "class action"
 *     or "in re " (the latter is the common multi-district class prefix).
 *   - sourceUrl built from CL docket URL pattern.
 *
 * Honors the same slug-aliases.json + brand-parent-map.json the news
 * merger uses, so 7-eleven (lawsuits brand slug) routes to the matching
 * file even if our top-500 list uses "seven-eleven".
 *
 * Locally: node scripts/lawsuits-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LAWSUITS_FILE = path.join(ROOT, "public/data/lawsuits.json");
const COMP_DIR      = path.join(ROOT, "public/data/companies");
const META_DIR      = path.join(ROOT, "public/data/_meta");
const LOG_FILE      = path.join(ROOT, "public/data/_meta/lawsuits-merge-log.json");

const TWENTY_FOUR_MONTHS_MS = 24 * 30 * 24 * 60 * 60 * 1000;

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
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) return { slug, routed_via: "direct" };
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return { slug: alias, routed_via: "alias" };
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return { slug: parent, routed_via: "parent" };
  return { slug: null, routed_via: "orphan" };
}

// Heuristic: detect class-action cases from the caseName. The
// CourtListener API doesn't have an isClassAction flag.
function detectClassAction(caseName) {
  if (!caseName) return false;
  const lc = caseName.toLowerCase();
  return /\bclass action\b/.test(lc) || /^in re /i.test(caseName);
}

function buildLitigationField(brandEntry, now) {
  const cases = (brandEntry.recent_cases || []).map(c => {
    const isCA = detectClassAction(c.title);
    const dateFiled = c.filed || null;
    // sourceUrl: CourtListener docket URLs follow /docket/<id>/<slug>/
    // We don't have the docket id directly — fall back to the title-based
    // search URL. Best we can do without an extra fetch per case.
    const sourceUrl = c.docket
      ? `https://www.courtlistener.com/?q=${encodeURIComponent(c.docket)}`
      : `https://www.courtlistener.com/?q=${encodeURIComponent('"' + brandEntry.name + '"')}`;
    return {
      caseName:      c.title || null,
      dateFiled,
      court:         c.court || null,
      natureOfSuit:  c.suit_nature_label || null,
      isClassAction: isCA,
      sourceUrl,
    };
  });

  // 24-month count from the cases we have. The total_hits from CL is
  // all-time; we don't have a way to filter server-side by date for the
  // count, so the 24mo number is best-effort based on the sample.
  const cutoff = Date.now() - TWENTY_FOUR_MONTHS_MS;
  const recent = cases.filter(c => {
    const t = Date.parse(c.dateFiled);
    return !Number.isNaN(t) && t > cutoff;
  });

  // If the entire all-time total is very high but our sample skews
  // recent, project the 24mo proportion onto total_hits. Cap at total_hits.
  let caseCount24mo;
  if (cases.length === 0) {
    caseCount24mo = 0;
  } else if (cases.length < 20 || recent.length === cases.length) {
    // Small or fully-recent sample — trust the literal count.
    caseCount24mo = recent.length;
  } else {
    // Larger sample where some are old — extrapolate onto total_hits.
    const ratio = recent.length / cases.length;
    caseCount24mo = Math.round(ratio * (brandEntry.total_hits || cases.length));
  }

  const classActionCount = cases.filter(c => c.isClassAction).length;

  // Most-recent date across cases
  const dates = cases.map(c => c.dateFiled).filter(Boolean).sort();
  const mostRecentCase = dates.length ? dates[dates.length - 1] : null;

  return {
    caseCount24mo,
    classActionCount,
    mostRecentCase,
    cases:         cases.slice(0, 10),  // cap displayed cases
    totalAllTime:  brandEntry.total_hits || cases.length,
    lastUpdated:   now,
    source:        "courtlistener-recap",
  };
}

async function mergeOne(brandEntry, maps, now) {
  const { slug: targetSlug, routed_via } = resolveSlug(brandEntry.slug, maps);
  if (!targetSlug) return { brand: brandEntry.slug, status: "orphan" };

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: brandEntry.slug, target: targetSlug, status: "parse_error", error: e.message }; }

  company.litigation_courtlistener = buildLitigationField(brandEntry, now);

  // Freshness tracking
  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.courtlistener = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    brand:           brandEntry.slug,
    target:          targetSlug,
    routed_via,
    status:          "merged",
    caseCount24mo:   company.litigation_courtlistener.caseCount24mo,
    classActionCount: company.litigation_courtlistener.classActionCount,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("⚖️  Lawsuits merge starting…");

  const lawsuits = JSON.parse(await fs.readFile(LAWSUITS_FILE, "utf-8"));
  const brands = (lawsuits.lawsuits || []).filter(b => b.status === "ok");
  console.log(`📋 ${brands.length} brand entries with case data`);

  const maps = await loadMaps();
  console.log(`🗺️  ${Object.keys(maps.aliases).length} aliases + ${Object.keys(maps.parents).length} parents`);

  const results = [];
  for (const b of brands) {
    results.push(await mergeOne(b, maps, now));
  }

  const merged   = results.filter(r => r.status === "merged");
  const orphans  = results.filter(r => r.status === "orphan");
  const errors   = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/lawsuits.json",
    total_brands:     brands.length,
    merged_count:     merged.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    routing_breakdown: {
      direct: merged.filter(r => r.routed_via === "direct").length,
      alias:  merged.filter(r => r.routed_via === "alias").length,
      parent: merged.filter(r => r.routed_via === "parent").length,
    },
    orphans:          orphans.map(o => o.brand),
    errors,
  }, null, 2));

  console.log(`✅ Wrote ${LOG_FILE}`);
  console.log(`   Merged:        ${merged.length}`);
  console.log(`   Orphan slugs:  ${orphans.length}`);
  console.log(`   Parse errors:  ${errors.length}`);
}

main().catch(err => {
  console.error("❌ lawsuits-merge failed:", err);
  process.exit(1);
});
