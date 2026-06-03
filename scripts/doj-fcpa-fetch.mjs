#!/usr/bin/env node
/**
 * DOJ FCPA Enforcement Actions (monthly)
 *
 * Scrapes the DOJ Criminal Division's Foreign Corrupt Practices Act page:
 *   https://www.justice.gov/criminal/criminal-fraud/foreign-corrupt-practices-act
 *
 * That page links to a complete catalog of FCPA enforcement actions
 * (DPAs/NPAs + criminal/civil cases). For each linked case page we extract:
 *   - date  (filed / resolution date)
 *   - type  ("DPA", "NPA", "Plea", "Information", "Indictment", "Declination", "Civil")
 *   - defendant company name
 *   - allegation summary  (short snippet from the title/headnote)
 *   - fine amount         (parsed from headnote dollar mentions)
 *
 * We then aggregate per top-500 brand:
 *   - total_FCPA_actions_lifetime
 *   - total_fines_$               (USD, summed across all matched actions)
 *   - sample_actions              (date, type, allegation, fine, url) — up to 5
 *
 * Output: /public/data/doj-fcpa.json (overwritten monthly)
 *
 * Throttling: 1 req/sec, UA "TruNorth-DOJ-FCPA/1.0".
 *
 * Runs monthly via .github/workflows/doj-fcpa-monthly.yml
 *
 * Locally: node scripts/doj-fcpa-fetch.mjs
 *          node scripts/doj-fcpa-fetch.mjs --smoke   # walmart/goldman/siemens/jci
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/doj-fcpa.json");

const FCPA_INDEX_URL = "https://www.justice.gov/criminal/criminal-fraud/foreign-corrupt-practices-act";
const FCPA_LIST_URLS = [
  // Primary landing page (links out by year / case)
  FCPA_INDEX_URL,
  // Cases by company (canonical list maintained by Criminal Fraud Section)
  "https://www.justice.gov/criminal/criminal-fraud/related-enforcement-actions",
];

const UA              = "TruNorth-DOJ-FCPA/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS    = 1000;     // 1 req/sec per spec
const MAX_CASE_PAGES  = 600;      // safety cap
const SMOKE_MODE      = process.argv.includes("--smoke");
const SMOKE_BRANDS    = new Set(["walmart", "goldman-sachs", "siemens", "johnson-controls"]);

const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

/* --------------------------------- brands --------------------------------- */

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

/* --------------------------------- fetch --------------------------------- */

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await SLEEP(2000 * (attempt + 1));
        return fetchText(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await SLEEP(2000 * (attempt + 1));
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

/* ----------------------------- HTML helpers ----------------------------- */

function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract <a href="...">text</a> pairs from a chunk of HTML.
function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripHtml(m[2]);
    if (!text) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    out.push({ url: abs, text });
  }
  return out;
}

/* -------------------------- case-link discovery ------------------------- */
// We look for links whose text or URL fragment looks like a case page.
// The DOJ Fraud Section publishes individual press releases per company
// (under /opa/pr/ or /criminal/...).
function isLikelyCaseLink(link) {
  const u = link.url.toLowerCase();
  const t = link.text.toLowerCase();
  if (!u.includes("justice.gov")) return false;
  if (u.includes("/opa/pr/") || u.includes("/criminal-fraud/file/") ||
      u.includes("/criminal/case") || u.includes("/usao") ||
      /\/opa\/(press-release|speech)/.test(u)) {
    return true;
  }
  // Headline keywords commonly used on the FCPA index
  return /\b(fcpa|foreign corrupt|bribery|bribe|corrupt|dpa|deferred prosecution|non-prosecution|plea|declination)\b/.test(t);
}

/* -------------------------- field extraction ---------------------------- */

// Type inference from page title or first paragraph.
function inferType(text) {
  const t = text.toLowerCase();
  if (/declination/.test(t))                       return "Declination";
  if (/non-?prosecution agreement|\bnpa\b/.test(t))return "NPA";
  if (/deferred prosecution agreement|\bdpa\b/.test(t)) return "DPA";
  if (/guilty plea|pleads guilty|plea agreement/.test(t)) return "Plea";
  if (/indict(ed|ment)/.test(t))                    return "Indictment";
  if (/criminal information|charged with/.test(t)) return "Information";
  if (/civil (complaint|settlement|penalty)|sec settle/.test(t)) return "Civil";
  if (/settlement/.test(t))                         return "Settlement";
  return "Action";
}

// Parse the first date that looks like "March 12, 2019" or "2019-03-12".
function parseDate(html, text) {
  // ISO meta tag first
  const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|dcterms\.date)["'][^>]+content=["']([^"']+)["']/i);
  if (meta) {
    const d = new Date(meta[1]);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  // Long English date
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  // ISO
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

// Parse the largest dollar figure mentioned in the headline + first ~2k chars.
// FCPA press releases customarily lead with the total monetary penalty.
function parseFine(text) {
  const sample = text.slice(0, 4000);
  let max = 0;
  const re = /\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)?/gi;
  let m;
  while ((m = re.exec(sample)) !== null) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit === "billion")  v *= 1e9;
    else if (unit === "million")  v *= 1e6;
    else if (unit === "thousand") v *= 1e3;
    if (v > max) max = v;
  }
  return max > 0 ? Math.round(max) : 0;
}

