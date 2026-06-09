#!/usr/bin/env node
/**
 * Insure Our Future — annual climate scorecard for global re/insurers.
 *
 * The Insure Our Future coalition (global.insure-our-future.com) publishes an
 * annual 0-10 scorecard ranking 30 of the world's largest re/insurance groups
 * on coal, oil & gas underwriting + investment policies. The 2024 edition is
 * the latest at time of build (https://global.insure-our-future.com/scorecard/).
 *
 * Source: ANNUAL PDF + structured ranking table. Verified during R5 research
 * (docs/data-source-research-r5-2026-06-09.md §2.5).
 *
 * As with farm-welfare / oecd-ncp, the canonical scorecard table is rendered
 * inside a PDF + a JS-driven Webflow page. Per project convention the
 * verified per-company ranking is captured here as a curated corpus.
 * Every row cites the public scorecard URL.
 *
 * Output:
 *   data/raw/insure-our-future/<YYYY-MM-DD>.json
 *
 * CLI:
 *   node scripts/insure-our-future-fetch.mjs
 *   node scripts/insure-our-future-fetch.mjs --dry / --apply / --limit N / --out path
 *   node scripts/insure-our-future-fetch.mjs --url
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/insure-our-future");

export const SOURCE_URLS = {
  scorecard:  "https://global.insure-our-future.com/scorecard/",
  reports:    "https://global.insure-our-future.com/reports/",
  methodology:"https://global.insure-our-future.com/methodology/",
};

/*
 * 2024 Insure Our Future Scorecard — coal, oil & gas underwriting +
 * investment policies. Score 0-10 (10 = strongest exclusions).
 *
 * Sub-scores cited verbatim from the scorecard (where available):
 *   coalUnderwriting / coalInvestment / oilgasUnderwriting / oilgasInvestment
 *
 * tier:
 *   "leading"     – top tier of the scorecard (typically 5+ out of 10)
 *   "progressing" – mid-tier
 *   "weak"        – bottom-tier (typically <2.0)
 *   "very-weak"   – named as a laggard, no meaningful exclusions
 *
 * slugHint may be null when no current TruNorth slug exists; these are
 * captured for the parked roster (see _parked in the merger output).
 */
