#!/usr/bin/env node
/**
 * DOL OFLC LCA merge.
 *
 * Reads latest /data/raw/dol-oflc-lca/<date>.json and attributes each
 * aggregated employer record to a TruNorth slug via normalized name match
 * (substring containment fallback for "Walmart Associates Inc" → walmart).
 *
 * Output:  data/derived/dol-oflc-lca-augment.json
 *
 * Per-slug shape (keyed by slug):
 *   {
 *     labor: {
 *       h1bFilings: {
 *         totalLCAs: number,
 *         certifiedCount: number,
 *         deniedCount: number,
 *         withdrawnCount: number,
 *         avgWage: number,         // weighted USD/year
 *         year: string,            // e.g. "FY2025_Q4"
 *         topOccupations: [{ title, count }],
 *         visaClasses: [{ visa, count }],
 *         filerNames: [string]     // legal names rolled into this slug
 *       },
 *       sourceUrl: string
 *     }
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/dol-oflc-lca");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/dol-oflc-lca-augment.json");

function parseArgs(argv) {
  const out = { rawPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") out.rawPath = argv[++i];
    else if (argv[i] === "--out") out.outPath = argv[++i];
  }
  return out;
}

async function loadLatestRaw() {
  try {
    const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadCompanySlugs() {
  if (!existsSync(COMP_DIR)) return [];
  return (await fs.readdir(COMP_DIR)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
}

async function loadParentMap() {
  try {
    return JSON.parse(await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8"));
  } catch { return {}; }
}

/**
 * Returns { exact: Map, fuzzy: Map }.
 *
 *   exact — auto-generated slug-as-name keys. Used for exact matches only.
 *           Without this rule, generic slugs like "america" / "global" /
 *           "international" pull in every multinational H-1B filer.
 *   fuzzy — curated aliases from brand-parent-map.json. Used for exact AND
 *           substring (word-boundary) matches.
 */
export function buildAliasIndex(slugs, parentMap) {
  const exact = new Map();
  const fuzzy = new Map();
  for (const slug of slugs) {
    const n = normalizeCompanyName(slug.replace(/-/g, " "));
    if (n) exact.set(n, slug);
    for (const a of parentMap[slug]?.aliases || []) {
      const nn = normalizeCompanyName(a);
      if (nn) fuzzy.set(nn, slug);
    }
  }
  return { exact, fuzzy };
}

/**
 * H-1B filers use legal names ("AMAZON.COM SERVICES LLC", "WAL-MART
 * ASSOCIATES, INC."). We try exact normalized match against either index,
 * then substring containment against curated aliases only.
 */
export function matchEmployer(employerName, idx) {
  // Back-compat: accept the old Map shape (tests may construct one directly).
  const exact = idx?.exact ?? idx;
  const fuzzy = idx?.fuzzy ?? new Map();
  const cand = normalizeCompanyName(employerName);
  if (!cand) return null;
  if (exact.has(cand)) return exact.get(cand);
  if (fuzzy.has(cand)) return fuzzy.get(cand);
  // Substring fallback — curated aliases only, ≥4 chars, word-boundary-ish.
  for (const [alias, slug] of fuzzy) {
    if (alias.length < 4) continue;
    if (cand === alias) return slug;
    if (cand.startsWith(alias + " ")) return slug;
    if (cand.includes(" " + alias + " ")) return slug;
    if (cand.endsWith(" " + alias)) return slug;
  }
  return null;
}

export function aggregateForSlug(slug, employers, sourceUrl, fiscalYear) {
  const totalLCAs = employers.reduce((s, e) => s + e.lca_count, 0);
  const certifiedCount = employers.reduce((s, e) => s + e.certified_count, 0);
  const deniedCount = employers.reduce((s, e) => s + e.denied_count, 0);
  const withdrawnCount = employers.reduce((s, e) => s + e.withdrawn_count, 0);
  // weight per-employer avgs by their lca_count
  const totalWeight = employers.reduce((s, e) => s + (e.avg_wage_offered_usd > 0 ? e.lca_count : 0), 0);
  const wageSum = employers.reduce(
    (s, e) => s + (e.avg_wage_offered_usd > 0 ? e.avg_wage_offered_usd * e.lca_count : 0),
    0,
  );
  const avgWage = totalWeight > 0 ? Math.round(wageSum / totalWeight) : 0;

  // Merge occupation/visa rollups.
  const occMap = new Map();
  const visaMap = new Map();
  for (const e of employers) {
    for (const o of e.top_occupations || []) {
      occMap.set(o.title, (occMap.get(o.title) || 0) + o.count);
    }
    for (const v of e.visa_classes || []) {
      visaMap.set(v.visa, (visaMap.get(v.visa) || 0) + v.count);
    }
  }

  return {
    slug,
    labor: {
      h1bFilings: {
        totalLCAs,
        certifiedCount,
        deniedCount,
        withdrawnCount,
        avgWage,
        year: fiscalYear,
        topOccupations: [...occMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([title, count]) => ({ title, count })),
        visaClasses: [...visaMap.entries()].sort((a, b) => b[1] - a[1])
          .map(([visa, count]) => ({ visa, count })),
        filerNames: employers.map((e) => e.employer_name).slice(0, 10),
      },
      sourceUrl,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || (await loadLatestRaw());
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const slugs = await loadCompanySlugs();
  const idx = buildAliasIndex(slugs, await loadParentMap());

  const buckets = {};
  let matched = 0;
  for (const emp of snap.employers || []) {
    const slug = matchEmployer(emp.employer_name, idx);
    if (!slug) continue;
    (buckets[slug] ||= []).push(emp);
    matched++;
  }

  const companies = {};
  for (const [slug, emps] of Object.entries(buckets)) {
    companies[slug] = aggregateForSlug(slug, emps, snap.source_url, snap.fiscal_year);
  }

  const augment = {
    source: "dol-oflc-lca",
    source_url: snap.source_url,
    landing_url: snap.landing_url,
    fiscal_year: snap.fiscal_year,
    license: snap.license,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    matched_employer_count: matched,
    matched_slug_count: Object.keys(companies).length,
    total_employers_in_snapshot: snap.employer_count,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(
    `Wrote ${outPath} (${augment.matched_slug_count} slugs / ` +
    `${matched} employer rows matched out of ${snap.employer_count})`,
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("dol-oflc-lca-merge failed:", err);
    process.exit(1);
  });
}
