#!/usr/bin/env node
/**
 * Oversight.gov Inspector General report scraper (monthly).
 *
 * Oversight.gov is the federal CIGIE (Council of the Inspectors General on
 * Integrity and Efficiency) clearinghouse that aggregates reports from
 * 70+ Inspectors General — every federal IG plus a few state/local
 * offices. The site is a Drupal 10 Search-API view; there is no
 * official JSON API (the once-advertised api.oversight.gov endpoint
 * has been retired). We scrape the public HTML listing page:
 *
 *   https://www.oversight.gov/reports/federal
 *     ?search_api_fulltext=<brand>
 *     &field_report_date_issued[min]=<YYYY-MM-DD>
 *     &field_report_date_issued[max]=<YYYY-MM-DD>
 *     &items_per_page=50
 *     &page=<n>
 *
 * Each result row is a <tr class="listing-table__row table-row"> with:
 *   - Report Date    (datetime attribute on the <time> tag)
 *   - Agency Reviewed / Investigated
 *   - Report Title
 *   - Type           (Audit / Inspection / Evaluation / Investigation / etc.)
 *   - Location
 *   - URL            (relative /reports/... slug)
 *
 * The follow-up <tr class="listing-table__container ..."> "Report Highlights"
 * accordion holds the submitting OIG name + description.
 *
 * For each brand in /public/data/top-500-brands.txt we issue a single
 * full-text search scoped to the last 5 years. Per-brand schema:
 *   {
 *     slug, name, status: "ok",
 *     total_ig_reports_5y:        number,
 *     top_agencies_reporting:     [{ label, count }],
 *     top_report_types:           [{ label, count }],
 *     sample_reports:             [...up to 5 most recent],
 *     search_url:                 string,
 *     scraped_at:                 ISO,
 *   }
 *
 * Throttle: 1 request/sec (REQUEST_DELAY_MS). UA "TruNorth-OversightIG/1.0".
 *
 * Output: /public/data/oversight-ig-reports.json (overwritten monthly)
 *
 * Workflow: .github/workflows/oversight-ig-monthly.yml — 2nd of the month
 *           01:00 UTC, 30-minute timeout.
 *
 * Locally: node scripts/oversight-ig-fetch.mjs
 *   --smoke   only the 5 smoke-test fed-contractor / healthcare brands
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/oversight-ig-reports.json");

const OVERSIGHT_BASE = "https://www.oversight.gov";
const REPORTS_PATH   = "/reports/federal";
const UA = "TruNorth-OversightIG/1.0 (+https://www.trunorthapp.com)";
const REQUEST_DELAY_MS = 1000;       // 1 req/sec
const ITEMS_PER_PAGE   = 50;
const MAX_PAGES        = 20;         // cap = 1,000 reports per brand
const MAX_RETRIES      = 3;
const FIVE_YEARS_MS    = 5 * 365 * 24 * 60 * 60 * 1000;

// Subset reasonable for a fed-contractor / healthcare smoke test. These
// slugs are looked up in top-500-brands.txt — any not present are
// synthesized inline so the smoke runner still exercises the network /
// parsing code path.
const SMOKE_DEFS = [
  { slug: "lockheed-martin", name: "Lockheed Martin",       category: "Defense" },
  { slug: "boeing",          name: "Boeing",                category: "Defense" },
  { slug: "raytheon",        name: "Raytheon",              category: "Defense" },
  { slug: "unitedhealth",    name: "UnitedHealth Group",    category: "Healthcare & Pharma" },
  { slug: "mckesson",        name: "McKesson",              category: "Healthcare & Pharma" },
];
const SMOKE_SLUGS = new Set(SMOKE_DEFS.map((b) => b.slug));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name, category] = l.split("|").map((s) => s.trim());
      return { slug, name, category };
    })
    .filter((b) => b.slug && b.name);
}

async function fetchHtml(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(2000 * (attempt + 1));
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} on ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(2000 * (attempt + 1));
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s) {
  if (!s) return "";
  return decodeEntities(String(s).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the listing table out of a /reports/federal HTML page.
 * Returns an array of plain objects, one per result row.
 * Detection is purely structural — the row table has stable
 * data-label attributes that we anchor on.
 */
