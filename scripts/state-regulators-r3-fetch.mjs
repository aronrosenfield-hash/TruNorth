#!/usr/bin/env node
/**
 * US state-regulator enforcement — Round 3 expansion.
 *
 * Round 2 (scripts/state-regulators-fetch.mjs) covers NY AG, TX AG, NYDFS.
 * Round 3 adds the next tier of scrapeable state attorneys-general + a
 * specialty regulator (CA Privacy Protection Agency / CalPrivacy):
 *
 *   1.  ca-ag   — California Attorney General (oag.ca.gov/news)
 *   2.  cppa    — California Privacy Protection Agency (cppa.ca.gov/announcements)
 *   3.  fl-ag   — Florida AG (myfloridalegal.com/newsreleases)
 *   4.  il-ag   — Illinois AG (illinoisattorneygeneral.gov/news-room)
 *   5.  wa-ag   — Washington AG (atg.wa.gov RSS feed)
 *   6.  oh-ag   — Ohio AG (ohioattorneygeneral.gov/Media/News-Releases)
 *   7.  pa-ag   — Pennsylvania AG (attorneygeneral.gov/taking-action)
 *   8.  nj-ag   — New Jersey AG (njoag.gov RSS feed)
 *   9.  ga-ag   — Georgia AG (law.georgia.gov/press-releases)
 *   10. nc-ag   — North Carolina AG (ncdoj.gov/category/news-releases)
 *
 * Probed and parked behind bot walls / 403 / 500 / no listing endpoint:
 *   - MA AG   (mass.gov)           403 to UA on the org news page
 *   - MI AG   (michigan.gov/ag)    500 / 403 — dynamic dashboard
 *   - VA AG   (law.virginia.gov)   connection refused / 60s timeout
 *   - CARB    (ww2.arb.ca.gov)     403 (Akamai bot wall — round 2)
 *   - TCEQ    (tceq.texas.gov)     enforcement DB requires search params
 *   - CalEPA  (calepa.ca.gov)      enforcement scattered across boards
 *   - NY DEC  (dec.ny.gov)         press releases not enforcement-flagged
 *   - CA DIR / Cal/OSHA / NY DOL / TX TWC — no canonical company listing
 *   - State pharmacy boards (CA/NY/FL/TX) — board minutes only, no API
 *   - State insurance commissioners — NAIC aggregates, parked separately
 *
 * Politeness:
 *   - 1.5s between requests; honest UA; retry once on 5xx.
 *   - Per-source hard cap (--limit) defaults to 300 records.
 *   - 3-year cutoff on dated records.
 *
 * Output:
 *   data/raw/state-regulators-r3/<YYYY-MM-DD>.json
 *
 * Record shape: same as round 2 fetcher.
 *
 * CLI:
 *   node scripts/state-regulators-r3-fetch.mjs                  # all sources
 *   node scripts/state-regulators-r3-fetch.mjs --only ca-ag     # one source
 *   node scripts/state-regulators-r3-fetch.mjs --limit 50       # per-source cap
 *   node scripts/state-regulators-r3-fetch.mjs --fixture        # parse fixtures
 *   node scripts/state-regulators-r3-fetch.mjs --apply          # write to data/raw/...
 *   node scripts/state-regulators-r3-fetch.mjs --dry            # explicit dry
 *   node scripts/state-regulators-r3-fetch.mjs --url <list-url> # override list URL
 *   node scripts/state-regulators-r3-fetch.mjs --out /tmp/x.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/state-regulators-r3");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/state-regulators-r3");

const UA = "TruNorth-StateReg/1.0 (+https://www.trunorthapp.com; consumer-protection data pipeline)";
const REQ_DELAY_MS = 1500;
const DEFAULT_LIMIT = 300;
const CUTOFF_YEAR = new Date().getFullYear() - 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─────────────────────────── CLI args ───────────────────────────── */

function parseArgs(argv) {
  const args = { only: null, limit: DEFAULT_LIMIT, fixture: false, out: null, url: null, apply: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") args.only = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || DEFAULT_LIMIT;
    else if (a === "--fixture") args.fixture = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--apply") args.apply = true;
    else if (a === "--dry") args.dry = true;
  }
  return args;
}

