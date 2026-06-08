#!/usr/bin/env node
/**
 * NLRB Voluntary Recognition fetcher (POSITIVE labor signal — sprint G).
 *
 * Pulls records of employers who VOLUNTARILY recognize a union — a distinctly
 * pro-labor act in which the employer concedes majority support without
 * forcing an NLRB-supervised election. These cases flow through the NLRB's
 * Case Activity Tracking System (CATS), usually filed as:
 *
 *   - RM petitions with a "voluntary recognition" disposition note
 *   - RC petitions withdrawn after voluntary recognition
 *   - UC clarification cases following an existing voluntary recognition
 *
 * Source:
 *   https://www.nlrb.gov/reports/agency-performance/election-reports
 *   https://www.nlrb.gov/search/case  (case_type=2  =>  Representation)
 *
 * The NLRB does NOT expose a dedicated voluntary-recognition CSV/JSON feed.
 * This fetcher therefore walks the public CATS search-results pages, filters
 * for RM/RC/UC rows whose disposition text matches voluntary-recognition
 * keywords, and writes a normalized snapshot. The script tolerates schema
 * drift — if the HTML changes shape, individual rows are skipped (recorded
 * in _stats.skipped) rather than failing the run. Complements the existing
 * NLRB unfair-labor-practice pipeline (negative labor signal) by capturing
 * a positive one.
 *
 * OUTPUT  data/raw/nlrb-voluntary-recognition/<YYYY-MM-DD>.json:
 *   {
 *     _license:      "US Government work — public domain (17 U.S.C. § 105).",
 *     _source_url:   "https://www.nlrb.gov/reports/agency-performance/election-reports",
 *     _generated_at: "...",
 *     _signal:       "positive",        // explicit — annotate for downstream
 *     _sources:      [{ url, count, status }],
 *     _stats:        { total, skipped, unique_employers, date_range, by_case_type },
 *     entries:       [{
 *       case_number,
 *       employer,
 *       union,
 *       recognition_date,    // ISO-8601 day, when known
 *       location,            // city, state
 *       workers,             // unit size when known
 *       case_type,           // RM | RC | UC
 *       disposition,         // raw disposition string from CATS
 *       source_url           // deep-link back to the case detail page
 *     }]
 *   }
 *
 * THROTTLE: 2s between pages, exponential backoff retry on 5xx, hard cap of
 * MAX_PAGES per run (≈1000 records — well above the realistic per-month
 * volume of voluntary recognitions, which historically runs 50–200/yr).
 *
 * FIXTURE MODE  --fixture   loads HTML from
 *   test/fixtures/nlrb-voluntary-recognition/page-<N>.html
 * so the script can be exercised end-to-end without network. Tests use this.
 *
 * Locally:
 *   node scripts/nlrb-voluntary-recognition-fetch.mjs            # live
 *   node scripts/nlrb-voluntary-recognition-fetch.mjs --fixture  # fixtures
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/nlrb-voluntary-recognition");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/nlrb-voluntary-recognition");

const UA = "TruNorth-NLRB-VoluntaryRecognition/1.0 (+https://www.trunorthapp.com; positive labor signal pipeline)";
const REQ_DELAY_MS = 2000;
const MAX_PAGES = 25;
const FIXTURE_MODE = process.argv.includes("--fixture");

// Case-type filter on the CATS search UI:
//   case_type=2 -> Representation (RM/RC/UC variants all bucket here).
// We then post-filter rows by disposition keywords.
export const BASE_SEARCH_URL =
  "https://www.nlrb.gov/search/case?f%5B0%5D=case_type%3A2";

// Disposition / outcome strings that signify a voluntary recognition.
// Matched against the lowercased disposition column.
export const VR_DISPOSITION_PATTERNS = [
  /voluntar\w*\s+recogn/i,         // "voluntary recognition", "voluntarily recognized"
  /vol\.?\s*rec\.?\b/i,            // "Vol. Rec." shorthand
  /vrb\b/i,                        // "Voluntary Recognition Bar"
  /withdrawn[^.]*\bvoluntary\b/i,  // "withdrawn — employer voluntarily recognized"
];

export const VR_CASE_TYPES = new Set(["RM", "RC", "UC"]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- fetching */

async function fetchText(url, fixtureName, attempt = 0) {
  if (FIXTURE_MODE) {
    const p = path.join(FIXTURE_DIR, `${fixtureName}.html`);
    if (existsSync(p)) return { ok: true, body: await fs.readFile(p, "utf-8") };
    return { ok: true, body: "" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    const body = await res.text();
    if (res.status === 403 || res.status === 503) {
      return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    }
    if (!res.ok && attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, fixtureName, attempt + 1);
    }
    if (!res.ok) return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    return { ok: true, body, status: res.status };
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, fixtureName, attempt + 1);
    }
    return { ok: false, body: "", blocker: `network:${err.message}` };
  }
}

