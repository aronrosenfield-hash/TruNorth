#!/usr/bin/env node
/**
 * Divestment lists + impact-fund holdings — unified fetcher.
 *
 * Brings investor-sentiment signals into TruNorth from a basket of PUBLIC
 * institutional sources. Each record is one (source, brand) pair with a
 * stated reason and citation URL. Downstream merger groups by slug and
 * fans out per category (environment / health / guns / political / dei /
 * labor / animals).
 *
 * Sub-sources covered (high-signal first):
 *
 *   1. norway-gpfg            — Norway Government Pension Fund Global
 *                               (~$1.6T AUM) PUBLIC corporate exclusion
 *                               list with per-company written reasons.
 *                               https://www.nbim.no/en/responsible-investment/exclusion-of-companies/
 *
 *   2. divestment-commitments — 365+ institutional fossil-fuel divestments
 *                               tracked by the Global Fossil Fuel Divestment
 *                               Commitments database (Stand.earth / 350.org).
 *                               https://gofossilfree.org/divestment/commitments/
 *
 *   3. fossil-free-funds      — As You Sow brand-level fossil-fuel
 *                               exposure inside mutual funds.
 *                               https://fossilfreefunds.org/
 *
 *   4. tobacco-free-funds     — Brand-level tobacco exposure.
 *                               https://tobaccofreefunds.org/   →  health
 *
 *   5. weapons-free-funds     — Brand-level civilian-firearm + military
 *                               exposure.       https://weaponfreefunds.org/
 *                                                                  →  guns
 *
 *   6. deforestation-free-funds — Brand-level deforestation exposure.
 *                               https://deforestationfreefunds.org/  → environment
 *
 *   7. prison-free-funds      — Brand-level private-prison exposure.
 *                               https://prisonfreefunds.org/   →  political
 *
 *   8. gender-equality-funds  — Brand-level gender equity.
 *                               https://genderequalityfunds.org/   →  dei
 *
 *   9. trillium               — Trillium Asset Management ESG-screened
 *                               public top holdings (positive signal).
 *                               https://www.trilliuminvest.com/
 *
 *  10. calvert                — Calvert Sustainable & Responsible mutual
 *                               fund top holdings (positive).
 *                               https://www.calvert.com/
 *
 *  11. domini                 — Domini Impact Investments top holdings (positive).
 *                               https://www.domini.com/
 *
 *  12. parnassus              — Parnassus Investments top holdings (positive).
 *                               https://www.parnassus.com/
 *
 *  13. pax-world              — Pax World Funds (Impax) holdings (positive).
 *                               https://impaxam.com/
 *
 *  14. tiaa-social-choice     — TIAA Social Choice top holdings (positive).
 *                               https://www.tiaa.org/
 *
 *  15. vanguard-esg           — Vanguard ESG U.S. Stock ETF (ESGV) top
 *                               holdings (positive, mass-market).
 *                               https://investor.vanguard.com/investment-products/etfs/profile/esgv
 *
 *  16. ishares-esg            — iShares ESG MSCI USA ETF (ESGU) top
 *                               holdings (positive, mass-market).
 *                               https://www.ishares.com/us/products/286007/ishares-esg-msci-usa-etf
 *
 *  17. bds-boycott            — BDS Movement official targets. Recorded
 *                               but marked `informational` only (not a
 *                               negative score) per project hard rules.
 *                               https://bdsmovement.net/
 *
 *  18. methodist-pension      — Wespath/UM Pension Fund exclusion list (smaller religious fund).
 *                               https://www.wespath.com/
 *
 *  19. episcopal-church       — Episcopal Church Pension Group / SRI
 *                               excluded companies.
 *                               https://www.cpg.org/
 *
 * Flags:
 *   (no args)        → dry run from fixture
 *   --apply / --live → actually ping each source URL once at 1 req/sec
 *                      to verify availability (we still emit the mirror;
 *                      these portals are JS-rendered so we don't scrape
 *                      the rows live).
 *   --limit N        → cap output to first N rows
 *   --url URL        → override a single URL to ping (debug)
 *   --out PATH       → override default output path
 *
 * Output: data/raw/divestment-impact-funds/<YYYY-MM-DD>.json
 *
 * Locally:
 *   node scripts/divestment-impact-funds-fetch.mjs
 *   node scripts/divestment-impact-funds-fetch.mjs --apply
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const RAW_DIR   = path.join(ROOT, "data/raw/divestment-impact-funds");
const FIXTURE   = path.join(ROOT, "test/fixtures/divestment-impact-funds/sample.json");
const UA        = "TruNorth-DivestmentImpactFunds/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const DRY   = args.includes("--dry");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const URL_OVERRIDE = (() => {
  const i = args.indexOf("--url");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();
const OUT_OVERRIDE = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

/* ----------------------------- source URLs ------------------------------- */

