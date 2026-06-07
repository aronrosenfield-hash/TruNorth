#!/usr/bin/env node
/**
 * California Attorney General Enforcement Actions (monthly) — B-27.
 *
 *   https://oag.ca.gov/consumers/actions
 *
 * The CA AG publishes named consumer-protection settlements (e.g. "$X for
 * deceptive practice"). Low volume but extremely high signal — a CA AG
 * settlement is a prosecutable fact, perfect for our labor + privacy +
 * political categories in TruNorth scoring.
 *
 * STRATEGY
 *   1. Walk the first 5 pages of /consumers/actions?page=N (covers ~24 months
 *      of activity at typical CA AG cadence of 30-60 actions/year).
 *   2. Each listing has: title (link), date, and a teaser/summary. Some have
 *      a settlement $ in the title or summary; otherwise we descend into the
 *      press-release detail page to extract it from the lead paragraph.
 *   3. Defendant company name is parsed from the title — CA AG titles follow
 *      a strong pattern: "Attorney General Bonta Announces $X Settlement
 *      Against COMPANY for ALLEGATION" or "AG Bonta Sues COMPANY..."
 *   4. Categorize each action via keyword match on title+summary into one
 *      of: {privacy, labor, political, charity, environment, consumer_fraud}.
 *
 * THROTTLE / POLITENESS
 *   - 1 req/sec (REQ_DELAY_MS = 1000)
 *   - Honest UA identifying TruNorth and the reason
 *   - Retry on 5xx with exponential backoff (3 tries)
 *
 * OUTPUT
 *   public/data/_raw/ca-ag-actions.json
 *   [{ id, date, title, summary, defendant_company_name, settlement_USD,
 *      action_type, category, url }]
 *
 * Runs monthly via .github/workflows/ca-ag-monthly.yml (1st of month, 06:00 UTC).
 *
 * Locally:
 *   node scripts/ca-ag-fetch.mjs           # live scrape (DO NOT run in worktree)
 *   node scripts/ca-ag-fetch.mjs --fixture # use fixture HTML from test/fixtures
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const OUT_FILE = path.join(RAW_DIR, "ca-ag-actions.json");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/ca-ag");

const CA_AG_BASE      = "https://oag.ca.gov";
const CA_AG_LIST_PATH = "/consumers/actions";
const MAX_PAGES       = 5;          // ~24 months
const REQ_DELAY_MS    = 1000;       // 1 req/sec
const UA = "TruNorth-CAAG/1.0 (+https://www.trunorthapp.com; data pipeline for consumer-protection enforcement transparency)";
const FIXTURE_MODE = process.argv.includes("--fixture");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchText(url, attempt = 0) {
  if (FIXTURE_MODE) {
    // Map fixture URLs to local files. See scripts/ca-ag-fetch.test.mjs
    // for the fixture-build helpers.
    const map = {
      [`${CA_AG_BASE}${CA_AG_LIST_PATH}`]:        "list-page-1.html",
      [`${CA_AG_BASE}${CA_AG_LIST_PATH}?page=1`]: "list-page-2.html",
      [`${CA_AG_BASE}${CA_AG_LIST_PATH}?page=2`]: "list-page-3.html",
    };
    const file = map[url];
    if (file && existsSync(path.join(FIXTURE_DIR, file))) {
      return fs.readFile(path.join(FIXTURE_DIR, file), "utf-8");
    }
    // detail page fixture lookup by basename
    const slug = url.split("/").pop();
    const detailFile = path.join(FIXTURE_DIR, `detail-${slug}.html`);
    if (existsSync(detailFile)) return fs.readFile(detailFile, "utf-8");
    return ""; // unknown URL in fixture mode → empty (graceful)
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

/* --------------------------- html helpers ------------------------------- */

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

/* ------------------------ listing-page parser --------------------------- */
// CA AG /consumers/actions is a Drupal "view" page. Each row is a
// `.view-content > .views-row` (or similar) containing:
//   <h3><a href="/news/...">Title</a></h3>
//   <div class="date-display-single">May 12, 2026</div>
//   <p class="teaser">Short summary…</p>
// We do regex-based parsing rather than DOM (no cheerio dep) — robust
// because the structure is stable Drupal markup.

