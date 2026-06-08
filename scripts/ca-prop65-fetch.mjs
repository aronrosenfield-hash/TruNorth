#!/usr/bin/env node
/**
 * California Proposition 65 — chemical list + 60-day notice enforcement (monthly).
 *
 *   Chemical list:    https://oehha.ca.gov/proposition-65/proposition-65-list
 *   60-day notices:   https://oag.ca.gov/prop65/60-day-notice-search
 *   Judgment lookup:  https://oag.ca.gov/prop65/judgments
 *
 * Prop 65 is the California Safe Drinking Water and Toxic Enforcement Act of
 * 1986. The state (OEHHA) maintains a list of ~900+ chemicals known to cause
 * cancer, birth defects, or reproductive harm. Anyone selling a product in CA
 * with a detectable level of a Prop 65 chemical must carry a warning — and
 * private plaintiffs (the "bounty-hunter" provision) can issue a 60-day
 * notice of violation and sue if the manufacturer doesn't fix the labeling
 * or remove the chemical.
 *
 * This fetcher captures BOTH halves:
 *   1. The CANONICAL chemical list (CSV/XLSX from OEHHA).
 *   2. The ENFORCEMENT actions (60-day notices from the CA AG search page),
 *      which is where defendant company names live.
 *
 * Output:
 *   data/raw/ca-prop65/chemicals-<date>.json
 *   data/raw/ca-prop65/notices-<date>.json
 *
 * Standalone:
 *   node scripts/ca-prop65-fetch.mjs                       # default paths, live
 *   node scripts/ca-prop65-fetch.mjs --fixture             # use scripts/fixtures
 *   node scripts/ca-prop65-fetch.mjs --limit 100           # cap notice rows
 *   node scripts/ca-prop65-fetch.mjs --out-chemicals /tmp/c.json --out-notices /tmp/n.json
 *
 * Politeness:
 *   - 2 sec between requests when scraping notices (CRITICAL_CONSTRAINT).
 *   - Honest UA identifying TruNorth and the reason.
 *   - Filtered to the past 12 months by default — the OAG search has 25k+
 *     historical rows, which is too many to scrape monthly.
 *
 * License: California public records, free use.
 * _license: "Public, California OEHHA / OAG"
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/ca-prop65");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/ca-prop65");

const OEHHA_LIST_PAGE = "https://oehha.ca.gov/proposition-65/proposition-65-list";
// The exact filename rolls each month (e.g. p65_single03022024_0.xlsx). We
// scrape the OEHHA listing page for the current XLSX URL; the CSV export is
// also linked from the same page. If the page-scrape fails, we fall back to
// the documented "single03" filename pattern.
const OEHHA_FALLBACK_XLSX = "https://oehha.ca.gov/media/p65_single03022024_0.xlsx";

// /prop65/60-day-notice-search is the FORM page; the AJAX-trusted RESULTS
// view lives at /prop65/60-day-notice-search-results and is plain HTML
// (Drupal "view" template). All filtering is via GET params.
const OAG_NOTICE_SEARCH = "https://oag.ca.gov/prop65/60-day-notice-search-results";
const OAG_NOTICE_FORM   = "https://oag.ca.gov/prop65/60-day-notice-search";
const OAG_BASE = "https://oag.ca.gov";

const UA = "TruNorth-Prop65/1.0 (+https://www.trunorthapp.com; data pipeline for consumer-safety transparency)";
const REQ_DELAY_MS = 2000; // 2s between OAG search-page requests (politeness)
const MAX_PAGES = 200;     // cap notice pagination — pages vary ~25-50 rows each, ~3-5k rows/year
const DEFAULT_LIMIT = 5000; // cap on total notice rows captured

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const LIMIT = (() => {
  const i = argv.indexOf("--limit");
  return i >= 0 ? parseInt(argv[i + 1], 10) || DEFAULT_LIMIT : DEFAULT_LIMIT;
})();
const OUT_CHEMICALS = (() => {
  const i = argv.indexOf("--out-chemicals");
  return i >= 0 ? argv[i + 1] : null;
})();
const OUT_NOTICES = (() => {
  const i = argv.indexOf("--out-notices");
  return i >= 0 ? argv[i + 1] : null;
})();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10);

/* -------------------------- generic helpers ------------------------------ */

export function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
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

async function fetchText(url, attempt = 0, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/csv,text/csv", ...headers },
      redirect: "follow",
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchText(url, attempt + 1, headers);
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchText(url, attempt + 1, headers);
    }
    throw err;
  }
}

