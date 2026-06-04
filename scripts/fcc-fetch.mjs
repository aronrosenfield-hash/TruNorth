#!/usr/bin/env node
/**
 * FCC Consumer Complaints (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the FCC
 * Consumer & Governmental Affairs Bureau (CGB) Consumer Complaints
 * dataset hosted on Socrata for complaints filed against that company.
 *
 * Output: /public/data/fcc-complaints.json (overwritten weekly)
 *
 * Dataset: https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj
 * API:     https://opendata.fcc.gov/resource/3xyp-aqkj.json (Socrata SODA 2.1)
 *
 * Per-brand aggregates (telecom-focused — wireless, internet, robocalls):
 *   - total_complaints_24mo  — count of complaints in the last 24 months
 *   - top_categories         — issue/method breakdown (top 5)
 *   - top_methods            — method breakdown (top 5) (phone, internet, TV)
 *   - sample_complaints      — 5 most recent
 *
 * FCC primarily covers TELECOM brands (wireless carriers, ISPs, cable,
 * landline, robocalls). For non-telecom brands we expect 0 results —
 * that's fine, the merger skips them.
 *
 * Runs via .github/workflows/fcc-weekly.yml Monday 10:00 UTC.
 * Locally: node scripts/fcc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/fcc-complaints.json");

const FCC_BASE = "https://opendata.fcc.gov/resource/3xyp-aqkj.json";
const TWENTY_FOUR_MONTHS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const UA = "TruNorth-FCC/1.0 (+https://www.trunorthapp.com)";

// Optional smoke-test mode: only the four reference telecoms.
const SMOKE = process.env.FCC_SMOKE === "1";
const SMOKE_SLUGS = new Set(["att", "verizon", "t-mobile", "comcast"]);

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  const all = raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
  return SMOKE ? all.filter(b => SMOKE_SLUGS.has(b.slug)) : all;
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

// Socrata floating timestamps look like "2024-05-12T00:00:00.000".
// The dataset's date field is `ticket_created` (ISO floating).
const TWENTY_FOUR_MONTHS_AGO = new Date(Date.now() - TWENTY_FOUR_MONTHS_MS)
  .toISOString().replace("Z", "");

// Socrata escapes single quotes by doubling them.
function sqlEscape(s) { return s.replace(/'/g, "''"); }

// ---------------------------------------------------------------------------
// IMPORTANT — dataset limitation
//
// As of 2017 the FCC's public CGB Consumer Complaints dataset (3xyp-aqkj)
// has been anonymized at the carrier level. The published schema contains
// only: id, ticket_created, date_created, issue_date, issue_time, issue_type
// ("form" — Phone/TV/Internet/Radio), method (Wireless/Cable/VoIP/etc.),
// issue, caller_id_number, advertiser_business_phone_number, city, state,
// zip. There is NO company / carrier / brand column.
//
// This means per-brand complaint counts cannot be derived from this
// dataset directly. We still ship the integration so that:
//   1. The schema/output shape is in place if/when the FCC adds carrier
//      attribution (or we move to a FOIA-derived feed).
//   2. We capture telecom-wide aggregate context (top methods, top issues)
//      that downstream consumers can use as industry benchmarks.
//
// For each brand we record status="no_company_attribution" with the
// telecom-wide top categories/methods over the last 24 months attached.
// The merger then skips writing per-company data (since the count is not
// brand-specific) but the JSON serves as an audit trail.
// ---------------------------------------------------------------------------

let industryAggregateCache = null;
async function fetchIndustryAggregate() {
  if (industryAggregateCache) return industryAggregateCache;

  const where = `ticket_created > '${TWENTY_FOUR_MONTHS_AGO}'`;
  const countUrl   = `${FCC_BASE}?$select=count(*)&$where=${encodeURIComponent(where)}`;
  const issuesUrl  = `${FCC_BASE}?$select=issue,count(*) as n&$where=${encodeURIComponent(where)}&$group=issue&$order=n DESC&$limit=10`;
  const methodsUrl = `${FCC_BASE}?$select=method,count(*) as n&$where=${encodeURIComponent(where)}&$group=method&$order=n DESC&$limit=10`;
  const sampleUrl  = `${FCC_BASE}?$where=${encodeURIComponent(where)}&$order=ticket_created DESC&$limit=20`;

  const headers = { "User-Agent": UA, "Accept": "application/json" };

  const [countRes, issuesRes, methodsRes, sampleRes] = await Promise.all([
    fetch(countUrl, { headers }),
    fetch(issuesUrl, { headers }),
    fetch(methodsUrl, { headers }),
    fetch(sampleUrl, { headers }),
  ]);

  for (const r of [countRes, issuesRes, methodsRes, sampleRes]) {
    if (!r.ok) throw new Error(`FCC industry aggregate fetch failed: ${r.status} ${r.url}`);
  }

  const [countData, issuesData, methodsData, sampleData] = await Promise.all([
    countRes.json(), issuesRes.json(), methodsRes.json(), sampleRes.json(),
  ]);

  const total = Number(countData?.[0]?.count_1 ?? countData?.[0]?.count ?? 0);
  const top_categories = issuesData.map(r => ({ label: r.issue, count: Number(r.n) }));
  const top_methods    = methodsData.map(r => ({ label: r.method, count: Number(r.n) }));
  const samples = sampleData.slice(0, 5).map(r => ({
    ticket_created: r.ticket_created,
    issue:          r.issue,
    method:         r.method,
    state:          r.state,
    id:             r.id,
  }));

  industryAggregateCache = {
    total_complaints_24mo: total,
    top_categories,
    top_methods,
    sample_complaints: samples,
  };
  return industryAggregateCache;
}

async function fetchBrandComplaints(brand, industry) {
  // Dataset has no carrier column — see header comment. We attach the
  // telecom-industry-wide aggregate so downstream code has *something*
  // useful and the file structure stays consistent with cfpb-complaints.json.
  return {
    slug:                          brand.slug,
    name:                          brand.name,
    status:                        "no_company_attribution",
    note:                          "FCC CGB dataset 3xyp-aqkj is anonymized — no carrier/company column. Industry-wide telecom aggregates attached for context.",
    industry_total_complaints_24mo: industry.total_complaints_24mo,
    industry_top_categories:       industry.top_categories,
    industry_top_methods:          industry.top_methods,
    industry_sample_complaints:    industry.sample_complaints,
    scraped_at:                    new Date().toISOString(),
  };
}

async function main() {
  console.log("📡 FCC complaint fetcher starting...");
  if (SMOKE) console.log("  (smoke mode — 4 telecoms only)");

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  // Pull telecom-industry-wide aggregate once (last 24 months of all rows).
  console.log("Fetching industry-wide telecom aggregate…");
  const industry = await fetchIndustryAggregate();
  console.log(`  industry total: ${industry.total_complaints_24mo.toLocaleString()} complaints`);

  // FCC Socrata has a 1000 req/hour limit unauthenticated. Since the dataset
  // has no carrier column, per-brand calls are trivial — but we keep the
  // 1 req/sec courtesy pacing in case the schema is restored upstream.
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandComplaints(brands[i], industry);
    results.push(r);
    if (i % 50 === 0) console.log(`  …${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const noAttribution = results.filter(r => r.status === "no_company_attribution").length;
  const err           = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:                 new Date().toISOString(),
    source:                       "fcc-cgb-3xyp-aqkj",
    source_url:                   "https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj",
    window_months:                24,
    dataset_limitation:           "FCC CGB Consumer Complaints dataset 3xyp-aqkj has no company/carrier column; per-brand attribution is not possible. Industry aggregates are recorded for context.",
    brand_count:                  brands.length,
    industry_total_complaints_24mo: industry.total_complaints_24mo,
    industry_top_categories:      industry.top_categories,
    industry_top_methods:         industry.top_methods,
    no_attribution_count:         noAttribution,
    error_count:                  err,
    complaints:                   results,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   No-attribution rows (per-brand placeholder): ${noAttribution}`);
  console.log(`   Errors: ${err}`);
}

main().catch(err => {
  console.error("❌ fcc-fetch failed:", err);
  process.exit(1);
});