/* ─────────────────────────── network ────────────────────────────── */

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 1) {
        await sleep(2000);
        return fetchText(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 1 && !/HTTP 4/.test(err.message)) {
      await sleep(2000);
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

/* ─────────────────────────── helpers ────────────────────────────── */

export function cleanText(s) {
  return (s || "").replace(/[­​‌‍﻿]/g, "").replace(/\s+/g, " ").trim();
}

export function clip(s, n) {
  const t = cleanText(s);
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

/** Parse "$3.97 million" / "$50,000" / "$1.2 billion" into a number. */
export function parseDollarAmount(text) {
  if (!text) return null;
  const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion|m|b)?/gi;
  let best = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(num)) continue;
    const unit = (m[2] || "").toLowerCase();
    let n = num;
    if (unit.startsWith("b")) n = num * 1e9;
    else if (unit.startsWith("m")) n = num * 1e6;
    if (!unit && num < 1000) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}

/** Mine likely company names from free-text. Mirrors round-2 mineDefendants. */
export function mineDefendants(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  const add = (s) => {
    const c = s.replace(/[,.;:]+$/g, "").trim();
    if (!c || c.length < 3 || c.length > 120) return;
    const k = c.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  const SUFFIX_PERIOD = /\b(Inc|Incorporated|Corp|Corporation|Co|Company|LLC|LP|LLP|Ltd|Limited|PLC|N\.A|N\.V|S\.A|A\.G|St)\.(?=\s|$)/g;
  const SENTINEL = "";
  const protect = (s) => s.replace(SUFFIX_PERIOD, (_, p) => `${p}${SENTINEL}`);
  const restore = (s) => s.replace(new RegExp(SENTINEL, "g"), ".");
  const protectedText = protect(text);
  const anchors = [
    /\b(?:against|from|with|sues?|sued|settles? with|settled? with|reached an agreement with|investigation into|investigating|action against|order against|fines?|fined|penalty against|penalized|charges? against|charged)\s+(.+?)(?:\s+(?:for|over|alleging|regarding|relating|related|after|following|to settle|to resolve|in connection|with)\b|\.\s|;)/gi,
  ];
  for (const re of anchors) {
    let m;
    while ((m = re.exec(protectedText)) !== null) {
      const chunk = restore(m[1]);
      const parts = chunk.split(/,\s*(?:and\s+)?|\s+and\s+/i);
      for (const p of parts) {
        if (!/[A-Z]/.test(p)) continue;
        const hasSuffix = /\b(Inc|Incorporated|Corp|Corporation|Co|Company|LLC|LP|LLP|Ltd|Limited|PLC|Holdings|Group|Bank|N\.A|N\.V|S\.A|AG)\b\.?/i.test(p);
        const capWords = (p.match(/\b[A-Z][A-Za-z0-9&'-]+/g) || []).length;
        if (!hasSuffix && capWords < 2) continue;
        if (/\b(states?|companies|corporations|firms|attorneys?|millions?|billions?|workers?|consumers?|residents?|new yorkers?|texans?|americans?|californians?|floridians?|illinoisans?|washingtonians?|ohioans?|pennsylvanians?|georgians?|north carolinians?|new jerseyans?|illinois residents?|defendants?)\b/i.test(p.trim())) continue;
        add(p);
      }
    }
  }
  return out;
}

/** Extract a defendant candidate from a title using common AG-headline verbs. */
export function defendantFromTitle(title) {
  if (!title) return null;
  // Pattern B (try FIRST — subject form): "<Defendant> Faces|Agrees|To Pay|...|Settles with AG"
  // Strip the common AG-name prefix ("Carr:", "Bonta Announces", etc.) before matching.
  const stripped = title.replace(/^(?:Carr|Bonta|Uthmeier|Yost|Wilson|Raoul|Sunday|Campbell|Davenport|Jackson|Paxton|Platkin|Tong|Bondi|Slatery|Skrmetti|Mayes|Hilgers|Knudsen|Frosh|Brown|AG\s+\w+)[:\s]+/i, "");
  const B = stripped.match(/^([A-Z][A-Za-z0-9&.,'\- ]{2,100}?)\s+(?:Faces|Agrees(?:\s+to)?|To Pay|To Settle|Charged With|Indicted|Pleads(?:\s+Guilty)?|Convicted|Settles\s+with|Settles\b|Fined|Pays|Will Pay|Ordered To|Sentenced|Found Liable|Held Liable|Liable\b)\b/);
  if (B) {
    const cand = B[1].trim();
    // Skip if it's a known regulator/non-company subject.
    if (!/^(?:cppa|calprivacy|nydfs|the\s+|a\s+|an\s+|former\s+|ex-?)/i.test(cand)
        && cand.length >= 3 && cand.length <= 120) {
      return cand;
    }
  }
  // Pattern A: "AG <verb> <Defendant> for/over/..."
  // — defendant is the OBJECT.  "Lawsuit Against X", "Action Against X", etc.
  const A = title.match(/(?:\bsues?\b|\bsued\b|reaches? agreement with|(?:files?|filing)\s+(?:[\w\-]+\s+){0,5}?(?:lawsuit|suit|complaint|action|charges?)\s+against|action against|complaint against|charges?\s+against|orders?\s+against|penalty against|takes? action against|cracks? down on|launches? investigation into|cease[- ]and[- ]desist (?:to|against)|consent order(?: with| to| against)|sanctions?\s+against|secures?\s+(?:\$[\d.,]+\s+(?:million|billion)?\s+)?from|investigation into|investigates)\s+(.+?)(?:\s+(?:for|over|in|after|to settle|to resolve|to pay|alleging|regarding|relating|related|following|on)\s+|$)/i);
  if (A) {
    const cand = A[1].trim().replace(/[,.;:]+$/g, "");
    if (cand.length >= 3 && cand.length <= 120) return cand;
  }
  return null;
}

/** Common detail-page extraction once we have the HTML. */
export function extractGenericDetail(html, opts = {}) {
  const $ = cheerio.load(html);
  const title = cleanText(
    $("h1").first().text() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().replace(/\s*\|.*$/, "")
  );
  if (!title) return null;
  let date = null;
  const dateMeta = $('meta[property="article:published_time"]').attr("content")
    || $('meta[name="article:published_time"]').attr("content")
    || $('meta[name="dcterms.date"]').attr("content")
    || $('time[datetime]').first().attr("datetime");
  if (dateMeta) {
    const m = String(dateMeta).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) date = m[1];
  }
  if (!date && opts.dateFallback) date = opts.dateFallback;

  const bodyHtml = $('meta[name="description"]').attr("content")
    ? `<p>${$('meta[name="description"]').attr("content")}</p>`
    : "";
  const articleHtml = $("article").first().html()
    || $("main").first().html()
    || $(".body").first().html()
    || $(".content").first().html()
    || "";
  const fullHtml = bodyHtml + articleHtml;
  const body = cleanText(cheerio.load(`<root>${fullHtml}</root>`)("root").text());
  return { title, date, body };
}

/* ─────────────────────────── CA AG ──────────────────────────────── */

const CA_AG_LIST = "https://oag.ca.gov/news";

async function fetchCaAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("ca-ag");
  const out = [];
  const seen = new Set();
  const base = urlOverride || CA_AG_LIST;
  for (let page = 0; page < 25; page++) {
    const url = page === 0 ? base : `${base}?page=${page}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  ca-ag page ${page} failed: ${err.message}`); break; }
    const recs = parseCaAgList(html);
    const before = out.length;
    for (const r of recs) {
      if (seen.has(r.sourceUrl)) continue;
      seen.add(r.sourceUrl);
      if (r.date) {
        const y = parseInt(r.date.slice(0, 4), 10);
        if (y < CUTOFF_YEAR) continue;
      }
      out.push(r);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
    if (out.length === before) break;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`  ca-ag: ${out.length} records from listing`);
  return out;
}

export function parseCaAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $(".views-row").each((_, row) => {
    const $row = $(row);
    const $a = $row.find('a[href*="/news/press-releases/"]').first();
    const href = $a.attr("href") || "";
    if (!href) return;
    const title = cleanText($a.text());
    if (!title) return;
    const dateText = cleanText($row.find('.date-display-single').text() || $row.find('.views-field-field-release-date').text());
    let date = null;
    const dateAttr = $row.find('[property="dc:date"]').attr("content");
    if (dateAttr) {
      const m = dateAttr.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) date = m[1];
    } else if (dateText) {
      const d = new Date(dateText);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    const sourceUrl = href.startsWith("http") ? href : `https://oag.ca.gov${href}`;
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    const amountUsd = parseDollarAmount(title);
    out.push({
      source: "ca-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(title, 600),
      category: "consumer-protection",
      sourceUrl,
    });
  });
  return out;
}

/* ─────────────────────────── CPPA ───────────────────────────────── */

const CPPA_LIST = "https://cppa.ca.gov/announcements/";

async function fetchCppa(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("cppa");
  try {
    const html = await fetchText(urlOverride || CPPA_LIST);
    const recs = parseCppaList(html);
    console.log(`  cppa: ${recs.length} records from listing`);
    return recs.slice(0, limit);
  } catch (err) {
    console.warn(`  cppa failed: ${err.message}`);
    return [];
  }
}

export function parseCppaList(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a[href*=".html"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    // Pattern: 2025/20250930.html (relative) or https://privacy.ca.gov/2025/...
    const m = href.match(/(?:^|\/)(\d{4})\/(\d{4})(\d{2})(\d{2})(?:_\d+)?\.html$/);
    if (!m) return;
    const date = `${m[2]}-${m[3]}-${m[4]}`;
    if (parseInt(m[1], 10) < CUTOFF_YEAR) return;
    const sourceUrl = href.startsWith("http")
      ? href
      : `https://privacy.ca.gov/${href.replace(/^\//, "")}`;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    const title = cleanText($a.text());
    if (!title || title.length < 8) return;
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    const minedFromTitle = mineDefendants(title);
    for (const d of minedFromTitle) if (!defendants.includes(d)) defendants.push(d);
    const amountUsd = parseDollarAmount(title);
    // Only keep enforcement-flavored items — CPPA also posts neutral updates.
    const isEnforcement = /enforce|fine|penalt|orders?|action|settl|cease|desist|sub-?poena|broker|violat|fail|stop/i.test(title);
    if (!isEnforcement) return;
    out.push({
      source: "cppa",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(title, 600),
      category: "privacy-enforcement",
      sourceUrl,
    });
  });
  return out;
}

/* ─────────────────────────── FL AG ──────────────────────────────── */

const FL_AG_LIST = "https://www.myfloridalegal.com/newsreleases";

async function fetchFlAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("fl-ag");
  const out = [];
  const seen = new Set();
  const base = urlOverride || FL_AG_LIST;
  for (let page = 0; page < 50; page++) {
    const url = page === 0 ? base : `${base}?page=${page}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  fl-ag page ${page} failed: ${err.message}`); break; }
    const recs = parseFlAgList(html);
    const before = out.length;
    for (const r of recs) {
      if (seen.has(r.sourceUrl)) continue;
      seen.add(r.sourceUrl);
      if (r.date) {
        const y = parseInt(r.date.slice(0, 4), 10);
        if (y < CUTOFF_YEAR) continue;
      }
      out.push(r);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
    if (out.length === before) break;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`  fl-ag: ${out.length} records from listing`);
  return out;
}

export function parseFlAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href^="/newsrelease/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const title = cleanText($a.text());
    if (!title || title.length < 10) return;
    let date = null;
    // FL site shows date as separate sibling. Walk up to enclosing item div.
    const $wrap = $a.closest("div, article, li");
    const txt = cleanText($wrap.text());
    const dm = txt.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/);
    if (dm) {
      const d = new Date(`${dm[1]} ${dm[2]}, ${dm[3]}`);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    const sourceUrl = href.startsWith("http") ? href : `https://www.myfloridalegal.com${href}`;
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    const amountUsd = parseDollarAmount(title + " " + txt);
    out.push({
      source: "fl-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(title, 600),
      category: "consumer-protection",
      sourceUrl,
    });
  });
  return out;
}

