#!/usr/bin/env node
/**
 * FINRA BrokerCheck — regulatory disclosure fetcher (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries FINRA's
 * BrokerCheck public API for the firm record and extracts regulatory
 * disclosure aggregates (regulatory events, civil events, arbitrations).
 *
 * Output: /public/data/finra-disclosures.json (overwritten weekly)
 *
 * API (undocumented but publicly used by brokercheck.finra.org SPA):
 *   - Search:       https://api.brokercheck.finra.org/search/firm?query=…
 *   - Firm detail:  https://api.brokercheck.finra.org/search/firm/{firmId}
 *
 * What we can extract (no auth required):
 *   - firm_name, firm_id
 *   - disclosures: [{disclosureType, disclosureCount}] — Regulatory Event,
 *     Civil Event, Arbitration (all-time lifetime counts)
 *
 * What we CANNOT extract from the public API:
 *   - Per-disclosure detail (date, fine amount, narrative). Those live
 *     behind the BrokerCheck firm report PDF endpoint which requires a
 *     session token from the SPA. So total_fines_$ and the 5y window
 *     are filled with `null` and `sample_actions` is a single link to
 *     the official BrokerCheck profile where users can read full detail.
 *   - If/when we add a headless-browser step, the 5y/fine fields can be
 *     backfilled. For now this is honest aggregate data, which is what
 *     TruNorth surfaces (count + link).
 *
 * Most brands are not broker-dealers and return zero search hits — the
 * merger silently skips them. The relevant universe is ~30-50 financial
 * brands (banks, brokerages, fintech).
 *
 * Runs via .github/workflows/finra-weekly.yml Tuesday 02:00 UTC.
 * Locally: node scripts/finra-fetch.mjs
 *          node scripts/finra-fetch.mjs --smoke    # only test 4 firms
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/finra-disclosures.json");

const UA = "TruNorth-FINRA/1.0 (+https://www.trunorthapp.com)";
const FINRA_BASE = "https://api.brokercheck.finra.org/search/firm";
const RATE_LIMIT_MS = 1000;

// Smoke-test set — exercised when --smoke is passed (or fed by CI sanity step).
const SMOKE_SLUGS = new Set([
  "goldman-sachs",
  "morgan-stanley",
  "charles-schwab",
  "robinhood",
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

async function finraGet(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept":     "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const e = new Error(`FINRA ${res.status}: ${body.slice(0, 200)}`);
    e.code = res.status;
    throw e;
  }
  return res.json();
}

// Step 1: search for a firm. Pick the best matching ACTIVE broker-dealer.
// Prefer firms with firm_disclosure_fl === "Y" (i.e. they have a BD scope
// and a public disclosure history).
async function searchFirm(brandName) {
  const url = `${FINRA_BASE}?query=${encodeURIComponent(brandName)}&hl=true&nrows=12&start=0&r=25&sort=score+desc&wt=json`;
  const data = await finraGet(url);
  const hits = (data?.hits?.hits || []).map(h => h._source);
  if (hits.length === 0) return null;

  // Rank: ACTIVE BD with disclosure flag > ACTIVE BD > anything else.
  const score = (h) => {
    let s = 0;
    if (h.firm_scope === "ACTIVE") s += 10;
    if (h.firm_disclosure_fl === "Y") s += 5;
    if (h.firm_bd_sec_number) s += 3;
    return s;
  };
  hits.sort((a, b) => score(b) - score(a));
  return hits[0];
}

// Step 2: pull firm detail to get the aggregated disclosure counts.
async function fetchFirmDetail(firmId) {
  const url = `${FINRA_BASE}/${encodeURIComponent(firmId)}?hl=true&nrows=12&r=25&sort=score+desc&wt=json`;
  const data = await finraGet(url);
  const hit = data?.hits?.hits?.[0]?._source;
  if (!hit?.content) return null;
  try {
    return JSON.parse(hit.content);
  } catch {
    return null;
  }
}

function countByType(disclosures, type) {
  if (!Array.isArray(disclosures)) return 0;
  const row = disclosures.find(d => d.disclosureType === type);
  return row?.disclosureCount ?? 0;
}

async function fetchBrand(brand) {
  try {
    const top = await searchFirm(brand.name);
    if (!top) {
      return { slug: brand.slug, name: brand.name, status: "not_found_in_finra" };
    }
    const firmId  = top.firm_source_id;
    const firmName = top.firm_name || top.ia_firm_name;
    const isBrokerDealer = Boolean(top.firm_bd_sec_number);

    const detail = await fetchFirmDetail(firmId);
    if (!detail) {
      return {
        slug:      brand.slug,
        name:      brand.name,
        firm_id:   firmId,
        firm_name: firmName,
        status:    "detail_fetch_failed",
      };
    }

    const disclosures = detail.disclosures || [];
    const regulatory  = countByType(disclosures, "Regulatory Event");
    const civil       = countByType(disclosures, "Civil Event");
    const arbitration = countByType(disclosures, "Arbitration");
    const totalDisclosures = regulatory + civil + arbitration;

    // No disclosures at all → still record (shows clean record) but mark.
    if (totalDisclosures === 0) {
      return {
        slug:      brand.slug,
        name:      brand.name,
        firm_id:   firmId,
        firm_name: firmName,
        status:    "no_disclosures",
        is_broker_dealer: isBrokerDealer,
        total_disclosures: 0,
      };
    }

    const brokercheckUrl = `https://brokercheck.finra.org/firm/summary/${encodeURIComponent(firmId)}`;
    // sample_actions: link to the official BrokerCheck profile. Per-event
    // detail is gated behind PDF report endpoints requiring a session token.
    const sampleActions = [{
      label:       "View full BrokerCheck disclosure history",
      url:         brokercheckUrl,
      description: `${regulatory} regulatory + ${civil} civil + ${arbitration} arbitration events on file`,
    }];

    return {
      slug:                          brand.slug,
      name:                          brand.name,
      firm_id:                       firmId,
      firm_name:                     firmName,
      status:                        "ok",
      is_broker_dealer:              isBrokerDealer,
      total_disclosures:             totalDisclosures,
      total_regulatory_events:       regulatory,
      total_civil_events:            civil,
      total_arbitrations:            arbitration,
      // 5y window + fine totals not exposed by anonymous BrokerCheck API.
      // Documented here so consumers know these are not "0", they are unknown.
      total_disciplinary_actions_5y: null,
      total_fines_usd:               null,
      sample_actions:                sampleActions,
      brokercheck_url:               brokercheckUrl,
      scraped_at:                    new Date().toISOString(),
    };
  } catch (err) {
    return {
      slug:   brand.slug,
      name:   brand.name,
      status: "error",
      error:  err.message,
      code:   err.code,
    };
  }
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`FINRA BrokerCheck fetcher starting${smoke ? " (smoke-test mode)" : ""}…`);

  let brands = await loadBrands();
  if (smoke) brands = brands.filter(b => SMOKE_SLUGS.has(b.slug));
  console.log(`Loaded ${brands.length} brands`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrand(brands[i]);
    results.push(r);
    if (i % 50 === 0 || smoke) {
      console.log(`  …${i + 1}/${brands.length}  ${brands[i].slug}: ${r.status}${r.total_disclosures != null ? ` (${r.total_disclosures} disclosures)` : ""}`);
    }
    if (i < brands.length - 1) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  const ok        = results.filter(r => r.status === "ok").length;
  const clean     = results.filter(r => r.status === "no_disclosures").length;
  const notFound  = results.filter(r => r.status === "not_found_in_finra").length;
  const errored   = results.filter(r => r.status === "error" || r.status === "detail_fetch_failed").length;

  if (!smoke) {
    await fs.writeFile(OUT_FILE, JSON.stringify({
      generated_at:          new Date().toISOString(),
      source:                "FINRA BrokerCheck public API",
      source_notes:          "All-time disclosure counts from anonymous BrokerCheck. 5y window and fine totals require authenticated PDF report endpoint (not yet implemented).",
      brand_count:           brands.length,
      with_disclosures:      ok,
      clean_record:          clean,
      not_found:             notFound,
      error_count:           errored,
      firms:                 results,
    }, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  } else {
    console.log("\nSmoke-test results:");
    for (const r of results) {
      console.log(`  ${r.slug.padEnd(20)} status=${r.status}  disclosures=${r.total_disclosures ?? "—"}  firm_id=${r.firm_id ?? "—"}`);
    }
  }
  console.log(`  with disclosures: ${ok}`);
  console.log(`  clean record:     ${clean}`);
  console.log(`  not found:        ${notFound}`);
  console.log(`  errors:           ${errored}`);
}

main().catch(err => {
  console.error("finra-fetch failed:", err);
  process.exit(1);
});
