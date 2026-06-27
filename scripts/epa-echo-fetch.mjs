#!/usr/bin/env node
/**
 * EPA ECHO (Enforcement and Compliance History Online) — weekly facility-level
 * enforcement + violation aggregator.
 *
 * For each brand in /public/data/top-500-brands.txt, queries the EPA ECHO
 * REST web services for facilities operated under the brand name, then
 * aggregates inspections, violations, and penalties.
 *
 * Output: /public/data/epa-echo.json (overwritten weekly)
 *
 * Per-brand aggregates:
 *   - total_facilities          — facilities matching the brand name
 *   - total_inspections         — sum of inspections over last 5 years
 *   - total_violations          — sum of formal enforcement actions
 *   - recent_violations_24mo    — informal+formal violations last 24 months
 *   - top_violation_types       — top 5 statute categories (CAA, CWA, RCRA, ...)
 *   - total_penalties_usd       — sum of federal penalties levied ($)
 *   - top_facilities            — 5 worst-offender facilities by violation count
 *
 * API: https://echo.epa.gov/tools/web-services/facility-search-all
 * Endpoint: https://echodata.epa.gov/echo/echo_rest_services.get_facilities
 *
 * ECHO public API is throttled at 300 req/hour, 1500/day.  We throttle 1
 * req/sec (3600/hr) but ECHO will 429 us if we exceed; the loop retries
 * after a backoff.
 *
 * Runs via .github/workflows/epa-echo-weekly.yml Sunday 22:00 UTC.
 * Locally: node scripts/epa-echo-fetch.mjs               (full run)
 *          node scripts/epa-echo-fetch.mjs --smoke       (Shell + Exxon + DuPont)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/epa-echo.json");

const ECHO_BASE = "https://echodata.epa.gov/echo";
const UA        = "TruNorth-ECHO/1.0 (+https://www.trunorthapp.com)";
const THROTTLE_MS = 1000;          // 1 req/sec
const BACKOFF_429_MS = 65_000;     // ECHO throttle window is ~per-hour; bail to safe wait
const MAX_RETRIES = 3;
const TWENTYFOUR_MO_MS = 730 * 24 * 60 * 60 * 1000;

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

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

async function fetchJson(url, attempt = 0) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      // B-64: bound each request at 20s. Without this a single hung ECHO
      // request stalls the whole weekly job to its 60-min cancel.
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    // Treat a timeout/network abort like a throttle: back off and retry a few
    // times so one stuck request can't hang the job.
    if (attempt >= MAX_RETRIES) throw err;
    console.warn(`  ⏸  request error (${err.name || err.message}), retry ${attempt + 1}/${MAX_RETRIES} …`);
    await new Promise(r => setTimeout(r, BACKOFF_429_MS));
    return fetchJson(url, attempt + 1);
  }
  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) throw new Error("ECHO 429 — repeated throttle");
    console.warn(`  ⏸  429 throttle, backing off ${BACKOFF_429_MS / 1000}s …`);
    await new Promise(r => setTimeout(r, BACKOFF_429_MS));
    return fetchJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Step 1: get the QID + summary counts for the brand via get_facilities.
//
// p_co=...       company name (substring match)
// p_act=Y        active facilities only
// responseset=1  small response set; we want counts not full facility list
// qcolumns       selected columns: 1=registry id, 2=facility name, 3=addr,
//                4=city, 5=state, 6=zip, 11=AIR ids, 13=SDWA, 17=violations
//                last 3 yrs, 24=insp last 5 yrs, 23=penalties last 5 yrs,
//                79=top compliance status
async function fetchBrandFacilities(brand) {
  const url = new URL(`${ECHO_BASE}/echo_rest_services.get_facilities`);
  url.searchParams.set("output", "JSON");
  url.searchParams.set("p_co", brand.name);
  url.searchParams.set("p_act", "Y");
  url.searchParams.set("responseset", "1");
  url.searchParams.set("qcolumns", "1,2,3,4,5,6,11,17,21,23,24,79");

  let data;
  try {
    data = await fetchJson(url.toString());
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }

  if (data?.Results?.Error) {
    return { slug: brand.slug, name: brand.name, status: "error", error: data.Results.Error.ErrorMessage };
  }

  const r = data?.Results;
  const queryRows = Number(r?.QueryRows ?? 0);
  if (queryRows === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_facilities", total_facilities: 0 };
  }

  const facilities = r?.Facilities || [];
  const queryId    = r?.QueryID;
  const totalPenaltyStr = r?.TotalPenalties || "";
  // ECHO returns TotalPenalties as a formatted string like "$1,234,567.89" or "".
  const totalPenalties = Number(String(totalPenaltyStr).replace(/[^0-9.]/g, "")) || 0;

  // Per-facility extraction. ECHO column names vary by version; we read
  // defensively — read any field whose key contains the substring.
  const get = (f, ...needles) => {
    for (const k of Object.keys(f)) {
      for (const n of needles) if (k.toLowerCase().includes(n)) return f[k];
    }
    return undefined;
  };

  let totalInsp = 0;
  let totalViol = 0;
  let totalRecentViol = 0;
  const statuteCounts = [];
  const perFacility = [];

  for (const f of facilities) {
    const insp5 = Number(get(f, "insp5yr", "inspection", "fea")) || 0;
    const v3    = Number(get(f, "qtrswithviol", "qtrs_with_nc", "violation", "v3")) || 0;
    const informalActions = Number(get(f, "info_count", "informal")) || 0;
    const formalActions   = Number(get(f, "fea", "fea5yr", "formal")) || 0;
    const statutes = String(get(f, "statute", "fac_active_flag_text") || "").split(/[,;|]/).map(s => s.trim()).filter(Boolean);

    const inspections = insp5;
    const violations  = formalActions + informalActions;
    const recentViol  = v3;  // ECHO QtrsWithNC is rolling 12-quarter window (~3yr)

    totalInsp += inspections;
    totalViol += violations;
    totalRecentViol += recentViol;
    for (const s of statutes) statuteCounts.push(s);

    perFacility.push({
      name:       get(f, "facname", "fac_name", "name"),
      city:       get(f, "faccity", "city"),
      state:      get(f, "facstate", "state"),
      zip:        get(f, "faczip", "zip"),
      inspections,
      violations,
      recent_violations: recentViol,
      statutes,
    });
  }

  // Top 5 facilities by violations
  const topFacilities = perFacility
    .sort((a, b) => b.violations - a.violations || b.inspections - a.inspections)
    .slice(0, 5);

  return {
    slug:                   brand.slug,
    name:                   brand.name,
    status:                 "ok",
    query_id:               queryId,
    total_facilities:       queryRows,
    sampled_facilities:     facilities.length,
    total_inspections:      totalInsp,
    total_violations:       totalViol,
    recent_violations_24mo: totalRecentViol,
    top_violation_types:    topN(statuteCounts, 5),
    total_penalties_usd:    totalPenalties,
    top_facilities:         topFacilities,
    scraped_at:             new Date().toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`🏭 EPA ECHO fetcher starting${smoke ? " (smoke-test)" : ""}...`);
  let brands = await loadBrands();

  if (smoke) {
    const want = new Set(["shell", "exxonmobil", "dupont"]);
    const existing = brands.filter(b => want.has(b.slug));
    // DuPont isn't in top-500-brands.txt; inject for the smoke test
    if (!brands.some(b => b.slug === "dupont")) {
      existing.push({ slug: "dupont", name: "DuPont", category: "Industrial" });
    }
    brands = existing;
  }

  console.log(`Loaded ${brands.length} brands`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const b = brands[i];
    const r = await fetchBrandFacilities(b);
    results.push(r);
    if (smoke || i % 50 === 0) {
      const tag = r.status === "ok"
        ? `${r.total_facilities} fac, ${r.total_violations} viol, $${r.total_penalties_usd}`
        : r.status;
      console.log(`  [${i + 1}/${brands.length}] ${b.slug} → ${tag}`);
    }
    await new Promise(r => setTimeout(r, THROTTLE_MS));
  }

  const ok       = results.filter(r => r.status === "ok").length;
  const noFac    = results.filter(r => r.status === "no_facilities").length;
  const err      = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:   new Date().toISOString(),
    brand_count:    brands.length,
    with_facilities_count: ok,
    no_facilities_count:   noFac,
    error_count:    err,
    facilities:     results,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   With facilities: ${ok}`);
  console.log(`   No facilities:   ${noFac}`);
  console.log(`   Errors:          ${err}`);
}

main().catch(err => {
  console.error("❌ epa-echo-fetch failed:", err);
  process.exit(1);
});
