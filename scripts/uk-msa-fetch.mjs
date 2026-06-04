#!/usr/bin/env node
/**
 * UK Modern Slavery Act Registry (annual)
 *
 * The UK Modern Slavery Act 2015 (s.54) requires any commercial
 * organisation operating in the UK with global turnover >= GBP 36M to
 * publish an annual "Modern Slavery and Human Trafficking Statement".
 * Since 2021, statements are also voluntarily uploaded to the central
 * registry hosted by the UK Home Office:
 *
 *   https://modern-slavery-statement-registry.service.gov.uk
 *
 * The registry exposes a public search at /search/statements that
 * accepts ?search_terms=<name>&page=N and returns HTML cards linking
 * to individual statement pages. Each statement page lists the
 * publishing organisation, the statement period (year), and a link to
 * the statement PDF/URL the company uploaded.
 *
 * For each brand in /public/data/top-500-brands.txt we record:
 *   - has_uk_msa_statement   (bool) — at least one statement on file
 *   - statement_count        (int)  — total statements indexed
 *   - latest_statement_year  (int)  — most recent statement period
 *   - statement_url          (str)  — registry permalink to latest
 *
 * Output: /public/data/uk-msa.json (overwritten annually)
 *
 * Runs via .github/workflows/uk-msa-annual.yml Mar 1 19:00 UTC
 * (a few months after the typical UK fiscal-year-end statement
 * publication cycle).
 *
 * Locally: node scripts/uk-msa-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/uk-msa.json");

const REGISTRY_BASE = "https://modern-slavery-statement-registry.service.gov.uk";
const UA = "TruNorth-UK-MSA/1.0 (+https://www.trunorthapp.com)";

// Small subset used for `--smoke` runs (and CI sanity).
const SMOKE_SLUGS = new Set(["apple", "walmart", "nike", "marks-spencer"]);

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

// Normalise a brand name into a query string the registry will accept.
// The search is permissive but we strip suffixes the registry doesn't
// index against (Inc, Ltd, plc, etc.).
function searchTerm(name) {
  return name
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|sa|nv|ag|llc|holdings|group)\b\.?/gi, "")
    .replace(/[,&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse the search-results HTML and extract statement-page links.
// Card markup on the registry is reasonably stable: each result is an
// <a href="/statement-summary/<id>"> wrapping the org name + period.
function parseSearchResults(html) {
  const results = [];
  const seen = new Set();
  const cardRe = /<a[^>]+href="(\/statement-summary\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const text = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, "\"")
      .replace(/\s+/g, " ")
      .trim();

    // Statement period is typically "1 April 2023 to 31 March 2024" or
    // similar in the card body — pull the latest 4-digit year we see.
    const years = (text.match(/\b(20\d{2})\b/g) || []).map(Number);
    const year = years.length ? Math.max(...years) : null;

    results.push({
      url:  `${REGISTRY_BASE}${href}`,
      text,
      year,
    });
  }
  return results;
}

// Crude fuzzy match: registry frequently lists the parent legal entity
// (e.g. "Apple Retail UK Limited", "Walmart Inc.", "Marks and Spencer
// plc"). We require the search-term tokens (>=4 chars) to appear in
// the card text in order.
function looksLikeBrand(cardText, brandName) {
  const term = searchTerm(brandName).toLowerCase();
  const card = cardText.toLowerCase();
  if (!term) return false;
  if (card.includes(term)) return true;
  // Fall back: every >=4-char token from the brand must appear.
  const tokens = term.split(" ").filter(t => t.length >= 4);
  if (!tokens.length) return card.includes(term);
  return tokens.every(t => card.includes(t));
}

async function fetchBrand(brand) {
  const term = searchTerm(brand.name);
  if (!term) {
    return { slug: brand.slug, name: brand.name, status: "skipped_empty_term" };
  }

  const url = `${REGISTRY_BASE}/search/statements?search_terms=${encodeURIComponent(term)}`;
  let html;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) {
      return { slug: brand.slug, name: brand.name, status: "error", code: res.status };
    }
    html = await res.text();
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }

  const all = parseSearchResults(html);
  const matches = all.filter(r => looksLikeBrand(r.text, brand.name));

  if (matches.length === 0) {
    return {
      slug: brand.slug,
      name: brand.name,
      status: "no_statement",
      raw_result_count: all.length,
      search_url: url,
    };
  }

  // Sort matches by year desc (null years last) and dedupe URLs.
  matches.sort((a, b) => (b.year || 0) - (a.year || 0));
  const dedup = [];
  const seenUrls = new Set();
  for (const m of matches) {
    if (seenUrls.has(m.url)) continue;
    seenUrls.add(m.url);
    dedup.push(m);
  }

  const latest = dedup[0];
  return {
    slug:                  brand.slug,
    name:                  brand.name,
    status:                "ok",
    has_uk_msa_statement:  true,
    statement_count:       dedup.length,
    latest_statement_year: latest.year,
    statement_url:         latest.url,
    search_url:            url,
    sample_statements:     dedup.slice(0, 5).map(d => ({
      url:  d.url,
      year: d.year,
      text: d.text.slice(0, 200),
    })),
    scraped_at:            new Date().toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`UK MSA registry fetcher starting${smoke ? " (smoke mode)" : ""}...`);

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (smoke) {
    brands = brands.filter(b => SMOKE_SLUGS.has(b.slug));
    console.log(`Smoke filter -> ${brands.length} brands: ${brands.map(b => b.slug).join(", ")}`);
  }

  // Courtesy: 1 req/sec. Single search page per brand -> ~9 min for 500.
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrand(brands[i]);
    results.push(r);
    if (r.status === "ok") {
      console.log(`  [${i + 1}/${brands.length}] ${brands[i].slug} -> ${r.statement_count} stmt(s), latest ${r.latest_statement_year}`);
    } else if (i % 50 === 0) {
      console.log(`  ...${i}/${brands.length}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  const withStmt = results.filter(r => r.status === "ok").length;
  const noStmt   = results.filter(r => r.status === "no_statement").length;
  const err      = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:       new Date().toISOString(),
    source:             "uk-modern-slavery-act-registry",
    source_url:         REGISTRY_BASE,
    brand_count:        brands.length,
    with_statement_count: withStmt,
    no_statement_count: noStmt,
    error_count:        err,
    smoke_mode:         smoke,
    brands:             results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With statement: ${withStmt}`);
  console.log(`   No statement:   ${noStmt}`);
  console.log(`   Errors:         ${err}`);
}

main().catch(err => {
  console.error("uk-msa-fetch failed:", err);
  process.exit(1);
});
