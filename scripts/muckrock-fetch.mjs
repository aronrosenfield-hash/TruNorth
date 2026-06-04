#!/usr/bin/env node
/**
 * MuckRock FOIA Database — monthly fetch
 *
 * For each brand in /public/data/top-500-brands.txt, queries MuckRock's
 * public FOIA request search for requests that name the brand. MuckRock
 * is a non-profit news org that files, tracks, and publishes the results
 * of FOIA requests against US federal/state/local agencies — many of
 * which name corporate actors as subjects of investigations, complaints,
 * or contracts.
 *
 * Output: /public/data/muckrock-foia.json (overwritten monthly)
 *
 * Per-brand aggregates:
 *   - total_muckrock_requests — count of public requests
 *   - completed_requests       — count in terminal "done"/"partial"/"no_docs"
 *   - top_topics               — tag breakdown (top 5)
 *   - top_statuses             — status breakdown (top 5)
 *   - sample_requests          — 5 most recent w/ URL, agency, status
 *
 * Strategy: MuckRock's REST API at /api_v1/foia/ does NOT support free-text
 * search on title/body (those params are silently ignored). Instead we use
 * the website's search at /search/?q=<brand>&models=foia.foiarequest, parse
 * the HTML to extract result count and the per-request URLs/IDs, then
 * hydrate the top-5 sample via the API for status/agency/date fields.
 *
 * Runs via .github/workflows/muckrock-monthly.yml on the 2nd at 02:00 UTC.
 * Locally:  node scripts/muckrock-fetch.mjs
 *           node scripts/muckrock-fetch.mjs --smoke   # Meta/Google/Amazon/Palantir
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/muckrock-foia.json");

const SITE_BASE   = "https://www.muckrock.com";
const API_BASE    = `${SITE_BASE}/api_v1`;
const UA = "TruNorth-MuckRock/1.0 (+https://www.trunorthapp.com)";
const RATE_DELAY_MS = 1000;   // 1 req/sec courtesy (per task spec)
const MAX_SAMPLE_HYDRATE = 5; // number of detail API calls per brand

const SMOKE_SLUGS = new Set(["meta", "google", "amazon", "palantir"]);

// MuckRock terminal "completed" states (request produced an outcome).
const COMPLETED_STATUSES = new Set(["done", "partial", "no_docs"]);

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

async function fetchWithRetry(url, { accept = "application/json" } = {}, attempt = 0) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": accept },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      const wait = 5000 * Math.pow(3, attempt);
      console.log(`   rate-limited (HTTP ${res.status}), waiting ${wait/1000}s...`);
      await new Promise(r => setTimeout(r, wait));
      return fetchWithRetry(url, { accept }, attempt + 1);
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

// Parse the /search/?q=<brand>&models=foia.foiarequest HTML.
// Returns { total, links: [{ id, slug, jurisdictionSlug, path }] }.
function parseSearchHtml(html) {
  // "Showing 1 to 25 of 301" — captures the total count.
  let total = 0;
  const m = html.match(/Showing\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)/i);
  if (m) total = parseInt(m[1].replace(/,/g, ""), 10) || 0;

  // FOIA request links look like: /foi/<jurisdiction-slug>/<title-slug>-<id>/
  // Filter out the navigation links like /foi/create/, /foi/list/, /foi/feeds/...
  const linkRe = /href="(\/foi\/([a-z0-9-]+)\/([a-z0-9-]+)-(\d+)\/)"/gi;
  const seen = new Set();
  const links = [];
  let lm;
  while ((lm = linkRe.exec(html)) !== null) {
    const [, p, jurisdictionSlug, slug, id] = lm;
    if (seen.has(id)) continue;
    seen.add(id);
    links.push({ id: parseInt(id, 10), slug, jurisdictionSlug, path: p });
  }
  return { total, links };
}

async function fetchSearchPage(brandName) {
  // /foi/list/?q=<brand> is MuckRock's FOIA-only search page (more reliable
  // than the global /search/ which can return news/article hits even when
  // models=foia.foiarequest is set).
  const url = `${SITE_BASE}/foi/list/?q=${encodeURIComponent(brandName)}`;
  const res = await fetchWithRetry(url, { accept: "text/html" });
  const html = await res.text();
  const parsed = parseSearchHtml(html);
  if (process.env.MUCKROCK_DEBUG) {
    console.log(`   [debug] ${brandName}: html.len=${html.length} total=${parsed.total} links=${parsed.links.length}`);
  }
  return parsed;
}

async function hydrateRequest(id) {
  const url = `${API_BASE}/foia/${id}/?format=json`;
  try {
    const res = await fetchWithRetry(url, { accept: "application/json" });
    return await res.json();
  } catch (err) {
    return { id, _hydration_error: err.message };
  }
}

async function fetchBrandRequests(brand) {
  let search;
  try {
    search = await fetchSearchPage(brand.name);
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }

  if (search.total === 0 || search.links.length === 0) {
    return {
      slug: brand.slug,
      name: brand.name,
      status: "no_requests",
      total_muckrock_requests: 0,
    };
  }

  // Hydrate top N (most-recent-ish — search returns by relevance by default,
  // which is a reasonable proxy for sample selection). Pace each hydrate
  // call with the rate-delay.
  const toHydrate = search.links.slice(0, MAX_SAMPLE_HYDRATE);
  const hydrated = [];
  for (const link of toHydrate) {
    await new Promise(r => setTimeout(r, RATE_DELAY_MS));
    const detail = await hydrateRequest(link.id);
    hydrated.push({ link, detail });
  }

  // Aggregate fields from the hydrated subset (best-effort signal — full
  // aggregates over all results would require fetching every page).
  const statuses = hydrated.map(h => h.detail?.status).filter(Boolean);
  const tags = hydrated.flatMap(h => {
    const t = h.detail?.tags;
    if (!Array.isArray(t)) return [];
    return t.map(x => typeof x === "string" ? x : (x?.name || ""));
  });

  const completed = statuses.filter(s => COMPLETED_STATUSES.has(s)).length;
  // Extrapolate completed rate to total if we have a sample; otherwise pass
  // through the raw sampled-count.
  const completedExtrapolated = statuses.length
    ? Math.round((completed / statuses.length) * search.total)
    : null;

  const sample = hydrated.map(({ link, detail }) => ({
    id:              link.id,
    title:           detail?.title || null,
    status:          detail?.status || null,
    date_submitted:  detail?.datetime_submitted || null,
    date_done:       detail?.datetime_done || null,
    agency_id:       typeof detail?.agency === "number" ? detail.agency : null,
    jurisdiction_slug: link.jurisdictionSlug,
    url:             `${SITE_BASE}${link.path}`,
  }));

  return {
    slug:                     brand.slug,
    name:                     brand.name,
    status:                   "ok",
    total_muckrock_requests:  search.total,
    completed_requests:       completedExtrapolated,
    sampled_count:            hydrated.length,
    top_topics:               topN(tags, 5),
    top_statuses:             topN(statuses, 5),
    sample_requests:          sample,
    scraped_at:               new Date().toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`Starting MuckRock fetch${smoke ? " (smoke test)" : ""}...`);
  let brands = await loadBrands();
  if (smoke) brands = brands.filter(b => SMOKE_SLUGS.has(b.slug));
  console.log(`Loaded ${brands.length} brands`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandRequests(brands[i]);
    results.push(r);
    if (i % 25 === 0) console.log(`  ...${i}/${brands.length} (${brands[i].slug})`);
    await new Promise(r => setTimeout(r, RATE_DELAY_MS));
  }

  const withReqs = results.filter(r => r.status === "ok").length;
  const noReqs   = results.filter(r => r.status === "no_requests").length;
  const errCount = results.filter(r => r.status === "error").length;

  const payload = {
    generated_at:           new Date().toISOString(),
    source:                 "muckrock",
    source_url:             "https://www.muckrock.com",
    brand_count:            brands.length,
    with_requests_count:    withReqs,
    no_requests_count:      noReqs,
    error_count:            errCount,
    requests:               results,
  };

  if (smoke) {
    console.log("\nSMOKE TEST RESULTS:");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With requests: ${withReqs}`);
  console.log(`   No requests:   ${noReqs}`);
  console.log(`   Errors:        ${errCount}`);
}

main().catch(err => {
  console.error("muckrock-fetch failed:", err);
  process.exit(1);
});
