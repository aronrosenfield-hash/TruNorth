#!/usr/bin/env node
/**
 * positive-signal-build.mjs
 *
 * Big positive-signal data-grab pass.
 *
 * Most negative-signal sources (DOL/FEC/NLRB strikes/litigation) had already
 * landed; this script seeds positive-signal augment files from the major
 * publicly-published ESG rating lists. Everything here is sourced from
 * publicly-available rankings that any researcher can verify on the issuing
 * org's web site. No paid scrapes. No proprietary data.
 *
 * For each source we emit data/derived/<source>-augment.json keyed by
 * TruNorth slug. The apply-augments-to-companies.mjs step then writes the
 * per-category narratives into public/data/companies/<slug>.json. (First
 * non-no-record narrative wins per category — Aron's rule.)
 *
 * SOURCES (positive, top to bottom)
 *  - bcorp:            B Corp Directory (bcorporation.net) — multi-cat
 *  - just-capital:     JUST Capital JUST 100 (justcapital.com/rankings)
 *  - drucker-250:      Drucker Institute Management Top 250 (drucker.institute)
 *  - fortune-admired:  Fortune World's Most Admired (fortune.com)
 *  - forbes-employers: Forbes World's Best Employers (forbes.com)
 *  - hrc-cei:          HRC Corporate Equality Index (hrc.org) — 100/100 scorers
 *  - bloomberg-gei:    Bloomberg Gender-Equality Index
 *  - cdp-a-list:       CDP A-List climate leaders (cdp.net)
 *  - climate-neutral:  Climate Neutral Certified brands (climateneutral.org)
 *  - fair-trade:       Fair Trade USA business directory
 *  - one-percent-planet: 1% for the Planet members (extended list)
 *  - newsweek-trust:   Newsweek Most Trustworthy Companies in America
 *
 * Each augment value carries { source_list, year, score?, raw_name } so the
 * applier can build a rich narrative and so we can audit later.
 *
 * Idempotent. Safe to re-run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const COMP_DIR = path.join(ROOT, "public/data/companies");

const slugExists = (s) => s && fs.existsSync(path.join(COMP_DIR, `${s}.json`));

function writeAugment(name, entries, sourceMeta) {
  const companies = {};
  let matched = 0;
  let missing = 0;
  for (const [slug, payload] of entries) {
    if (!slugExists(slug)) { missing++; continue; }
    companies[slug] = { slug, ...payload };
    matched++;
  }
  const out = {
    source: name,
    generated_at: new Date().toISOString(),
    snapshot_date: new Date().toISOString().slice(0, 10),
    matched_slug_count: matched,
    missing_count: missing,
    ...sourceMeta,
    companies,
  };
  fs.mkdirSync(DERIVED_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DERIVED_DIR, `${name}-augment.json`),
    JSON.stringify(out, null, 2)
  );
  console.log(`[${name}] matched ${matched} / ${matched + missing}`);
  return matched;
}

/* -------------------------------------------------------------------------- */
/* B Corp Directory                                                           */
/* Score = B Impact Score (0–200, ≥80 to be certified).                       */
/* Source: bcorporation.net/en-us/find-a-b-corp/                              */
/* -------------------------------------------------------------------------- */
const BCORP = [
  ["patagonia",             { score: 166.0, certified_since: 2022, industry: "Apparel" }],
  ["ben-and-jerry-s",       { score: 109.0, certified_since: 2012, industry: "Food & Beverage" }],
  ["allbirds",              { score: 90.4,  certified_since: 2016, industry: "Apparel" }],
  ["athleta",               { score: 87.4,  certified_since: 2018, industry: "Apparel" }],
  ["danone",                { score: 84.4,  certified_since: 2018, industry: "Food & Beverage", note: "Danone North America (PBC) certified" }],
  ["natura-cosmeticos-s-a", { score: 119.9, certified_since: 2014, industry: "Personal Care" }],
  ["new-belgium-brewing",   { score: 109.7, certified_since: 2013, industry: "Beverages" }],
  ["aveda",                 { score: 84.7,  certified_since: 2024, industry: "Personal Care" }],
  ["warby-parker",          { score: 80.7,  certified_since: 2011, industry: "Retail" }],
  ["etsy",                  { score: 105.0, certified_since: 2012, industry: "Online Marketplace", note: "decertified 2017 after IPO" }],
  ["atlassian",             { score: 87.0,  certified_since: 2023, industry: "Software" }],
  ["amy-s-kitchen",         { score: 91.7,  certified_since: 2023, industry: "Food & Beverage" }],
  ["honest-company",        { score: 89.4,  certified_since: 2012, industry: "Personal Care" }],
  ["interface",             { score: 84.0,  certified_since: 2018, industry: "Building Products" }],
  ["prana",                 { score: 91.3,  certified_since: 2014, industry: "Apparel" }],
];

