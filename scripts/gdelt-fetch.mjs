#!/usr/bin/env node
/**
 * GDELT Project — global multilingual news collector (weekly)
 *
 * Complements scripts/news-rss-collect.mjs (US-centric Google News RSS).
 * GDELT crawls global press in 100+ languages, so it surfaces coverage
 * domestic outlets underweight — e.g. labor abuses in supplier countries,
 * environmental enforcement abroad, human rights coverage from
 * international press.
 *
 * For each brand in /public/data/top-500-brands.txt, queries GDELT DOC 2.0
 * over the last 30 days and aggregates:
 *   - total_mentions     — article count returned (capped at maxrecords)
 *   - top_countries      — sourcecountry frequency, top 5
 *   - top_languages      — language frequency, top 5
 *   - top_domains        — outlet frequency, top 5
 *   - tone_distribution  — GDELT V2TONE histogram from tonechart mode
 *   - avg_tone           — mean tone bin (weighted by count)
 *   - sample_articles    — 10 most recent (title, URL, domain, country, language, date)
 *
 * Output: /public/data/gdelt.json
 *
 * GDELT DOC 2.0 API: https://api.gdeltproject.org/api/v2/doc/doc
 * Field reference:    https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * Rate limit: GDELT is sensitive — observed ~5s/request soft limit.
 * We pace at 1 req/sec base, retry with exponential backoff on the
 * "Please limit requests to one every 5 seconds" rejection string.
 *
 * Differentiator vs Google News RSS:
 *   - GDELT covers 100+ languages (Google News RSS is US English)
 *   - GDELT has machine-coded tone (V2TONE) per article
 *   - GDELT exposes sourcecountry → directly answers "who covers this brand
 *     abroad?", which is the signal we want for international exposure flags
 *
 * Runs via .github/workflows/gdelt-weekly.yml Monday 02:00 UTC.
 * Locally:
 *   node scripts/gdelt-fetch.mjs                         # full run, 528 brands
 *   node scripts/gdelt-fetch.mjs --only nestle,nike,shell  # smoke test
 *   node scripts/gdelt-fetch.mjs --tone --only nestle      # include tonechart (2× requests)
 *
 * Timing: GDELT enforces ~5s/request, so a full 528-brand artlist sweep
 * is ~50 minutes wall-clock. The weekly workflow sets a 45-min timeout;
 * if we ever blow that, switch to artlist-only (default) and run tone
 * sweeps less often.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/gdelt.json");

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const USER_AGENT = "TruNorth-GDELT/1.0 (+https://www.trunorthapp.com)";

// Pace: spec asks for 1 req/sec, but GDELT enforces a stricter ~5s
// soft limit (returns "Please limit requests to one every 5 seconds").
// We hold to 5.5s between calls and back off further on rejection.
const BASE_DELAY_MS  = 5_100;
const MAX_BACKOFF_MS = 60_000;
const MAX_ATTEMPTS   = 5;
const FETCH_TIMEOUT  = 25_000;
const MAX_RECORDS    = 75;       // GDELT caps at 250; 75 keeps payloads small
const TIMESPAN       = "30d";    // last 30 days

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// GDELT rejects single-word queries (even quoted) with "Queries
// containing only a single phrase need to be enclosed in quotes" — a
// misleading error: what it actually wants is multiple phrases joined
// by OR, or a multi-word quoted phrase. We disambiguate by appending
// "AND sourcelang:eng" so single brand names pass through; for very
// short names we expand into "Inc/Corp/Company" alternates as well.
function buildQuery(name) {
  const trimmed = name.trim();
  const hasSpace = trimmed.includes(" ");
  if (hasSpace) {
    // Multi-word phrases work as-is when quoted.
    return `"${trimmed}"`;
  }
  // Single-word brand: GDELT rejects "Nike" alone. Expand into multiple
  // corporate-suffix phrases — this satisfies the multi-phrase rule and
  // also tightens recall onto the actual corporation.
  return `"${trimmed} Inc" OR "${trimmed} Corp" OR "${trimmed} Company" OR "${trimmed} Group"`;
}

async function fetchWithBackoff(url, attempt = 1) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: ctl.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    // GDELT returns 200 with plaintext error strings on throttle / bad query.
    if (text.startsWith("Please limit requests")) {
      if (attempt >= MAX_ATTEMPTS) return { error: "rate_limited" };
      const wait = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_BACKOFF_MS);
      await sleep(wait);
      return fetchWithBackoff(url, attempt + 1);
    }
    if (text.startsWith("The specified phrase is too short")) {
      return { error: "phrase_too_short" };
    }
    if (text.startsWith("Queries containing")) {
      // "Queries containing only a single phrase need to be enclosed in
      // quotes" — GDELT's confusing signal that it wants multiple phrases
      // joined by OR. buildQuery() expands single-word names, but if a
      // brand like "Nestlé" (single accented word) still trips this, log
      // and skip — the brand needs a manual alias.
      return { error: "single_phrase_rejected" };
    }
    if (!res.ok) return { error: `http_${res.status}` };
    if (!text.trim()) return { articles: [] };
    try { return JSON.parse(text); }
    catch (e) { return { error: `parse_error: ${e.message}`, raw: text.slice(0, 200) }; }
  } catch (e) {
    clearTimeout(timer);
    if (attempt >= MAX_ATTEMPTS) return { error: `fetch_error: ${e.message}` };
    await sleep(BASE_DELAY_MS * 2 ** attempt);
    return fetchWithBackoff(url, attempt + 1);
  }
}

// "20260516T121500Z" → ISO "2026-05-16T12:15:00Z"
function gdeltDateToIso(s) {
  if (!s || s.length < 15) return null;
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`;
}

function topN(items, key, n = 5) {
  const counts = new Map();
  for (const it of items) {
    const v = it[key];
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

// tonechart returns bins from -10 to +10. Compute count-weighted mean.
function summarizeToneChart(tonechart) {
  if (!Array.isArray(tonechart) || tonechart.length === 0) return null;
  let total = 0;
  let weighted = 0;
  const dist = [];
  for (const b of tonechart) {
    const bin = Number(b.bin);
    const count = Number(b.count) || 0;
    total += count;
    weighted += bin * count;
    if (count > 0) dist.push({ bin, count });
  }
  if (total === 0) return null;
  return {
    avg_tone:    Number((weighted / total).toFixed(2)),
    sample_size: total,
    distribution: dist.sort((a, b) => a.bin - b.bin),
  };
}

async function fetchBrandArtlist(brand) {
  const q = buildQuery(brand.name);
  const url = `${GDELT_BASE}?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=${MAX_RECORDS}&timespan=${TIMESPAN}&sort=datedesc`;
  return fetchWithBackoff(url);
}

async function fetchBrandToneChart(brand) {
  const q = buildQuery(brand.name);
  const url = `${GDELT_BASE}?query=${encodeURIComponent(q)}&mode=tonechart&format=json&timespan=${TIMESPAN}`;
  return fetchWithBackoff(url);
}

// Whether to also fetch the tonechart endpoint. Doubles per-brand cost.
// Off in CI by default (timing) — set --tone to enable for local runs.
const FETCH_TONE = process.argv.includes("--tone");

async function processBrand(brand) {
  // 1. Article list — domains, countries, languages, sample
  const artResult = await fetchBrandArtlist(brand);

  if (artResult?.error) {
    return { slug: brand.slug, name: brand.name, status: artResult.error };
  }

  const articles = Array.isArray(artResult?.articles) ? artResult.articles : [];

  // 2. Tone chart — sentiment distribution (optional, double-cost call)
  let tone = null;
  if (FETCH_TONE && articles.length > 0) {
    await sleep(BASE_DELAY_MS);
    const toneResult = await fetchBrandToneChart(brand);
    tone = toneResult?.tonechart ? summarizeToneChart(toneResult.tonechart) : null;
  }

  // Flag international exposure: ≥3 distinct non-US source countries with
  // ≥2 articles each. Used by downstream UI to badge brands where
  // global press is materially covering them.
  const countryCounts = topN(articles, "sourcecountry", 20);
  const nonUsCountries = countryCounts.filter(c => c.label !== "United States" && c.count >= 2);
  const internationalExposure = nonUsCountries.length >= 3;

  return {
    slug:                brand.slug,
    name:                brand.name,
    status:              "ok",
    total_mentions:      articles.length,
    capped_at:           MAX_RECORDS,
    top_countries:       countryCounts.slice(0, 5),
    top_languages:       topN(articles, "language", 5),
    top_domains:         topN(articles, "domain", 5),
    tone:                tone,
    international_exposure: internationalExposure,
    non_us_country_count:   nonUsCountries.length,
    sample_articles:     articles.slice(0, 10).map(a => ({
      title:         a.title,
      url:           a.url,
      domain:        a.domain,
      sourcecountry: a.sourcecountry,
      language:      a.language,
      date:          gdeltDateToIso(a.seendate),
    })),
  };
}

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

function parseArgs(argv) {
  const args = { only: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--only" && argv[i + 1]) {
      args.only = argv[i + 1].split(",").map(s => s.trim().toLowerCase());
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log("🌍 GDELT fetch starting...");
  let brands = await loadBrands();
  if (args.only) {
    brands = brands.filter(b => args.only.includes(b.slug.toLowerCase()));
    console.log(`🎯 --only filter active: ${brands.length} brands`);
  }
  console.log(`📋 Processing ${brands.length} brands`);

  const results = [];
  let i = 0;
  for (const brand of brands) {
    const r = await processBrand(brand);
    results.push(r);
    i++;
    if (i % 25 === 0 || args.only) {
      const tag = r.status === "ok"
        ? `${r.total_mentions} mentions, ${r.top_countries.length} countries${r.international_exposure ? ", INTL" : ""}`
        : r.status;
      console.log(`  [${i}/${brands.length}] ${brand.slug} — ${tag}`);
    }
    // Pace between brands. Each brand made 2 requests already (artlist + tone),
    // so wait one more BASE_DELAY before moving on.
    if (i < brands.length) await sleep(BASE_DELAY_MS);
  }

  const ok = results.filter(r => r.status === "ok");
  const errors = results.filter(r => r.status !== "ok");
  const intl = ok.filter(r => r.international_exposure);

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date().toISOString(),
    source:              "gdelt-doc-2.0",
    timespan:            TIMESPAN,
    brand_count:         brands.length,
    ok_count:            ok.length,
    error_count:         errors.length,
    international_count: intl.length,
    brands:              results,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   OK: ${ok.length} / ${brands.length}`);
  console.log(`   Errors: ${errors.length}`);
  console.log(`   International exposure flagged: ${intl.length}`);
}

main().catch(err => {
  console.error("❌ gdelt-fetch failed:", err);
  process.exit(1);
});
