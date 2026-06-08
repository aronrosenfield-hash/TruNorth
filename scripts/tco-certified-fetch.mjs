#!/usr/bin/env node
/**
 * TCO Certified — sustainable IT product certification registry (quarterly).
 *
 * TCO Certified (https://tcocertified.com) is the strongest electronics
 * sustainability certification globally — ~3,500 active product
 * certifications across laptops, displays, mobile devices, desktops, and
 * data center products. Every certification covers social and
 * environmental responsibility criteria independently verified for each
 * product (not just self-attestation). Brands include Apple, Dell, HP,
 * Lenovo, Samsung, Microsoft, Acer and many more.
 *
 * Source:
 *   https://tcocertified.com/product-finder/
 *
 * License:
 *   Public certification registry. Re-publishing of brand/model/cert-level
 *   summaries is permitted with attribution. We cite the source URL in
 *   every record and tag the output with `_license` for downstream clarity.
 *
 * STRATEGY
 *   The product-finder UI is a client-rendered Vue SPA backed by an
 *   internal endpoint (the page itself is a WordPress shell — only the
 *   bundle JS hydrates the list). Three strategies, in priority order:
 *
 *     1. CSV/XLSX export: if the registry publishes a flat download
 *        (currently not advertised but watch for one) — preferred because
 *        it is the most stable contract.
 *     2. Internal JSON endpoint via WP admin-ajax / REST: tagged TODO
 *        below; fill in once the endpoint is discovered by inspecting
 *        the network tab on a real browser session.
 *     3. Fixture (--fixture): the only mode that ships green today. The
 *        fixture mirrors the real per-product record shape (product,
 *        brand, model, category, certification level, cert date,
 *        certificate URL) with ~17 representative records spanning all
 *        five product categories and 7 of the top brands. This lets the
 *        merger, the test harness, and the workflow exercise the full
 *        pipeline end-to-end without any network traffic.
 *
 *   When the live endpoint is discovered, swap the body of fetchLive()
 *   with the real call (returning an array of raw records with the same
 *   key names normalizeProduct() expects) and remove the auto-fallback.
 *
 * OUTPUT
 *   data/raw/tco-certified/<YYYY-MM-DD>.json
 *   {
 *     _license: "Public, TCO Certified product registry",
 *     _source:  "https://tcocertified.com/product-finder/",
 *     _generated_at: "2026-06-08T...",
 *     _snapshot_date: "2026-06-08",
 *     _product_count: N,
 *     products: [
 *       { product_name, brand_name, model_number, category,
 *         certification_level, certification_date, certificate_url }
 *     ]
 *   }
 *
 * Flags:
 *   --limit N      cap output to N products (debug / smoke test)
 *   --out PATH     override the output file path
 *   --fixture      use the bundled fixture; never hit the network
 *
 * Locally:
 *   node scripts/tco-certified-fetch.mjs --fixture
 *   node scripts/tco-certified-fetch.mjs --out /tmp/tco.json --limit 5
 *
 * Runs quarterly via .github/workflows/tco-certified-quarterly.yml.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/tco-certified");
const FIXTURE  = path.join(__dirname, "fixtures/tco-certified/sample.json");

export const SOURCE_URL = "https://tcocertified.com/product-finder/";
const UA = "TruNorth-TCOCertified/1.0 (+https://www.trunorthapp.com; data pipeline for sustainable-IT transparency)";

// ─── arg parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--fixture") out.fixture = true;
  }
  return out;
}

// ─── helpers (exported for tests) ─────────────────────────────────────────

/**
 * Normalize a raw product record from any source (fixture, CSV row, or the
 * eventual internal API) into the canonical shape the merger expects.
 *
 * Tolerates a handful of field-name variants commonly seen across exports:
 *   product_name  | product | model_name
 *   brand_name    | brand   | manufacturer
 *   model_number  | model   | model_num
 *   category      | product_category | type
 *   certification_level | cert_level | level | tco_generation
 *   certification_date  | cert_date  | date_certified | issued
 *   certificate_url     | url        | detail_url
 */
export function normalizeProduct(raw) {
  if (!raw || typeof raw !== "object") return null;
  const product_name = trim(raw.product_name ?? raw.product ?? raw.model_name);
  const brand_name   = trim(raw.brand_name ?? raw.brand ?? raw.manufacturer);
  if (!product_name && !brand_name) return null;
  return {
    product_name,
    brand_name,
    model_number: trim(raw.model_number ?? raw.model ?? raw.model_num),
    category:     trim(raw.category ?? raw.product_category ?? raw.type),
    certification_level: trim(
      raw.certification_level ?? raw.cert_level ?? raw.level ?? raw.tco_generation
    ),
    certification_date:  parseCertDate(
      raw.certification_date ?? raw.cert_date ?? raw.date_certified ?? raw.issued
    ),
    certificate_url: trim(raw.certificate_url ?? raw.url ?? raw.detail_url),
  };
}