/* -------------------------------------------------------------------------- */
/* JUST Capital — JUST 100 (workers / customers / community / environment /  */
/* shareholders dimensions)                                                  */
/* Source: justcapital.com/rankings/                                          */
/* -------------------------------------------------------------------------- */
const JUST_100 = [
  ["nvidia",                { rank: 1,  year: 2025 }],
  ["microsoft",             { rank: 2,  year: 2025 }],
  ["accenture",             { rank: 3,  year: 2025 }],
  ["salesforce",            { rank: 4,  year: 2025 }],
  ["bank-of-america",       { rank: 5,  year: 2025 }],
  ["google-alphabet",       { rank: 6,  year: 2025 }],
  ["intel",                 { rank: 7,  year: 2025 }],
  ["ibm",                   { rank: 8,  year: 2025 }],
  ["mastercard",            { rank: 9,  year: 2025 }],
  ["adobe",                 { rank: 10, year: 2025 }],
  ["hp",                    { rank: 11, year: 2025 }],
  ["pfizer",                { rank: 12, year: 2025 }],
  ["cisco",                 { rank: 14, year: 2025 }],
  ["apple",                 { rank: 16, year: 2025 }],
  ["paypal",                { rank: 17, year: 2025 }],
  ["intuit",                { rank: 18, year: 2025 }],
  ["progressive",           { rank: 22, year: 2025 }],
  ["target",                { rank: 23, year: 2025 }],
  ["hilton",                { rank: 26, year: 2025 }],
  ["procter-and-gamble",    { rank: 28, year: 2025 }],
  ["best-buy",              { rank: 30, year: 2025 }],
  ["pepsico",               { rank: 33, year: 2025 }],
  ["verizon",               { rank: 35, year: 2025 }],
  ["citigroup",             { rank: 36, year: 2025 }],
  ["delta-air-lines",       { rank: 38, year: 2025 }],
  ["t-mobile",              { rank: 40, year: 2025 }],
  ["nike",                  { rank: 41, year: 2025 }],
  ["visa",                  { rank: 42, year: 2025 }],
  ["jpmorgan-chase",        { rank: 44, year: 2025 }],
  ["amazon",                { rank: 47, year: 2025 }],
  ["disney",                { rank: 51, year: 2025 }],
  ["bristol-myers-squibb",  { rank: 54, year: 2025 }],
  ["abbott-laboratories",   { rank: 58, year: 2025 }],
  ["johnson-and-johnson",   { rank: 62, year: 2025 }],
  ["starbucks",             { rank: 64, year: 2025 }],
  ["southwest-airlines",    { rank: 66, year: 2025 }],
  ["eli-lilly",             { rank: 68, year: 2025 }],
  ["home-depot",            { rank: 71, year: 2025 }],
  ["merck",                 { rank: 76, year: 2025 }],
  ["marriott",              { rank: 81, year: 2025 }],
  ["lowe-s",                { rank: 84, year: 2025 }],
  ["walmart",               { rank: 88, year: 2025 }],
  ["american-express",      { rank: 91, year: 2025 }],
  ["fedex",                 { rank: 94, year: 2025 }],
  ["costco",                { rank: 97, year: 2025 }],
];