function parseListing(html) {
  const rows = [];
  // Each report row begins with <tr class="listing-table__row table-row">.
  const rowRe = /<tr class="listing-table__row table-row"[\s\S]*?<\/tr>/g;
  const matches = html.match(rowRe) || [];

  for (const row of matches) {
    const date =
      (row.match(/datetime="([^"]+)"/) || [])[1] ||
      stripTags((row.match(/data-label="Report Date"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || "");

    const agency = stripTags(
      (row.match(/data-label="Agency Reviewed \/ Investigated"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || ""
    );
    const title = stripTags(
      (row.match(/data-label="Report Title"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || ""
    );
    const type = stripTags(
      (row.match(/data-label="Type"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || ""
    );
    const location = stripTags(
      (row.match(/data-label="Location"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || ""
    );
    const hrefM = row.match(/<a href="(\/reports\/[^"#?]+)"[^>]*>View Report/);
    const url = hrefM ? `${OVERSIGHT_BASE}${hrefM[1]}` : null;

    if (!title || !url) continue;
    rows.push({
      date,
      agency,
      title,
      type,
      location,
      url,
    });
  }
  return rows;
}

/**
 * Pull the total result count off the page so we know whether to stop
 * paginating. The Drupal view exposes a "Last page" link in the pager —
 * the highest "page=N" param across the pager links is the last index
 * (zero-indexed). When no pager appears (results fit on one page) we
 * return null.
 */
function detectLastPage(html) {
  const matches = [...html.matchAll(/[?&]page=(\d+)/g)];
  if (!matches.length) return null;
  return Math.max(...matches.map((m) => Number(m[1])));
}

function buildSearchUrl(brandName, startISO, endISO, page = 0) {
  const u = new URL(REPORTS_PATH, OVERSIGHT_BASE);
  u.searchParams.set("search_api_fulltext", brandName);
  u.searchParams.set("field_report_date_issued[min]", startISO);
  u.searchParams.set("field_report_date_issued[max]", endISO);
  u.searchParams.set("items_per_page", String(ITEMS_PER_PAGE));
  if (page > 0) u.searchParams.set("page", String(page));
  return u.toString();
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) {
    if (!x) continue;
    counts[x] = (counts[x] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

/**
 * Confirm a row is likely a real hit. Oversight's Search API indexes
 * the full report body (highlights / description), not just the visible
 * row title — so we cannot post-filter on title+agency alone (most
 * Lockheed/Raytheon/McKesson hits live in the body). We trust the
 * upstream relevance ranking but still require that at least the
 * first token of the brand name appears as a whole word somewhere
 * in the row's surface text OR that the brand has multiple tokens
 * (multi-word brand names rarely false-positive). Single-token brands
 * like "Apple" or "Visa" need the title-level confirmation to avoid
 * matching "apple sauce" / "Visa Waiver Program" noise.
 */
function rowMentionsBrand(row, brandName) {
  const tokens = brandName.toLowerCase().split(/\s+/).filter(Boolean);
  // Multi-token brands ("Lockheed Martin", "UnitedHealth Group"):
  // upstream fulltext already required all tokens to match — trust it.
  if (tokens.length >= 2) return true;
  // Single-token brands: require the token as a whole word in
  // title or agency. Bodies are not exposed at the row level.
  const haystack = ` ${row.title.toLowerCase()} ${row.agency.toLowerCase()} `;
  const re = new RegExp(`(^|[^a-z0-9])${tokens[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

async function scrapeBrand(brand, startISO, endISO) {
  const all = [];
  let page = 0;
  let lastPage = null;

  while (page < MAX_PAGES) {
    const url = buildSearchUrl(brand.name, startISO, endISO, page);
    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.error(`  ${brand.slug} page ${page} failed: ${err.message}`);
      break;
    }

    const rows = parseListing(html);
    all.push(...rows);

    if (lastPage === null) lastPage = detectLastPage(html);
    if (lastPage === null || page >= lastPage) break;

    page++;
    await sleep(REQUEST_DELAY_MS);
  }

  // Post-filter for whole-name mentions.
  const filtered = all.filter((r) => rowMentionsBrand(r, brand.name));

  if (!filtered.length) {
    return {
      slug: brand.slug,
      name: brand.name,
      status: "no_reports",
      total_ig_reports_5y: 0,
    };
  }

  const sorted = filtered.slice().sort((a, b) =>
    (b.date || "").localeCompare(a.date || "")
  );

  const agencies = filtered.map((r) => r.agency).filter(Boolean);
  const types    = filtered.map((r) => r.type).filter(Boolean);

  const searchUrl = buildSearchUrl(brand.name, startISO, endISO, 0);

  return {
    slug:                    brand.slug,
    name:                    brand.name,
    status:                  "ok",
    total_ig_reports_5y:     filtered.length,
    top_agencies_reporting:  topN(agencies, 5),
    top_report_types:        topN(types, 5),
    sample_reports:          sorted.slice(0, 5).map((r) => ({
      date:     r.date ? r.date.slice(0, 10) : null,
      agency:   r.agency || null,
      title:    r.title,
      type:     r.type || null,
      location: r.location || null,
      url:      r.url,
    })),
    search_url:              searchUrl,
    scraped_at:              new Date().toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`Oversight.gov IG report fetcher starting${smoke ? " (smoke)" : ""}...`);

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  if (smoke) {
    // Use the canonical SMOKE_DEFS, layering on whatever metadata exists
    // in top-500-brands.txt where the slug overlaps.
    const byslug = new Map(brands.map((b) => [b.slug, b]));
    brands = SMOKE_DEFS.map((s) => byslug.get(s.slug) || s);
    console.log(`Smoke mode: ${brands.length} brands -> ${brands.map((b) => b.slug).join(", ")}`);
  }

  const now = Date.now();
  const startISO = new Date(now - FIVE_YEARS_MS).toISOString().slice(0, 10);
  const endISO   = new Date(now).toISOString().slice(0, 10);
  console.log(`Window: ${startISO} -> ${endISO}`);

  const results = [];
  let i = 0;
  for (const brand of brands) {
    i++;
    if (i === 1 || i % 25 === 0 || smoke) {
      console.log(`  [${i}/${brands.length}] ${brand.slug}`);
    }
    try {
      const r = await scrapeBrand(brand, startISO, endISO);
      results.push(r);
      if (smoke && r.status === "ok") {
        console.log(`     -> ${r.total_ig_reports_5y} reports; top agency: ${r.top_agencies_reporting[0]?.label || "n/a"}`);
      }
    } catch (err) {
      console.error(`  ${brand.slug} scrape failed: ${err.message}`);
      results.push({
        slug:   brand.slug,
        name:   brand.name,
        status: "error",
        error:  err.message,
      });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const withReports = results.filter((r) => r.status === "ok").length;
  const noReports   = results.filter((r) => r.status === "no_reports").length;
  const errors      = results.filter((r) => r.status === "error").length;

  const payload = {
    generated_at:        new Date(now).toISOString(),
    source_landing:      `${OVERSIGHT_BASE}/reports`,
    source_search:       `${OVERSIGHT_BASE}${REPORTS_PATH}`,
    window_start:        startISO,
    window_end:          endISO,
    brand_count:         brands.length,
    with_reports_count:  withReports,
    no_reports_count:    noReports,
    error_count:         errors,
    smoke:               smoke,
    brands:              results,
  };

  if (smoke) {
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\nSmoke output -> ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  }
  console.log(`   With IG reports: ${withReports}`);
  console.log(`   No reports:      ${noReports}`);
  console.log(`   Errors:          ${errors}`);
}

main().catch((err) => {
  console.error("oversight-ig-fetch failed:", err);
  process.exit(1);
});
