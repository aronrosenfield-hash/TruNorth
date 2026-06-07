#!/usr/bin/env node
/**
 * UN Business & Human Rights — Working Group communications scraper.
 *
 *   https://spcommreports.ohchr.org/Tmsearch/TMDocuments      (search form)
 *   https://spcommreports.ohchr.org/LatestReports/CommunicationSent (paginated table)
 *
 * The UN Working Group on Business and Human Rights (one of 56 thematic
 * Special Procedures mandates) routinely co-signs formal "communications"
 * — Allegation Letters (AL/JAL) and Urgent Appeals (UA/JUA) — sent to
 * States and corporations regarding alleged human-rights violations. The
 * OHCHR communication-report database publishes the full text (PDF) and
 * a structured table summary of every public communication.
 *
 * The /Tmsearch/TMDocuments search form requires an ASP.NET antiforgery
 * round-trip + Kendo grid AJAX, which is fragile and CSRF-bound. The
 * /LatestReports/CommunicationSent endpoint, in contrast, is a plain
 * paginated HTML table containing the same per-communication metadata
 * and is reachable with a single GET — much friendlier for scrapers.
 * We use it as the primary data source, filter for AL/UA/JAL/JUA, and
 * keep only communications where the "Working Group on business and
 * human rights" mandate appears OR where a corporation is named in the
 * summary.
 *
 * Expected HTML structure (verified against page 1 of the report and
 * the hand-crafted fixture at scripts/fixtures/un-bhr/sample.html):
 *
 *     <tr data-id="30774"></tr>          <!-- sentinel: communication ID -->
 *     <tr>
 *       <td>
 *         <ul>27 Feb 2026</ul>           <!-- date -->
 *         <ul ...>Australia</ul>          <!-- addressed-to country (bold) -->
 *         <ul>JAL</ul>                   <!-- type: AL / UA / JAL / JUA / OL / JOL -->
 *         <ul><a href="/TMResultsBase/DownLoadPublicCommunicationFile?gId=…"
 *                target="Com_…">AUS 2/2026</a></ul>   <!-- ref + PDF link -->
 *       </td>
 *       <td><ul><li>mandate</li><li>mandate</li>…</ul></td>
 *       <td style="…">Summary text … More details…</td>
 *       <td>Replies received (Rep_… links, optional)</td>
 *     </tr>
 *
 * Output (raw):
 *   data/raw/un-bhr/<YYYY-MM-DD>.json
 *   {
 *     generated_at, source_url, page_count, fixture_mode,
 *     communications: [
 *       { id, date, country, type, ref, mandates: [],
 *         summary, source_url, named_companies: [], topic }
 *     ]
 *   }
 *
 * Standalone:
 *   node scripts/un-bhr-fetch.mjs --limit 50 --out /tmp/test.json
 *   node scripts/un-bhr-fetch.mjs --fixture            # parses sample.html
 *   node scripts/un-bhr-fetch.mjs                       # full scrape, default cron
 *
 * Politeness:
 *   - 3 sec between page fetches (REQ_DELAY_MS)
 *   - Honest UA identifying TruNorth + reason
 *   - Retry 5xx with exponential backoff (3 tries)
 *
 * License: UN content is public-domain (United Nations Charter Article 102
 * & OHCHR public-information policy). Records keep `source_url` so the
 * downstream company JSON can attribute every claim to a UN comm.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/un-bhr");
const FIXTURE_FILE = path.join(ROOT, "scripts/fixtures/un-bhr/sample.html");

const BASE = "https://spcommreports.ohchr.org";
const LIST_PATH = "/LatestReports/CommunicationSent";
const MAX_PAGES = 20;            // current HRC session covers ~200 records
const REQ_DELAY_MS = 3000;       // 3 sec between requests, per spec
const UA = "TruNorth-UNBHR/1.0 (+https://www.trunorthapp.com; values-grading data pipeline)";

// Communication types we keep: AL = Allegation Letter, UA = Urgent Appeal,
// JAL/JUA = joint variants (Working Group co-signs most JALs/JUAs).
// OL/JOL = "Other Letter" — included only when the WG-business mandate
// is present, since those are typically state-only.
const KEEP_TYPES = new Set(["AL", "UA", "JAL", "JUA"]);
const KEEP_TYPES_IF_BIZ = new Set([...KEEP_TYPES, "OL", "JOL"]);

// Recognise the Working Group on B&HR by any of its commonly-used labels.
const BHR_MANDATE_PATTERNS = [
  /transnational corporations and other business enterprises/i,
  /working group.{0,40}business/i,
  /\bWGBHR\b/,
];

/* ------------------------------ args ------------------------------------ */

