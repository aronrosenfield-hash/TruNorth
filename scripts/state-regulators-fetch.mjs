#!/usr/bin/env node
/**
 * US state-level regulator enforcement scraper.
 *
 * Round-2 data-grab pass. Covers state attorneys-general consumer-protection
 * units + state financial regulators — public records the federal pipelines
 * (CFPB, FTC, EEOC, NAAG multistate) miss.
 *
 * Sources targeted in this pass:
 *   1. NY Attorney General press releases (https://ag.ny.gov/press-releases)
 *   2. TX Attorney General news releases (https://www.texasattorneygeneral.gov/news/releases)
 *   3. NY Dept. of Financial Services enforcement actions
 *      (https://www.dfs.ny.gov/industry_guidance/enforcement_actions)
 *
 * Sources probed and parked for a later pass (see fetch-probe notes):
 *   - MA AG (mass.gov/news/press-release/feed.atom)        403 bot wall
 *   - WA AG (atg.wa.gov/news/news-releases)                 server-side redirect breaks scraping
 *   - IL AG (illinoisattorneygeneral.gov)                   no clean listing
 *   - CARB (ww2.arb.ca.gov/enforcement-actions)             403
 *   - TCEQ (tceq.texas.gov)                                 enforcement DB requires search
 *   - Cal/OSHA, CA DIR wage-theft                            no canonical list endpoint
 *   - NY DEC press releases                                  mostly grants, not enforcement
 *   - NY DOL wage-theft                                      no public list
 *   - MA Securities Division                                 PDF orders only, no index
 *   - State Insurance Commissioners                          NAIC aggregates by state, not company
 *
 * Output:
 *   data/raw/state-regulators/<YYYY-MM-DD>.json
 *
 * Record shape:
 *   {
 *     source:        "ny-ag" | "tx-ag" | "ny-dfs",
 *     caseTitle:     string,
 *     defendants:    [string, ...],   // best-effort extraction
 *     date:          "YYYY-MM-DD" | null,
 *     amountUsd:     number | null,
 *     summary:       string,           // <= 600 chars
 *     category:      "consumer-protection" | "financial-regulation",
 *     sourceUrl:     string,
 *   }
 *
 * Politeness:
 *   - 1.5s between requests; honest UA; retry once on 5xx.
 *   - Hard cap per source = 250 detail pages (~3 years of NY AG, all of
 *     visible TX AG, all current NYDFS listings).
 *
 * CLI:
 *   node scripts/state-regulators-fetch.mjs                 # all sources
 *   node scripts/state-regulators-fetch.mjs --only ny-ag    # one source
 *   node scripts/state-regulators-fetch.mjs --limit 20      # per-source cap
 *   node scripts/state-regulators-fetch.mjs --fixture       # parse local fixtures
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/state-regulators");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/state-regulators");

const UA = "TruNorth-StateReg/1.0 (+https://www.trunorthapp.com; consumer-protection data pipeline)";
const REQ_DELAY_MS = 1500;
const DEFAULT_LIMIT = 250;
const CUTOFF_YEAR = new Date().getFullYear() - 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─────────────────────────── CLI args ───────────────────────────── */