/* ============================================================ */
/*   PART 1: OEHHA chemical list                                */
/* ============================================================ */

/**
 * Parse a CSV string into an array of records keyed by header row.
 * Handles double-quoted fields with embedded commas/quotes — sufficient
 * for the OEHHA CSV which uses standard RFC 4180.
 */
export function parseCSV(text) {
  if (!text) return [];
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === "") continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = (rows[r][c] || "").trim();
    out.push(obj);
  }
  return out;
}

/**
 * Normalize a raw OEHHA chemical row into our canonical shape. The OEHHA CSV
 * column headers have shifted over the years — we accept several common
 * variants and emit a stable shape.
 */
export function normalizeChemicalRow(row) {
  const pick = (...keys) => {
    for (const k of keys) {
      for (const have of Object.keys(row)) {
        if (have.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, "")) {
          return row[have];
        }
      }
    }
    return "";
  };
  const chemical = pick("Chemical", "ChemicalName", "Chemical Name");
  if (!chemical) return null;
  return {
    chemical: chemical.trim(),
    cas_number: (pick("CAS No.", "CAS Number", "CASNo", "CAS") || "").trim(),
    type_of_toxicity: (pick("Type of Toxicity", "Toxicity", "TypeOfToxicity") || "").trim().toLowerCase(),
    listing_mechanism: (pick("Listing Mechanism", "ListingMechanism") || "").trim(),
    date_listed: (pick("Date Listed", "DateListed") || "").trim(),
  };
}

/**
 * Find the current chemical-list XLSX or CSV URL by scraping the OEHHA
 * listing page. Returns { url, format } or null. We prefer CSV (parseable
 * with built-ins) but accept XLSX (would need the `xlsx` npm package).
 */
export function findChemicalListUrl(html) {
  if (!html) return null;
  // CSV link is most useful — parseable with built-ins.
  const csvRe = /href=["']([^"']+\.csv)["']/gi;
  let m;
  while ((m = csvRe.exec(html)) !== null) {
    if (/p65[_-]/i.test(m[1]) || /single/i.test(m[1])) {
      const url = m[1].startsWith("http") ? m[1] : `https://oehha.ca.gov${m[1].startsWith("/") ? "" : "/"}${m[1]}`;
      return { url, format: "csv" };
    }
  }
  // Fallback: XLSX
  const xlsxRe = /href=["']([^"']+\.xlsx)["']/gi;
  while ((m = xlsxRe.exec(html)) !== null) {
    if (/p65[_-]/i.test(m[1]) || /single/i.test(m[1])) {
      const url = m[1].startsWith("http") ? m[1] : `https://oehha.ca.gov${m[1].startsWith("/") ? "" : "/"}${m[1]}`;
      return { url, format: "xlsx" };
    }
  }
  return null;
}

async function fetchChemicalList() {
  if (FIXTURE_MODE) {
    const f = path.join(FIXTURE_DIR, "chemicals.csv");
    if (!existsSync(f)) throw new Error(`fixture missing: ${f}`);
    const csv = await fs.readFile(f, "utf-8");
    const rows = parseCSV(csv).map(normalizeChemicalRow).filter(Boolean);
    return { url: f, format: "csv", rows };
  }

  // 1. Find the current URL by scraping the listing page.
  let target = null;
  try {
    const html = await fetchText(OEHHA_LIST_PAGE);
    target = findChemicalListUrl(html);
  } catch (err) {
    console.warn(`  OEHHA list page scrape failed (${err.message}); using fallback URL`);
  }
  if (!target) {
    target = { url: OEHHA_FALLBACK_XLSX, format: "xlsx" };
  }

  // 2. Fetch the file. We can only parse CSV with built-ins.
  if (target.format === "xlsx") {
    // Try the fallback CSV path inferred from the XLSX URL by swapping ext.
    const csvGuess = target.url.replace(/\.xlsx$/i, ".csv");
    try {
      const text = await fetchText(csvGuess);
      const rows = parseCSV(text).map(normalizeChemicalRow).filter(Boolean);
      if (rows.length > 100) {
        return { url: csvGuess, format: "csv", rows };
      }
    } catch { /* fall through */ }
    console.warn(`  XLSX-only source — Node built-ins can't parse XLSX. Emitting empty chemical list.`);
    return { url: target.url, format: "xlsx", rows: [], _note: "xlsx-source-unparsed" };
  }

  const text = await fetchText(target.url);
  const rows = parseCSV(text).map(normalizeChemicalRow).filter(Boolean);
  return { url: target.url, format: target.format, rows };
}

