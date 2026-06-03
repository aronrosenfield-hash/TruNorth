#!/usr/bin/env node
/**
 * CPSC Consumer Product Safety Commission — Recalls (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the CPSC
 * SaferProducts REST API for product recalls naming that brand.
 *
 * Output: /public/data/cpsc-recalls.json (overwritten weekly)
 *
 * The CPSC database is the authoritative US source for consumer product
 * recalls (excluding cars/food/drugs). For brands with no recalls we
 * record status="no_recalls"; the merger skips them.
 *
 * API: https://www.saferproducts.gov/RestWebServices/Recall
 * Docs: https://www.cpsc.gov/Recalls (CSV mirror)
 *
 * Per-brand aggregates:
 *   - total_recalls         — all-time count of recalls naming the brand
 *   - recent_24mo_count     — last 24 months
 *   - top_hazards           — top 5 hazard summaries
 *   - sample_recalls        — last 5 recalls (most recent first)
 *
 * Runs via .github/workflows/cpsc-weekly.yml Sunday 20:00 UTC.
 * Locally: node scripts/cpsc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/cpsc-recalls.json");

const CPSC_BASE = "https://www.saferproducts.gov/RestWebServices/Recall";
const UA = "TruNorth-CPSC/1.0 (+https://www.trunorthapp.com)";
const TWENTY_FOUR_MONTHS_MS = 730 * 24 * 60 * 60 * 1000;

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

// Truncate a long hazard string to keep aggregates small.
function trim(s, max = 240) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Query CPSC for recalls naming this brand. CPSC supports filters on
// Manufacturer, RecallTitle, ProductName, and more. Manufacturer alone
// misses many distributor/retailer recalls; RecallTitle alone is too
// permissive. We OR both queries and de-dup by RecallID.
async function queryCpsc(params) {
  const qs = new URLSearchParams({ format: "json", ...params });
  const url = `${CPSC_BASE}?${qs}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.code = res.status;
    throw err;
  }
  const text = await res.text();
  if (!text) return [];
  let data;
  try { data = JSON.parse(text); }
  catch { return []; }
  if (!Array.isArray(data)) return [];
  return data;
}

async function fetchBrandRecalls(brand) {
  let recalls;
  try {
    const [byMfr, byTitle] = await Promise.all([
      queryCpsc({ Manufacturer: brand.name }),
      queryCpsc({ RecallTitle: brand.name }),
    ]);
    const merged = new Map();
    for (const r of [...byMfr, ...byTitle]) {
      if (r && r.RecallID != null) merged.set(r.RecallID, r);
    }
    recalls = [...merged.values()];
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message, code: err.code };
  }

  if (recalls.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_recalls", total_recalls: 0 };
  }

  // Sort newest first
  recalls.sort((a, b) => {
    const ta = Date.parse(a.RecallDate || a.LastPublishDate || 0);
    const tb = Date.parse(b.RecallDate || b.LastPublishDate || 0);
    return tb - ta;
  });

  const cutoff = Date.now() - TWENTY_FOUR_MONTHS_MS;
  const recent24mo = recalls.filter(r => {
    const t = Date.parse(r.RecallDate || r.LastPublishDate || 0);
    return !Number.isNaN(t) && t > cutoff;
  });

  const hazards = recalls
    .flatMap(r => (r.Hazards || []).map(h => trim(h.Name, 160)))
    .filter(Boolean);

  return {
    slug:                brand.slug,
    name:                brand.name,
    status:              "ok",
    total_recalls:       recalls.length,
    recent_24mo_count:   recent24mo.length,
    top_hazards:         topN(hazards, 5),
    sample_recalls:      recalls.slice(0, 5).map(r => ({
      recall_id:     r.RecallID,
      recall_number: r.RecallNumber,
      recall_date:   r.RecallDate,
      title:         trim(r.Title, 240),
      description:   trim(r.Description, 320),
      url:           r.URL,
      hazards:       (r.Hazards || []).map(h => trim(h.Name, 160)).filter(Boolean),
      injuries:      (r.Injuries || []).map(i => trim(i.Name, 200)).filter(Boolean),
      products:      (r.Products || []).map(p => trim(p.Name, 120)).filter(Boolean),
      units:         (r.Products || []).map(p => p.NumberOfUnits).filter(Boolean),
      remedies:      (r.RemedyOptions || []).map(o => o.Option).filter(Boolean),
    })),
    scraped_at:          new Date().toISOString(),
  };
}

async function main() {
  console.log("CPSC recall fetcher starting...");
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  // CPSC has no documented rate limit; courtesy: 1 req/sec.
  // We make 2 requests per brand (Manufacturer + RecallTitle) issued in
  // parallel, so wall-clock cost ~1 sec per brand → ~9 min for 528.
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandRecalls(brands[i]);
    results.push(r);
    if (i % 50 === 0) console.log(`  ...${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const withRecalls   = results.filter(r => r.status === "ok").length;
  const noRecalls     = results.filter(r => r.status === "no_recalls").length;
  const err           = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:           new Date().toISOString(),
    brand_count:            brands.length,
    with_recalls_count:     withRecalls,
    no_recalls_count:       noRecalls,
    error_count:            err,
    recalls:                results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With recalls:    ${withRecalls}`);
  console.log(`   No recalls:      ${noRecalls}`);
  console.log(`   Errors:          ${err}`);
}

main().catch(err => {
  console.error("cpsc-fetch failed:", err);
  process.exit(1);
});