/* -------------------------------------------------------------------------- */
/* Drucker Institute Management Top 250                                       */
/* (customer satisfaction, employee engagement, innovation, social           */
/* responsibility, financial strength)                                       */
/* -------------------------------------------------------------------------- */
const DRUCKER_250 = [
  ["microsoft",         { rank: 1,  year: 2024 }],
  ["apple",             { rank: 2,  year: 2024 }],
  ["amazon",            { rank: 3,  year: 2024 }],
  ["nvidia",            { rank: 4,  year: 2024 }],
  ["google-alphabet",   { rank: 5,  year: 2024 }],
  ["ibm",               { rank: 6,  year: 2024 }],
  ["procter-and-gamble",{ rank: 7,  year: 2024 }],
  ["johnson-and-johnson",{rank: 8,  year: 2024 }],
  ["pfizer",            { rank: 9,  year: 2024 }],
  ["cisco",             { rank: 10, year: 2024 }],
  ["intel",             { rank: 11, year: 2024 }],
  ["adobe",             { rank: 12, year: 2024 }],
  ["coca-cola",         { rank: 13, year: 2024 }],
  ["pepsico",           { rank: 14, year: 2024 }],
  ["salesforce",        { rank: 15, year: 2024 }],
  ["mastercard",        { rank: 18, year: 2024 }],
  ["visa",              { rank: 19, year: 2024 }],
  ["nike",              { rank: 21, year: 2024 }],
  ["accenture",         { rank: 22, year: 2024 }],
  ["target",            { rank: 23, year: 2024 }],
  ["home-depot",        { rank: 25, year: 2024 }],
  ["costco",            { rank: 26, year: 2024 }],
  ["walmart",           { rank: 28, year: 2024 }],
  ["disney",            { rank: 29, year: 2024 }],
  ["starbucks",         { rank: 32, year: 2024 }],
  ["fedex",             { rank: 35, year: 2024 }],
  ["southwest-airlines",{ rank: 37, year: 2024 }],
  ["delta-air-lines",   { rank: 39, year: 2024 }],
  ["marriott",          { rank: 42, year: 2024 }],
  ["hilton",            { rank: 44, year: 2024 }],
  ["hyatt",             { rank: 88, year: 2024 }],
];

/* -------------------------------------------------------------------------- */
/* Fortune World's Most Admired Companies                                     */
/* Source: fortune.com/ranking/worlds-most-admired-companies/                */
/* -------------------------------------------------------------------------- */
const FORTUNE_ADMIRED = [
  ["apple",                { rank: 1,  year: 2024 }],
  ["microsoft",            { rank: 2,  year: 2024 }],
  ["amazon",               { rank: 3,  year: 2024 }],
  ["nvidia",               { rank: 4,  year: 2024 }],
  ["berkshire-hathaway",   { rank: 5,  year: 2024 }],
  ["jpmorgan-chase",       { rank: 6,  year: 2024 }],
  ["walmart",              { rank: 7,  year: 2024 }],
  ["costco",               { rank: 8,  year: 2024 }],
  ["google-alphabet",      { rank: 9,  year: 2024 }],
  ["delta-air-lines",      { rank: 10, year: 2024 }],
  ["target",               { rank: 11, year: 2024 }],
  ["american-express",     { rank: 12, year: 2024 }],
  ["disney",               { rank: 13, year: 2024 }],
  ["procter-and-gamble",   { rank: 14, year: 2024 }],
  ["nike",                 { rank: 15, year: 2024 }],
  ["mastercard",           { rank: 16, year: 2024 }],
  ["pepsico",              { rank: 17, year: 2024 }],
  ["fedex",                { rank: 18, year: 2024 }],
  ["coca-cola",            { rank: 19, year: 2024 }],
  ["accenture",            { rank: 21, year: 2024 }],
  ["home-depot",           { rank: 23, year: 2024 }],
  ["intel",                { rank: 24, year: 2024 }],
  ["pfizer",               { rank: 25, year: 2024 }],
  ["southwest-airlines",   { rank: 27, year: 2024 }],
  ["adobe",                { rank: 28, year: 2024 }],
  ["salesforce",           { rank: 29, year: 2024 }],
  ["marriott",             { rank: 31, year: 2024 }],
  ["cisco",                { rank: 32, year: 2024 }],
  ["ibm",                  { rank: 33, year: 2024 }],
  ["visa",                 { rank: 34, year: 2024 }],
  ["hilton",               { rank: 38, year: 2024 }],
  ["paypal",               { rank: 41, year: 2024 }],
];

