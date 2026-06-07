#!/usr/bin/env node
/**
 * NAAG Multistate Settlements DB — scraper.
 *
 * Single source covering every major multistate consumer settlement since
 * the 1980s. One scrape replaces ~50 individual state-AG sites: Equifax
 * $700M, JUUL, Google location data, the $26B+ opioid settlements, etc.
 *
 *   https://www.naag.org/our-work/multistate-cases/?_categories=settlements
 *
 * Each settlement is its own WordPress post (CPT: multistate-cases). The
 * listing page paginates with /page/N/. Each detail page has:
 *   - <h1 class="entry-title"> case title
 *   - "Defendants" section (<ul> or labelled paragraph)
 *   - "Participating States" section
 *   - lead paragraph with $ amount and settlement date
 *   - article:published_time meta tag with the announcement date
 *
 * Output:
 *   data/raw/naag/<YYYY-MM-DD>.json   — array of settlement records
 *
 * Each record:
 *   {
 *     caseTitle,
 *     defendants:       [string, ...],   // raw company strings, ALL caps suffix preserved
 *     statesInvolved:   [string, ...],
 *     amountUsd:        number | null,
 *     date:             "YYYY-MM-DD" | null,
 *     summary:          string,          // <= 500 chars
 *     sourceUrl:        string,
 *   }
 *
 * Politeness:
 *   - 2 sec between requests (REQ_DELAY_MS = 2000), honors the spec.
 *   - Honest UA identifying TruNorth and the reason.
 *   - Retry 5xx with exponential backoff (3 tries). 403 is not retried
 *     (NAAG runs a Kasada bot wall — surface to the human, don't hammer).
 *
 * CLI:
 *   node scripts/naag-fetch.mjs                              # live, default out
 *   node scripts/naag-fetch.mjs --limit 50 --out /tmp/x.json # cap pages of detail
 *   node scripts/naag-fetch.mjs --fixture                    # parse local sample
 *
 * Runs monthly via .github/workflows/naag-monthly.yml.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/naag");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/naag");

const NAAG_BASE = "https://www.naag.org";
const LIST_PATH = "/our-work/multistate-cases/";
const LIST_QS   = "?_categories=settlements";
const REQ_DELAY_MS = 2000;
const MAX_PAGES    = 50;       // ~600 settlements at ~12/page — covers the full DB
const UA = "TruNorth-NAAG/1.0 (+https://www.trunorthapp.com; data pipeline for consumer-protection transparency)";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─────────────────────────── CLI args ───────────────────────────── */

function parseArgs(argv) {
  const args = { limit: null, out: null, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") args.fixture = true;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || null;
    else if (a === "--out")   args.out   = argv[++i];
  }
  return args;
}

/* ─────────────────────────── network ────────────────────────────── */

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (res.status === 403) {
      // NAAG runs Kasada — non-browser clients get a JS challenge that
      // returns 403. Don't retry; surface so a human can investigate.
      throw new Error(`HTTP 403 (bot wall) ${url}`);
    }
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchText(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 2 && /ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(err.message || "")) {
      await sleep(2000 * (attempt + 1));
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

/* ─────────────────────── parsing helpers ────────────────────────── */

/** Parse "$700 million", "$2.5 billion", "26.4B", "$1,250,000.50" → integer USD. */
export function parseAmountUsd(text) {
  if (!text) return null;
  const sample = String(text);
  // Largest dollar figure wins. NAAG always leads with the total.
  let max = 0;
  // Standard "$X million|billion|thousand" pattern
  const re1 = /\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|thousand|m|b|k)?\b/gi;
  let m;
  while ((m = re1.exec(sample)) !== null) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit === "billion" || unit === "b")       v *= 1e9;
    else if (unit === "million" || unit === "m")  v *= 1e6;
    else if (unit === "thousand" || unit === "k") v *= 1e3;
    if (v > max) max = v;
  }
  // Compact pattern "26.4B" without dollar sign (e.g., headlines/teasers).
  const re2 = /\b(\d+(?:\.\d+)?)\s*(billion|million)\b/gi;
  while ((m = re2.exec(sample)) !== null) {
    let v = parseFloat(m[1]);
    if (!Number.isFinite(v)) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit === "billion")      v *= 1e9;
    else if (unit === "million") v *= 1e6;
    if (v > max) max = v;
  }
  return max > 0 ? Math.round(max) : null;
}

