#!/usr/bin/env node
/**
 * WikiRate — Crowdsourced ESG metrics aggregator (monthly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries WikiRate for
 * crowdsourced ESG/sustainability metrics keyed off the company's slug on
 * wikirate.org.
 *
 * Output: /public/data/wikirate-metrics.json (overwritten monthly)
 *
 * API endpoints (no auth required):
 *   Per-company answers card: https://wikirate.org/{company_slug}+Answer.json?limit=100
 *   Per-company card:         https://wikirate.org/{company_slug}.json
 *   API discovery:            https://wikirate.org/+API.json
 *
 * Per-brand aggregates:
 *   - wikirate_metrics_count     — # of distinct metrics with a value
 *   - top_metrics                — array of {topic, value, year, source}
 *                                  (up to 10, prioritized by recency)
 *   - data_completeness_pct     — pct of solicited metrics with non-null value
 *
 * Slug resolution strategy:
 *   1. Try our brand slug directly (often differs from WikiRate's slug).
 *   2. Search the +Company endpoint for the brand display name.
 *   3. If neither yields a card, mark as not_found.
 *
 * Runs via .github/workflows/wikirate-monthly.yml — 1st of month 14:30 UTC.
 * Locally: node scripts/wikirate-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/wikirate-metrics.json");

const WIKIRATE_BASE = "https://wikirate.org";
const UA = "TruNorth-WikiRate/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000; // 1 req/sec courtesy rate limit
const API_KEY = process.env.WIKIRATE_API_KEY || "";
// WikiRate sits behind Cloudflare; without an API key, anonymous requests
// from non-browser UAs are returned 403. Set WIKIRATE_API_KEY as a secret
// in CI to authenticate — the fetcher otherwise degrades to not_found.

const SMOKE = (process.env.WIKIRATE_SMOKE || "").trim() === "1";
const SMOKE_BRANDS = ["apple", "walmart", "nike", "mcdonalds"];

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
  if (SMOKE) return all.filter(b => SMOKE_BRANDS.includes(b.slug));
  return all;
}

// Convert our slug ("coca-cola") to WikiRate slug guesses ("Coca_Cola", "Coca-Cola").
// WikiRate uses underscores and TitleCase for many company slugs.
function slugCandidates(brand) {
  const out = new Set();
  out.add(brand.slug);
  // Capitalize each dash-separated word
  const titled = brand.slug
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_");
  out.add(titled);
  // Display name → underscores
  const fromName = brand.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  out.add(fromName);
  // Hyphenated version
  out.add(brand.slug.replace(/-/g, "_"));
  return [...out].filter(Boolean);
}

async function httpJson(url) {
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  if (API_KEY) headers["X-API-KEY"] = API_KEY;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) return { _notFound: true };
    return { _error: true, status: res.status };
  }
  try { return await res.json(); }
  catch (e) { return { _error: true, parse: e.message }; }
}

// Probe a candidate slug — returns the canonical slug if WikiRate has a card.
async function probeCompany(candidate) {
  const url = `${WIKIRATE_BASE}/${encodeURIComponent(candidate)}.json`;
  const data = await httpJson(url);
  if (data._notFound || data._error) return null;
  // A real company card has a "name" or "codename" field
  if (data.name || data.codename) {
    return data.codename || data.name || candidate;
  }
  return null;
}

// Resolve our brand to a WikiRate slug via candidate probing.
async function resolveCompany(brand) {
  for (const cand of slugCandidates(brand)) {
    const resolved = await probeCompany(cand);
    await sleep(REQ_DELAY_MS);
    if (resolved) return resolved;
  }
  return null;
}

// Fetch the +Answer card for a given company slug. WikiRate returns the
// answer set as an array of items with {metric, value, year, source}.
async function fetchAnswers(companySlug) {
  // The +Answer view is paginated; cap at 100 for the smoke / monthly run.
  const url = `${WIKIRATE_BASE}/${encodeURIComponent(companySlug)}+Answer.json?limit=100`;
  const data = await httpJson(url);
  if (data._notFound || data._error) return [];
  // WikiRate's +Answer card returns an array directly or an object with `items`.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Reduce a raw answer record to {topic, value, year, source}
function normalizeAnswer(a) {
  const metric = a.metric || a.metric_name || a.designer + "+" + a.title || "";
  const topic  = (metric || "").split("+").pop() || metric || "Unknown";
  const value  = a.value ?? a.answer ?? a.content ?? null;
  const year   = a.year ?? a.report_year ?? null;
  const source = a.source || a.source_url ||
                 (Array.isArray(a.sources) && a.sources[0]) || null;
  return { topic, value, year, source };
}

async function fetchBrandMetrics(brand) {
  const wikirateSlug = await resolveCompany(brand);
  if (!wikirateSlug) {
    return { slug: brand.slug, name: brand.name, status: "not_found" };
  }

  await sleep(REQ_DELAY_MS);
  const rawAnswers = await fetchAnswers(wikirateSlug);

  const valued = rawAnswers
    .map(normalizeAnswer)
    .filter(a => a.value !== null && a.value !== "" && a.value !== "Unknown");

  if (valued.length === 0) {
    return {
      slug: brand.slug,
      name: brand.name,
      status: "no_metrics",
      wikirate_slug: wikirateSlug,
    };
  }

  // Rank by recency: prefer answers with a numeric year, newest first.
  valued.sort((a, b) => {
    const ya = Number(a.year) || 0;
    const yb = Number(b.year) || 0;
    return yb - ya;
  });
  const top = valued.slice(0, 10);

  // Completeness: we treat the sample window as a denominator proxy.
  // If every solicited metric has a value, we're at 100%. The +Answer
  // endpoint only returns answered metrics, so this is the lower bound:
  // valued / max(rawAnswers.length, valued.length).
  const denom = Math.max(rawAnswers.length, valued.length);
  const completeness = denom > 0 ? Math.round(valued.length / denom * 100) : 0;

  return {
    slug: brand.slug,
    name: brand.name,
    status: "ok",
    wikirate_slug: wikirateSlug,
    wikirate_metrics_count: valued.length,
    top_metrics: top,
    data_completeness_pct: completeness,
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  console.log(`WikiRate fetcher starting${SMOKE ? " (smoke mode)" : ""}...`);
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandMetrics(brands[i]);
    results.push(r);
    if (i % 25 === 0) console.log(`  ...${i}/${brands.length}`);
    await sleep(REQ_DELAY_MS);
  }

  const ok       = results.filter(r => r.status === "ok").length;
  const noMetric = results.filter(r => r.status === "no_metrics").length;
  const notFound = results.filter(r => r.status === "not_found").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    brand_count:  brands.length,
    ok_count:     ok,
    no_metrics_count: noMetric,
    not_found_count:  notFound,
    metrics:      results,
  }, null, 2));

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  With metrics: ${ok}`);
  console.log(`  No metrics:   ${noMetric}`);
  console.log(`  Not found:    ${notFound}`);
}

main().catch(err => {
  console.error("wikirate-fetch failed:", err);
  process.exit(1);
});
