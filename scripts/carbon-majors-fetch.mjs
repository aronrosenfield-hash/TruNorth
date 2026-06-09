#!/usr/bin/env node
/**
 * Carbon Majors Database (Heede 2024 update) — Climate Accountability
 * Institute's catalog of the 122 industrial producers responsible for
 * ~72% of all industrial CO2e + methane emissions since 1854.
 *
 * Source: https://carbonmajors.org (CC BY 4.0).
 *
 * The full database is downloadable from carbonmajors.org. We capture
 * the top investor-owned + state-owned producers in our static fixture
 * (the only ones that map to consumer brands TruNorth tracks). Nation-
 * state polluters (e.g. former USSR) don't get slugs.
 *
 * Output: data/raw/carbon-majors/<YYYY-MM-DD>.json
 * Cadence: annual (Q1 release).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/carbon-majors");

// 2024 Heede update — top contributors by cumulative emissions 1854-2023,
// share of total historic industrial GHG (MtCO2e basis).
const CARBON_MAJORS = [
  // ── Top investor-owned producers ───────────────────────────────────
  { slug: "chevron",                       name: "Chevron",                   ownership: "Investor-Owned", share_total_pct: 3.20, share_since_1988_pct: 2.83, primary_commodities: ["oil","gas"] },
  { slug: "exxonmobil",                    name: "ExxonMobil",                ownership: "Investor-Owned", share_total_pct: 3.10, share_since_1988_pct: 2.81, primary_commodities: ["oil","gas"] },
  { slug: "bp-usa",                        name: "BP",                        ownership: "Investor-Owned", share_total_pct: 2.41, share_since_1988_pct: 2.07, primary_commodities: ["oil","gas"] },
  { slug: "shell-usa",                     name: "Shell",                     ownership: "Investor-Owned", share_total_pct: 2.06, share_since_1988_pct: 1.95, primary_commodities: ["oil","gas"] },
  { slug: "conocophillips",                name: "ConocoPhillips",            ownership: "Investor-Owned", share_total_pct: 1.16, share_since_1988_pct: 0.96, primary_commodities: ["oil","gas"] },
  { slug: "totalenergies-usa",             name: "TotalEnergies",             ownership: "Investor-Owned", share_total_pct: 1.13, share_since_1988_pct: 1.10, primary_commodities: ["oil","gas"] },
  { slug: "eni-spa",                       name: "Eni",                       ownership: "Investor-Owned", share_total_pct: 0.66, share_since_1988_pct: 0.59, primary_commodities: ["oil","gas"] },
  { slug: "equinor-asa",                   name: "Equinor",                   ownership: "Investor-Owned", share_total_pct: 0.54, share_since_1988_pct: 0.74, primary_commodities: ["oil","gas"] },
  { slug: "peabody-energy",                name: "Peabody Energy",            ownership: "Investor-Owned", share_total_pct: 0.92, share_since_1988_pct: 0.86, primary_commodities: ["coal"] },
  { slug: "occidental-petroleum",          name: "Occidental Petroleum",      ownership: "Investor-Owned", share_total_pct: 0.51, share_since_1988_pct: 0.55, primary_commodities: ["oil","gas"] },
  { slug: "marathon-oil",                  name: "Marathon Oil",              ownership: "Investor-Owned", share_total_pct: 0.36, share_since_1988_pct: 0.32, primary_commodities: ["oil","gas"] },
  { slug: "hess",                          name: "Hess Corporation",          ownership: "Investor-Owned", share_total_pct: 0.22, share_since_1988_pct: 0.23, primary_commodities: ["oil","gas"] },
  { slug: "devon-energy",                  name: "Devon Energy",              ownership: "Investor-Owned", share_total_pct: 0.20, share_since_1988_pct: 0.27, primary_commodities: ["oil","gas"] },
  { slug: "eog-resources",                 name: "EOG Resources",             ownership: "Investor-Owned", share_total_pct: 0.20, share_since_1988_pct: 0.28, primary_commodities: ["oil","gas"] },
  { slug: "pioneer-natural-resources",     name: "Pioneer Natural Resources", ownership: "Investor-Owned", share_total_pct: 0.18, share_since_1988_pct: 0.27, primary_commodities: ["oil","gas"] },
  { slug: "arch-resources",                name: "Arch Resources",            ownership: "Investor-Owned", share_total_pct: 0.34, share_since_1988_pct: 0.42, primary_commodities: ["coal"] },
  { slug: "glencore-plc",                  name: "Glencore",                  ownership: "Investor-Owned", share_total_pct: 0.66, share_since_1988_pct: 1.01, primary_commodities: ["coal"] },
  { slug: "bhp-group",                     name: "BHP",                       ownership: "Investor-Owned", share_total_pct: 0.51, share_since_1988_pct: 0.65, primary_commodities: ["coal"] },
  { slug: "rio-tinto",                     name: "Rio Tinto",                 ownership: "Investor-Owned", share_total_pct: 0.49, share_since_1988_pct: 0.58, primary_commodities: ["coal"] },
  { slug: "marathon-petroleum",            name: "Marathon Petroleum",        ownership: "Investor-Owned", share_total_pct: 0.30, share_since_1988_pct: 0.45, primary_commodities: ["oil"] },
  { slug: "valero-energy",                 name: "Valero Energy",             ownership: "Investor-Owned", share_total_pct: 0.28, share_since_1988_pct: 0.42, primary_commodities: ["oil"] },
  { slug: "phillips-66",                   name: "Phillips 66",               ownership: "Investor-Owned", share_total_pct: 0.25, share_since_1988_pct: 0.38, primary_commodities: ["oil"] },
  // ── Top state-owned producers ──────────────────────────────────────
  { slug: "petrochina",                    name: "PetroChina (CNPC)",         ownership: "State-Owned",    share_total_pct: 3.03, share_since_1988_pct: 4.05, primary_commodities: ["oil","gas"] },
  { slug: "petrobras-petroleo-brasileiro-sa", name: "Petrobras",              ownership: "State-Owned",    share_total_pct: 0.95, share_since_1988_pct: 1.27, primary_commodities: ["oil","gas"] },
];

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  await fs.mkdir(RAW_DIR, { recursive: true });
  const out = {
    generated_at: new Date().toISOString(),
    source: "carbon-majors",
    source_url: "https://carbonmajors.org",
    license: "CC BY 4.0 — Climate Accountability Institute / InfluenceMap (Heede 2024).",
    mode: "fixture",
    row_count: CARBON_MAJORS.length,
    rows: CARBON_MAJORS,
  };
  const outPath = path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`carbon-majors: wrote ${CARBON_MAJORS.length} producers → ${outPath}`);
}
run().catch((e) => { console.error(e); process.exit(1); });
