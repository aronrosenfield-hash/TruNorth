#!/usr/bin/env node
/**
 * European Anti-Fraud Office (OLAF) annual report scraper — B-DATA10.
 *
 *   https://anti-fraud.ec.europa.eu/about-us/reports/olaf-report_en
 *
 * OLAF publishes an annual report (PDF + HTML landing) summarising the prior
 * year's investigations. Recent reports include 200-300 named-company case
 * summaries: who was investigated, the EU programme involved (Horizon, CAP,
 * structural funds), and the recommended recovery in EUR. A named OLAF
 * investigation is a high-evidence political/governance signal — these are
 * formal EU Commission anti-fraud findings, not press allegations.
 *
 * STRATEGY
 *   1. Walk the OLAF reports landing page to find the latest 3 annual
 *      report HTML pages (PDF parsing is brittle — we use the HTML mirror
 *      and case-summary articles on the OLAF site).
 *   2. For each report, parse <article>/<section> blocks that look like
 *      case summaries: heading containing a company name, a metadata line
 *      with "Year concluded:" or "Year:", and a narrative <p>.
 *   3. Extract: subject company, year, status (ongoing/closed/recommendation),
 *      financial recommendation in EUR.
 *
 * THROTTLE / POLITENESS
 *   - 1.5 req/sec (REQ_DELAY_MS = 1500) — EC sites are politely rate-limited
 *   - Honest UA identifying TruNorth + data-pipeline purpose
 *   - Retry on 5xx with exponential backoff (3 tries)
 *
 * OUTPUT
 *   public/data/_raw/olaf-cases.json
 *   {
 *     generated_at,
 *     reports_scanned: [...],
 *     case_count,
 *     dry_run: bool,
 *     cases: [{ id, year, company, status, financial_recovery_eur,
 *               description, source_report, url }]
 *   }
 *
 * Runs quarterly via .github/workflows/eu-enforcement-quarterly.yml.
 *
 * Locally:
 *   node scripts/olaf-fetch.mjs              # DRY-RUN (default)
 *   node scripts/olaf-fetch.mjs --live       # live scrape (cron only)
 *   node scripts/olaf-fetch.mjs --fixture    # explicit fixture mode
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const OUT_FILE = path.join(RAW_DIR, "olaf-cases.json");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/eu-enforcement");

const OLAF_BASE   = "https://anti-fraud.ec.europa.eu";
const OLAF_INDEX  = "/about-us/reports/olaf-report_en";
const REQ_DELAY_MS = 1500;
const UA = "TruNorth-OLAF/1.0 (+https://www.trunorthapp.com; data pipeline for EU anti-fraud transparency)";

const argv = new Set(process.argv.slice(2));
// Default = DRY (no live scrape). Caller must pass --live.
const LIVE_MODE    = argv.has("--live");
const FIXTURE_MODE = !LIVE_MODE; // dry-run uses fixtures

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchText(url, attempt = 0) {
  if (FIXTURE_MODE) {
    // The only fixture currently provided is the consolidated report page.
    const fx = path.join(FIXTURE_DIR, "olaf-report.html");
    if (existsSync(fx)) return fs.readFile(fx, "utf-8");
    return "";
  }
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

/* ----------------------------- html helpers ----------------------------- */

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
    .replace(/&euro;/g, "EUR")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyId(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ------------------------- case-summary parser -------------------------- */
// OLAF case summaries follow a consistent structure across recent reports:
//   <article ...>
//     <h3>COMPANY — short title</h3>
//     <p class="meta">Year concluded: YYYY | Status: STATUS</p>
//     <p>Narrative...</p>
//   </article>
// We accept <article>/<section>/<div> wrappers; the heading and meta line
// are the load-bearing pieces.

export function parseOlafCases(html, sourceReport = "olaf-annual") {
  const out = [];
  // Two-pass parse: prefer <article> blocks (the OLAF report template
  // consistently wraps each case in one). If none found, fall back to
  // <section>/<div> blocks with a class signalling a case.
  const articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let blockTagMatches = [];
  let am;
  while ((am = articleRe.exec(html)) !== null) blockTagMatches.push(am[1]);
  if (blockTagMatches.length === 0) {
    const fallbackRe = /<(section|div)\b[^>]*class=["'][^"']*?(?:case|investigation|story)[^"']*?["'][^>]*>([\s\S]*?)<\/\1>/gi;
    let fm;
    while ((fm = fallbackRe.exec(html)) !== null) blockTagMatches.push(fm[2]);
  }
  for (const inner of blockTagMatches) {
    if (!inner) continue;
    // Headline: first h2/h3/h4
    const hm = inner.match(/<(h[234])\b[^>]*>([\s\S]*?)<\/\1>/i);
    if (!hm) continue;
    const heading = stripHtml(hm[2]);
    if (!heading) continue;

    // Company name is the segment before the first em/en-dash or colon.
    const company = (heading.split(/\s+[—–-]\s+|\s*:\s+/)[0] || heading).trim();
    if (!company || company.length < 2 || company.length > 120) continue;
    // Skip section headers like "Case summaries"
    if (/^(case summaries|investigations|introduction|foreword|executive summary|annex)/i.test(company)) continue;

    // Body text
    const bodyText = stripHtml(inner);
    const year = extractYear(bodyText);
    const status = extractStatus(bodyText);
    const recoveryEur = extractRecoveryEur(bodyText);
    const description = extractDescription(inner);

    if (!year && !status && !recoveryEur) continue; // not a real case block

    out.push({
      id: slugifyId(`${company}-${year || sourceReport}`),
      company,
      year: year || null,
      status: status || null,
      financial_recovery_eur: recoveryEur || 0,
      description: description || bodyText.slice(0, 500),
      source_report: sourceReport,
      url: `${OLAF_BASE}${OLAF_INDEX}`,
    });
  }
  return dedupeById(out);
}

function dedupeById(arr) {
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

export function extractYear(text) {
  if (!text) return null;
  // "Year concluded: 2024" or "Year: 2024" or "concluded in 2024"
  const m1 = text.match(/year\s+(?:concluded|opened|reported)?\s*:?\s*(20\d{2})/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = text.match(/(?:concluded|closed|opened)\s+in\s+(20\d{2})/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = text.match(/\b(20\d{2})\b/);
  if (m3) return parseInt(m3[1], 10);
  return null;
}

export function extractStatus(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bongoing\b/.test(t))                                 return "ongoing";
  if (/\brecommendation\s+(?:issued|accepted)\b/.test(t))    return "recommendation_issued";
  if (/\bclosed\s+with\s+(?:financial|recovery)/.test(t))    return "closed_recovery";
  if (/\bclosed,?\s+no\s+(?:financial|further)/.test(t))     return "closed_no_action";
  if (/\bclosed\b/.test(t))                                  return "closed";
  if (/\breferred\s+to\b/.test(t))                           return "referred";
  return null;
}

// Parse a EUR amount with optional "million" / "billion" magnifier.
export function extractRecoveryEur(text) {
  if (!text) return 0;
  // "EUR 31.2 million", "€ 426.8 million", "EUR 8.7 million recovery"
  const re = /(?:EUR|€)\s?([\d.,]+)\s*(billion|million|thousand)?/gi;
  let max = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit === "billion")       v *= 1e9;
    else if (unit === "million")  v *= 1e6;
    else if (unit === "thousand") v *= 1e3;
    if (v > max) max = v;
  }
  return max > 0 ? Math.round(max) : 0;
}

function extractDescription(innerHtml) {
  // First substantive <p> after the heading.
  const paras = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(innerHtml)) !== null) {
    const s = stripHtml(m[1]);
    if (s.length > 40 && !/^year\s/i.test(s)) paras.push(s);
    if (paras.length >= 2) break;
  }
  return paras.join(" ").slice(0, 600);
}

