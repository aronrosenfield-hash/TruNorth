#!/usr/bin/env node
/**
 * Australia Fair Work Ombudsman (FWO) — litigation outcomes scraper.
 *
 * Source:
 *   https://www.fairwork.gov.au/about-us/our-role-and-purpose/our-priorities/
 *     our-litigation-activities/litigation-outcomes?year=YYYY
 *
 * The FWO is the Australian Government regulator that takes employers to
 * court for underpayment, wage theft, sham contracting, record-keeping
 * breaches and other contraventions of the Fair Work Act 2009. Every
 * concluded litigation outcome is published on this page with the
 * defendant, court, penalty (AUD), case date, breach description, and a
 * link to the detail / court documents.
 *
 * License: Australian Government Public Sector Information. Free to reuse
 * with attribution. We add `_license` to the output for downstream clarity.
 *
 * STRATEGY
 *   1. For each year 2020..(current year), GET the year-filtered listing
 *      page and parse all .search-result / article entries.
 *   2. Each entry yields: defendant(s), breach type(s), court, penalty AUD,
 *      date, summary (<500 chars), source URL.
 *   3. If an entry names multiple defendants ("X Pty Ltd and Mr Y"), we
 *      split them out into ALL fields — one record per defendant, sharing
 *      the same case metadata (date, court, penalty, etc.). This means the
 *      same penalty can attribute to multiple defendants in the raw output;
 *      downstream merging de-duplicates by (date, sourceUrl).
 *   4. We do NOT convert AUD to USD — exchange rates change, and we want
 *      the canonical penaltyAud value preserved. The UI can convert.
 *
 * THROTTLE / POLITENESS
 *   - 2 sec between requests (REQ_DELAY_MS = 2000)
 *   - Honest UA identifying TruNorth + reason
 *   - Retry on 5xx with exponential backoff (3 tries, 2/4/8 sec)
 *
 * OUTPUT
 *   data/raw/au-fair-work/<YYYY-MM-DD>.json
 *   {
 *     _license: "Public, Fair Work Ombudsman, Australian Government",
 *     _source: "https://www.fairwork.gov.au/...litigation-outcomes",
 *     _generated_at: "2026-06-07T00:00:00.000Z",
 *     _years: [2020, 2021, ...],
 *     cases: [
 *       { date, defendants: [...], breachType, court, penaltyAud,
 *         summary, sourceUrl }
 *     ]
 *   }
 *
 * Standalone usage:
 *   node scripts/au-fair-work-fetch.mjs --year 2025 --out /tmp/test.json
 *   node scripts/au-fair-work-fetch.mjs                  # all years 2020..now
 *   node scripts/au-fair-work-fetch.mjs --fixture        # use sample.html
 *
 * Runs monthly via .github/workflows/au-fair-work-monthly.yml.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/au-fair-work");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/au-fair-work");

const BASE_URL = "https://www.fairwork.gov.au";
const LIST_PATH = "/about-us/our-role-and-purpose/our-priorities/our-litigation-activities/litigation-outcomes";
const UA = "TruNorth-FWO/1.0 (+https://www.trunorthapp.com; data pipeline for labour-rights transparency)";
const REQ_DELAY_MS = 2000;
const MAX_RETRIES = 3;
const SUMMARY_MAX = 500;

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const yearIdx = argv.indexOf("--year");
const ONLY_YEAR = yearIdx >= 0 ? Number(argv[yearIdx + 1]) : null;
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── fetch ────────────────────────────────────────────────────────────────
async function fetchHtml(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      redirect: "follow",
    });
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  ${res.status} for ${url} — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchHtml(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  fetch error "${err.message}" — retrying in ${backoff}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

// ─── parsing helpers (exported for tests) ─────────────────────────────────

/**
 * Parse "$5,250,000" / "$5.25 million" / "AUD 340,000" / "$340000" into a
 * Number. Returns null if no amount is recognisable.
 */