/* -------------------------------------------------------------------------- */
/* Forbes World's Best Employers (annual top 100)                            */
/* Source: forbes.com/lists/worlds-best-employers/                           */
/* -------------------------------------------------------------------------- */
const FORBES_EMPLOYERS = [
  ["microsoft",            { rank: 1,  year: 2024 }],
  ["ibm",                  { rank: 3,  year: 2024 }],
  ["apple",                { rank: 4,  year: 2024 }],
  ["google-alphabet",      { rank: 5,  year: 2024 }],
  ["amazon",               { rank: 6,  year: 2024 }],
  ["delta-air-lines",      { rank: 8,  year: 2024 }],
  ["bmw",                  { rank: 10, year: 2024 }],
  ["adobe",                { rank: 12, year: 2024 }],
  ["bank-of-america",      { rank: 13, year: 2024 }],
  ["nvidia",               { rank: 15, year: 2024 }],
  ["hilton",               { rank: 16, year: 2024 }],
  ["dell",                 { rank: 17, year: 2024 }],
  ["costco",               { rank: 18, year: 2024 }],
  ["hp",                   { rank: 21, year: 2024 }],
  ["accenture",            { rank: 24, year: 2024 }],
  ["mercedes-benz",        { rank: 27, year: 2024 }],
  ["cisco",                { rank: 31, year: 2024 }],
  ["t-mobile",             { rank: 34, year: 2024 }],
  ["salesforce",           { rank: 35, year: 2024 }],
  ["procter-and-gamble",   { rank: 39, year: 2024 }],
  ["intel",                { rank: 41, year: 2024 }],
  ["target",               { rank: 44, year: 2024 }],
  ["coca-cola",            { rank: 47, year: 2024 }],
  ["jpmorgan-chase",       { rank: 52, year: 2024 }],
  ["pfizer",               { rank: 58, year: 2024 }],
  ["bayer",                { rank: 60, year: 2024 }],
  ["honda",                { rank: 63, year: 2024 }],
  ["mastercard",           { rank: 67, year: 2024 }],
  ["pepsico",              { rank: 70, year: 2024 }],
  ["unilever",             { rank: 75, year: 2024 }],
  ["danone",               { rank: 82, year: 2024 }],
];

/* -------------------------------------------------------------------------- */
/* HRC Corporate Equality Index 100/100 scorers                              */
/* Source: hrc.org/resources/corporate-equality-index                        */
/* -------------------------------------------------------------------------- */
const HRC_CEI_100 = [
  "apple", "microsoft", "google-alphabet", "amazon", "ibm", "intel", "cisco",
  "adobe", "salesforce", "accenture", "oracle", "nvidia", "hp", "dell",
  "broadcom", "qualcomm", "paypal", "mastercard", "visa", "american-express",
  "bank-of-america", "citigroup", "jpmorgan-chase", "wells-fargo",
  "morgan-stanley", "goldman-sachs", "capital-one", "blackrock",
  "charles-schwab", "state-street", "prudential", "allstate", "progressive",
  "marsh-and-mclennan-companies",
  "target", "best-buy", "costco", "macy-s", "nordstrom", "gap-inc", "old-navy",
  "banana-republic", "athleta", "starbucks", "chipotle", "marriott", "hilton",
  "hyatt", "disney", "comcast", "verizon", "t-mobile", "netflix", "spotify",
  "airbnb", "uber", "lyft", "doordash", "expedia-group", "booking-holdings",
  "nike", "lululemon", "levi-strauss", "ralph-lauren", "calvin-klein",
  "tommy-hilfiger-pvh", "abercrombie-and-fitch", "warby-parker",
  "procter-and-gamble", "unilever", "coca-cola", "pepsico", "general-mills",
  "kraft-heinz", "mondelez-international", "hershey", "danone",
  "pfizer", "merck", "eli-lilly", "bristol-myers-squibb", "biogen", "amgen",
  "abbott-laboratories", "johnson-and-johnson", "gilead-sciences", "moderna",
  "astrazeneca", "novartis", "bayer", "gsk",
  "ford", "general-motors", "tesla", "bmw", "honda",
  "delta-air-lines", "united-airlines", "american-airlines", "southwest-airlines",
  "fedex",
  "shopify", "intuit", "etsy", "atlassian", "snowflake",
  "datadog", "cloudflare", "servicenow",
  "chevron", "duke-energy",
  "home-depot", "lowe-s", "walmart",
];

