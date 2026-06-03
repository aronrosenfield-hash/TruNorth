#!/usr/bin/env node
/**
 * FAA Safety Data (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries FAA public
 * sources for safety data relevant to aircraft and aerospace manufacturers:
 *
 *   1. Service Difficulty Reports (SDRs)  — av-info.faa.gov/sdrx
 *   2. Airworthiness Directives (ADs)     — drs.faa.gov/browse/AD
 *   3. Accident / Incident Data           — asias.faa.gov
 *
 * Output: /public/data/faa-safety.json (overwritten weekly)
 *
 * Per-brand aggregates (rolling 5-year window):
 *   - total_SDRs_5y
 *   - total_ADs_5y
 *   - fatal_accidents_5y
 *   - sample            (5 most recent records, mixed sources)
 *
 * Most brands in top-500-brands.txt are NOT aircraft manufacturers and
 * will yield zero hits. That's expected — the merger skips them, same as
 * cfpb-merge.mjs skips non-financial brands.
 *
 * IMPORTANT — endpoint stability:
 *   The FAA sources above expose web UIs, not clean JSON APIs. We use the
 *   best-known query endpoints (FAA DRS search API + ASIAS aircraft-make
 *   search + SDR CSV export) and fall back to `status: "not_available"`
 *   when an endpoint is blocked, 503s, or returns nothing parseable. The
 *   fetcher never throws on a single brand — it always writes a result.
 *
 * Smoke-test (CLI):
 *   node scripts/faa-fetch.mjs --smoke
 *     → only runs boeing, airbus, ge-aviation, pratt-whitney
 *
 * Full weekly run via .github/workflows/faa-weekly.yml Monday 07:00 UTC.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/faa-safety.json");

const UA = "TruNorth-FAA/1.0 (+https://www.trunorthapp.com)";
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const REQ_DELAY_MS = 1000; // 1 req/sec courtesy throttle

// Known FAA endpoints. These are the public-facing entry points that the
// human-facing search UIs hit. They may move or rate-limit — we degrade
// gracefully when they do.
const FAA = {
  drsBase:  "https://drs.faa.gov",                 // Dynamic Regulatory System (ADs)
  sdrBase:  "https://av-info.faa.gov/sdrx",        // SDR query system
  asiasBase:"https://www.asias.faa.gov",           // Accident & incident data
};

// Smoke-test allowlist. When --smoke is passed, only these brands run —
// they are confirmed aircraft / aerospace manufacturers so they have the
// best chance of returning real records.
const SMOKE_SLUGS = new Set([
  "boeing",
  "airbus",
  "ge-aviation",
  "pratt-whitney",
]);

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name, category] = l.split("|").map(s => s.trim());
      return { slug, name, category };
    })
    .filter(b => b.slug && b.name);
}

async function safeFetchJSON(url, { timeoutMs = 15_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json,text/plain,*/*" },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, code: res.status };
    const text = await res.text();
    try { return { ok: true, data: JSON.parse(text) }; }
    catch { return { ok: true, data: null, raw: text }; }
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

// --- Airworthiness Directives -----------------------------------------------
// DRS exposes a public search at https://drs.faa.gov/browse/AD that hits
// an internal Elasticsearch-style endpoint. We try the documented JSON
// search; on failure we report 0 (not an error) so the rest of the row
// is still written.
async function fetchADs(brand, sinceISO) {
  const q = encodeURIComponent(brand.name);
  const url = `${FAA.drsBase}/api/v1/search?type=AD&q=${q}&issuedSince=${encodeURIComponent(sinceISO)}&pageSize=50`;
  const r = await safeFetchJSON(url);
  if (!r.ok || !r.data) return { count: 0, sample: [], status: r.ok ? "no_data" : "endpoint_error" };

  const items = Array.isArray(r.data?.results) ? r.data.results : [];
  return {
    count: r.data?.total ?? items.length,
    sample: items.slice(0, 5).map(it => ({
      type:        "AD",
      doc_number:  it.documentNumber || it.id || null,
      title:       it.title || it.summary || null,
      issued_date: it.issuedDate || it.publishedDate || null,
      url:         it.documentNumber ? `${FAA.drsBase}/browse/excelExternalWindow/${it.documentNumber}` : null,
    })),
    status: "ok",
  };
}

// --- Service Difficulty Reports --------------------------------------------
// SDRX exposes a CSV export for queries by manufacturer. We attempt the
// CSV endpoint that the UI uses behind the scenes.
async function fetchSDRs(brand, sinceISO) {
  const q = encodeURIComponent(brand.name);
  const url = `${FAA.sdrBase}/api/sdrs?manufacturer=${q}&dateFrom=${sinceISO.slice(0,10)}&format=json&limit=50`;
  const r = await safeFetchJSON(url);
  if (!r.ok || !r.data) return { count: 0, sample: [], status: r.ok ? "no_data" : "endpoint_error" };

  const items = Array.isArray(r.data?.records) ? r.data.records
              : Array.isArray(r.data)          ? r.data
              : [];
  return {
    count: r.data?.totalCount ?? items.length,
    sample: items.slice(0, 5).map(it => ({
      type:        "SDR",
      control_no:  it.controlNumber || it.id || null,
      ata_code:    it.ataCode || null,
      part_name:   it.partName || it.componentName || null,
      problem:     it.problemDescription || it.discrepancy || null,
      report_date: it.reportDate || it.submissionDate || null,
    })),
    status: "ok",
  };
}

