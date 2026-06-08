#!/usr/bin/env node
/**
 * SEC DEF14A executive-compensation parser (annual, proxy season).
 *
 * For every public company in /public/data/index.json that we can map to a
 * SEC CIK (Central Index Key) via the SEC's published ticker→CIK file, this
 * script:
 *   1. Resolves CIK from ticker (cached on disk).
 *   2. Walks the company's filings index (data.sec.gov/submissions/CIK...).
 *   3. Picks the most recent DEF 14A (proxy statement).
 *   4. Tries XBRL company-facts (data.sec.gov/api/xbrl/companyfacts/...)
 *      to pull structured tags first — falls back to fetching the proxy
 *      document text and regex-extracting the Summary Compensation Table.
 *   5. Writes one big per-company record array into a dated JSON.
 *
 * Output (one big file per run, dated):
 *   data/raw/sec-def14a/<YYYY-MM-DD>.json
 *
 * Per-company record shape:
 *   {
 *     slug, name, ticker, cik,
 *     status: "ok" | "no_def14a" | "no_comp_table" | "no_cik" | "error",
 *     filingDate, filingAccession, sourceUrl,
 *     year,                       // fiscal year for the Summary Compensation Table
 *     ceoName,
 *     ceoBaseSalary,              // USD
 *     ceoBonus,                   // USD
 *     ceoStockAwards,             // USD
 *     ceoOptionAwards,            // USD
 *     ceoNonEquityIncentive,      // USD
 *     ceoAllOtherComp,            // USD
 *     ceoTotal,                   // USD
 *     medianEmployeePay,          // USD, from CEO Pay Ratio disclosure
 *     payRatio,                   // CEO total ÷ median employee pay
 *     extractedVia: "xbrl" | "html-summary-table" | "html-pay-ratio" | "none",
 *     error,
 *   }
 *
 * License: SEC EDGAR data is US-government / public domain. We identify
 * ourselves with a descriptive User-Agent as required by the SEC's fair-use
 * policy (https://www.sec.gov/os/accessing-edgar-data) and throttle at
 * ≤10 req/sec.
 *
 * Flags:
 *   --dry       (default) — do NOT hit the network. Use a previous output
 *                           file if one exists so the merger can be tested
 *                           offline. With no prior output, emits an empty
 *                           skeleton.
 *   --apply     — actually call SEC EDGAR.
 *   --smoke     — restrict to a handful of household-name tickers.
 *   --limit N   — cap fetches at N companies (debug/iteration).
 *   --slug X    — only run for one slug.
 *
 * Runs via .github/workflows/sec-def14a-annual.yml — once a year in July,
 * after proxy season (March–June) for calendar-year filers.
 *
 * Locally:
 *   node scripts/sec-def14a-fetch.mjs --smoke --apply       # 10 brands, real
 *   node scripts/sec-def14a-fetch.mjs --apply --limit 100   # 100 brands
 *   node scripts/sec-def14a-fetch.mjs --apply               # all
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const RAW_DIR    = path.join(ROOT, "data/raw/sec-def14a");
const CACHE_DIR  = path.join(ROOT, "public/data/_cache/sec-def14a");
const CIK_CACHE  = path.join(CACHE_DIR, "ticker-cik.json");

const UA = "TruNorth Data Pipeline aron@trunorthapp.com";
const RATE_LIMIT_MS = 110;   // SEC limit is 10 req/sec; 110ms is safely under
const MAX_RETRIES   = 3;

const TICKER_CIK_URL = "https://www.sec.gov/files/company_tickers.json";

// Smoke list — household-name public US companies that always file DEF14A.
const SMOKE_TICKERS = new Set([
  "AAPL", "MSFT", "WMT", "AMZN", "GOOGL", "META", "JPM", "DIS", "NKE", "KO",
]);

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const DRY   = !APPLY;
const SMOKE = argv.has("--smoke");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : null;
})();
const SLUG_ARG = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────── HTTP ─────────────────────────────────

async function fetchSec(url, { json = false, retries = MAX_RETRIES } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
      });
      if (res.status === 404) return { _notFound: true };
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * attempt);
        continue;
      }
      if (!res.ok) return { _error: true, status: res.status };
      return json ? await res.json() : await res.text();
    } catch (e) {
      if (attempt === retries) return { _error: true, message: e.message };
      await sleep(1000 * attempt);
    }
  }
  return { _error: true, message: "exhausted retries" };
}

// ─────────────────────────── CIK lookup ───────────────────────────

/**
 * Load (or fetch + cache) the SEC's ticker→CIK map.
 * Map shape (we normalize):  TICKER → { cik: "0000320193", title: "Apple Inc." }
 */