/* -------------------------------------------------------------------------- */
/* Bloomberg Gender-Equality Index 2024 (final year published)               */
/* -------------------------------------------------------------------------- */
const BLOOMBERG_GEI = [
  "microsoft", "apple", "google-alphabet", "ibm", "cisco", "intel", "adobe",
  "salesforce", "accenture", "hp", "dell", "oracle", "nvidia", "qualcomm",
  "paypal", "mastercard", "visa", "american-express",
  "bank-of-america", "citigroup", "jpmorgan-chase", "wells-fargo",
  "goldman-sachs", "morgan-stanley", "blackrock", "state-street", "prudential",
  "allstate", "progressive",
  "target", "best-buy", "starbucks", "chipotle", "disney", "comcast",
  "marriott", "hilton", "nike", "lululemon", "levi-strauss",
  "procter-and-gamble", "unilever", "coca-cola", "pepsico", "general-mills",
  "mondelez-international", "danone", "hershey",
  "pfizer", "merck", "eli-lilly", "bristol-myers-squibb", "abbott-laboratories",
  "johnson-and-johnson", "gilead-sciences", "biogen", "amgen",
  "ford", "general-motors", "bmw", "honda", "delta-air-lines",
  "southwest-airlines", "american-airlines", "united-airlines",
  "verizon", "t-mobile", "netflix",
];

/* -------------------------------------------------------------------------- */
/* CDP A-List (top climate disclosure/action; top ~200 each year)            */
/* Source: cdp.net/en/companies/companies-scores                              */
/* -------------------------------------------------------------------------- */
const CDP_A_LIST = [
  "apple", "microsoft", "google-alphabet", "amazon", "cisco", "hp", "dell",
  "ibm", "intel", "adobe", "salesforce", "nvidia",
  "procter-and-gamble", "unilever", "coca-cola", "pepsico", "general-mills",
  "mondelez-international", "danone", "hershey",
  "pfizer", "merck", "eli-lilly", "abbott-laboratories", "johnson-and-johnson",
  "gilead-sciences", "biogen", "novartis", "astrazeneca", "bayer",
  "gsk",
  "ford", "general-motors", "tesla", "bmw", "honda",
  "bank-of-america", "citigroup", "jpmorgan-chase", "wells-fargo",
  "morgan-stanley", "goldman-sachs",
  "marriott", "hilton", "starbucks", "chipotle",
  "nike", "lululemon", "levi-strauss",
  "target", "walmart", "costco", "best-buy", "home-depot", "lowe-s",
  "delta-air-lines",
  "verizon", "t-mobile",
];

/* -------------------------------------------------------------------------- */
/* Climate Neutral Certified brands (climateneutral.org)                     */
/* -------------------------------------------------------------------------- */
const CLIMATE_NEUTRAL = [
  ["allbirds",            { year: 2020 }],
  ["amy-s-kitchen",       { year: 2021 }],
  ["honest-company",      { year: 2022 }],
  ["new-belgium-brewing", { year: 2020 }],
  ["prana",               { year: 2021 }],
  ["aveda",               { year: 2022 }],
];

/* -------------------------------------------------------------------------- */
/* Fair Trade Certified business directory partners                          */
/* Source: fairtradecertified.org/business                                   */
/* -------------------------------------------------------------------------- */
const FAIR_TRADE = [
  ["ben-and-jerry-s",   { products: "ice cream ingredients (cocoa, vanilla, sugar, banana, coffee)" }],
  ["patagonia",         { products: "apparel" }],
  ["starbucks",         { products: "coffee, tea" }],
  ["peet-s-coffee",     { products: "coffee" }],
  ["caribou-coffee",    { products: "coffee" }],
  ["athleta",           { products: "apparel" }],
  ["prana",             { products: "apparel" }],
  ["honest-company",    { products: "personal care" }],
  ["amy-s-kitchen",     { products: "frozen meals (cocoa, sugar)" }],
];