export function parseListingPage(html) {
  const out = [];
  // Each entry has an <h3> or <h2> with a link to /news/<slug>.
  // Capture: anchor URL, anchor text (title), then look backwards/forwards
  // for date and teaser within ~2000 chars of the anchor.
  const linkRe = /<(h[23])\b[^>]*>\s*<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/\1>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[2];
    if (!href.startsWith("/news/") && !href.includes("oag.ca.gov/news/")) continue;
    const title = stripHtml(m[3]);
    if (!title) continue;

    // Window of surrounding HTML for date + teaser lookup
    const start = Math.max(0, m.index - 400);
    const end = Math.min(html.length, m.index + m[0].length + 2000);
    const window = html.slice(start, end);

    const date = extractDate(window);
    const summary = extractTeaser(window, m.index - start + m[0].length);
    const url = href.startsWith("http") ? href : `${CA_AG_BASE}${href}`;
    const id = slugifyUrl(url);

    out.push({ id, url, title, date, summary });
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

function slugifyUrl(url) {
  try { return new URL(url).pathname.replace(/^\/+/, "").replace(/\/+/g, "-"); }
  catch { return url.replace(/[^a-z0-9]+/gi, "-").toLowerCase(); }
}

function extractDate(snippet) {
  // Try Drupal date-display first
  const drupal = snippet.match(/class=["'][^"']*date-display[^"']*["'][^>]*>\s*([^<]+)</i);
  if (drupal) {
    const d = new Date(drupal[1].trim());
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  // Long English date
  const m = snippet.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  // ISO
  const iso = snippet.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function extractTeaser(window, fromOffset) {
  // Look for first <p> after the title link
  const after = window.slice(fromOffset);
  const pm = after.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (pm) {
    const t = stripHtml(pm[1]);
    if (t.length > 20) return t.slice(0, 500);
  }
  // Fallback: views-field-teaser or .field-teaser div
  const dm = after.match(/<div[^>]+(?:teaser|summary|field--name-body)[^>]*>([\s\S]*?)<\/div>/i);
  if (dm) return stripHtml(dm[1]).slice(0, 500);
  return "";
}

/* --------------------- defendant-name extraction ------------------------ */
// CA AG title patterns (highest-frequency first):
//   "Attorney General Bonta Announces $5 Million Settlement Against COMPANY for ALLEGATION"
//   "Attorney General Bonta Announces Settlement with COMPANY..."
//   "AG Bonta Sues COMPANY for ..."
//   "Attorney General Bonta Files Lawsuit Against COMPANY..."
//   "Attorney General Bonta Secures $X Judgment Against COMPANY..."
//   "Attorney General Bonta Settles with COMPANY..."
//
// We extract the segment between "Against|With|Sues|From" and " for | over | to | ,| - " end-markers.

export function extractDefendant(title) {
  if (!title) return null;
  const cleaned = title.replace(/\s+/g, " ").trim();

  // Anchor verbs that introduce the defendant name.
  const anchors = [
    /\bAgainst\s+/i,
    /\bSettlement(?:s)?\s+with\s+/i,
    /\bAgreement(?:s)?\s+with\s+/i,
    /\bSettles?\s+with\s+/i,
    /\bSues\s+/i,
    /\bCharges\s+/i,
    /\bFiles\s+(?:Lawsuit|Suit|Complaint|Action)\s+Against\s+/i,
    /\bObtains?\s+(?:Judgment|Ruling)\s+Against\s+/i,
    /\bSecures?\s+(?:Judgment|Ruling|Settlement)\s+(?:from|against)\s+/i,
    /\bFrom\s+/i,
  ];

  for (const re of anchors) {
    const m = cleaned.match(re);
    if (!m) continue;
    const anchorIsCharges = /^Charges\b/i.test(m[0]);
    const after = cleaned.slice(m.index + m[0].length);
    // Cut at common end markers. "Charges X with Y" — "with" terminates the name.
    const endRe = anchorIsCharges
      ? /\s+(?:for|over|to|in|that|on|regarding|relating|after|following|with)\s+/i
      : /\s+(?:for|over|to|in|that|on|regarding|relating|after|following)\s+/i;
    const cut = after.split(endRe)[0];
    let candidate = cut.split(/[,;:—–-]\s/)[0].trim();
    // Strip trailing punctuation but preserve a final period on "Inc." / "Co." / "Corp." / "Ltd."
    candidate = candidate.replace(/[,;:!?"']+$/g, "").trim();
    // Re-attach a period to common abbreviations if it was stripped by tokenization.
    candidate = candidate.replace(/\b(Inc|Co|Corp|Ltd|LLC|LLP|L\.?P|Plc|N\.?A)\b(?!\.)/g, "$1.");
    // Strip leading "the"
    candidate = candidate.replace(/^the\s+/i, "");
    if (candidate.length >= 2 && candidate.length <= 120) return candidate;
  }
  return null;
}

/* ------------------------ settlement $ extraction ----------------------- */

export function extractSettlementUSD(text) {
  if (!text) return 0;
  // Largest dollar figure in the first ~3000 chars (CA AG always leads with it).
  const sample = text.slice(0, 3000);
  let max = 0;
  const re = /\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)?/gi;
  let m;
  while ((m = re.exec(sample)) !== null) {
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

/* ----------------------------- action_type ------------------------------ */

export function inferActionType(text) {
  const t = (text || "").toLowerCase();
  if (/\bsettle(ment|d|s)\b/.test(t))           return "settlement";
  if (/\bjudgment\b/.test(t))                    return "judgment";
  if (/\b(files|filed|sues|sued|lawsuit|complaint)\b/.test(t)) return "lawsuit";
  if (/\bcease[- ]and[- ]desist\b/.test(t))     return "cease_and_desist";
  if (/\binvestigation\b/.test(t))               return "investigation";
  if (/\bcharges?\b/.test(t))                    return "charges";
  if (/\binjunction\b/.test(t))                  return "injunction";
  return "action";
}

/* ----------------------------- category --------------------------------- */

export function categorize(text) {
  const t = (text || "").toLowerCase();
  // Order matters — most specific first.
  if (/\b(data breach|privacy|ccpa|cpra|personal information|biometric|location data|tracking)\b/.test(t)) return "privacy";
  if (/\b(wage theft|unpaid wages|misclassif|overtime|labor code|workplace|piece-?rate|paystub|sick leave|gig worker)\b/.test(t)) return "labor";
  if (/\b(campaign finance|dark money|political contribution|lobbying|election|disclosure violation)\b/.test(t)) return "political";
  if (/\b(charitable|nonprofit|charity|donation fraud|donor)\b/.test(t)) return "charity";
  if (/\b(environment|pollution|air quality|water|hazardous waste|emissions|prop 65|toxic|carb)\b/.test(t)) return "environment";
  if (/\b(deceptive|false advertising|unfair business|consumer fraud|robocall|spam|telemarket|scam)\b/.test(t)) return "consumer_fraud";
  return "consumer_fraud"; // default for CA AG actions page
}

/* --------------------------- detail enrichment -------------------------- */
// If the listing title/summary doesn't contain a $ amount, fetch the
// detail page and try to extract it from the lead paragraph.

async function enrichWithDetail(action) {
  if (action.settlement_USD > 0) return action;
  try {
    const html = await fetchText(action.url);
    if (!html) return action;
    // Pull the title's first ~2 <p> tags
    const paras = [];
    const reP = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = reP.exec(html)) !== null && paras.length < 3) {
      const s = stripHtml(pm[1]);
      if (s.length > 60) paras.push(s);
    }
    const body = paras.join(" ");
    const usd = extractSettlementUSD(body);
    if (usd) action.settlement_USD = usd;
    if (!action.summary && paras[0]) action.summary = paras[0].slice(0, 500);
    await sleep(REQ_DELAY_MS);
  } catch (err) {
    // Silently skip — listing-page data still useful.
    console.warn(`  detail fetch failed for ${action.url}: ${err.message}`);
  }
  return action;
}

/* ------------------------------- main ----------------------------------- */

export async function fetchAllActions() {
  const collected = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = page === 0
      ? `${CA_AG_BASE}${CA_AG_LIST_PATH}`
      : `${CA_AG_BASE}${CA_AG_LIST_PATH}?page=${page}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) {
      console.error(`  page ${page} failed: ${err.message}`);
      continue;
    }
    if (!html) {
      console.log(`  page ${page}: empty (likely end of listings)`);
      break;
    }
    const items = parseListingPage(html);
    console.log(`  page ${page}: ${items.length} listings`);
    if (items.length === 0) break;
    collected.push(...items);
    if (page < MAX_PAGES - 1) await sleep(REQ_DELAY_MS);
  }

  // Build base action records
  let actions = dedupeById(collected).map(it => {
    const haystack = `${it.title}\n${it.summary || ""}`;
    return {
      id:                      it.id,
      date:                    it.date,
      title:                   it.title,
      summary:                 it.summary || "",
      defendant_company_name:  extractDefendant(it.title),
      settlement_USD:          extractSettlementUSD(haystack),
      action_type:             inferActionType(haystack),
      category:                categorize(haystack),
      url:                     it.url,
    };
  });

  // Enrich missing settlement amounts via detail-page fetch (skip in fixture mode beyond fixtures present)
  console.log(`  enriching ${actions.filter(a => !a.settlement_USD).length} actions missing $ amount via detail pages…`);
  const enriched = [];
  for (const a of actions) {
    enriched.push(await enrichWithDetail(a));
  }
  return enriched;
}

async function main() {
  console.log("CA AG enforcement-actions fetcher starting…");
  if (FIXTURE_MODE) console.log("  --fixture mode: reading from test/fixtures/ca-ag/");

  const actions = await fetchAllActions();
  console.log(`Collected ${actions.length} actions total`);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const payload = {
    generated_at:   new Date().toISOString(),
    source_url:     `${CA_AG_BASE}${CA_AG_LIST_PATH}`,
    pages_scanned:  MAX_PAGES,
    action_count:   actions.length,
    fixture_mode:   FIXTURE_MODE,
    actions,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE}`);

  // Summary
  const withMoney = actions.filter(a => a.settlement_USD > 0).length;
  const withDef   = actions.filter(a => a.defendant_company_name).length;
  console.log(`  with settlement $: ${withMoney}`);
  console.log(`  with defendant name: ${withDef}`);
  const byCat = {};
  for (const a of actions) byCat[a.category] = (byCat[a.category] || 0) + 1;
  console.log("  by category:", byCat);
}

// CLI entry — skip when imported as a module (tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("CA AG fetcher failed:", err);
    process.exit(1);
  });
}