function parseArgs(argv) {
  const args = { only: null, limit: DEFAULT_LIMIT, fixture: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") args.only = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || DEFAULT_LIMIT;
    else if (a === "--fixture") args.fixture = true;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

/* ─────────────────────────── network ────────────────────────────── */

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
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

function cleanText(s) {
  // Strip soft-hyphens (U+00AD) and zero-width spaces — TX AG injects them
  // in titles for typographic line-breaks ("Attor­ney Gen­er­al").
  return (s || "").replace(/[­​‌‍﻿]/g, "").replace(/\s+/g, " ").trim();
}

function clip(s, n) {
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
    // Heuristic: if no unit and raw number is suspiciously small (<1000), skip
    if (!unit && num < 1000) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}

/** Mine likely company names from a free-text passage. */
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

  // Sentinel: replace common corp-suffix periods with a placeholder so the
  // sentence-end "\.\s" anchor doesn't fire inside "Inc.", "Corp.", "Co.",
  // "Ltd." etc. We swap back after splitting.
  const SUFFIX_PERIOD = /\b(Inc|Incorporated|Corp|Corporation|Co|Company|LLC|LP|LLP|Ltd|Limited|PLC|N\.A|N\.V|S\.A|A\.G|St)\.(?=\s|$)/g;
  const SENTINEL = "";
  const protect = (s) => s.replace(SUFFIX_PERIOD, (m, p) => `${p}${SENTINEL}`);
  const restore = (s) => s.replace(new RegExp(SENTINEL, "g"), ".");
  const protectedText = protect(text);

  const anchors = [
    /\b(?:against|from|with|sued|sues|settles? with|settled? with|reached an agreement with|investigation into|investigating|action against|order against)\s+(.+?)(?:\s+(?:for|over|alleging|regarding|relating|related|after|following|to settle|to resolve|in connection)\b|\.\s|;)/gi,
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
        if (/\b(states?|companies|corporations|firms|attorneys?|millions?|billions?|workers?|consumers?|residents?|new yorkers?|texans?|americans?|defendants?)\b/i.test(p.trim())) continue;
        add(p);
      }
    }
  }
  return out;
}

/* ─────────────────────────── NY AG ──────────────────────────────── */

const NY_AG_LIST = "https://ag.ny.gov/press-releases";