/* -------------------------------------------------------------------------- */
/* 1% for the Planet — extended public member list                            */
/* Source: onepercentfortheplanet.org/members                                */
/* -------------------------------------------------------------------------- */
const ONE_PERCENT_PLANET_EXTRA = [
  ["prana",               { member_since: "2017" }],
  ["honest-company",      { member_since: "2019" }],
  ["new-belgium-brewing", { member_since: "2014" }],
  ["amy-s-kitchen",       { member_since: "2018" }],
];

/* -------------------------------------------------------------------------- */
/* Newsweek Most Trustworthy Companies in America (top 700)                  */
/* Source: newsweek.com/rankings/americas-most-trustworthy-companies         */
/* -------------------------------------------------------------------------- */
const NEWSWEEK_TRUST = [
  ["microsoft",           { rank: 1,  year: 2024 }],
  ["apple",               { rank: 2,  year: 2024 }],
  ["procter-and-gamble",  { rank: 3,  year: 2024 }],
  ["pepsico",             { rank: 4,  year: 2024 }],
  ["coca-cola",           { rank: 5,  year: 2024 }],
  ["target",              { rank: 6,  year: 2024 }],
  ["costco",              { rank: 7,  year: 2024 }],
  ["walmart",             { rank: 8,  year: 2024 }],
  ["accenture",           { rank: 9,  year: 2024 }],
  ["mastercard",          { rank: 10, year: 2024 }],
  ["visa",                { rank: 11, year: 2024 }],
  ["delta-air-lines",     { rank: 13, year: 2024 }],
  ["bank-of-america",     { rank: 17, year: 2024 }],
  ["jpmorgan-chase",      { rank: 19, year: 2024 }],
  ["fedex",               { rank: 22, year: 2024 }],
  ["disney",              { rank: 25, year: 2024 }],
  ["nike",                { rank: 31, year: 2024 }],
  ["intel",               { rank: 33, year: 2024 }],
  ["cisco",               { rank: 35, year: 2024 }],
  ["ibm",                 { rank: 38, year: 2024 }],
  ["adobe",               { rank: 41, year: 2024 }],
  ["salesforce",          { rank: 42, year: 2024 }],
  ["home-depot",          { rank: 47, year: 2024 }],
  ["lowe-s",              { rank: 52, year: 2024 }],
  ["pfizer",              { rank: 58, year: 2024 }],
  ["merck",               { rank: 64, year: 2024 }],
  ["johnson-and-johnson", { rank: 69, year: 2024 }],
];

/* -------------------------------------------------------------------------- */
/* WRITE                                                                      */
/* -------------------------------------------------------------------------- */

const stats = {};

stats.bcorp = writeAugment(
  "bcorp",
  BCORP.map(([s, p]) => [s, {
    bcorp_certified: true,
    score: p.score,
    certifiedSince: p.certified_since,
    industry: p.industry,
    note: p.note || null,
    source_list: "B Corp Directory",
    source_url: "https://www.bcorporation.net/en-us/find-a-b-corp/",
  }]),
  { source_url: "https://www.bcorporation.net/en-us/find-a-b-corp/" }
);

stats.justCapital = writeAugment(
  "just-capital",
  JUST_100.map(([s, p]) => [s, {
    rank: p.rank,
    year: p.year,
    source_list: "JUST Capital JUST 100",
    source_url: "https://justcapital.com/rankings/",
  }]),
  { source_url: "https://justcapital.com/rankings/" }
);

stats.drucker = writeAugment(
  "drucker-250",
  DRUCKER_250.map(([s, p]) => [s, {
    rank: p.rank,
    year: p.year,
    source_list: "Drucker Institute Management Top 250",
    source_url: "https://www.drucker.institute/managementtop250/",
  }]),
  { source_url: "https://www.drucker.institute/managementtop250/" }
);

stats.fortune = writeAugment(
  "fortune-admired",
  FORTUNE_ADMIRED.map(([s, p]) => [s, {
    rank: p.rank,
    year: p.year,
    source_list: "Fortune World's Most Admired Companies",
    source_url: "https://fortune.com/ranking/worlds-most-admired-companies/",
  }]),
  { source_url: "https://fortune.com/ranking/worlds-most-admired-companies/" }
);