const MONTHS = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

/** Extract "September 30, 2019" or ISO into YYYY-MM-DD. */
export function parseDate(text) {
  if (!text) return null;
  const s = String(text);
  // ISO 8601 wins (e.g., article:published_time)
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2})?/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const en = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (en) {
    const mm = MONTHS[en[1].toLowerCase()];
    const dd = String(en[2]).padStart(2, "0");
    return `${en[3]}-${mm}-${dd}`;
  }
  return null;
}

/** Squash whitespace + decode common HTML entities cheerio missed. */
export function clean(text) {
  if (!text) return "";
  return String(text)
    .replace(/’/g, "'")
    .replace(/“|”/g, '"')
    .replace(/—/g, " — ")
    .replace(/\s+/g, " ")
    .trim();
}

const US_STATES = new Set([
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
  "District of Columbia","Puerto Rico","Guam","U.S. Virgin Islands",
  "American Samoa","Northern Mariana Islands",
]);

/* ─────────────────────── listing parser ─────────────────────────── */

/**
 * Parse a /our-work/multistate-cases listing page into [{title, url,
 * date, summary}, ...]. Robust to NAAG's WordPress markup — looks for
 * <article> blocks with case links, falls back to anchor scraping.
 */
export function parseListingPage(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  // Primary: <article> cards with a title link to /multistate-case/...
  $("article, .multistate-case-card, .case-card, .post").each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a[href*="/multistate-case/"], a[href*="multistate-cases/"]').first();
    if (!$link.length) return;
    const href = $link.attr("href");
    if (!href || !/multistate-case\//.test(href)) return;
    const url = href.startsWith("http") ? href : `${NAAG_BASE}${href}`;
    if (seen.has(url)) return;
    seen.add(url);
    const title = clean($link.text()) || clean($el.find("h2, h3, .case-title, .entry-title").first().text());
    const date = parseDate(clean($el.find(".case-date, .entry-date, time, .date").first().text()));
    const summary = clean($el.find(".case-summary, .entry-summary, .excerpt, p").first().text()).slice(0, 500);
    if (title) items.push({ title, url, date, summary });
  });

  // Fallback: bare anchors anywhere on the page.
  if (items.length === 0) {
    $('a[href*="/multistate-case/"]').each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const url = href.startsWith("http") ? href : `${NAAG_BASE}${href}`;
      if (seen.has(url)) return;
      seen.add(url);
      const title = clean($(el).text());
      if (title) items.push({ title, url, date: null, summary: "" });
    });
  }

  // Detect next-page link
  const nextHref = $('a.next, .next.page-numbers, a[rel="next"]').first().attr("href");
  const next = nextHref
    ? (nextHref.startsWith("http") ? nextHref : `${NAAG_BASE}${nextHref}`)
    : null;

  return { items, next };
}

/* ────────────────────── detail-page parser ──────────────────────── */

/**
 * Parse a single multistate-case detail page. Returns the full
 * structured record. Caller is responsible for providing sourceUrl
 * (we use it as a fallback only).
 */