// Extract <title> + the first prose paragraph.
function extractHeadline(html) {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripHtml(titleM[1]) : "";
  // First reasonably-long <p>
  let lead = "";
  const reP = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = reP.exec(html)) !== null) {
    const s = stripHtml(pm[1]);
    if (s.length > 80) { lead = s; break; }
  }
  return { title, lead };
}

/* --------------------------- per-case parsing --------------------------- */

async function parseCasePage(url) {
  const html = await fetchText(url);
  const { title, lead } = extractHeadline(html);
  const visibleText = `${title}\n${lead}\n${stripHtml(html).slice(0, 6000)}`;
  return {
    url,
    title,
    lead,
    date:       parseDate(html, visibleText),
    type:       inferType(`${title}\n${lead}`),
    fine_usd:   parseFine(visibleText),
    haystack:   visibleText.toLowerCase(),
  };
}

/* -------------------------- brand match logic --------------------------- */

function compileMatcher(name) {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
}

function snippetAround(haystack, needleLc, ctx = 120) {
  const i = haystack.indexOf(needleLc);
  if (i < 0) return "";
  const s = haystack.slice(Math.max(0, i - ctx), Math.min(haystack.length, i + needleLc.length + ctx)).trim();
  return s;
}

function scanBrand(brand, cases) {
  const re = compileMatcher(brand.name);
  const needleLc = brand.name.toLowerCase();
  const hits = [];
  let total_fines = 0;
  for (const c of cases) {
    if (!re.test(c.haystack)) continue;
    hits.push({
      date:       c.date,
      type:       c.type,
      allegation: c.title || c.lead.slice(0, 240),
      fine_usd:   c.fine_usd,
      url:        c.url,
      snippet:    snippetAround(c.haystack, needleLc),
    });
    total_fines += c.fine_usd || 0;
  }
  if (hits.length === 0) return { slug: brand.slug, name: brand.name, status: "no_actions" };

  const sample = hits
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5)
    .map(h => ({ date: h.date, type: h.type, allegation: h.allegation, fine_usd: h.fine_usd, url: h.url }));

  return {
    slug:                          brand.slug,
    name:                          brand.name,
    status:                        "ok",
    total_FCPA_actions_lifetime:   hits.length,
    total_fines_usd:               total_fines,
    sample_actions:                sample,
    scraped_at:                    new Date().toISOString(),
  };
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log("FCPA fetcher starting…");
  if (SMOKE_MODE) console.log("  --smoke: limiting to walmart/goldman/siemens/johnson-controls");

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE_MODE) brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));

  // 1) Crawl FCPA index pages, gather candidate case links.
  const seenUrls = new Set();
  const candidates = [];
  for (const indexUrl of FCPA_LIST_URLS) {
    let html;
    try { html = await fetchText(indexUrl); }
    catch (err) { console.error(`  index ${indexUrl} failed: ${err.message}`); continue; }
    await SLEEP(REQ_DELAY_MS);

    const links = extractLinks(html, indexUrl);
    for (const l of links) {
      if (!isLikelyCaseLink(l)) continue;
      if (seenUrls.has(l.url)) continue;
      // De-duplicate fragment variants
      const clean = l.url.split("#")[0];
      if (seenUrls.has(clean)) continue;
      seenUrls.add(clean);
      candidates.push({ url: clean, text: l.text });
    }
    console.log(`  ${indexUrl} → ${candidates.length} unique candidate links so far`);
  }

  // 2) Fetch each candidate page (1 req/sec).
  const cases = [];
  let i = 0;
  for (const c of candidates) {
    if (i >= MAX_CASE_PAGES) { console.log(`  reached MAX_CASE_PAGES=${MAX_CASE_PAGES}, stopping`); break; }
    i++;
    try {
      const parsed = await parseCasePage(c.url);
      cases.push(parsed);
    } catch (err) {
      console.error(`  case ${c.url} failed: ${err.message}`);
    }
    if (i % 25 === 0) console.log(`   …parsed ${i}/${candidates.length} case pages`);
    await SLEEP(REQ_DELAY_MS);
  }
  console.log(`Parsed ${cases.length} case pages`);

  // 3) Scan brands.
  const results = brands.map(b => scanBrand(b, cases));
  const withHits = results.filter(r => r.status === "ok").length;

  const payload = {
    generated_at:           new Date().toISOString(),
    source_url:             FCPA_INDEX_URL,
    brand_count:            brands.length,
    cases_scanned:          cases.length,
    brands_with_actions:    withHits,
    smoke:                  SMOKE_MODE,
    actions:                results,
  };

  if (SMOKE_MODE) {
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\nSmoke output → ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  }
  console.log(`  Brands with FCPA actions: ${withHits}`);
  console.log(`  Cases scanned:            ${cases.length}`);

  for (const r of results.filter(x => x.status === "ok").slice(0, 6)) {
    console.log(`\n  ${r.name} — ${r.total_FCPA_actions_lifetime} action(s), $${r.total_fines_usd.toLocaleString()} in fines`);
    for (const a of r.sample_actions.slice(0, 3)) {
      console.log(`    [${a.date}] ${a.type}  $${(a.fine_usd||0).toLocaleString()}  ${(a.allegation||"").slice(0, 90)}`);
    }
  }
}

main().catch(err => {
  console.error("doj-fcpa-fetch failed:", err);
  process.exit(1);
});
