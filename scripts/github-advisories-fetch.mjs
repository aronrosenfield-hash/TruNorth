#!/usr/bin/env node
/**
 * GitHub Security Advisories (GHSA) — per-brand fetcher (monthly)
 *
 * Queries https://api.github.com/advisories?affects=<package> for each
 * brand in a smoke list. Unauthenticated; rate-limited at 60 req/hour, so
 * we space requests 1/sec and keep the list short (5 smoke brands first;
 * extend via SMOKE_PACKAGES). Each brand's "package" is the GHSA ecosystem
 * package name most likely to surface vulns published BY that vendor —
 * typically a software ecosystem identifier (e.g., "microsoft", "apple",
 * "google", "cloudflare", "redhat"). These match against the `vulnerabilities[].package.name`
 * field of advisories the vendor publishes or whose products are affected.
 *
 * Per-brand aggregates written to /public/data/github-advisories.json:
 *   - total_advisories       — all-time matches for this package
 *   - recent_24mo            — advisories published in the last 24 months
 *   - critical_count         — advisories with severity === "critical"
 *   - top_categories         — top CWE labels (top 10)
 *   - sample                 — up to 5 most-recent advisories
 *
 * Runs via .github/workflows/github-advisories-monthly.yml (1st 10:00 UTC).
 * Locally: node scripts/github-advisories-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/github-advisories.json");

const UA = "TruNorth-GHSA/1.0";
const API_BASE = "https://api.github.com/advisories";
const TWENTY_FOUR_MONTHS_MS = 730 * 24 * 60 * 60 * 1000;
const REQ_DELAY_MS = 1000;            // 1 req/sec
const PER_PAGE = 100;
const MAX_PAGES = 10;                 // safety cap (1000 advisories per brand)

// Smoke list — extend as needed. Keys are the TruNorth company slug,
// values are the GHSA `affects` package identifier(s) (comma-separated
// list passed through as-is — single value here keeps things readable).
const SMOKE_PACKAGES = [
  { slug: "microsoft",       brand: "Microsoft",   affects: "microsoft" },
  { slug: "google-alphabet", brand: "Google",      affects: "google"    },
  { slug: "apple",           brand: "Apple",       affects: "apple"     },
  { slug: "cloudflare",      brand: "Cloudflare",  affects: "cloudflare"},
  { slug: "red-hat",         brand: "Red Hat",     affects: "redhat"    },
];

function topN(items, n = 10) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPage(affects, page) {
  const url = `${API_BASE}?affects=${encodeURIComponent(affects)}&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":           UA,
      "Accept":               "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error(`GHSA rate-limited (${res.status}); reset=${reset}`);
  }
  if (!res.ok) throw new Error(`GHSA ${affects} p${page} failed: ${res.status}`);
  return res.json();
}

async function fetchAllForPackage(affects) {
  const all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const batch = await fetchPage(affects, p);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
    await sleep(REQ_DELAY_MS);
  }
  return all;
}

function summarize(advisories) {
  const cutoff = Date.now() - TWENTY_FOUR_MONTHS_MS;
  const sorted = [...advisories].sort((a, b) =>
    (b.published_at || "").localeCompare(a.published_at || ""));

  const recent24mo = sorted.filter(a => {
    const t = Date.parse(a.published_at || "");
    return !Number.isNaN(t) && t > cutoff;
  });

  const criticals = sorted.filter(a => (a.severity || "").toLowerCase() === "critical");

  // Top categories from CWE names
  const cweLabels = [];
  for (const a of sorted) {
    const cwes = a.cwes || [];
    for (const c of cwes) {
      if (c?.name) cweLabels.push(c.name);
    }
  }

  const sample = sorted.slice(0, 5).map(a => ({
    ghsa_id:      a.ghsa_id,
    cve_id:       a.cve_id || null,
    summary:      a.summary,
    severity:     a.severity,
    published_at: a.published_at,
    updated_at:   a.updated_at,
    url:          a.html_url || `https://github.com/advisories/${a.ghsa_id}`,
  }));

  return {
    total_advisories: sorted.length,
    recent_24mo:      recent24mo.length,
    critical_count:   criticals.length,
    top_categories:   topN(cweLabels, 10),
    sample,
  };
}

async function main() {
  console.log("GitHub Security Advisories fetcher starting...");

  const brands = [];
  for (const pkg of SMOKE_PACKAGES) {
    console.log(`Fetching advisories for ${pkg.brand} (affects=${pkg.affects})...`);
    try {
      const advisories = await fetchAllForPackage(pkg.affects);
      const summary = summarize(advisories);
      console.log(`  ${pkg.brand}: total=${summary.total_advisories} recent24mo=${summary.recent_24mo} critical=${summary.critical_count}`);
      brands.push({
        slug:     pkg.slug,
        brand:    pkg.brand,
        affects:  pkg.affects,
        ...summary,
      });
    } catch (err) {
      console.error(`  ${pkg.brand} FAILED:`, err.message);
      brands.push({
        slug:    pkg.slug,
        brand:   pkg.brand,
        affects: pkg.affects,
        error:   err.message,
        total_advisories: 0,
        recent_24mo: 0,
        critical_count: 0,
        top_categories: [],
        sample: [],
      });
    }
    // Honor 1 req/sec between brands too.
    await sleep(REQ_DELAY_MS);
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:  new Date().toISOString(),
    source:        "github-advisories",
    source_url:    "https://api.github.com/advisories",
    brand_count:   brands.length,
    brands,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
}

main().catch(err => {
  console.error("github-advisories-fetch failed:", err);
  process.exit(1);
});
