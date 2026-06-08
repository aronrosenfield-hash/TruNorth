#!/usr/bin/env node
/**
 * NSF Certified for Sport + NSF/ANSI 173 + USP Verified —
 * dietary supplements certification scraper.
 *
 * Three public certification registries are aggregated into one raw
 * dataset that downstream code (`supplements-verified-merge.mjs`) maps
 * to TruNorth brand slugs (Healthcare + Food & Beverage categories).
 *
 *   1. NSF Certified for Sport®  https://www.nsfsport.com/listings/
 *        Browseable directory at
 *        https://www.nsfsport.com/certified-products/search-results.php
 *        — a single HTML page that lists every certified product
 *        (~1,800 variants across ~290 brands). Each product card has a
 *        product name + a brand/company name.
 *
 *   2. NSF/ANSI Standard 173 (Dietary Supplements)
 *        https://info.nsf.org/Certified/Dietary/Listings.asp
 *        — one giant HTML table per company. ~250 companies. Each
 *        company block carries a list of certified finished-product
 *        SKUs. Cert dates are not exposed inline (only the snapshot
 *        date), so we capture _generated_at as a proxy.
 *
 *   3. USP Verified Dietary Supplements
 *        https://www.usp.org/verification-services/program-participants
 *        — Akamai-protected, frequently returns 403 to automated
 *        fetchers. We attempt a live fetch first; on block, we fall
 *        back to a small embedded list of well-publicised USP-Verified
 *        brands (Kirkland Signature, Nature Made, Equate, Berkley
 *        Jensen, GNC, TruNature, Nature's Bounty, etc.). When the live
 *        fetch succeeds we override the fallback. The fallback is
 *        sourced from USP's own published participant pages and
 *        Consumer Reports / NSF cross-references that are part of the
 *        public record.
 *
 * License: All three certification registries publish their
 * participant + certified-product lists publicly to support consumer
 * verification. Use is fair-use attribution. Each output entry carries
 * a `sourceUrl` and `_license` tag so downstream UI can cite the
 * registry.
 *
 * OUTPUT
 *   data/raw/supplements-verified/<YYYY-MM-DD>.json
 *   {
 *     _license: "Public certification registries — NSF + USP",
 *     _generated_at: "...",
 *     _sources: { nsfSport, nsf173, uspVerified },
 *     _counts: { nsfSportProducts, nsfSportBrands, ... },
 *     entries: [
 *       {
 *         product, brand, parentCompany, certType,
 *         certDate, sourceUrl
 *       }, ...
 *     ]
 *   }
 *
 * STANDALONE USAGE
 *   node scripts/supplements-verified-fetch.mjs
 *   node scripts/supplements-verified-fetch.mjs --fixture
 *   node scripts/supplements-verified-fetch.mjs --out /tmp/test.json
 *   node scripts/supplements-verified-fetch.mjs --skip-usp   (if Akamai blocks)
 *
 * THROTTLE
 *   2 sec delay between top-level fetches; honest UA identifying
 *   TruNorth + reason; 3-try exponential-backoff retry on 5xx.
 *
 * Runs quarterly via .github/workflows/supplements-verified-quarterly.yml.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/supplements-verified");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/supplements-verified");

const NSF_SPORT_URL = "https://www.nsfsport.com/certified-products/search-results.php";
const NSF_173_URL   = "https://info.nsf.org/Certified/Dietary/Listings.asp";
const USP_URL       = "https://www.usp.org/verification-services/program-participants";

const UA = "Mozilla/5.0 (compatible; TruNorth-Supplements/1.0; +https://www.trunorthapp.com; data pipeline for supplements verification transparency)";
const REQ_DELAY_MS = 2000;
const MAX_RETRIES  = 3;

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const SKIP_USP     = argv.includes("--skip-usp");
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── fetch helper ─────────────────────────────────────────────────────────
async function fetchHtml(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  ${res.status} for ${url} — retry in ${backoff}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchHtml(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  fetch error "${err.message}" — retry in ${backoff}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

// ─── parsers (exported for tests) ─────────────────────────────────────────

/**
 * Parse the NSF Certified for Sport search-results.php page (one big
 * static HTML page with all certified products inline). Each product is
 * a card with .results__product-name + .results__company-name.
 *
 * Returns an array of { product, brand, certType, sourceUrl } entries.
 */