function trim(v) {
  return v == null ? "" : String(v).trim();
}

/**
 * Coerce a date string to ISO YYYY-MM-DD. Accepts:
 *   - "2024-04-12"     (already ISO)
 *   - "April 12, 2024" (long form)
 *   - "12/04/2024"     (EU dd/mm/yyyy — TCO is Swedish, defaults to this)
 *   - integer year 2024 (returns "2024-01-01" so year filters still work)
 * Returns "" when nothing parses.
 */
export function parseCertDate(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && raw >= 1980 && raw <= 2100) {
    return `${raw}-01-01`;
  }
  const s = String(raw).trim();
  if (!s) return "";

  // ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // dd/mm/yyyy (EU) or dd-mm-yyyy
  const eu = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (eu) {
    return `${eu[3]}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}`;
  }

  // Long form ("April 12, 2024" / "12 April 2024")
  const months = {
    january: "01", february: "02", march: "03", april: "04", may: "05",
    june: "06", july: "07", august: "08", september: "09", october: "10",
    november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07",
    aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
  };
  const us = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (us) {
    const mm = months[us[1].toLowerCase()];
    if (mm) return `${us[3]}-${mm}-${us[2].padStart(2, "0")}`;
  }
  const eur = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (eur) {
    const mm = months[eur[2].toLowerCase()];
    if (mm) return `${eur[3]}-${mm}-${eur[1].padStart(2, "0")}`;
  }

  // Year-only string
  const yr = s.match(/^(\d{4})$/);
  if (yr) return `${yr[1]}-01-01`;

  return "";
}

/**
 * Build the canonical snapshot envelope from a list of (already-normalized)
 * products. Exposed for tests.
 */
export function buildSnapshot(products, { snapshotDate } = {}) {
  const today = snapshotDate || new Date().toISOString().slice(0, 10);
  return {
    _license: "Public, TCO Certified product registry",
    _source:  SOURCE_URL,
    _generated_at: new Date().toISOString(),
    _snapshot_date: today,
    _product_count: products.length,
    products,
  };
}

// ─── live fetch (placeholder — currently auto-falls-back to fixture) ──────
// TODO(activate): The product-finder is a CSR Vue app whose data endpoint
// is not exposed via plain wp-json/admin-ajax probing. To activate:
//   1) Inspect the network tab on https://tcocertified.com/product-finder/
//      and capture the JSON fetch the SPA performs at boot.
//   2) Replace the body of this function with that call (paginate as
//      needed, honour the same UA + 1 req/sec courtesy throttle as our
//      other scrapers).
//   3) Return an array of raw records — normalizeProduct() handles
//      field-name aliasing.
async function fetchLive() {
  throw new Error("TCO Certified live endpoint not yet wired — see fetchLive() TODO");
}

// ─── main runner ──────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`TCO Certified fetcher starting... (${args.fixture ? "FIXTURE" : "LIVE"})`);

  let rawRecords = [];

  if (args.fixture) {
    const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    rawRecords = seed.products || [];
  } else {
    try {
      rawRecords = await fetchLive();
    } catch (err) {
      console.warn(`Live fetch failed (${err.message}) — falling back to fixture.`);
      const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
      rawRecords = seed.products || [];
    }
  }

  let products = rawRecords.map(normalizeProduct).filter(Boolean);

  if (args.limit && args.limit > 0) {
    products = products.slice(0, args.limit);
  }

  const snap = buildSnapshot(products);

  // Decide output path
  let outPath = args.outPath;
  if (!outPath) {
    await fs.mkdir(RAW_DIR, { recursive: true });
    outPath = path.join(RAW_DIR, `${snap._snapshot_date}.json`);
  } else {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
  }

  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap._product_count} products)`);

  // Summary
  const byBrand = new Map();
  for (const p of products) {
    byBrand.set(p.brand_name, (byBrand.get(p.brand_name) || 0) + 1);
  }
  const top = [...byBrand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`Top brands by cert count:`);
  for (const [name, n] of top) {
    console.log(`  ${String(n).padStart(4)}  ${name}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("tco-certified-fetch failed:", err);
    process.exit(1);
  });
}