export function parseDetailPage(html, sourceUrl = "") {
  const $ = cheerio.load(html);

  const caseTitle = clean(
    $(".entry-title, h1.entry-title, h1").first().text()
  );

  // Date: prefer article:published_time meta tag, fall back to body text.
  let date = parseDate($('meta[property="article:published_time"]').attr("content"));
  if (!date) date = parseDate(clean($(".case-date, .entry-meta, .entry-date, time").first().text()));
  if (!date) {
    // Scan whole article for first English date.
    const body = clean($("article, .entry-content, main").first().text()).slice(0, 4000);
    date = parseDate(body);
  }

  // Defendants — look for an explicit list under a "Defendants" heading,
  // else extract from the title (NAAG titles often start with the brand).
  const defendants = extractDefendants($, caseTitle);

  // Participating states — explicit list under "Participating States"
  // (or "States Involved"), else scan body for state-name matches.
  const statesInvolved = extractStates($);

  // Summary: prefer the lead paragraph in .entry-content, else og:description.
  let summary = clean($(".entry-content p, .case-summary-body p").first().text());
  if (!summary) summary = clean($('meta[property="og:description"]').attr("content"));
  if (!summary) summary = clean($("article p").first().text());
  summary = summary.slice(0, 500);

  // Amount: prefer the lead paragraph (NAAG always leads with the $),
  // else scan the whole article.
  let amountUsd = parseAmountUsd(summary);
  if (!amountUsd) {
    const body = clean($("article, .entry-content, main").first().text()).slice(0, 4000);
    amountUsd = parseAmountUsd(body);
  }
  // Final fallback: title (e.g., "$700 Million Equifax Settlement")
  if (!amountUsd) amountUsd = parseAmountUsd(caseTitle);

  return {
    caseTitle,
    defendants,
    statesInvolved,
    amountUsd,
    date,
    summary,
    sourceUrl,
  };
}

function extractDefendants($, caseTitle) {
  const out = [];
  const seen = new Set();
  const add = (name) => {
    const cleaned = clean(name).replace(/[,.;:]+$/g, "");
    if (!cleaned || cleaned.length < 2 || cleaned.length > 160) return;
    const k = cleaned.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(cleaned);
  };

  // 1. <h2>Defendants</h2><ul>... pattern
  $("h2, h3, h4, strong").each((_, el) => {
    const t = clean($(el).text()).toLowerCase();
    if (!/^defendants?$|^parties$|^respondents?$/.test(t)) return;
    const $next = $(el).nextAll("ul, ol").first();
    if ($next.length) {
      $next.find("li").each((_, li) => add($(li).text()));
    }
  });
  // 2. .case-defendants ul
  $(".case-defendants li, ul.defendants li").each((_, li) => add($(li).text()));

  // 3. Title-derived fallback if nothing structured was found.
  if (out.length === 0 && caseTitle) {
    // Heuristic: NAAG titles often follow "BRAND ... Settlement|Judgment|Case".
    // Strip trailing case-type words.
    let t = caseTitle
      .replace(/multistate\s+(case|settlement|judgment|lawsuit|action|investigation)/ig, "")
      .replace(/\b(settlement|judgment|lawsuit|investigation|case|action)\b/ig, "")
      .replace(/\s+/g, " ")
      .trim();
    // Drop trailing prepositional phrases ("over X", "for Y", "regarding Z").
    t = t.split(/\s+(?:over|for|regarding|in|on)\s+/i)[0];
    // If the remaining string starts with a verb-y word like "AG announces"
    // or contains "Attorneys General", skip — we can't trust it.
    if (t && !/^(attorney|ag\b|state)/i.test(t) && t.length <= 120) add(t);
  }
  return out;
}

