#!/usr/bin/env node
/**
 * DW-11 — Energy Star certified buildings + products — quarterly.
 *
 * DOE/EPA's Energy Star program publishes:
 *   - Certified Buildings (XLSX, ~50k records):
 *       https://www.energystar.gov/buildings/tools-and-resources/energy-star-certified-buildings
 *   - Certified Products via the Product Finder JSON API (75k+ products):
 *       https://data.energystar.gov/resource/{dataset}.json
 *       (Socrata Open Data API — no auth required for read-only access,
 *       but a free API key can be passed in the X-App-Token header to
 *       lift the 1,000 req/hr anonymous limit.)
 *
 *       export ENERGY_STAR_APP_TOKEN=... # free at https://opendata.socrata.com/signup
 *
 * For this scaffolded pipeline we read the bundled fixture by default — it
 * mirrors the shape of the merged buildings + products feed. Production
 * use would call the Socrata API page-by-page (1,000 rows per page).
 *
 * Output:
 *   data/raw/energy-star/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N
 *   --out PATH
 *   --fixture
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/energy-star");
const FIXTURE = path.join(__dirname, "fixtures/energy-star/sample.json");

// Socrata datasets — IDs are stable but the canonical list lives here:
//   https://data.energystar.gov/browse?limitTo=datasets
// "Certified Products" is split per category (refrigerators, computers,
// etc.). For the scaffolded version we expose ONE generic products dataset
// and let prod swap in the per-category list at activation time.
export const PRODUCTS_URL =
  "https://data.energystar.gov/resource/j7nq-iepp.json"; // example: ES certified computers
export const BUILDINGS_URL =
  "https://www.energystar.gov/buildings/tools-and-resources/energy-star-certified-buildings";

const APP_TOKEN = process.env.ENERGY_STAR_APP_TOKEN; // optional, free key
const UA = "TruNorth-EnergyStar/1.0 (+https://www.trunorthapp.com)";

export function normalizeBuilding(b) {
  return {
    kind: "building",
    name: (b.building_name || b.property_name || "").trim(),
    owner_company: (b.owner_company || b.owner || "").trim(),
    certification_year: toInt(b.certification_year || b.certificate_year),
    city: b.city || "",
    state: b.state || "",
    score: toInt(b.score || b.energy_star_score),
  };
}

export function normalizeProduct(p) {
  return {
    kind: "product",
    name: (p.product_name || p.model_name || "").trim(),
    brand_name: (p.brand_name || p.manufacturer || "").trim(),
    category: (p.category || p.product_category || "").trim(),
    certification_year: toInt(p.certification_year || p.year_certified),
    model_number: (p.model_number || p.model_num || "").trim(),
  };
}

function toInt(v) {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

export function buildSnapshot(buildings, products) {
  return {
    source: "energy-star",
    source_url: BUILDINGS_URL,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    building_count: buildings.length,
    product_count: products.length,
    buildings,
    products,
  };
}

async function fetchSocrata(url) {
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  if (APP_TOKEN) headers["X-App-Token"] = APP_TOKEN;
  const res = await fetch(url + "?$limit=1000", { headers });
  if (!res.ok) throw new Error(`Energy Star ${res.status} ${res.statusText}`);
  return res.json();
}

function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--fixture") out.fixture = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Energy Star fetcher starting... (${args.fixture ? "FIXTURE" : "LIVE"})`);

  let buildings = [];
  let products = [];

  if (args.fixture) {
    const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    buildings = (seed.buildings || []).map(normalizeBuilding);
    products = (seed.products || []).map(normalizeProduct);
  } else {
    // The buildings list is XLSX-only and we deliberately don't pull in
    // a spreadsheet parser for the scaffolded pipeline — production will
    // re-encode it as JSON in a separate ETL step. For now, we hit only
    // the Socrata products endpoint live.
    try {
      const rows = await fetchSocrata(PRODUCTS_URL);
      products = rows.map(normalizeProduct);
    } catch (err) {
      console.warn(`Live products fetch failed (${err.message}) — falling back to fixture.`);
      const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
      buildings = (seed.buildings || []).map(normalizeBuilding);
      products = (seed.products || []).map(normalizeProduct);
    }
  }

  if (args.limit && args.limit > 0) {
    buildings = buildings.slice(0, args.limit);
    products = products.slice(0, args.limit);
  }

  const snap = buildSnapshot(buildings, products);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap.building_count} buildings, ${snap.product_count} products)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("energy-star-fetch failed:", err);
    process.exit(1);
  });
}
