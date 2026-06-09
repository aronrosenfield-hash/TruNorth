#!/usr/bin/env node
/**
 * USTR Notorious Markets — merge step.
 *
 * Reads latest data/raw/ustr-notorious-markets/<date>.json and writes
 * data/derived/ustr-notorious-markets-augment.json keyed by TruNorth slug.
 *
 * Output shape:
 *   {
 *     _license, _source_url, _list_year, _generated_at, _matched_slugs,
 *     companies: {
 *       "<slug>": {
 *         privacy: {
 *           ustrNotoriousMarket: true,
 *           marketName: "Taobao",
 *           operator: "Alibaba Group Holding Ltd",
 *           concern: "counterfeit goods",
 *           country: "China",
 *           listYear: 2025,
 *           sourceUrl: "https://ustr.gov/.../2025...pdf",
 *         },
 *         _sources: ["ustr-notorious-markets"],
 *         _routedVia: "direct" | "alias" | "parent",
 *         _lastUpdated: <iso>,
 *       }
 *     }
 *   }
 *
 * USTR identifies these as IP/counterfeit/piracy concerns; we surface in
 * the privacy category because TruNorth has no dedicated "IP enforcement"
 * category and counterfeit-on-platform / data-misuse risks are co-located
 * in the "Privacy & Security" rubric (which already covers platform trust).
 *
 * Locally:
 *   node scripts/ustr-notorious-markets-merge.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/ustr-notorious-markets");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "ustr-notorious-markets-augment.json");

export const SOURCE_URL =
  "https://ustr.gov/issue-areas/intellectual-property/notorious-markets-list";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

export function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); } catch { return null; }
}

async function loadMaps() {
  const [aliases, parents] = await Promise.all([
    tryReadJson(path.join(META_DIR, "slug-aliases.json")),
    tryReadJson(path.join(META_DIR, "brand-parent-map.json")),
  ]);
  return { aliases: aliases || {}, parents: parents || {} };
}

async function loadKnownSlugs() {
  const idx = await tryReadJson(INDEX_FILE);
  if (!Array.isArray(idx)) return new Set();
  return new Set(idx.map(r => r.slug));
}

async function latestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

export function resolveSlug(slugKey, { knownSlugs, aliases, parents }) {
  if (!slugKey) return null;
  if (knownSlugs.has(slugKey)) return { slug: slugKey, routedVia: "direct" };
  if (aliases[slugKey] && knownSlugs.has(aliases[slugKey])) {
    return { slug: aliases[slugKey], routedVia: "alias" };
  }
  if (parents[slugKey] && knownSlugs.has(parents[slugKey])) {
    return { slug: parents[slugKey], routedVia: "parent" };
  }
  return null;
}

async function main() {
  const raw = await latestRawFile();
  if (!raw) { console.error("[ustr-merge] no raw file"); process.exit(1); }
  const data = JSON.parse(await fs.readFile(raw, "utf-8"));
  const { aliases, parents } = await loadMaps();
  const knownSlugs = await loadKnownSlugs();
  const now = new Date().toISOString();

  const companies = {};
  const orphans = [];
  for (const m of data.markets || []) {
    const r = resolveSlug(m.slugKey, { knownSlugs, aliases, parents });
    if (!r) { orphans.push({ slugKey: m.slugKey, marketName: m.marketName }); continue; }
    // First-wins per slug (multiple markets per slug e.g. Alibaba subs):
    if (companies[r.slug]) continue;
    companies[r.slug] = {
      privacy: {
        ustrNotoriousMarket: true,
        marketName: m.marketName,
        operator: m.operator,
        concern: m.concern,
        country: m.country,
        listYear: m.listYear,
        sourceUrl: m.sourceUrl,
      },
      _sources: ["ustr-notorious-markets"],
      _routedVia: r.routedVia,
      _lastUpdated: now,
    };
  }

  const out = {
    _license: "U.S. Federal Government — public domain",
    _source: "ustr-notorious-markets",
    _source_url: SOURCE_URL,
    _list_year: data._list_year,
    _generated_at: now,
    _matched_slugs: Object.keys(companies).length,
    _orphans: orphans,
    companies,
  };
  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`[ustr-merge] wrote ${outPath} — ${Object.keys(companies).length} slugs, ${orphans.length} orphans`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