// --- Accident / Incident Data (ASIAS) --------------------------------------
// ASIAS public search by aircraft make. We pull total + fatal in the
// 5-year window.
async function fetchAccidents(brand, sinceISO) {
  const q = encodeURIComponent(brand.name);
  const url = `${FAA.asiasBase}/apex/f?p=100:96:::NO::P96_MAKE,P96_FROM_DATE:${q},${sinceISO.slice(0,10)}&format=json`;
  const r = await safeFetchJSON(url);
  if (!r.ok || !r.data) return { total: 0, fatal: 0, sample: [], status: r.ok ? "no_data" : "endpoint_error" };

  const items = Array.isArray(r.data?.events) ? r.data.events
              : Array.isArray(r.data)         ? r.data
              : [];
  const fatal = items.filter(e => Number(e.fatalities ?? e.fatalCount ?? 0) > 0).length;
  return {
    total: r.data?.totalCount ?? items.length,
    fatal,
    sample: items.slice(0, 5).map(e => ({
      type:        "Accident",
      event_id:    e.eventId || e.id || null,
      event_date:  e.eventDate || e.date || null,
      location:    e.location || null,
      severity:    e.severity || (Number(e.fatalities ?? 0) > 0 ? "fatal" : "non-fatal"),
      fatalities:  Number(e.fatalities ?? e.fatalCount ?? 0),
      summary:     e.narrative || e.summary || null,
    })),
    status: "ok",
  };
}

async function fetchBrand(brand, sinceISO) {
  const ads       = await fetchADs(brand, sinceISO);
  const sdrs      = await fetchSDRs(brand, sinceISO);
  const accidents = await fetchAccidents(brand, sinceISO);

  const anyOk = ads.status === "ok" || sdrs.status === "ok" || accidents.status === "ok";
  const anyData = (ads.count + sdrs.count + accidents.total) > 0;

  // Merge & sort samples by date descending, keep top 5.
  const sample = [...ads.sample, ...sdrs.sample, ...accidents.sample]
    .map(s => ({
      ...s,
      _sort: Date.parse(s.issued_date || s.report_date || s.event_date || "") || 0,
    }))
    .sort((a, b) => b._sort - a._sort)
    .slice(0, 5)
    .map(({ _sort, ...rest }) => rest);

  return {
    slug:               brand.slug,
    name:               brand.name,
    category:           brand.category,
    status:             !anyOk ? "not_available" : anyData ? "ok" : "no_records",
    total_SDRs_5y:      sdrs.count,
    total_ADs_5y:       ads.count,
    fatal_accidents_5y: accidents.fatal,
    total_accidents_5y: accidents.total,
    sample,
    source_status: {
      ads:       ads.status,
      sdrs:      sdrs.status,
      accidents: accidents.status,
    },
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`FAA fetcher starting${smoke ? " (smoke test)" : ""}...`);

  let brands = await loadBrands();
  if (smoke) brands = brands.filter(b => SMOKE_SLUGS.has(b.slug));
  console.log(`Loaded ${brands.length} brand(s)`);

  // If smoke test specified slugs aren't present in the brands file,
  // synthesize them so the smoke test still exercises every code path.
  if (smoke) {
    const have = new Set(brands.map(b => b.slug));
    const fallbacks = [
      { slug: "boeing",         name: "Boeing",                category: "Aerospace" },
      { slug: "airbus",         name: "Airbus",                category: "Aerospace" },
      { slug: "ge-aviation",    name: "GE Aviation",           category: "Aerospace" },
      { slug: "pratt-whitney",  name: "Pratt & Whitney",       category: "Aerospace" },
    ];
    for (const fb of fallbacks) if (!have.has(fb.slug)) brands.push(fb);
    console.log(`Smoke set: ${brands.map(b => b.slug).join(", ")}`);
  }

  const sinceISO = new Date(Date.now() - FIVE_YEARS_MS).toISOString();

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    try {
      results.push(await fetchBrand(brands[i], sinceISO));
    } catch (err) {
      results.push({
        slug: brands[i].slug,
        name: brands[i].name,
        status: "error",
        error: err.message,
      });
    }
    if (i % 50 === 0 && !smoke) console.log(`  ...${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, REQ_DELAY_MS));
  }

  const withRecords  = results.filter(r => r.status === "ok").length;
  const noRecords    = results.filter(r => r.status === "no_records").length;
  const notAvailable = results.filter(r => r.status === "not_available").length;
  const errors       = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:      new Date().toISOString(),
    window_years:      5,
    brand_count:       brands.length,
    with_records:      withRecords,
    no_records:        noRecords,
    not_available:     notAvailable,
    error_count:       errors,
    smoke:             smoke,
    brands:            results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With records:  ${withRecords}`);
  console.log(`   No records:    ${noRecords}`);
  console.log(`   Not available: ${notAvailable}`);
  console.log(`   Errors:        ${errors}`);
}

main().catch(err => {
  console.error("faa-fetch failed:", err);
  process.exit(1);
});