async function fetchNyAg(limit, useFixture) {
  const out = [];
  const seenUrls = new Set();
  const detailPaths = [];

  if (useFixture) {
    const fixturesDir = path.join(FIXTURE_DIR, "ny-ag");
    if (!existsSync(fixturesDir)) return [];
    const files = (await fs.readdir(fixturesDir)).filter(f => f.endsWith(".html"));
    for (const f of files) {
      const html = await fs.readFile(path.join(fixturesDir, f), "utf-8");
      const rec = parseNyAgDetail(html, `https://ag.ny.gov/press-release/${f.replace(/\.html$/, "")}`);
      if (rec) out.push(rec);
    }
    return out;
  }

  for (let page = 0; page < 25; page++) {
    const url = page === 0 ? NY_AG_LIST : `${NY_AG_LIST}?page=${page}`;
    let html;
    try {
      html = await fetchText(url);
    } catch (err) {
      console.warn(`  ny-ag list page ${page} failed: ${err.message}`);
      break;
    }
    const $ = cheerio.load(html);
    const before = detailPaths.length;
    $('a[href^="/press-release/"]').each((_, a) => {
      const href = $(a).attr("href");
      if (!href || !/^\/press-release\/\d{4}\//.test(href)) return;
      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      const m = href.match(/^\/press-release\/(\d{4})\//);
      if (m && parseInt(m[1], 10) < CUTOFF_YEAR) return;
      detailPaths.push(href);
    });
    const added = detailPaths.length - before;
    if (added === 0) break;
    await sleep(REQ_DELAY_MS);
    if (detailPaths.length >= limit) break;
  }
  console.log(`  ny-ag: ${detailPaths.length} detail urls to fetch`);

  for (let i = 0; i < Math.min(detailPaths.length, limit); i++) {
    const url = `https://ag.ny.gov${detailPaths[i]}`;
    try {
      const html = await fetchText(url);
      const rec = parseNyAgDetail(html, url);
      if (rec) out.push(rec);
    } catch (err) {
      console.warn(`  ny-ag detail failed: ${url} — ${err.message}`);
    }
    if (i % 25 === 0) console.log(`    ny-ag ${i + 1}/${Math.min(detailPaths.length, limit)}`);
    await sleep(REQ_DELAY_MS);
  }
  return out;
}

export function parseNyAgDetail(html, url) {
  const $ = cheerio.load(html);
  const title = cleanText($("h1").first().text() || $("title").text().replace(/\s*\|.*$/, ""));
  if (!title) return null;
  let date = null;
  const meta = $('meta[property="article:published_time"]').attr("content")
    || $('meta[name="article:published_time"]').attr("content")
    || $('time[datetime]').first().attr("datetime");
  if (meta) {
    const m = meta.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) date = m[1];
  }
  if (!date) {
    const m = url.match(/\/press-release\/(\d{4})\//);
    if (m) date = `${m[1]}-01-01`;
  }

  const bodyHtml = $("article").first().html() || $("main").first().html() || "";
  const body = cleanText(cheerio.load(`<root>${bodyHtml}</root>`)("root").text());
  const summary = clip(body, 600);

  const defendants = mineDefendants(body);
  const titleMatch = title.match(/(?:from|against|sues?|secures?\s+(?:\$[\d.,]+\s+\w*\s+)?from)\s+(.+?)(?:\s+for\s+|\s+over\s+|\s+regarding|$)/i);
  if (titleMatch) {
    const cand = titleMatch[1].trim();
    if (cand.length >= 3 && cand.length <= 120 && !defendants.some(d => d.toLowerCase() === cand.toLowerCase())) {
      defendants.unshift(cand);
    }
  }

  const amountUsd = parseDollarAmount(title + " " + body);

  return {
    source: "ny-ag",
    caseTitle: title,
    defendants,
    date,
    amountUsd,
    summary,
    category: "consumer-protection",
    sourceUrl: url,
  };
}

/* ─────────────────────────── TX AG ──────────────────────────────── */

const TX_AG_LIST = "https://www.texasattorneygeneral.gov/news/releases";

async function fetchTxAg(limit, useFixture) {
  const out = [];
  const seenUrls = new Set();

  if (useFixture) {
    const fixturesDir = path.join(FIXTURE_DIR, "tx-ag");
    if (!existsSync(fixturesDir)) return [];
    const files = (await fs.readdir(fixturesDir)).filter(f => f.endsWith(".html"));
    for (const f of files) {
      const html = await fs.readFile(path.join(fixturesDir, f), "utf-8");
      out.push(...parseTxAgList(html));
    }
    return out;
  }

  // TX AG listing page embeds title + summary + date + URL per item — no
  // detail-page fetch needed.
  for (let page = 0; page < 50; page++) {
    const url = page === 0 ? TX_AG_LIST : `${TX_AG_LIST}?page=${page}`;
    let html;
    try {
      html = await fetchText(url);
    } catch (err) {
      console.warn(`  tx-ag list page ${page} failed: ${err.message}`);
      break;
    }
    const records = parseTxAgList(html);
    const before = out.length;
    for (const r of records) {
      if (seenUrls.has(r.sourceUrl)) continue;
      seenUrls.add(r.sourceUrl);
      // 3-year cutoff
      if (r.date) {
        const y = parseInt(r.date.slice(0, 4), 10);
        if (y < CUTOFF_YEAR) continue;
      }
      out.push(r);
      if (out.length >= limit) break;
    }
    const added = out.length - before;
    if (added === 0) break;
    if (out.length >= limit) break;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`  tx-ag: ${out.length} records from listing`);
  return out;
}

export function parseTxAgList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.main-content-wysiwyg-container h4 a[href*="/news/releases/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    if (!/^\/?news\/releases\/[a-z0-9-]+/i.test(href)) return;
    const norm = href.startsWith("http") ? href : `https://www.texasattorneygeneral.gov${href.startsWith("/") ? href : "/" + href}`;
    const title = cleanText($a.text());
    if (!title) return;

    // Walk up to the wrapper <div> that holds the summary <p> and meta <p>.
    const $wrap = $a.closest("div");
    let summary = "";
    let date = null;
    $wrap.find("p").each((_, p) => {
      const $p = $(p);
      const txt = cleanText($p.text());
      if (!txt) return;
      if (/^\w+ \d{1,2}, \d{4}/.test(txt) || /Press Release/i.test(txt)) {
        const m = txt.match(/^(\w+ \d{1,2}, \d{4})/);
        if (m) {
          const d = new Date(m[1]);
          if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
        }
      } else if (!summary) {
        summary = txt;
      }
    });

    const fullText = title + " " + summary;
    const defendants = mineDefendants(fullText);
    const titleMatch = title.match(/(?:investigates?|sues?|stops?|settles? with|reaches? agreement with|action against|investigation into)\s+(.+?)(?:\s+for\s+|\s+over\s+|\s+to\s+|\s+regarding|$)/i);
    if (titleMatch) {
      const cand = titleMatch[1].trim();
      if (cand.length >= 3 && cand.length <= 120 && !defendants.some(d => d.toLowerCase() === cand.toLowerCase())) {
        defendants.unshift(cand);
      }
    }
    const amountUsd = parseDollarAmount(fullText);

    out.push({
      source: "tx-ag",
      caseTitle: title,
      defendants,
      date,
      amountUsd,
      summary: clip(summary || title, 600),
      category: "consumer-protection",
      sourceUrl: norm,
    });
  });
  return out;
}

