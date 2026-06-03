#!/usr/bin/env node
/**
 * SEC Litigation Releases scraper (weekly).
 *
 * For each brand in /public/data/top-500-brands.txt, walks the SEC's
 * Litigation Releases archive (https://www.sec.gov/enforcement-litigation/
 * litigation-releases) and counts releases that name the brand in the
 * case caption / defendants list.
 *
 * The SEC issues a Litigation Release every time it files or resolves an
 * enforcement action in federal court. Each release's listing row carries
 * the full defendant caption (e.g. "Goldman Sachs & Co. LLC and Goldman
 * Sachs International"), which is what we match against.
 *
 * Output: /public/data/sec-litigation.json (overwritten weekly)
 *
 * Per-brand aggregates:
 *   - total_releases_lifetime  — all-time count (archive goes back to ~2000)
 *   - recent_24mo              — releases in last 24 months
 *   - latest_release_date      — most recent ISO date
 *   - sample_releases          — top 5 most recent (lr, date, caption,
 *                                summary, url)
 *
 * Strategy:
 *   1. Walk all listing pages (~119 pages × 100 releases = 11,900 entries)
 *      at 1 req/sec.
 *   2. For each brand, regex-match the brand display name against every
 *      caption (word-boundary, case-insensitive).
 *   3. For matched releases, fetch up to the 5 most recent bodies to
 *      extract a one-paragraph summary.
 *
 * No auth required. The SEC's published fair-use policy asks for a
 * descriptive User-Agent and ≤ 10 req/sec; we use 1 req/sec.
 *
 * Runs via .github/workflows/sec-litigation-weekly.yml Sunday 23:00 UTC.
 * Locally: node scripts/sec-litigation-fetch.mjs            (all brands)
 *          node scripts/sec-litigation-fetch.mjs --smoke    (smoke 3)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/sec-litigation.json");

const LIST_BASE = "https://www.sec.gov/enforcement-litigation/litigation-releases";
const UA = "TruNorth-SEC-Lit/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const TWENTY_FOUR_MO_MS = 730 * 24 * 60 * 60 * 1000;

const SMOKE = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set(["meta", "tesla", "goldman-sachs"]);

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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse one listing page into [{ lr, date, caption, url }]
function parseListingPage(html) {
  const out = [];
  // Each row starts with <time datetime="..."> then an anchor
  // /enforcement-litigation/litigation-releases/lr-NNNN  (modern)
  // or /litigation/litreleases/lrNNNNN.txt              (legacy, pre-2010)
  // followed by the defendant caption text.
  const rowRe = /<time[^>]+datetime="([^"]+)"[^>]*>[^<]*<\/time>[\s\S]*?<a href=['"]([^'"]*(?:lr-?\d+(?:\.txt)?)[^'"]*)['"][^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const dateIso = m[1];
    let href = m[2];
    if (href.startsWith("/")) href = "https://www.sec.gov" + href;
    const captionRaw = m[3].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const lrMatch = href.match(/lr-?(\d+)/);
    if (!lrMatch) continue;
    out.push({
      lr: `LR-${lrMatch[1]}`,
      date: dateIso,
      caption: captionRaw,
      url: href.replace(/\.txt$/, ".txt"), // keep as is
    });
  }
  return out;
}

async function fetchAllListings() {
  // Determine total pages from page 0.
  const firstHtml = await fetchText(`${LIST_BASE}?page=0`);
  const lastM = firstHtml.match(/href="\?page=(\d+)"[^>]*title="Go to last page"/);
  const lastPage = lastM ? parseInt(lastM[1], 10) : 118;
  console.log(`  Listing pages: 0..${lastPage}`);

  const releases = [];
  const seen = new Set();
  const pushAll = (items) => {
    for (const r of items) {
      if (seen.has(r.lr)) continue;
      seen.add(r.lr);
      releases.push(r);
    }
  };
  pushAll(parseListingPage(firstHtml));

  for (let p = 1; p <= lastPage; p++) {
    await sleep(REQ_DELAY_MS);
    try {
      const html = await fetchText(`${LIST_BASE}?page=${p}`);
      const items = parseListingPage(html);
      pushAll(items);
      if (p % 10 === 0) console.log(`  …page ${p}/${lastPage} (${releases.length} releases)`);
    } catch (e) {
      console.warn(`  page ${p} failed: ${e.message}`);
    }
  }
  return releases;
}

// Extract a one-paragraph plain-text summary from a release page.
function extractSummary(html) {
  // Modern page body lives in `.field--name-body field__item`.
  const bodyM = html.match(/<div class="[^"]*field--name-body[^"]*field__item[^"]*">([\s\S]*?)<\/div>\s*(?:<\/div>|<\/article>)/);
  let text;
  if (bodyM) {
    text = bodyM[1];
  } else {
    // Legacy .txt pages — already plain text.
    text = html;
  }
  // Strip tags + entities, collapse whitespace.
  text = text.replace(/<[^>]+>/g, " ")
             .replace(/&nbsp;/g, " ")
             .replace(/&amp;/g, "&")
             .replace(/&#?\w+;/g, " ")
             .replace(/\s+/g, " ")
             .trim();
  // Take first ~400 chars after dropping the boilerplate header lines.
  text = text.replace(/^\s*U\.S\.\s*SECURITIES AND EXCHANGE COMMISSION\s*/i, "");
  text = text.replace(/^\s*Litigation Release No\.\s*\d+\s*\/\s*[A-Za-z]+ \d+,\s*\d+\s*/i, "");
  return text.slice(0, 500);
}

