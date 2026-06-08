#!/usr/bin/env node
/**
 * SEC 8-K Material Events parser — Items 5.02 + 4.02.
 *
 * For every public US company in /public/data/index.json that we can
 * map to a SEC CIK, this script walks the company's 8-K filings index
 * (data.sec.gov/submissions/CIK...) and extracts two material-event
 * signals from the past 24 months:
 *
 *   - Item 5.02 — Departure/Election of Directors or Principal Officers
 *                 (CEO/CFO/board changes; we also try to detect whether
 *                  severance terms were disclosed).
 *   - Item 4.02 — Non-Reliance on Previously Issued Financial Statements
 *                 (i.e. an accounting restatement — a major red flag).
 *
 * 8-K item parsing
 * ────────────────
 * Each 8-K's submissions index row carries a comma-separated `items`
 * field ("5.02,9.01"). We:
 *   1. Pull the EDGAR submissions JSON, filter to form="8-K" in the past
 *      24 months with items mentioning 5.02 or 4.02.
 *   2. Fetch the primary HTML document and confirm the item is present
 *      (some filers list multiple items; we only want events that
 *      actually triggered one of our two signals).
 *   3. For 5.02 events: classify the role (CEO, CFO, director, etc.)
 *      and the action (departure / appointment / resignation /
 *      termination), then scan for severance language.
 *   4. For 4.02 events: capture which prior periods were restated and
 *      pull the opening of the explanation.
 *
 * Output (one big file per run, dated):
 *   data/raw/sec-8k-events/<YYYY-MM-DD>.json
 *
 * Per-company record shape:
 *   {
 *     slug, name, ticker, cik,
 *     status: "ok" | "no_events" | "no_cik" | "error",
 *     execDepartures: [
 *       { filingDate, accession, sourceUrl, items: ["5.02"],
 *         role, action, personName, severanceDisclosed, excerpt }
 *     ],
 *     restatements: [
 *       { filingDate, accession, sourceUrl, items: ["4.02"],
 *         periodsAffected, excerpt }
 *     ],
 *     error,
 *   }
 *
 * License: SEC EDGAR data is US public domain. We identify ourselves
 * with a descriptive User-Agent as required by the SEC's fair-use policy
 * (https://www.sec.gov/os/accessing-edgar-data) and throttle at
 * ≤10 req/sec.
 *
 * Flags:
 *   --dry       (default) — do NOT hit the network. Use a previous
 *                           output file if one exists so the merger can
 *                           be tested offline. With no prior output,
 *                           emits an empty skeleton.
 *   --apply     — actually call SEC EDGAR.
 *   --smoke     — restrict to a handful of household-name tickers.
 *   --limit N   — cap fetches at N companies.
 *   --slug X    — only run for one slug.
 *
 * Runs via .github/workflows/sec-8k-events-monthly.yml — monthly.
 *
 * Locally:
 *   node scripts/sec-8k-events-fetch.mjs --smoke --apply
 *   node scripts/sec-8k-events-fetch.mjs --apply --limit 100
 *   node scripts/sec-8k-events-fetch.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTickerCikMap } from "./sec-def14a-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const RAW_DIR    = path.join(ROOT, "data/raw/sec-8k-events");

const UA = "TruNorth Data Pipeline aron@trunorthapp.com";
const RATE_LIMIT_MS = 110;   // SEC limit is 10 req/sec; 110ms is safely under
const MAX_RETRIES   = 3;
const LOOKBACK_DAYS = 24 * 30;   // ~24 months
const PER_COMPANY_DOC_CAP = 10;  // cap document fetches per company

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

// ─────────────────────────── EDGAR helpers ────────────────────────

// Build the canonical URL for a filing's primary document inside the
// EDGAR Archives. Accession is like "0000320193-26-000005"; the archive
// path uses the no-dashes version under the CIK directory.
export function archiveUrl(cik, accession, document) {
  const cleanCik = String(parseInt(cik, 10));
  const noDashAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${noDashAcc}/${document}`;
}

/**
 * From an EDGAR submissions JSON, return all 8-K filings in the past
 * `lookbackDays` whose `items` field mentions Item 5.02 or 4.02.
 * Returns an array of { accession, primaryDocument, filingDate, items }.
 */