/* ─────────────────────────── IL AG ──────────────────────────────── */

const IL_AG_LIST = "https://illinoisattorneygeneral.gov/news-room/";

async function fetchIlAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("il-ag");
  try {
    const html = await fetchText(urlOverride || IL_AG_LIST);
    const recs = parseIlAgList(html);
    console.log(`  il-ag: ${recs.length} records from listing`);
    return recs.slice(0, limit);
  } catch (err) {
    console.warn(`  il-ag failed: ${err.message}`);
    return [];
  }
}

export function parseIlAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a.news-item, a[href*="/news/story/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    if (!/\/news\/story\//.test(href)) return;
    const sourceUrl = href.startsWith("http") ? href : `https://illinoisattorneygeneral.gov${href}`;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    let title = cleanText($a.find("p").first().text() || $a.find("h3").first().text());
    if (!title) {
      const aria = $a.attr("aria-label") || "";
      const am = aria.match(/[-–—]\s*(.+)$/);
      title = am ? cleanText(am[1]) : cleanText($a.text());
    }
    if (!title || title.length < 10) return;
    let date = null;
    const dt = $a.find("time").first();
    const dtAttr = dt.attr("datetime");
    if (dtAttr) {
      const m = dtAttr.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) date = m[1];
    }
    if (!date) {
      const dtText = cleanText(dt.text());
      if (dtText) {
        const d = new Date(dtText);
        if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
      }
    }
    if (date) {
      const y = parseInt(date.slice(0, 4), 10);
      if (y < CUTOFF_YEAR) return;
    }
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    const amountUsd = parseDollarAmount(title);
    out.push({
      source: "il-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(title, 600),
      category: "consumer-protection",
      sourceUrl,
    });
  });
  return out;
}