export async function loadTickerCikMap({ apply = false } = {}) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  if (existsSync(CIK_CACHE)) {
    try {
      const cached = JSON.parse(await fs.readFile(CIK_CACHE, "utf-8"));
      if (cached && Object.keys(cached).length > 1000) return cached;
    } catch { /* fallthrough, refetch */ }
  }
  if (!apply) {
    // Dry mode with no cache → empty map; callers will skip everything.
    return {};
  }
  const data = await fetchSec(TICKER_CIK_URL, { json: true });
  if (!data || data._error || data._notFound) {
    throw new Error(`Failed to load SEC ticker→CIK map: ${JSON.stringify(data)}`);
  }
  // SEC payload: { "0": { cik_str, ticker, title }, "1": {...}, ... }
  const out = {};
  for (const k of Object.keys(data)) {
    const row = data[k];
    if (!row?.ticker || !row?.cik_str) continue;
    out[String(row.ticker).toUpperCase()] = {
      cik: String(row.cik_str).padStart(10, "0"),
      title: row.title || null,
    };
  }
  await fs.writeFile(CIK_CACHE, JSON.stringify(out));
  return out;
}

// ─────────────────────────── Filings ──────────────────────────────

/**
 * Returns the most recent DEF 14A filing for a given (10-digit) CIK,
 * or null if the company has none on record.
 *
 *   { accession, primaryDocument, filingDate, reportDate }
 */
export async function getLatestDef14A(cik) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const data = await fetchSec(url, { json: true });
  if (!data || data._error || data._notFound) return null;
  const recent = data?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return null;
  for (let i = 0; i < recent.form.length; i++) {
    const f = String(recent.form[i] || "").toUpperCase();
    if (f === "DEF 14A" || f === "DEF14A") {
      return {
        accession: recent.accessionNumber[i],
        primaryDocument: recent.primaryDocument[i],
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate[i] || null,
      };
    }
  }
  return null;
}

// Build the canonical URL for a DEF14A's primary document inside the
// EDGAR Archives. Accession is like "0000320193-26-000005"; the archive
// path uses the no-dashes version under the CIK directory.
export function archiveUrl(cik, accession, document) {
  const cleanCik = String(parseInt(cik, 10));        // drop leading zeros
  const noDashAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${noDashAcc}/${document}`;
}

export function indexUrl(cik, accession) {
  const cleanCik = String(parseInt(cik, 10));
  const noDashAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${noDashAcc}/`;
}

// ─────────────────────────── XBRL ─────────────────────────────────

/**
 * Pull the most recent USD-valued numeric fact from companyfacts for the
 * given XBRL tag, optionally filtered by form (e.g. only DEF 14A facts).
 * Returns { value, year, end } or null.
 */
export function pickLatestFact(facts, tag, { form = null } = {}) {
  const usGaap = facts?.facts?.["us-gaap"] || {};
  const dei    = facts?.facts?.dei || {};
  const node = usGaap[tag] || dei[tag];
  if (!node) return null;
  const units = node.units?.USD || node.units?.["pure"] || [];
  let best = null;
  for (const u of units) {
    if (form && u.form && !String(u.form).startsWith(form)) continue;
    if (best === null || (u.end && u.end > best.end)) best = u;
  }
  if (!best) return null;
  return { value: best.val, year: best.fy ?? null, end: best.end || null };
}

// XBRL tags for CEO Pay Ratio rule (Reg S-K Item 402(u)). Coverage is
// inconsistent — not every filer tags these — so we fall back to HTML
// regex when missing.
export const XBRL_TAGS = {
  ceoTotal:           ["CompensationActuallyPaidAmount", "TotalCeoCompensationAmount"],
  medianEmployeePay:  ["MedianEmployeeTotalAnnualCompensation", "AnnualTotalCompensationOfMedianEmployee", "MedianEmployeeAnnualCompensation"],
  payRatio:           ["PayRatio", "PeoTotalCompensationToMedianEmployeeRatio"],
};

