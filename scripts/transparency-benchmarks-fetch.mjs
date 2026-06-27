#!/usr/bin/env node
/**
 * Transparency benchmarks — annual aggregation of public-records corporate
 * transparency rankings, beyond what WikiRate already covers.
 *
 * Powers the NEW "transparency" scoring category (WikiRate PR #7 added it
 * to TruNorth's value pillars). Composite 0–100 score per slug, plus the
 * per-benchmark sub-scores so the brand-detail card can cite each source.
 *
 * Source benchmarks (all free / openly licensed):
 *   1. Ranking Digital Rights (RDR) Corporate Accountability Index
 *      https://rankingdigitalrights.org/index2024
 *      License: CC BY-SA 4.0
 *      ~14 major digital-platform companies, scored 0–100 on freedom of
 *      expression + privacy transparency. Annual.
 *
 *   2. Transparency Pledge — apparel supply-chain disclosure
 *      https://transparencypledge.org/signatory-list/
 *      License: Public coalition list. Boolean: signed / not signed.
 *      ~250 brands signed pledge → 100; unsigned major apparel → 0.
 *
 *   3. Just Capital (JUST 100 + Russell 1000 component)
 *      https://justcapital.com/rankings
 *      License: Free tier, public. Issue-area scores 0–100.
 *      Uses "Communicates Openly" issue weight as a transparency proxy
 *      (per JC's own methodology).
 *
 *   4. Corporate Human Rights Benchmark (CHRB)
 *      https://www.worldbenchmarkingalliance.org/publication/chrb/
 *      License: CC BY 4.0.
 *      Annual ranking — agricultural, apparel, extractives, ICT
 *      manufacturing, automotive. Raw 0–26 → normalized 0–100.
 *
 *   5. Fashion Revolution Fashion Transparency Index
 *      https://www.fashionrevolution.org/about/transparency/
 *      License: CC BY-NC 4.0  (NOTE: NonCommercial — flag for monetization
 *      review before paid tier ships).
 *      ~250 major apparel/footwear brands, raw 0–250 → normalized 0–100.
 *
 *   SKIPPED: CDP Climate Scoring — paywalled since 2025 (per prior
 *   research). Open-Corporates beneficial ownership transparency is
 *   tracked separately by the uk-companies-house pipeline.
 *
 * Output: /data/raw/transparency-benchmarks/<YYYY-MM-DD>.json
 *
 * Pattern follows scripts/asyousow-fetch.mjs:
 *   - Curated mirror of public scorecards (we don't scrape, we vet & cite)
 *   - Re-verified annually against the linked benchmark reports
 *   - Merger handles 0–100 normalization + composite weighting
 *
 * Locally:
 *   node scripts/transparency-benchmarks-fetch.mjs
 *   node scripts/transparency-benchmarks-fetch.mjs --out /tmp/preview.json
 *   node scripts/transparency-benchmarks-fetch.mjs --print-stats
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/raw/transparency-benchmarks");

const argv = process.argv.slice(2);
const OUT_OVERRIDE = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 ? argv[i + 1] : null;
})();
const PRINT_STATS = argv.includes("--print-stats");

// ───────────────────────── benchmark sources ─────────────────────────

// Ranking Digital Rights Corporate Accountability Index — 2024 edition.
// Score 0–100 (RDR's own scale: weighted average of Governance,
// Freedom of Expression, Privacy indicator categories).
// Source: https://rankingdigitalrights.org/index2024/companies
export const RDR_2024 = [
  { slug: "telefonica",            name: "Telefónica",      score: 60 },
  { slug: "vodafone",              name: "Vodafone",        score: 53 },
  { slug: "microsoft",             name: "Microsoft",       score: 53 },
  { slug: "google-alphabet",       name: "Google",          score: 52 },
  { slug: "meta-platforms",        name: "Meta",            score: 51 },
  { slug: "apple",                 name: "Apple",           score: 49 },
  { slug: "verizon",               name: "Verizon",         score: 41 },
  { slug: "atandt",                name: "AT&T",            score: 40 },
  { slug: "yahoo",                 name: "Yahoo",           score: 38 },
  { slug: "amazon",                name: "Amazon",          score: 36 },
  { slug: "samsung-electronics",   name: "Samsung",         score: 34 },
  { slug: "x-twitter",             name: "X (Twitter)",     score: 25 },
  { slug: "tencent",               name: "Tencent",         score: 22 },
  { slug: "alibaba",               name: "Alibaba",         score: 20 },
];

// Transparency Pledge signatories — apparel supply-chain disclosure.
// Boolean coalition: signed → 100, prominent unsigned majors → 0.
// Source: https://transparencypledge.org/signatory-list/  (as of 2025)
export const TXN_PLEDGE_SIGNATORIES = [
  "adidas", "asics", "asos", "benetton", "burberry", "c-and-a",
  "champion", "columbia-sportswear", "cotton-on", "dansk-supermarked",
  "esprit", "fast-retailing", "fruit-of-the-loom", "g-star-raw",
  "gap-inc", "gildan", "h-and-m", "hanesbrands", "hudsons-bay-company",
  "inditex", "jcpenney", "kering", "kmart", "levi-strauss",
  "lidl", "lojas-renner", "lululemon", "marks-and-spencer",
  "mountain-equipment-coop", "new-balance", "next", "nike",
  "patagonia", "pentland", "primark", "puma", "pvh-corp",
  "ralph-lauren", "reformation", "reiss", "shop-direct", "supersam",
  "target", "tchibo", "the-cooperative", "uniqlo", "under-armour",
  "vf-corporation", "white-stuff", "woolworths-south-africa",
];
export const TXN_PLEDGE_MAJOR_NONSIGNATORIES = [
  "shein", "temu", "amazon", "walmart", "boohoo", "fashion-nova",
  "forever-21", "urban-outfitters", "anthropologie", "free-people",
  "zara",
  "louis-vuitton", "gucci", "prada", "chanel",
];

// Just Capital — JUST 100 (2024) + selected Russell 1000 entrants.
// "Communicates Openly" issue-area score, 0–100.
// Source: https://justcapital.com/rankings
export const JUST_CAPITAL_2024 = [
  { slug: "microsoft",             score: 95 },
  { slug: "nvidia",                score: 92 },
  { slug: "alphabet",              score: 90 },
  { slug: "google-alphabet",       score: 90 },
  { slug: "apple",                 score: 88 },
  { slug: "salesforce",            score: 87 },
  { slug: "intel",                 score: 85 },
  { slug: "cisco",                 score: 84 },
  { slug: "accenture",             score: 82 },
  { slug: "ibm",                   score: 81 },
  { slug: "bank-of-america",       score: 79 },
  { slug: "verizon",               score: 78 },
  { slug: "best-buy",              score: 77 },
  { slug: "hp",                    score: 76 },
  { slug: "jpmorgan-chase",        score: 75 },
  { slug: "atandt",                score: 74 },
  { slug: "merck",                 score: 73 },
  { slug: "pfizer",                score: 72 },
  { slug: "johnson-and-johnson",   score: 71 },
  { slug: "pepsico",               score: 70 },
  { slug: "coca-cola",             score: 69 },
  { slug: "target",                score: 68 },
  { slug: "walmart",               score: 67 },
  { slug: "starbucks",             score: 66 },
  { slug: "mcdonalds",             score: 65 },
  { slug: "amazon",                score: 64 },
  { slug: "tesla",                 score: 45 },
  { slug: "meta-platforms",        score: 52 },
  { slug: "exxon-mobil",           score: 48 },
  { slug: "chevron",               score: 51 },
];

// Corporate Human Rights Benchmark (CHRB) 2024 — World Benchmarking
// Alliance. Raw scores 0–26, normalized to 0–100 in normalize().
// Source: https://www.worldbenchmarkingalliance.org/publication/chrb/
export const CHRB_2024_RAW = [
  // Apparel
  { slug: "adidas",                raw: 23.0 },
  { slug: "nike",                  raw: 21.5 },
  { slug: "h-and-m",               raw: 20.8 },
  { slug: "inditex",               raw: 19.5 },
  { slug: "puma",                  raw: 18.7 },
  { slug: "gap-inc",               raw: 18.0 },
  { slug: "lululemon",             raw: 16.2 },
  { slug: "vf-corporation",        raw: 15.5 },
  { slug: "ralph-lauren",          raw: 11.0 },
  { slug: "luxottica",             raw: 8.0 },
  { slug: "prada",                 raw: 4.5 },
  { slug: "shein",                 raw: 2.5 },
  // Agricultural
  { slug: "unilever",              raw: 22.0 },
  { slug: "nestle",                raw: 21.0 },
  { slug: "danone",                raw: 19.5 },
  { slug: "pepsico",               raw: 18.2 },
  { slug: "coca-cola",             raw: 17.5 },
  { slug: "mondelez",              raw: 15.8 },
  { slug: "kellogg",               raw: 14.0 },
  { slug: "general-mills",         raw: 13.5 },
  { slug: "tyson-foods",           raw: 7.5 },
  { slug: "jbs",                   raw: 5.0 },
  // Extractives
  { slug: "bhp",                   raw: 19.0 },
  { slug: "rio-tinto",             raw: 18.5 },
  { slug: "anglo-american",        raw: 18.0 },
  { slug: "shell-usa",             raw: 17.0 },
  { slug: "bp",                    raw: 16.5 },
  { slug: "total-energies",        raw: 15.0 },
  { slug: "exxon-mobil",           raw: 12.0 },
  { slug: "chevron",               raw: 11.5 },
  { slug: "saudi-aramco",          raw: 3.0 },
  // ICT manufacturing
  { slug: "hp",                    raw: 17.5 },
  { slug: "dell",                  raw: 16.8 },
  { slug: "intel",                 raw: 16.0 },
  { slug: "apple",                 raw: 15.5 },
  { slug: "microsoft",             raw: 15.0 },
  { slug: "samsung-electronics",   raw: 13.5 },
  { slug: "sony",                  raw: 12.0 },
  { slug: "lenovo",                raw: 9.5 },
  // Automotive
  { slug: "ford",                  raw: 14.5 },
  { slug: "general-motors",        raw: 13.0 },
  { slug: "toyota",                raw: 12.0 },
  { slug: "volkswagen",            raw: 11.5 },
  { slug: "honda",                 raw: 10.5 },
  { slug: "tesla",                 raw: 4.0 },
];

// Fashion Revolution Fashion Transparency Index 2024 — raw 0–250.
// Source: https://www.fashionrevolution.org/about/transparency/
// LICENSE NOTE: CC BY-NC 4.0 — NonCommercial. Flag for monetization tier.
export const FASHION_REV_2024 = [
  { slug: "omu",                       raw: 208 }, // OVS
  { slug: "kmart-australia",           raw: 195 },
  { slug: "h-and-m",                   raw: 188 },
  { slug: "c-and-a",                   raw: 180 },
  { slug: "vf-corporation",            raw: 178 },
  { slug: "puma",                      raw: 175 },
  { slug: "asos",                      raw: 172 },
  { slug: "gildan",                    raw: 170 },
  { slug: "champion",                  raw: 165 },
  { slug: "esprit",                    raw: 160 },
  { slug: "adidas",                    raw: 158 },
  { slug: "pvh-corp",                  raw: 155 },
  { slug: "gap-inc",                   raw: 145 },
  { slug: "marks-and-spencer",         raw: 142 },
  { slug: "patagonia",                 raw: 135 },
  { slug: "nike",                      raw: 132 },
  { slug: "primark",                   raw: 128 },
  { slug: "inditex",                   raw: 125 },
  { slug: "next",                      raw: 120 },
  { slug: "lululemon",                 raw: 110 },
  { slug: "burberry",                  raw: 105 },
  { slug: "uniqlo",                    raw: 100 },
  { slug: "fast-retailing",            raw: 100 },
  { slug: "kering",                    raw: 95 },
  { slug: "ralph-lauren",              raw: 85 },
  { slug: "under-armour",              raw: 80 },
  { slug: "new-balance",               raw: 70 },
  { slug: "asics",                     raw: 68 },
  { slug: "columbia-sportswear",       raw: 65 },
  { slug: "lacoste",                   raw: 50 },
  { slug: "prada",                     raw: 45 },
  { slug: "chanel",                    raw: 40 },
  { slug: "louis-vuitton",             raw: 35 }, // LVMH
  { slug: "lvmh",                      raw: 35 },
  { slug: "hermes",                    raw: 28 },
  { slug: "amazon",                    raw: 25 },
  { slug: "tom-ford",                  raw: 22 },
  { slug: "boohoo",                    raw: 18 },
  { slug: "forever-21",                raw: 15 },
  { slug: "fashion-nova",              raw: 12 },
  { slug: "shein",                     raw: 10 },
  { slug: "temu",                      raw: 8 },
];

// ────────────────────── source citations ──────────────────────

export const SOURCES = {
  rdr: {
    name: "Ranking Digital Rights Corporate Accountability Index",
    license: "CC BY-SA 4.0",
    url: "https://rankingdigitalrights.org/index2024/",
    vintage: "2024",
  },
  txnPledge: {
    name: "Transparency Pledge",
    license: "Public coalition signatory list",
    url: "https://transparencypledge.org/signatory-list/",
    vintage: "2025",
  },
  justCapital: {
    name: "Just Capital — Communicates Openly issue area",
    license: "Public (free tier)",
    url: "https://justcapital.com/rankings/",
    vintage: "2024",
  },
  chrb: {
    name: "Corporate Human Rights Benchmark — World Benchmarking Alliance",
    license: "CC BY 4.0",
    url: "https://www.worldbenchmarkingalliance.org/publication/chrb/",
    vintage: "2024",
  },
  fashionRevTransparency: {
    name: "Fashion Revolution Fashion Transparency Index",
    license: "CC BY-NC 4.0 (NonCommercial — flag for paid tier)",
    url: "https://www.fashionrevolution.org/about/transparency/",
    vintage: "2024",
  },
};

// ─────────────────────── pure builders ────────────────────────

// Normalize sub-scores onto 0–100.
export function normalize(sub, value) {
  if (value == null) return null;
  switch (sub) {
    case "rdr":
    case "justCapital":
      return Math.max(0, Math.min(100, Math.round(value)));
    case "txnPledge":
      return value ? 100 : 0;
    case "chrb":
      return Math.max(0, Math.min(100, Math.round((value / 26) * 100)));
    case "fashionRevTransparency":
      return Math.max(0, Math.min(100, Math.round((value / 250) * 100)));
    default:
      return null;
  }
}

// Equal-weight composite over non-null sub-scores.
// (Equal weight avoids penalizing a company for absence of an irrelevant
// benchmark — e.g. RDR doesn't score apparel.)
export function compositeScore(subScores) {
  const present = Object.values(subScores).filter(v => v != null && Number.isFinite(v));
  if (present.length === 0) return null;
  const sum = present.reduce((a, b) => a + b, 0);
  return Math.round(sum / present.length);
}

// Build one company record from the 5 benchmark tables.
export function buildRecord(slug) {
  const subScores = {
    rdr: null,
    txnPledge: null,
    justCapital: null,
    chrb: null,
    fashionRevTransparency: null,
  };
  const sourceUrls = [];

  const rdr = RDR_2024.find(r => r.slug === slug);
  if (rdr) {
    subScores.rdr = normalize("rdr", rdr.score);
    sourceUrls.push(SOURCES.rdr.url);
  }

  const signed = TXN_PLEDGE_SIGNATORIES.includes(slug);
  const nonSigned = TXN_PLEDGE_MAJOR_NONSIGNATORIES.includes(slug);
  if (signed || nonSigned) {
    subScores.txnPledge = normalize("txnPledge", signed);
    sourceUrls.push(SOURCES.txnPledge.url);
  }

  const jc = JUST_CAPITAL_2024.find(r => r.slug === slug);
  if (jc) {
    subScores.justCapital = normalize("justCapital", jc.score);
    sourceUrls.push(SOURCES.justCapital.url);
  }

  const chrb = CHRB_2024_RAW.find(r => r.slug === slug);
  if (chrb) {
    subScores.chrb = normalize("chrb", chrb.raw);
    sourceUrls.push(SOURCES.chrb.url);
  }

  const fr = null; // B-63 (2026-06-27): Fashion Revolution disabled — CC-BY-NC, paid tier.
  if (fr) {
    subScores.fashionRevTransparency = normalize("fashionRevTransparency", fr.raw);
    sourceUrls.push(SOURCES.fashionRevTransparency.url);
  }

  const composite = compositeScore(subScores);
  if (composite == null) return null;

  return {
    slug,
    compositeScore: composite,
    subScores,
    sourceUrls: [...new Set(sourceUrls)],
  };
}

// Collect the full deduplicated slug universe across all benchmarks.
export function allSlugs() {
  const s = new Set();
  for (const r of RDR_2024)            s.add(r.slug);
  for (const slug of TXN_PLEDGE_SIGNATORIES)            s.add(slug);
  for (const slug of TXN_PLEDGE_MAJOR_NONSIGNATORIES)   s.add(slug);
  for (const r of JUST_CAPITAL_2024)   s.add(r.slug);
  for (const r of CHRB_2024_RAW)       s.add(r.slug);
  for (const r of FASHION_REV_2024)    s.add(r.slug);
  return [...s].sort();
}

export function buildSnapshot(now = new Date()) {
  const slugs = allSlugs();
  const companies = [];
  for (const slug of slugs) {
    const rec = buildRecord(slug);
    if (rec) companies.push(rec);
  }
  companies.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    generated_at: now.toISOString(),
    source_category: "transparency",
    sources: SOURCES,
    company_count: companies.length,
    companies,
  };
}

async function main() {
  console.log("Transparency benchmarks fetcher starting...");

  const now = new Date();
  const snapshot = buildSnapshot(now);

  const dateStr = now.toISOString().slice(0, 10);
  const outFile = OUT_OVERRIDE
    ? path.resolve(OUT_OVERRIDE)
    : path.join(OUT_DIR, `${dateStr}.json`);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(snapshot, null, 2));

  console.log(`Wrote ${outFile}`);
  console.log(`  ${snapshot.company_count} companies tagged across ${Object.keys(SOURCES).length} benchmarks.`);

  if (PRINT_STATS) {
    const buckets = {
      rdr:                    snapshot.companies.filter(c => c.subScores.rdr != null).length,
      txnPledge:              snapshot.companies.filter(c => c.subScores.txnPledge != null).length,
      justCapital:            snapshot.companies.filter(c => c.subScores.justCapital != null).length,
      chrb:                   snapshot.companies.filter(c => c.subScores.chrb != null).length,
      fashionRevTransparency: snapshot.companies.filter(c => c.subScores.fashionRevTransparency != null).length,
    };
    console.log("  Per-benchmark coverage:");
    for (const [k, v] of Object.entries(buckets)) console.log(`    ${k.padEnd(24)} ${v}`);

    console.log("\n  Top 10 by composite:");
    for (const c of snapshot.companies.slice(0, 10)) {
      console.log(`    ${String(c.compositeScore).padStart(3)}  ${c.slug}`);
    }
    console.log("\n  Bottom 10 by composite:");
    for (const c of snapshot.companies.slice(-10)) {
      console.log(`    ${String(c.compositeScore).padStart(3)}  ${c.slug}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("transparency-benchmarks-fetch failed:", err);
    process.exit(1);
  });
}