/* ─────────────────────────── WA AG (RSS) ───────────────────────── */

const WA_AG_RSS = "https://www.atg.wa.gov/news/news-releases-rss";

async function fetchWaAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("wa-ag");
  try {
    const xml = await fetchText(urlOverride || WA_AG_RSS);
    const recs = parseWaAgRss(xml);
    console.log(`  wa-ag: ${recs.length} records from RSS`);
    return recs.slice(0, limit);
  } catch (err) {
    console.warn(`  wa-ag failed: ${err.message}`);
    return [];
  }
}

function stripHtml(s) {
  if (!s) return "";
  // RSS descriptions often contain HTML; flatten via cheerio.
  const $ = cheerio.load(`<root>${s}</root>`);
  return cleanText($("root").text());
}

export function parseWaAgRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $("item").each((_, item) => {
    const $i = $(item);
    const title = cleanText($i.find("title").first().text());
    const link = cleanText($i.find("link").first().text());
    const pubDate = cleanText($i.find("pubDate").first().text());
    const desc = stripHtml($i.find("description").first().text());
    if (!title || !link) return;
    let date = null;
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    if (date) {
      const y = parseInt(date.slice(0, 4), 10);
      if (y < CUTOFF_YEAR) return;
    }
    const fullText = title + " " + desc;
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    for (const d of mineDefendants(fullText)) if (!defendants.includes(d)) defendants.push(d);
    const amountUsd = parseDollarAmount(fullText);
    out.push({
      source: "wa-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(desc || title, 600),
      category: "consumer-protection",
      sourceUrl: link,
    });
  });
  return out;
}