export function pickRecent8KEvents(submissions, { lookbackDays = LOOKBACK_DAYS, today = new Date() } = {}) {
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const cutoff = new Date(today.getTime() - lookbackDays * 86400_000)
    .toISOString().slice(0, 10);
  const out = [];
  for (let i = 0; i < recent.form.length; i++) {
    const f = String(recent.form[i] || "").toUpperCase();
    if (f !== "8-K" && f !== "8-K/A") continue;
    const filingDate = recent.filingDate[i];
    if (!filingDate || filingDate < cutoff) continue;
    const itemsStr = String(recent.items?.[i] || "");
    // Items is a comma-separated list like "5.02,9.01".
    const matched = [];
    if (/(^|[^0-9])5\.02([^0-9]|$)/.test(itemsStr)) matched.push("5.02");
    if (/(^|[^0-9])4\.02([^0-9]|$)/.test(itemsStr)) matched.push("4.02");
    if (!matched.length) continue;
    out.push({
      accession: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      filingDate,
      items: matched,
      reportDate: recent.reportDate?.[i] || null,
    });
  }
  return out;
}

// ─────────────────────────── HTML helpers ─────────────────────────

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

// ─────────────────────────── Item 5.02 parsing ────────────────────

// Role labels are checked in order — first hit wins (CEO trumps
// "Officer" generic, etc.). "Director" comes last among governance
// roles because most exec-level 5.02s also include a board reference.
const ROLE_PATTERNS = [
  { role: "CEO",       re: /\b(chief executive officer|CEO|principal executive officer)\b/i },
  { role: "CFO",       re: /\b(chief financial officer|CFO|principal financial officer)\b/i },
  { role: "COO",       re: /\b(chief operating officer|COO)\b/i },
  { role: "President", re: /\bpresident\b/i },
  { role: "Chair",     re: /\b(chair(?:man|woman|person)?(?:\s+of\s+the\s+board)?)\b/i },
  { role: "Other officer", re: /\b(chief [a-z]+ officer|general counsel|principal accounting officer)\b/i },
  { role: "Director",  re: /\b(director|board member)\b/i },
];

// Note on order: the canonical Item 5.02 heading itself contains the
// word "Departure" ("Departure of Directors or Certain Officers; Election
// of Directors; Appointment of Certain Officers"), so a naive heading
// scan would always match "Departure". We strip the heading line before
// classifying, then prefer specific verbs (resign/terminate/retire/die)
// before the generic "depart…/separation" fallback. Appointment last:
// pure-appointment filings tend to contain only Appointment-class verbs
// in the body once the heading is removed.
const ACTION_PATTERNS = [
  { action: "Resignation",  re: /\b(resign(?:ed|s|ation)?|stepped down|step down|stepping down)\b/i },
  { action: "Termination",  re: /\b(terminat(?:ed|ion)|removed|dismissed|fired)\b/i },
  { action: "Retirement",   re: /\b(retir(?:ed|ement|ing))\b/i },
  { action: "Death",        re: /\b(passed away|death of|deceased)\b/i },
  { action: "Appointment",  re: /\b(appoint(?:ed|s|ment)|elect(?:ed|ion)?|nam(?:ed|ing)|hired|hire)\b/i },
  { action: "Departure",    re: /\b(depart(?:ure|ed|s)|separation|leave|leaving)\b/i },
];

const SEVERANCE_RE = /\b(severance|separation pay(?:ment)?|separation agreement|transition (?:agreement|services? agreement)|cash payment|continuation pay|accelerated vesting|lump[- ]sum payment)\b/i;

