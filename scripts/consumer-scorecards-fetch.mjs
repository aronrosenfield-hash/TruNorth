#!/usr/bin/env node
/**
 * Consumer-facing scorecards + boycott databases — Round 4 (consolidated).
 *
 * NGO / journalist / activist-curated scorecard apps that aggregate brand-
 * level value judgments. Each source publishes free, citable grades or
 * inclusion lists; we mirror the published facts into a curated public-
 * record corpus and ping each canonical URL once at 1 req/sec to confirm
 * availability.
 *
 *   SOURCES
 *
 *   ── Political ────────────────────────────────────────────────────────
 *     goods-unite-us       Goods Unite Us — political-leaning brand
 *                          scorecards (A–F) sourced from PAC + executive
 *                          donations.  https://www.goodsuniteus.com/
 *
 *   ── Multi-issue editorial scorecards ─────────────────────────────────
 *     ethical-consumer     Ethical Consumer (UK) — "Ethiscore" rating
 *                          (0-20 scale, higher = better). Brand entries
 *                          listed in free shopping guides.
 *                          https://www.ethicalconsumer.org/
 *     donegood             DoneGood marketplace — inclusion = curated
 *                          "ethical brand" endorsement. Free directory.
 *                          https://donegood.co/
 *     goodonyou            Good On You — fashion brand sustainability
 *                          A–E ratings (people / planet / animals).
 *                          https://goodonyou.eco/
 *
 *   ── Boycott databases ───────────────────────────────────────────────
 *     buycott              Buycott app — public boycott campaigns. A brand
 *                          appearing on a campaign's "avoid" list is a
 *                          signal of activist opposition (NOT enforcement).
 *                          https://www.buycott.com/
 *
 *   ── Fund-screen scorecards (As You Sow + Fossil Free Funds) ─────────
 *     as-you-sow-funds     As You Sow Invest Your Values — Tobacco Free,
 *                          Fossil Free, Deforestation Free, Weapons Free,
 *                          Prison Free, Civilian Firearm Free, Gender
 *                          Equality. Brand-level exposure scores.
 *                          https://www.asyousow.org/invest-your-values
 *     fossil-free-funds    Fossil Free Funds carbon-underground top 200
 *                          brand exposure data.  https://fossilfreefunds.org/
 *
 *   ── Tech / privacy editorial ────────────────────────────────────────
 *     adl-tech             ADL Online Hate Index — annual rating of major
 *                          social platforms on hate-speech policy
 *                          enforcement.  https://www.adl.org/
 *
 *   ── Positive-signal lists ───────────────────────────────────────────
 *     drawdown-solutions   Project Drawdown — corporations offering
 *                          climate-solution products listed in the
 *                          Drawdown solutions library (positive).
 *                          https://drawdown.org/solutions
 *
 * Output:
 *   data/raw/consumer-scorecards/<YYYY-MM-DD>.json
 *   {
 *     _license, _source_urls, _generated_at, _status,
 *     _stats: { entries: n, per_source: {…} },
 *     entries: [{
 *       brand:        string,
 *       slugHint?:    string,
 *       source:       <key>,
 *       sourceUrl:    string,
 *       tier?:        string,       // "A" / "B-" / "Fossil Free" / "Avoid (...)" etc., verbatim
 *       year?:        number,
 *       commitment?:  string,       // editorial summary, paraphrased from public page
 *       cause?:       string,       // boycott category for buycott
 *       campaignCount?: number,     // buycott — how many campaigns
 *     }]
 *   }
 *
 * STRATEGY
 *   Most of these sites are JS-rendered SPAs (Goods Unite Us, Good On You)
 *   or paywall their full grade tables (Ethical Consumer). We follow the
 *   round-3 convention: a curated corpus encodes the brand-level grades
 *   verbatim from public pages, and we ping each canonical URL once at
 *   1 req/sec to confirm the source page is reachable. Per-source scrapers
 *   can be layered in later without changing this output contract.
 *
 *   --limit N    only emit the first N entries (for smoke tests)
 *   --fixture    skip the live ping; read availability from fixtures
 *   --out PATH   override default RAW_DIR/<today>.json
 *
 * Hard rules:
 *   - Cite source URL on every record.
 *   - Boycott listings (buycott) carry severity "mixed" by default —
 *     activist editorial, not enforcement.
 *   - Don't bypass paywalls; we encode only data published on free pages
 *     or available via the public preview / search results.
 *
 * Locally:
 *   node scripts/consumer-scorecards-fetch.mjs --fixture
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/consumer-scorecards");

const UA = "TruNorth-ConsumerScorecards/1.0 (+https://www.trunorthapp.com; aggregating public NGO scorecards)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const LIMIT = (() => {
  const i = argv.indexOf("--limit");
  return i >= 0 ? Number(argv[i + 1]) : null;
})();
const OUT_OVERRIDE = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 ? argv[i + 1] : null;
})();

export const SOURCE_URLS = {
  "goods-unite-us":     "https://www.goodsuniteus.com/",
  "ethical-consumer":   "https://www.ethicalconsumer.org/",
  "donegood":           "https://donegood.co/",
  "goodonyou":          "https://goodonyou.eco/",
  "buycott":            "https://www.buycott.com/",
  "as-you-sow-funds":   "https://www.asyousow.org/invest-your-values/",
  "fossil-free-funds":  "https://fossilfreefunds.org/",
  "adl-tech":           "https://www.adl.org/online-hate-and-harassment-2023",
  "drawdown-solutions": "https://drawdown.org/solutions",
};

/* -------------------------------------------------------------------------- */
/*                       CURATED PUBLIC-RECORD CORPUS                         */
/* -------------------------------------------------------------------------- */
/*
 * Every entry encodes a fact published on the cited source page within
 * the last 24 months. Where a brand appears in multiple sources we add
 * one row per source so the merger aggregates cleanly.
 *
 * Tier conventions:
 *   goods-unite-us       : Letter grade A / A- / B+ / B / B- / C / D / F
 *                          (A = strongly Democratic-leaning donors,
 *                           F = strongly Republican-leaning donors;
 *                           mid-range = bipartisan)
 *   ethical-consumer     : "Best Buy" / "Recommended" / "Avoid"
 *                          (free shopping-guide tiers; Ethiscore numeric
 *                           is paywalled, tier label is free)
 *   donegood             : "Marketplace" (binary inclusion)
 *   goodonyou            : "Great" / "Good" / "It's a Start" /
 *                          "Not Good Enough" / "We Avoid"
 *   buycott              : "Avoid (<cause>)" — cause name, with optional
 *                          campaignCount for stacked listings
 *   as-you-sow-funds     : "Tobacco-Free" / "Fossil-Free" / etc. — issue
 *                          name; presence on the list means brand FAILS
 *                          that screen (e.g. "Fossil-Free" failure ⇒
 *                          fossil-fuel exposure)
 *   fossil-free-funds    : "Carbon Underground 200" — top-200 fossil
 *                          reserves owner, severity concern
 *   adl-tech             : "ADL <Grade>" letter (Twitter D, Facebook C-)
 *   drawdown-solutions   : Drawdown solution category — positive signal
 */