/* --------------------------------------------------------------- utilities */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…",
  ndash: "–", mdash: "—",
};

export function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

export function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * Pull the case-type token (RM / RC / UC) out of an NLRB case number like
 * "13-RM-294317" or "07-RC-318274".  Returns null on malformed input.
 */
export function parseCaseType(caseNumber) {
  const m = /^\s*\d{1,3}-([A-Z]{2,3})-\d+/.exec(String(caseNumber || ""));
  return m ? m[1] : null;
}

/**
 * Normalize a free-form NLRB date to ISO-8601 (YYYY-MM-DD).
 * Accepts: "March 12, 2026", "3/12/2026", "2026-03-12". Returns null on bust.
 */
export function normalizeDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Pull the integer worker count out of phrases like "Unit size: 42" or "42
 * employees". Returns null when no number is plausibly present.
 */
export function parseWorkers(s) {
  if (!s) return null;
  const t = String(s).replace(/,/g, "");
  const m = /(\d{1,6})\s*(?:employees?|workers?|in\s+unit|unit\s+size)/i.exec(t)
    || /unit\s*size\s*[:\-]?\s*(\d{1,6})/i.exec(t)
    || /^\s*(\d{1,6})\s*$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
}

export function isVoluntaryRecognition(disposition) {
  if (!disposition) return false;
  return VR_DISPOSITION_PATTERNS.some(re => re.test(disposition));
}

/* ----------------------------------------------------------------- parser */

/**
 * Parse one NLRB CATS search-results page. Accepts two HTML shapes the NLRB
 * has shipped over the years — a `<table class="cats-results">` style and a
 * card grid (`<article class="search-result">`). Rows are returned ONLY when
 * they look like voluntary-recognition representation cases — RM/RC/UC case
 * type AND a disposition string matching the VR patterns above. The merger
 * does no further filtering.
 *
 * Returned shape per row:
 *   { case_number, employer, union, recognition_date, location, workers,
 *     case_type, disposition, source_url }
 */
export function parseSearchResults(html, opts = {}) {
  if (!html) return { rows: [], skipped: 0 };
  const baseHost = opts.baseHost ?? "https://www.nlrb.gov";
  const rows = [];
  let skipped = 0;

  // ------------------------------------------------- shape A: table rows ----
  const tableRowRe = /<tr\b[^>]*class="(?:[^"]*\s)?(?:case-row|cats-row|views-row)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = tableRowRe.exec(html)) !== null) {
    const inner = m[1];
    const cells = [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
    if (cells.length < 4) { skipped++; continue; }

    const rec = extractRow({
      case_number: cells[0],
      employer: cells[1],
      union: cells[2],
      disposition: cells[3],
      date: cells[4],
      location: cells[5],
      workers: cells[6],
      hrefMatch: inner.match(/href="([^"]+)"/),
      baseHost,
    });
    if (rec) rows.push(rec); else skipped++;
  }

  // ----------------------------------------------- shape B: card / article --
  const cardRe = /<(article|div)\b[^>]*class="(?:[^"]*\s)?(?:search-result|case-card)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = cardRe.exec(html)) !== null) {
    const inner = m[2];
    const fieldOf = (label) => {
      const re = new RegExp(
        `<[^>]*class="[^"]*\\b(?:field|cats|label)-${label}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/`,
        "i",
      );
      const mm = re.exec(inner);
      return mm ? stripTags(mm[1]) : "";
    };
    const rec = extractRow({
      case_number: fieldOf("case-number") || fieldOf("number"),
      employer: fieldOf("employer") || fieldOf("party") || fieldOf("name"),
      union: fieldOf("union") || fieldOf("petitioner") || fieldOf("labor-org"),
      disposition: fieldOf("disposition") || fieldOf("status") || fieldOf("outcome"),
      date: fieldOf("date-closed") || fieldOf("date") || fieldOf("closed"),
      location: fieldOf("location") || fieldOf("region") || fieldOf("city"),
      workers: fieldOf("unit-size") || fieldOf("workers") || fieldOf("employees"),
      hrefMatch: inner.match(/href="([^"]+)"/),
      baseHost,
    });
    if (rec) rows.push(rec); else skipped++;
  }

  return { rows, skipped };
}