async function fetchSummary(url) {
  try {
    const html = await fetchText(url);
    return extractSummary(html);
  } catch {
    return null;
  }
}

// Build a robust regex for one brand. Word-boundary, case-insensitive,
// handles "&" / "and" / commas inside the brand name.
function brandRegex(name) {
  // Escape regex metas
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}\\b`, "i");
}

// Aliases for brands whose corporate / case-caption form differs from the
// display name. The matcher tries each alias in addition to the brand
// itself.
// Some short brand names ("Meta", "Apple", "Target") match unrelated entities
// in case captions ("Meta 1 Coin Trust"). For these, we override the default
// brand-name regex with stricter forms only. Map value of `strictOnly: true`
// means we do NOT match the bare brand name — only the listed aliases.
const BRAND_ALIASES = {
  "Meta":          { strictOnly: true, aliases: ["Meta Platforms", "Facebook, Inc"] },
  "Goldman Sachs": ["Goldman, Sachs"],
  "JPMorgan Chase":["JPMorgan", "J.P. Morgan", "Chase Bank"],
  "Bank of America": ["BofA"],
  "Wells Fargo":   ["Wells Fargo & Co"],
  "Google":        ["Alphabet"],
  "Verizon":       ["Verizon Communications"],
  "AT&T":          ["AT&T Inc"],
  "ExxonMobil":    ["Exxon Mobil", "Exxon"],
  "ConocoPhillips":["Conoco"],
  "Berkshire Hathaway":["Berkshire"],
};

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

async function aggregateForBrand(brand, releases) {
  const regexes = matchersFor(brand);
  const matches = releases.filter(r =>
    regexes.some(re => re.test(r.caption))
  );

  if (matches.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_releases", total_releases_lifetime: 0 };
  }

  // Sort newest first
  matches.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const cutoff = Date.now() - TWENTY_FOUR_MO_MS;
  const recent24mo = matches.filter(r => {
    const t = Date.parse(r.date);
    return !Number.isNaN(t) && t > cutoff;
  }).length;

  // Fetch summaries for top 5
  const top5 = matches.slice(0, 5);
  const samples = [];
  for (const r of top5) {
    const summary = await fetchSummary(r.url);
    samples.push({
      lr:       r.lr,
      date:     r.date,
      caption:  r.caption,
      summary:  summary || r.caption,
      url:      r.url,
    });
    await sleep(REQ_DELAY_MS);
  }

  return {
    slug:                     brand.slug,
    name:                     brand.name,
    status:                   "ok",
    total_releases_lifetime:  matches.length,
    recent_24mo:              recent24mo,
    latest_release_date:      matches[0].date,
    sample_releases:          samples,
    scraped_at:               new Date().toISOString(),
  };
}

async function main() {
  console.log("SEC Litigation Releases fetcher starting...");
  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE) {
    brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));
    console.log(`SMOKE mode — testing ${brands.length} brands: ${brands.map(b => b.slug).join(", ")}`);
  }

  console.log("Walking listing pages…");
  const releases = await fetchAllListings();
  console.log(`Collected ${releases.length} unique releases`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await aggregateForBrand(brands[i], releases);
    results.push(r);
    if (r.status === "ok") {
      console.log(`  ${brands[i].slug}: ${r.total_releases_lifetime} releases (${r.recent_24mo} in last 24mo)`);
    }
    if (i % 25 === 0 && i > 0) console.log(`  …${i}/${brands.length}`);
  }

  const withReleases = results.filter(r => r.status === "ok").length;
  const noReleases   = results.filter(r => r.status === "no_releases").length;

  const outPath = SMOKE ? OUT_FILE.replace(/\.json$/, ".smoke.json") : OUT_FILE;
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:           new Date().toISOString(),
    smoke:                  SMOKE || undefined,
    archive_release_count:  releases.length,
    brand_count:            brands.length,
    with_releases_count:    withReleases,
    no_releases_count:      noReleases,
    releases:               results,
  }, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`   With releases:    ${withReleases}`);
  console.log(`   No releases:      ${noReleases}`);
}

main().catch(err => {
  console.error("sec-litigation-fetch failed:", err);
  process.exit(1);
});
