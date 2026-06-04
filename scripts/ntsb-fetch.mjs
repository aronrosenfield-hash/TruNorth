#!/usr/bin/env node
/**
 * NTSB Accident Reports (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries NTSB CAROL
 * (Case Analysis & Reporting Online) for accident & incident investigations
 * across all four transport modes:
 *
 *   - Aviation   (aircraft make/operator)
 *   - Rail       (railroad operator)
 *   - Marine     (vessel operator)
 *   - Highway    (vehicle make / motor carrier)
 *
 * Output: /public/data/ntsb-accidents.json (overwritten weekly)
 *
 * Per-brand aggregates (rolling 5-year window):
 *   - total_NTSB_investigations_5y
 *   - fatal_incidents_5y
 *   - mode_breakdown         { aviation, rail, marine, highway }
 *   - top_findings           [{ label, count }]
 *   - sample_reports         5 most recent investigations
 *
 * Most brands in top-500-brands.txt are NOT transportation operators or
 * manufacturers and will yield zero hits. That's expected — the merger
 * skips non-ok rows so non-transport brands don't get a junk NTSB block.
 *
 * Endpoint stability:
 *   CAROL exposes a public REST search at data.ntsb.gov. The exact path
 *   has moved between revisions; we hit the documented search endpoint
 *   and fall back to `status: "not_available"` on 4xx/5xx/timeout. The
 *   fetcher never throws on a single brand — it always writes a result.
 *
 * Sources:
 *   - https://www.ntsb.gov/safety/Pages/safety-issue-investigations.aspx
 *   - https://data.ntsb.gov  (CAROL search API)
 *
 * Smoke-test:
 *   node scripts/ntsb-fetch.mjs --smoke
 *     -> only runs boeing, norfolk-southern, tesla
 *
 * Full weekly run via .github/workflows/ntsb-weekly.yml Monday 09:00 UTC.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/ntsb-accidents.json");

const UA = "TruNorth-NTSB/1.0 (+https://www.trunorthapp.com)";
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const REQ_DELAY_MS = 1000; // 1 req/sec courtesy throttle
const PER_MODE_TIMEOUT_MS = 15_000;

const NTSB = {
  // CAROL search API — undocumented but stable for ~years; mirrors the
  // public search UI at data.ntsb.gov.
  carolBase: "https://data.ntsb.gov/carol-main-public/api/Query/Main",
  carolUi:   "https://data.ntsb.gov/carol-main-public/basic-search",
};

const MODES = ["aviation", "rail", "marine", "highway"];

// Smoke-test allowlist — confirmed transportation-relevant brands.
const SMOKE_SLUGS = new Set([
  "boeing",
  "norfolk-southern",
  "tesla",
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

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

async function safeFetchJSON(url, body, { timeoutMs = PER_MODE_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "User-Agent":   UA,
        "Accept":       "application/json,text/plain,*/*",
        "Content-Type": body ? "application/json" : undefined,
      },
      body: body ? JSON.stringify(body) : undefined,
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

// CAROL accepts a POST with a filter payload. We query by mode + free-text
// against the operator/make field. The exact field names changed between
// CAROL revisions — we try the common ones; on failure we report 0.
async function fetchModeForBrand(brand, mode, sinceISO) {
  const payload = {
    ResultSetSize:   50,
    ResultSetOffset: 0,
    QueryGroups: [{
      QueryRules: [
        { RuleType: "Simple", Values: [mode],            Columns: ["Mode"],          Operator: "is" },
        { RuleType: "Simple", Values: [brand.name],      Columns: ["MakeName","OperatorName","VesselName","RailroadName","VehicleMakeName"], Operator: "contains" },
        { RuleType: "Simple", Values: [sinceISO.slice(0,10)], Columns: ["EventDate"], Operator: ">=" },
      ],
    }],
    SortColumn: "EventDate",
    SortDescending: true,
  };

  const r = await safeFetchJSON(NTSB.carolBase, payload);
  if (!r.ok || !r.data) {
    return { mode, count: 0, fatal: 0, sample: [], findings: [], status: r.ok ? "no_data" : "endpoint_error", code: r.code };
  }

  // CAROL response: { Results: [...], TotalRowCount: N } (per current schema).
  const rows = Array.isArray(r.data?.Results) ? r.data.Results
             : Array.isArray(r.data?.results) ? r.data.results
             : Array.isArray(r.data)          ? r.data
             : [];
  const total = r.data?.TotalRowCount ?? r.data?.total ?? rows.length;

  const fatal = rows.filter(e => {
    const f = Number(e.HighestInjuryLevel === "Fatal" ? 1 : (e.FatalInjuryCount ?? e.Fatalities ?? 0));
    return f > 0 || e.HighestInjuryLevel === "Fatal";
  }).length;

  const findings = rows.flatMap(e => {
    const f = e.Findings || e.ProbableCause || e.FindingDescription;
    if (Array.isArray(f)) return f.map(x => (typeof x === "string" ? x : x?.FindingDescription)).filter(Boolean);
    return typeof f === "string" ? [f] : [];
  });

  return {
    mode,
    count:  total,
    fatal,
    findings,
    sample: rows.slice(0, 5).map(e => ({
      mode,
      ntsb_id:    e.NtsbNo || e.EventId || e.Id || null,
      event_date: e.EventDate || e.Date || null,
      location:   e.City && e.State ? `${e.City}, ${e.State}` : (e.Location || null),
      operator:   e.OperatorName || e.RailroadName || e.MakeName || e.VehicleMakeName || null,
      severity:   e.HighestInjuryLevel || null,
      fatalities: Number(e.FatalInjuryCount ?? e.Fatalities ?? 0) || 0,
      summary:    e.ReportType || e.NarrativeSummary || e.ProbableCause || null,
      url:        e.NtsbNo ? `${NTSB.carolUi}?event=${encodeURIComponent(e.NtsbNo)}` : null,
    })),
    status: "ok",
  };
}

