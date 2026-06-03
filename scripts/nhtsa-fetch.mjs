#!/usr/bin/env node
/**
 * NHTSA vehicle complaints + recalls (weekly)
 *
 * For each Automotive brand in /public/data/top-500-brands.txt, queries the
 * NHTSA public API for:
 *   - Recalls (last 5 model years)
 *   - Complaints (last 5 model years)
 *
 * The NHTSA "investigations" endpoint at api.nhtsa.gov/investigations/...
 * returns "Missing Authentication Token" for public callers — confirmed
 * via curl 2026-06-03. Open investigations are therefore left at 0 with
 * a note in the output. Recalls + complaints are wide open and free.
 *
 * Recalls + complaints both need a (make, model, modelYear) tuple, so we
 * first list models for each (make, year) via the products endpoint and
 * then iterate. We aggregate to the brand level.
 *
 * Output: /public/data/nhtsa-auto.json (overwritten weekly).
 *
 * Per-brand aggregates:
 *   - total_recalls               — across last 5 model years
 *   - total_complaints            — across last 5 model years
 *   - open_investigations_count   — always 0 + note (endpoint gated)
 *   - top_issues                  — top 5 components (recall + complaint)
 *   - most_recent_recall_date     — YYYY-MM-DD
 *   - sample_recent_recalls       — 5 most recent
 *
 * Throttled to ~1 req/sec to be a good citizen. Auto brands × 5 years
 * × ~30 models avg × 2 endpoints ≈ a few thousand requests; budget ~60 min.
 *
 * Runs via .github/workflows/nhtsa-weekly.yml Sunday 19:00 UTC.
 * Locally:  node scripts/nhtsa-fetch.mjs
 *           node scripts/nhtsa-fetch.mjs --brands=ford,tesla,toyota   (smoke test)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/nhtsa-auto.json");

const UA = "TruNorth-NHTSA/1.0 (+https://www.trunorthapp.com)";
const NHTSA_BASE = "https://api.nhtsa.gov";
const THROTTLE_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [0, 1, 2, 3, 4].map(i => CURRENT_YEAR - i); // last 5 model years

// CLI flag: --brands=slug1,slug2  (smoke test)
const cli = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);
const BRAND_FILTER = cli.brands ? new Set(String(cli.brands).split(",").map(s => s.trim().toLowerCase())) : null;

// Brand display name -> NHTSA "make" name. Most map by uppercasing the
// display name; the exceptions are listed explicitly.
const NHTSA_MAKE_OVERRIDES = {
  "Mercedes-Benz":  "MERCEDES-BENZ",
  "Lucid Motors":   "LUCID",
  "General Motors": null,        // GM doesn't sell under "General Motors"; its brands (Chevy, GMC, ...) cover it
  "Stellantis":     null,        // same; Stellantis brands (Jeep, Ram, ...) cover it
  "Mitsubishi":     "MITSUBISHI MOTORS NORTH AMERICA",  // appears under this name in NHTSA's make list
};

function makeForBrand(brand) {
  if (Object.prototype.hasOwnProperty.call(NHTSA_MAKE_OVERRIDES, brand.name)) {
    return NHTSA_MAKE_OVERRIDES[brand.name];
  }
  return brand.name.toUpperCase();
}

async function loadAutoBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name, category] = l.split("|").map(s => s?.trim());
      return { slug, name, category };
    })
    .filter(b => b.slug && b.name && b.category && /auto/i.test(b.category));
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

async function httpGet(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// NHTSA dates come back as "DD/MM/YYYY" (sometimes "MM/DD/YYYY" depending
// on locale of the underlying record). We parse defensively and return
// an ISO date string ("YYYY-MM-DD") or null.
function parseNhtsaDate(s) {
  if (!s || typeof s !== "string") return null;
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, a, b, y] = m;
  // Heuristic: if first part > 12, it's DD/MM/YYYY (NHTSA's common form)
  const aN = +a, bN = +b;
  let day, month;
  if (aN > 12) { day = aN; month = bN; }
  else if (bN > 12) { month = aN; day = bN; }
  else { day = aN; month = bN; } // ambiguous — default DD/MM (NHTSA pattern)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function listModels(make, year, issueType) {
  const url = `${NHTSA_BASE}/products/vehicle/models?modelYear=${year}&make=${encodeURIComponent(make)}&issueType=${issueType}`;
  const r = await httpGet(url);
  if (!r.ok || !Array.isArray(r.data?.results)) return [];
  // Dedupe model names (NHTSA returns duplicates for trim variants)
  const seen = new Set();
  const out = [];
  for (const row of r.data.results) {
    const m = row.model?.trim();
    if (m && !seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out;
}

async function fetchRecallsFor(make, model, year) {
  const url = `${NHTSA_BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
  const r = await httpGet(url);
  if (!r.ok) return [];
  return Array.isArray(r.data?.results) ? r.data.results : [];
}

async function fetchComplaintsFor(make, model, year) {
  const url = `${NHTSA_BASE}/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
  const r = await httpGet(url);
  if (!r.ok) return [];
  return Array.isArray(r.data?.results) ? r.data.results : [];
}

async function fetchBrand(brand) {
  const make = makeForBrand(brand);
  if (!make) {
    return { slug: brand.slug, name: brand.name, status: "skipped_no_make" };
  }

  console.log(`  → ${brand.name} (NHTSA make: ${make})`);

  // Dedupe recall campaigns by NHTSACampaignNumber (one campaign hits many
  // models). Dedupe complaints by odiNumber.
  const recallById = new Map();
  const complaintById = new Map();

  let modelsSeen = 0;
  let httpErrors = 0;

  for (const year of YEARS) {
    // Same model list for recall + complaint queries (issueType=r covers both)
    const models = await listModels(make, year, "r");
    await sleep(THROTTLE_MS);
    if (models.length === 0) continue;
    modelsSeen += models.length;

    for (const model of models) {
      const recalls = await fetchRecallsFor(make, model, year);
      await sleep(THROTTLE_MS);
      for (const r of recalls) {
        const id = r.NHTSACampaignNumber;
        if (id && !recallById.has(id)) recallById.set(id, r);
      }

      const complaints = await fetchComplaintsFor(make, model, year);
      await sleep(THROTTLE_MS);
      for (const c of complaints) {
        const id = c.odiNumber;
        if (id && !complaintById.has(id)) complaintById.set(id, c);
      }
    }
  }

  const recalls = Array.from(recallById.values());
  const complaints = Array.from(complaintById.values());

  if (recalls.length === 0 && complaints.length === 0) {
    return {
      slug: brand.slug,
      name: brand.name,
      nhtsa_make: make,
      status: "no_data",
      total_recalls: 0,
      total_complaints: 0,
      models_seen: modelsSeen,
    };
  }

  // Most recent recall
  const recallsWithDates = recalls.map(r => ({
    ...r,
    _date: parseNhtsaDate(r.ReportReceivedDate),
  })).filter(r => r._date);
  recallsWithDates.sort((a, b) => b._date.localeCompare(a._date));

  const recallComponents  = recalls.map(r => r.Component).filter(Boolean);
  const complaintComponents = complaints.map(c => c.components).filter(Boolean);
  const topIssues = topN([...recallComponents, ...complaintComponents], 5);

  const sample = recallsWithDates.slice(0, 5).map(r => ({
    campaign:    r.NHTSACampaignNumber,
    date:        r._date,
    component:   r.Component,
    summary:     (r.Summary || "").slice(0, 400),
    consequence: (r.Consequence || "").slice(0, 200),
    remedy:      (r.Remedy || "").slice(0, 200),
    modelYear:   r.ModelYear,
    model:       r.Model,
    parkIt:      !!r.parkIt,
    parkOutside: !!r.parkOutSide,
    overTheAirUpdate: !!r.overTheAirUpdate,
  }));

  return {
    slug:                    brand.slug,
    name:                    brand.name,
    nhtsa_make:              make,
    status:                  "ok",
    total_recalls:           recalls.length,
    total_complaints:        complaints.length,
    open_investigations_count: 0,
    open_investigations_note: "NHTSA investigations endpoint is auth-gated; not fetched.",
    top_issues:              topIssues,
    most_recent_recall_date: recallsWithDates[0]?._date || null,
    sample_recent_recalls:   sample,
    models_seen:             modelsSeen,
    http_errors:             httpErrors,
    years_covered:           YEARS,
    scraped_at:              new Date().toISOString(),
  };
}

async function main() {
  console.log("NHTSA vehicle complaints + recalls fetcher starting…");
  let brands = await loadAutoBrands();
  console.log(`Loaded ${brands.length} automotive brands`);
  if (BRAND_FILTER) {
    brands = brands.filter(b => BRAND_FILTER.has(b.slug.toLowerCase()));
    console.log(`Smoke test: ${brands.length} brand(s) — ${brands.map(b => b.slug).join(", ")}`);
  }

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    console.log(`[${i + 1}/${brands.length}] ${brands[i].name}`);
    try {
      results.push(await fetchBrand(brands[i]));
    } catch (err) {
      console.error(`  ✗ ${brands[i].name}: ${err.message}`);
      results.push({ slug: brands[i].slug, name: brands[i].name, status: "error", error: err.message });
    }
  }

  const withData  = results.filter(r => r.status === "ok").length;
  const noData    = results.filter(r => r.status === "no_data").length;
  const skipped   = results.filter(r => r.status === "skipped_no_make").length;
  const errors    = results.filter(r => r.status === "error").length;

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    years_covered: YEARS,
    brand_count:   brands.length,
    with_data_count: withData,
    no_data_count:   noData,
    skipped_count:   skipped,
    error_count:     errors,
    brands:          results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  With data: ${withData}`);
  console.log(`  No data:   ${noData}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Errors:    ${errors}`);
  for (const r of results.filter(r => r.status === "ok")) {
    console.log(`  ${r.name}: ${r.total_recalls} recalls, ${r.total_complaints} complaints (latest recall ${r.most_recent_recall_date || "—"})`);
  }
}

main().catch(err => {
  console.error("nhtsa-fetch failed:", err);
  process.exit(1);
});
