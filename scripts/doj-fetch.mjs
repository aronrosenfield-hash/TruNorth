#!/usr/bin/env node
/**
 * DOJ Press Release scraper (weekly)
 *
 * Scrapes the last 90 days of US Department of Justice press releases
 * via the official, undocumented-but-public JSON API:
 *
 *   https://www.justice.gov/api/v1/press_releases.json
 *
 * No auth, no Cloudflare. Results are returned ascending by date, so we
 * walk backwards from the final page until we hit the 90-day cutoff.
 *
 * For each of ~528 brands in /public/data/top-500-brands.txt, we
 * full-text search the title + body + teaser of every press release
 * in the window. Per-brand aggregate written to:
 *
 *   /public/data/doj-mentions.json
 *
 * Per-brand schema (when there are hits):
 *   {
 *     slug, name, status: "ok",
 *     total_doj_mentions_90d: number,
 *     antitrust_mentions:    number,   // ATR / Antitrust Division
 *     fraud_mentions:        number,   // criminal/civil fraud keywords
 *     criminal_mentions:     number,   // criminal-division attribution
 *     recent_releases: [                // top 5 most recent
 *       { title, url, date, components, category, snippet }
 *     ],
 *     scraped_at,
 *   }
 *
 * Runs via .github/workflows/doj-weekly.yml Sunday 21:00 UTC.
 * Locally: node scripts/doj-fetch.mjs
 *          node scripts/doj-fetch.mjs --smoke   # 3-brand smoke test
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/doj-mentions.json");

const DOJ_API = "https://www.justice.gov/api/v1/press_releases.json";
const UA      = "TruNorth-DOJ/1.0 (+https://www.trunorthapp.com)";
const PAGESIZE = 50;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const REQUEST_DELAY_MS = 800;   // polite throttle: ~75 req/min
const MAX_PAGES = 200;          // safety cap (~10,000 releases)
const SMOKE_MODE = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set(["google", "apple", "meta"]);

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
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

// Find the last page index by binary search bounded by the count meta.
async function findLastPage() {
  const head = await fetchJson(`${DOJ_API}?pagesize=${PAGESIZE}&page=0`);
  const count = parseInt(head?.metadata?.resultset?.count ?? "0", 10);
  if (!count) throw new Error("DOJ API returned zero count");
  const lastPage = Math.ceil(count / PAGESIZE) - 1;
  console.log(`  DOJ total releases: ${count.toLocaleString()} (last page ≈ ${lastPage})`);
  return lastPage;
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

function normalize(s) {
  return stripHtml(s).toLowerCase();
}

// Pull the actual press release date (epoch seconds) from the record.
function recordDate(r) {
  const t = parseInt(r?.date ?? "0", 10);
  return Number.isFinite(t) && t > 0 ? t * 1000 : null;
}

// Crawl backwards from the last page until we cross the 90-day cutoff.
async function collectRecentReleases() {
  const lastPage = await findLastPage();
  const cutoff = Date.now() - NINETY_DAYS_MS;
  const out = [];
  let page = lastPage;
  let pagesScanned = 0;
  let stopped = false;

  while (page >= 0 && pagesScanned < MAX_PAGES && !stopped) {
    const url = `${DOJ_API}?pagesize=${PAGESIZE}&page=${page}`;
    let data;
    try { data = await fetchJson(url); }
    catch (err) { console.error(`  page ${page} failed: ${err.message}`); page--; pagesScanned++; await sleep(REQUEST_DELAY_MS); continue; }

    const results = data?.results ?? [];
    let pageHadInWindow = false;
    for (const r of results) {
      const t = recordDate(r);
      if (t === null) continue;
      if (t >= cutoff) {
        out.push(r);
        pageHadInWindow = true;
      }
    }

    pagesScanned++;
    // Once a page contains zero in-window results AND we've scanned a few
    // pages, we can safely stop — data is sorted ascending so older = earlier
    // pages will be even older.
    if (!pageHadInWindow && pagesScanned > 2) stopped = true;
    if (pagesScanned % 5 === 0) console.log(`  …scanned page ${page} (${out.length} in window)`);
    page--;
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`  Collected ${out.length} releases in the last 90 days (${pagesScanned} pages scanned)`);
  return out;
}

// Build a haystack string (lowercased, html-stripped) for each release once,
// so per-brand scanning is fast.
function indexReleases(releases) {
  return releases.map(r => {
    const title = stripHtml(r.title || "");
    const body  = stripHtml(r.body  || "");
    const teaser= stripHtml(r.teaser|| "");
    const components = Array.isArray(r.component) ? r.component.map(c => c.name).filter(Boolean) : [];
    const topic = stripHtml(r.topic || "");
    const url   = r.url || "";
    const date  = recordDate(r);
    const haystack = `${title}\n${teaser}\n${body}\n${components.join(" ")}\n${topic}`.toLowerCase();
    return { title, body, teaser, components, topic, url, date, haystack };
  });
}

// Word-boundary match for a brand name. We require the brand as a whole word
// (case-insensitive). Avoids matching "apple" inside "snapple", "Meta" inside
// "metadata", etc. Multi-word brands ("General Motors") match as a phrase.
function compileMatcher(name) {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // word-boundary at start, word-boundary at end (handles apostrophes & hyphens)
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
}

// Classify a release into category tags using component names and keywords.
function classifyRelease(idx) {
  const tags = new Set();
  const comp = idx.components.join(" ").toLowerCase();
  const body = idx.haystack;

  if (comp.includes("antitrust") || body.includes("antitrust division") ||
      / antitrust /i.test(idx.haystack) || / sherman act/i.test(idx.haystack) ||
      / clayton act/i.test(idx.haystack)) {
    tags.add("antitrust");
  }
  if (comp.includes("criminal")) tags.add("criminal");
  if (/\bfraud\b/.test(body) || /false claims act/i.test(body) ||
      /money laundering/i.test(body) || /securities fraud/i.test(body)) {
    tags.add("fraud");
  }
  if (comp.includes("civil rights")) tags.add("civil_rights");
  if (comp.includes("environment") || comp.includes("enrd")) tags.add("environment");
  if (comp.includes("tax")) tags.add("tax");
  return [...tags];
}

function snippetAround(haystack, needleLc, ctx = 100) {
  const i = haystack.indexOf(needleLc);
  if (i < 0) return "";
  const start = Math.max(0, i - ctx);
  const end = Math.min(haystack.length, i + needleLc.length + ctx);
  let s = haystack.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < haystack.length) s = s + "…";
  return s;
}

function scanBrand(brand, indexed) {
  const name = brand.name;
  const re = compileMatcher(name);
  const needleLc = name.toLowerCase();
  const hits = [];
  for (const idx of indexed) {
    if (!re.test(idx.haystack)) continue;
    const categories = classifyRelease(idx);
    hits.push({
      title: idx.title,
      url: idx.url,
      date: idx.date ? new Date(idx.date).toISOString().slice(0, 10) : null,
      components: idx.components,
      categories,
      snippet: snippetAround(idx.haystack, needleLc),
    });
  }
  if (hits.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_mentions" };
  }

  // Count by category
  let antitrust = 0, fraud = 0, criminal = 0;
  for (const h of hits) {
    if (h.categories.includes("antitrust")) antitrust++;
    if (h.categories.includes("fraud"))     fraud++;
    if (h.categories.includes("criminal"))  criminal++;
  }

  // Sort by date desc, keep top 5
  const recent = hits
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);

  return {
    slug:                   brand.slug,
    name:                   brand.name,
    status:                 "ok",
    total_doj_mentions_90d: hits.length,
    antitrust_mentions:     antitrust,
    fraud_mentions:         fraud,
    criminal_mentions:      criminal,
    recent_releases:        recent,
    scraped_at:             new Date().toISOString(),
  };
}

async function main() {
  console.log("⚖️  DOJ press-release fetcher starting…");
  if (SMOKE_MODE) console.log("   --smoke flag: scanning only google/apple/meta");

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE_MODE) brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));

  console.log("⬇️  Crawling last 90 days of DOJ press releases…");
  const releases = await collectRecentReleases();
  if (releases.length === 0) {
    console.error("❌ Got zero releases — aborting without overwriting output.");
    process.exit(1);
  }
  const indexed = indexReleases(releases);

  console.log(`🔎 Scanning ${brands.length} brands against ${indexed.length} releases…`);
  const results = brands.map(b => scanBrand(b, indexed));
  const withHits = results.filter(r => r.status === "ok").length;

  const window_start = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
  const window_end   = new Date().toISOString();

  const payload = {
    generated_at:           window_end,
    window_start,
    window_end,
    brand_count:            brands.length,
    releases_scanned:       indexed.length,
    brands_with_mentions:   withHits,
    smoke:                  SMOKE_MODE,
    mentions:               results,
  };

  if (SMOKE_MODE) {
    // Don't overwrite the real file in smoke mode.
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\n✅ Smoke output → ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\n✅ Wrote ${OUT_FILE}`);
  }
  console.log(`   Brands with DOJ mentions: ${withHits}`);
  console.log(`   Releases scanned:         ${indexed.length}`);

  // Print sample for smoke-test visibility
  for (const r of results.filter(x => x.status === "ok").slice(0, 5)) {
    console.log(`\n   ${r.name} — ${r.total_doj_mentions_90d} mentions (antitrust=${r.antitrust_mentions} fraud=${r.fraud_mentions} criminal=${r.criminal_mentions})`);
    for (const rel of r.recent_releases.slice(0, 3)) {
      console.log(`     [${rel.date}] ${rel.title.slice(0, 100)}`);
    }
  }
}

main().catch(err => {
  console.error("❌ doj-fetch failed:", err);
  process.exit(1);
});
