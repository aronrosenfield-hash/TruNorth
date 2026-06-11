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
 * Source (updated 2026-06 — the original case-search strategy is dead):
 *   https://www.nlrb.gov/reports/graphs-data/recent-filings   (CATS data + CSV export)
 *
 * WHY THE REWRITE — as of mid-2026 the NLRB case search at /search/case:
 *   1. returns "did not match any cases" for an empty search term (you can no
 *      longer browse all representation cases),
 *   2. dropped the numeric case_type facet (now case_type:C / case_type:R),
 *   3. renders result rows with ONLY case name/number/date-filed/status/
 *      location — NO disposition or union columns to filter on, and
 *   4. its full-text index covers case NAMES only, so searching
 *      "voluntary recognition" finds nothing.
 *
 * The one public CATS surface that still exposes a disposition is the
 * Recent Filings dataset (/reports/graphs-data/recent-filings), whose CSV
 * export carries a "Reason Closed" column plus employer/union/location/unit
 * size. We filter it server-side to Representation cases via
 * `?f[0]=case_type:R` + a date window, then drive the site's async CSV
 * export (/nlrb-downloads/start-download → /nlrb-downloads/progress →
 * generated file) and post-filter rows whose Reason Closed matches the
 * voluntary-recognition patterns below.
 *
 * KNOWN UPSTREAM LIMITATION (verified live 2026-06-10): the public CATS
 * close-method vocabulary is {Certific. of Representative, Certification of
 * Results, Withdrawal Adjusted/Non-adjusted, Dismissal Adjusted/Non-adjusted,
 * Unit Clarification, Amended Certification, Compliance w/BO} — NONE encode a
 * voluntary recognition, in 2026 or in 2021 (when the 2020 Election
 * Protection Rule's VR-notification requirement was still in force; it was
 * rescinded effective 2024, and no NN-VR-NNNNNN case numbers are searchable).
 * "Withdrawal Adjusted" RC petitions are often VR-resolved in practice, but
 * the data does not say so explicitly and we refuse to guess. Until the NLRB
 * republishes VR dispositions, a healthy run therefore yields _status:"empty"
 * with _empty_reason:"fetch_ok_no_vr_dispositions" and a close-method census
 * in _stats proving the fetch worked. If a VR close method ever (re)appears,
 * this fetcher picks it up automatically. Complements the existing NLRB
 * unfair-labor-practice pipeline (negative labor signal) with a positive one.
 *
 * OUTPUT  data/raw/nlrb-voluntary-recognition/<YYYY-MM-DD>.json:
 *   {
 *     _license:      "US Government work — public domain (17 U.S.C. § 105).",
 *     _source_url:   "https://www.nlrb.gov/reports/graphs-data/recent-filings",
 *     _generated_at: "...",
 *     _status:       "ok" | "empty" | "blocked",   // empty = fetch OK, 0 VR rows
 *     _signal:       "positive",        // explicit — annotate for downstream
 *     _sources:      [{ url, count, status }],
 *     _stats:        { total, candidate_rows, close_methods, skipped,
 *                      unique_employers, date_range, by_case_type },
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
 * THROTTLE: 1s between progress polls (the server processes its export in
 * batches of ~100 rows per poll), exponential backoff retry on 5xx, and a
 * stale-progress bailout so a wedged export can't spin forever. A one-year
 * R-case window is ~2.5k rows ≈ 26 polls.
 *
 * FIXTURE MODE  --fixture   loads CSV from
 *   test/fixtures/nlrb-voluntary-recognition/recent-filings.csv
 * so the script can be exercised end-to-end without network. (The legacy
 * page-<N>.html fixtures still back the legacy-parser unit tests.)
 *
 * Locally:
 *   node scripts/nlrb-voluntary-recognition-fetch.mjs            # live
 *   node scripts/nlrb-voluntary-recognition-fetch.mjs --fixture  # fixtures
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/nlrb-voluntary-recognition");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/nlrb-voluntary-recognition");

const UA = "TruNorth-NLRB-VoluntaryRecognition/1.0 (+https://www.trunorthapp.com; positive labor signal pipeline)";
const POLL_DELAY_MS = 1000;
const MAX_POLLS = 400;        // 400 polls × ~100 rows/poll ≈ 40k rows — way past a year of R cases
const MAX_STALE_POLLS = 30;   // bail if the export stops advancing
const WINDOW_DAYS = 365;
const FIXTURE_MODE = process.argv.includes("--fixture");

export const NLRB_HOST = "https://www.nlrb.gov";
export const DATA_URL = `${NLRB_HOST}/reports/graphs-data/recent-filings`;

