#!/usr/bin/env node
/**
 * DOJ Antitrust Division (ATR) Case Documents (monthly)
 *
 * Scrapes the DOJ Antitrust Division's case-documents index:
 *   https://www.justice.gov/atr/case-document
 *
 * The ATR publishes a paginated index of every active matter and closed
 * case the Division has filed — settlements, judgments, complaints,
 * competitive impact statements, briefs, etc. Each row links to:
 *   - a "case document" page (specific filing), and
 *   - a parent "case" page (one per defendant / matter).
 *
 * For each matter we extract:
 *   - case name / defendant
 *   - filing or last-action date
 *   - case type   (merger-challenge / monopolization / cartel / civil / other)
 *   - filing kind (settlement / final-judgment / complaint / brief / etc.)
 *   - URL of the case page
 *
 * We then aggregate per top-500 brand:
 *   - total_antitrust_matters_lifetime
 *   - recent_24mo               (matters with most recent filing < 24mo old)
 *   - top_case_types            (counts by type, sorted)
 *   - sample_matters            (date, type, kind, name, url) — up to 5
 *
 * Output: /public/data/doj-atr.json (overwritten monthly).
 *
 * Throttling: 1 req/sec, UA "TruNorth-DOJ-ATR/1.0".
 *
 * Runs monthly via .github/workflows/doj-atr-monthly.yml
 *
 * Locally: node scripts/doj-atr-fetch.mjs
 *          node scripts/doj-atr-fetch.mjs --smoke   # google/apple/livenation/jetblue/microsoft
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/doj-atr.json");

const ATR_INDEX_BASE = "https://www.justice.gov/atr/case-document";
const ATR_INDEX_URL  = ATR_INDEX_BASE;
const ATR_CASE_BASE  = "https://www.justice.gov/atr/case";

const UA              = "TruNorth-DOJ-ATR/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS    = 1000;       // 1 req/sec per spec
const MAX_INDEX_PAGES = 200;        // safety cap; ATR typically < 150 pages
const MAX_CASE_PAGES  = 1500;       // safety cap for unique case detail pages
const SMOKE_MODE      = process.argv.includes("--smoke");
const SMOKE_BRANDS    = new Set([
  "google", "apple", "live-nation", "jetblue", "microsoft",
]);
const TWENTY_FOUR_MO_MS = 730 * 24 * 60 * 60 * 1000;

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
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
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

/* -------------------------- index walking -------------------------- */
// The /atr/case-document index uses Drupal-style ?page=N pagination.
// We walk pages until a page returns no new case links.

function isCasePageLink(link) {
  const u = link.url.toLowerCase();
  if (!u.includes("justice.gov/atr/case")) return false;
  // The case detail page is /atr/case/<slug>; case-document subpages
  // live at /atr/case-document/... — keep both, normalise to case page.
  return true;
}

