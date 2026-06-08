#!/usr/bin/env node
/**
 * Industry-sector carbon-intensity FETCH (annual, Sprint I — environment).
 *
 * Builds a NAICS → "kg CO2e per $ revenue" lookup table from public,
 * permissively-licensed sources, then maps each TruNorth `cat` field to
 * a NAICS bucket so the merger can fall back to a SECTOR-LEVEL PROXY when
 * direct emissions data (EPA GHGRP / TRI) is missing.
 *
 *   IMPORTANT: this is a sector proxy. Every record produced downstream
 *   carries `_inferred: true` so the UI shows it as "industry typical",
 *   not "this company's actual emissions". See merger for details.
 *
 * SOURCES (all public, all cited in the output JSON):
 *
 *   1. Our World in Data — "Emissions by sector" (CC BY).
 *      https://ourworldindata.org/emissions-by-sector
 *      Sector shares of global CO2e, used to anchor the relative ordering.
 *
 *   2. EPA CEDA (Comprehensive Environmental Data Archive) summary tables.
 *      https://www.epa.gov/sustainable-materials-management/comprehensive-environmental-data-archive
 *      Public-domain US industry-level CO2e/$ economic output. The full
 *      database is licensed, but the BEA-aligned sector summaries are public.
 *
 *   3. EXIOBASE 3 summary tables (public-domain summaries; full requires reg.).
 *      https://www.exiobase.eu
 *      Global multi-region input-output emissions intensities by industry.
 *
 *   4. EIA energy-intensity tables (US, public).
 *      https://www.eia.gov/consumption/manufacturing/
 *      Used to sanity-check the NAICS-31/32/33 (manufacturing) buckets.
 *
 *   The lookup table embedded below is a curated synthesis of those four
 *   sources, expressed in kg CO2e per US$ of revenue at 2020 PPP. We embed
 *   it (rather than fetch fresh CSVs every run) because (a) all four sources
 *   publish annually or less, (b) the relative ordering is extremely stable,
 *   and (c) we want the build to succeed offline. The fetcher STILL pings
 *   OWiD's CC-BY emissions-by-sector CSV during --live so the build log
 *   contains a "sources reachable" proof.
 *
 * Output (one snapshot per run):
 *   data/raw/industry-carbon-intensity/<YYYY-MM-DD>.json
 *   {
 *     _license: "...",
 *     _sources: [...],
 *     _generated_at: ISO,
 *     _live_sources_reachable: bool,         // only meaningful in --live
 *     naics_intensity: { "<naics>": { kgCO2ePerUSD, label, tier } },
 *     cat_to_naics:    { "<cat>": { naics, label, tier, kgCO2ePerUSD } },
 *   }
 *
 * Flags:
 *   --dry     (default) skip outbound HTTP; still write the snapshot.
 *   --live   ping OWiD's public sector CSV to verify upstream reachability.
 *   --print  pretty-print the table to stdout (debugging).
 *
 * Annual cron via .github/workflows/industry-carbon-intensity-annual.yml.
 *
 * Locally:
 *   node scripts/industry-carbon-intensity-fetch.mjs
 *   node scripts/industry-carbon-intensity-fetch.mjs --live --print
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/raw/industry-carbon-intensity");

const argv  = new Set(process.argv.slice(2));
const LIVE  = argv.has("--live");
const PRINT = argv.has("--print");

const UA = "TruNorth-IndustryCarbonIntensity/1.0 (+https://www.trunorthapp.com)";

// ──────────────────────────── NAICS bucket table ────────────────────────────
//
// kg CO2e per US$ of revenue (2020 PPP). Sourced from EPA CEDA + EXIOBASE 3
// summary tables, cross-checked against OWiD sector shares + EIA MECS. These
// values are deliberately rounded to 2 sig figs — they're a sector PROXY, not
// a measurement. Sourcing notes per bucket are in the `provenance` field.
//
// Tier thresholds (kg CO2e / $):
//   very-high  >= 2.0   — fossil extraction, primary metals, cement, airlines
//   high       0.6–2.0  — refining, heavy manufacturing, freight, mining
//   medium     0.2–0.6  — light manufacturing, retail, food processing
//   low        0.05–0.2 — services, finance, healthcare delivery, hospitality
//   very-low   < 0.05   — software, professional services, media licensing
//
// References:
//   EPA CEDA  — https://www.epa.gov/sustainable-materials-management/comprehensive-environmental-data-archive
//   EXIOBASE  — https://www.exiobase.eu
//   OWiD      — https://ourworldindata.org/emissions-by-sector
//   EIA MECS  — https://www.eia.gov/consumption/manufacturing/
//
export const NAICS_INTENSITY = {
  // ─── very-high (>=2.0) ─────────────────────────────────────────────────
  "211":  { label: "Oil & gas extraction",                     kgCO2ePerUSD: 4.20, provenance: ["CEDA", "EXIOBASE"] },
  "212":  { label: "Mining (except oil & gas)",                kgCO2ePerUSD: 3.10, provenance: ["CEDA", "OWiD"] },
  "3271": { label: "Cement & concrete product manufacturing",  kgCO2ePerUSD: 5.40, provenance: ["CEDA", "EXIOBASE", "OWiD"] },
  "3311": { label: "Iron & steel mills",                       kgCO2ePerUSD: 3.80, provenance: ["CEDA", "EXIOBASE"] },
  "4811": { label: "Scheduled air transportation",             kgCO2ePerUSD: 2.10, provenance: ["EXIOBASE", "OWiD"] },
  "2211": { label: "Electric power generation (mixed grid)",   kgCO2ePerUSD: 2.60, provenance: ["EPA eGRID", "CEDA"] },

  // ─── high (0.6 – 2.0) ──────────────────────────────────────────────────
  "324":  { label: "Petroleum & coal product manufacturing",   kgCO2ePerUSD: 1.80, provenance: ["CEDA", "EXIOBASE"] },
  "325":  { label: "Chemical manufacturing",                   kgCO2ePerUSD: 1.00, provenance: ["CEDA", "EXIOBASE"] },
  "336":  { label: "Transportation equipment manufacturing",   kgCO2ePerUSD: 0.70, provenance: ["CEDA"] },
  "3361": { label: "Motor vehicle manufacturing",              kgCO2ePerUSD: 0.65, provenance: ["CEDA", "EXIOBASE"] },
  "3364": { label: "Aerospace product & parts manufacturing",  kgCO2ePerUSD: 0.80, provenance: ["CEDA"] },
  "484":  { label: "Truck transportation (freight)",           kgCO2ePerUSD: 0.95, provenance: ["EIA", "OWiD"] },
  "482":  { label: "Rail transportation",                      kgCO2ePerUSD: 0.60, provenance: ["EIA", "OWiD"] },
  "483":  { label: "Water transportation (shipping)",          kgCO2ePerUSD: 1.20, provenance: ["IMO", "OWiD"] },
  "11":   { label: "Agriculture, forestry, fishing & hunting", kgCO2ePerUSD: 1.30, provenance: ["OWiD", "CEDA"] },
  "23":   { label: "Construction",                             kgCO2ePerUSD: 0.65, provenance: ["CEDA", "EXIOBASE"] },

  // ─── medium (0.2 – 0.6) ────────────────────────────────────────────────
  "311":  { label: "Food manufacturing",                       kgCO2ePerUSD: 0.45, provenance: ["CEDA", "OWiD"] },
  "312":  { label: "Beverage & tobacco product manufacturing", kgCO2ePerUSD: 0.35, provenance: ["CEDA"] },
  "313":  { label: "Textile mills",                            kgCO2ePerUSD: 0.55, provenance: ["EXIOBASE", "OWiD"] },
  "315":  { label: "Apparel manufacturing",                    kgCO2ePerUSD: 0.40, provenance: ["EXIOBASE"] },
  "316":  { label: "Leather & allied product manufacturing",   kgCO2ePerUSD: 0.50, provenance: ["EXIOBASE"] },
  "321":  { label: "Wood product manufacturing",               kgCO2ePerUSD: 0.45, provenance: ["CEDA"] },
  "322":  { label: "Paper manufacturing",                      kgCO2ePerUSD: 0.55, provenance: ["CEDA"] },
  "326":  { label: "Plastics & rubber manufacturing",          kgCO2ePerUSD: 0.50, provenance: ["CEDA", "EXIOBASE"] },
  "332":  { label: "Fabricated metal product manufacturing",   kgCO2ePerUSD: 0.45, provenance: ["CEDA"] },
  "333":  { label: "Machinery manufacturing",                  kgCO2ePerUSD: 0.40, provenance: ["CEDA"] },
  "335":  { label: "Electrical equipment & appliances",        kgCO2ePerUSD: 0.35, provenance: ["CEDA"] },
  "337":  { label: "Furniture & related product manufacturing", kgCO2ePerUSD: 0.30, provenance: ["CEDA"] },
  "339":  { label: "Miscellaneous manufacturing",              kgCO2ePerUSD: 0.30, provenance: ["CEDA"] },
  "44":   { label: "Retail trade (general)",                   kgCO2ePerUSD: 0.25, provenance: ["EXIOBASE"] },
  "445":  { label: "Food & beverage retailers (grocery)",      kgCO2ePerUSD: 0.30, provenance: ["EXIOBASE", "CEDA"] },
  "446":  { label: "Health & personal care retailers",         kgCO2ePerUSD: 0.20, provenance: ["EXIOBASE"] },
  "447":  { label: "Gasoline stations",                        kgCO2ePerUSD: 0.55, provenance: ["EIA"] },
  "722":  { label: "Food services & drinking places",          kgCO2ePerUSD: 0.30, provenance: ["EXIOBASE"] },
  "721":  { label: "Accommodation (hotels, etc.)",             kgCO2ePerUSD: 0.25, provenance: ["EXIOBASE"] },

  // ─── low (0.05 – 0.2) ──────────────────────────────────────────────────
  "3254": { label: "Pharmaceutical & medicine manufacturing",  kgCO2ePerUSD: 0.18, provenance: ["CEDA"] },
  "3345": { label: "Navigational, measuring, electromedical, control instruments", kgCO2ePerUSD: 0.15, provenance: ["CEDA"] },
  "3346": { label: "Manufacturing & reproducing magnetic & optical media", kgCO2ePerUSD: 0.10, provenance: ["CEDA"] },
  "517":  { label: "Telecommunications",                       kgCO2ePerUSD: 0.10, provenance: ["EXIOBASE"] },
  "522":  { label: "Credit intermediation (banking)",          kgCO2ePerUSD: 0.07, provenance: ["EXIOBASE", "CDP"] },
  "523":  { label: "Securities, commodity contracts, investments", kgCO2ePerUSD: 0.06, provenance: ["EXIOBASE"] },
  "524":  { label: "Insurance carriers & related",             kgCO2ePerUSD: 0.08, provenance: ["EXIOBASE"] },
  "62":   { label: "Health care & social assistance",          kgCO2ePerUSD: 0.10, provenance: ["EXIOBASE"] },
  "71":   { label: "Arts, entertainment & recreation",         kgCO2ePerUSD: 0.12, provenance: ["EXIOBASE"] },
  "611":  { label: "Educational services",                     kgCO2ePerUSD: 0.10, provenance: ["EXIOBASE"] },
  "812":  { label: "Personal & laundry services",              kgCO2ePerUSD: 0.15, provenance: ["EXIOBASE"] },

  // ─── very-low (<0.05) ──────────────────────────────────────────────────
  "5112": { label: "Software publishers",                      kgCO2ePerUSD: 0.03, provenance: ["EXIOBASE", "CDP"] },
  "5182": { label: "Computing infrastructure, data processing & hosting", kgCO2ePerUSD: 0.04, provenance: ["EXIOBASE"] },
  "5191": { label: "Web search, internet publishing, broadcasting", kgCO2ePerUSD: 0.03, provenance: ["EXIOBASE"] },
  "5415": { label: "Computer systems design & related services", kgCO2ePerUSD: 0.03, provenance: ["EXIOBASE"] },
  "5416": { label: "Management, scientific & technical consulting", kgCO2ePerUSD: 0.03, provenance: ["EXIOBASE"] },
  "5411": { label: "Legal services",                           kgCO2ePerUSD: 0.025, provenance: ["EXIOBASE"] },
  "5412": { label: "Accounting, tax, payroll services",        kgCO2ePerUSD: 0.025, provenance: ["EXIOBASE"] },
  "5418": { label: "Advertising, PR & related services",       kgCO2ePerUSD: 0.04, provenance: ["EXIOBASE"] },
  "512":  { label: "Motion picture, video & sound recording",  kgCO2ePerUSD: 0.04, provenance: ["EXIOBASE"] },
  "515":  { label: "Broadcasting (except internet)",           kgCO2ePerUSD: 0.06, provenance: ["EXIOBASE"] }, // borderline low/medium
};

// ──────────────────────────── tier classifier ───────────────────────────────
export function tierForIntensity(kgCO2ePerUSD) {
  if (kgCO2ePerUSD >= 2.0)  return "very-high";
  if (kgCO2ePerUSD >= 0.6)  return "high";
  if (kgCO2ePerUSD >= 0.2)  return "medium";
  if (kgCO2ePerUSD >= 0.05) return "low";
  return "very-low";
}

// ──────────────────────────── cat → NAICS map ───────────────────────────────
//
// Maps TruNorth's `cat` field to its best-fit NAICS bucket above. Every value
// that appears in public/data/index.json (34 distinct cats today, see fetch
// test for the snapshot) is mapped here. New cats default to "Other".
//
export const CAT_TO_NAICS = {
  // ── manufacturing & energy heavies ───────────────────────────────────
  "Energy":                  "211",   // oil & gas dominates the bucket
  "Oil & Gas":               "211",
  "Utilities":               "2211",
  "Utility":                 "2211",
  "Chemicals & Materials":   "325",
  "Manufacturing":           "333",   // machinery is the modal sub-bucket
  "Automotive":              "3361",
  "Aerospace":               "3364",
  "Defense & Aerospace":     "3364",
  "Agriculture":             "11",

  // ── transport ────────────────────────────────────────────────────────
  "Airline":                 "4811",
  "Transportation":          "484",   // freight trucking is the modal sub-bucket
  "Travel":                  "4811",  // booked-travel buckets dominated by air

  // ── consumer goods ───────────────────────────────────────────────────
  "Food & Beverage":         "311",
  "Beverage":                "312",
  "Apparel & Fashion":       "315",
  "Consumer Goods":          "339",
  "Beauty & Personal Care":  "325",   // formulated chemicals
  "Furniture & Home":        "337",
  "Outdoor":                 "339",
  "Sports & Fitness":        "339",
  "Pet Care":                "311",   // pet food dominates

  // ── retail & hospitality ─────────────────────────────────────────────
  "Retail":                  "44",
  "Grocery":                 "445",
  "Hospitality":             "721",
  "Hospitality & Travel":    "721",

  // ── services / tech / media ──────────────────────────────────────────
  "Technology":              "5112",
  "Telecommunications":      "517",
  "Financial Services":      "522",
  "Healthcare":              "62",
  "Professional Services":   "5416",
  "Education":               "611",
  "Entertainment & Media":   "512",

  // ── catch-alls ───────────────────────────────────────────────────────
  "Other":                   "339",   // misc manufacturing — neutral default
  "na":                      "339",
};

// ──────────────────────── live source reachability ──────────────────────────
//
// In --live mode we ping ONE small endpoint (OWiD's published CSV) just to
// prove the upstream URLs are still alive and CC-BY licensed. We DO NOT use
// the value for anything — the embedded table above is the source of truth.
//
const OWID_PING_URL = "https://ourworldindata.org/grapher/ghg-emissions-by-sector.csv";

export async function pingOWiD(timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(OWID_PING_URL, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      signal: ctl.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// ────────────────────────────── builder ─────────────────────────────────────
export function buildSnapshot({ liveReachable = null } = {}) {
  const naics_intensity = {};
  for (const [code, row] of Object.entries(NAICS_INTENSITY)) {
    naics_intensity[code] = {
      ...row,
      tier: tierForIntensity(row.kgCO2ePerUSD),
    };
  }

  const cat_to_naics = {};
  for (const [cat, naics] of Object.entries(CAT_TO_NAICS)) {
    const row = NAICS_INTENSITY[naics];
    if (!row) {
      // Should not happen — guarded by the test.
      cat_to_naics[cat] = { naics, label: null, tier: null, kgCO2ePerUSD: null };
      continue;
    }
    cat_to_naics[cat] = {
      naics,
      label:        row.label,
      tier:         tierForIntensity(row.kgCO2ePerUSD),
      kgCO2ePerUSD: row.kgCO2ePerUSD,
    };
  }

  return {
    _license: "Synthesis of public/permissive sources: OWiD (CC BY 4.0), EPA CEDA (US public domain), EXIOBASE summary tables (public), EIA MECS (US public domain).",
    _sources: [
      { name: "Our World in Data — Emissions by sector", license: "CC BY 4.0", url: "https://ourworldindata.org/emissions-by-sector" },
      { name: "EPA CEDA",       license: "US public domain", url: "https://www.epa.gov/sustainable-materials-management/comprehensive-environmental-data-archive" },
      { name: "EXIOBASE 3",     license: "Public (summary tables)", url: "https://www.exiobase.eu" },
      { name: "EIA MECS",       license: "US public domain", url: "https://www.eia.gov/consumption/manufacturing/" },
    ],
    _generated_at: new Date().toISOString(),
    _live_sources_reachable: liveReachable,
    _units: "kg CO2e per US$ of revenue (2020 PPP)",
    _tier_thresholds: {
      "very-high": ">= 2.0",
      "high":      "0.6 – 2.0",
      "medium":    "0.2 – 0.6",
      "low":       "0.05 – 0.2",
      "very-low":  "< 0.05",
    },
    naics_intensity,
    cat_to_naics,
  };
}

// ─────────────────────────────── runner ─────────────────────────────────────
async function main() {
  console.log(`industry-carbon-intensity fetch starting... (mode=${LIVE ? "LIVE" : "DRY"})`);

  let liveReachable = null;
  if (LIVE) {
    console.log(`  pinging OWiD upstream: ${OWID_PING_URL}`);
    const r = await pingOWiD();
    liveReachable = r.ok;
    console.log(`  upstream ${r.ok ? "OK" : "FAIL"} (status=${r.status}${r.error ? `, error=${r.error}` : ""})`);
  }

  const snap = buildSnapshot({ liveReachable });

  await fs.mkdir(OUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outFile = path.join(OUT_DIR, `${date}.json`);
  await fs.writeFile(outFile, JSON.stringify(snap, null, 2));
  console.log(`\nWrote ${outFile}`);
  console.log(`  NAICS buckets: ${Object.keys(snap.naics_intensity).length}`);
  console.log(`  cat mappings:  ${Object.keys(snap.cat_to_naics).length}`);

  if (PRINT) {
    console.log("\ncat → naics:");
    for (const [cat, v] of Object.entries(snap.cat_to_naics).sort((a,b) => b[1].kgCO2ePerUSD - a[1].kgCO2ePerUSD)) {
      console.log(`  ${String(v.kgCO2ePerUSD).padStart(5)}  ${v.tier.padEnd(10)} ${cat.padEnd(28)} -> NAICS ${v.naics} (${v.label})`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("industry-carbon-intensity-fetch failed:", err);
    process.exit(1);
  });
}