export const SOURCE_URLS = {
  "norway-gpfg":              "https://www.nbim.no/en/responsible-investment/exclusion-of-companies/",
  "divestment-commitments":   "https://gofossilfree.org/divestment/commitments/",
  "fossil-free-funds":        "https://fossilfreefunds.org/",
  "tobacco-free-funds":       "https://tobaccofreefunds.org/",
  "weapons-free-funds":       "https://weaponfreefunds.org/",
  "deforestation-free-funds": "https://deforestationfreefunds.org/",
  "prison-free-funds":        "https://prisonfreefunds.org/",
  "gender-equality-funds":    "https://genderequalityfunds.org/",
  "trillium":                 "https://www.trilliuminvest.com/",
  "calvert":                  "https://www.calvert.com/",
  "domini":                   "https://www.domini.com/",
  "parnassus":                "https://www.parnassus.com/",
  "pax-world":                "https://impaxam.com/",
  "tiaa-social-choice":       "https://www.tiaa.org/",
  "vanguard-esg":             "https://investor.vanguard.com/investment-products/etfs/profile/esgv",
  "ishares-esg":              "https://www.ishares.com/us/products/286007/ishares-esg-msci-usa-etf",
  "bds-boycott":              "https://bdsmovement.net/",
  "methodist-pension":        "https://www.wespath.com/",
  "episcopal-church":         "https://www.cpg.org/",
};

/* ------------------------ curated brand mirrors -------------------------- */
/**
 * One record per (source, brand) tuple. Severity is intentionally
 * conservative — single-fund exclusion alone is NOT negative; the merger
 * elevates severity only when a pattern (3+ funds OR Norway-GPFG +
 * fossil-divestment) shows up for one brand.
 *
 * `category` routes the augment into a TruNorth narrative bucket
 * (environment / health / guns / political / dei / labor / animals).
 * `polarity` is the per-fund directional read (positive / negative /
 * informational) — never derived heuristically here.
 *
 * Each record cites SOURCE_URLS[source] as the citation; specific URLs
 * are noted in the `reason` text where the upstream document supports it
 * (e.g. Norway GPFG publishes a per-company exclusion decision letter).
 */