/**
 * Classify a single 8-K Item 5.02 event from its primary-document text.
 * Returns one or more events (a single 8-K may report both a departure
 * AND an appointment). Each event is:
 *   { role, action, personName, severanceDisclosed, excerpt }
 */
export function parseItem502(text) {
  const startRe = /Item\s+5\.02[^A-Za-z0-9]/i;
  const startMatch = startRe.exec(text);
  if (!startMatch) return [];
  const start = startMatch.index;
  const tail = text.slice(start);
  // End at next Item N.NN heading. Skip the first 20 chars so the
  // current "Item 5.02" doesn't match itself.
  const endMatch = /Item\s+(?:[0-9]\.[0-9]{2})/i.exec(tail.slice(20));
  const section = endMatch ? tail.slice(0, 20 + endMatch.index) : tail.slice(0, 4000);

  let role = null;
  for (const p of ROLE_PATTERNS) {
    if (p.re.test(section)) { role = p.role; break; }
  }
  if (!role) role = "Officer";

  let action = null;
  for (const p of ACTION_PATTERNS) {
    if (p.re.test(section)) { action = p.action; break; }
  }
  if (!action) action = "Change";

  // Person name: prefer "Mr./Ms./Mrs./Dr. <FirstName LastName>". If
  // missing, look for "<FirstName LastName>, the Company's …" patterns.
  // Conservative — null is fine when we can't be confident.
  let personName = null;
  const honorific = /\b(?:Mr|Ms|Mrs|Dr)\.\s+([A-Z][A-Za-z\-']+(?:\s+[A-Z]\.)?(?:\s+[A-Z][A-Za-z\-']+){1,2})/.exec(section);
  if (honorific) personName = honorific[1];
  if (!personName) {
    const nameRole = /\b([A-Z][A-Za-z\-']+\s+[A-Z][A-Za-z\-']+)(?:,?\s+(?:the\s+)?(?:Company|Corporation)'s|\s+will|\s+has|\s+resigned|\s+retired|\s+stepped|\s+was|\s+is appointed)/.exec(section);
    if (nameRole) personName = nameRole[1];
  }

  const severanceDisclosed = SEVERANCE_RE.test(section);
  const excerpt = section.slice(0, 400).trim();

  return [{ role, action, personName, severanceDisclosed, excerpt }];
}

// ─────────────────────────── Item 4.02 parsing ────────────────────

/**
 * Parse an 8-K Item 4.02 (Non-Reliance) section. Returns:
 *   { periodsAffected: ["2023", "Q1 2024", ...], excerpt }
 * or null if section isn't present.
 */
export function parseItem402(text) {
  const startRe = /Item\s+4\.02[^A-Za-z0-9]/i;
  const startMatch = startRe.exec(text);
  if (!startMatch) return null;
  const start = startMatch.index;
  const tail = text.slice(start);
  const endMatch = /Item\s+(?:[0-9]\.[0-9]{2})/i.exec(tail.slice(20));
  const section = endMatch ? tail.slice(0, 20 + endMatch.index) : tail.slice(0, 4000);

  // Find years / quarters being restated. Years 2000..currentYear+1.
  const periods = new Set();
  const yearRe = /\b(20\d{2})\b/g;
  let ym;
  const currentYear = new Date().getFullYear();
  while ((ym = yearRe.exec(section))) {
    const y = parseInt(ym[1], 10);
    if (y >= 2000 && y <= currentYear + 1) periods.add(String(y));
  }
  // Non-greedy gap so "Q1 2024 and Q2 2024" yields TWO matches, not one
  // that swallows Q2's year.
  const qRe = /\b(Q[1-4]|first quarter|second quarter|third quarter|fourth quarter)\b[^.]{0,15}?(20\d{2})/gi;
  let qm;
  while ((qm = qRe.exec(section))) {
    periods.add(`${normalizeQuarter(qm[1])} ${qm[2]}`);
  }

  const excerpt = section.slice(0, 500).trim();
  return {
    periodsAffected: Array.from(periods),
    excerpt,
  };
}