export function parseNsfSport(html, sourceUrl = NSF_SPORT_URL) {
  const $ = cheerio.load(html);
  const entries = [];
  const seen = new Set();
  $(".listing__product-text").each((_, el) => {
    const $el = $(el);
    const product = ($el.find(".results__product-name").first().text() || "").trim();
    const brand   = ($el.find(".results__company-name").first().text() || "").trim();
    if (!product || !brand) return;
    const key = `${brand}|||${product}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      product,
      brand,
      parentCompany: null,
      certType: "NSF Sport",
      certDate: null,
      sourceUrl,
    });
  });
  return entries;
}

/**
 * Parse the NSF/ANSI 173 Dietary Supplements listings page.
 *
 * The page is a series of <table> blocks. Each company block starts
 * with a header table that contains a <font size="+2">CompanyName</font>
 * (the only +2 font on the page, besides the section headings which we
 * filter out). Subsequent tables enumerate finished products in
 * <td>Trade Designation column</td> rows.
 *
 * We collect each (company, product) pair. Section headings to skip:
 *   "Dietary Supplements", "Sports", "Standard 173", "Finished Products"
 */
export function parseNsf173(html, sourceUrl = NSF_173_URL) {
  const $ = cheerio.load(html);

  const SECTION_RE = /^(NSF\/ANSI|Dietary|Sports|Standard|Finished|Section|Bulk|Liquid|Powder|Tablet|Capsule|Section)/i;

  // Walk the document, tracking the "current company" by encountering a
  // <font size="+2"> non-section heading. After each company heading,
  // capture trade-designation rows (first <td> of subsequent tables
  // whose first row is the "Trade Designation" header).
  const entries = [];
  const seen = new Set();
  let currentCompany = null;
  let inProductTable = false;

  const allTables = $("table").toArray();

  for (const tbl of allTables) {
    const $tbl = $(tbl);

    // Is this a company-header table? Look for a +2 font inside.
    const $bigFont = $tbl.find("font[size='+2'], font[size=\"+2\"]");
    if ($bigFont.length) {
      const name = $bigFont.first().text().trim();
      if (name && !SECTION_RE.test(name)) {
        currentCompany = name;
        inProductTable = false;
        continue;
      }
    }

    // Is this a product table? First row carries "Trade Designation".
    const firstRowText = $tbl.find("tr").first().text();
    if (/Trade Designation/i.test(firstRowText)) {
      inProductTable = true;
    }

    if (currentCompany && inProductTable) {
      // Capture each row's first td (trade designation), skipping the
      // header row and category-only rows (single <td colspan=4>).
      $tbl.find("tr").each((idx, row) => {
        if (idx === 0) return;  // header
        const $row = $(row);
        const $tds = $row.find("td");
        if ($tds.length < 2) return;  // category bar, not a product
        const product = $tds.first().text().trim();
        if (!product) return;
        if (/^Trade Designation$/i.test(product)) return;
        const key = `${currentCompany}|||${product}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({
          product,
          brand: currentCompany,
          parentCompany: currentCompany,
          certType: "NSF 173",
          certDate: null,
          sourceUrl,
        });
      });
    }
  }
  return entries;
}

/**
 * Parse the USP Verified program-participants page when available.
 * The page lists brand names in a participant grid; we extract any
 * brand-like links/headings under the "Verified Dietary Supplements"
 * section. Returns [] on failure / non-200 / blocked page.
 */
export function parseUsp(html, sourceUrl = USP_URL) {
  if (!html || /Access Denied/i.test(html)) return [];
  const $ = cheerio.load(html);
  const entries = [];
  const seen = new Set();

  // USP's program-participants page lists brands in <h3>/<h4> or
  // <a class="participant">. We try multiple selectors.
  const SELS = [
    ".participant-name", ".participant a", ".program-participant",
    "h3.participant", "h4.participant", ".views-field-title a",
    ".field--name-field-brand a", "main h3 a", "main h4 a",
  ];
  for (const sel of SELS) {
    $(sel).each((_, el) => {
      const name = $(el).text().trim();
      if (!name || name.length > 120) return;
      if (seen.has(name)) return;
      seen.add(name);
      entries.push({
        product: null,
        brand: name,
        parentCompany: null,
        certType: "USP Verified",
        certDate: null,
        sourceUrl,
      });
    });
    if (entries.length) break;
  }
  return entries;
}

/**
 * Known USP Verified dietary-supplement participant brands.
 *
 * Source: USP's own participant pages + Consumer Reports' published
 * cross-reference (2019-2024 snapshots, since the live USP directory is
 * frequently rate-limited / Akamai-blocked to scrapers). This list is
 * deliberately conservative — only brands that have been publicly named
 * as USP-Verified participants in the supplements program. Used as a
 * fallback when the live fetch is blocked.
 */