/* ------------------------------- main ----------------------------------- */

export async function fetchAllCases() {
  // In LIVE mode, we'd walk the index page to find the most recent
  // 3 annual-report URLs. In DRY/fixture mode we just consume the single
  // bundled fixture (which represents one annual report).
  if (LIVE_MODE) {
    const indexHtml = await fetchText(`${OLAF_BASE}${OLAF_INDEX}`);
    const reportUrls = extractAnnualReportUrls(indexHtml).slice(0, 3);
    console.log(`  found ${reportUrls.length} annual-report URLs`);
    const collected = [];
    for (const url of reportUrls) {
      await sleep(REQ_DELAY_MS);
      const html = await fetchText(url);
      const tag = url.split("/").filter(Boolean).pop() || "report";
      const cases = parseOlafCases(html, tag);
      console.log(`  ${tag}: ${cases.length} cases`);
      collected.push(...cases);
    }
    return dedupeById(collected);
  }
  // DRY / fixture mode
  const html = await fetchText(`${OLAF_BASE}${OLAF_INDEX}`);
  const cases = parseOlafCases(html, "olaf-report-2025-fixture");
  return cases;
}

function extractAnnualReportUrls(html) {
  if (!html) return [];
  const out = new Set();
  const re = /href=["']([^"']*olaf-report[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].startsWith("http") ? m[1] : `${OLAF_BASE}${m[1].startsWith("/") ? "" : "/"}${m[1]}`;
    out.add(href);
  }
  return [...out];
}

async function main() {
  console.log(`OLAF fetcher starting (${LIVE_MODE ? "LIVE" : "DRY/fixture"} mode)…`);

  const cases = await fetchAllCases();
  console.log(`Collected ${cases.length} cases`);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    source_url:   `${OLAF_BASE}${OLAF_INDEX}`,
    dry_run:      !LIVE_MODE,
    fixture_mode: FIXTURE_MODE,
    case_count:   cases.length,
    cases,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE}`);

  // Summary
  const withRecovery = cases.filter(c => c.financial_recovery_eur > 0).length;
  const byStatus = {};
  for (const c of cases) byStatus[c.status || "unknown"] = (byStatus[c.status || "unknown"] || 0) + 1;
  console.log(`  with EUR recovery: ${withRecovery}`);
  console.log("  by status:", byStatus);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("OLAF fetcher failed:", err);
    process.exit(1);
  });
}