const argv = process.argv.slice(2);
function getArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const LIMIT = Number(getArg("--limit") || 0) || Infinity;
const OUT_ARG = getArg("--out");
const FIXTURE_MODE = argv.includes("--fixture");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------ fetch ----------------------------------- */

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchText(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

/* ---------------------------- html helpers ------------------------------ */

export function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------- row parser -------------------------------- */
//
// Walks the HTML one `<tr data-id="…"></tr>` sentinel at a time. Each
// sentinel announces the communication ID; the very next `<tr>` carries
// the data cells. The relevant selectors:
//
//   - data-id  → unique communication ID (used to dedupe + build URL)
//   - first <td>:  4 stacked <ul> blocks → date, country, type, ref-no
//   - second <td>: <li>…</li> per mandate
//   - third <td>:  summary text (sometimes with a trailing "More details…")
//
// Real OHCHR markup wraps everything in Kendo grid <div>s, but the
// <tr data-id>…<tr> pairing is stable Kendo aspnetmvc output and has
// been the same since at least 2018. If the parser starts returning
// 0 rows on a real fetch, the most likely cause is the table moving
// to client-side rendering — re-check this file's TRIGGER notes.

export function parseLatestReportsPage(html) {
  const out = [];
  // Match each data-id sentinel and capture from it to the next sentinel
  // OR the end of the tbody. We do this in two passes: split on
  // `<tr data-id="…">…</tr>` markers, then map across the chunks.
  const sentinelRe = /<tr\s+data-id\s*=\s*["'](\d+)["']\s*>\s*<\/tr>/gi;
  const sentinels = [];
  let m;
  while ((m = sentinelRe.exec(html)) !== null) {
    sentinels.push({ id: m[1], start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < sentinels.length; i++) {
    const s = sentinels[i];
    const nextStart = i + 1 < sentinels.length ? sentinels[i + 1].start : html.length;
    const chunk = html.slice(s.end, nextStart);
    // The chunk's first <tr>…</tr> is the data row.
    const trMatch = chunk.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
    if (!trMatch) continue;
    const tr = trMatch[1];

    // Slice the 4 <td>s in order.
    const tds = [];
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM;
    while ((tdM = tdRe.exec(tr)) !== null) tds.push(tdM[1]);
    if (tds.length < 3) continue;

    const meta = parseMetaCell(tds[0]);
    const mandates = parseMandates(tds[1]);
    const summary = parseSummary(tds[2]);

    out.push({
      id: s.id,
      date: meta.date,
      country: meta.country,
      type: meta.type,
      ref: meta.ref,
      mandates,
      summary,
      source_url: `${BASE}/TMResultsBase/DownLoadPublicCommunicationFile?gId=${s.id}`,
    });
  }
  return dedupeById(out);
}

function dedupeById(arr) {
  const seen = new Set();
  const out = [];
  for (const r of arr) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

// First-cell layout: 4 <ul> blocks in order: date / country / type / ref
export function parseMetaCell(cellHtml) {
  const ulRe = /<ul\b[^>]*>([\s\S]*?)<\/ul>/gi;
  const ulTexts = [];
  let m;
  while ((m = ulRe.exec(cellHtml)) !== null) {
    ulTexts.push(stripHtml(m[1]));
  }
  // Real markup sometimes has 4 <ul>s, sometimes the country one has
  // font-weight:700, sometimes a 5th hidden <ul>. We classify by content.
  const date = ulTexts.map(normalizeDate).find(Boolean) || null;
  const type = ulTexts.find(t => /^(AL|UA|JAL|JUA|OL|JOL|AM|JAM)$/i.test(t)) || null;
  // Ref looks like "AUS 2/2026" or "NGA 1/2026" — 3-letter code + number/year
  const ref = ulTexts.find(t => /^[A-Z]{3}\s+\d+\/\d{4}/.test(t)) || null;
  // Country = the remaining bold-styled or longest-non-numeric <ul>.
  // First filter out date / type / ref, then pick the longest remaining.
  const candidates = ulTexts.filter(t =>
    t !== date &&
    t !== type &&
    t !== ref &&
    !/^\d{1,2}\s/.test(t) &&
    t.length >= 3 &&
    /[A-Za-z]/.test(t),
  );
  const country = candidates.sort((a, b) => b.length - a.length)[0] || null;
  return { date, country, type, ref };
}

function normalizeDate(s) {
  if (!s) return null;
  // "27 Feb 2026"
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!m) return null;
  const months = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const mi = months[m[2].slice(0, 3).toLowerCase()];
  if (!mi) return null;
  const dd = String(m[1]).padStart(2, "0");
  const mm = String(mi).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

function parseMandates(cellHtml) {
  const out = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(cellHtml)) !== null) {
    const t = stripHtml(m[1]);
    if (t) out.push(t);
  }
  return out;
}

function parseSummary(cellHtml) {
  // The summary may contain a trailing "More details…" link; drop it.
  let s = stripHtml(cellHtml);
  s = s.replace(/\bMore details\.+\s*$/i, "").trim();
  return s.slice(0, 1000);
}

/* ----------------------- company-name extraction ------------------------ */
//
// Communications routinely name corporations explicitly. We look for
// the standard corporate suffixes and capture a 1–4 token capitalised
// phrase immediately preceding them. To reduce false positives we also
// keep a small allow-list of well-known stand-alone brand mentions
// ("Shell", "Chevron", "Glencore"…) that often appear without a suffix.
//
// Returns deduped, trimmed list of strings. Caller should normalise
// further if it needs slug matching.

const SUFFIX_RE = new RegExp(
  String.raw`\b(?:` +
  [
    // multi-token capitalised phrase + suffix
    `[A-Z][A-Za-z0-9&'À-ſ.\\-]+(?:\\s+[A-Z][A-Za-z0-9&'À-ſ.\\-]+){0,4}\\s+` +
    `(?:Corporation|Corp\\.?|Company|Co\\.?|Holdings|Industries|International|Limited|Ltd\\.?|` +
    `LLC|L\\.L\\.C\\.?|PLC|plc|GmbH|AG|N\\.V\\.?|S\\.A\\.R\\.L\\.?|S\\.A\\.S?\\.?|S\\.p\\.A\\.?|` +
    `Group|Inc\\.?|LLP|Pty\\.?\\s+Ltd\\.?|Bhd|Sdn\\.?\\s+Bhd|Pvt\\.?\\s+Ltd\\.?|Berhad|JSC|PJSC|OAO|OOO)`,
  ].join("|") +
  `)`,
  "g",
);

// Optional allow-list of single-token brand mentions that signal a
// corporation even without a suffix in the OHCHR text. Conservative on
// purpose — anything not in here MUST have a suffix to be picked up.
const SINGLE_TOKEN_BRANDS = new Set([
  "Chevron", "Shell", "ExxonMobil", "Glencore", "BHP", "Rio Tinto",
  "TotalEnergies", "Vedanta", "Eni", "Repsol", "Equinor", "BP",
  "Microsoft", "Google", "Meta", "Apple", "Amazon", "Tesla",
  "Nestlé", "Nestle", "Unilever", "Coca-Cola", "PepsiCo",
  "Cargill", "Bunge", "Wilmar",
  "Samsung", "Hyundai", "LG", "Sony", "Huawei",
  "Tesco", "Walmart", "Carrefour", "IKEA",
  "Pfizer", "Bayer", "Syngenta", "Monsanto",
]);

export function extractCompanies(text) {
  if (!text) return [];
  const found = new Set();
  // 1. suffix-based
  let m;
  // reset lastIndex because the regex is /g
  SUFFIX_RE.lastIndex = 0;
  while ((m = SUFFIX_RE.exec(text)) !== null) {
    let candidate = m[0].trim()
      .replace(/^(the|of|and|by|to|from|with)\s+/i, "")
      .replace(/[,;.]+$/g, "");
    // Discard obvious non-companies that happen to match the pattern
    if (/^(Working Group|Special Rapporteur|Human Rights|United Nations|International Covenant|Information Limited)/i.test(candidate)) continue;
    if (candidate.length < 3 || candidate.length > 120) continue;
    found.add(candidate);
  }
  // 2. single-token brand mentions
  for (const brand of SINGLE_TOKEN_BRANDS) {
    // Match "Brand" as a whole word (after escaping). For multi-word
    // brands like "Rio Tinto" we just look for the literal phrase.
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`);
    if (re.test(text)) found.add(brand);
  }
  return [...found];
}

/* ------------------------------ filter ---------------------------------- */
//
// A communication is kept iff:
//   (a) its type is AL/UA/JAL/JUA  AND  it mentions a corporate name OR
//       has the WGBHR mandate; OR
//   (b) its type is OL/JOL AND it has the WGBHR mandate.

function hasBhrMandate(mandates) {
  const blob = (mandates || []).join(" | ");
  return BHR_MANDATE_PATTERNS.some(re => re.test(blob));
}

function inferTopic(mandates) {
  const blob = (mandates || []).join(" ").toLowerCase();
  if (/environment|toxic|pollution|climate|extractive/.test(blob)) return "environment";
  if (/indigenous/.test(blob)) return "indigenous";
  if (/labour|labor|forced labour|trafficking|migrant/.test(blob)) return "labor";
  if (/privacy|surveillance|expression|opinion/.test(blob)) return "privacy";
  if (/defenders/.test(blob)) return "human_rights_defenders";
  return "general";
}

// The OHCHR table addresses each communication to a single party — usually
// a State, sometimes a corporation, sometimes an inter-governmental body.
// When the addressee LOOKS like a corporation (has a corporate suffix or
// is in our brand allow-list), we treat it as a named company too so the
// merger can attribute the case to the corporation that the comm was
// actually sent to (e.g. "Microsoft Corporation" / "Glencore plc" rows).
export function isAddresseeCompany(country) {
  if (!country) return false;
  if (extractCompanies(country).length > 0) return true;
  // Otherwise it's a State / IGO / "United Nations" → false.
  return false;
}

export function isBusinessCase(rec) {
  const inSummary = extractCompanies(rec.summary || "");
  const addresseeIsCompany = isAddresseeCompany(rec.country);
  const companies = [...inSummary];
  if (addresseeIsCompany && !companies.includes(rec.country)) {
    companies.unshift(rec.country);
  }
  const bhr = hasBhrMandate(rec.mandates);
  const type = (rec.type || "").toUpperCase();

  if ((type === "OL" || type === "JOL") && !bhr) return null;
  if (!KEEP_TYPES_IF_BIZ.has(type)) return null;
  if (companies.length === 0) return null; // need at least one named company

  return {
    ...rec,
    named_companies: companies,
    topic: inferTopic(rec.mandates),
  };
}

/* ------------------------------ runner ---------------------------------- */

export async function fetchAllCommunications({ maxPages = MAX_PAGES, fixture = false } = {}) {
  if (fixture) {
    const html = await fs.readFile(FIXTURE_FILE, "utf-8");
    return parseLatestReportsPage(html);
  }
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const url = p === 1 ? `${BASE}${LIST_PATH}` : `${BASE}${LIST_PATH}?page=${p}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) {
      console.error(`  page ${p} failed: ${err.message}`);
      continue;
    }
    const rows = parseLatestReportsPage(html);
    console.log(`  page ${p}: ${rows.length} rows`);
    if (rows.length === 0) break;
    all.push(...rows);
    if (p < maxPages) await sleep(REQ_DELAY_MS);
  }
  return dedupeById(all);
}

async function main() {
  console.log(`UN B&HR communications fetcher starting… (${FIXTURE_MODE ? "FIXTURE" : "LIVE"})`);

  const rows = await fetchAllCommunications({ fixture: FIXTURE_MODE });
  console.log(`Total rows: ${rows.length}`);

  const businessCases = rows
    .map(isBusinessCase)
    .filter(Boolean)
    .slice(0, LIMIT);
  console.log(`Business-relevant: ${businessCases.length}`);

  const today = new Date().toISOString().slice(0, 10);
  const outFile = OUT_ARG || path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    source_url: `${BASE}${LIST_PATH}`,
    fixture_mode: FIXTURE_MODE,
    page_count: rows.length === 0 ? 0 : Math.ceil(rows.length / 10),
    total_rows: rows.length,
    business_case_count: businessCases.length,
    communications: businessCases,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("un-bhr-fetch failed:", err);
    process.exit(1);
  });
}