/* ============================================================ */
/*   PART 2: OAG 60-day notice search                           */
/* ============================================================ */

/**
 * The OAG /prop65/60-day-notice-search-results page renders a Drupal "view"
 * where each notice is a <div class="views-row …"> containing labeled
 * detail rows. Real (2026-06) markup looks like:
 *
 *   <div class="views-row …">
 *     <h3 class="ag-number"><a href="/prop65/60-Day-Notice-2026-02707">…</a></h3>
 *     <div class="details-label">
 *       <div class="details">Notice PDF: </div>
 *       <div><span class="file"><a href="…2026-02707.pdf">…</a></span></div>
 *     </div>
 *     <div class="details-label">
 *       <div class="details">Date Filed: </div>
 *       <div><span … class="date-display-single">06/05/2026</span></div>
 *     </div>
 *     <div class="details-label">
 *       <div class="details">Noticing Party: </div>
 *       <div>Environmental Health Advocates, Inc.</div>
 *     </div>
 *     <div class="details-label">
 *       <div class="details">Alleged Violators: </div>
 *       <div>The Save Mart Companies, LLC; Walmart Inc.</div>
 *     </div>
 *     <div class="views-field-field-prop65-chemical details-label">
 *       <div class="views-label … details">Chemical: </div>
 *       <div class="field-content ul">Aflatoxins</div>
 *     </div>
 *     <div class="details-label">
 *       <div class="details">Source: </div>
 *       <div>Pacific Coast Selections Almond Butter</div>
 *     </div>
 *   </div>
 *
 * We split the HTML into row blocks then extract each labeled field with a
 * label-anchored regex. A row's "Alleged Violators" may contain multiple
 * defendants separated by semicolons — we explode into one notice per
 * defendant so each gets counted against its own company file.
 *
 * The fixture in scripts/fixtures/ca-prop65/notices-search.html uses the
 * older table-based layout to also exercise that path (tableParser below).
 */
export function parseNoticesPage(html) {
  if (!html) return [];
  // 1. Modern div-based markup (live oag.ca.gov as of 2026-06).
  const divRows = parseNoticesDivLayout(html);
  if (divRows.length > 0) return divRows;
  // 2. Legacy table layout (used by our fixture for backward compatibility).
  return parseNoticesTableLayout(html);
}