function caseSlugFromUrl(url) {
  // /atr/case/<slug>  OR  /atr/case-document/<slug>
  const m = url.match(/justice\.gov\/atr\/case(?:-document)?\/([^?#/]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function casePageUrlFromAny(url) {
  const slug = caseSlugFromUrl(url);
  return slug ? `${ATR_CASE_BASE}/${slug}` : null;
}

/* -------------------------- field extraction ---------------------------- */

function inferCaseType(text) {
  const t = text.toLowerCase();
  // Cartel — bid-rigging, price-fixing, criminal antitrust
  if (/price[-\s]?fixing|bid[-\s]?rigging|cartel|sherman act\s+section\s+1|criminal antitrust/.test(t)) {
    return "cartel";
  }
  // Monopolization — Section 2 cases
  if (/monopoli[sz]ation|sherman act\s+section\s+2|monopoly power|attempted monopoli/.test(t)) {
    return "monopolization";
  }
  // Merger challenge — most common civil ATR matter
  if (/merger|acquisition|proposed acquisition|hart[-\s]?scott[-\s]?rodino|clayton act\s+section\s+7|divestiture|consent decree/.test(t)) {
    return "merger-challenge";
  }
  if (/civil (complaint|investigative demand)|civil non[-\s]?merger/.test(t)) {
    return "civil";
  }
  return "other";
}

function inferFilingKind(text) {
  const t = text.toLowerCase();
  if (/final judgment/.test(t))                            return "final-judgment";
  if (/proposed final judgment|consent decree/.test(t))    return "settlement";
  if (/competitive impact statement/.test(t))              return "cis";
  if (/\bcomplaint\b/.test(t))                             return "complaint";
  if (/\bamicus\b|statement of interest/.test(t))          return "brief";
  if (/motion|memorandum|opposition|reply/.test(t))        return "filing";
  if (/press release/.test(t))                             return "press";
  return "document";
}

function parseDate(html, text) {
  const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|dcterms\.date)["'][^>]+content=["']([^"']+)["']/i);
  if (meta) {
    const d = new Date(meta[1]);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  const iso = text.match(/\b(19\d{2}|20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function extractHeadline(html) {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripHtml(titleM[1]).replace(/\s*\|\s*United States Department of Justice\s*$/i, "") : "";
  let lead = "";
  const reP = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = reP.exec(html)) !== null) {
    const s = stripHtml(pm[1]);
    if (s.length > 60) { lead = s; break; }
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
    name:        title,
    lead,
    date:        parseDate(html, visibleText),
    type:        inferCaseType(`${title}\n${lead}`),
    kind:        inferFilingKind(`${title}\n${lead}`),
    haystack:    visibleText.toLowerCase(),
  };
}

/* -------------------------- brand match logic --------------------------- */

function compileMatcher(name) {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
}

function scanBrand(brand, cases) {
  const re = compileMatcher(brand.name);
  const hits = [];
  const typeCounts = {};
  const cutoff = Date.now() - TWENTY_FOUR_MO_MS;
  let recent24 = 0;

  for (const c of cases) {
    if (!re.test(c.haystack)) continue;
    hits.push({
      date:  c.date,
      type:  c.type,
      kind:  c.kind,
      name:  c.name,
      url:   c.url,
    });
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    if (c.date) {
      const t = Date.parse(c.date);
      if (Number.isFinite(t) && t >= cutoff) recent24++;
    }
  }
  if (hits.length === 0) return { slug: brand.slug, name: brand.name, status: "no_matters" };

  const top_case_types = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  const sample_matters = hits
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);

  return {
    slug:                              brand.slug,
    name:                              brand.name,
    status:                            "ok",
    total_antitrust_matters_lifetime:  hits.length,
    recent_24mo:                       recent24,
    top_case_types,
    sample_matters,
    scraped_at:                        new Date().toISOString(),
  };
}

/* --------------------------------- main --------------------------------- */

async function crawlIndex() {
  const seenCaseUrls = new Set();
  let page = 0;
  let emptyPages = 0;
  while (page < MAX_INDEX_PAGES) {
    const url = page === 0 ? ATR_INDEX_URL : `${ATR_INDEX_URL}?page=${page}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.error(`  index page ${page} failed: ${err.message}`); break; }

    const links = extractLinks(html, url);
    let newOnPage = 0;
    for (const l of links) {
      if (!isCasePageLink(l)) continue;
      const casePage = casePageUrlFromAny(l.url);
      if (!casePage) continue;
      if (seenCaseUrls.has(casePage)) continue;
      seenCaseUrls.add(casePage);
      newOnPage++;
    }
    console.log(`  index page ${page}: +${newOnPage} new case pages (total ${seenCaseUrls.size})`);
    if (newOnPage === 0) {
      emptyPages++;
      if (emptyPages >= 2) break;
    } else {
      emptyPages = 0;
    }
    page++;
    await SLEEP(REQ_DELAY_MS);
  }
  return [...seenCaseUrls];
}

async function main() {
  console.log("DOJ ATR fetcher starting…");
  if (SMOKE_MODE) console.log(`  --smoke: limiting to ${[...SMOKE_BRANDS].join("/")}`);

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE_MODE) brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));

  // 1) Walk the case-document index until exhausted.
  console.log("Crawling ATR case-document index…");
  const caseUrls = await crawlIndex();
  console.log(`Discovered ${caseUrls.length} unique case pages`);

  // 2) Fetch each case detail page (1 req/sec).
  const cases = [];
  let i = 0;
  for (const url of caseUrls) {
    if (i >= MAX_CASE_PAGES) { console.log(`  reached MAX_CASE_PAGES=${MAX_CASE_PAGES}, stopping`); break; }
    i++;
    try {
      const parsed = await parseCasePage(url);
      cases.push(parsed);
    } catch (err) {
      console.error(`  case ${url} failed: ${err.message}`);
    }
    if (i % 50 === 0) console.log(`   …parsed ${i}/${caseUrls.length} case pages`);
    await SLEEP(REQ_DELAY_MS);
  }
  console.log(`Parsed ${cases.length} case pages`);

  // 3) Scan brands.
  const results = brands.map(b => scanBrand(b, cases));
  const withHits = results.filter(r => r.status === "ok").length;

  const payload = {
    generated_at:                new Date().toISOString(),
    source_url:                  ATR_INDEX_URL,
    brand_count:                 brands.length,
    cases_scanned:               cases.length,
    brands_with_matters:         withHits,
    smoke:                       SMOKE_MODE,
    matters:                     results,
  };

  if (SMOKE_MODE) {
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\nSmoke output → ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  }
  console.log(`  Brands with ATR matters:  ${withHits}`);
  console.log(`  Cases scanned:            ${cases.length}`);

  for (const r of results.filter(x => x.status === "ok").slice(0, 8)) {
    console.log(`\n  ${r.name} — ${r.total_antitrust_matters_lifetime} matter(s), ${r.recent_24mo} in last 24mo`);
    const types = r.top_case_types.map(t => `${t.type}=${t.count}`).join(" ");
    console.log(`    types: ${types}`);
    for (const a of r.sample_matters.slice(0, 3)) {
      console.log(`    [${a.date}] ${a.type}/${a.kind}  ${(a.name||"").slice(0, 90)}`);
    }
  }
}

main().catch(err => {
  console.error("doj-atr-fetch failed:", err);
  process.exit(1);
});