export function parseTxAgDetail(html, url) {
  const $ = cheerio.load(html);
  const title = cleanText($("h1").first().text() || $("title").text().replace(/\s*\|.*$/, ""));
  if (!title) return null;
  const desc = $('meta[name="description"]').attr("content")
    || $('meta[property="og:description"]').attr("content")
    || "";
  let date = null;
  const meta = $('meta[property="article:published_time"]').attr("content")
    || $('meta[name="dcterms.date"]').attr("content")
    || $('time[datetime]').first().attr("datetime");
  if (meta) {
    const m = meta.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) date = m[1];
  }
  const bodyHtml = $(".field--name-body").html()
    || $("article").first().html()
    || $("main").first().html()
    || "";
  const body = cleanText(cheerio.load(`<root>${bodyHtml}</root>`)("root").text());
  const fullText = title + " " + desc + " " + body;
  const summary = clip(desc || body, 600);

  if (date) {
    const y = parseInt(date.slice(0, 4), 10);
    if (y < CUTOFF_YEAR) return null;
  }

  const defendants = mineDefendants(fullText);
  const titleMatch = title.match(/(?:investigates?|sues?|stops?|settles? with|reaches? agreement with|action against|investigation into)\s+(.+?)(?:\s+for\s+|\s+over\s+|\s+to\s+|\s+regarding|$)/i);
  if (titleMatch) {
    const cand = titleMatch[1].trim();
    if (cand.length >= 3 && cand.length <= 120 && !defendants.some(d => d.toLowerCase() === cand.toLowerCase())) {
      defendants.unshift(cand);
    }
  }
  const amountUsd = parseDollarAmount(fullText);

  return {
    source: "tx-ag",
    caseTitle: title,
    defendants,
    date,
    amountUsd,
    summary,
    category: "consumer-protection",
    sourceUrl: url,
  };
}

/* ─────────────────────────── NYDFS ──────────────────────────────── */

const NYDFS_LIST_URLS = [
  "https://www.dfs.ny.gov/industry_guidance/enforcement_actions",
  "https://www.dfs.ny.gov/industry_guidance/enforcement_actions_Insurance",
  "https://www.dfs.ny.gov/industry_guidance/enforcement_actions_mortgage",
];

