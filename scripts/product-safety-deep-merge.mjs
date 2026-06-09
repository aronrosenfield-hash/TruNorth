#!/usr/bin/env node
/**
 * product-safety-deep-merge — route the consolidated raw snapshot through
 * the brand alias index and write
 *
 *   data/derived/product-safety-deep-augment.json
 *
 * Per-slug shape (one entry per matched brand):
 *
 *   {
 *     slug: "beautycounter",
 *     certifications: [
 *       { source: "ewg-verified", product_count: 92, source_url: "..." },
 *       { source: "made-safe",    product_count: 24, source_url: "..." }
 *     ],
 *     total_certifications: 2,
 *     total_certified_products: 116,
 *     avg_goodguide_score: null,
 *     categories: ["health"],
 *     primary_source_url: "https://www.ewg.org/ewgverified/",
 *   }
 *
 * Routing rules (which TruNorth value category each source maps to):
 *   ewg-verified, made-safe, good-housekeeping-seal, goodguide,
 *   nsf, vegan-org, vegan-society      → health
 *   greenguard                         → health + environment (low-VOC)
 *   watersense                         → environment
 *   vegan-org, vegan-society           → +animals (cruelty / vegan)
 *
 * The category list informs which writer in apply-augments-to-companies.mjs
 * picks the record up.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/product-safety-deep");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/product-safety-deep-augment.json");

const SOURCE_CATEGORIES = {
  "ewg-verified":           ["health"],
  "made-safe":              ["health"],
  "good-housekeeping-seal": ["health"],
  "goodguide":              ["health"],
  "nsf":                    ["health"],
  "greenguard":             ["health", "environment"],
  "watersense":             ["environment"],
  "vegan-org":              ["health", "animals"],
  "vegan-society":          ["health", "animals"],
};

const PRETTY_SOURCE = {
  "ewg-verified":           "EWG VERIFIED",
  "made-safe":              "Made Safe certified",
  "good-housekeeping-seal": "Good Housekeeping Seal",
  "goodguide":              "GoodGuide",
  "nsf":                    "NSF International certified",
  "greenguard":             "GREENGUARD low-VOC certified",
  "watersense":             "EPA WaterSense certified",
  "vegan-org":              "Certified Vegan (vegan.org)",
  "vegan-society":          "Vegan Society Trademark",
};

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
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadCompanySlugs() {
  if (!existsSync(COMP_DIR)) return [];
  return (await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
}

async function loadParentMap() {
  try { return JSON.parse(await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8")); }
  catch { return {}; }
}

async function loadSlugAliases() {
  try { return JSON.parse(await fs.readFile(path.join(META_DIR, "slug-aliases.json"), "utf-8")); }
  catch { return {}; }
}

// brand-parent-map.json (B-22) is keyed by the App.jsx resolveBrand
// normalization: lowercased + non-alphanumerics stripped. We honor that
// during alias-index construction so e.g. "Tide" → "procter-and-gamble"
// without the merger needing to know that brand→parent relationship.
function brandKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function buildAliasIndex(slugs, parentMap, slugAliases) {
  const idx = new Map();
  const slugSet = new Set(slugs);
  for (const slug of slugs) {
    const n = normalizeCompanyName(slug.replace(/-/g, " "));
    if (n) idx.set(n, slug);
    for (const a of parentMap[slug]?.aliases || []) {
      const nn = normalizeCompanyName(a);
      if (nn) idx.set(nn, slug);
    }
  }
  // slug-aliases: { "burts-bees": ["Burt's Bees", "burts bees"] } or { alias: slug }
  for (const [k, v] of Object.entries(slugAliases || {})) {
    if (Array.isArray(v)) {
      for (const a of v) {
        const nn = normalizeCompanyName(a);
        if (nn && slugSet.has(k)) idx.set(nn, k);
      }
    } else if (typeof v === "string") {
      const nn = normalizeCompanyName(k);
      if (nn && slugSet.has(v)) idx.set(nn, v);
    }
  }
  // B-22 brand→parent fallback — { "tide": { parent: "procter-and-gamble" } }
  const parentByBrandKey = new Map();
  for (const [k, v] of Object.entries(parentMap || {})) {
    if (k.startsWith("_")) continue;
    if (v && typeof v === "object" && v.parent && slugSet.has(v.parent)) {
      parentByBrandKey.set(k, v.parent);
    }
  }
  // Attach as a hidden helper on the Map so matchBrand can read it without
  // changing the public signature.
  idx.__parentByBrandKey = parentByBrandKey;
  return idx;
}

export function matchBrand(name, idx) {
  const en = normalizeCompanyName(name);
  if (!en) return null;
  if (idx.has(en)) return idx.get(en);

  // Reconcile apostrophes/hyphens that survive normalizeCompanyName but get
  // dashed in slugs (slug "amy-s-kitchen" → searched as "amy s kitchen"
  // while source "Amy's Kitchen" normalizes to "amy's kitchen").
  const variants = new Set([
    en.replace(/'/g, " ").replace(/\s+/g, " ").trim(),    // "amy's kitchen" → "amy s kitchen"
    en.replace(/'/g, ""),                                  // "amy's" → "amys"
    en.replace(/-/g, " "),                                 // "coca-cola" → "coca cola"
    en.replace(/-/g, ""),                                  // "coca-cola" → "cocacola"
  ]);
  for (const v of variants) if (v && idx.has(v)) return idx.get(v);

  // B-22 brand→parent fallback (Tide → procter-and-gamble, Brita → clorox-co, …)
  if (idx.__parentByBrandKey) {
    const bk = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (bk && idx.__parentByBrandKey.has(bk)) return idx.__parentByBrandKey.get(bk);
  }

  // Token-prefix match for two-word brand names like "Annmarie Skin Care" → "annmarie"
  const tokens = en.split(/[\s\-']+/).filter(Boolean);
  if (tokens.length >= 2) {
    const head2 = tokens.slice(0, 2).join(" ");
    if (idx.has(head2)) return idx.get(head2);
  }
  if (tokens.length >= 1 && tokens[0].length >= 5) {
    if (idx.has(tokens[0])) return idx.get(tokens[0]);
  }
  return null;
}

export function rollUp(matchedRecords) {
  // matchedRecords: array of { slug, source, brand, product_count?, avg_score?, source_url }
  const bySlug = new Map();
  for (const r of matchedRecords) {
    if (!bySlug.has(r.slug)) {
      bySlug.set(r.slug, {
        slug: r.slug,
        certifications: [],
        total_certifications: 0,
        total_certified_products: 0,
        avg_goodguide_score: null,
        categories: new Set(),
        primary_source_url: r.source_url,
      });
    }
    const entry = bySlug.get(r.slug);
    // dedupe within slug — keep highest product_count
    const existing = entry.certifications.find(c => c.source === r.source);
    if (existing) {
      if ((r.product_count || 0) > (existing.product_count || 0)) {
        existing.product_count = r.product_count;
      }
    } else {
      entry.certifications.push({
        source: r.source,
        label: PRETTY_SOURCE[r.source] || r.source,
        brand_name: r.brand,
        product_count: r.product_count || null,
        avg_score: r.avg_score || null,
        source_url: r.source_url,
      });
    }
    for (const cat of SOURCE_CATEGORIES[r.source] || []) entry.categories.add(cat);
  }
  // finalize
  const out = {};
  for (const [slug, entry] of bySlug) {
    entry.total_certifications = entry.certifications.length;
    entry.total_certified_products = entry.certifications.reduce((sum, c) => sum + (c.product_count || 0), 0);
    const gg = entry.certifications.find(c => c.source === "goodguide");
    if (gg && gg.avg_score) entry.avg_goodguide_score = gg.avg_score;
    entry.categories = [...entry.categories];
    out[slug] = entry;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const slugs = await loadCompanySlugs();
  const idx = buildAliasIndex(slugs, await loadParentMap(), await loadSlugAliases());

  const matched = [];
  const unmatched = [];
  for (const rec of snap.records || []) {
    const slug = matchBrand(rec.brand, idx);
    if (slug) matched.push({ ...rec, slug });
    else unmatched.push(rec);
  }

  const companies = rollUp(matched);

  // Per-source matched-brand counts
  const perSource = {};
  for (const entry of Object.values(companies)) {
    for (const c of entry.certifications) {
      perSource[c.source] = (perSource[c.source] || 0) + 1;
    }
  }

  const augment = {
    source: "product-safety-deep",
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    raw_record_count: (snap.records || []).length,
    matched_record_count: matched.length,
    matched_slug_count: Object.keys(companies).length,
    unmatched_count: unmatched.length,
    per_source_matched_brand_count: perSource,
    source_urls: snap.source_urls || {},
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  Matched ${matched.length} / ${(snap.records || []).length} records → ${Object.keys(companies).length} slugs`);
  for (const [s, n] of Object.entries(perSource)) console.log(`  · ${s}: ${n} brands`);
  if (unmatched.length) console.log(`  · ${unmatched.length} unmatched brand records (saved in raw snapshot, parked for B-22 brand-parent-map review)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("product-safety-deep-merge failed:", err);
    process.exit(1);
  });
}