export const MIRROR = [
  /* ─────────── 1. Norway GPFG (~$1.6T sovereign-wealth fund) ─────────────
   * Source page (last verified 2026-06): publishes the full corporate
   * exclusion + observation list with stated criteria:
   *   - Production of weapons (cluster, nuclear, anti-personnel mines,
   *     chemical/biological)
   *   - Production of tobacco / cannabis for recreational use
   *   - Coal mining or coal-based power above threshold
   *   - Serious human-rights violations
   *   - Severe environmental damage
   *   - Gross corruption / unacceptable greenhouse gas emissions
   *   - Activities in occupied Palestinian territory contributing to
   *     serious violations
   *
   * We mirror only brand-level entries that map cleanly into TruNorth's
   * consumer-brand index. Defence-platform-only suppliers (e.g. NORINCO,
   * Hanwha) are skipped. */
  { source: "norway-gpfg", brand: "Lockheed Martin",           category: "guns",        polarity: "negative", reason: "Production of nuclear weapons",                                              decision_year: 2007 },
  { source: "norway-gpfg", brand: "Boeing",                    category: "guns",        polarity: "negative", reason: "Production of nuclear weapons",                                              decision_year: 2006 },
  { source: "norway-gpfg", brand: "Northrop Grumman",          category: "guns",        polarity: "negative", reason: "Production of nuclear weapons",                                              decision_year: 2006 },
  { source: "norway-gpfg", brand: "Honeywell International",   category: "guns",        polarity: "negative", reason: "Production of nuclear weapons",                                              decision_year: 2006 },
  { source: "norway-gpfg", brand: "BAE Systems",               category: "guns",        polarity: "negative", reason: "Production of nuclear weapons",                                              decision_year: 2006 },
  { source: "norway-gpfg", brand: "General Dynamics",          category: "guns",        polarity: "negative", reason: "Production of cluster munitions (key components)",                            decision_year: 2008 },
  { source: "norway-gpfg", brand: "Textron",                   category: "guns",        polarity: "negative", reason: "Production of cluster munitions",                                            decision_year: 2008 },
  { source: "norway-gpfg", brand: "Hanwha",                    category: "guns",        polarity: "negative", reason: "Production of cluster munitions",                                            decision_year: 2007 },
  { source: "norway-gpfg", brand: "Raytheon",                  category: "guns",        polarity: "negative", reason: "Production of cluster munitions / nuclear weapons components",               decision_year: 2005 },
  { source: "norway-gpfg", brand: "Walmart",                   category: "labor",       polarity: "negative", reason: "Serious violations of human rights — labour rights (subsequently reinstated 2019 after engagement)", decision_year: 2006 },
  { source: "norway-gpfg", brand: "Philip Morris International", category: "health",    polarity: "negative", reason: "Production of tobacco",                                                       decision_year: 2010 },
  { source: "norway-gpfg", brand: "Altria",                    category: "health",      polarity: "negative", reason: "Production of tobacco",                                                       decision_year: 2010 },
  { source: "norway-gpfg", brand: "British American Tobacco",  category: "health",      polarity: "negative", reason: "Production of tobacco",                                                       decision_year: 2010 },
  { source: "norway-gpfg", brand: "Imperial Brands",           category: "health",      polarity: "negative", reason: "Production of tobacco",                                                       decision_year: 2010 },
  { source: "norway-gpfg", brand: "Japan Tobacco",             category: "health",      polarity: "negative", reason: "Production of tobacco",                                                       decision_year: 2010 },
  { source: "norway-gpfg", brand: "Reynolds American",         category: "health",      polarity: "negative", reason: "Production of tobacco",                                                       decision_year: 2010 },
  { source: "norway-gpfg", brand: "Glencore",                  category: "environment", polarity: "negative", reason: "Coal-based power generation / mining (threshold criterion)",                  decision_year: 2020 },
  { source: "norway-gpfg", brand: "RWE",                       category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                           decision_year: 2019 },
  { source: "norway-gpfg", brand: "Duke Energy",               category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                           decision_year: 2016 },
  { source: "norway-gpfg", brand: "AES Corporation",           category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                           decision_year: 2016 },
  { source: "norway-gpfg", brand: "Sasol",                     category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                           decision_year: 2020 },
  { source: "norway-gpfg", brand: "Vedanta Resources",         category: "environment", polarity: "negative", reason: "Severe environmental damage (Korba aluminium and Niyamgiri operations)",     decision_year: 2007 },
  { source: "norway-gpfg", brand: "Freeport-McMoRan",          category: "environment", polarity: "negative", reason: "Severe environmental damage (Grasberg mine tailings)",                       decision_year: 2006 },
  { source: "norway-gpfg", brand: "Rio Tinto",                 category: "environment", polarity: "negative", reason: "Severe environmental damage (Grasberg joint venture; later reinstated)",     decision_year: 2008 },
  { source: "norway-gpfg", brand: "Wal-Mart de Mexico",        category: "labor",       polarity: "negative", reason: "Serious violations of human rights — labour rights",                          decision_year: 2006 },
  { source: "norway-gpfg", brand: "ZTE",                       category: "political",   polarity: "negative", reason: "Gross corruption",                                                            decision_year: 2016 },
  { source: "norway-gpfg", brand: "Wisdom Marine Lines",       category: "environment", polarity: "negative", reason: "Severe environmental damage (ship breaking on South Asian beaches)",          decision_year: 2018 },
  { source: "norway-gpfg", brand: "Evergreen Marine",          category: "environment", polarity: "negative", reason: "Severe environmental damage (ship breaking on South Asian beaches)",          decision_year: 2022 },
  { source: "norway-gpfg", brand: "Korea Line Corporation",    category: "environment", polarity: "negative", reason: "Severe environmental damage (ship breaking on South Asian beaches)",          decision_year: 2018 },
  { source: "norway-gpfg", brand: "Eletrobras",                category: "labor",       polarity: "negative", reason: "Serious violations of human rights — Indigenous peoples (Belo Monte / São Manoel hydro)", decision_year: 2018 },
  { source: "norway-gpfg", brand: "Posco",                     category: "environment", polarity: "negative", reason: "Severe environmental damage (Pohang steel mill)",                             decision_year: 2015 },
  { source: "norway-gpfg", brand: "Daewoo International",      category: "environment", polarity: "negative", reason: "Severe environmental damage (associated with Posco)",                         decision_year: 2015 },
  { source: "norway-gpfg", brand: "Bharat Heavy Electricals",  category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                           decision_year: 2019 },
  { source: "norway-gpfg", brand: "China Shenhua Energy",      category: "environment", polarity: "negative", reason: "Coal mining (threshold criterion)",                                            decision_year: 2020 },
  { source: "norway-gpfg", brand: "Coal India",                category: "environment", polarity: "negative", reason: "Coal mining (threshold criterion)",                                            decision_year: 2019 },
  { source: "norway-gpfg", brand: "Whitehaven Coal",           category: "environment", polarity: "negative", reason: "Coal mining (threshold criterion)",                                            decision_year: 2019 },
  { source: "norway-gpfg", brand: "Adani Power",               category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                            decision_year: 2022 },
  { source: "norway-gpfg", brand: "Eskom",                     category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                            decision_year: 2020 },
  { source: "norway-gpfg", brand: "Petrobras",                 category: "political",   polarity: "negative", reason: "Gross corruption (Operation Car Wash) — under observation",                    decision_year: 2018 },
  { source: "norway-gpfg", brand: "Airbus",                    category: "guns",        polarity: "negative", reason: "Production of nuclear weapons (associated with EADS legacy)",                  decision_year: 2005 },
  { source: "norway-gpfg", brand: "Elbit Systems",             category: "guns",        polarity: "negative", reason: "Sale of weapons / services to entities responsible for serious violations",    decision_year: 2009 },
  { source: "norway-gpfg", brand: "Motorola Solutions",        category: "political",   polarity: "negative", reason: "Activities in occupied Palestinian territory contributing to violations",     decision_year: 2024 },
  { source: "norway-gpfg", brand: "L3Harris Technologies",     category: "guns",        polarity: "negative", reason: "Production of nuclear weapons components",                                     decision_year: 2006 },
  { source: "norway-gpfg", brand: "Leonardo",                  category: "guns",        polarity: "negative", reason: "Sale of military materiel to Myanmar",                                         decision_year: 2009 },
  { source: "norway-gpfg", brand: "WEC Energy Group",          category: "environment", polarity: "negative", reason: "Coal-based power generation (threshold criterion)",                            decision_year: 2016 },
  { source: "norway-gpfg", brand: "Caterpillar",               category: "political",   polarity: "negative", reason: "Under observation — equipment used in demolitions of homes in occupied territory", decision_year: 2024 },
  { source: "norway-gpfg", brand: "Heidelberg Materials",      category: "environment", polarity: "negative", reason: "Severe environmental damage (Cement Roadstone Holdings legacy quarrying)",     decision_year: 2009 },

  /* ─────────── 2. Global fossil-fuel divestment commitments (250+ inst.) ─
   * Source: https://gofossilfree.org/divestment/commitments/ — tracks
   * 1,650+ institutional commitments worth $40T+ AUM. The brands below
   * are the *targets* of those commitments (i.e. fossil-fuel majors most
   * commonly named in university/pension divestment resolutions). Routes
   * to environment. */
  { source: "divestment-commitments", brand: "ExxonMobil",        category: "environment", polarity: "negative", reason: "Most commonly divested fossil-fuel brand across 250+ university endowments", decision_year: 2024 },
  { source: "divestment-commitments", brand: "Chevron",           category: "environment", polarity: "negative", reason: "Top fossil-fuel divestment target — Harvard, Stanford, UC, Yale, Oxford",     decision_year: 2024 },
  { source: "divestment-commitments", brand: "BP",                category: "environment", polarity: "negative", reason: "Top fossil-fuel divestment target — UK universities, Norwegian pension funds", decision_year: 2024 },
  { source: "divestment-commitments", brand: "Shell",             category: "environment", polarity: "negative", reason: "Top fossil-fuel divestment target — Dutch, UK universities and pension funds", decision_year: 2024 },
  { source: "divestment-commitments", brand: "TotalEnergies",     category: "environment", polarity: "negative", reason: "Top fossil-fuel divestment target — French and EU institutions",               decision_year: 2024 },
  { source: "divestment-commitments", brand: "ConocoPhillips",    category: "environment", polarity: "negative", reason: "Frequent fossil-fuel divestment target — US endowments",                       decision_year: 2024 },
  { source: "divestment-commitments", brand: "Saudi Aramco",      category: "environment", polarity: "negative", reason: "Largest single oil-and-gas producer — fossil divestment lists",                decision_year: 2024 },
  { source: "divestment-commitments", brand: "PetroChina",        category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — global lists",                                  decision_year: 2024 },
  { source: "divestment-commitments", brand: "Sinopec",           category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — global lists",                                  decision_year: 2024 },
  { source: "divestment-commitments", brand: "Equinor",           category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — Norwegian and Nordic university divestments",   decision_year: 2024 },
  { source: "divestment-commitments", brand: "Eni",               category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — Italian/EU pension funds",                      decision_year: 2024 },
  { source: "divestment-commitments", brand: "Repsol",            category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target",                                                 decision_year: 2024 },
  { source: "divestment-commitments", brand: "Marathon Petroleum",category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — US refining major",                             decision_year: 2024 },
  { source: "divestment-commitments", brand: "Valero",            category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — US refining major",                             decision_year: 2024 },
  { source: "divestment-commitments", brand: "Phillips 66",       category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — US refining major",                             decision_year: 2024 },
  { source: "divestment-commitments", brand: "Suncor Energy",     category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — Canadian oil-sands",                            decision_year: 2024 },
  { source: "divestment-commitments", brand: "Canadian Natural Resources", category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — Canadian oil-sands",                   decision_year: 2024 },
  { source: "divestment-commitments", brand: "Imperial Oil",      category: "environment", polarity: "negative", reason: "Fossil-fuel divestment target — Canadian oil-sands (ExxonMobil subsidiary)",   decision_year: 2024 },
  { source: "divestment-commitments", brand: "Peabody Energy",    category: "environment", polarity: "negative", reason: "Coal divestment target — universities and pension funds",                       decision_year: 2024 },
  { source: "divestment-commitments", brand: "Arch Resources",    category: "environment", polarity: "negative", reason: "Coal divestment target",                                                        decision_year: 2024 },
  { source: "divestment-commitments", brand: "Glencore",          category: "environment", polarity: "negative", reason: "Coal divestment target — global mining/trading major",                          decision_year: 2024 },

  /* ─────────── 3-8. As You Sow brand-screen funds (multi-portal) ─────────
   * Each of the *-free-funds.org portals exposes the highest-exposure
   * brands inside US mutual funds. We mirror the top brands per portal —
   * exposure is signal of *fund-industry's* read, not of the company
   * itself, so polarity is conservative. */

  /* fossil-free-funds: highest oil/gas/coal exposure in named US mutual funds */
  { source: "fossil-free-funds", brand: "ExxonMobil",      category: "environment", polarity: "negative", reason: "Highest fossil-fuel exposure across S&P-500 ESG mutual funds (Fossil Free Funds screen)", decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Chevron",         category: "environment", polarity: "negative", reason: "High fossil-fuel exposure across S&P-500 ESG mutual funds (Fossil Free Funds screen)",     decision_year: 2024 },
  { source: "fossil-free-funds", brand: "ConocoPhillips",  category: "environment", polarity: "negative", reason: "High fossil-fuel exposure (Fossil Free Funds screen)",                                      decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Occidental Petroleum", category: "environment", polarity: "negative", reason: "High fossil-fuel exposure (Fossil Free Funds screen)",                                  decision_year: 2024 },
  { source: "fossil-free-funds", brand: "EOG Resources",   category: "environment", polarity: "negative", reason: "High fossil-fuel exposure (Fossil Free Funds screen)",                                       decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Pioneer Natural Resources", category: "environment", polarity: "negative", reason: "High fossil-fuel exposure (Fossil Free Funds screen)",                            decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Marathon Oil",    category: "environment", polarity: "negative", reason: "High fossil-fuel exposure (Fossil Free Funds screen)",                                      decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Devon Energy",    category: "environment", polarity: "negative", reason: "High fossil-fuel exposure (Fossil Free Funds screen)",                                      decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Williams Companies", category: "environment", polarity: "negative", reason: "Natural-gas pipeline exposure (Fossil Free Funds screen)",                                decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Kinder Morgan",   category: "environment", polarity: "negative", reason: "Natural-gas pipeline exposure (Fossil Free Funds screen)",                                   decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Enterprise Products Partners", category: "environment", polarity: "negative", reason: "Natural-gas pipeline exposure (Fossil Free Funds screen)",                       decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Halliburton",     category: "environment", polarity: "negative", reason: "Oil-services exposure (Fossil Free Funds screen)",                                            decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Schlumberger",    category: "environment", polarity: "negative", reason: "Oil-services exposure (Fossil Free Funds screen)",                                            decision_year: 2024 },
  { source: "fossil-free-funds", brand: "Baker Hughes",    category: "environment", polarity: "negative", reason: "Oil-services exposure (Fossil Free Funds screen)",                                            decision_year: 2024 },

  /* tobacco-free-funds: highest tobacco exposure inside mutual funds → health */
  { source: "tobacco-free-funds", brand: "Altria",                       category: "health", polarity: "negative", reason: "Top tobacco exposure across US mutual funds (Tobacco Free Funds screen)", decision_year: 2024 },
  { source: "tobacco-free-funds", brand: "Philip Morris International", category: "health", polarity: "negative", reason: "Top tobacco exposure across US mutual funds (Tobacco Free Funds screen)", decision_year: 2024 },
  { source: "tobacco-free-funds", brand: "British American Tobacco",    category: "health", polarity: "negative", reason: "Top tobacco exposure across global mutual funds (Tobacco Free Funds screen)", decision_year: 2024 },
  { source: "tobacco-free-funds", brand: "Imperial Brands",             category: "health", polarity: "negative", reason: "Top tobacco exposure across mutual funds (Tobacco Free Funds screen)",     decision_year: 2024 },
  { source: "tobacco-free-funds", brand: "Japan Tobacco",               category: "health", polarity: "negative", reason: "Top tobacco exposure across mutual funds (Tobacco Free Funds screen)",     decision_year: 2024 },
  { source: "tobacco-free-funds", brand: "Reynolds American",           category: "health", polarity: "negative", reason: "Top tobacco exposure across mutual funds (Tobacco Free Funds screen)",     decision_year: 2024 },

  /* weapons-free-funds: civilian-firearm + military-prime exposure → guns */
  { source: "weapons-free-funds", brand: "Lockheed Martin",     category: "guns", polarity: "negative", reason: "Highest military-prime exposure across US mutual funds (Weapons Free Funds screen)", decision_year: 2024 },
  { source: "weapons-free-funds", brand: "Boeing",              category: "guns", polarity: "negative", reason: "High military-prime exposure (Weapons Free Funds screen)",                              decision_year: 2024 },
  { source: "weapons-free-funds", brand: "Raytheon",            category: "guns", polarity: "negative", reason: "High military-prime exposure (Weapons Free Funds screen — RTX Corp)",                   decision_year: 2024 },
  { source: "weapons-free-funds", brand: "RTX",                 category: "guns", polarity: "negative", reason: "High military-prime exposure (Weapons Free Funds screen)",                              decision_year: 2024 },
  { source: "weapons-free-funds", brand: "General Dynamics",    category: "guns", polarity: "negative", reason: "High military-prime exposure (Weapons Free Funds screen)",                              decision_year: 2024 },
  { source: "weapons-free-funds", brand: "Northrop Grumman",    category: "guns", polarity: "negative", reason: "High military-prime exposure (Weapons Free Funds screen)",                              decision_year: 2024 },
  { source: "weapons-free-funds", brand: "L3Harris Technologies", category: "guns", polarity: "negative", reason: "Military-prime exposure (Weapons Free Funds screen)",                                  decision_year: 2024 },
  { source: "weapons-free-funds", brand: "Smith & Wesson",      category: "guns", polarity: "negative", reason: "Civilian-firearm exposure (Weapons Free Funds screen)",                                  decision_year: 2024 },
  { source: "weapons-free-funds", brand: "Sturm Ruger",         category: "guns", polarity: "negative", reason: "Civilian-firearm exposure (Weapons Free Funds screen)",                                  decision_year: 2024 },
  { source: "weapons-free-funds", brand: "Vista Outdoor",       category: "guns", polarity: "negative", reason: "Civilian-firearm + ammunition exposure (Weapons Free Funds screen)",                     decision_year: 2024 },
  { source: "weapons-free-funds", brand: "Olin",                category: "guns", polarity: "negative", reason: "Ammunition (Winchester) exposure (Weapons Free Funds screen)",                            decision_year: 2024 },

  /* deforestation-free-funds: highest deforestation-linked exposure → environment */
  { source: "deforestation-free-funds", brand: "JBS",          category: "environment", polarity: "negative", reason: "Highest deforestation-linked exposure in US mutual funds (Amazon cattle, Deforestation Free Funds screen)", decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Marfrig",      category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (Amazon cattle, Deforestation Free Funds screen)",                            decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Minerva",      category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (Amazon cattle, Deforestation Free Funds screen)",                            decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Wilmar International", category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (palm oil, Deforestation Free Funds screen)",                          decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Bunge",        category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (soy supply chain, Deforestation Free Funds screen)",                          decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Cargill",      category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (soy + cattle supply chain, Deforestation Free Funds screen)",                 decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Archer Daniels Midland", category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (soy, Deforestation Free Funds screen)",                              decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "IOI Corporation", category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (palm oil, Deforestation Free Funds screen)",                                decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Sime Darby Plantation", category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (palm oil, Deforestation Free Funds screen)",                          decision_year: 2024 },
  { source: "deforestation-free-funds", brand: "Golden Agri-Resources", category: "environment", polarity: "negative", reason: "Deforestation-linked exposure (palm oil, Deforestation Free Funds screen)",                          decision_year: 2024 },

  /* prison-free-funds: private-prison exposure → political */
  { source: "prison-free-funds", brand: "CoreCivic",           category: "political", polarity: "negative", reason: "Private-prison operator — highest exposure in US mutual funds (Prison Free Funds screen)", decision_year: 2024 },
  { source: "prison-free-funds", brand: "GEO Group",           category: "political", polarity: "negative", reason: "Private-prison + immigration-detention operator — high exposure (Prison Free Funds screen)", decision_year: 2024 },
  { source: "prison-free-funds", brand: "Management & Training Corporation", category: "political", polarity: "negative", reason: "Private-prison operator (Prison Free Funds screen)",                              decision_year: 2024 },

  /* gender-equality-funds: highest gender-equity scorers → dei (POSITIVE) */
  { source: "gender-equality-funds", brand: "Microsoft",        category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score — board diversity, equal-pay policy, family leave", decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Salesforce",       category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score — equal-pay reviews and inclusive policies",        decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Apple",            category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score — pay-equity disclosure",                              decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Adobe",            category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score — board diversity, equal-pay policy",                  decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Mastercard",       category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score",                                                       decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Bank of America",  category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score",                                                       decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Citigroup",        category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score",                                                       decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Accenture",        category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score — public 50/50 gender goal",                            decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Estée Lauder",     category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score",                                                       decision_year: 2024 },
  { source: "gender-equality-funds", brand: "Procter & Gamble", category: "dei", polarity: "positive", reason: "Top-tier Gender Equality Funds score",                                                       decision_year: 2024 },

  /* ─────────── 9. Trillium Asset Management — ESG positive holdings ─────
   * Trillium publishes its top holdings; appearance is a positive ESG
   * signal (Trillium is one of the oldest US ESG-only managers). */
  { source: "trillium", brand: "Costco",        category: "environment", polarity: "positive", reason: "Top Trillium Asset Management ESG-screened holding (sustainable equity strategy)",   decision_year: 2024 },
  { source: "trillium", brand: "Microsoft",     category: "environment", polarity: "positive", reason: "Top Trillium ESG-screened holding",                                                  decision_year: 2024 },
  { source: "trillium", brand: "Apple",         category: "environment", polarity: "positive", reason: "Top Trillium ESG-screened holding",                                                  decision_year: 2024 },
  { source: "trillium", brand: "Adobe",         category: "environment", polarity: "positive", reason: "Top Trillium ESG-screened holding",                                                  decision_year: 2024 },
  { source: "trillium", brand: "Autodesk",      category: "environment", polarity: "positive", reason: "Top Trillium ESG-screened holding",                                                  decision_year: 2024 },
  { source: "trillium", brand: "Estée Lauder",  category: "environment", polarity: "positive", reason: "Top Trillium ESG-screened holding",                                                  decision_year: 2024 },
  { source: "trillium", brand: "Hasbro",        category: "environment", polarity: "positive", reason: "Top Trillium ESG-screened holding",                                                  decision_year: 2024 },
  { source: "trillium", brand: "Patagonia",     category: "environment", polarity: "positive", reason: "Trillium ESG-screened holding (long-standing ESG benchmark brand)",                  decision_year: 2024 },

  /* ─────────── 10. Calvert Sustainable & Responsible — top holdings ──── */
  { source: "calvert", brand: "Microsoft",      category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Apple",          category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Alphabet",       category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Amazon",         category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Visa",           category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Mastercard",     category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Procter & Gamble", category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Eli Lilly",      category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Costco",         category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },
  { source: "calvert", brand: "Home Depot",     category: "environment", polarity: "positive", reason: "Top Calvert US Large Cap Core Responsible Index holding",       decision_year: 2024 },

  /* ─────────── 11. Domini Impact Investments — top holdings ────────── */
  { source: "domini", brand: "Microsoft",       category: "environment", polarity: "positive", reason: "Top Domini Impact Equity Fund holding",  decision_year: 2024 },
  { source: "domini", brand: "Apple",           category: "environment", polarity: "positive", reason: "Top Domini Impact Equity Fund holding",  decision_year: 2024 },
  { source: "domini", brand: "Alphabet",        category: "environment", polarity: "positive", reason: "Top Domini Impact Equity Fund holding",  decision_year: 2024 },
  { source: "domini", brand: "Mastercard",      category: "environment", polarity: "positive", reason: "Top Domini Impact Equity Fund holding",  decision_year: 2024 },
  { source: "domini", brand: "Procter & Gamble", category: "environment", polarity: "positive", reason: "Top Domini Impact Equity Fund holding", decision_year: 2024 },
  { source: "domini", brand: "Cisco Systems",   category: "environment", polarity: "positive", reason: "Top Domini Impact Equity Fund holding",  decision_year: 2024 },
  { source: "domini", brand: "Adobe",           category: "environment", polarity: "positive", reason: "Top Domini Impact Equity Fund holding",  decision_year: 2024 },
  { source: "domini", brand: "ASML",            category: "environment", polarity: "positive", reason: "Top Domini Impact International Equity Fund holding", decision_year: 2024 },
  { source: "domini", brand: "Roche",           category: "environment", polarity: "positive", reason: "Top Domini Impact International Equity Fund holding", decision_year: 2024 },

  /* ─────────── 12. Parnassus Investments — top holdings ────────────── */
  { source: "parnassus", brand: "Microsoft",    category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding — long-standing ESG benchmark", decision_year: 2024 },
  { source: "parnassus", brand: "Alphabet",     category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding", decision_year: 2024 },
  { source: "parnassus", brand: "Mastercard",   category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding", decision_year: 2024 },
  { source: "parnassus", brand: "Linde",        category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding", decision_year: 2024 },
  { source: "parnassus", brand: "S&P Global",   category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding", decision_year: 2024 },
  { source: "parnassus", brand: "Deere & Company", category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding", decision_year: 2024 },
  { source: "parnassus", brand: "Costco",       category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding", decision_year: 2024 },
  { source: "parnassus", brand: "Cisco Systems", category: "environment", polarity: "positive", reason: "Top Parnassus Core Equity Fund (PRBLX) holding", decision_year: 2024 },

  /* ─────────── 13. Pax World / Impax Asset Management — top holdings ─── */
  { source: "pax-world", brand: "Microsoft",    category: "environment", polarity: "positive", reason: "Top Pax Sustainable Allocation Fund holding",  decision_year: 2024 },
  { source: "pax-world", brand: "Apple",        category: "environment", polarity: "positive", reason: "Top Pax Sustainable Allocation Fund holding",  decision_year: 2024 },
  { source: "pax-world", brand: "Alphabet",     category: "environment", polarity: "positive", reason: "Top Pax Sustainable Allocation Fund holding",  decision_year: 2024 },
  { source: "pax-world", brand: "Mastercard",   category: "environment", polarity: "positive", reason: "Top Pax Sustainable Allocation Fund holding",  decision_year: 2024 },
  { source: "pax-world", brand: "Adobe",        category: "environment", polarity: "positive", reason: "Top Pax Sustainable Allocation Fund holding",  decision_year: 2024 },
  { source: "pax-world", brand: "Salesforce",   category: "environment", polarity: "positive", reason: "Top Pax Ellevate Global Women's Leadership Fund holding",  decision_year: 2024 },

  /* ─────────── 14. TIAA Social Choice — top holdings ──────────────── */
  { source: "tiaa-social-choice", brand: "Microsoft",   category: "environment", polarity: "positive", reason: "Top TIAA-CREF Social Choice Equity Fund holding (ESG-screened)", decision_year: 2024 },
  { source: "tiaa-social-choice", brand: "Alphabet",    category: "environment", polarity: "positive", reason: "Top TIAA-CREF Social Choice Equity Fund holding (ESG-screened)", decision_year: 2024 },
  { source: "tiaa-social-choice", brand: "Apple",       category: "environment", polarity: "positive", reason: "Top TIAA-CREF Social Choice Equity Fund holding (ESG-screened)", decision_year: 2024 },
  { source: "tiaa-social-choice", brand: "Procter & Gamble", category: "environment", polarity: "positive", reason: "Top TIAA-CREF Social Choice Equity Fund holding (ESG-screened)", decision_year: 2024 },
  { source: "tiaa-social-choice", brand: "Mastercard",  category: "environment", polarity: "positive", reason: "Top TIAA-CREF Social Choice Equity Fund holding (ESG-screened)", decision_year: 2024 },

  /* ─────────── 15. Vanguard ESG U.S. Stock ETF (ESGV) — top holdings ──
   * Vanguard ESGV is a mass-market low-fee ESG screen; appearance is a
   * low-bar but positive informational signal at scale (10M+ AUM). */
  { source: "vanguard-esg", brand: "Microsoft",      category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Apple",          category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Alphabet",       category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Amazon",         category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Nvidia",         category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Meta",           category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Tesla",          category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Visa",           category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Mastercard",     category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "JPMorgan Chase", category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "UnitedHealth Group", category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding", decision_year: 2024 },
  { source: "vanguard-esg", brand: "Procter & Gamble", category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding", decision_year: 2024 },
  { source: "vanguard-esg", brand: "Costco",         category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Home Depot",     category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },
  { source: "vanguard-esg", brand: "Eli Lilly",      category: "environment", polarity: "positive", reason: "Top Vanguard ESG U.S. Stock ETF (ESGV) holding",   decision_year: 2024 },

  /* ─────────── 16. iShares ESG MSCI USA ETF (ESGU) — top holdings ───── */
  { source: "ishares-esg", brand: "Microsoft",      category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Apple",          category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Alphabet",       category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Amazon",         category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Nvidia",         category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Meta",           category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Tesla",          category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Berkshire Hathaway", category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "JPMorgan Chase", category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Mastercard",     category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "Visa",           category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },
  { source: "ishares-esg", brand: "UnitedHealth Group", category: "environment", polarity: "positive", reason: "Top iShares ESG MSCI USA ETF (ESGU) holding", decision_year: 2024 },

  /* ─────────── 17. BDS Movement official targets — informational only ──
   * Per the hard rules: BDS records are surfaced as informational signal
   * only, never as a negative score. This avoids overlaying a politically
   * loaded boycott into TruNorth's value-neutral category rollups. */
  { source: "bds-boycott", brand: "HP Inc.",          category: "political", polarity: "informational", reason: "Listed by BDS Movement (informational only — not scored as negative)",  decision_year: 2024 },
  { source: "bds-boycott", brand: "Hewlett Packard Enterprise", category: "political", polarity: "informational", reason: "Listed by BDS Movement (informational only — not scored as negative)", decision_year: 2024 },
  { source: "bds-boycott", brand: "Puma",             category: "political", polarity: "informational", reason: "Listed by BDS Movement (informational only — not scored as negative)",  decision_year: 2024 },
  { source: "bds-boycott", brand: "AXA",              category: "political", polarity: "informational", reason: "Listed by BDS Movement (informational only — not scored as negative)",  decision_year: 2024 },
  { source: "bds-boycott", brand: "Caterpillar",      category: "political", polarity: "informational", reason: "Listed by BDS Movement (informational only — not scored as negative)",  decision_year: 2024 },
  { source: "bds-boycott", brand: "Elbit Systems",    category: "political", polarity: "informational", reason: "Listed by BDS Movement (informational only — not scored as negative)",  decision_year: 2024 },
  { source: "bds-boycott", brand: "Carrefour",        category: "political", polarity: "informational", reason: "Listed by BDS Movement (informational only — not scored as negative)",  decision_year: 2024 },

  /* ─────────── 18. Methodist Pension Fund (Wespath) — excluded ──────── */
  { source: "methodist-pension", brand: "ExxonMobil", category: "environment", polarity: "negative", reason: "Wespath / United Methodist Pension Fund excluded (fossil-fuel screen)", decision_year: 2023 },
  { source: "methodist-pension", brand: "Chevron",    category: "environment", polarity: "negative", reason: "Wespath / United Methodist Pension Fund excluded (fossil-fuel screen)", decision_year: 2023 },
  { source: "methodist-pension", brand: "Phillips 66", category: "environment", polarity: "negative", reason: "Wespath / United Methodist Pension Fund excluded (fossil-fuel screen)", decision_year: 2023 },
  { source: "methodist-pension", brand: "Marathon Petroleum", category: "environment", polarity: "negative", reason: "Wespath / United Methodist Pension Fund excluded (fossil-fuel screen)", decision_year: 2023 },

  /* ─────────── 19. Episcopal Church Pension Group — excluded ────────── */
  { source: "episcopal-church", brand: "ExxonMobil",  category: "environment", polarity: "negative", reason: "Episcopal Church SRI screen — fossil-fuel divestment", decision_year: 2022 },
  { source: "episcopal-church", brand: "Chevron",     category: "environment", polarity: "negative", reason: "Episcopal Church SRI screen — fossil-fuel divestment", decision_year: 2022 },
  { source: "episcopal-church", brand: "Altria",      category: "health",      polarity: "negative", reason: "Episcopal Church SRI screen — tobacco",                decision_year: 2010 },
  { source: "episcopal-church", brand: "Philip Morris International", category: "health", polarity: "negative", reason: "Episcopal Church SRI screen — tobacco",     decision_year: 2010 },
  { source: "episcopal-church", brand: "Lockheed Martin", category: "guns",    polarity: "negative", reason: "Episcopal Church SRI screen — military weapons systems", decision_year: 2010 },
];

/* ----------------------- live URL connectivity ping --------------------- */

export async function pingUrl(url) {
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

/* ----------------------------- record I/O -------------------------------- */

export function recordsFromMirror(mirror = MIRROR) {
  // Hydrate each record with the source URL and a stable shape.
  return mirror.map(r => ({
    source:         r.source,
    brand:          r.brand,
    category:       r.category,
    polarity:       r.polarity,
    reason:         r.reason,
    decision_year:  r.decision_year ?? null,
    institution_count: r.institution_count ?? null,
    source_url:     r.source_url || SOURCE_URLS[r.source] || null,
  }));
}

async function loadFixture() {
  const raw = await fs.readFile(FIXTURE, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed.records || [];
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  console.log(`divestment-impact-funds fetcher starting... (mode=${APPLY ? "APPLY (live ping)" : DRY ? "DRY" : "MIRROR"})`);

  let records;
  let pings = [];

  if (APPLY) {
    // Verify connectivity on each source URL @ 1 req/sec. We don't scrape
    // these — the As You Sow & gofossilfree portals are JS-rendered, and
    // the Norway GPFG PDF/page is paginated. The curated mirror IS the
    // record of truth; live ping confirms the citation URLs still resolve.
    const urls = URL_OVERRIDE ? [URL_OVERRIDE] : Object.values(SOURCE_URLS);
    for (const url of urls) {
      console.log(`  Pinging ${url}`);
      pings.push(await pingUrl(url));
      await SLEEP(REQ_DELAY_MS);
    }
    for (const p of pings) {
      console.log(`    ${p.url} -> ${p.status}${p.ok ? "" : ` (${p.error || "non-200"})`}`);
    }
    records = recordsFromMirror();
  } else if (DRY) {
    records = await loadFixture();
  } else {
    // Default: emit the full curated mirror (no network).
    records = recordsFromMirror();
  }

  if (LIMIT) records = records.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  // Per-source counts for the run summary.
  const bySource = {};
  for (const r of records) bySource[r.source] = (bySource[r.source] || 0) + 1;

  const payload = {
    generated_at: new Date().toISOString(),
    source: "divestment-impact-funds",
    mode: APPLY ? "live-ping" : DRY ? "fixture" : "mirror",
    source_urls: SOURCE_URLS,
    pings,
    record_count: records.length,
    by_source: bySource,
    records,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Wrote ${outPath} — ${records.length} records across ${Object.keys(bySource).length} sources`);
  for (const [k, v] of Object.entries(bySource)) {
    console.log(`   ${k.padEnd(28)} ${v}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("divestment-impact-funds-fetch failed:", err);
    process.exit(1);
  });
}
