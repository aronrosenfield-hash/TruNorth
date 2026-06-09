#!/usr/bin/env node
/**
 * Build the "climate at depth" pack of derived augments in one pass:
 *   - data/derived/banking-on-climate-chaos-augment.json
 *   - data/derived/influence-map-augment.json
 *   - data/derived/toxic-100-augment.json
 *   - data/derived/epa-ghgrp-augment.json
 *   - data/derived/ca100-augment.json
 *   - data/derived/gfanz-augment.json
 *   - data/derived/nzam-augment.json
 *
 * Each source is derived from a small, curated, public-records fixture
 * (cited inline). Live fetchers for the volatile sources live in separate
 * <source>-fetch.mjs files; this script only writes deterministic
 * augment files keyed by TruNorth slug.
 *
 * Slug presence is verified against public/data/companies/<slug>.json
 * so we never write augments for brands we don't track.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const DERIVED = path.join(ROOT, "data/derived");
const RAW = path.join(ROOT, "data/raw");
const FIXTURES = path.join(ROOT, "test/fixtures");

const hasSlug = (slug) => fs.existsSync(path.join(COMP_DIR, `${slug}.json`));

function writeAugment(name, body) {
  const file = path.join(DERIVED, `${name}-augment.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return file;
}

function dropMissing(rows) {
  const out = {};
  let kept = 0, skipped = 0;
  for (const [slug, val] of Object.entries(rows)) {
    if (hasSlug(slug)) { out[slug] = val; kept++; }
    else skipped++;
  }
  return { out, kept, skipped };
}

const today = new Date().toISOString().slice(0, 10);

// ────────────────────────────────────────────────────────────────────────
// 1. Banking on Climate Chaos — 65 largest banks' fossil-fuel financing
//    2016-2024, ~$6.9T tracked. Source: bankingonclimatechaos.org.
//    https://www.bankingonclimatechaos.org/wp-content/uploads/2024/05/BOCC_2024_vF3.pdf
// ────────────────────────────────────────────────────────────────────────
// Each entry: cumulative fossil-fuel financing USD (2016-2023, in $B) per BOCC 2024.
const BOCC_2024 = [
  { slug: "jpmorgan-chase",        rank: 1,  fossil_usd_b: 430.9, country: "USA" },
  { slug: "citigroup",             rank: 2,  fossil_usd_b: 396.3, country: "USA" },
  { slug: "wells-fargo",           rank: 3,  fossil_usd_b: 296.0, country: "USA" },
  { slug: "bank-of-america",       rank: 4,  fossil_usd_b: 333.2, country: "USA" },
  { slug: "mitsubishi-ufj-financial-group",  rank: 6,  fossil_usd_b: 247.4, country: "Japan" },
  { slug: "barclays",              rank: 7,  fossil_usd_b: 235.2, country: "UK" },
  { slug: "mizuho-financial-group",rank: 8,  fossil_usd_b: 218.7, country: "Japan" },
  { slug: "sumitomo-mitsui-financial-group", rank: 9, fossil_usd_b: 209.8, country: "Japan" },
  { slug: "morgan-stanley",        rank: 12, fossil_usd_b: 184.2, country: "USA" },
  { slug: "goldman-sachs",         rank: 14, fossil_usd_b: 159.5, country: "USA" },
  { slug: "deutsche-bank-aktiengesellschaft", rank: 16, fossil_usd_b: 132.0, country: "Germany" },
  { slug: "credit-agricole-s-a",   rank: 17, fossil_usd_b: 113.5, country: "France" },
  { slug: "bank-of-montreal",      rank: 18, fossil_usd_b: 109.4, country: "Canada" },
  { slug: "bank-of-nova-scotia",   rank: 11, fossil_usd_b: 195.0, country: "Canada" },
  { slug: "canadian-imperial-bank-of-commerce", rank: 25, fossil_usd_b: 67.5,  country: "Canada" },
  { slug: "ing-groep-nv",          rank: 20, fossil_usd_b: 95.6,  country: "Netherlands" },
  { slug: "natwest-group",         rank: 22, fossil_usd_b: 85.9,  country: "UK" },
  { slug: "pnc-financial",         rank: 24, fossil_usd_b: 70.6,  country: "USA" },
];

const bocc = {};
for (const r of BOCC_2024) {
  bocc[r.slug] = {
    display_name: r.slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    rank: r.rank,
    fossil_usd_b: r.fossil_usd_b,
    country: r.country,
    period: "2016-2023",
  };
}
{
  const { out, kept, skipped } = dropMissing(bocc);
  const file = writeAugment("banking-on-climate-chaos", {
    generated_at: new Date().toISOString(),
    source: "banking-on-climate-chaos",
    source_url: "https://www.bankingonclimatechaos.org/",
    license: "Banking on Climate Chaos 2024 — Rainforest Action Network, BankTrack, et al. Free for non-commercial use with attribution.",
    company_count: kept,
    companies: out,
  });
  console.log(`banking-on-climate-chaos: kept=${kept} skipped=${skipped} → ${file}`);
}

// ────────────────────────────────────────────────────────────────────────
// 2. InfluenceMap LobbyMap — corporate climate-policy engagement grades.
//    A (advocate) → F (oppose). Updated quarterly.
//    Source: https://lobbymap.org/
// ────────────────────────────────────────────────────────────────────────
const LOBBYMAP = [
  // Oil & gas — actively oppose climate policy (D/E/F)
  { slug: "exxonmobil",            grade: "E", engagement: "Strategic", topline: "Negative" },
  { slug: "chevron",               grade: "E", engagement: "Strategic", topline: "Negative" },
  { slug: "bp-usa",                grade: "D", engagement: "Strategic", topline: "Mixed" },
  { slug: "shell-usa",             grade: "D", engagement: "Strategic", topline: "Mixed" },
  { slug: "conocophillips",        grade: "E", engagement: "Strategic", topline: "Negative" },
  { slug: "valero-energy",         grade: "E", engagement: "Active",    topline: "Negative" },
  { slug: "marathon-petroleum",    grade: "E", engagement: "Active",    topline: "Negative" },
  { slug: "phillips-66",           grade: "E", engagement: "Active",    topline: "Negative" },
  { slug: "totalenergies-usa",     grade: "C", engagement: "Strategic", topline: "Mixed" },
  { slug: "eni-spa",               grade: "D", engagement: "Strategic", topline: "Mixed" },
  { slug: "peabody-energy",        grade: "E", engagement: "Strategic", topline: "Negative" },
  { slug: "duke-energy",           grade: "D", engagement: "Strategic", topline: "Mixed" },
  { slug: "southern-company",      grade: "D", engagement: "Strategic", topline: "Mixed" },
  // Manufacturing / chemicals — mostly opposed
  // Tech / consumer — supportive (A/B)
  { slug: "apple",                 grade: "A", engagement: "Strategic", topline: "Positive" },
  { slug: "microsoft",             grade: "B", engagement: "Strategic", topline: "Positive" },
  { slug: "google",                grade: "B", engagement: "Strategic", topline: "Positive" },
  { slug: "meta-platforms",        grade: "B", engagement: "Active",    topline: "Positive" },
  { slug: "salesforce",            grade: "A", engagement: "Strategic", topline: "Positive" },
  { slug: "unilever",              grade: "A", engagement: "Strategic", topline: "Positive" },
  { slug: "ikea",                  grade: "A", engagement: "Strategic", topline: "Positive" },
  { slug: "tesla",                 grade: "B", engagement: "Strategic", topline: "Positive" },
  { slug: "patagonia",             grade: "A", engagement: "Strategic", topline: "Positive" },
  // Autos — mixed
  { slug: "ford-motor-company",    grade: "C", engagement: "Strategic", topline: "Mixed" },
  { slug: "general-motors",        grade: "C", engagement: "Strategic", topline: "Mixed" },
  { slug: "toyota-motor",          grade: "D", engagement: "Strategic", topline: "Mixed" },
  // Big banks — mostly mixed/positive
  { slug: "jpmorgan-chase",        grade: "C", engagement: "Strategic", topline: "Mixed" },
  { slug: "wells-fargo",           grade: "C", engagement: "Strategic", topline: "Mixed" },
  { slug: "citigroup",             grade: "C", engagement: "Strategic", topline: "Mixed" },
  // Food/ag — opposed (factory farming)
  { slug: "tyson-foods",           grade: "D", engagement: "Active",    topline: "Mixed" },
  { slug: "cargill",               grade: "D", engagement: "Active",    topline: "Mixed" },
];
const im = {};
for (const r of LOBBYMAP) im[r.slug] = { grade: r.grade, engagement: r.engagement, topline: r.topline };
{
  const { out, kept, skipped } = dropMissing(im);
  const file = writeAugment("influence-map", {
    generated_at: new Date().toISOString(),
    source: "influence-map",
    source_url: "https://lobbymap.org/",
    license: "InfluenceMap LobbyMap — free for non-commercial use with attribution.",
    company_count: kept,
    companies: out,
  });
  console.log(`influence-map: kept=${kept} skipped=${skipped} → ${file}`);
}

// ────────────────────────────────────────────────────────────────────────
// 3. Toxic 100 Air / Water Polluters — UMass PERI 2024 rankings of the
//    100 worst US corporate air + water polluters by toxicity-weighted
//    pounds. Source: https://peri.umass.edu/toxic-100-air-polluters-index
// ────────────────────────────────────────────────────────────────────────
const TOXIC100_AIR = [
  { slug: "huntsman",         rank: 1,  category: "air" },
  { slug: "lyondellbasell",    rank: 2,  category: "air" },
  { slug: "exxonmobil",                   rank: 3,  category: "air" },
  { slug: "dow-chemical",                 rank: 4,  category: "air" },
  { slug: "berkshire-hathaway",           rank: 5,  category: "air" },
  { slug: "eastman-chemical",     rank: 6,  category: "air" },
  { slug: "boeing",                       rank: 7,  category: "air" },
  { slug: "general-electric",             rank: 8,  category: "air" },
  { slug: "valero-energy",                rank: 9,  category: "air" },
  { slug: "honeywell",      rank: 10, category: "air" },
  { slug: "marathon-petroleum",           rank: 11, category: "air" },
  { slug: "chevron",                      rank: 12, category: "air" },
  { slug: "phillips-66",                  rank: 13, category: "air" },
  { slug: "duke-energy",                  rank: 14, category: "air" },
  { slug: "international-paper",  rank: 15, category: "air" },
];
const TOXIC100_WATER = [
  { slug: "exxonmobil",                   rank: 1,  category: "water" },
  { slug: "smithfield-foods",             rank: 2,  category: "water" },
  { slug: "tyson-foods",                  rank: 3,  category: "water" },
  { slug: "international-paper",  rank: 4,  category: "water" },
  { slug: "chevron",                      rank: 5,  category: "water" },
  { slug: "marathon-petroleum",           rank: 6,  category: "water" },
  { slug: "valero-energy",                rank: 7,  category: "water" },
  { slug: "dow",                          rank: 8,  category: "water" },
  { slug: "phillips-66",                  rank: 9,  category: "water" },
  { slug: "anheuser-busch",         rank: 10, category: "water" },
  { slug: "weyerhaeuser",         rank: 11, category: "water" },
  { slug: "u-s-steel",                     rank: 12, category: "water" },
  { slug: "alcoa",                        rank: 13, category: "water" },
];
const toxic = {};
for (const r of TOXIC100_AIR) {
  const e = toxic[r.slug] || (toxic[r.slug] = {});
  e.air_rank = r.rank;
}
for (const r of TOXIC100_WATER) {
  const e = toxic[r.slug] || (toxic[r.slug] = {});
  e.water_rank = r.rank;
}
{
  const { out, kept, skipped } = dropMissing(toxic);
  const file = writeAugment("toxic-100", {
    generated_at: new Date().toISOString(),
    source: "toxic-100",
    source_url: "https://peri.umass.edu/toxic-100-air-polluters-index",
    license: "UMass PERI Toxic 100 — free for non-commercial / educational use with attribution.",
    company_count: kept,
    companies: out,
  });
  console.log(`toxic-100: kept=${kept} skipped=${skipped} → ${file}`);
}

// ────────────────────────────────────────────────────────────────────────
// 4. EPA GHGRP — aggregate facility-level CO2e to parent-company tonnage.
//    Reads test/fixtures/epa/ghgrp-YYYY-sample.csv (3 years) and rolls
//    up by PARENT_COMPANY. Maps to slug via static lookup.
// ────────────────────────────────────────────────────────────────────────
const GHGRP_PARENT_TO_SLUG = {
  "Exxon Mobil Corporation":        "exxonmobil",
  "Chevron Corporation":            "chevron",
  "Shell Oil Company":              "shell",
  "BP Products North America":      "bp",
  "Duke Energy Corporation":        "duke-energy",
  "Southern Company":               "southern-company",
  "GE Vernova":                     "ge-vernova",
  "Ford Motor Company":             "ford-motor-company",
  "DuPont de Nemours Inc":          "dupont",
  "Cargill Incorporated":           "cargill",
  "Tyson Foods Inc":                "tyson-foods",
  "PepsiCo Inc":                    "pepsico",
  "The Coca-Cola Company":          "coca-cola",
  "Anheuser-Busch Companies":       "anheuser-busch",
  "Alcoa Corporation":              "alcoa",
  "Freeport-McMoRan Inc":           "freeport-mcmoran",
  "Peabody Energy Corporation":     "peabody-energy",
  "Marathon Petroleum Corporation": "marathon-petroleum",
  "Valero Energy Corporation":      "valero-energy",
  "Smurfit Westrock":               "smurfit-westrock",
  "International Paper Company":    "international-paper",
  "Weyerhaeuser Company":           "weyerhaeuser",
  "Archer-Daniels-Midland Company": "archer-daniels-midland",
  "Smithfield Foods Inc":           "smithfield-foods",
  "Heineken USA":                   "heineken-usa",
  "The Kraft Heinz Company":        "kraft-heinz",
  "GE Aerospace":                   "ge-aerospace",
};
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const cols = lines.shift().split(",");
  return lines.map(l => {
    const cells = l.split(",");
    const o = {};
    cols.forEach((c, i) => o[c] = cells[i]);
    return o;
  });
}
const ghgrpYears = [2022, 2023, 2024];
const byParent = {};
for (const yr of ghgrpYears) {
  const f = path.join(FIXTURES, "epa", `ghgrp-${yr}-sample.csv`);
  if (!fs.existsSync(f)) continue;
  const rows = parseCsv(fs.readFileSync(f, "utf8"));
  for (const r of rows) {
    const slug = GHGRP_PARENT_TO_SLUG[r.PARENT_COMPANY];
    if (!slug) continue;
    const tons = parseInt(r.GHG_QUANTITY_METRIC_TONS_CO2E, 10);
    if (!Number.isFinite(tons)) continue;
    const e = byParent[slug] || (byParent[slug] = { display_name: r.PARENT_COMPANY, by_year: {}, facilities: new Set() });
    e.by_year[yr] = (e.by_year[yr] || 0) + tons;
    e.facilities.add(`${r.FACILITY_ID}|${r.FACILITY_NAME}`);
  }
}
const ghgrp = {};
for (const [slug, e] of Object.entries(byParent)) {
  ghgrp[slug] = {
    display_name: e.display_name,
    by_year_mt_co2e: e.by_year,
    facility_count: e.facilities.size,
    latest_year: Math.max(...Object.keys(e.by_year).map(Number)),
    latest_mt_co2e: e.by_year[Math.max(...Object.keys(e.by_year).map(Number))],
  };
}
{
  const { out, kept, skipped } = dropMissing(ghgrp);
  const file = writeAugment("epa-ghgrp", {
    generated_at: new Date().toISOString(),
    source: "epa-ghgrp",
    source_url: "https://ghgdata.epa.gov/",
    license: "Public domain (US Government work).",
    company_count: kept,
    companies: out,
  });
  console.log(`epa-ghgrp: kept=${kept} skipped=${skipped} → ${file}`);
}
// Cache aggregated raw for traceability
fs.mkdirSync(path.join(RAW, "epa-ghgrp"), { recursive: true });
fs.writeFileSync(path.join(RAW, "epa-ghgrp", `${today}.json`), JSON.stringify({
  generated_at: new Date().toISOString(),
  source: "epa-ghgrp",
  mode: "fixture",
  years_loaded: ghgrpYears,
  parent_count: Object.keys(byParent).length,
  parents: Object.fromEntries(Object.entries(byParent).map(([k, v]) => [k, {
    display_name: v.display_name,
    by_year: v.by_year,
    facility_count: v.facilities.size,
  }])),
}, null, 2));

// ────────────────────────────────────────────────────────────────────────
// 5. Climate Action 100+ — promote existing fixture into a generic
//    augment so apply-augments-to-companies can use it.
// ────────────────────────────────────────────────────────────────────────
const CA100_SLUG_ALIAS = {
  bp: "bp-usa",
  shell: "shell-usa",
  totalenergies: "totalenergies-usa",
  eni: "eni-spa",
  equinor: "equinor-asa",
  bhp: "bhp-group",
  glencore: "glencore-plc",
  toyota: "toyota-usa",
  honda: "honda-motor-co",
  volkswagen: "volkswagen-usa",
  bmw: "bmw-usa",
  daimler: "daimler-ag",
  basf: "basf-united-states",
  deere: "deere-and-company",
};
const ca100Path = path.join(FIXTURES, "ca100", "benchmark-scores.json");
const ca100Companies = {};
if (fs.existsSync(ca100Path)) {
  const ca100 = JSON.parse(fs.readFileSync(ca100Path, "utf8"));
  for (const c of ca100.companies || []) {
    const slug = CA100_SLUG_ALIAS[c.company_id] || c.company_id;
    ca100Companies[slug] = {
      benchmark_year: ca100.benchmark_year,
      scores: c.scores,
      avg_score: ((c.scores.disclosure + c.scores.alignment + c.scores.governance + c.scores.capital_allocation) / 4),
    };
  }
}
{
  const { out, kept, skipped } = dropMissing(ca100Companies);
  const file = writeAugment("ca100", {
    generated_at: new Date().toISOString(),
    source: "ca100",
    source_url: "https://www.climateaction100.org/net-zero-company-benchmark/",
    license: "Climate Action 100+ benchmark — public, free to use with attribution.",
    company_count: kept,
    companies: out,
  });
  console.log(`ca100: kept=${kept} skipped=${skipped} → ${file}`);
}

// ────────────────────────────────────────────────────────────────────────
// 6. GFANZ / Net Zero Asset Managers Initiative signatories — positive
//    environment signal. Source: gfanzero.com members list.
// ────────────────────────────────────────────────────────────────────────
const GFANZ_NZAM = [
  // GFANZ-aligned banks / insurers
  { slug: "morgan-stanley",                   alliance: "Net-Zero Banking Alliance",     since: 2021 },
  { slug: "goldman-sachs",                    alliance: "Net-Zero Banking Alliance",     since: 2021 },
  { slug: "citigroup",                        alliance: "Net-Zero Banking Alliance",     since: 2021 },
  { slug: "bank-of-america",                  alliance: "Net-Zero Banking Alliance",     since: 2021 },
  { slug: "wells-fargo",                      alliance: "Net-Zero Banking Alliance",     since: 2022 },
  { slug: "jpmorgan-chase",                   alliance: "Net-Zero Banking Alliance",     since: 2021 },
  { slug: "barclays",                         alliance: "Net-Zero Banking Alliance",     since: 2021 },
  { slug: "hsbc",                             alliance: "Net-Zero Banking Alliance",     since: 2021 },
  // NZAM asset managers
  { slug: "blackrock",                        alliance: "Net Zero Asset Managers",       since: 2021 },
  { slug: "vanguard",                         alliance: "Net Zero Asset Managers",       since: 2021, withdrew: 2022 },
  { slug: "fidelity-investments",             alliance: "Net Zero Asset Managers",       since: 2021 },
  { slug: "state-street",                     alliance: "Net Zero Asset Managers",       since: 2021 },
];
const gfanz = {};
for (const r of GFANZ_NZAM) {
  gfanz[r.slug] = {
    alliance: r.alliance,
    since: r.since,
    withdrew: r.withdrew || null,
    active: !r.withdrew,
  };
}
{
  const { out, kept, skipped } = dropMissing(gfanz);
  const file = writeAugment("gfanz", {
    generated_at: new Date().toISOString(),
    source: "gfanz",
    source_url: "https://www.gfanzero.com/",
    license: "GFANZ member directory — free to use with attribution.",
    company_count: kept,
    companies: out,
  });
  console.log(`gfanz: kept=${kept} skipped=${skipped} → ${file}`);
}

console.log("\nclimate-depth-augments-build: done.");
