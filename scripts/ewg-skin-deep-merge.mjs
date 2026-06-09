#!/usr/bin/env node
/**
 * ewg-skin-deep-merge — roll EWG Skin Deep per-product hazard scores up to
 * a per-brand summary, then write:
 *
 *   data/derived/ewg-skin-deep-augment.json
 *
 * Per-slug shape:
 *   {
 *     slug,
 *     ewg_avg_score: 5.2,
 *     ewg_worst_score: 8,
 *     ewg_pct_flagged: 0.42,   // pct of products scoring >= 7
 *     ewg_product_count: 24,
 *     sample_products: [{ product, score }, ...up to 5 worst],
 *     severity: "negative" | "mixed" | "neutral" | "positive",
 *     source: "ewg-skin-deep",
 *     source_url: "https://www.ewg.org/skindeep/"
 *   }
 *
 * Severity heuristic (transparent, stated in the augment):
 *   sample_size < 3                                    → "neutral"
 *   pct_flagged >= 0.5 OR worst_score >= 9             → "negative"
 *   pct_flagged >= 0.25 OR avg_score >= 5              → "mixed"
 *   avg_score <= 2 AND worst_score <= 4                → "positive"
 *   otherwise                                          → "neutral"
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ewg-skin-deep");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/ewg-skin-deep-augment.json");

const FLAG_THRESHOLD = 7;
const MIN_SAMPLE_FOR_OPINION = 3;

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

export function buildAliasIndex(slugs, parentMap) {
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
  const parentByBrandKey = new Map();
  for (const [k, v] of Object.entries(parentMap || {})) {
    if (k.startsWith("_")) continue;
    if (v && typeof v === "object" && v.parent && slugSet.has(v.parent)) {
      parentByBrandKey.set(k, v.parent);
    }
  }
  idx.__parentByBrandKey = parentByBrandKey;
  return idx;
}

export function matchBrand(name, idx) {
  const en = normalizeCompanyName(name);
  if (!en) return null;
  if (idx.has(en)) return idx.get(en);
  const variants = new Set([
    en.replace(/'/g, " ").replace(/\s+/g, " ").trim(),
    en.replace(/'/g, ""),
    en.replace(/-/g, " "),
    en.replace(/-/g, ""),
  ]);
  for (const v of variants) if (v && idx.has(v)) return idx.get(v);
  if (idx.__parentByBrandKey) {
    const bk = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (bk && idx.__parentByBrandKey.has(bk)) return idx.__parentByBrandKey.get(bk);
  }
  const tokens = en.split(/[\s\-']+/).filter(Boolean);
  if (tokens.length >= 2) {
    const head2 = tokens.slice(0, 2).join(" ");
    if (idx.has(head2)) return idx.get(head2);
  }
  if (tokens[0] && tokens[0].length >= 5 && idx.has(tokens[0])) return idx.get(tokens[0]);
  return null;
}

export function classify(stats) {
  const { sample, avg, worst, pct_flagged } = stats;
  if (sample < MIN_SAMPLE_FOR_OPINION) return "neutral";
  if (pct_flagged >= 0.5 || worst >= 9) return "negative";
  if (pct_flagged >= 0.25 || avg >= 5) return "mixed";
  if (avg <= 2 && worst <= 4) return "positive";
  return "neutral";
}

export function rollUpByBrand(productsBySlug, sourceUrl) {
  const out = {};
  for (const [slug, products] of productsBySlug) {
    const scores = products.map(p => p.score);
    const sample = scores.length;
    const avg = sample ? scores.reduce((a, b) => a + b, 0) / sample : 0;
    const worst = sample ? Math.max(...scores) : 0;
    const flagged = scores.filter(s => s >= FLAG_THRESHOLD).length;
    const pct_flagged = sample ? flagged / sample : 0;
    const sorted = products.slice().sort((a, b) => b.score - a.score);
    const sampleProducts = sorted.slice(0, 5).map(p => ({ product: p.product, score: p.score }));
    out[slug] = {
      slug,
      ewg_avg_score: Number(avg.toFixed(2)),
      ewg_worst_score: worst,
      ewg_pct_flagged: Number(pct_flagged.toFixed(3)),
      ewg_product_count: sample,
      ewg_flagged_count: flagged,
      sample_products: sampleProducts,
      severity: classify({ sample, avg, worst, pct_flagged }),
      source: "ewg-skin-deep",
      source_url: sourceUrl,
    };
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const slugs = await loadCompanySlugs();
  const idx = buildAliasIndex(slugs, await loadParentMap());

  const productsBySlug = new Map();
  let matched = 0;
  let unmatched = 0;
  for (const p of snap.products || []) {
    const slug = matchBrand(p.brand, idx);
    if (!slug) { unmatched++; continue; }
    matched++;
    if (!productsBySlug.has(slug)) productsBySlug.set(slug, []);
    productsBySlug.get(slug).push(p);
  }

  const companies = rollUpByBrand(productsBySlug, snap.source_url);

  // severity histogram for the run log
  const sev = { positive: 0, mixed: 0, neutral: 0, negative: 0 };
  for (const v of Object.values(companies)) sev[v.severity]++;

  const augment = {
    source: "ewg-skin-deep",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    raw_product_count: (snap.products || []).length,
    matched_product_count: matched,
    unmatched_product_count: unmatched,
    matched_slug_count: Object.keys(companies).length,
    severity_histogram: sev,
    flag_threshold: FLAG_THRESHOLD,
    min_sample_for_opinion: MIN_SAMPLE_FOR_OPINION,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  ${matched}/${(snap.products || []).length} products matched → ${Object.keys(companies).length} slugs`);
  console.log(`  severity: positive=${sev.positive} mixed=${sev.mixed} neutral=${sev.neutral} negative=${sev.negative}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ewg-skin-deep-merge failed:", err);
    process.exit(1);
  });
}