/* ─────────────────────────── OH AG ──────────────────────────────── */

const OH_AG_LIST = "https://www.ohioattorneygeneral.gov/Media/News-Releases";

async function fetchOhAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("oh-ag");
  const out = [];
  const seen = new Set();
  const base = urlOverride || OH_AG_LIST;
  // Ohio AG uses ASP.NET pagination via ?page=N
  for (let page = 1; page <= 50; page++) {
    const url = page === 1 ? base : `${base}?page=${page}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  oh-ag page ${page} failed: ${err.message}`); break; }
    const recs = parseOhAgList(html);
    const before = out.length;
    for (const r of recs) {
      if (seen.has(r.sourceUrl)) continue;
      seen.add(r.sourceUrl);
      if (r.date) {
        const y = parseInt(r.date.slice(0, 4), 10);
        if (y < CUTOFF_YEAR) continue;
      }
      out.push(r);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
    if (out.length === before) break;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`  oh-ag: ${out.length} records from listing`);
  return out;
}

export function parseOhAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $(".ohio-news").each((_, row) => {
    const $row = $(row);
    const $a = $row.find('a[href*="/Media/News-Releases/"]').first();
    const href = $a.attr("href") || "";
    if (!href) return;
    const title = cleanText($a.text());
    if (!title) return;
    const summary = cleanText($row.find(".news-summary").text());
    const dateText = cleanText($row.find(".news-date").text());
    let date = null;
    if (dateText) {
      const m = dateText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (m) {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
      }
    }
    if (!date) {
      // URL pattern: /Media/News-Releases/<Month-Year>/Title-Slug
      const mm = href.match(/\/News-Releases\/([A-Za-z]+)-(\d{4})\//);
      if (mm) date = `${mm[2]}-01-01`;
    }
    const sourceUrl = href.startsWith("http") ? href : `https://www.ohioattorneygeneral.gov${href}`;
    const fullText = title + " " + summary;
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    for (const d of mineDefendants(fullText)) if (!defendants.includes(d)) defendants.push(d);
    const amountUsd = parseDollarAmount(fullText);
    out.push({
      source: "oh-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(summary || title, 600),
      category: "consumer-protection",
      sourceUrl,
    });
  });
  return out;
}

/* ─────────────────────────── PA AG ──────────────────────────────── */