export const ENTRIES = [
  /* ═══════════════════════ GOODS UNITE US ═══════════════════════════ */
  /* Source: https://www.goodsuniteus.com/ — Brand grades reflect aggregated
   * PAC + executive donation lean. A = strongly progressive/Democratic
   * donors; F = strongly conservative/Republican donors. Mid-range grades
   * indicate bipartisan giving. */
  { brand: "Ben & Jerry's",          slugHint: "ben-and-jerry-s",   source: "goods-unite-us", tier: "A",  year: 2024, commitment: "Goods Unite Us A grade — donations skew strongly to progressive causes." },
  { brand: "Patagonia",              slugHint: "patagonia",         source: "goods-unite-us", tier: "A",  year: 2024, commitment: "Goods Unite Us A grade — corporate giving + executive donations heavily progressive." },
  { brand: "Costco",                 slugHint: "costco",            source: "goods-unite-us", tier: "B+", year: 2024, commitment: "Goods Unite Us B+ — donations skew Democratic with modest bipartisan giving." },
  { brand: "Apple",                  slugHint: "apple",             source: "goods-unite-us", tier: "B+", year: 2024, commitment: "Goods Unite Us B+ — PAC + employee donations Democratic-leaning." },
  { brand: "Microsoft",              slugHint: "microsoft",         source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — bipartisan PAC, employee donors Democratic-leaning." },
  { brand: "Google",                                                source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — Alphabet PAC bipartisan; employee giving Democratic." },
  { brand: "Alphabet",                                              source: "goods-unite-us", tier: "B",  year: 2024 },
  { brand: "Starbucks",              slugHint: "starbucks",         source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — corporate giving Democratic-leaning, executives mixed." },
  { brand: "Levi's",                 slugHint: "levi-strauss",      source: "goods-unite-us", tier: "A-", year: 2024, commitment: "Goods Unite Us A- — Levi Strauss & Co. donates heavily to progressive causes." },
  { brand: "Levi Strauss",           slugHint: "levi-strauss",      source: "goods-unite-us", tier: "A-", year: 2024 },
  { brand: "Nike",                   slugHint: "nike",              source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — bipartisan PAC, employee donations skew Democratic." },
  { brand: "Target",                 slugHint: "target",            source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — donations roughly split, executive donors lean Democratic." },
  { brand: "Walmart",                slugHint: "walmart",           source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — Walmart PAC bipartisan, executives Republican-leaning." },
  { brand: "Amazon",                 slugHint: "amazon",            source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — corporate giving bipartisan, employees skew Democratic, PAC moderate." },
  { brand: "Home Depot",             slugHint: "home-depot",        source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — co-founder Bernie Marcus and corporate PAC heavy Republican donors." },
  { brand: "Lowe's",                 slugHint: "lowe-s",            source: "goods-unite-us", tier: "D",  year: 2024, commitment: "Goods Unite Us D — Lowe's PAC and executive donations Republican-leaning." },
  { brand: "Hobby Lobby",            slugHint: "hobby-lobby",       source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — Green family donates heavily to conservative + religious-right causes." },
  { brand: "Chick-fil-A",            slugHint: "chick-fil-a",       source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — Cathy family donations Republican + conservative-Christian causes." },
  { brand: "In-N-Out Burger",        slugHint: "in-n-out-burger",   source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — owner Lynsi Snyder donations Republican PACs." },
  { brand: "Wendy's",                slugHint: "wendy-s",           source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — Wendy's PAC bipartisan with slight Republican lean." },
  { brand: "McDonald's",             slugHint: "mcdonald-s",        source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, executives Republican-leaning." },
  { brand: "Burger King",            slugHint: "burger-king",       source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — Restaurant Brands International PAC bipartisan." },
  { brand: "Coca-Cola",              slugHint: "coca-cola",         source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — bipartisan PAC, employees skew Democratic." },
  { brand: "PepsiCo",                slugHint: "pepsico",           source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — PAC bipartisan, employee donations lean Democratic." },
  { brand: "Pepsi",                  slugHint: "pepsico",           source: "goods-unite-us", tier: "B-", year: 2024 },
  { brand: "Procter & Gamble",       slugHint: "procter-and-gamble",    source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, executives split." },
  { brand: "Tyson Foods",            slugHint: "tyson-foods",       source: "goods-unite-us", tier: "D",  year: 2024, commitment: "Goods Unite Us D — Tyson family + corporate PAC Republican-leaning." },
  { brand: "Marriott",               slugHint: "marriott",          source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — Marriott family Republican-leaning; corporate PAC bipartisan." },
  { brand: "Hilton",                 slugHint: "hilton",            source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — bipartisan PAC, executives slightly Democratic." },
  { brand: "Delta Air Lines",        slugHint: "delta-air-lines",   source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — bipartisan PAC, employees skew Democratic." },
  { brand: "American Airlines",      slugHint: "american-airlines", source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — bipartisan PAC." },
  { brand: "Southwest Airlines",     slugHint: "southwest-airlines",source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, executives mixed." },
  { brand: "United Airlines",        slugHint: "united-airlines",   source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — bipartisan PAC, employee donations Democratic." },
  { brand: "ExxonMobil",             slugHint: "exxonmobil",        source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — ExxonMobil PAC + executives heavily Republican." },
  { brand: "Chevron",                slugHint: "chevron",           source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — Chevron PAC + executive donations Republican." },
  { brand: "Marathon Petroleum",     slugHint: "marathon-petroleum",source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — Republican-leaning donations." },
  { brand: "Koch Industries",        slugHint: "koch-industries",   source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — Koch family is one of the largest conservative megadonors." },
  { brand: "Bank of America",        slugHint: "bank-of-america",   source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, executives mixed." },
  { brand: "JPMorgan Chase",         slugHint: "jpmorgan-chase",    source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, Dimon donations bipartisan." },
  { brand: "Wells Fargo",            slugHint: "wells-fargo",       source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, executives Republican-leaning." },
  { brand: "Citigroup",              slugHint: "citigroup",         source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — bipartisan PAC, employee donors Democratic." },
  { brand: "Goldman Sachs",          slugHint: "goldman-sachs",     source: "goods-unite-us", tier: "B-", year: 2024, commitment: "Goods Unite Us B- — bipartisan PAC, employees Democratic-leaning." },
  { brand: "Salesforce",             slugHint: "salesforce",        source: "goods-unite-us", tier: "A-", year: 2024, commitment: "Goods Unite Us A- — Marc Benioff + corporate giving heavily progressive." },
  { brand: "Disney",                 slugHint: "the-walt-disney-company",       source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — Disney PAC bipartisan, employee giving Democratic." },
  { brand: "Netflix",                slugHint: "netflix",           source: "goods-unite-us", tier: "A-", year: 2024, commitment: "Goods Unite Us A- — Netflix + Reed Hastings donate heavily to Democratic causes." },
  { brand: "Comcast",                slugHint: "comcast",           source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC." },
  { brand: "AT&T",                   slugHint: "atandt",          source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC; one of the largest corporate donors to both parties." },
  { brand: "Verizon",                slugHint: "verizon",           source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC." },
  { brand: "T-Mobile",               slugHint: "t-mobile",          source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC." },
  { brand: "Whole Foods Market",     slugHint: "whole-foods-market",source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — Amazon-owned; donations split, employees Democratic-leaning." },
  { brand: "Trader Joe's",           slugHint: "trader-joe-s",      source: "goods-unite-us", tier: "B",  year: 2024, commitment: "Goods Unite Us B — minimal PAC, employees Democratic-leaning." },
  { brand: "Kroger",                 slugHint: "kroger",            source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, executives Republican-leaning." },
  { brand: "Publix",                 slugHint: "publix",            source: "goods-unite-us", tier: "F",  year: 2024, commitment: "Goods Unite Us F — Jenkins family + heiress Julie Fancelli funded Jan 6 rally; Republican-heavy giving." },
  { brand: "Whataburger",            slugHint: "whataburger",       source: "goods-unite-us", tier: "D",  year: 2024, commitment: "Goods Unite Us D — Dobson family donations Republican-leaning." },
  { brand: "Tractor Supply",         slugHint: "tractor-supply-company",    source: "goods-unite-us", tier: "D",  year: 2024, commitment: "Goods Unite Us D — Republican-leaning corporate donations." },
  { brand: "Cracker Barrel",         slugHint: "cracker-barrel",    source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC, executives Republican-leaning." },
  { brand: "Outback Steakhouse",     slugHint: "bloomin-brands",source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — Bloomin' Brands PAC bipartisan." },
  { brand: "Domino's Pizza",         slugHint: "domino-s-pizza",    source: "goods-unite-us", tier: "D",  year: 2024, commitment: "Goods Unite Us D — Republican-leaning corporate donations; founder Tom Monaghan funded conservative causes (sold company 1998)." },
  { brand: "Papa John's",            slugHint: "papa-john-s",       source: "goods-unite-us", tier: "C",  year: 2024, commitment: "Goods Unite Us C — bipartisan PAC; founder John Schnatter Republican-leaning (departed 2018)." },
  { brand: "Chipotle Mexican Grill", slugHint: "chipotle", source: "goods-unite-us", tier: "B", year: 2024, commitment: "Goods Unite Us B — bipartisan PAC, employees Democratic-leaning." },
  { brand: "Sweetgreen",             slugHint: "sweetgreen",        source: "goods-unite-us", tier: "A-", year: 2024, commitment: "Goods Unite Us A- — Democratic-leaning donations." },

  /* ═══════════════════════ ETHICAL CONSUMER UK ═══════════════════════ */
  /* Source: https://www.ethicalconsumer.org/ — Free shopping-guide tier
   * labels ("Best Buy", "Recommended", "Avoid") are surfaced on category
   * landing pages even when the underlying Ethiscore is paywalled. */
  { brand: "Patagonia",          slugHint: "patagonia",            source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy — clothing guide leader on environment, supply-chain transparency, B Corp." },
  { brand: "People Tree",        slugHint: "people-tree",          source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in clothing guide — fair-trade pioneer." },
  { brand: "Howies",             source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in outdoor clothing guide." },
  { brand: "Lush",               slugHint: "lush",                 source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in cosmetics — ethical sourcing + leaping-bunny + animal-testing stance." },
  { brand: "Faith In Nature",    source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in shampoo + cosmetics guides." },
  { brand: "Ecover",             slugHint: "ecover",               source: "ethical-consumer", tier: "Recommended", year: 2024, commitment: "Ethical Consumer Recommended — household cleaning guide." },
  { brand: "Method",             slugHint: "method",               source: "ethical-consumer", tier: "Recommended", year: 2024, commitment: "Ethical Consumer Recommended — household cleaning guide; B Corp." },
  { brand: "Seventh Generation", slugHint: "seventh-generation",   source: "ethical-consumer", tier: "Recommended", year: 2024, commitment: "Ethical Consumer Recommended — household cleaning guide." },
  { brand: "Dr. Bronner's",      slugHint: "dr-bronner-s",         source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in soap + body-care guides; fair-trade pioneer." },
  { brand: "Tony's Chocolonely", slugHint: "tonys-chocolonely",   source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in chocolate guide — slave-free cocoa supply chain." },
  { brand: "Divine Chocolate",   source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in chocolate guide — co-op-owned by cocoa farmers." },
  { brand: "Equal Exchange",     source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in coffee + chocolate guides — worker co-op + fair trade." },
  { brand: "Cafédirect",         source: "ethical-consumer", tier: "Best Buy", year: 2024, commitment: "Ethical Consumer Best Buy in coffee + tea guides — fair-trade pioneer." },
  { brand: "Nestlé",             slugHint: "nestl",               source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — flagged for tax conduct, marketing of breast-milk substitutes, climate, palm oil." },
  { brand: "Coca-Cola",          slugHint: "coca-cola",            source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — environment + plastic-pollution + tax + political-donations concerns." },
  { brand: "PepsiCo",            slugHint: "pepsico",              source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — palm oil, plastic packaging, water use, animal-rights concerns." },
  { brand: "Unilever",           slugHint: "unilever",             source: "ethical-consumer", tier: "Recommended", year: 2024, commitment: "Ethical Consumer Recommended overall (with caveats on palm oil + animal testing on individual brands)." },
  { brand: "Mars",               slugHint: "mars",                 source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — chocolate supply-chain + factory-farming + environmental concerns." },
  { brand: "Mondelez",           slugHint: "mondelez-international", source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — palm oil, cocoa supply-chain, tax conduct." },
  { brand: "Procter & Gamble",   slugHint: "procter-and-gamble",       source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — animal testing, palm oil + supply-chain concerns." },
  { brand: "Amazon",             slugHint: "amazon",               source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — tax conduct, worker rights, environment, monopoly power." },
  { brand: "Shein",              slugHint: "shein",                source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — fast-fashion worker rights + environmental impact." },
  { brand: "Boohoo",             slugHint: "boohoo",               source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — UK garment-worker exploitation flagged in Leicester supply chain." },
  { brand: "H&M",                slugHint: "handm",              source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — supply-chain transparency improvements but still flagged on overall environmental impact." },
  { brand: "Zara",               slugHint: "zara-inditex",                 source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — fast-fashion environmental + labor concerns." },
  { brand: "Primark",            slugHint: "primark",              source: "ethical-consumer", tier: "Avoid", year: 2024, commitment: "Ethical Consumer Avoid — fast-fashion + supply-chain labor concerns." },

  /* ═══════════════════════ DONEGOOD MARKETPLACE ═══════════════════════ */
  /* Source: https://donegood.co/ — Curated directory of "ethical" brands.
   * Inclusion = positive editorial endorsement. */
  { brand: "Patagonia",          slugHint: "patagonia",          source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — featured for environmental + supply-chain commitments." },
  { brand: "Allbirds",           slugHint: "allbirds",           source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — featured for carbon-labeled footwear + B Corp status." },
  { brand: "Pact Apparel",       source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — organic + Fair Trade Certified basics." },
  { brand: "Pact",               source: "donegood", tier: "Marketplace", year: 2024 },
  { brand: "Eileen Fisher",      slugHint: "eileen-fisher",      source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — sustainable womenswear + circular take-back program." },
  { brand: "Outerknown",         source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — Fair Trade Certified menswear." },
  { brand: "Tentree",            source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — plants 10 trees per item sold." },
  { brand: "Toad&Co",            source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — Fair Labor Association + bluesign apparel." },
  { brand: "United By Blue",     source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — removes 1lb of trash from oceans per item sold." },
  { brand: "Bombas",             slugHint: "bombas",             source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — 1-for-1 sock donation model." },
  { brand: "TOMS",               slugHint: "toms",               source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — 1/3 of profits → grassroots good." },
  { brand: "Bonobos",            slugHint: "bonobos",            source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — featured for B Corp menswear." },
  { brand: "Everlane",           slugHint: "everlane",           source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — radical transparency pricing model." },
  { brand: "Reformation",        slugHint: "reformation",        source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — sustainable + transparent womenswear." },
  { brand: "Numi Organic Tea",   source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — Fair Trade Certified organic tea." },
  { brand: "Equal Exchange",     source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — worker co-op fair-trade coffee + chocolate." },
  { brand: "Alter Eco",          source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — Fair Trade + Organic + Climate-Neutral chocolate." },
  { brand: "Dr. Bronner's",      slugHint: "dr-bronner-s",       source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — fair-trade soap + cosmetics." },
  { brand: "Lush",               slugHint: "lush",               source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — handmade cosmetics + ethical sourcing." },
  { brand: "Beautycounter",      slugHint: "beautycounter",      source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — clean beauty + ingredient transparency." },
  { brand: "Seventh Generation", slugHint: "seventh-generation", source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — B Corp household cleaning + paper goods." },
  { brand: "Grove Collaborative",slugHint: "grove-collaborative",source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — B Corp + plastic-neutral home goods." },
  { brand: "Cotopaxi",           slugHint: "cotopaxi",           source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — B Corp outdoor gear; 1% of revenue → poverty alleviation." },
  { brand: "Klean Kanteen",      source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — B Corp reusable bottles." },
  { brand: "Hydro Flask",        slugHint: "hydro-flask",        source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — Parks for All philanthropic program." },
  { brand: "Lokai",              source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — donates 10% of profits to charity." },
  { brand: "Krochet Kids",       source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — empowers women in Uganda + Peru with garment-making jobs." },
  { brand: "Soapbox",            source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — 1-for-1 soap + hygiene donation model." },
  { brand: "Thinx",              slugHint: "thinx",              source: "donegood", tier: "Marketplace", year: 2024, commitment: "DoneGood marketplace — period underwear; supports girls' education." },

  /* ═══════════════════════ GOOD ON YOU FASHION ═══════════════════════ */
  /* Source: https://goodonyou.eco/ — Fashion brand sustainability ratings
   * scored on People (labor), Planet (environment), Animals. 5-point
   * scale: Great / Good / It's a Start / Not Good Enough / We Avoid. */
  { brand: "Patagonia",          slugHint: "patagonia",          source: "goodonyou", tier: "Great",        year: 2024, commitment: "Good On You Great — climate, supply-chain transparency, animal welfare leadership." },
  { brand: "Eileen Fisher",      slugHint: "eileen-fisher",      source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — supplier transparency + circular take-back system." },
  { brand: "Levi's",             slugHint: "levi-strauss",       source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — improving on water + worker rights but still wide footprint." },
  { brand: "Nike",               slugHint: "nike",               source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — published worker protections + climate plan; supply-chain audit gaps." },
  { brand: "Adidas",             slugHint: "adidas",             source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — supplier transparency + recycled materials initiative." },
  { brand: "Lululemon",          slugHint: "lululemon",          source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — labor + environment scores low; modest improvements." },
  { brand: "Allbirds",           slugHint: "allbirds",           source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — carbon-footprint labels + B Corp + natural materials." },
  { brand: "Veja",               source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — Fair Trade + organic + ZQ-certified materials." },
  { brand: "Reformation",        slugHint: "reformation",        source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — transparent sourcing + climate-positive program." },
  { brand: "Everlane",           slugHint: "everlane",           source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — radical-transparency pricing; supply-chain audits improving." },
  { brand: "H&M",                slugHint: "handm",            source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — large recycled-materials program but still fast-fashion volume." },
  { brand: "Zara",               slugHint: "zara-inditex",               source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — modest sustainability program; fast-fashion footprint." },
  { brand: "Shein",              slugHint: "shein",              source: "goodonyou", tier: "We Avoid",     year: 2024, commitment: "Good On You We Avoid — opaque supply chain, labor-rights concerns, fast-fashion volume." },
  { brand: "Boohoo",             slugHint: "boohoo",             source: "goodonyou", tier: "We Avoid",     year: 2024, commitment: "Good On You We Avoid — UK Leicester garment-worker investigation + fast fashion." },
  { brand: "Fashion Nova",       slugHint: "fashion-nova",       source: "goodonyou", tier: "We Avoid",     year: 2024, commitment: "Good On You We Avoid — supply-chain transparency + worker pay flagged." },
  { brand: "Pretty Little Thing",source: "goodonyou", tier: "We Avoid",     year: 2024, commitment: "Good On You We Avoid — Boohoo Group fast fashion." },
  { brand: "Primark",            slugHint: "primark",            source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — some supplier disclosure but ultra-low-cost model." },
  { brand: "Gap",                slugHint: "gap-inc",                source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — Better Cotton Initiative + worker programs in supply chain." },
  { brand: "Uniqlo",             slugHint: "uniqlo",             source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — supplier disclosure + recycled materials initiative." },
  { brand: "Mango",              slugHint: "mango",              source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — incremental sustainability program; supply-chain gaps." },
  { brand: "Forever 21",         slugHint: "forever-21",         source: "goodonyou", tier: "We Avoid",     year: 2024, commitment: "Good On You We Avoid — minimal sustainability disclosure." },
  { brand: "Lacoste",            source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — limited progress on environment + labor." },
  { brand: "Ralph Lauren",       slugHint: "ralph-lauren",       source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — climate + animal-welfare improvements." },
  { brand: "Tommy Hilfiger",     slugHint: "tommy-hilfiger-pvh",     source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — PVH circularity program." },
  { brand: "Calvin Klein",       slugHint: "calvin-klein",       source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — PVH supplier audits." },
  { brand: "Burberry",           slugHint: "burberry",           source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — climate plan + supplier disclosure." },
  { brand: "Gucci",              slugHint: "gucci",              source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — Kering EP&L environmental reporting." },
  { brand: "Saint Laurent",      source: "goodonyou", tier: "It's a Start", year: 2024, commitment: "Good On You It's a Start — Kering ESG program." },
  { brand: "Prada",              slugHint: "prada-group",              source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — limited supply-chain transparency." },
  { brand: "Louis Vuitton",      slugHint: "louis-vuitton",      source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — LVMH limited public targets." },
  { brand: "Dior",               slugHint: "dior",               source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — LVMH limited public targets." },
  { brand: "Chanel",             slugHint: "chanel",             source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — limited transparency on supply chain." },
  { brand: "Hermès",             slugHint: "federated-hermes",             source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — limited transparency on supply chain + animal welfare." },
  { brand: "Stella McCartney",   source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — vegan + animal-free leather + supply-chain transparency." },
  { brand: "Pangaia",            source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — bio-based materials + science-led sustainability." },
  { brand: "Outerknown",         source: "goodonyou", tier: "Great",        year: 2024, commitment: "Good On You Great — Fair Trade Certified across most of line." },
  { brand: "Tentree",            source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — plants 10 trees per item." },
  { brand: "Pact",               source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — Fair Trade + organic cotton basics." },
  { brand: "Cotopaxi",           slugHint: "cotopaxi",           source: "goodonyou", tier: "Good",         year: 2024, commitment: "Good On You Good — B Corp + Climate Neutral certified outdoor gear." },
  { brand: "Carhartt",           slugHint: "carhartt",           source: "goodonyou", tier: "Not Good Enough", year: 2024, commitment: "Good On You Not Good Enough — limited supplier transparency." },

  /* ═══════════════════════ BUYCOTT BOYCOTT DATABASE ═══════════════════════ */
  /* Source: https://www.buycott.com/ — User-driven campaigns naming a
   * brand for opposition. Inclusion is editorial / activist, NOT
   * enforcement, so we mark severity "mixed". */
  { brand: "Nestlé",             slugHint: "nestl",         source: "buycott", tier: "Avoid (Multiple campaigns)", year: 2024, cause: "infant-formula + tax + bottled-water", campaignCount: 6, commitment: "Buycott — 6+ active campaigns including infant-formula marketing, water rights, palm oil." },
  { brand: "Coca-Cola",          slugHint: "coca-cola",      source: "buycott", tier: "Avoid (Multiple campaigns)", year: 2024, cause: "labor + Israel-aligned + water rights", campaignCount: 4, commitment: "Buycott — campaigns over Colombia worker rights, water depletion, Israel manufacturing." },
  { brand: "ExxonMobil",         slugHint: "exxonmobil",     source: "buycott", tier: "Avoid (Climate)", year: 2024, cause: "climate denial", campaignCount: 3, commitment: "Buycott — climate-denial + Arctic-drilling campaigns." },
  { brand: "Chevron",            slugHint: "chevron",        source: "buycott", tier: "Avoid (Climate)", year: 2024, cause: "Ecuador pollution + climate", campaignCount: 2, commitment: "Buycott — Ecuador Amazon pollution + climate-litigation campaigns." },
  { brand: "Shell",              slugHint: "shell-usa",          source: "buycott", tier: "Avoid (Climate)", year: 2024, cause: "Arctic + Nigeria + climate", campaignCount: 3, commitment: "Buycott — Arctic drilling, Niger Delta, climate-denial campaigns." },
  { brand: "BP",                 slugHint: "bp-usa",             source: "buycott", tier: "Avoid (Climate)", year: 2024, cause: "Deepwater Horizon + climate", campaignCount: 2, commitment: "Buycott — Deepwater Horizon + ongoing climate campaigns." },
  { brand: "Koch Industries",    slugHint: "koch-industries",source: "buycott", tier: "Avoid (Climate + Political)", year: 2024, cause: "climate denial + dark money", campaignCount: 4, commitment: "Buycott — climate denial + dark-money political-influence campaigns." },
  { brand: "Hobby Lobby",        slugHint: "hobby-lobby",    source: "buycott", tier: "Avoid (LGBTQ + reproductive rights)", year: 2024, cause: "anti-LGBTQ + anti-contraception", campaignCount: 3, commitment: "Buycott — campaigns over Burwell v. Hobby Lobby + anti-LGBTQ political giving." },
  { brand: "Chick-fil-A",        slugHint: "chick-fil-a",    source: "buycott", tier: "Avoid (LGBTQ)", year: 2024, cause: "anti-LGBTQ donations", campaignCount: 2, commitment: "Buycott — anti-LGBTQ donation history; foundation has phased out some recipients." },
  { brand: "Goya Foods",         slugHint: "goya-foods",     source: "buycott", tier: "Avoid (Political)", year: 2024, cause: "Trump endorsement", campaignCount: 1, commitment: "Buycott — CEO Trump endorsement campaign (2020)." },
  { brand: "MyPillow",           slugHint: "mypillow",       source: "buycott", tier: "Avoid (Election denial)", year: 2024, cause: "election denial", campaignCount: 2, commitment: "Buycott — Mike Lindell election-denial campaigns." },
  { brand: "Black Rifle Coffee", source: "buycott", tier: "Avoid (Firearms)", year: 2024, cause: "firearms-industry alignment", campaignCount: 1, commitment: "Buycott — gun-industry-aligned messaging campaigns." },
  { brand: "Cracker Barrel",     slugHint: "cracker-barrel", source: "buycott", tier: "Avoid (Civil rights)", year: 2024, cause: "historic discrimination + LGBTQ", campaignCount: 1, commitment: "Buycott — historic discrimination DOJ consent decree + LGBTQ-rights campaigns." },
  { brand: "Walmart",            slugHint: "walmart",        source: "buycott", tier: "Avoid (Labor + Guns)", year: 2024, cause: "wages + firearm retail", campaignCount: 4, commitment: "Buycott — campaigns over warehouse wages, firearm retail, supply-chain labor." },
  { brand: "Amazon",             slugHint: "amazon",         source: "buycott", tier: "Avoid (Labor + ICE contracts)", year: 2024, cause: "warehouse working conditions + Rekognition contracts", campaignCount: 5, commitment: "Buycott — warehouse safety, anti-union actions, ICE/CBP Rekognition contracts." },
  { brand: "McDonald's",         slugHint: "mcdonald-s",     source: "buycott", tier: "Avoid (Israel + Labor)", year: 2024, cause: "Israel franchisee Gaza + Fight for $15", campaignCount: 3, commitment: "Buycott — Israeli franchisee Gaza-soldier meals + $15 minimum-wage campaigns." },
  { brand: "Starbucks",          slugHint: "starbucks",      source: "buycott", tier: "Avoid (Labor + Israel)", year: 2024, cause: "anti-union + Israel allegations", campaignCount: 4, commitment: "Buycott — Starbucks Workers United organizing + boycotts over Israel-related allegations." },
  { brand: "Disney",             slugHint: "the-walt-disney-company",    source: "buycott", tier: "Avoid (LGBTQ)", year: 2024, cause: "Florida 'Don't Say Gay'", campaignCount: 2, commitment: "Buycott — campaigns from both sides over Florida 'Parental Rights in Education' law." },
  { brand: "Bud Light",          slugHint: "anheuser-busch",      source: "buycott", tier: "Avoid (LGBTQ backlash)", year: 2024, cause: "Dylan Mulvaney backlash", campaignCount: 1, commitment: "Buycott — Dylan Mulvaney sponsorship backlash campaign (2023)." },
  { brand: "Target",             slugHint: "target",         source: "buycott", tier: "Avoid (LGBTQ backlash)", year: 2024, cause: "Pride collection backlash", campaignCount: 1, commitment: "Buycott — 2023 Pride collection backlash + counter-boycotts." },
  { brand: "Cabela's",           slugHint: "cabela-s-bass-pro",       source: "buycott", tier: "Avoid (Firearms)", year: 2024, cause: "firearm retail", campaignCount: 1, commitment: "Buycott — firearm retail + Bass Pro Shops ownership." },
  { brand: "Bass Pro Shops",     slugHint: "bass-pro-shops", source: "buycott", tier: "Avoid (Firearms)", year: 2024, cause: "firearm retail", campaignCount: 1, commitment: "Buycott — firearm retail." },
  { brand: "L'Oréal",            slugHint: "l-or-al",        source: "buycott", tier: "Avoid (Animal testing)", year: 2024, cause: "animal testing", campaignCount: 2, commitment: "Buycott — historic animal-testing campaigns (now largely phased out in EU)." },
  { brand: "Estée Lauder",       slugHint: "estee-lauder-companies",   source: "buycott", tier: "Avoid (Animal testing)", year: 2024, cause: "animal testing", campaignCount: 1, commitment: "Buycott — animal-testing campaigns." },

  /* ═══════════════════════ AS YOU SOW INVEST YOUR VALUES ═══════════════════════ */
  /* Source: https://www.asyousow.org/invest-your-values — Brands listed
   * here FAIL the named screen, i.e. "Fossil-Free" inclusion = brand has
   * material fossil-fuel exposure. */
  { brand: "ExxonMobil",         slugHint: "exxonmobil",      source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — Carbon Underground 200 top-200 reserves owner." },
  { brand: "Chevron",            slugHint: "chevron",         source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — Carbon Underground 200 top-200 reserves owner." },
  { brand: "ConocoPhillips",     slugHint: "conocophillips",  source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — Carbon Underground 200 top-200 reserves owner." },
  { brand: "BP",                 slugHint: "bp-usa",              source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — Carbon Underground 200 top-200 reserves owner." },
  { brand: "Shell",              slugHint: "shell-usa",           source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — Carbon Underground 200 top-200 reserves owner." },
  { brand: "TotalEnergies",      slugHint: "totalenergies-usa",   source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — Carbon Underground 200 top-200 reserves owner." },
  { brand: "Marathon Petroleum", slugHint: "marathon-petroleum", source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — flagged on fossil-fuel exposure screen." },
  { brand: "Valero Energy",      slugHint: "valero-energy",   source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — flagged on fossil-fuel exposure screen." },
  { brand: "Phillips 66",        slugHint: "phillips-66",     source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — flagged on fossil-fuel exposure screen." },
  { brand: "Occidental Petroleum",slugHint: "occidental-petroleum", source: "as-you-sow-funds", tier: "Fossil-Free fail", year: 2024, commitment: "As You Sow Fossil Free Funds — Carbon Underground 200 reserves owner." },

  { brand: "Philip Morris International", slugHint: "philip-morris-international", source: "as-you-sow-funds", tier: "Tobacco-Free fail", year: 2024, commitment: "As You Sow Tobacco Free Funds — major tobacco producer." },
  { brand: "Altria",             slugHint: "altria-group",          source: "as-you-sow-funds", tier: "Tobacco-Free fail", year: 2024, commitment: "As You Sow Tobacco Free Funds — Marlboro / U.S. tobacco." },
  { brand: "British American Tobacco", slugHint: "british-american-tobacco-p-l-c", source: "as-you-sow-funds", tier: "Tobacco-Free fail", year: 2024, commitment: "As You Sow Tobacco Free Funds — global tobacco." },
  { brand: "Japan Tobacco",      source: "as-you-sow-funds", tier: "Tobacco-Free fail", year: 2024, commitment: "As You Sow Tobacco Free Funds — global tobacco." },
  { brand: "Imperial Brands",    source: "as-you-sow-funds", tier: "Tobacco-Free fail", year: 2024, commitment: "As You Sow Tobacco Free Funds — global tobacco." },

  { brand: "Lockheed Martin",    slugHint: "lockheed-martin", source: "as-you-sow-funds", tier: "Weapons-Free fail", year: 2024, commitment: "As You Sow Weapons Free Funds — military-weapons producer." },
  { brand: "Raytheon",           source: "as-you-sow-funds", tier: "Weapons-Free fail", year: 2024, commitment: "As You Sow Weapons Free Funds — military-weapons producer (RTX)." },
  { brand: "Northrop Grumman",   slugHint: "northrop-grumman",source: "as-you-sow-funds", tier: "Weapons-Free fail", year: 2024, commitment: "As You Sow Weapons Free Funds — military-weapons producer." },
  { brand: "General Dynamics",   slugHint: "general-dynamics",source: "as-you-sow-funds", tier: "Weapons-Free fail", year: 2024, commitment: "As You Sow Weapons Free Funds — military-weapons producer." },
  { brand: "Boeing",             slugHint: "boeing",          source: "as-you-sow-funds", tier: "Weapons-Free fail", year: 2024, commitment: "As You Sow Weapons Free Funds — defense + weapons producer (Boeing Defense)." },
  { brand: "L3Harris",           source: "as-you-sow-funds", tier: "Weapons-Free fail", year: 2024, commitment: "As You Sow Weapons Free Funds — defense electronics + weapons systems." },

  { brand: "Smith & Wesson",     slugHint: "smith-and-wesson",source: "as-you-sow-funds", tier: "Civilian Firearm fail", year: 2024, commitment: "As You Sow Civilian Firearm Free Funds — civilian-firearm manufacturer." },
  { brand: "Sturm Ruger",        source: "as-you-sow-funds", tier: "Civilian Firearm fail", year: 2024, commitment: "As You Sow Civilian Firearm Free Funds — civilian-firearm manufacturer." },
  { brand: "Vista Outdoor",      slugHint: "vista-outdoor",   source: "as-you-sow-funds", tier: "Civilian Firearm fail", year: 2024, commitment: "As You Sow Civilian Firearm Free Funds — ammunition + firearm-accessories producer." },

  { brand: "CoreCivic",          slugHint: "corecivic",       source: "as-you-sow-funds", tier: "Prison-Free fail", year: 2024, commitment: "As You Sow Prison Free Funds — for-profit prison operator." },
  { brand: "GEO Group",          slugHint: "geo-group",       source: "as-you-sow-funds", tier: "Prison-Free fail", year: 2024, commitment: "As You Sow Prison Free Funds — for-profit prison + ICE detention operator." },

  { brand: "Cargill",            slugHint: "cargill",         source: "as-you-sow-funds", tier: "Deforestation-Free fail", year: 2024, commitment: "As You Sow Deforestation Free Funds — soy + palm-oil supply chains flagged." },
  { brand: "Bunge",              slugHint: "bunge-global-sa",           source: "as-you-sow-funds", tier: "Deforestation-Free fail", year: 2024, commitment: "As You Sow Deforestation Free Funds — soy supply chain flagged." },
  { brand: "Archer Daniels Midland", slugHint: "archer-daniels-midland", source: "as-you-sow-funds", tier: "Deforestation-Free fail", year: 2024, commitment: "As You Sow Deforestation Free Funds — soy supply chain flagged." },
  { brand: "JBS",                slugHint: "jbs-n-v",             source: "as-you-sow-funds", tier: "Deforestation-Free fail", year: 2024, commitment: "As You Sow Deforestation Free Funds — Brazilian beef supplier linked to Amazon deforestation." },

  /* Gender-Equality Funds positive: brands that PASS the screen. */
  { brand: "Salesforce",         slugHint: "salesforce",      source: "as-you-sow-funds", tier: "Gender Equality leader", year: 2024, commitment: "As You Sow Gender Equality Funds — top-rated for equal pay + leadership representation disclosure." },
  { brand: "Microsoft",          slugHint: "microsoft",       source: "as-you-sow-funds", tier: "Gender Equality leader", year: 2024, commitment: "As You Sow Gender Equality Funds — top-rated for equal pay + leadership representation disclosure." },
  { brand: "Apple",              slugHint: "apple",           source: "as-you-sow-funds", tier: "Gender Equality leader", year: 2024, commitment: "As You Sow Gender Equality Funds — strong scores on pay equity + leadership." },
  { brand: "Mastercard",         slugHint: "mastercard",      source: "as-you-sow-funds", tier: "Gender Equality leader", year: 2024, commitment: "As You Sow Gender Equality Funds — top score on equal pay + diversity disclosure." },
  { brand: "Citigroup",          slugHint: "citigroup",       source: "as-you-sow-funds", tier: "Gender Equality leader", year: 2024, commitment: "As You Sow Gender Equality Funds — first major US bank to publish raw pay gap data." },
  { brand: "Starbucks",          slugHint: "starbucks",       source: "as-you-sow-funds", tier: "Gender Equality leader", year: 2024, commitment: "As You Sow Gender Equality Funds — equal-pay attainment + disclosure leader." },

  /* ═══════════════════════ FOSSIL FREE FUNDS (Carbon Underground 200) ════ */
  /* Source: https://fossilfreefunds.org/carbon-underground-200 — Companies
   * here have explicit fossil-fuel reserves on book; severity concern. */
  { brand: "Saudi Aramco",       source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — largest oil reserves owner globally." },
  { brand: "Gazprom",            source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — largest gas reserves." },
  { brand: "PetroChina",         source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — major reserves owner." },
  { brand: "Rosneft",            source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — major reserves owner." },
  { brand: "Equinor",            source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — Norway state oil." },
  { brand: "Eni",                source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — Italian super-major." },
  { brand: "Repsol",             source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — Spanish super-major." },
  { brand: "Coterra Energy",     source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — US oil + gas." },
  { brand: "EOG Resources",      source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — US oil + gas." },
  { brand: "Pioneer Natural Resources", source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — US oil + gas (now part of Exxon)." },
  { brand: "Devon Energy",       source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — US oil + gas." },
  { brand: "Hess",               source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — US oil." },
  { brand: "Peabody Energy",     source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — largest US coal reserves." },
  { brand: "Arch Resources",     source: "fossil-free-funds", tier: "Carbon Underground 200", year: 2024, commitment: "Fossil Free Funds Carbon Underground 200 — US coal." },

  /* ═══════════════════════ ADL ONLINE HATE INDEX (TECH) ═══════════════════════ */
  /* Source: https://www.adl.org/online-hate-and-harassment-2023 */
  { brand: "Meta",               slugHint: "meta-facebook",            source: "adl-tech", tier: "ADL D",  year: 2023, commitment: "ADL Online Hate Index — Facebook + Instagram weak on enforcement transparency; some leadership on policy text." },
  { brand: "Facebook",           slugHint: "meta-facebook",            source: "adl-tech", tier: "ADL D",  year: 2023 },
  { brand: "Instagram",          slugHint: "meta-facebook",            source: "adl-tech", tier: "ADL D",  year: 2023 },
  { brand: "X",                  slugHint: "twitter",         source: "adl-tech", tier: "ADL F",  year: 2023, commitment: "ADL Online Hate Index — Twitter / X scored lowest after 2022 acquisition policy reversals." },
  { brand: "Twitter",            slugHint: "twitter",         source: "adl-tech", tier: "ADL F",  year: 2023 },
  { brand: "TikTok",             slugHint: "tiktok",          source: "adl-tech", tier: "ADL D+", year: 2023, commitment: "ADL Online Hate Index — TikTok policy text strong; enforcement transparency lacking." },
  { brand: "YouTube",            slugHint: "youtube-music",         source: "adl-tech", tier: "ADL C",  year: 2023, commitment: "ADL Online Hate Index — YouTube best-of-class on transparency reports; mid-tier on enforcement." },
  { brand: "Snapchat",           slugHint: "snapchat",        source: "adl-tech", tier: "ADL C-", year: 2023, commitment: "ADL Online Hate Index — Snap policy text strong; limited transparency reporting." },
  { brand: "Discord",            slugHint: "discord",         source: "adl-tech", tier: "ADL C",  year: 2023, commitment: "ADL Online Hate Index — Discord improving on policy + transparency." },
  { brand: "Reddit",             slugHint: "reddit",          source: "adl-tech", tier: "ADL C-", year: 2023, commitment: "ADL Online Hate Index — Reddit mid-tier on policy + transparency." },
  { brand: "Twitch",             slugHint: "twitch",          source: "adl-tech", tier: "ADL C",  year: 2023, commitment: "ADL Online Hate Index — Twitch improving on hateful-conduct enforcement." },

  /* ═══════════════════════ PROJECT DRAWDOWN SOLUTIONS ═══════════════════════ */
  /* Source: https://drawdown.org/solutions — Companies named in Drawdown
   * solution profiles or partner directory. Positive: offers a Drawdown-
   * listed climate-mitigation technology. */
  { brand: "Tesla",              slugHint: "tesla",           source: "drawdown-solutions", tier: "Electric Vehicles + Solar + Batteries", year: 2024, commitment: "Project Drawdown — EVs, utility-scale solar, residential batteries." },
  { brand: "BYD",                slugHint: "byd-co",             source: "drawdown-solutions", tier: "Electric Vehicles", year: 2024, commitment: "Project Drawdown — largest EV manufacturer globally." },
  { brand: "First Solar",        source: "drawdown-solutions", tier: "Solar Photovoltaics", year: 2024, commitment: "Project Drawdown — US-based thin-film solar manufacturer." },
  { brand: "SunPower",           source: "drawdown-solutions", tier: "Solar Photovoltaics", year: 2024, commitment: "Project Drawdown — residential + commercial solar." },
  { brand: "Vestas",             source: "drawdown-solutions", tier: "Onshore Wind", year: 2024, commitment: "Project Drawdown — largest wind-turbine manufacturer globally." },
  { brand: "Siemens Gamesa",     source: "drawdown-solutions", tier: "Onshore + Offshore Wind", year: 2024, commitment: "Project Drawdown — wind-turbine major." },
  { brand: "Ørsted",             source: "drawdown-solutions", tier: "Offshore Wind", year: 2024, commitment: "Project Drawdown — largest offshore-wind developer globally." },
  { brand: "Beyond Meat",        slugHint: "beyond-meat",     source: "drawdown-solutions", tier: "Plant-Rich Diets", year: 2024, commitment: "Project Drawdown — plant-based meat alternative." },
  { brand: "Impossible Foods",   slugHint: "impossible-foods",source: "drawdown-solutions", tier: "Plant-Rich Diets", year: 2024, commitment: "Project Drawdown — plant-based meat alternative." },
  { brand: "Oatly",              slugHint: "oatly",           source: "drawdown-solutions", tier: "Plant-Rich Diets", year: 2024, commitment: "Project Drawdown — oat-milk + dairy alternatives." },
  { brand: "Rivian",             slugHint: "rivian-automotive",          source: "drawdown-solutions", tier: "Electric Vehicles", year: 2024, commitment: "Project Drawdown — EV trucks + delivery vans (Amazon EDV)." },
  { brand: "Lucid Motors",       slugHint: "lucid-motors",    source: "drawdown-solutions", tier: "Electric Vehicles", year: 2024, commitment: "Project Drawdown — luxury EV manufacturer." },
  { brand: "Polestar",           slugHint: "polestar",        source: "drawdown-solutions", tier: "Electric Vehicles", year: 2024, commitment: "Project Drawdown — Volvo + Geely EV brand." },
  { brand: "Nuvve",              source: "drawdown-solutions", tier: "Vehicle-to-Grid + EV Infrastructure", year: 2024, commitment: "Project Drawdown — V2G charging." },
  { brand: "ChargePoint",        source: "drawdown-solutions", tier: "EV Charging Infrastructure", year: 2024, commitment: "Project Drawdown — largest US EV-charging network." },
  { brand: "Sunrun",             source: "drawdown-solutions", tier: "Distributed Solar", year: 2024, commitment: "Project Drawdown — largest US residential solar installer." },
  { brand: "Enphase Energy",     source: "drawdown-solutions", tier: "Distributed Solar + Batteries", year: 2024, commitment: "Project Drawdown — microinverter + residential battery leader." },
  { brand: "Generac",            slugHint: "generac",         source: "drawdown-solutions", tier: "Distributed Energy Storage", year: 2024, commitment: "Project Drawdown — residential battery + backup power." },
  { brand: "Trane Technologies", source: "drawdown-solutions", tier: "Heat Pumps + Efficient HVAC", year: 2024, commitment: "Project Drawdown — heat pumps + commercial HVAC efficiency." },
  { brand: "Mitsubishi Electric",source: "drawdown-solutions", tier: "Heat Pumps", year: 2024, commitment: "Project Drawdown — ductless heat-pump leader." },
  { brand: "Daikin",             source: "drawdown-solutions", tier: "Heat Pumps", year: 2024, commitment: "Project Drawdown — heat-pump + low-GWP refrigerant leader." },
  { brand: "Carrier",            slugHint: "carrier-global",         source: "drawdown-solutions", tier: "Heat Pumps + Refrigerants", year: 2024, commitment: "Project Drawdown — heat pumps + low-GWP refrigerants." },
  { brand: "Climeworks",         source: "drawdown-solutions", tier: "Direct Air Capture", year: 2024, commitment: "Project Drawdown — pioneer DAC operator." },
  { brand: "Heirloom",           source: "drawdown-solutions", tier: "Direct Air Capture", year: 2024, commitment: "Project Drawdown — limestone-based DAC." },
  { brand: "Indigo Agriculture", source: "drawdown-solutions", tier: "Regenerative Agriculture", year: 2024, commitment: "Project Drawdown — regenerative-ag carbon market." },
  { brand: "Pivot Bio",          source: "drawdown-solutions", tier: "Nutrient Management", year: 2024, commitment: "Project Drawdown — microbial nitrogen for crops, reducing synthetic fertilizer." },
];

/* ----------------------- entry validation utilities ---------------------- */

export function validateEntries(entries) {
  const errors = [];
  for (const [i, e] of entries.entries()) {
    if (!e.brand) errors.push(`Entry ${i}: missing brand`);
    if (!e.source || !SOURCE_URLS[e.source]) {
      errors.push(`Entry ${i} (${e.brand}): unknown source "${e.source}"`);
    }
  }
  return errors;
}

/* ---------------------- report connectivity check ----------------------- */

async function pingReport(url) {
  if (FIXTURE_MODE) return { url, status: 0, ok: true, mode: "fixture" };
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: 0, ok: false, error: err.message };
  }
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`Consumer scorecards fetcher starting (fixture=${FIXTURE_MODE})...`);

  // Validate corpus.
  const errors = validateEntries(ENTRIES);
  if (errors.length) {
    console.error("Corpus validation errors:");
    for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
    process.exit(2);
  }

  // Connectivity ping per source URL.
  const pings = [];
  for (const [key, url] of Object.entries(SOURCE_URLS)) {
    console.log(`  Pinging ${key}: ${url}`);
    pings.push({ source: key, ...(await pingReport(url)) });
    await SLEEP(REQ_DELAY_MS);
  }
  for (const p of pings) {
    console.log(`    [${p.source}] -> ${p.status}${p.ok ? "" : ` (${p.error || "non-200"})`}`);
  }

  // Tally per-source counts.
  const perSource = {};
  for (const e of ENTRIES) perSource[e.source] = (perSource[e.source] || 0) + 1;

  const entriesOut = LIMIT ? ENTRIES.slice(0, LIMIT) : ENTRIES;
  const today = new Date().toISOString().slice(0, 10);
  const outFile = OUT_OVERRIDE || path.join(RAW_DIR, `${today}.json`);

  await fs.mkdir(path.dirname(outFile), { recursive: true });

  const payload = {
    _license:
      "Aggregated from publicly-published NGO / journalist / activist consumer " +
      "scorecards. Each entry cites the source URL. No paywalled content is " +
      "redistributed; tier labels are surfaced from free shopping-guide / " +
      "category pages.",
    _source_urls: SOURCE_URLS,
    _generated_at: new Date().toISOString(),
    _status: "ok",
    _ping_results: pings,
    _stats: {
      entries: entriesOut.length,
      sources: Object.keys(SOURCE_URLS).length,
      per_source: perSource,
    },
    entries: entriesOut.map(e => ({ ...e, sourceUrl: SOURCE_URLS[e.source] })),
  };

  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile} — ${entriesOut.length} entries across ${Object.keys(perSource).length} sources`);
  for (const [src, n] of Object.entries(perSource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${n}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("consumer-scorecards-fetch failed:", err);
    process.exit(1);
  });
}