export async function extractFromXbrl(cik) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const facts = await fetchSec(url, { json: true });
  if (!facts || facts._error || facts._notFound) return null;
  const out = {};
  for (const [field, tags] of Object.entries(XBRL_TAGS)) {
    for (const t of tags) {
      const v = pickLatestFact(facts, t, { form: "DEF" });
      if (v) { out[field] = v; break; }
    }
  }
  return Object.keys(out).length ? out : null;
}

// ─────────────────────────── HTML extraction ──────────────────────

/**
 * Strip HTML to plain text, collapsing whitespace and decoding common
 * entities. Deliberately small — XBRL is the primary path; HTML is a
 * regex-able fallback for older proxies that don't tag SCT fields.
 */
export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#160;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a USD amount from a SCT cell. Accepts "$1,234,567", "1,234,567",
 * "1.23 million", "(123,456)" (parens = negative, but uncommon for comp).
 * Returns a number or null.
 */
export function parseUsd(s) {
  if (s == null) return null;
  const raw = String(s).trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw);
  const stripped = raw.replace(/[\$,()]/g, "").replace(/\s+/g, " ").trim();
  const mil = /^(\d+(?:\.\d+)?)\s*million$/i.exec(stripped);
  if (mil) return Math.round(parseFloat(mil[1]) * 1_000_000) * (negative ? -1 : 1);
  const n = parseFloat(stripped);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Extract the Summary Compensation Table from proxy plain-text.
 *
 * The SCT (Item 402(c)) is the structured table near the top of every
 * proxy. The CEO's row is identified by their job title ("Chief Executive
 * Officer" or "President and CEO"). We look for the most recent year (the
 * first numeric row after the year header) and pull the seven canonical
 * columns: salary, bonus, stock awards, option awards, non-equity
 * incentive, all other comp, total.
 *
 * Returns null if we can't find a confident match.
 */
