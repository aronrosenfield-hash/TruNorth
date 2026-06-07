#!/usr/bin/env node
/**
 * USDA Organic — Merge step.
 *
 * Reads latest data/raw/usda-organic/<date>.json and writes
 * data/derived/usda-organic-augment.json. Operations are deduplicated
 * by normalized company name; if a brand has multiple operations
 * (common — e.g. a regional dairy with 8 farms), we collapse to a
 * single record keyed by the brand name with merged scopes/products
 * and pick "certified" over "surrendered"/"suspended".
 *
 * Per-company shape:
 *   {
 *     display_name, certifier, status,
 *     operation_count: number,
 *     scopes: [unique merged across operations],
 *     certified_products: [unique merged across operations],
 *     countries: [...],
 *     last_inspected_max: "YYYY-MM-DD",
 *     hasUsdaOrganicCertification: boolean,   // status === "certified"
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/usda-organic");
const OUT_DEFAULT = path.join(ROOT, "data/derived/usda-organic-augment.json");

const args = process.argv.slice(2);
const IN_OVERRIDE = (() => { const i = args.indexOf("--in"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

const STATUS_RANK = { certified: 3, surrendered: 2, suspended: 1, revoked: 0 };

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) throw new Error(`Missing ${RAW_DIR}`);
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

/**
 * Merge a single operation row into an accumulator entry for its
 * brand. Idempotent — calling with the same row twice has no effect.
 */
export function mergeIntoEntry(entry, row) {
  if (!entry) {
    entry = {
      display_name: row.operation_name,
      certifier: row.certifier,
      status: row.status,
      operation_count: 0,
      scopes: new Set(),
      certified_products: new Set(),
      countries: new Set(),
      last_inspected_max: null,
    };
  }
  entry.operation_count++;
  for (const s of row.scopes || []) entry.scopes.add(s);
  for (const p of row.certified_products || []) entry.certified_products.add(p);
  if (row.country) entry.countries.add(row.country);
  // Pick the best status — "certified" beats anything else.
  const newRank = STATUS_RANK[row.status] ?? -1;
  const oldRank = STATUS_RANK[entry.status] ?? -1;
  if (newRank > oldRank) {
    entry.status = row.status;
    entry.certifier = row.certifier;
  }
  if (row.last_inspected) {
    const d = row.last_inspected;
    if (!entry.last_inspected_max || d > entry.last_inspected_max) {
      entry.last_inspected_max = d;
    }
  }
  return entry;
}

export function finalizeEntry(entry) {
  return {
    display_name: entry.display_name,
    certifier: entry.certifier,
    status: entry.status,
    operation_count: entry.operation_count,
    scopes: [...entry.scopes],
    certified_products: [...entry.certified_products],
    countries: [...entry.countries],
    last_inspected_max: entry.last_inspected_max,
    hasUsdaOrganicCertification: entry.status === "certified",
  };
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`USDA Organic merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];

  const accum = new Map();
  for (const r of rows) {
    const key = toSlug(r.operation_name);
    if (!key) continue;
    accum.set(key, mergeIntoEntry(accum.get(key), r));
  }

  const companies = {};
  for (const [k, v] of accum) companies[k] = finalizeEntry(v);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "usda-organic",
    source_url: "https://organic.ams.usda.gov/integrity/",
    upstream_file: path.relative(ROOT, inFile),
    company_count: Object.keys(companies).length,
    companies,
  }, null, 2));

  const certifiedCount = Object.values(companies).filter(c => c.hasUsdaOrganicCertification).length;
  console.log(`✅ Wrote ${outFile} — ${Object.keys(companies).length} brands (${certifiedCount} actively certified)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("usda-organic-merge failed:", err);
    process.exit(1);
  });
}
