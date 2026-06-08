#!/usr/bin/env node
/**
 * USDA Organic Integrity Database (OID) — National Organic Program.
 *
 * Every certified-organic operation in the US (and many international
 * operations certified by NOP-accredited certifiers) lives here.
 * ~45,000 operations as of 2026. Authoritative source for "is this
 * brand actually USDA-organic certified?"
 *
 * Source: https://organic.ams.usda.gov/integrity/
 *
 * Access:
 *   - Public search UI (no API key required).
 *   - Bulk export endpoint:
 *       https://organic.ams.usda.gov/integrity/api/operations/download
 *     returns a CSV of the entire dataset (~10-15 MB). The endpoint
 *     occasionally requires session bootstrapping for filter state.
 *   - For a future scaling step we may want to use the per-row JSON
 *     endpoint at /integrity/api/operations?searchTerm=...
 *
 * No API key required.
 *
 * Output: data/raw/usda-organic/<YYYY-MM-DD>.json
 *
 * Cadence: monthly.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/usda-organic");
const FIXTURE = path.join(ROOT, "test/fixtures/usda-organic/sample.csv");
// The OID download path is occasionally rotated; this is the current one
// as of 2026-06. If it 404s, we fall back to the fixture and surface a
// loud warning in CI.
const DOWNLOAD_URL = "https://organic.ams.usda.gov/integrity/api/operations/download";
const SOURCE_PAGE  = "https://organic.ams.usda.gov/integrity/";
const UA = "TruNorth-USDAOrganic/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

const VALID_STATUSES = new Set(["certified", "surrendered", "suspended", "revoked"]);

export function normalizeRow(r) {
  const name = r["Operation Name"] ?? r.operation_name ?? "";
  if (!name) return null;
  const status = String(r["Certification Status"] ?? r.status ?? "").trim().toLowerCase();
  const scopesRaw = r["Certified Scopes"] ?? r.scopes ?? "";
  const scopes = String(scopesRaw)
    .split(/[,;\/]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const productsRaw = r["Certified Products"] ?? r.products ?? "";
  return {
    nop_id: r["NOP Operation ID"] ?? r.nop_id ?? null,
    operation_name: String(name).trim(),
    certifier: r["Certifier"] ?? null,
    status: VALID_STATUSES.has(status) ? status : (status || null),
    operation_type: r["Certified Operation Type"] ?? null,
    scopes,
    country: r["Country"] ?? null,
    state: r["State"] ?? null,
    last_inspected: r["Last Inspected"] ?? null,
    certified_products: String(productsRaw)
      .split(/[,;]/).map(s => s.trim()).filter(Boolean),
  };
}

async function fetchLive() {
  // OID rotates session cookies for the download endpoint. We try the
  // bulk endpoint with a polite UA; on failure we fall back to the
  // fixture and warn. The maintainer can swap in a session-warmup step
  // (GET /integrity/ first to mint a JSESSIONID) if the public endpoint
  // is removed.
  const res = await fetch(DOWNLOAD_URL, {
    headers: { "User-Agent": UA, "Accept": "text/csv,application/json;q=0.9,*/*;q=0.8" },
    redirect: "follow",
  });
  if (!res.ok) {
    console.warn(`⚠️  USDA OID download returned HTTP ${res.status}; falling back to fixture.`);
    return null;
  }
  const ct = res.headers.get("content-type") || "";
  if (!/csv|text/i.test(ct)) {
    console.warn(`⚠️  USDA OID returned content-type=${ct}; expected CSV. Falling back to fixture.`);
    return null;
  }
  return await res.text();
}

async function main() {
  console.log(`USDA Organic fetcher (${APPLY ? "LIVE" : "DRY/fixture"})`);
  const text = APPLY ? (await fetchLive() ?? await fs.readFile(FIXTURE, "utf-8"))
                     : await fs.readFile(FIXTURE, "utf-8");
  let rows = parseCSVToObjects(text).map(normalizeRow).filter(Boolean);
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "usda-organic",
    source_url: SOURCE_PAGE,
    download_url: DOWNLOAD_URL,
    mode: APPLY ? "live" : "fixture",
    row_count: rows.length,
    rows,
  }, null, 2));
  console.log(`✅ Wrote ${outPath} — ${rows.length} operations`);

  const stats = rows.reduce((acc, r) => ((acc[r.status || "unknown"] = (acc[r.status || "unknown"] || 0) + 1), acc), {});
  console.log(`   By status: ${JSON.stringify(stats)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("usda-organic-fetch failed:", err);
    process.exit(1);
  });
}