function parseNoticesDivLayout(html) {
  const out = [];
  // Each notice block is a div with class "views-row ..."
  // We scan for these prefixes and grab everything up to the next one.
  const blockRe = /<div\s+class=["']views-row[^"']*["'][^>]*>([\s\S]*?)(?=<div\s+class=["']views-row|<\/div>\s*<\/div>\s*<\/div>|<nav|<ul\s+class=["']pager)/gi;
  let bm;
  while ((bm = blockRe.exec(html)) !== null) {
    const block = bm[1];
    if (!/ag-number|Alleged Violators|Date Filed/i.test(block)) continue;

    const agMatch = block.match(/<h3[^>]*class=["']ag-number["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const detailUrl = agMatch ? (agMatch[1].startsWith("http") ? agMatch[1] : `${OAG_BASE}${agMatch[1].startsWith("/") ? "" : "/"}${agMatch[1]}`) : null;
    const agNumText = agMatch ? stripHtml(agMatch[2]) : "";
    const agNumber = (agNumText.match(/(\d{4}-\d{4,6})/) || [])[1] || null;

    // Prefer the PDF link as the canonical URL — it's the actual notice doc.
    const pdfM = block.match(/href=["'](https?:\/\/[^"']*\/system\/files\/prop65\/notices\/[^"']+\.pdf)["']/i);
    const url = pdfM ? pdfM[1] : detailUrl;

    const dateFiled = extractLabeled(block, "Date Filed");
    const plaintiff = extractLabeled(block, "Noticing Party");
    const violators = extractLabeled(block, "Alleged Violators");
    const chemical  = extractLabeled(block, "Chemical")
                   || extractLabeled(block, "Chemicals");
    const source    = extractLabeled(block, "Source")
                   || extractLabeled(block, "Source of Exposure");

    const date = normalizeNoticeDate(dateFiled, "");
    if (!violators) continue; // can't attribute without a defendant

    // Explode multi-defendant rows: "PB2 Foods, Inc.; Walmart Inc." → 2 rows.
    const defendants = violators.split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
    for (const defendant of defendants) {
      out.push({
        ag_number: agNumber,
        notice_date: date,
        plaintiff: plaintiff || null,
        defendant,
        chemical_alleged: chemical || null,
        product_type: source || null,
        url,
      });
    }
  }
  return out;
}

// Extract the value of a label like "Date Filed: <stuff>" inside a
// details-label block. Handles both the simple <div>VALUE</div> and the
// nested <span>VALUE</span> shapes used by the Drupal view.
function extractLabeled(block, label) {
  // First try the dedicated details-label container shape.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<div[^>]*class=["'][^"']*details-label[^"']*["'][^>]*>[\\s\\S]*?<div[^>]*class=["'][^"']*(?:views-label[^"']*)?details["'][^>]*>\\s*${escaped}\\s*:?\\s*<\\/div>([\\s\\S]*?)<\\/div>\\s*<\\/div>`,
    "i"
  );
  const m = block.match(re);
  if (m) return stripHtml(m[1]);
  return "";
}

// Legacy table-based layout — kept for the fixture so the test still
// exercises a real parsing path. Real OAG site uses the div layout above.
function parseNoticesTableLayout(html) {
  const out = [];
  const tbodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
  let tbm;
  while ((tbm = tbodyRe.exec(html)) !== null) {
    const tbody = tbm[1];
    if (!/<tr/.test(tbody)) continue;
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tbody)) !== null) {
      const tr = rm[1];
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      const cells = [];
      let cm;
      while ((cm = cellRe.exec(tr)) !== null) cells.push(cm[1]);
      if (cells.length < 6) continue;
      const linkM = tr.match(/href=["']([^"']+)["']/i);
      const link = linkM ? (linkM[1].startsWith("http") ? linkM[1] : `${OAG_BASE}${linkM[1].startsWith("/") ? "" : "/"}${linkM[1]}`) : null;
      const agNum     = stripHtml(cells[0]);
      const yearFiled = stripHtml(cells[1]);
      const dateFiled = stripHtml(cells[2]);
      const plaintiff = stripHtml(cells[3]);
      const defendant = stripHtml(cells[4]);
      const chemical  = stripHtml(cells[5]);
      const product   = cells[6] ? stripHtml(cells[6]) : "";
      if (/^AG\s*#?$/i.test(agNum) || (/year/i.test(yearFiled) && /filed/i.test(yearFiled))) continue;
      if (!defendant && !plaintiff && !chemical) continue;
      const date = normalizeNoticeDate(dateFiled, yearFiled);
      out.push({
        ag_number: agNum || null,
        notice_date: date,
        plaintiff: plaintiff || null,
        defendant: defendant || null,
        chemical_alleged: chemical || null,
        product_type: product || null,
        url: link,
      });
    }
  }
  return out;
}

function normalizeNoticeDate(dateFiled, yearFiled) {
  if (dateFiled) {
    // Try common formats: "2026-05-14", "05/14/2026", "May 14, 2026"
    const iso = dateFiled.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const us = dateFiled.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (us) {
      const mm = us[1].padStart(2, "0");
      const dd = us[2].padStart(2, "0");
      return `${us[3]}-${mm}-${dd}`;
    }
    const eng = dateFiled.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/);
    if (eng) {
      const d = new Date(`${eng[1]} ${eng[2]}, ${eng[3]} UTC`);
      if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
    }
  }
  if (yearFiled && /^\d{4}$/.test(yearFiled.trim())) return `${yearFiled.trim()}-01-01`;
  return null;
}

/**
 * Find pagination links in the OAG search results page. The Drupal pager
 * renders <a> tags with rel="next" or class~="pager__item" containing the
 * next URL. Returns the next URL (absolute) or null.
 */
export function findNextPageUrl(html, currentUrl) {
  if (!html) return null;
  // 1. <a rel="next" href="...">
  const relNext = html.match(/<a\b[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i)
              ||  html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*rel=["']next["']/i);
  if (relNext) {
    return relNext[1].startsWith("http") ? relNext[1] : `${OAG_BASE}${relNext[1].startsWith("/") ? "" : "/"}${relNext[1]}`;
  }
  // 2. Synthesize next page from current ?page= param
  try {
    const u = new URL(currentUrl, OAG_BASE);
    const cur = parseInt(u.searchParams.get("page") || "0", 10);
    u.searchParams.set("page", String(cur + 1));
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchNotices(limit, twelveMonthsAgo) {
  const collected = [];
  if (FIXTURE_MODE) {
    const f = path.join(FIXTURE_DIR, "notices-search.html");
    if (!existsSync(f)) throw new Error(`fixture missing: ${f}`);
    const html = await fs.readFile(f, "utf-8");
    const rows = parseNoticesPage(html);
    return rows.slice(0, limit);
  }

  // Build the search URL filtered to the past 12 months. The OAG site
  // expects MM/DD/YYYY in its GET filed_date filter params.
  const fmt = (d) => {
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${mm}/${dd}/${d.getUTCFullYear()}`;
  };
  const min = fmt(twelveMonthsAgo);
  const max = fmt(new Date());
  let url = `${OAG_NOTICE_SEARCH}?filed_date%5Bmin%5D%5Bdate%5D=${encodeURIComponent(min)}&filed_date%5Bmax%5D%5Bdate%5D=${encodeURIComponent(max)}`;

  for (let p = 0; p < MAX_PAGES; p++) {
    let html;
    try { html = await fetchText(url); }
    catch (err) {
      console.error(`  page ${p} failed: ${err.message}`);
      break;
    }
    const rows = parseNoticesPage(html);
    console.log(`  notices page ${p}: ${rows.length} rows`);
    if (rows.length === 0) break;
    collected.push(...rows);
    if (collected.length >= limit) { console.log(`  hit --limit ${limit}, stopping`); break; }
    const next = findNextPageUrl(html, url);
    if (!next || next === url) break;
    url = next;
    await sleep(REQ_DELAY_MS); // politeness: 2 sec between requests
  }
  return collected.slice(0, limit);
}

/* ============================================================ */
/*   Orchestrator                                                */
/* ============================================================ */

async function main() {
  console.log(`CA Prop 65 fetcher starting${FIXTURE_MODE ? " (--fixture mode)" : ""}…`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  // --- 1. Chemical list ---
  console.log("\n[1/2] Fetching OEHHA chemical list…");
  let chemicals;
  try {
    chemicals = await fetchChemicalList();
    console.log(`  source: ${chemicals.url}`);
    console.log(`  format: ${chemicals.format}`);
    console.log(`  chemicals: ${chemicals.rows.length}`);
  } catch (err) {
    console.error(`  chemical-list fetch failed: ${err.message}`);
    chemicals = { url: OEHHA_LIST_PAGE, format: "error", rows: [], _error: err.message };
  }
  const chemicalsPayload = {
    _license: "Public, California OEHHA / OAG",
    generated_at: new Date().toISOString(),
    source_url: chemicals.url,
    source_format: chemicals.format,
    listing_page: OEHHA_LIST_PAGE,
    count: chemicals.rows.length,
    chemicals: chemicals.rows,
    ...(chemicals._error ? { error: chemicals._error } : {}),
    ...(chemicals._note ? { note: chemicals._note } : {}),
  };

  // --- 2. 60-day notices (past 12 months) ---
  console.log("\n[2/2] Scraping OAG 60-day notice search (past 12 months)…");
  let notices = [];
  try {
    notices = await fetchNotices(LIMIT, twelveMonthsAgo);
    console.log(`  notices collected: ${notices.length}`);
  } catch (err) {
    console.error(`  notice scrape failed: ${err.message}`);
  }
  const noticesPayload = {
    _license: "Public, California OEHHA / OAG",
    generated_at: new Date().toISOString(),
    source_url: OAG_NOTICE_SEARCH,
    window: { from: twelveMonthsAgo.toISOString().slice(0, 10), to: TODAY },
    limit: LIMIT,
    count: notices.length,
    notices,
  };

  // --- Write outputs ---
  const chemicalsOut = OUT_CHEMICALS || path.join(RAW_DIR, `chemicals-${TODAY}.json`);
  const noticesOut = OUT_NOTICES || path.join(RAW_DIR, `notices-${TODAY}.json`);

  await fs.mkdir(path.dirname(chemicalsOut), { recursive: true });
  await fs.mkdir(path.dirname(noticesOut), { recursive: true });
  await fs.writeFile(chemicalsOut, JSON.stringify(chemicalsPayload, null, 2));
  await fs.writeFile(noticesOut, JSON.stringify(noticesPayload, null, 2));

  console.log(`\nWrote ${chemicalsOut}`);
  console.log(`Wrote ${noticesOut}`);
  console.log(`\nSummary:`);
  console.log(`  chemicals on list: ${chemicalsPayload.count}`);
  console.log(`  notices in past 12 months: ${noticesPayload.count}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ca-prop65-fetch failed:", err);
    process.exit(1);
  });
}
