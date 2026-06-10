#!/usr/bin/env node
/**
 * R5-1 — Merge CA DLSE wage-theft cases into per-slug augment.
 *
 * Reads:    data/raw/ca-dlse/<YYYY-MM-DD>.json   (from ca-dlse-fetch.mjs)
 * Writes:   data/derived/ca-dlse-augment.json    (consumed by apply-augments)
 *
 * Slug-resolution precedence (mirrors intl-regulator-resolve):
 *   1. employer_brand → slug (kernel-supplied; deterministic)
 *   2. employer string → slugify(suffix-strip) direct match
 *   3. raw slug match
 *   4. slug-aliases.json
 *   5. brand-parent-map.json
 *   6. seed mapping (this file)
 *   7. orphan
 *
 * Critical safety: NO free first-token fallback. Wage-claim records can
 * name individuals or third-party contractors; we only credit a citation
 * to a TruNorth-listed brand when a kernel-supplied `employer_brand` field
 * (set at fetch time by a human-verified press release) routes to it, or
 * the suffix-stripped slug match is exact.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnownSlugs, loadMaps, resolveSlug } from "./lib/intl-regulator-resolve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ca-dlse");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const OUT_FILE = path.join(ROOT, "data/derived/ca-dlse-augment.json");

// Brand-name → slug seed table for kernel `employer_brand` fields. These
// are the only employer→slug bindings the merger trusts unconditionally.
const BRAND_SEED = {
  "Foster Farms": "foster-farms",
  "McDonald's": "mcdonald-s",
  "Chipotle": "chipotle",
  "Jack in the Box": "jack-in-the-box",
  "Cheesecake Factory": "cheesecake-factory",
  "Domino's Pizza": "domino-s-pizza",
  "Darden Restaurants": "darden-restaurants",
  "Panera Bread": "panera-bread",
  "Subway": "subway",
  "Starbucks": "starbucks",
  "Hilton": "hilton-hotels-and-resorts",
  "Marriott": "marriott-international",
  "Burger King": "burger-king",
  "Taco Bell": "taco-bell",
  "Wendy's": "wendy-s",
  "Costco": "costco",
  "Home Depot": "home-depot",
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
    const files = (await fs.readdir(RAW_DIR)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

export function classifySeverity(totalWagesUsd, totalCitationUsd, caseCount) {
  // Conservative tiers:
  //   landmark (very_poor) — ≥$1M assessed wages OR ≥$10M total citation
  //   pattern (poor)       — ≥3 actions OR ≥$500K wages
  //   single mixed         — otherwise
  if (totalWagesUsd >= 1_000_000 || totalCitationUsd >= 10_000_000) return "very_poor";
  if (caseCount >= 3 || totalWagesUsd >= 500_000) return "poor";
  return "mixed";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  console.log(`ca-dlse-merge: ${snap.case_count} cases from ${snap.snapshot_date}`);

  const knownSlugs = await loadKnownSlugs(COMP_DIR);
  const maps = await loadMaps();

  const bySlug = new Map();
  const orphans = [];
  const skippedNoBrand = [];

  for (const c of snap.cases || []) {
    let slug = null;
    let routed_via = null;

    // 1. Prefer kernel-supplied brand pin (deterministic, audited).
    if (c.employer_brand && BRAND_SEED[c.employer_brand]) {
      const cand = BRAND_SEED[c.employer_brand];
      if (knownSlugs.has(cand)) {
        slug = cand;
        routed_via = "brand-seed";
      }
    }

    // 2. Otherwise try the general resolver, but DO NOT use first-token
    //    fallback (set its blocklist token to ensure orphan rather than
    //    over-match).
    if (!slug && c.employer) {
      const r = resolveSlug(c.employer, knownSlugs, maps);
      // Refuse first-token routes for wage claims — too ambiguous.
      if (r.routed_via !== "first-token" && r.routed_via !== "orphan" && r.slug) {
        slug = r.slug;
        routed_via = r.routed_via;
      }
    }

    if (!slug) {
      if (c.employer_brand) orphans.push({ employer: c.employer, brand: c.employer_brand, url: c.url });
      else                  skippedNoBrand.push({ employer: c.employer, url: c.url });
      continue;
    }

    const bucket = bySlug.get(slug) || { cases: [], routed_via };
    bucket.cases.push(c);
    bySlug.set(slug, bucket);
  }

  const companies = {};
  for (const [slug, { cases, routed_via }] of bySlug) {
    const sorted = [...cases].sort((a, b) => (b.citation_usd || 0) - (a.citation_usd || 0));
    const totalCitation = cases.reduce((s, c) => s + (c.citation_usd || 0), 0);
    const totalWages    = cases.reduce((s, c) => s + (c.wages_usd || 0), 0);
    const totalWorkers  = cases.reduce((s, c) => s + (c.workers_affected || 0), 0);
    const dates = cases.map(c => c.date).filter(Boolean).sort();
    companies[slug] = {
      slug,
      case_count: cases.length,
      total_citation_usd: totalCitation,
      total_wages_usd: totalWages,
      total_workers_affected: totalWorkers,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
      routed_via,
      severity_tier: classifySeverity(totalWages, totalCitation, cases.length),
      top_cases: sorted.slice(0, 3).map(c => ({
        date: c.date,
        citation_usd: c.citation_usd,
        wages_usd: c.wages_usd,
        workers_affected: c.workers_affected,
        summary: c.summary,
        url: c.url,
      })),
      source: "ca-dlse",
      source_url: snap.source_url,
    };
  }

  const augment = {
    source: "ca-dlse",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    input: path.relative(ROOT, rawPath),
    matched_slug_count: Object.keys(companies).length,
    orphan_count: orphans.length,
    skipped_no_brand: skippedNoBrand.length,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath}  (${augment.matched_slug_count} slugs, ${augment.orphan_count} orphans, ${augment.skipped_no_brand} no-brand)`);
  if (orphans.length) {
    console.log(`  orphans:`, orphans.slice(0, 10));
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("ca-dlse-merge failed:", err); process.exit(1); });
}