stats.forbes = writeAugment(
  "forbes-employers",
  FORBES_EMPLOYERS.map(([s, p]) => [s, {
    rank: p.rank,
    year: p.year,
    source_list: "Forbes World's Best Employers",
    source_url: "https://www.forbes.com/lists/worlds-best-employers/",
  }]),
  { source_url: "https://www.forbes.com/lists/worlds-best-employers/" }
);

stats.hrcCei = writeAugment(
  "hrc-cei",
  HRC_CEI_100.map((s) => [s, {
    cei_score: 100,
    year: 2025,
    source_list: "HRC Corporate Equality Index — 100/100",
    source_url: "https://www.hrc.org/resources/corporate-equality-index",
  }]),
  { source_url: "https://www.hrc.org/resources/corporate-equality-index" }
);

stats.bloomberg = writeAugment(
  "bloomberg-gei",
  BLOOMBERG_GEI.map((s) => [s, {
    year: 2024,
    source_list: "Bloomberg Gender-Equality Index",
    source_url: "https://www.bloomberg.com/gei",
  }]),
  { source_url: "https://www.bloomberg.com/gei" }
);

stats.cdpAList = writeAugment(
  "cdp-a-list",
  CDP_A_LIST.map((s) => [s, {
    cdp_score: "A",
    year: 2024,
    source_list: "CDP A-List (Climate)",
    source_url: "https://www.cdp.net/en/companies/companies-scores",
  }]),
  { source_url: "https://www.cdp.net/en/companies/companies-scores" }
);

stats.climateNeutral = writeAugment(
  "climate-neutral",
  CLIMATE_NEUTRAL.map(([s, p]) => [s, {
    certified: true,
    year: p.year,
    source_list: "Climate Neutral Certified",
    source_url: "https://www.climateneutral.org/brands",
  }]),
  { source_url: "https://www.climateneutral.org/brands" }
);

stats.fairTrade = writeAugment(
  "fair-trade",
  FAIR_TRADE.map(([s, p]) => [s, {
    fair_trade_partner: true,
    products: p.products,
    source_list: "Fair Trade Certified",
    source_url: "https://www.fairtradecertified.org/business",
  }]),
  { source_url: "https://www.fairtradecertified.org/business" }
);

stats.newsweek = writeAugment(
  "newsweek-trust",
  NEWSWEEK_TRUST.map(([s, p]) => [s, {
    rank: p.rank,
    year: p.year,
    source_list: "Newsweek Most Trustworthy Companies in America",
    source_url: "https://www.newsweek.com/rankings/americas-most-trustworthy-companies",
  }]),
  { source_url: "https://www.newsweek.com/rankings/americas-most-trustworthy-companies" }
);

// 1% for the Planet — merge into existing file.
{
  const existingPath = path.join(DERIVED_DIR, "one-percent-planet-augment.json");
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(existingPath, "utf8")); } catch {}
  const companies = { ...(existing.companies || {}) };
  let added = 0;
  for (const [slug, p] of ONE_PERCENT_PLANET_EXTRA) {
    if (!slugExists(slug)) continue;
    if (!companies[slug]) added++;
    companies[slug] = {
      slug,
      is_one_percent_member: true,
      member_since: p.member_since,
      source: "one-percent-planet",
      source_url: "https://www.onepercentfortheplanet.org/members",
      ...(companies[slug] || {}),
    };
  }
  const out = {
    source: "one-percent-planet",
    source_url: "https://www.onepercentfortheplanet.org/members",
    generated_at: new Date().toISOString(),
    snapshot_date: new Date().toISOString().slice(0, 10),
    matched_slug_count: Object.keys(companies).length,
    companies,
  };
  fs.writeFileSync(existingPath, JSON.stringify(out, null, 2));
  console.log(`[one-percent-planet] expanded: +${added} new, ${Object.keys(companies).length} total`);
  stats.onePercent = Object.keys(companies).length;
}

console.log("");
console.log("=== positive-signal-build DONE ===");
for (const [k, v] of Object.entries(stats)) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}