function normalizeQuarter(s) {
  const t = s.toLowerCase();
  if (t.startsWith("first")) return "Q1";
  if (t.startsWith("second")) return "Q2";
  if (t.startsWith("third")) return "Q3";
  if (t.startsWith("fourth")) return "Q4";
  return s.toUpperCase();
}

// ─────────────────────────── Pipeline ─────────────────────────────

async function loadCompanies() {
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

  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const subs = await fetchSec(url, { json: true });
  await sleep(RATE_LIMIT_MS);
  if (!subs || subs._error || subs._notFound) {
    return {
      slug: c.slug, name: c.name, ticker: c.ticker, cik,
      status: "error", error: "submissions_fetch_failed",
    };
  }

  const events = pickRecent8KEvents(subs);
  if (!events.length) {
    return {
      slug: c.slug, name: c.name, ticker: c.ticker, cik,
      status: "no_events",
      execDepartures: [],
      restatements: [],
    };
  }

  const execDepartures = [];
  const restatements   = [];
  const docsToFetch = events.slice(0, PER_COMPANY_DOC_CAP);
  for (const ev of docsToFetch) {
    const docUrl = archiveUrl(cik, ev.accession, ev.primaryDocument);
    const doc = await fetchSec(docUrl);
    await sleep(RATE_LIMIT_MS);
    if (typeof doc !== "string") continue;
    const text = htmlToText(doc);

    if (ev.items.includes("5.02")) {
      const parsed = parseItem502(text);
      for (const p of parsed) {
        execDepartures.push({
          filingDate: ev.filingDate,
          accession:  ev.accession,
          sourceUrl:  docUrl,
          items:      ev.items,
          ...p,
        });
      }
    }
    if (ev.items.includes("4.02")) {
      const parsed = parseItem402(text);
      if (parsed) {
        restatements.push({
          filingDate: ev.filingDate,
          accession:  ev.accession,
          sourceUrl:  docUrl,
          items:      ev.items,
          ...parsed,
        });
      }
    }
  }

  return {
    slug: c.slug, name: c.name, ticker: c.ticker, cik,
    status: (execDepartures.length || restatements.length) ? "ok" : "no_events",
    execDepartures,
    restatements,
  };
}

async function main() {
  console.log(`SEC 8-K events fetcher — mode=${APPLY ? "APPLY" : "DRY"}${SMOKE ? " smoke" : ""}${LIMIT ? ` limit=${LIMIT}` : ""}${SLUG_ARG ? ` slug=${SLUG_ARG}` : ""}`);

  const today = new Date().toISOString().slice(0, 10);
  await fs.mkdir(RAW_DIR, { recursive: true });
  const outFile = path.join(RAW_DIR, `${today}.json`);

  if (DRY) {
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
  let ok = 0, noCik = 0, noEvents = 0, err = 0;
  let totalDepartures = 0, totalRestatements = 0;
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    try {
      const r = await processCompany(c, cikMap);
      records.push(r);
      if (r.status === "ok") {
        ok++;
        totalDepartures += r.execDepartures.length;
        totalRestatements += r.restatements.length;
      } else if (r.status === "no_cik") noCik++;
      else if (r.status === "no_events") noEvents++;
      else if (r.status === "error") err++;
      if ((i + 1) % 50 === 0 || i === companies.length - 1) {
        console.log(`  [${i + 1}/${companies.length}] ok=${ok} no_cik=${noCik} no_events=${noEvents} err=${err} departures=${totalDepartures} restatements=${totalRestatements}`);
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
    _stats: {
      total: companies.length, ok, no_cik: noCik, no_events: noEvents, error: err,
      total_departures: totalDepartures, total_restatements: totalRestatements,
    },
    companies: records,
  };
  await fs.writeFile(outFile, JSON.stringify(out));
  console.log(`Wrote ${outFile} (${records.length} records, ${ok} with events).`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
