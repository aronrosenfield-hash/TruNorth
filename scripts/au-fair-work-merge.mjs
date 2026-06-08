#!/usr/bin/env node
/**
 * Australia Fair Work Ombudsman — merge raw cases into per-slug augment.
 *
 * Reads the most-recent file in data/raw/au-fair-work/ (or --in override)
 * and produces data/derived/au-fair-work-augment.json keyed by TruNorth
 * brand slug.
 *
 * For each case + each defendant:
 *   1. Slug-normalise the defendant name.
 *   2. Direct match against public/data/index.json slugs.
 *   3. Strip common AU-corporate suffixes ("australia holdings pty ltd",
 *      "group limited", etc.) and retry direct match.
 *   4. Fall back to public/data/_meta/brand-parent-map.json for sub-brand
 *      to parent mapping.
 *
 * Each case can attribute to multiple defendants AND a single defendant
 * can attribute to multiple slugs (rare, but e.g. "Coles Supermarkets" →
 * "coles-group"). We de-duplicate per slug by (date, sourceUrl).
 *
 * Output shape:
 *   {
 *     _license: "Public, Fair Work Ombudsman, Australian Government",
 *     _generated_at: "...",
 *     _source: "data/raw/au-fair-work/<date>.json",
 *     _matched_slugs: N,
 *     _orphan_defendants: [{name, caseCount, totalPenaltyAud}],
 *     bySlug: {
 *       "<slug>": {
 *         auLaborLitigation: [
 *           { date, breachType, penaltyAud, court, summary, sourceUrl }
 *         ],
 *         totalPenaltyAud: <sum>
 *       }
 *     }
 *   }
 *
 * Locally:
 *   node scripts/au-fair-work-merge.mjs
 *   node scripts/au-fair-work-merge.mjs --in /tmp/test.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/au-fair-work");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/au-fair-work-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

// ─── helpers ──────────────────────────────────────────────────────────────

/** Aggressive slugifier — lowercases, strips diacritics, collapses to a-z0-9-. */
export function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Strip common Australian corporate suffixes so "Coles Supermarkets
 * Australia Pty Ltd" → "coles supermarkets". Returns multiple progressively
 * stripped variants, in order most→least specific, for candidate matching.
 */
export function nameVariants(rawName) {
  if (!rawName) return [];
  const stripped = String(rawName)
    .replace(/\(.*?\)/g, " ")     // drop parenthetical
    .replace(/\s+/g, " ")
    .trim();

  const variants = new Set();
  variants.add(stripped);

  // Suffix-stripping ladder. Each substitution replaces the *trailing*
  // boilerplate so the core brand name surfaces. We progressively peel.
  const SUFFIX_RE = [
    /\s+pty\.?\s*ltd\.?$/i,
    /\s+pty\s+limited$/i,
    /\s+ltd\.?$/i,
    /\s+limited$/i,
    /\s+inc\.?$/i,
    /\s+llc$/i,
    /\s+holdings$/i,
    /\s+group$/i,
    /\s+australia$/i,
    /\s+australasia$/i,
    /\s+enterprises$/i,
    /\s+stores$/i,
    /\s+supermarkets$/i,
    /\s+corporation$/i,
    /\s+corp\.?$/i,
    /\s+co\.?$/i,
  ];

  let current = stripped;
  // Strip suffixes iteratively (multiple may chain: "Pty Ltd", then "Holdings")
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const re of SUFFIX_RE) {
      const next = current.replace(re, "");
      if (next !== current) { current = next.trim(); changed = true; }
    }
    if (changed) variants.add(current);
    else break;
  }

  return [...variants];
}

/** Aliases for AU subsidiaries with non-obvious slug-aliased parents. */
const AU_BRAND_ALIASES = {
  // <slug-of-cleaned-name> → <TruNorth slug>
  "coles": "coles-group",
  "coles-supermarkets": "coles-group",
  "woolworths": "woolworths-group",
  "mcdonalds": "mcdonald-s",
  "dominos-pizza": "domino-s",
  "dominos-pizza-enterprises": "domino-s",
  "7-eleven-stores": "7-eleven",
  "7-eleven": "7-eleven",
};

/**
 * Resolve a defendant name to a TruNorth slug.
 *   1. Slugify each name-variant. If it directly matches an index slug, win.
 *   2. Try AU_BRAND_ALIASES (hand-curated AU subsidiary → parent map).
 *   3. Try brand-parent-map.json.
 * Returns { slug, routedVia } or { slug: null, routedVia: "orphan" }.
 */
export function resolveDefendant(rawName, indexSlugs, parentMap) {
  const variants = nameVariants(rawName);
  for (const v of variants) {
    const slug = slugify(v);
    if (!slug) continue;
    if (indexSlugs.has(slug)) return { slug, routedVia: "direct" };
    if (AU_BRAND_ALIASES[slug] && indexSlugs.has(AU_BRAND_ALIASES[slug])) {
      return { slug: AU_BRAND_ALIASES[slug], routedVia: "au-alias" };
    }
    const pm = parentMap[slug];
    if (pm?.parent && indexSlugs.has(pm.parent)) {
      return { slug: pm.parent, routedVia: "brand-parent" };
    }
  }
  return { slug: null, routedVia: "orphan" };
}