/** mm/dd/yyyy for the NLRB date_start/date_end filter params. */
export function fmtUsDate(d) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/**
 * Recent Filings filtered to Representation cases (RM/RC/UC all bucket under
 * case_type:R) in a date window. We then post-filter the exported CSV rows
 * by Reason Closed keywords.
 */
export function buildFilterUrl(dateStart, dateEnd) {
  const p = new URLSearchParams();
  p.set("f[0]", "case_type:R");
  if (dateStart) p.set("date_start", dateStart);
  if (dateEnd) p.set("date_end", dateEnd);
  return `${DATA_URL}?${p.toString()}`;
}

// Kept export name for back-compat with older tooling; now points at the
// Recent Filings dataset (the /search/case?case_type=2 surface is gone).
export const BASE_SEARCH_URL = buildFilterUrl();

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

/* ------------------------------------------------------------- CSV parser */

/**
 * Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines,
 * doubled-quote escapes). Returns an array of objects keyed by the header
 * row. The NLRB export quotes free-text columns like Unit Sought which
 * routinely contain both commas and newlines.
 */
export function parseCsv(text) {
  const s = String(text || "");
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      if (row.some(c => c !== "")) rows.push(row);
      row = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some(c => c !== "")) rows.push(row);
  }
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/**
 * Map one Recent Filings CSV row to a snapshot entry — or null when the row
 * is not a voluntary-recognition representation case (wrong case type, or a
 * Reason Closed that doesn't match the VR patterns).
 *
 * Export columns (verified 2026-06): Name, Case Number, City,
 * "States & Territories", Date Filed, Region Assigned, Status, Date Closed,
 * Reason Closed, "No. of Eligible Voters", "No. of Employees",
 * Certified Representative, Unit Sought.
 */
export function csvRowToEntry(row) {
  const case_number = (row["Case Number"] || "").trim();
  const case_type = parseCaseType(case_number);
  if (!case_type || !VR_CASE_TYPES.has(case_type)) return null;

  const disposition = (row["Reason Closed"] || "").trim();
  if (!isVoluntaryRecognition(disposition)) return null;

  const employer = (row["Name"] || "").trim();
  if (!employer || employer.length > 200) return null;

  const city = (row["City"] || "").trim();
  const state = (row["States & Territories"] || "").trim();
  return {
    case_number,
    case_type,
    employer,
    union: (row["Certified Representative"] || "").trim() || null,
    disposition,
    recognition_date: normalizeDate(row["Date Closed"]),
    location: [city, state].filter(Boolean).join(", ") || null,
    workers: parseWorkers(row["No. of Employees"] || row["No. of Eligible Voters"]),
    source_url: `${NLRB_HOST}/case/${encodeURIComponent(case_number)}`,
  };
}

/* ------------------------------------------------------------ CSV export  */

/** Pull the data-cacheid the filtered page embeds for its CSV export. */
export function extractCacheId(html) {
  const m = /data-cacheid="([^"]+)"/.exec(String(html || ""));
  return m ? m[1] : null;
}

/**
 * Drive the NLRB's async CSV export for the given filtered Recent Filings
 * URL: read the page → start the export with a throwaway session token →
 * poll until the server finishes batching → download the generated file.
 * Returns { ok, csvText } or { ok:false, blocker }.
 */
async function downloadFilteredCsv(filterUrl) {
  const page = await fetchText(filterUrl, null);
  if (!page.ok) return { ok: false, blocker: `filter_page:${page.blocker}` };

  const cacheId = extractCacheId(page.body);
  if (!cacheId) return { ok: false, blocker: "no_cacheid_in_filter_page" };

  const token = randomUUID();
  const dlHeaders = {
    "User-Agent": UA,
    "Accept": "application/json",
    "Cookie": `nlrb-dl-sessid=${token}`,
  };
  const getJson = async (url) => {
    try {
      const res = await fetch(url, { headers: dlHeaders });
      if (!res.ok) return { ok: false, blocker: `http_${res.status}` };
      return { ok: true, json: await res.json() };
    } catch (err) {
      return { ok: false, blocker: `network:${err.message}` };
    }
  };

  const start = await getJson(`${NLRB_HOST}/nlrb-downloads/start-download/recent_filings/${cacheId}/${token}`);
  if (!start.ok) return { ok: false, blocker: `start_download:${start.blocker}` };
  let dl = start.json?.data;
  if (!dl?.id) return { ok: false, blocker: "start_download:malformed_response" };
  console.log(`  export started (id ${dl.id}, ${dl.total} rows)`);

  let polls = 0, lastProcessed = -1, stale = 0;
  while (!dl.finished && polls < MAX_POLLS) {
    await sleep(POLL_DELAY_MS);
    const p = await getJson(`${NLRB_HOST}/nlrb-downloads/progress/${dl.id}`);
    if (!p.ok) return { ok: false, blocker: `progress:${p.blocker}` };
    dl = p.json?.data ?? dl;
    if (dl.processed === lastProcessed) {
      if (++stale > MAX_STALE_POLLS) return { ok: false, blocker: "export_stalled" };
    } else {
      stale = 0;
      lastProcessed = dl.processed;
    }
    polls++;
  }
  if (!dl.finished) return { ok: false, blocker: "export_timeout" };

  const csv = await fetchText(`${NLRB_HOST}${dl.filename}`, null);
  if (!csv.ok) return { ok: false, blocker: `csv_fetch:${csv.blocker}` };
  return { ok: true, csvText: csv.body };
}