function extractStates($) {
  const out = [];
  const seen = new Set();
  const add = (name) => {
    const c = clean(name);
    if (!US_STATES.has(c)) return;
    if (seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  // 1. Explicit Participating States section
  $("h2, h3, h4, strong").each((_, el) => {
    const t = clean($(el).text()).toLowerCase();
    if (!/states|jurisdictions|participants/.test(t)) return;
    const $next = $(el).nextAll("ul, ol").first();
    if ($next.length) $next.find("li").each((_, li) => add($(li).text()));
  });
  // 2. .case-states li
  $(".case-states li, ul.states li").each((_, li) => add($(li).text()));
  // 3. Fallback: scan all <li> on the page (NAAG state lists are always <ul>).
  if (out.length === 0) $("li").each((_, li) => add($(li).text()));
  return out;
}

/* ───────────────────────── driver ───────────────────────────────── */

async function runFixtureMode() {
  console.log("NAAG fetcher: fixture mode");
  const listHtml   = await fs.readFile(path.join(FIXTURE_DIR, "sample-list.html"), "utf-8");
  const detailHtml = await fs.readFile(path.join(FIXTURE_DIR, "sample-detail.html"), "utf-8");
  const { items } = parseListingPage(listHtml);
  console.log(`  parsed ${items.length} listing items`);
  const results = [];
  for (const it of items) {
    // For the fixture run, we only have one real detail file. Use it for
    // the Equifax record; the rest get listing-only data (still useful).
    if (/equifax/i.test(it.url)) {
      const rec = parseDetailPage(detailHtml, it.url);
      results.push(rec);
    } else {
      results.push({
        caseTitle:      it.title,
        defendants:     extractDefendants(cheerio.load(`<h1>${it.title}</h1>`), it.title),
        statesInvolved: [],
        amountUsd:      parseAmountUsd(it.summary || it.title),
        date:           it.date,
        summary:        it.summary,
        sourceUrl:      it.url,
      });
    }
  }
  return results;
}

async function runLive(limit) {
  console.log(`NAAG fetcher: live mode (limit=${limit ?? "all"})`);
  const collected = [];
  let nextUrl = `${NAAG_BASE}${LIST_PATH}${LIST_QS}`;
  let page = 1;

  while (nextUrl && page <= MAX_PAGES) {
    console.log(`  fetching listing page ${page}: ${nextUrl}`);
    let html;
    try { html = await fetchText(nextUrl); }
    catch (err) {
      console.error(`  page ${page} failed: ${err.message}`);
      break;
    }
    const { items, next } = parseListingPage(html);
    console.log(`    parsed ${items.length} items`);
    if (items.length === 0) break;
    collected.push(...items);
    if (limit && collected.length >= limit) break;
    nextUrl = next;
    page++;
    if (nextUrl) await sleep(REQ_DELAY_MS);
  }

  const detailTargets = limit ? collected.slice(0, limit) : collected;
  console.log(`  fetching ${detailTargets.length} detail pages…`);
  const results = [];
  for (let i = 0; i < detailTargets.length; i++) {
    const it = detailTargets[i];
    try {
      const html = await fetchText(it.url);
      const rec = parseDetailPage(html, it.url);
      // Fall back to listing-page date/summary when detail is sparse.
      if (!rec.date) rec.date = it.date;
      if (!rec.summary) rec.summary = it.summary;
      results.push(rec);
    } catch (err) {
      console.warn(`    [${i + 1}/${detailTargets.length}] detail failed for ${it.url}: ${err.message}`);
      results.push({
        caseTitle:      it.title,
        defendants:     [],
        statesInvolved: [],
        amountUsd:      parseAmountUsd(it.summary || it.title),
        date:           it.date,
        summary:        it.summary,
        sourceUrl:      it.url,
        _detail_error:  err.message,
      });
    }
    if (i < detailTargets.length - 1) await sleep(REQ_DELAY_MS);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const results = args.fixture
    ? await runFixtureMode()
    : await runLive(args.limit);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outFile = args.out || path.join(RAW_DIR, `${new Date().toISOString().slice(0, 10)}.json`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outFile}`);
  console.log(`  settlements: ${results.length}`);
  console.log(`  with amount: ${results.filter(r => r.amountUsd).length}`);
  console.log(`  with date:   ${results.filter(r => r.date).length}`);
  console.log(`  with defendants: ${results.filter(r => r.defendants.length).length}`);
  console.log(`  with states: ${results.filter(r => r.statesInvolved.length).length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("naag-fetch failed:", err);
    process.exit(1);
  });
}