export function parsePenaltyAud(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/ /g, " ").trim();
  if (!s) return null;

  // "$5.25 million" / "5.25 million" / "$1.1m"
  const millionMatch = s.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m\b|million)/i);
  if (millionMatch) return Math.round(parseFloat(millionMatch[1]) * 1_000_000);

  // "$340,000" / "340000" / "$98,000"
  const numericMatch = s.match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (numericMatch) {
    const n = parseFloat(numericMatch[1].replace(/,/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

/**
 * Parse "12 March 2024" / "12/03/2024" / "2024-03-12" / "March 12, 2024"
 * into ISO YYYY-MM-DD. Returns null on failure.
 */
export function parseAuDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // ISO already
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "12 March 2024" / "12 Mar 2024"
  const months = {
    january: "01", february: "02", march: "03", april: "04", may: "05",
    june: "06", july: "07", august: "08", september: "09", october: "10",
    november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07",
    aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
  };
  const wordy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (wordy) {
    const mm = months[wordy[2].toLowerCase()];
    if (mm) return `${wordy[3]}-${mm}-${wordy[1].padStart(2, "0")}`;
  }

  // "March 12, 2024"
  const usWordy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (usWordy) {
    const mm = months[usWordy[1].toLowerCase()];
    if (mm) return `${usWordy[3]}-${mm}-${usWordy[2].padStart(2, "0")}`;
  }

  // "12/03/2024" — assume AU day-first format
  const slashy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (slashy) {
    return `${slashy[3]}-${slashy[2].padStart(2, "0")}-${slashy[1].padStart(2, "0")}`;
  }

  // Last-resort: Date.parse
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/**
 * Split a single defendant string ("X Pty Ltd and Mr Y" / "A, B and C")
 * into an array of trimmed names. The FWO formats vary; we handle the
 * common ones and otherwise return the raw string as the only entry.
 */
export function splitDefendants(raw) {
  if (!raw) return [];
  let s = String(raw).trim();
  // Strip wrapping parens / "and Anor" / "and Ors"
  s = s.replace(/\s+and\s+Ano(?:rs?)?\.?\s*$/i, "")
       .replace(/\s+and\s+Or(?:s)?\.?\s*$/i, "")
       .replace(/\s*\(franchisee\)\s*$/i, "");

  // Split on " and " (case-insensitive), commas
  const parts = s.split(/\s*,\s*|\s+and\s+/i).map(p => p.trim()).filter(Boolean);
  // Drop bare honorifics ("Mr X" is still kept; "and Anor" already stripped)
  return parts.length > 0 ? parts : [s];
}

/**
 * Truncate to <= 500 chars at a word boundary, appending "…" if cut.
 */
export function truncateSummary(text, max = SUMMARY_MAX) {
  if (!text) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

// ─── core: parse a listing-page HTML into case records ────────────────────
/**
 * Returns an array of CASE records (one per article on the page).
 * Each record has multi-defendant arrays.
 */
export function parseListingHtml(html, sourceBaseUrl = BASE_URL) {
  const $ = cheerio.load(html);
  const cases = [];

  // The FWO Drupal listing uses `article` blocks inside `.view-content`.
  // We try several selectors so a small markup change doesn't break us.
  const ARTICLE_SELECTORS = [
    ".view-content article",
    ".view-content .search-result",
    ".views-row",
    "main article",
  ];
  let $articles = $();
  for (const sel of ARTICLE_SELECTORS) {
    const candidate = $(sel);
    if (candidate.length > 0) { $articles = candidate; break; }
  }

  $articles.each((_, el) => {
    const $a = $(el);

    // Title + detail-page link
    const $title = $a.find("h2 a, h3 a, h4 a, .field--name-title a, a").first();
    const rawTitle = ($title.text() || "").trim();
    const href = ($title.attr("href") || "").trim();
    const sourceUrl = href
      ? (href.startsWith("http") ? href : sourceBaseUrl.replace(/\/$/, "") + (href.startsWith("/") ? href : "/" + href))
      : null;

    // Field accessors — accept several DOM shapes
    const pick = (selectors) => {
      for (const sel of selectors) {
        const v = $a.find(sel).first().text().trim();
        if (v) return v;
      }
      return "";
    };
    const courtText   = pick([".field--name-field-court", ".court", "[data-field=court]"]);
    const dateText    = pick([".field--name-field-date", ".date", "time", "[data-field=date]"]);
    const penaltyText = pick([".field--name-field-penalty", ".penalty", "[data-field=penalty]"]);
    const breachText  = pick([".field--name-field-breach", ".breach", "[data-field=breach]"]);
    const summaryText = pick([".field--name-field-summary", ".summary", ".field--name-body p", "p"]);

    // Skip if we couldn't even identify a title
    if (!rawTitle) return;

    const defendants = splitDefendants(rawTitle);
    const date       = parseAuDate(dateText);
    const penaltyAud = parsePenaltyAud(penaltyText);
    const breachType = breachText || null;
    const court      = courtText || null;
    const summary    = truncateSummary(summaryText);

    cases.push({
      date,
      defendants,
      breachType,
      court,
      penaltyAud,
      summary,
      sourceUrl,
    });
  });

  return cases;
}

// ─── fetch one year ───────────────────────────────────────────────────────
async function fetchYear(year) {
  if (FIXTURE_MODE) {
    const html = await fs.readFile(path.join(FIXTURE_DIR, "sample.html"), "utf-8");
    return parseListingHtml(html);
  }
  const url = `${BASE_URL}${LIST_PATH}?year=${year}`;
  console.log(`  GET ${url}`);
  const html = await fetchHtml(url);
  return parseListingHtml(html);
}

// ─── main runner ──────────────────────────────────────────────────────────
async function main() {
  console.log(`Australia Fair Work Ombudsman litigation fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);

  const currentYear = new Date().getUTCFullYear();
  const years = FIXTURE_MODE
    ? [currentYear]
    : (ONLY_YEAR ? [ONLY_YEAR] : Array.from({ length: currentYear - 2020 + 1 }, (_, i) => 2020 + i));

  console.log(`Years to fetch: ${years.join(", ")}`);

  const allCases = [];
  for (let i = 0; i < years.length; i++) {
    const yr = years[i];
    try {
      const yearCases = await fetchYear(yr);
      console.log(`  ${yr}: ${yearCases.length} outcomes`);
      allCases.push(...yearCases);
    } catch (err) {
      console.error(`  ${yr}: FAILED — ${err.message}`);
    }
    if (i < years.length - 1 && !FIXTURE_MODE) await sleep(REQ_DELAY_MS);
  }

  const output = {
    _license: "Public, Fair Work Ombudsman, Australian Government",
    _source: `${BASE_URL}${LIST_PATH}`,
    _generated_at: new Date().toISOString(),
    _years: years,
    _case_count: allCases.length,
    cases: allCases,
  };

  // Decide output path
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
  console.log(`  ${allCases.length} cases across ${years.length} year${years.length === 1 ? "" : "s"}`);

  // Summary stats
  const withPenalty = allCases.filter(c => c.penaltyAud && c.penaltyAud > 0);
  const totalAud = withPenalty.reduce((s, c) => s + (c.penaltyAud || 0), 0);
  console.log(`  ${withPenalty.length} cases with a penalty amount; total penalties AUD ${totalAud.toLocaleString()}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("au-fair-work-fetch failed:", err);
    process.exit(1);
  });
}