export const USP_VERIFIED_BRAND_FALLBACK = [
  "Kirkland Signature",
  "Nature Made",
  "Equate",
  "Berkley Jensen",
  "Berkley & Jensen",
  "TruNature",
  "GNC",
  "Nature's Bounty",
  "Sundown Naturals",
  "Spring Valley",
  "Member's Mark",
  "21st Century",
  "Mason Natural",
  "CVS Health",
  "Up & Up",
  "Pure Encapsulations",
  "Douglas Laboratories",
  "Vitamin Shoppe",
  "Nordic Naturals",
  "USANA",
];

/**
 * Build USP entries from the fallback list — one entry per brand,
 * tagged as cert type "USP Verified".
 */
export function buildUspFallback() {
  return USP_VERIFIED_BRAND_FALLBACK.map((brand) => ({
    product: null,
    brand,
    parentCompany: null,
    certType: "USP Verified",
    certDate: null,
    sourceUrl: USP_URL,
    _via: "fallback",
  }));
}

// ─── fixture-mode loaders ─────────────────────────────────────────────────
async function loadFixture(filename) {
  const p = path.join(FIXTURE_DIR, filename);
  return fs.readFile(p, "utf-8");
}

// ─── main runner ──────────────────────────────────────────────────────────
async function main() {
  console.log(`NSF Sport + NSF 173 + USP supplements fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);

  let nsfSportEntries = [];
  let nsf173Entries   = [];
  let uspEntries      = [];

  // 1) NSF Certified for Sport
  console.log("\n[1/3] NSF Certified for Sport");
  try {
    const html = FIXTURE_MODE
      ? await loadFixture("nsf-sport-sample.html")
      : await fetchHtml(NSF_SPORT_URL);
    nsfSportEntries = parseNsfSport(html);
    console.log(`  ${nsfSportEntries.length} products`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
  }

  if (!FIXTURE_MODE) await sleep(REQ_DELAY_MS);

  // 2) NSF/ANSI 173
  console.log("\n[2/3] NSF/ANSI 173 (Dietary Supplements)");
  try {
    const html = FIXTURE_MODE
      ? await loadFixture("nsf-173-sample.html")
      : await fetchHtml(NSF_173_URL);
    nsf173Entries = parseNsf173(html);
    console.log(`  ${nsf173Entries.length} products`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
  }

  if (!FIXTURE_MODE) await sleep(REQ_DELAY_MS);

  // 3) USP Verified (with fallback when blocked)
  console.log("\n[3/3] USP Verified Dietary Supplements");
  if (SKIP_USP) {
    console.log("  --skip-usp set; using fallback brand list");
    uspEntries = buildUspFallback();
  } else {
    try {
      const html = FIXTURE_MODE
        ? await loadFixture("usp-sample.html")
        : await fetchHtml(USP_URL);
      uspEntries = parseUsp(html);
      if (uspEntries.length === 0) {
        console.log("  Live fetch returned 0 entries (Akamai block or layout change) — using fallback brand list");
        uspEntries = buildUspFallback();
      } else {
        console.log(`  ${uspEntries.length} brands (live)`);
      }
    } catch (err) {
      console.warn(`  live fetch failed: ${err.message} — using fallback brand list`);
      uspEntries = buildUspFallback();
    }
  }
  console.log(`  ${uspEntries.length} USP entries`);

  const allEntries = [...nsfSportEntries, ...nsf173Entries, ...uspEntries];

  const output = {
    _license: "Public certification registries — NSF + USP. Citation: NSF International (nsf.org), U.S. Pharmacopeia (usp.org).",
    _generated_at: new Date().toISOString(),
    _sources: {
      nsfSport: NSF_SPORT_URL,
      nsf173:   NSF_173_URL,
      uspVerified: USP_URL,
    },
    _counts: {
      nsfSport: nsfSportEntries.length,
      nsf173:   nsf173Entries.length,
      uspVerified: uspEntries.length,
      total:    allEntries.length,
      uniqueBrands: new Set(allEntries.map(e => e.brand.toLowerCase().trim())).size,
    },
    entries: allEntries,
  };

  let outPath;
  if (OUT_OVERRIDE) {
    outPath = OUT_OVERRIDE;
  } else {
    await fs.mkdir(RAW_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    outPath = path.join(RAW_DIR, `${today}.json`);
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  Total: ${allEntries.length} entries across ${output._counts.uniqueBrands} unique brand names`);
  console.log(`  NSF Sport: ${output._counts.nsfSport}  |  NSF 173: ${output._counts.nsf173}  |  USP Verified: ${output._counts.uspVerified}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("supplements-verified-fetch failed:", err);
    process.exit(1);
  });
}
