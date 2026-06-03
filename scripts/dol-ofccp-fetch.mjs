#!/usr/bin/env node
/**
 * DOL OFCCP (Office of Federal Contract Compliance Programs) — monthly
 *
 * OFCCP enforces equal-employment obligations on federal contractors:
 *   - Title VII / race-sex-religion discrimination (in hiring)
 *   - Section 503 (disability) and VEVRAA (veteran) compliance
 *   - Compliance reviews, audits, conciliation agreements
 *
 * OFCCP publishes enforcement outcomes via DOL press releases (settlements,
 * back-pay awards, debarments). There is no first-party JSON API and the
 * DOL site sits behind Akamai which 403s plain curl. So we scrape the
 * OFCCP press-release listing pages and the individual release HTML.
 *
 * Output: /public/data/dol-ofccp.json
 *
 * Per-brand schema (when there are hits):
 *   {
 *     slug, name, status: "ok",
 *     total_ofccp_actions_5y:  number,
 *     total_back_pay_owed_usd: number,
 *     top_violation_types:     [{ label, count }],   // discrimination/disability/veteran/...
 *     sample_cases: [
 *       { title, url, date, back_pay_usd, violation_types, snippet, location }
 *     ],
 *     scraped_at,
 *   }
 *
 * 1 req/sec, UA TruNorth-OFCCP/1.0.
 * Runs via .github/workflows/dol-ofccp-monthly.yml 1st of month 07:00 UTC.
 * Locally: node scripts/dol-ofccp-fetch.mjs
 *          node scripts/dol-ofccp-fetch.mjs --smoke
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/dol-ofccp.json");

const UA      = "TruNorth-OFCCP/1.0 (+https://www.trunorthapp.com)";
const REQUEST_DELAY_MS = 1000; // 1 req/sec per spec
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

// OFCCP press-release listings on dol.gov. The listing index walks back
// through paginated results until we cross the 5y cutoff.
const LISTING_BASE = "https://www.dol.gov/newsroom/releases/ofccp";
const MAX_LISTING_PAGES = 80;

// Smoke test: only these major federal contractors. (IBM is in the brands
// file; the others are added inline so the smoke pass is representative
// even before they're added to top-500.)
const SMOKE_MODE = process.argv.includes("--smoke");
const SMOKE_EXTRA = [
  { slug: "lockheed-martin", name: "Lockheed Martin" },
  { slug: "boeing",          name: "Boeing" },
  { slug: "raytheon",        name: "Raytheon" },
];
const SMOKE_BRAND_NAMES = new Set(["IBM", "Lockheed Martin", "Boeing", "Raytheon"]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  const fromFile = raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
  if (SMOKE_MODE) {
    const fromFileFiltered = fromFile.filter(b => SMOKE_BRAND_NAMES.has(b.name));
    return [...fromFileFiltered, ...SMOKE_EXTRA];
  }
  return fromFile;
}

async function fetchHtml(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        // Akamai is sometimes more permissive with these set:
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      if ((res.status === 403 || res.status >= 500) && attempt < 2) {
        await sleep(2000 * (attempt + 1));
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 2) {
      await sleep(2000 * (attempt + 1));
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract OFCCP release links from a listing page. Listings vary; we look
// for any anchor whose href is under /newsroom/releases/ofccp/ and that
// also carries a date snippet nearby (the DOL pattern: "Month DD, YYYY").
function extractListingLinks(html) {
  const out = [];
  const re = /<a[^>]+href="(\/newsroom\/releases\/ofccp\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripHtml(m[2]);
    if (text.length < 8) continue;
    if (/^(next|previous|prev|»|«|\d+)$/i.test(text)) continue;
    out.push({ url: `https://www.dol.gov${href}`, title: text });
  }
  // Dedup by url
  const seen = new Set();
  return out.filter(x => {
    if (seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });
}

// Parse release-detail page for date, body, and structured fields.
function parseReleaseDetail(html, fallbackTitle) {
  const text = stripHtml(html);
  // The DOL releases include a <time datetime="..."> or "Release Date: Month DD, YYYY"
  let date = null;
  const dtMatch = html.match(/datetime="(\d{4}-\d{2}-\d{2})/);
  if (dtMatch) date = dtMatch[1];
  if (!date) {
    const human = text.match(/Release Date:?\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
    if (human) {
      const d = new Date(human[1]);
      if (!isNaN(d)) date = d.toISOString().slice(0, 10);
    }
  }
  if (!date) {
    // Pull from URL: /newsroom/releases/ofccp/ofccp20240115
    const u = fallbackTitle?.url || "";
    const m = u.match(/(20\d{2})(\d{2})(\d{2})/);
    if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
  }

  // Title — prefer <h1>
  let title = fallbackTitle?.title || "";
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) title = stripHtml(h1[1]);

  // Location — many OFCCP releases tag a "WASHINGTON -" or "<CITY>, <STATE>"
  // dateline immediately after the lede.
  let location = null;
  const loc = text.match(/\b([A-Z][A-Z]+(?:,?\s+[A-Z]{2})?)\s+[—–-]\s+/);
  if (loc) location = loc[1];

  return { title, date, body: text, location };
}

// Extract dollar amounts from a body string. Returns the largest single
// amount mentioned (back-pay awards are typically headline numbers).
function extractDollar(body) {
  // Patterns like: "$2,500,000", "$2.5 million", "$250,000 in back pay"
  let max = 0;
  const re = /\$\s?([\d,]+(?:\.\d+)?)(\s?(million|billion|thousand))?/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const mult = m[3]?.toLowerCase();
    if (mult === "million") n *= 1_000_000;
    else if (mult === "billion") n *= 1_000_000_000;
    else if (mult === "thousand") n *= 1_000;
    if (n > max) max = n;
  }
  return max || null;
}

// Categorize a release into OFCCP violation types based on keyword presence.
function classifyViolations(body) {
  const lc = body.toLowerCase();
  const tags = new Set();
  if (/\brace\b|\bracial\b|african american|black applicant|hispanic|asian american|color discriminat/i.test(body)) tags.add("race");
  if (/\bsex\b|\bgender\b|female applicant|women applicant|pregnan/i.test(body)) tags.add("sex");
  if (/\bdisabilit|section 503|individuals with disabilities/i.test(body)) tags.add("disability");
  if (/\bveteran|vevraa|vietnam era/i.test(body)) tags.add("veteran");
  if (/national origin|\bage discriminat/i.test(body)) tags.add("other_protected_class");
  if (/\bhiring discriminat|systemic discriminat/i.test(body)) tags.add("hiring_discrimination");
  if (/\bpay discriminat|compensation discriminat|wage discriminat/i.test(body)) tags.add("pay_discrimination");
  if (/\bdebar|debarment/i.test(body)) tags.add("debarment");
  if (/conciliation agreement|early resolution|settlement/i.test(lc)) tags.add("settlement");
  if (/compliance review|compliance evaluation/i.test(lc)) tags.add("compliance_review");
  return [...tags];
}

// Build a fast lookup haystack per release.
function indexRelease(detail, url) {
  const haystack = `${detail.title}\n${detail.body}`.toLowerCase();
  const violations = classifyViolations(detail.body);
  const backPay = extractDollar(detail.body);
  return { ...detail, url, haystack, violations, backPay };
}

function compileMatcher(name) {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
}

function snippetAround(body, needle, ctx = 140) {
  const lc = body.toLowerCase();
  const i = lc.indexOf(needle.toLowerCase());
  if (i < 0) return "";
  const start = Math.max(0, i - ctx);
  const end = Math.min(body.length, i + needle.length + ctx);
  let s = body.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < body.length) s = s + "…";
  return s;
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

// Crawl OFCCP press-release listing pages until we cross 5y cutoff.
async function collectReleases() {
  const cutoff = Date.now() - FIVE_YEARS_MS;
  const releases = [];
  const seenUrls = new Set();

  for (let page = 0; page < MAX_LISTING_PAGES; page++) {
    const listUrl = page === 0 ? LISTING_BASE : `${LISTING_BASE}?page=${page}`;
    let html;
    try {
      html = await fetchHtml(listUrl);
    } catch (err) {
      console.error(`  listing page ${page}: ${err.message}`);
      // If we have already collected some releases, treat as end of feed;
      // otherwise propagate.
      if (releases.length > 0) break;
      if (page >= 2) break;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const links = extractListingLinks(html).filter(l => !seenUrls.has(l.url));
    if (links.length === 0) {
      console.log(`  listing page ${page}: no new links — stopping`);
      break;
    }

    let crossedCutoff = false;
    for (const link of links) {
      seenUrls.add(link.url);
      await sleep(REQUEST_DELAY_MS);
      let detailHtml;
      try {
        detailHtml = await fetchHtml(link.url);
      } catch (err) {
        console.warn(`    skip ${link.url}: ${err.message}`);
        continue;
      }
      const detail = parseReleaseDetail(detailHtml, link);
      if (!detail.date) continue;
      const t = Date.parse(detail.date);
      if (Number.isNaN(t)) continue;
      if (t < cutoff) { crossedCutoff = true; continue; }
      releases.push(indexRelease(detail, link.url));
    }

    console.log(`  page ${page}: ${links.length} links, total in window: ${releases.length}`);
    if (crossedCutoff && releases.length > 0) {
      // Listings are date-ordered; once we see any older-than-cutoff release
      // on a page, we can stop after finishing this page.
      break;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return releases;
}

function scanBrand(brand, indexed) {
  const re = compileMatcher(brand.name);
  const hits = indexed.filter(idx => re.test(idx.haystack));
  if (hits.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_actions" };
  }
  const violations = hits.flatMap(h => h.violations);
  const totalBack = hits.reduce((s, h) => s + (h.backPay || 0), 0);
  const recent = hits
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5)
    .map(h => ({
      title: h.title,
      url: h.url,
      date: h.date,
      back_pay_usd: h.backPay,
      violation_types: h.violations,
      location: h.location,
      snippet: snippetAround(h.body, brand.name),
    }));
  return {
    slug: brand.slug,
    name: brand.name,
    status: "ok",
    total_ofccp_actions_5y: hits.length,
    total_back_pay_owed_usd: totalBack || null,
    top_violation_types: topN(violations, 6),
    sample_cases: recent,
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  console.log("⚖️  DOL OFCCP fetcher starting…");
  if (SMOKE_MODE) console.log("   --smoke flag: Lockheed/Boeing/Raytheon/IBM");

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  console.log("⬇️  Crawling OFCCP press releases (5y window)…");
  const releases = await collectReleases();

  if (releases.length === 0) {
    console.error("❌ Zero releases collected. The DOL/Akamai layer likely blocked this run.");
    console.error("   The github-actions runner usually succeeds where local dev does not.");
    // Don't overwrite real output with empty results.
    process.exit(1);
  }

  console.log(`🔎 Scanning ${brands.length} brands against ${releases.length} releases…`);
  const results = brands.map(b => scanBrand(b, releases));
  const withHits = results.filter(r => r.status === "ok").length;

  const payload = {
    generated_at:           new Date().toISOString(),
    window_years:           5,
    brand_count:            brands.length,
    releases_scanned:       releases.length,
    brands_with_actions:    withHits,
    smoke:                  SMOKE_MODE,
    actions:                results,
  };

  if (SMOKE_MODE) {
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\n✅ Smoke output → ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\n✅ Wrote ${OUT_FILE}`);
  }
  console.log(`   Brands with OFCCP actions: ${withHits}`);

  for (const r of results.filter(x => x.status === "ok").slice(0, 5)) {
    const bp = r.total_back_pay_owed_usd
      ? `$${r.total_back_pay_owed_usd.toLocaleString()}`
      : "no back-pay quoted";
    console.log(`   ${r.name}: ${r.total_ofccp_actions_5y} actions, ${bp}`);
    for (const c of r.sample_cases.slice(0, 2)) {
      console.log(`     [${c.date}] ${c.title.slice(0, 90)}`);
    }
  }
}

main().catch(err => {
  console.error("❌ dol-ofccp-fetch failed:", err);
  process.exit(1);
});