/* ------------------------------------------------- parser (LEGACY, unused) */

/**
 * LEGACY — parser for the pre-2026 /search/case results pages, kept exported
 * because (a) the pure functions are still unit-tested and (b) it documents
 * the old HTML shapes in case the NLRB resurrects them. The live pipeline
 * now goes through the Recent Filings CSV export above.
 *
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

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const filterUrl = buildFilterUrl(fmtUsDate(windowStart), fmtUsDate(now));

  let csvText = null;
  let status = "ok"; let note; let emptyReason;

  if (FIXTURE_MODE) {
    const p = path.join(FIXTURE_DIR, "recent-filings.csv");
    csvText = existsSync(p) ? await fs.readFile(p, "utf-8") : "";
  } else {
    console.log(`  ${filterUrl}`);
    const dl = await downloadFilteredCsv(filterUrl);
    if (!dl.ok) {
      console.error(`  BLOCKED (${dl.blocker})`);
      status = "blocked";
      note = dl.blocker;
    } else {
      csvText = dl.csvText;
    }
  }

  let entries = [];
  let candidateRows = 0;
  const closeMethods = {};
  let skipped = 0;

  if (csvText !== null) {
    const rows = parseCsv(csvText);
    for (const row of rows) {
      const caseType = parseCaseType(row["Case Number"]);
      if (!caseType || !VR_CASE_TYPES.has(caseType)) { skipped++; continue; }
      candidateRows++;
      const method = (row["Reason Closed"] || "").trim();
      if (method) closeMethods[method] = (closeMethods[method] || 0) + 1;
      const entry = csvRowToEntry(row);
      if (entry) entries.push(entry);
    }
    console.log(`  ${rows.length} CSV rows, ${candidateRows} RM/RC/UC candidates, ${entries.length} voluntary recognitions`);
    if (entries.length === 0 && status === "ok") {
      status = "empty";
      if (candidateRows > 0) {
        emptyReason = "fetch_ok_no_vr_dispositions";
        note = `Fetched ${candidateRows} representation cases for ${fmtUsDate(windowStart)}–${fmtUsDate(now)} ` +
          `but the public CATS close-method vocabulary (see _stats.close_methods) contains no ` +
          `voluntary-recognition disposition — the NLRB stopped publishing VR outcomes after the 2020 ` +
          `Election Protection Rule's notification requirement was rescinded. Not a fetch failure.`;
      } else {
        emptyReason = "fetch_ok_zero_candidate_rows";
        note = "CSV export fetched but contained no RM/RC/UC rows — check the case_type filter upstream.";
      }
    }
  }

  // Dedupe by case_number, preferring the more populated entry.
  const seen = new Map();
  for (const e of entries) {
    const existing = seen.get(e.case_number);
    if (!existing) { seen.set(e.case_number, e); continue; }
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
    _source_url: DATA_URL,
    _search_url: filterUrl,
    _generated_at: new Date().toISOString(),
    _status: status,
    ...(emptyReason ? { _empty_reason: emptyReason } : {}),
    ...(note ? { _note: note } : {}),
    _signal: "positive",
    _sources: [{ url: filterUrl, count: deduped.length, status }],
    _stats: {
      total: deduped.length,
      candidate_rows: candidateRows,
      close_methods: closeMethods,
      skipped,
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
  console.log(`\nWrote ${outFile} (${deduped.length} voluntary recognitions, ${uniqueEmployers} unique employers, status=${status})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("nlrb-voluntary-recognition-fetch failed:", err);
    process.exit(1);
  });
}