export function extractSummaryCompensationTable(text) {
  // Find the SCT heading. Tolerate variants like "Summary Compensation
  // Table for Fiscal Year 2025".
  const headerIdx = text.search(/Summary Compensation Table/i);
  if (headerIdx < 0) return null;
  // Look at the ~6000-char window after the heading.
  const window = text.slice(headerIdx, headerIdx + 6000);

  // Find the CEO row. Anchor strictly on "Chief Executive Officer" or
  // "President and CEO" — we deliberately do not match "Senior Vice
  // President" etc, which would pull NEO rows above the CEO.
  // The principal-position column always names the role with no
  // "Senior"/"Executive Vice"/etc qualifier prefix immediately before.
  const ceoLineRe = /([A-Z][A-Za-z.'\-]+(?:\s+[A-Z]\.?(?:\s+[A-Z][A-Za-z.'\-]+)?)?(?:\s+[A-Z][A-Za-z.'\-]+){0,3})\s+(?:Chief Executive Officer|President\s+and\s+(?:Chief Executive Officer|CEO)\b)/;
  const ceoMatch = ceoLineRe.exec(window);
  if (!ceoMatch) return null;
  // Reject if the captured "name" ends in a clearly-role word that
  // indicates we matched a non-CEO neo row (e.g. "Senior Vice", "Chief
  // Financial").
  const candidate = ceoMatch[1].trim();
  if (/\b(Senior|Vice|Executive|Financial|Operating|Technology|Marketing|Legal|Counsel|Officer)$/i.test(candidate)) return null;

  // Year of the most recent row is the first 4-digit year after the CEO
  // line (SCT rows are ordered most-recent first).
  const after = window.slice(ceoMatch.index);
  const yearMatch = /\b(20\d{2})\b/.exec(after);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Pull the first 7 dollar-amounts after the year (salary, bonus, stock,
  // options, non-equity, all-other, total).
  const numStart = year ? after.indexOf(String(year)) + 4 : 0;
  const tail = after.slice(numStart);
  const numRe = /\$?\s*([0-9][0-9,]{0,11}(?:\.\d+)?)\b/g;
  const nums = [];
  let m;
  while ((m = numRe.exec(tail)) && nums.length < 8) {
    const v = parseUsd(m[1]);
    if (v != null) nums.push(v);
  }
  if (nums.length < 6) return null;
  // Heuristic: skip leading sub-thousand values that are footnote refs.
  while (nums.length > 7 && nums[0] < 1000) nums.shift();

  const [salary, bonus, stock, options, nonEquity, allOther, total] =
    nums.length >= 7
      ? nums.slice(0, 7)
      : [...nums.slice(0, 6), nums.slice(0, 6).reduce((a, b) => a + b, 0)];

  return {
    ceoName: candidate,
    year,
    ceoBaseSalary:         salary  ?? null,
    ceoBonus:              bonus   ?? null,
    ceoStockAwards:        stock   ?? null,
    ceoOptionAwards:       options ?? null,
    ceoNonEquityIncentive: nonEquity ?? null,
    ceoAllOtherComp:       allOther ?? null,
    ceoTotal:              total ?? null,
  };
}

/**
 * Extract the CEO Pay Ratio disclosure from proxy plain-text.
 * The rule (S-K Item 402(u)) requires the ratio expressed as N to 1 and
 * the median employee's total comp in dollars.
 */
export function extractPayRatio(text) {
  // Median employee compensation. Pay-ratio paragraphs vary widely
  // ("median of the annual total compensation of all employees…", "median
  // employee's total annual compensation was…"), so we just look for a
  // window starting with "median" and ending in a dollar figure, no period
  // in between (period bounds the sentence).
  const medRe = /median[^.$]{0,200}?\$\s*([0-9][0-9,]{2,9})/i;
  const medMatch = medRe.exec(text);
  const medianEmployeePay = medMatch ? parseUsd(medMatch[1]) : null;

  // Ratio must appear inside a "ratio … N to 1" / "ratio … N:1" window —
  // require the literal word "ratio" within 200 chars before the number,
  // and skip absurdly low values (boilerplate "one to one" examples).
  const ratioRe = /\bratio\b[^.$]{0,200}?\b([0-9]{1,4}(?:\.\d+)?)\s*(?:to|:)\s*1\b/i;
  const ratioMatch = ratioRe.exec(text);
  const rawRatio = ratioMatch ? parseFloat(ratioMatch[1]) : null;
  const payRatio = (rawRatio != null && rawRatio >= 5) ? rawRatio : null;

  if (medianEmployeePay == null && payRatio == null) return null;
  return { medianEmployeePay, payRatio };
}

// ─────────────────────────── Pipeline ─────────────────────────────

async function loadCompanies() {
  // index.json doesn't carry ticker, so we use it as the slug list and
  // probe each company JSON for a ticker. The per-file approach scales
  // fine (~11k file stats) and gives us the truthier `isPublic`/`ticker`
  // fields from the augmented company records.
  const arr = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const out = [];
  for (const c of arr) {
    if (!c.slug) continue;
    const file = path.join(COMP_DIR, `${c.slug}.json`);
    if (!existsSync(file)) continue;
    let comp;
    try { comp = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch { continue; }
    const ticker = comp.ticker || c.ticker;
    if (!ticker) continue;
    out.push({
      slug: c.slug,
      name: comp.name || c.name,
      ticker: String(ticker).toUpperCase(),
    });
  }
  return out;
}

async function processCompany(c, cikMap) {
  const cikRow = cikMap[c.ticker];
  if (!cikRow) {
    return { slug: c.slug, name: c.name, ticker: c.ticker, status: "no_cik" };
  }
  const cik = cikRow.cik;
  const filing = await getLatestDef14A(cik);
  await sleep(RATE_LIMIT_MS);
  if (!filing) {
    return { slug: c.slug, name: c.name, ticker: c.ticker, cik, status: "no_def14a" };
  }
  const sourceUrl = archiveUrl(cik, filing.accession, filing.primaryDocument);

  // 1. XBRL pass.
  const xbrl = await extractFromXbrl(cik);
  await sleep(RATE_LIMIT_MS);

  // 2. HTML pass — fetch the proxy and run regex.
  let sct = null, ratio = null, extractedVia = "none";
  const doc = await fetchSec(sourceUrl);
  await sleep(RATE_LIMIT_MS);
  if (typeof doc === "string") {
    const text = htmlToText(doc);
    sct   = extractSummaryCompensationTable(text);
    ratio = extractPayRatio(text);
    if (sct) extractedVia = "html-summary-table";
    else if (ratio) extractedVia = "html-pay-ratio";
  }

  const merged = {
    slug: c.slug, name: c.name, ticker: c.ticker, cik,
    status: "ok",
    filingDate: filing.filingDate,
    filingAccession: filing.accession,
    sourceUrl,
    year:                  sct?.year ?? xbrl?.ceoTotal?.year ?? null,
    ceoName:               sct?.ceoName ?? null,
    ceoBaseSalary:         sct?.ceoBaseSalary ?? null,
    ceoBonus:              sct?.ceoBonus ?? null,
    ceoStockAwards:        sct?.ceoStockAwards ?? null,
    ceoOptionAwards:       sct?.ceoOptionAwards ?? null,
    ceoNonEquityIncentive: sct?.ceoNonEquityIncentive ?? null,
    ceoAllOtherComp:       sct?.ceoAllOtherComp ?? null,
    ceoTotal:              sct?.ceoTotal ?? xbrl?.ceoTotal?.value ?? null,
    medianEmployeePay:     xbrl?.medianEmployeePay?.value ?? ratio?.medianEmployeePay ?? null,
    payRatio:              xbrl?.payRatio?.value ?? ratio?.payRatio ?? null,
    extractedVia: xbrl ? (extractedVia === "none" ? "xbrl" : `${extractedVia}+xbrl`) : extractedVia,
  };
  if (!merged.ceoTotal && !merged.payRatio && !merged.medianEmployeePay) {
    merged.status = "no_comp_table";
  }
  return merged;
}

async function main() {
  console.log(`SEC DEF14A fetcher — mode=${APPLY ? "APPLY" : "DRY"}${SMOKE ? " smoke" : ""}${LIMIT ? ` limit=${LIMIT}` : ""}${SLUG_ARG ? ` slug=${SLUG_ARG}` : ""}`);

  const today = new Date().toISOString().slice(0, 10);
  await fs.mkdir(RAW_DIR, { recursive: true });
  const outFile = path.join(RAW_DIR, `${today}.json`);

  if (DRY) {
    // Dry mode: prefer the latest cached output so the merger can run.
    const files = (await fs.readdir(RAW_DIR).catch(() => [])).filter(f => f.endsWith(".json")).sort();
    if (files.length) {
      console.log(`[dry] using cached ${files.at(-1)} (no network)`);
      return;
    }
    const skeleton = {
      _license: "US public domain — SEC EDGAR",
      _source: "https://www.sec.gov/edgar",
      _generated_at: new Date().toISOString(),
      _mode: "dry-skeleton",
      companies: [],
    };
    await fs.writeFile(outFile, JSON.stringify(skeleton, null, 2));
    console.log(`[dry] wrote empty skeleton ${outFile}`);
    return;
  }

  const cikMap = await loadTickerCikMap({ apply: true });
  console.log(`Loaded ${Object.keys(cikMap).length} SEC ticker→CIK rows.`);

  let companies = await loadCompanies();
  console.log(`${companies.length} TruNorth entries have a ticker.`);

  if (SLUG_ARG) companies = companies.filter(c => c.slug === SLUG_ARG);
  if (SMOKE)    companies = companies.filter(c => SMOKE_TICKERS.has(c.ticker));
  if (LIMIT)    companies = companies.slice(0, LIMIT);

  console.log(`Processing ${companies.length} companies…`);
  const records = [];
  let ok = 0, noCik = 0, noFiling = 0, noTable = 0, err = 0;
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    try {
      const r = await processCompany(c, cikMap);
      records.push(r);
      if (r.status === "ok") ok++;
      else if (r.status === "no_cik") noCik++;
      else if (r.status === "no_def14a") noFiling++;
      else if (r.status === "no_comp_table") noTable++;
      if ((i + 1) % 50 === 0 || i === companies.length - 1) {
        console.log(`  [${i + 1}/${companies.length}] ok=${ok} no_cik=${noCik} no_def14a=${noFiling} no_table=${noTable} err=${err}`);
      }
    } catch (e) {
      err++;
      records.push({ slug: c.slug, ticker: c.ticker, status: "error", error: e.message });
    }
  }

  const out = {
    _license: "US public domain — SEC EDGAR",
    _source: "https://www.sec.gov/edgar",
    _user_agent: UA,
    _generated_at: new Date().toISOString(),
    _stats: { total: companies.length, ok, no_cik: noCik, no_def14a: noFiling, no_comp_table: noTable, error: err },
    companies: records,
  };
  await fs.writeFile(outFile, JSON.stringify(out));
  console.log(`Wrote ${outFile} (${records.length} records, ${ok} usable).`);
}

// Only run main() when invoked as a script — keep exports importable
// from the test runner without side effects.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
