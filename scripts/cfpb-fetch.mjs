#!/usr/bin/env node
/**
 * Option D — CFPB Consumer Complaint Database (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the CFPB
 * Consumer Complaint Database for complaints filed against that company.
 *
 * Output: /public/data/cfpb-complaints.json (overwritten weekly)
 *
 * Replaces the BBB scrape (B-25) which is fundamentally Cloudflare-blocked.
 * The CFPB database is an official US government open dataset, no auth,
 * no rate-limit issues, well-documented.
 *
 * API: https://cfpb.github.io/api/ccdb/
 * Endpoint: https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/
 *
 * Per-brand aggregates:
 *   - total_complaints      — all-time count
 *   - recent_12mo_count     — last 12 months
 *   - top_issues            — issue breakdown (top 5)
 *   - top_products          — product breakdown (top 5)
 *   - timely_response_rate  — pct of timely company responses
 *   - sample_complaints     — 5 most recent
 *
 * CFPB primarily covers FINANCIAL brands (banks, credit cards, debt
 * collection, mortgages, student loans, etc.). For non-financial brands
 * we expect 0 results — that's fine, the merger skips them.
 *
 * Runs via .github/workflows/cfpb-weekly.yml Sunday 18:00 UTC.
 * Locally: node scripts/cfpb-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/cfpb-complaints.json");

const CFPB_BASE = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1";
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

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

// Returns the top N values + their counts from an array of strings.
function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

async function fetchBrandComplaints(brand) {
  // CFPB does fuzzy company-name matching on the `company` query param,
  // so "Bank of America" matches "BANK OF AMERICA, NATIONAL ASSOCIATION".
  // size=100 returns the most recent 100 complaints (plenty for aggregates).
  const q = encodeURIComponent(brand.name);
  const url = `${CFPB_BASE}/?company=${q}&size=100&sort=created_date_desc`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TruNorth-CFPB/1.0 (+https://www.trunorthapp.com)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      return { slug: brand.slug, name: brand.name, status: "error", code: res.status };
    }
    const data = await res.json();
    const total = data?.hits?.total?.value ?? 0;
    const hits = data?.hits?.hits ?? [];

    if (total === 0) {
      return { slug: brand.slug, name: brand.name, status: "no_complaints", total_complaints: 0 };
    }

    const complaints = hits.map(h => h._source);
    const cutoff = Date.now() - TWELVE_MONTHS_MS;
    const recent12mo = complaints.filter(c => {
      const t = Date.parse(c.date_received);
      return !Number.isNaN(t) && t > cutoff;
    });

    const timelyResponses = complaints.filter(c => c.timely === "Yes").length;
    const timelyRate = complaints.length ? Math.round(timelyResponses / complaints.length * 100) : null;

    return {
      slug:                   brand.slug,
      name:                   brand.name,
      status:                 "ok",
      total_complaints:       total,
      recent_12mo_count:      recent12mo.length,
      // 100 is the sample we pulled; if we wanted exact 12mo across all-time
      // we'd need to paginate. For now: if our 100-sample shows N recent,
      // and total is much higher, the real 12mo count is at least N.
      timely_response_rate:   timelyRate,
      top_issues:             topN(complaints.map(c => c.issue), 5),
      top_products:           topN(complaints.map(c => c.product), 5),
      top_response_types:     topN(complaints.map(c => c.company_response), 5),
      sample_complaints:      complaints.slice(0, 5).map(c => ({
        date_received: c.date_received,
        product:       c.product,
        sub_product:   c.sub_product,
        issue:         c.issue,
        sub_issue:     c.sub_issue,
        state:         c.state,
        company_response: c.company_response,
        timely:        c.timely,
        complaint_id:  c.complaint_id,
      })),
      sampled_count:          complaints.length,
      scraped_at:             new Date().toISOString(),
    };
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }
}

async function main() {
  console.log("📋 CFPB complaint fetcher starting...");
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  // CFPB's public API has no documented rate limit, but courtesy: 1 req/sec.
  // ~9 min for 528 brands.
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandComplaints(brands[i]);
    results.push(r);
    if (i % 50 === 0) console.log(`  …${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const withComplaints = results.filter(r => r.status === "ok").length;
  const noComplaints   = results.filter(r => r.status === "no_complaints").length;
  const err            = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    brand_count:  brands.length,
    with_complaints_count: withComplaints,
    no_complaints_count:   noComplaints,
    error_count:  err,
    complaints:   results,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   With complaints: ${withComplaints}`);
  console.log(`   No complaints:   ${noComplaints}`);
  console.log(`   Errors:          ${err}`);
}

main().catch(err => {
  console.error("❌ cfpb-fetch failed:", err);
  process.exit(1);
});