const PA_AG_LIST = "https://www.attorneygeneral.gov/taking-action/";

async function fetchPaAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("pa-ag");
  const out = [];
  const seen = new Set();
  const base = urlOverride || PA_AG_LIST;
  for (let page = 1; page <= 30; page++) {
    const url = page === 1 ? base : `${base}page/${page}/`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  pa-ag page ${page} failed: ${err.message}`); break; }
    const recs = parsePaAgList(html);
    const before = out.length;
    for (const r of recs) {
      if (seen.has(r.sourceUrl)) continue;
      seen.add(r.sourceUrl);
      if (r.date) {
        const y = parseInt(r.date.slice(0, 4), 10);
        if (y < CUTOFF_YEAR) continue;
      }
      out.push(r);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
    if (out.length === before) break;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`  pa-ag: ${out.length} records from listing`);
  return out;
}

export function parsePaAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  // PA AG renders a table.stories with each <tr> = one item.
  // <td class="date"><a><strong class="date">MM/DD/YYYY</strong></a></td>
  // <td class="title"><a href="...">Real title text</a></td>
  $('table.stories tr, table.table tr').each((_, tr) => {
    const $tr = $(tr);
    const $titleA = $tr.find('td.title a[href*="/taking-action/"]').first();
    if (!$titleA.length) return;
    const href = $titleA.attr("href") || "";
    if (!/\/taking-action\/[^\/]{6,}/.test(href)) return;
    const sourceUrl = href.startsWith("http") ? href : `https://www.attorneygeneral.gov${href}`;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    const title = cleanText($titleA.text());
    if (!title || title.length < 10) return;
    let date = null;
    const dateText = cleanText($tr.find("td.date").text());
    const dm = dateText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dm) {
      const d = new Date(dm[1]);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    const amountUsd = parseDollarAmount(title);
    out.push({
      source: "pa-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(title, 600),
      category: "consumer-protection",
      sourceUrl,
    });
  });
  // Fallback for fixtures or templates without the table wrapper: walk
  // all /taking-action/ anchors with non-date text.
  if (out.length === 0) {
    $('a[href*="/taking-action/"]').each((_, a) => {
      const $a = $(a);
      const href = $a.attr("href") || "";
      if (!/\/taking-action\/[a-z0-9\-]{15,}/.test(href)) return;
      const sourceUrl = href.startsWith("http") ? href : `https://www.attorneygeneral.gov${href}`;
      if (seen.has(sourceUrl)) return;
      const title = cleanText($a.text());
      if (!title || title.length < 10) return;
      // Skip if anchor text is just a date (date column in the real listing).
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(title)) return;
      seen.add(sourceUrl);
      const defendants = [];
      const titleDef = defendantFromTitle(title);
      if (titleDef) defendants.push(titleDef);
      const amountUsd = parseDollarAmount(title);
      out.push({
        source: "pa-ag",
        caseTitle: title,
        defendants,
        date: null,
        amountUsd,
        summary: clip(title, 600),
        category: "consumer-protection",
        sourceUrl,
      });
    });
  }
  return out;
}

/* ─────────────────────────── NJ AG (RSS) ───────────────────────── */

const NJ_AG_RSS = "https://www.njoag.gov/feed/";

async function fetchNjAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("nj-ag");
  try {
    const xml = await fetchText(urlOverride || NJ_AG_RSS);
    const recs = parseNjAgRss(xml);
    console.log(`  nj-ag: ${recs.length} records from RSS`);
    return recs.slice(0, limit);
  } catch (err) {
    console.warn(`  nj-ag failed: ${err.message}`);
    return [];
  }
}

export function parseNjAgRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $("item").each((_, item) => {
    const $i = $(item);
    const title = cleanText($i.find("title").first().text());
    const link = cleanText($i.find("link").first().text());
    const pubDate = cleanText($i.find("pubDate").first().text());
    const desc = stripHtml($i.find("description").first().text());
    if (!title || !link) return;
    let date = null;
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    if (date) {
      const y = parseInt(date.slice(0, 4), 10);
      if (y < CUTOFF_YEAR) return;
    }
    const fullText = title + " " + desc;
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    for (const d of mineDefendants(fullText)) if (!defendants.includes(d)) defendants.push(d);
    const amountUsd = parseDollarAmount(fullText);
    out.push({
      source: "nj-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(desc || title, 600),
      category: "consumer-protection",
      sourceUrl: link,
    });
  });
  return out;
}