function extractRow(f) {
  const case_number = (f.case_number || "").trim();
  const case_type = parseCaseType(case_number);
  if (!case_type || !VR_CASE_TYPES.has(case_type)) return null;

  if (!isVoluntaryRecognition(f.disposition)) return null;

  const employer = (f.employer || "").trim();
  if (!employer || employer.length > 200) return null;

  const href = f.hrefMatch ? f.hrefMatch[1] : null;
  const source_url = href
    ? (href.startsWith("http") ? href : `${f.baseHost}${href.startsWith("/") ? "" : "/"}${href}`)
    : `${f.baseHost}/case/${encodeURIComponent(case_number)}`;

  return {
    case_number,
    case_type,
    employer,
    union: (f.union || "").trim() || null,
    disposition: (f.disposition || "").trim() || null,
    recognition_date: normalizeDate(f.date),
    location: (f.location || "").trim() || null,
    workers: parseWorkers(f.workers),
    source_url,
  };
}

/* --------------------------------------------------------------- pagination */

/**
 * Detect a "next page" link in the NLRB pager. Returns the absolute URL or
 * null when no further pages exist (or pagination markup wasn't found —
 * we fail-closed to avoid infinite walks).
 */
export function findNextPageUrl(html, baseHost = "https://www.nlrb.gov") {
  if (!html) return null;
  const m =
    /<a\b[^>]*rel="next"[^>]*href="([^"]+)"/i.exec(html)
    || /<a\b[^>]*class="[^"]*\bpager__item--next\b[^"]*"[^>]*href="([^"]+)"/i.exec(html)
    || /<li\b[^>]*class="[^"]*\bpager-next\b[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"/i.exec(html);
  if (!m) return null;
  let href = decodeEntities(m[1]);
  if (href.startsWith("http")) return href;
  if (!href.startsWith("/")) href = `/${href}`;
  return `${baseHost}${href}`;
}

/* -------------------------------------------------------------------- main */

async function main() {
  console.log(`NLRB voluntary-recognition fetcher starting (fixture=${FIXTURE_MODE})...`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  const entries = [];
  const sources = [];
  let totalSkipped = 0;
  let url = BASE_SEARCH_URL;
  let pageNum = 0;

  while (url && pageNum < MAX_PAGES) {
    pageNum++;
    const fixtureName = `page-${pageNum}`;
    const res = await fetchText(url, fixtureName);
    if (!res.ok) {
      console.error(`  [page ${pageNum}] BLOCKED (${res.blocker})`);
      sources.push({ url, count: 0, status: "blocked", note: res.blocker });
      break;
    }
    const { rows, skipped } = parseSearchResults(res.body);
    totalSkipped += skipped;
    entries.push(...rows);
    sources.push({ url, count: rows.length, status: rows.length > 0 ? "ok" : "empty" });
    console.log(`  [page ${pageNum}] ${rows.length} voluntary-recognition rows (${skipped} skipped)`);

    const next = findNextPageUrl(res.body);
    if (!next || next === url) break;
    url = next;
    if (!FIXTURE_MODE) await sleep(REQ_DELAY_MS);
  }

  // Dedupe by case_number — multi-page overlap or stale-pager edge cases.
  const seen = new Map();
  for (const e of entries) {
    const existing = seen.get(e.case_number);
    if (!existing) { seen.set(e.case_number, e); continue; }
    // Prefer the entry with more populated fields.
    const score = (x) => [x.union, x.recognition_date, x.location, x.workers].filter(Boolean).length;
    if (score(e) > score(existing)) seen.set(e.case_number, e);
  }
  const deduped = [...seen.values()];
  const dates = deduped.map(e => e.recognition_date).filter(Boolean).sort();
  const uniqueEmployers = new Set(deduped.map(e => e.employer.toLowerCase())).size;

  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(RAW_DIR, `${today}.json`);
  const payload = {
    _license: "US Government work — public domain (17 U.S.C. § 105).",
    _source_url: "https://www.nlrb.gov/reports/agency-performance/election-reports",
    _search_url: BASE_SEARCH_URL,
    _generated_at: new Date().toISOString(),
    _signal: "positive",
    _sources: sources,
    _stats: {
      total: deduped.length,
      skipped: totalSkipped,
      unique_employers: uniqueEmployers,
      date_range: dates.length ? { earliest: dates[0], latest: dates[dates.length - 1] } : null,
      by_case_type: deduped.reduce((acc, e) => {
        acc[e.case_type] = (acc[e.case_type] || 0) + 1;
        return acc;
      }, {}),
    },
    entries: deduped,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile} (${deduped.length} voluntary recognitions, ${uniqueEmployers} unique employers)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("nlrb-voluntary-recognition-fetch failed:", err);
    process.exit(1);
  });
}