async function fetchBrand(brand, sinceISO) {
  const modeResults = [];
  for (const mode of MODES) {
    try {
      modeResults.push(await fetchModeForBrand(brand, mode, sinceISO));
    } catch (err) {
      modeResults.push({ mode, count: 0, fatal: 0, sample: [], findings: [], status: "error", error: err.message });
    }
    // Inter-mode courtesy delay so we don't burst 4 reqs/brand.
    await new Promise(r => setTimeout(r, 250));
  }

  const total = modeResults.reduce((a, m) => a + (m.count || 0), 0);
  const fatal = modeResults.reduce((a, m) => a + (m.fatal || 0), 0);
  const anyOk = modeResults.some(m => m.status === "ok");

  const modeBreakdown = Object.fromEntries(modeResults.map(m => [m.mode, m.count || 0]));

  const sample = modeResults
    .flatMap(m => m.sample || [])
    .map(s => ({ ...s, _sort: Date.parse(s.event_date || "") || 0 }))
    .sort((a, b) => b._sort - a._sort)
    .slice(0, 5)
    .map(({ _sort, ...rest }) => rest);

  const findings = modeResults.flatMap(m => m.findings || []);
  const topFindings = topN(findings, 5);

  const sourceStatus = Object.fromEntries(modeResults.map(m => [m.mode, m.status]));

  return {
    slug:                          brand.slug,
    name:                          brand.name,
    category:                      brand.category,
    status:                        !anyOk ? "not_available" : total > 0 ? "ok" : "no_records",
    total_NTSB_investigations_5y:  total,
    fatal_incidents_5y:            fatal,
    mode_breakdown:                modeBreakdown,
    top_findings:                  topFindings,
    sample_reports:                sample,
    source_status:                 sourceStatus,
    scraped_at:                    new Date().toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`NTSB fetcher starting${smoke ? " (smoke test)" : ""}...`);

  let brands = await loadBrands();
  if (smoke) brands = brands.filter(b => SMOKE_SLUGS.has(b.slug));

  if (smoke) {
    const have = new Set(brands.map(b => b.slug));
    const fallbacks = [
      { slug: "boeing",            name: "Boeing",            category: "Aerospace" },
      { slug: "norfolk-southern",  name: "Norfolk Southern",  category: "Rail" },
      { slug: "tesla",             name: "Tesla",             category: "Automotive" },
    ];
    for (const fb of fallbacks) if (!have.has(fb.slug)) brands.push(fb);
    console.log(`Smoke set: ${brands.map(b => b.slug).join(", ")}`);
  }
  console.log(`Loaded ${brands.length} brand(s)`);

  const sinceISO = new Date(Date.now() - FIVE_YEARS_MS).toISOString();

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    try {
      results.push(await fetchBrand(brands[i], sinceISO));
    } catch (err) {
      results.push({
        slug:   brands[i].slug,
        name:   brands[i].name,
        status: "error",
        error:  err.message,
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
    generated_at:   new Date().toISOString(),
    window_years:   5,
    brand_count:    brands.length,
    with_records:   withRecords,
    no_records:     noRecords,
    not_available:  notAvailable,
    error_count:    errors,
    smoke:          smoke,
    brands:         results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With records:  ${withRecords}`);
  console.log(`   No records:    ${noRecords}`);
  console.log(`   Not available: ${notAvailable}`);
  console.log(`   Errors:        ${errors}`);
}

main().catch(err => {
  console.error("ntsb-fetch failed:", err);
  process.exit(1);
});