async function fetchNyDfs(limit, useFixture) {
  const out = [];

  if (useFixture) {
    const fixturePath = path.join(FIXTURE_DIR, "ny-dfs-list.html");
    if (!existsSync(fixturePath)) return [];
    const html = await fs.readFile(fixturePath, "utf-8");
    out.push(...parseNyDfsList(html, NYDFS_LIST_URLS[0]));
    return out.slice(0, limit);
  }

  for (const listUrl of NYDFS_LIST_URLS) {
    try {
      const html = await fetchText(listUrl);
      const records = parseNyDfsList(html, listUrl);
      console.log(`  ny-dfs ${listUrl.split("_").pop()}: ${records.length} actions`);
      out.push(...records);
      await sleep(REQ_DELAY_MS);
    } catch (err) {
      console.warn(`  ny-dfs list ${listUrl} failed: ${err.message}`);
    }
  }
  return out.slice(0, limit);
}

/**
 * NYDFS lists each action as a link. URL encodes:
 *   /industry-guidance/enforcement-discipline/ea{YYYYMMDD}[_2]-{slug}
 * Link text usually contains the company name. We capture title + date + URL
 * and let downstream resolve slugs.
 */
export function parseNyDfsList(html, listUrl) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a[href*="enforcement-discipline/ea"], a[href*="enforcement_discipline/ea"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const norm = href.startsWith("http") ? href : `https://www.dfs.ny.gov${href}`;
    if (seen.has(norm)) return;
    seen.add(norm);

    const linkText = cleanText($a.text());
    if (!linkText || linkText.length < 3) return;

    let date = null;
    const m = href.match(/ea[_]?(\d{4})(\d{2})(\d{2})/);
    if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
    if (date) {
      const y = parseInt(date.slice(0, 4), 10);
      if (y < CUTOFF_YEAR) return;
    }

    let summary = linkText;
    const $tr = $a.closest("tr");
    if ($tr.length) {
      const txt = cleanText($tr.text());
      if (txt && txt.length > linkText.length) summary = txt;
    }

    let defendantStr = linkText
      .replace(/^(?:in (?:the )?matter of|consent order(?: (?:with|to|against))?|order(?: (?:against|to))?|settlement(?: with)?|stipulation(?: with)?|notice of satisfaction(?: of)?(?: agreements?)?)[:\s-]*/i, "")
      .replace(/\s*[-–—]\s*consent order.*$/i, "")
      .replace(/\s*[-–—]\s*settlement.*$/i, "")
      .replace(/\s*\bconsent order\b.*$/i, "")
      .replace(/^(?:to|with|against)\s+/i, "")
      .trim();
    // Drop generic catch-all headings
    const dropGeneric = (s) => /^(notice of satisfaction.*|agreements?|stipulations?|consent orders?|orders?)$/i.test(s);
    if (dropGeneric(defendantStr)) defendantStr = "";
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(defendantStr) || defendantStr.length < 3) {
      const sm = href.match(/ea[_]?\d{8}[_-]?(?:co[_-])?(.+?)(?:[?#]|$)/);
      if (sm) {
        defendantStr = sm[1].replace(/[-_]+/g, " ").trim();
      }
    }
    if (dropGeneric(defendantStr)) defendantStr = "";
    if (!defendantStr) return;
    const defendants = [defendantStr];

    const amountUsd = parseDollarAmount(summary);

    out.push({
      source: "ny-dfs",
      caseTitle: linkText,
      defendants,
      date,
      amountUsd,
      summary: clip(summary, 400),
      category: "financial-regulation",
      sourceUrl: norm,
    });
  });
  return out;
}

/* ─────────────────────────── main ───────────────────────────────── */

const SOURCES = {
  "ny-ag":  fetchNyAg,
  "tx-ag":  fetchTxAg,
  "ny-dfs": fetchNyDfs,
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
      const records = await fn(args.limit, args.fixture);
      console.log(`  ${name}: ${records.length} records`);
      all.push(...records);
    } catch (err) {
      console.error(`  ${name} FAILED: ${err.message}`);
    }
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
    console.error("state-regulators-fetch failed:", err);
    process.exit(1);
  });
}
