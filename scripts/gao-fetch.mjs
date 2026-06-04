#!/usr/bin/env node
/**
 * GAO Reports & Testimonies fetcher (monthly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the public
 * GAO search API for reports/testimonies mentioning that brand (federal
 * contractor oversight, bid protests, audits, etc.) within the last 5
 * years. Most consumer brands have zero hits — the relevant universe is
 * federal contractors (defense primes, IT services, healthcare, etc.).
 *
 * Data source:
 *   https://www.gao.gov/api/v1/reports?q=<brand>
 *   (the same backend that powers https://www.gao.gov/reports-testimonies)
 *
 * No auth required. We honor a 1 req/sec throttle and identify ourselves
 * via UA "TruNorth-GAO/1.0".
 *
 * Output: /public/data/gao-reports.json (overwritten monthly)
 *
 * Per-brand aggregate schema (when hits found):
 *   {
 *     slug, name, status: "ok",
 *     total_GAO_reports_5y:   number,
 *     total_bid_protests:     number,   // GAO_TYPE === "Bid Protest" or topic match
 *     top_topics:             [{ topic, count }],  // up to 5
 *     sample_reports: [                            // up to 5 most recent
 *       { title, url, date, gao_id, type, topics, snippet }
 *     ],
 *     scraped_at,
 *   }
 *
 * Runs monthly via .github/workflows/gao-monthly.yml (2nd of month, 00:00 UTC).
 * Locally: node scripts/gao-fetch.mjs
 *          node scripts/gao-fetch.mjs --smoke   # 5-brand smoke test
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/gao-reports.json");

const GAO_API  = "https://www.gao.gov/api/v1/reports";
const UA       = "TruNorth-GAO/1.0";
const PAGESIZE = 50;
const MAX_PAGES_PER_BRAND = 4;          // 200 results plenty per brand
const REQUEST_DELAY_MS    = 1000;       // 1 req/sec polite throttle
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const SMOKE_MODE = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set([
  "lockheed-martin", "boeing", "raytheon", "ibm", "northrop-grumman",
]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchJson(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Word-boundary match for a brand name. Multi-word brands ("Lockheed Martin")
// match as a phrase. We require the brand as a whole word to avoid noise
// like "ibm" matching inside "ibmx".
function compileMatcher(name) {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function snippetAround(haystack, needleLc, ctx = 100) {
  const i = haystack.toLowerCase().indexOf(needleLc);
  if (i < 0) return "";
  const start = Math.max(0, i - ctx);
  const end = Math.min(haystack.length, i + needleLc.length + ctx);
  let s = haystack.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < haystack.length) s = s + "…";
  return s;
}

// Normalize a single GAO record from the API into our internal shape.
function normalizeRecord(r) {
  const title = stripHtml(r.title || r.report_title || "");
  const body  = stripHtml(r.description || r.summary || r.highlights || r.abstract || "");
  const url   = r.url || r.link || (r.gao_id ? `https://www.gao.gov/products/${r.gao_id}` : "");
  const dateStr = r.released_date || r.publication_date || r.date || r.issued_date || null;
  const date  = parseDate(dateStr);
  const gaoId = r.gao_id || r.document_number || r.id || null;
  const type  = r.document_type || r.type || r.gao_type || "";
  // GAO uses "topics" or "subject_areas" depending on API version.
  let topics = r.topics || r.subject_areas || r.subjects || [];
  if (!Array.isArray(topics)) topics = [topics].filter(Boolean);
  topics = topics.map(t => (typeof t === "string" ? t : (t?.name || t?.label || ""))).filter(Boolean);
  const haystack = `${title}\n${body}\n${topics.join(" ")}\n${type}`;
  return { title, body, url, date, gaoId, type, topics, haystack };
}

// Pull all reports for one brand by paging through the GAO search API.
async function fetchBrandReports(brand) {
  const cutoff = Date.now() - FIVE_YEARS_MS;
  const q = encodeURIComponent(brand.name);
  const collected = [];
  let totalSeen = 0;

  for (let page = 1; page <= MAX_PAGES_PER_BRAND; page++) {
    const url = `${GAO_API}?q=${q}&page=${page}&per_page=${PAGESIZE}`;
    let data;
    try { data = await fetchJson(url); }
    catch (err) {
      return { status: "error", error: err.message };
    }

    // GAO may return results under various keys depending on endpoint version.
    const results =
      data?.results ||
      data?.reports ||
      data?.data ||
      (Array.isArray(data) ? data : []) ||
      [];

    if (!Array.isArray(results) || results.length === 0) break;

    totalSeen += results.length;
    for (const raw of results) {
      const rec = normalizeRecord(raw);
      if (rec.date !== null && rec.date < cutoff) continue;
      collected.push(rec);
    }

    if (results.length < PAGESIZE) break;
    await sleep(REQUEST_DELAY_MS);
  }

  if (collected.length === 0) {
    return { status: "no_match", raw_candidate_count: totalSeen };
  }

  // Client-side filter: title/body/topics must contain brand as whole word.
  const re = compileMatcher(brand.name);
  const needleLc = brand.name.toLowerCase();
  const hits = collected.filter(r => re.test(r.haystack));

  if (hits.length === 0) {
    return { status: "no_match", raw_candidate_count: totalSeen };
  }

  // Bid protests: identify by type or topic keywords.
  const isBidProtest = (h) => {
    const t = (h.type || "").toLowerCase();
    if (t.includes("bid protest") || t === "decisions") return true;
    return h.topics.some(tp => /bid protest/i.test(tp));
  };
  const bidProtests = hits.filter(isBidProtest).length;

  // Aggregate top topics.
  const topicCounts = new Map();
  for (const h of hits) {
    for (const t of h.topics) {
      const key = t.trim();
      if (!key) continue;
      topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
    }
  }
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));

  // Sample reports: most recent 5.
  const sample = hits
    .slice()
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, 5)
    .map(h => ({
      title:   h.title,
      url:     h.url,
      date:    h.date ? new Date(h.date).toISOString().slice(0, 10) : null,
      gao_id:  h.gaoId,
      type:    h.type || null,
      topics:  h.topics.slice(0, 5),
      snippet: snippetAround(h.haystack, needleLc),
    }));

  return {
    status:               "ok",
    total_GAO_reports_5y: hits.length,
    total_bid_protests:   bidProtests,
    top_topics:           topTopics,
    sample_reports:       sample,
  };
}

async function main() {
  console.log("📊 GAO reports fetcher starting…");
  if (SMOKE_MODE) console.log("   --smoke flag: scanning only Lockheed/Boeing/Raytheon/IBM/Northrop");

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE_MODE) brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));

  const results = [];
  let ok = 0, noMatch = 0, errors = 0;
  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    const out = await fetchBrandReports(brand);
    results.push({ slug: brand.slug, name: brand.name, ...out, scraped_at: new Date().toISOString() });
    if (out.status === "ok") ok++;
    else if (out.status === "no_match") noMatch++;
    else errors++;
    if ((i + 1) % 25 === 0 || SMOKE_MODE) {
      console.log(`  …${i + 1}/${brands.length} (ok=${ok} no_match=${noMatch} err=${errors})`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const payload = {
    generated_at:        new Date().toISOString(),
    source:              "GAO reports & testimonies search API",
    source_endpoint:     GAO_API,
    window_years:        5,
    brand_count:         brands.length,
    brands_with_reports: ok,
    no_match_count:      noMatch,
    error_count:         errors,
    smoke:               SMOKE_MODE,
    reports:             results,
  };

  if (SMOKE_MODE) {
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\n✅ Smoke output → ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\n✅ Wrote ${OUT_FILE}`);
  }
  console.log(`   Brands with GAO reports: ${ok}`);
  console.log(`   No-match brands:         ${noMatch}`);
  console.log(`   Errors:                  ${errors}`);

  for (const r of results.filter(x => x.status === "ok").slice(0, 5)) {
    console.log(`\n   ${r.name} — ${r.total_GAO_reports_5y} reports (${r.total_bid_protests} bid protests)`);
    for (const rep of r.sample_reports.slice(0, 3)) {
      console.log(`     [${rep.date}] ${(rep.title || "").slice(0, 100)}`);
    }
  }
}

main().catch(err => {
  console.error("❌ gao-fetch failed:", err);
  process.exit(1);
});