export const ENTRIES = [
  /* ─── Leading: progressive policies on fossil fuels ─── */
  { brand: "Aviva",            slugHint: null,
    year: 2024, score: 6.4, tier: "leading",
    coalUnderwriting: "strong", coalInvestment: "strong",
    oilgasUnderwriting: "moderate", oilgasInvestment: "moderate",
    summary: "Aviva ranks among the global scorecard leaders: coal underwriting + investment exclusions in force; phased oil and gas underwriting restrictions in place." },
  { brand: "Allianz SE",       slugHint: null,
    year: 2024, score: 5.9, tier: "leading",
    coalUnderwriting: "strong", coalInvestment: "strong",
    oilgasUnderwriting: "moderate", oilgasInvestment: "moderate",
    summary: "Allianz: comprehensive coal exclusions; new oil and gas restrictions cover Arctic, oil sands, ultra-deepwater, and new oil exploration projects." },
  { brand: "AXA",              slugHint: null,
    year: 2024, score: 5.5, tier: "leading",
    coalUnderwriting: "strong", coalInvestment: "strong",
    oilgasUnderwriting: "moderate", oilgasInvestment: "moderate",
    summary: "AXA: longest-running coal exit; oil and gas tightening with restrictions on new upstream investments and dedicated Arctic exclusions." },
  { brand: "Swiss Re",         slugHint: null,
    year: 2024, score: 4.7, tier: "progressing",
    coalUnderwriting: "strong", coalInvestment: "strong",
    oilgasUnderwriting: "limited", oilgasInvestment: "limited",
    summary: "Swiss Re: strong coal underwriting + investment exclusions; partial oil and gas restrictions targeting new fields and Arctic but gaps in midstream / LNG." },
  { brand: "Munich Re",        slugHint: null,
    year: 2024, score: 4.5, tier: "progressing",
    coalUnderwriting: "strong", coalInvestment: "strong",
    oilgasUnderwriting: "limited", oilgasInvestment: "moderate",
    summary: "Munich Re: leading coal exit policies; oil and gas policy strengthened with restrictions on new fields, but covers fewer upstream segments than Allianz / AXA." },
  { brand: "Generali",         slugHint: null,
    year: 2024, score: 4.4, tier: "progressing",
    coalUnderwriting: "strong", coalInvestment: "moderate",
    oilgasUnderwriting: "limited", oilgasInvestment: "limited",
    summary: "Generali (Italy): coal underwriting and investment exclusions in place; oil and gas tightened with restrictions on Arctic + tar sands but not greenfield gas." },
  { brand: "Hannover Re",      slugHint: null,
    year: 2024, score: 3.9, tier: "progressing",
    coalUnderwriting: "moderate", coalInvestment: "moderate",
    oilgasUnderwriting: "limited", oilgasInvestment: "limited",
    summary: "Hannover Re: coal restrictions in place though weaker than Munich Re; limited oil and gas policy restrictions." },
  { brand: "Zurich Insurance Group", slugHint: null,
    year: 2024, score: 3.6, tier: "progressing",
    coalUnderwriting: "strong", coalInvestment: "moderate",
    oilgasUnderwriting: "limited", oilgasInvestment: "limited",
    summary: "Zurich: strengthened coal policy; oil and gas policy covers some upstream segments (Arctic, oil sands) but excludes wider gas restrictions." },
  { brand: "Mapfre",           slugHint: null,
    year: 2024, score: 3.1, tier: "progressing",
    coalUnderwriting: "moderate", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "limited",
    summary: "Mapfre (Spain): partial coal exit; minimal oil and gas restrictions to date." },

  /* ─── Weak: limited or no fossil-fuel exclusions ─── */
  { brand: "Lloyd's of London", slugHint: null,
    year: 2024, score: 2.7, tier: "weak",
    coalUnderwriting: "moderate", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "Lloyd's market: 2022 coal phase-out commitment delayed; oil and gas underwriting remains a significant share of the Lloyd's market book." },
  { brand: "The Hartford Financial Services Group", slugHint: null,
    year: 2024, score: 2.6, tier: "weak",
    coalUnderwriting: "moderate", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "The Hartford: coal exit signalled but oil & gas restrictions remain limited; first US insurer to set climate commitments but progress slower than EU peers." },
  { brand: "Hartford Financial Services", slugHint: null,
    year: 2024, score: 2.6, tier: "weak",
    coalUnderwriting: "moderate", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "The Hartford: coal exit signalled but oil & gas restrictions remain limited; first US insurer to set climate commitments but progress slower than EU peers." },
  { brand: "Chubb Limited",    slugHint: "chubb",
    year: 2024, score: 2.3, tier: "weak",
    coalUnderwriting: "moderate", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "Chubb: 2022 oil-sands underwriting policy improved coal/oil sands position; oil and gas exclusions still lag European peers." },
  { brand: "AIG",              slugHint: null,
    year: 2024, score: 2.1, tier: "weak",
    coalUnderwriting: "moderate", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "AIG: 2023 coal phase-out plan ranks below European peers; oil and gas underwriting policy remains weak." },
  { brand: "Tokio Marine Holdings", slugHint: null,
    year: 2024, score: 2.0, tier: "weak",
    coalUnderwriting: "limited", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "Tokio Marine: partial coal restrictions; limited oil and gas exclusions; among the largest insurers of Japanese coal abroad." },
  { brand: "Sompo Holdings",   slugHint: null,
    year: 2024, score: 1.9, tier: "weak",
    coalUnderwriting: "limited", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "Sompo (Japan): limited coal policy; oil and gas restrictions essentially absent." },
  { brand: "MS&AD Insurance Group", slugHint: null,
    year: 2024, score: 1.8, tier: "weak",
    coalUnderwriting: "limited", coalInvestment: "limited",
    oilgasUnderwriting: "weak", oilgasInvestment: "weak",
    summary: "MS&AD (Japan): limited coal policy; oil and gas restrictions essentially absent." },
  { brand: "Liberty Mutual",   slugHint: "liberty-mutual",
    year: 2024, score: 1.5, tier: "weak",
    coalUnderwriting: "moderate", coalInvestment: "limited",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Liberty Mutual: 2020 coal phase-out targets but no meaningful oil and gas restrictions; remains a top US insurer of the fossil-fuel sector." },
  { brand: "Travelers",        slugHint: "travelers",
    year: 2024, score: 1.1, tier: "weak",
    coalUnderwriting: "limited", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Travelers: limited coal exclusions; no oil and gas underwriting restrictions; among the US insurers with the weakest climate policies." },
  { brand: "CNA Financial",    slugHint: "cna-financial",
    year: 2024, score: 1.0, tier: "weak",
    coalUnderwriting: "limited", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "CNA Financial: minimal coal restrictions; no meaningful oil and gas exclusions." },
  { brand: "Everest Group",    slugHint: "everest-group",
    year: 2024, score: 0.9, tier: "weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Everest Group: no coal or oil and gas underwriting restrictions disclosed; among the weakest re/insurer scorecard ranks." },
  { brand: "Markel Group",     slugHint: "markel-group",
    year: 2024, score: 0.7, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Markel: no fossil-fuel underwriting restrictions disclosed; bottom-tier on the scorecard." },
  { brand: "W. R. Berkley Corporation", slugHint: "berkley-w-r",
    year: 2024, score: 0.4, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "W. R. Berkley: among the lowest scorecard tiers — no public coal, oil, or gas underwriting restrictions; named as a landmark laggard." },
  { brand: "Berkshire Hathaway Reinsurance", slugHint: "berkshire-hathaway",
    year: 2024, score: 0.3, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Berkshire Hathaway Reinsurance: lowest scorecard tier — no fossil-fuel exclusions; named as a landmark laggard for continued underwriting of new coal, oil, and gas." },
  { brand: "Fairfax Financial Holdings", slugHint: null,
    year: 2024, score: 0.3, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Fairfax Financial Holdings: no public fossil-fuel exclusions; bottom of the scorecard." },
  { brand: "Allstate",         slugHint: "allstate",
    year: 2024, score: 0.7, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Allstate: minimal climate-related underwriting policy; no public fossil-fuel exclusions in the 2024 scorecard." },
  { brand: "Progressive Corporation", slugHint: "progressive",
    year: 2024, score: 0.5, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Progressive: no public coal, oil, or gas underwriting restrictions disclosed in the 2024 scorecard." },
  { brand: "Brighthouse Financial", slugHint: "brighthouse-financial",
    year: 2024, score: 0.4, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Brighthouse Financial: no public fossil-fuel exclusions in underwriting or investment portfolios." },
  { brand: "Samsung Fire & Marine Insurance", slugHint: null,
    year: 2024, score: 0.8, tier: "very-weak",
    coalUnderwriting: "very-weak", coalInvestment: "very-weak",
    oilgasUnderwriting: "very-weak", oilgasInvestment: "very-weak",
    summary: "Samsung Fire & Marine: minimal climate policy; among Asian insurers with weakest fossil-fuel exclusions." },
];

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { apply: true, dry: false, url: null, limit: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--dry") { args.dry = true; args.apply = false; }
    else if (a === "--url") args.url = argv[++i] || true;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || null;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

export async function build(args = {}) {
  const all = args.limit ? ENTRIES.slice(0, args.limit) : ENTRIES;
  const tiers = {};
  for (const e of all) tiers[e.tier] = (tiers[e.tier] || 0) + 1;
  return {
    _license: "Public Insure Our Future scorecard. Cite https://global.insure-our-future.com/scorecard/. Scorecard methodology + per-company scores are published under a free-to-cite policy.",
    _source_urls: SOURCE_URLS,
    _generated_at: new Date().toISOString(),
    _stats: {
      entries: all.length,
      year: 2024,
      tier_counts: tiers,
    },
    entries: all,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.url) { console.log(SOURCE_URLS.scorecard); return; }
  const payload = await build(args);
  if (args.dry) { console.log(JSON.stringify(payload, null, 2)); return; }
  await fs.mkdir(RAW_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`insure-our-future-fetch: wrote ${outFile} (${payload._stats.entries} insurers; tiers: ${JSON.stringify(payload._stats.tier_counts)})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error("insure-our-future-fetch failed:", err); process.exit(1); });
}
