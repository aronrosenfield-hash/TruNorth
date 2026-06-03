#!/usr/bin/env node
/**
 * OpenStates — state-level legislation tracker (monthly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the OpenStates
 * v3 API for bills mentioning the brand name in title/abstract from the
 * last 12 months across all 50 state legislatures.
 *
 * Complements the federal FEC lobbying data already in TruNorth by surfacing
 * state-level political-influence signal (state bills naming a company are a
 * strong lobbying / regulatory-exposure indicator).
 *
 * Output: /public/data/openstates-bills.json (overwritten monthly)
 *
 * API: https://openstates.org/api/v3/
 * Docs: https://docs.openstates.org/api-v3/
 * Test: https://v3.openstates.org/bills?q=Pfizer&apikey=KEY
 *
 * SETUP: Requires a free API key from
 *   https://openstates.org/accounts/profile/
 * and exposed as the OPENSTATES_API_KEY env var. The script logs a clear
 * error and exits non-zero if the key is missing.
 *
 * RATE LIMIT: Free tier is ~500 requests/day. We do 1 req/sec and one
 * request per brand (~528 brands → ~9 min wall, ~528 reqs/day). That is
 * right at the daily ceiling, so this job runs MONTHLY, not weekly.
 *
 * Per-brand aggregates:
 *   - total_bills_12mo  — count of bills updated in last 12 months
 *   - top_states        — 5 most-frequent jurisdictions
 *   - top_topics        — top subject tags across matched bills
 *   - sample_bills      — up to 10 most recent (title, state, status, URL)
 *
 * Runs via .github/workflows/openstates-monthly.yml on day 1 at 04:00 UTC.
 * Locally: OPENSTATES_API_KEY=xxx node scripts/openstates-fetch.mjs
 *
 * CLI flags:
 *   --limit=N            only process the first N brands (smoke test)
 *   --brands=slug,slug   only process the named brand slugs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/openstates-bills.json");

const OS_BASE = "https://v3.openstates.org";
const UA = "TruNorth-OpenStates/1.0 (+https://www.trunorthapp.com)";
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

const API_KEY = process.env.OPENSTATES_API_KEY;
if (!API_KEY) {
  console.error("❌ OPENSTATES_API_KEY env var is required.");
  console.error("   Get a free key at https://openstates.org/accounts/profile/");
  console.error("   Then: OPENSTATES_API_KEY=xxx node scripts/openstates-fetch.mjs");
  process.exit(1);
}

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;
const brandsArg = args.find(a => a.startsWith("--brands="));
const ONLY_BRANDS = brandsArg ? brandsArg.split("=")[1].split(",").map(s => s.trim().toLowerCase()) : null;

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

function jurisdictionLabel(bill) {
  return bill?.jurisdiction?.name || bill?.from_organization?.name || null;
}

async function fetchBrandBills(brand) {
  // OpenStates date filter: `updated_since=YYYY-MM-DD`. We use updated_since
  // (not created_since) so we catch bills that moved through committee
  // during the window even if introduced earlier.
  // `q=` searches full text across title/abstract/body.
  // sort=updated_desc → most recently active bills first.
  // per_page=20 keeps the payload light; we surface the top 10 samples.
  const since = new Date(Date.now() - TWELVE_MONTHS_MS).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q:              `"${brand.name}"`,   // quoted exact-phrase match
    updated_since:  since,
    sort:           "updated_desc",
    per_page:       "20",
    page:           "1",
    apikey:         API_KEY,
  });
  params.append("include", "subjects");

  const url = `${OS_BASE}/bills?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept":     "application/json",
      },
    });

    if (res.status === 429) {
      console.warn(`  ⚠️  429 rate-limited on ${brand.slug}, sleeping 10s`);
      await new Promise(r => setTimeout(r, 10000));
      return { slug: brand.slug, name: brand.name, status: "rate_limited" };
    }
    if (!res.ok) {
      return { slug: brand.slug, name: brand.name, status: "error", code: res.status };
    }

    const data = await res.json();
    const results = data?.results || [];
    const total = data?.pagination?.total_items ?? results.length;

    if (total === 0) {
      return { slug: brand.slug, name: brand.name, status: "no_bills", total_bills_12mo: 0 };
    }

    const states = results.map(jurisdictionLabel).filter(Boolean);
    const subjects = results.flatMap(b => Array.isArray(b.subject) ? b.subject : []);

    return {
      slug:             brand.slug,
      name:             brand.name,
      status:           "ok",
      total_bills_12mo: total,
      sampled_count:    results.length,
      top_states:       topN(states, 5),
      top_topics:       topN(subjects, 5),
      sample_bills:     results.slice(0, 10).map(b => ({
        identifier:    b.identifier,
        title:         b.title,
        state:         jurisdictionLabel(b),
        session:       b.session,
        classification:Array.isArray(b.classification) ? b.classification[0] : b.classification,
        status:        b.latest_action_description || null,
        latest_action: b.latest_action_date || null,
        first_action:  b.first_action_date  || null,
        url:           b.openstates_url || null,
      })),
      scraped_at:       new Date().toISOString(),
    };
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }
}

async function main() {
  console.log("🏛️  OpenStates bill fetcher starting…");
  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  if (ONLY_BRANDS) {
    brands = brands.filter(b => ONLY_BRANDS.includes(b.slug.toLowerCase()));
    console.log(`Filtered to ${brands.length} brands via --brands`);
  }
  if (LIMIT) {
    brands = brands.slice(0, LIMIT);
    console.log(`Smoke-test mode: limiting to first ${brands.length} brand(s)`);
  }

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandBills(brands[i]);
    results.push(r);
    if (r.status === "ok") {
      console.log(`  ✓ ${brands[i].slug.padEnd(20)} ${r.total_bills_12mo} bills (${r.top_states.map(s => s.label).slice(0,3).join(", ")})`);
    } else if (r.status !== "no_bills") {
      console.log(`  ✗ ${brands[i].slug.padEnd(20)} ${r.status}${r.code ? ` (${r.code})` : ""}`);
    }
    if (i % 50 === 0 && i > 0) console.log(`  …${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, 1100)); // 1.1s for safety vs ~500/day cap
  }

  const withBills    = results.filter(r => r.status === "ok").length;
  const noBills      = results.filter(r => r.status === "no_bills").length;
  const rateLimited  = results.filter(r => r.status === "rate_limited").length;
  const errors       = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:       new Date().toISOString(),
    brand_count:        brands.length,
    with_bills_count:   withBills,
    no_bills_count:     noBills,
    rate_limited_count: rateLimited,
    error_count:        errors,
    bills:              results,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   With bills:   ${withBills}`);
  console.log(`   No bills:     ${noBills}`);
  console.log(`   Rate-limited: ${rateLimited}`);
  console.log(`   Errors:       ${errors}`);
}

main().catch(err => {
  console.error("❌ openstates-fetch failed:", err);
  process.exit(1);
});