// ─── load ─────────────────────────────────────────────────────────────────

async function loadIndexSlugs() {
  const text = await fs.readFile(INDEX_FILE, "utf-8");
  const arr = JSON.parse(text);
  return new Set(arr.map(c => c.slug));
}

async function loadParentMap() {
  try {
    const text = await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8");
    const obj = JSON.parse(text);
    // Strip the `_doc` field; everything else is { parent, confidence }
    const { _doc, ...rest } = obj;
    return rest;
  } catch {
    return {};
  }
}

async function pickLatestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}; run au-fair-work-fetch.mjs first.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("Australia Fair Work Ombudsman merger");

  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const cases = raw.cases || [];
  console.log(`  ${cases.length} raw cases`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap = await loadParentMap();
  console.log(`  Loaded ${indexSlugs.size} index slugs + ${Object.keys(parentMap).length} brand-parent entries`);

  // Per-slug accumulator. Dedupe by (date, sourceUrl) within a slug.
  const bySlug = new Map(); // slug -> { auLaborLitigation: [...], totalPenaltyAud, _seen: Set }
  const orphanCounts = new Map(); // defendantName -> { caseCount, totalPenaltyAud }
  const routedViaCounts = { direct: 0, "au-alias": 0, "brand-parent": 0, orphan: 0 };

  for (const c of cases) {
    for (const defendant of (c.defendants || [])) {
      const { slug, routedVia } = resolveDefendant(defendant, indexSlugs, parentMap);
      routedViaCounts[routedVia]++;

      if (!slug) {
        // Track for reporting.
        const existing = orphanCounts.get(defendant) || { name: defendant, caseCount: 0, totalPenaltyAud: 0 };
        existing.caseCount++;
        existing.totalPenaltyAud += (c.penaltyAud || 0);
        orphanCounts.set(defendant, existing);
        continue;
      }

      let entry = bySlug.get(slug);
      if (!entry) {
        entry = { auLaborLitigation: [], totalPenaltyAud: 0, _seen: new Set() };
        bySlug.set(slug, entry);
      }
      const dedupeKey = `${c.date || ""}|${c.sourceUrl || ""}`;
      if (entry._seen.has(dedupeKey)) continue;
      entry._seen.add(dedupeKey);

      entry.auLaborLitigation.push({
        date:       c.date,
        breachType: c.breachType,
        penaltyAud: c.penaltyAud,
        court:      c.court,
        summary:    c.summary,
        sourceUrl:  c.sourceUrl,
      });
      entry.totalPenaltyAud += (c.penaltyAud || 0);
    }
  }

  // Build output (drop _seen helper field; sort cases by date desc).
  const output = {
    _license: "Public, Fair Work Ombudsman, Australian Government",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: raw._source || "https://www.fairwork.gov.au/about-us/our-role-and-purpose/our-priorities/our-litigation-activities/litigation-outcomes",
    _matched_slugs: bySlug.size,
    _orphan_defendants: [...orphanCounts.values()].sort((a, b) => b.totalPenaltyAud - a.totalPenaltyAud).slice(0, 50),
    _routing_counts: routedViaCounts,
    bySlug: {},
  };
  for (const [slug, entry] of bySlug.entries()) {
    entry.auLaborLitigation.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    output.bySlug[slug] = {
      auLaborLitigation: entry.auLaborLitigation,
      totalPenaltyAud: entry.totalPenaltyAud,
    };
  }

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs: ${bySlug.size}`);
  console.log(`  Routing: direct=${routedViaCounts.direct} au-alias=${routedViaCounts["au-alias"]} brand-parent=${routedViaCounts["brand-parent"]} orphan=${routedViaCounts.orphan}`);
  console.log(`  Orphan defendants: ${orphanCounts.size}`);

  // Top-fined defendants overall (across matched + orphan).
  const allFines = [];
  for (const [slug, e] of bySlug.entries()) allFines.push({ name: slug, totalPenaltyAud: e.totalPenaltyAud, kind: "matched" });
  for (const o of orphanCounts.values()) allFines.push({ name: o.name, totalPenaltyAud: o.totalPenaltyAud, kind: "orphan" });
  allFines.sort((a, b) => b.totalPenaltyAud - a.totalPenaltyAud);
  if (allFines.length > 0) {
    console.log(`\nTop 5 most-fined defendants:`);
    for (const f of allFines.slice(0, 5)) {
      console.log(`  AUD ${f.totalPenaltyAud.toLocaleString().padStart(15)}  ${f.name} [${f.kind}]`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("au-fair-work-merge failed:", err);
    process.exit(1);
  });
}
