#!/usr/bin/env node
/**
 * CFTC enforcement scraper (monthly).
 *
 * For each brand in /public/data/top-500-brands.txt, walks the CFTC's
 * press-release archive (https://www.cftc.gov/PressRoom/PressReleases)
 * and counts enforcement-flavored releases (Charges / Orders / Sues /
 * Settles / Fines / Judgment / Penalty / Restitution) that name the
 * brand in the title.
 *
 * For each matched release, the body is fetched and parsed for the
 * civil monetary penalty $ amount(s). We extract the largest dollar
 * figure preceded by "civil monetary penalty" / "civil penalty" /
 * "monetary penalty of" so we don't double-count restitution or
 * disgorgement.
 *
 * Output: /public/data/cftc-enforcement.json (overwritten monthly)
 *
 * Per-brand aggregates (only emitted when ≥1 match found):
 *   - total_cftc_actions_5y: number    (releases within last 5 years)
 *   - total_fines_usd:       number    (sum of extracted civil monetary penalties)
 *   - latest_action_date:    ISO string
 *   - sample_actions:        [{ pr, date, title, penalty_usd, summary, url }]
 *
 * Strategy:
 *   1. Walk all listing pages (~146 × 25 = ~3,650 releases) at 1 req/sec.
 *   2. Filter to enforcement-flavored titles (verb regex).
 *   3. For each brand, regex-match brand name + aliases against titles.
 *   4. Fetch matched bodies (capped at 25 per brand to limit blast
 *      radius) to extract civil monetary penalty amounts and a one-
 *      paragraph summary.
 *
 * No auth required. 1 req/sec per spec.
 *
 * Runs via .github/workflows/cftc-monthly.yml on the 1st @ 18:00 UTC.
 * Locally: node scripts/cftc-fetch.mjs            (all brands)
 *          node scripts/cftc-fetch.mjs --smoke    (JPM, Goldman, Citi, BP)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/cftc-enforcement.json");

const LIST_BASE = "https://www.cftc.gov/PressRoom/PressReleases";
const DETAIL_BASE = "https://www.cftc.gov";
const UA = "TruNorth-CFTC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const FIVE_YR_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const SMOKE = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set(["jpmorgan-chase", "goldman-sachs", "citi", "bp"]);

// Verbs that strongly indicate the press release describes an enforcement
// action against a named party. We intentionally include "Federal Court"
// and "Judgment" to catch the post-trial summary releases.
const ENF_TITLE_RE = /\b(Charges?|Sues|Orders?|Fines?|Penalt|Settles|Settlement|Judgment|Judgement|Restitution|Disgorgement|Convicted|Sentenced|Indict|Plea|Found Liable|Enforcement Action|Files? (?:a )?Complaint)\b/i;

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name, category] = l.split("|").map(s => s.trim());
      return { slug, name, category };
    })
    .filter(b => b.slug && b.name);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Parse one listing page → [{ pr, date, title, url }]
// Rows look like (whitespace varies):
//   <time datetime="2026-06-03T19:46:28Z">06/03/2026</time>
//   …
//   <a href="/PressRoom/PressReleases/9247-26" hreflang="en">Title…</a> , 9247-26
function parseListingPage(html) {
  const out = [];
  const rowRe = /<time[^>]+datetime="([^"]+)"[^>]*>[^<]*<\/time>[\s\S]*?<a href="(\/PressRoom\/PressReleases\/(?:pr-)?(\d+-\d+))"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const dateIso = m[1];
    const href    = DETAIL_BASE + m[2];
    const pr      = m[3];
    const title   = m[4].replace(/<[^>]+>/g, "")
                         .replace(/&amp;/g, "&")
                         .replace(/&nbsp;/g, " ")
                         .replace(/&#?\w+;/g, " ")
                         .replace(/\s+/g, " ").trim();
    out.push({ pr, date: dateIso, title, url: href });
  }
  return out;
}

async function fetchAllListings() {
  const firstHtml = await fetchText(`${LIST_BASE}?page=0`);
  const lastM = firstHtml.match(/href="\?page=(\d+)"[^>]*title="Go to last page"/);
  const lastPage = lastM ? parseInt(lastM[1], 10) : 145;
  console.log(`  Listing pages: 0..${lastPage}`);

  const seen = new Set();
  const all = [];
  const pushAll = (rows) => {
    for (const r of rows) {
      if (seen.has(r.pr)) continue;
      seen.add(r.pr);
      all.push(r);
    }
  };
  pushAll(parseListingPage(firstHtml));

  for (let p = 1; p <= lastPage; p++) {
    await sleep(REQ_DELAY_MS);
    try {
      const html = await fetchText(`${LIST_BASE}?page=${p}`);
      pushAll(parseListingPage(html));
      if (p % 10 === 0) console.log(`  …page ${p}/${lastPage} (${all.length} releases)`);
    } catch (e) {
      console.warn(`  page ${p} failed: ${e.message}`);
    }
  }
  return all;
}

// Extract a one-paragraph plain-text summary + the civil monetary penalty
// dollar figure from a press-release detail page.
function extractBody(html) {
  // Detail body lives in `.field--name-body field--item`.
  const bodyM = html.match(/<div class="[^"]*field--name-body[^"]*field--item[^"]*">([\s\S]*?)<\/div>\s*(?:<\/div>|<\/article>|<!--)/);
  const raw = bodyM ? bodyM[1] : html;
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse "$1.2 million", "$25,000", "$2.5 billion" → number of USD.
function parseUsd(numStr, scale) {
  const n = parseFloat(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  const s = (scale || "").toLowerCase();
  if (s.startsWith("bill")) return n * 1e9;
  if (s.startsWith("mill")) return n * 1e6;
  if (s.startsWith("thou")) return n * 1e3;
  return n;
}

// Extract civil monetary penalty $ amount(s) and return the max value.
// We deliberately bias toward "civil monetary penalty / civil penalty /
// monetary penalty of $X" rather than total $-figures so we don't sweep
// up restitution + disgorgement (which usually dwarfs the fine).
function extractPenaltyUsd(text) {
  if (!text) return 0;
  const found = [];
  // Pattern A: "$X (million|billion)? civil monetary penalty"
  const reA = /\$([\d,]+(?:\.\d+)?)\s*(million|billion|thousand)?\s*(?:in\s+)?(?:civil monetary penalty|civil penalty|monetary penalty)/gi;
  // Pattern B: "civil monetary penalty of $X (million|billion)?"
  const reB = /(?:civil monetary penalty|civil penalty|monetary penalty)\s+(?:of|totaling|in the amount of)?\s*\$([\d,]+(?:\.\d+)?)\s*(million|billion|thousand)?/gi;
  // Pattern C: "pay $X (million|billion)? (?:in)? civil monetary penalt"
  const reC = /pay\s+\$([\d,]+(?:\.\d+)?)\s*(million|billion|thousand)?\s+(?:as\s+)?(?:a\s+)?(?:in\s+)?civil/gi;
  for (const re of [reA, reB, reC]) {
    let m;
    while ((m = re.exec(text))) found.push(parseUsd(m[1], m[2]));
  }
  return found.length ? Math.max(...found) : 0;
}

// Build a brand-matching regex. Some short brand names cause false
// positives in CFTC titles ("Apple", "Target", "Meta", "Visa") because
// they collide with unrelated entities. Map value `strictOnly: true`
// means we only match the listed aliases — never the bare brand name.
const BRAND_ALIASES = {
  "JPMorgan Chase":  ["JPMorgan", "J.P. Morgan", "Chase Bank"],
  "Goldman Sachs":   ["Goldman, Sachs", "Goldman Sachs & Co"],
  "Citi":            { strictOnly: true, aliases: ["Citigroup", "Citibank", "Citi Global Markets"] },
  "Bank of America": ["BofA", "Merrill Lynch"],
  "Wells Fargo":     ["Wells Fargo & Co"],
  "Morgan Stanley":  ["Morgan Stanley & Co"],
  "Deutsche Bank":   ["DB Group"],
  "Barclays":        ["Barclays Bank", "Barclays Capital"],
  "HSBC":            ["HSBC Bank", "HSBC Securities"],
  "UBS":             { strictOnly: true, aliases: ["UBS AG", "UBS Securities", "UBS Financial"] },
  "BP":              { strictOnly: true, aliases: ["BP America", "BP plc", "BP Products"] },
  "ExxonMobil":      ["Exxon Mobil", "Exxon"],
  "Shell":           { strictOnly: true, aliases: ["Shell Trading", "Royal Dutch Shell", "Shell Oil"] },
  "Chevron":         ["Chevron Corp"],
  "Google":          ["Alphabet"],
  "Meta":            { strictOnly: true, aliases: ["Meta Platforms"] },
  "Apple":           { strictOnly: true, aliases: ["Apple Inc"] },
  "Target":          { strictOnly: true, aliases: ["Target Corp"] },
  "Visa":            { strictOnly: true, aliases: ["Visa Inc", "Visa U.S.A"] },
};

function brandRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}\\b`, "i");
}

function matchersFor(brand) {
  const entry = BRAND_ALIASES[brand.name];
  let names;
  if (entry && !Array.isArray(entry) && entry.strictOnly) {
    names = entry.aliases;
  } else if (Array.isArray(entry)) {
    names = [brand.name, ...entry];
  } else {
    names = [brand.name];
  }
  return names.map(brandRegex);
}

// Filter listings to enforcement-flavored titles up-front so we don't
// fetch body pages for clearly non-enforcement releases.
function isEnforcementTitle(title) {
  return ENF_TITLE_RE.test(title);
}

async function aggregateForBrand(brand, enforcementReleases, cache) {
  const regexes = matchersFor(brand);
  const matches = enforcementReleases.filter(r =>
    regexes.some(re => re.test(r.title))
  );
  if (matches.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_actions", total_cftc_actions_5y: 0 };
  }

  matches.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const cutoff = Date.now() - FIVE_YR_MS;
  const within5y = matches.filter(r => {
    const t = Date.parse(r.date);
    return !Number.isNaN(t) && t > cutoff;
  });

  // Fetch bodies for up to 25 most-recent matches → extract penalty +
  // summary. We cap to keep request budget reasonable for noisy brands.
  const FETCH_CAP = 25;
  const toFetch = matches.slice(0, FETCH_CAP);
  let totalFinesUsd = 0;
  const enriched = [];
  for (const r of toFetch) {
    let body = cache.get(r.url);
    if (!body) {
      try {
        const html = await fetchText(r.url);
        body = extractBody(html);
        cache.set(r.url, body);
      } catch {
        body = "";
      }
      await sleep(REQ_DELAY_MS);
    }
    const penalty = extractPenaltyUsd(body);
    enriched.push({
      pr:          r.pr,
      date:        r.date,
      title:       r.title,
      penalty_usd: penalty,
      summary:     body.slice(0, 500),
      url:         r.url,
    });
  }

  // Sum fines across the 5-year window only.
  for (const r of enriched) {
    const t = Date.parse(r.date);
    if (!Number.isNaN(t) && t > cutoff) totalFinesUsd += r.penalty_usd || 0;
  }

  return {
    slug:                  brand.slug,
    name:                  brand.name,
    status:                "ok",
    total_cftc_actions_5y: within5y.length,
    total_cftc_actions_all:matches.length,
    total_fines_usd:       Math.round(totalFinesUsd),
    latest_action_date:    matches[0].date,
    sample_actions:        enriched.slice(0, 5),
    scraped_at:            new Date().toISOString(),
  };
}

async function main() {
  console.log("CFTC enforcement fetcher starting...");
  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE) {
    brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));
    console.log(`SMOKE mode — testing ${brands.length} brands: ${brands.map(b => b.slug).join(", ")}`);
  }

  console.log("Walking listing pages…");
  const releases = await fetchAllListings();
  console.log(`Collected ${releases.length} unique releases`);

  const enforcement = releases.filter(r => isEnforcementTitle(r.title));
  console.log(`${enforcement.length} match enforcement-flavored title patterns`);

  // Cache detail-page body text so a release matched by multiple brands
  // doesn't get fetched twice.
  const bodyCache = new Map();

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await aggregateForBrand(brands[i], enforcement, bodyCache);
    results.push(r);
    if (r.status === "ok") {
      console.log(`  ${brands[i].slug}: ${r.total_cftc_actions_5y} 5y actions / $${r.total_fines_usd.toLocaleString()} fines`);
    }
    if (i % 25 === 0 && i > 0) console.log(`  …${i}/${brands.length}`);
  }

  const withActions = results.filter(r => r.status === "ok").length;
  const noActions   = results.filter(r => r.status === "no_actions").length;

  const outPath = SMOKE ? OUT_FILE.replace(/\.json$/, ".smoke.json") : OUT_FILE;
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:           new Date().toISOString(),
    smoke:                  SMOKE || undefined,
    archive_release_count:  releases.length,
    enforcement_count:      enforcement.length,
    brand_count:            brands.length,
    with_actions_count:     withActions,
    no_actions_count:       noActions,
    actions:                results,
  }, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`   With actions:  ${withActions}`);
  console.log(`   No actions:    ${noActions}`);
}

main().catch(err => {
  console.error("cftc-fetch failed:", err);
  process.exit(1);
});