/* ─────────────────────────── GA AG ──────────────────────────────── */

const GA_AG_LIST = "https://law.georgia.gov/press-releases";

async function fetchGaAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("ga-ag");
  const out = [];
  const seen = new Set();
  const base = urlOverride || GA_AG_LIST;
  for (let page = 0; page < 50; page++) {
    const url = page === 0 ? base : `${base}?page=${page}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  ga-ag page ${page} failed: ${err.message}`); break; }
    const recs = parseGaAgList(html);
    const before = out.length;
    for (const r of recs) {
      if (seen.has(r.sourceUrl)) continue;
      seen.add(r.sourceUrl);
      if (r.date) {
        const y = parseInt(r.date.slice(0, 4), 10);
        if (y < CUTOFF_YEAR) continue;
      }
      out.push(r);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
    if (out.length === before) break;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`  ga-ag: ${out.length} records from listing`);
  return out;
}

export function parseGaAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href*="/press-releases/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/\/press-releases\/(\d{4}-\d{2}-\d{2})\/[a-z0-9\-]+/);
    if (!m) return;
    const date = m[1];
    const title = cleanText($a.find(".global-teaser__title").text() || $a.text());
    if (!title || title.length < 8) return;
    const sourceUrl = href.startsWith("http") ? href : `https://law.georgia.gov${href}`;
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    const amountUsd = parseDollarAmount(title);
    out.push({
      source: "ga-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(title, 600),
      category: "consumer-protection",
      sourceUrl,
    });
  });
  return out;
}

/* ─────────────────────────── NC AG ──────────────────────────────── */

const NC_AG_LIST = "https://ncdoj.gov/category/news-releases/";

async function fetchNcAg(limit, useFixture, urlOverride) {
  if (useFixture) return parseFixture("nc-ag");
  const out = [];
  const seen = new Set();
  const base = urlOverride || NC_AG_LIST;
  for (let page = 1; page <= 30; page++) {
    const url = page === 1 ? base : `${base}page/${page}/`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  nc-ag page ${page} failed: ${err.message}`); break; }
    const recs = parseNcAgList(html);
    const before = out.length;
    for (const r of recs) {
      if (seen.has(r.sourceUrl)) continue;
      seen.add(r.sourceUrl);
      if (r.date) {
        const y = parseInt(r.date.slice(0, 4), 10);
        if (y < CUTOFF_YEAR) continue;
      }
      out.push(r);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
    if (out.length === before) break;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`  nc-ag: ${out.length} records from listing`);
  return out;
}

export function parseNcAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  // NC card structure: <div class="post-*"> with h2 a[rel=bookmark] + .content
  // The visible date sits inside a paragraph like "Tuesday, June 9, 2026".
  // Empty <time datetime=""> elements appear; rely on body text or wp-content
  // image URL ("/wp-content/uploads/YYYY/MM/..").
  $('[class*="post-"]').each((_, post) => {
    const $post = $(post);
    const $a = $post.find('h2 a[rel="bookmark"]').first();
    const href = $a.attr("href") || "";
    if (!/^https?:\/\/(?:www\.)?ncdoj\.gov\/[a-z0-9\-]{10,}\/?$/i.test(href)) return;
    const sourceUrl = href;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    const title = cleanText($a.text());
    if (!title || title.length < 10) return;
    let date = null;
    const dt = $post.find("time").first();
    const dtAttr = dt.attr("datetime");
    if (dtAttr) {
      const m = dtAttr.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) date = m[1];
    }
    if (!date) {
      const bodyText = cleanText($post.find(".content, p").first().text());
      const dm = bodyText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/);
      if (dm) {
        const d = new Date(`${dm[1]} ${dm[2]}, ${dm[3]}`);
        if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
      }
    }
    if (!date) {
      const img = $post.find("img[src*='/wp-content/uploads/']").attr("src") || "";
      const m = img.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
      if (m) date = `${m[1]}-${m[2]}-01`;
    }
    const defendants = [];
    const titleDef = defendantFromTitle(title);
    if (titleDef) defendants.push(titleDef);
    const amountUsd = parseDollarAmount(title);
    out.push({
      source: "nc-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(title, 600),
      category: "consumer-protection",
      sourceUrl,
    });
  });
  // Fixture-friendly fallback: when test HTML has a plain <article> wrapper
  // with <time datetime=...>, scan those too.
  if (out.length === 0) {
    $('article').each((_, art) => {
      const $art = $(art);
      const $a = $art.find('a[rel="bookmark"], h2 a').first();
      const href = $a.attr("href") || "";
      if (!/^https?:\/\/(?:www\.)?ncdoj\.gov\/[a-z0-9\-]{10,}\/?$/i.test(href)) return;
      const sourceUrl = href;
      if (seen.has(sourceUrl)) return;
      seen.add(sourceUrl);
      const title = cleanText($a.text());
      if (!title || title.length < 10) return;
      let date = null;
      const dtAttr = $art.find("time").first().attr("datetime");
      if (dtAttr) {
        const m = dtAttr.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) date = m[1];
      }
      const defendants = [];
      const titleDef = defendantFromTitle(title);
      if (titleDef) defendants.push(titleDef);
      const amountUsd = parseDollarAmount(title);
      out.push({
        source: "nc-ag",
        caseTitle: title,
        defendants,
        date,
        amountUsd,
        summary: clip(title, 600),
        category: "consumer-protection",
        sourceUrl,
      });
    });
  }
  return out;
}

/* ─────────────────────────── fixtures ───────────────────────────── */

async function parseFixture(source) {
  const dir = path.join(FIXTURE_DIR, source);
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter(f => /\.(html|xml|rss)$/.test(f));
  const out = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), "utf-8");
    let recs = [];
    switch (source) {
      case "ca-ag":  recs = parseCaAgList(text); break;
      case "cppa":   recs = parseCppaList(text); break;
      case "fl-ag":  recs = parseFlAgList(text); break;
      case "il-ag":  recs = parseIlAgList(text); break;
      case "wa-ag":  recs = parseWaAgRss(text);  break;
      case "oh-ag":  recs = parseOhAgList(text); break;
      case "pa-ag":  recs = parsePaAgList(text); break;
      case "nj-ag":  recs = parseNjAgRss(text);  break;
      case "ga-ag":  recs = parseGaAgList(text); break;
      case "nc-ag":  recs = parseNcAgList(text); break;
    }
    out.push(...recs);
  }
  return out;
}

/* ─────────────────────────── main ───────────────────────────────── */

const SOURCES = {
  "ca-ag":  fetchCaAg,
  "cppa":   fetchCppa,
  "fl-ag":  fetchFlAg,
  "il-ag":  fetchIlAg,
  "wa-ag":  fetchWaAg,
  "oh-ag":  fetchOhAg,
  "pa-ag":  fetchPaAg,
  "nj-ag":  fetchNjAg,
  "ga-ag":  fetchGaAg,
  "nc-ag":  fetchNcAg,
};

export const SOURCE_URLS = {
  "ca-ag":  CA_AG_LIST,
  "cppa":   CPPA_LIST,
  "fl-ag":  FL_AG_LIST,
  "il-ag":  IL_AG_LIST,
  "wa-ag":  WA_AG_RSS,
  "oh-ag":  OH_AG_LIST,
  "pa-ag":  PA_AG_LIST,
  "nj-ag":  NJ_AG_RSS,
  "ga-ag":  GA_AG_LIST,
  "nc-ag":  NC_AG_LIST,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceNames = args.only ? [args.only] : Object.keys(SOURCES);
  const all = [];
  for (const name of sourceNames) {
    const fn = SOURCES[name];
    if (!fn) { console.error(`unknown source: ${name}`); continue; }
    console.log(`\n== ${name} ==`);
    try {
      const records = await fn(args.limit, args.fixture, args.url);
      console.log(`  ${name}: ${records.length} records`);
      all.push(...records);
    } catch (err) {
      console.error(`  ${name} FAILED: ${err.message}`);
    }
  }

  // --dry: print summary, no write. Default behavior is to write to RAW_DIR.
  // --apply is accepted (and treated as the default) for parity with other
  // fetchers in the fleet; --out overrides path.
  if (args.dry && !args.out) {
    console.log(`\n[dry] would write ${all.length} records (use --apply or omit --dry to write)`);
    return;
  }
  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.out
    || path.join(RAW_DIR, `${new Date().toISOString().slice(0, 10)}.json`);
  await fs.writeFile(outPath, JSON.stringify(all, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  total records: ${all.length}`);
  for (const name of sourceNames) {
    const n = all.filter(r => r.source === name).length;
    console.log(`    ${name}: ${n}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("state-regulators-r3-fetch failed:", err);
    process.exit(1);
  });
}
