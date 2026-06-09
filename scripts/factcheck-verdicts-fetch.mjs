#!/usr/bin/env node
/**
 * Fact-check verdict collector.
 *
 * Pulls RSS feeds from major non-partisan fact-checkers and extracts
 * verdicts that target corporate claimants in our top-500 brand list.
 *
 * Feeds:
 *   - PolitiFact     (https://www.politifact.com/rss/factchecks/)
 *   - Snopes         (https://www.snopes.com/feed/)
 *   - FactCheck.org  (https://www.factcheck.org/feed/)
 *
 * Verdict mapping (informs sc enum and severity):
 *   PolitiFact: "True", "Mostly True", "Half True", "Mostly False", "False", "Pants on Fire"
 *   Snopes:     "True", "Mostly True", "Mixture", "Mostly False", "False", "Labeled Satire", "Misattributed"
 *   FactCheck:  free text (no formal scale) — we infer from headline keywords
 *
 * For each verdict we try to identify the claimant. PolitiFact prefixes
 * the claimant in the RSS title: "Donald Trump - Trump said..." — we
 * split on " - " and use the first half. Snopes embeds a category tag.
 * If the claimant is one of our top-500 brands, the verdict lands in
 * the transparency category.
 *
 * Output: data/derived/factcheck-verdicts-augment.json keyed by slug.
 *   {
 *     "facebook": {
 *       verdicts: [ { source, claim, rating, url, pub_date, severity } ],
 *       summary: { trueCount, falseCount, sc, narrative }
 *     }
 *   }
 *
 * Locally:
 *   node scripts/factcheck-verdicts-fetch.mjs
 *   node scripts/factcheck-verdicts-fetch.mjs --smoke
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchBrands, resolveSlug } from "./lib/news-brand-match.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/factcheck-verdicts");
const OUT_FILE = path.join(ROOT, "data/derived/factcheck-verdicts-augment.json");
const UA = "TruNorth-FactCheck/1.0 (+https://www.trunorthapp.com)";
const SMOKE = process.argv.includes("--smoke");

const FEEDS = [
  // PolitiFact has multiple pages on its main RSS (last ~50 items)
  // but also category-specific feeds. The main feed plus the
  // "statements" archive is enough; deeper history requires paginated
  // HTML scraping which we skip for now.
  { id: "politifact",  label: "PolitiFact",   url: "https://www.politifact.com/rss/factchecks/" },
  { id: "snopes",      label: "Snopes",       url: "https://www.snopes.com/feed/" },
  { id: "factcheck",   label: "FactCheck.org", url: "https://www.factcheck.org/feed/" },
];

const HORIZON_DAYS = 365; // fact-check verdicts age slower; 1yr horizon
const CUTOFF_MS = Date.now() - HORIZON_DAYS * 24 * 60 * 60 * 1000;

// ─── Verdict scoring ─────────────────────────────────────────────────────
// Returns { rating, severity, weight } where severity ∈ {positive,negative,neutral}
// and weight is a 0..1 indicator of how decisive the verdict is.
function classifyVerdict(text) {
  const t = text.toLowerCase();
  if (/pants on fire/.test(t))                return { rating: "Pants on Fire", severity: "negative", weight: 1.00 };
  if (/(?:^|\W)false(?:\W|$)|fake|fabricated|hoax|debunk/.test(t))
                                                return { rating: "False",         severity: "negative", weight: 0.85 };
  if (/mostly false|mainly false|miscaptioned|mislabel/.test(t))
                                                return { rating: "Mostly False",  severity: "negative", weight: 0.65 };
  if (/mixture|half true|partly|partially false/.test(t))
                                                return { rating: "Mixed",         severity: "neutral",  weight: 0.20 };
  if (/mostly true|mainly true/.test(t))      return { rating: "Mostly True",   severity: "positive", weight: 0.60 };
  if (/(?:^|\W)true(?:\W|$)/.test(t))         return { rating: "True",          severity: "positive", weight: 0.80 };
  if (/satire|labeled satire/.test(t))        return null; // skip satire
  if (/no evidence|unsupported|misleading|missing context/.test(t))
                                                return { rating: "Misleading",    severity: "negative", weight: 0.50 };
  return null;
}

// ─── RSS parser (with category support for Snopes) ───────────────────────
function decode(s) {
  if (!s) return "";
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&#8217;|&#8216;|&#8242;/g, "'")
    .replace(/&#8220;|&#8221;/g, "\"")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

function parseRss(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
      const x = r.exec(block);
      return x ? x[1].trim() : null;
    };
    // <category> can repeat — collect all.
    const categories = [];
    const catRe = /<category[^>]*>([\s\S]*?)<\/category>/g;
    let cm;
    while ((cm = catRe.exec(block)) !== null) {
      const c = decode(cm[1]);
      if (c) categories.push(c);
    }
    items.push({
      title:       decode(get("title")),
      link:        decode(get("link")),
      pubDate:     decode(get("pubDate") || get("dc:date")),
      description: decode(get("description") || get("content:encoded") || ""),
      categories,
    });
  }
  return items;
}

function withinHorizon(s) {
  if (!s) return true;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return true;
  return t >= CUTOFF_MS;
}

// PolitiFact RSS titles are formatted: "Claimant - Claim. Verdict!"
// We split on first " - " and try to identify the claimant as a brand.
function parsePolitiFactTitle(title) {
  const m = /^([^-]+?)\s*-\s*(.+)$/.exec(title);
  if (!m) return { claimant: null, body: title };
  return { claimant: m[1].trim(), body: m[2].trim() };
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, */*" } });
    if (!res.ok) {
      console.warn(`[${feed.id}] HTTP ${res.status}`);
      return [];
    }
    return parseRss(await res.text());
  } catch (err) {
    console.warn(`[${feed.id}] fetch error: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log("🔍 Fact-check verdict fetch starting...");
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });

  const feeds = SMOKE ? FEEDS.slice(0, 1) : FEEDS;
  const rawAll = {};
  for (const feed of feeds) {
    console.log(`  📡 ${feed.label}...`);
    rawAll[feed.id] = await fetchFeed(feed);
    console.log(`     ${rawAll[feed.id].length} items`);
  }

  await fs.writeFile(path.join(RAW_DIR, `${new Date().toISOString().slice(0,10)}.json`),
    JSON.stringify({ fetched_at: new Date().toISOString(), feeds: rawAll }));

  const perBrand = {};
  let matched = 0, skippedDate = 0, skippedNoVerdict = 0, skippedNoBrand = 0;

  for (const feed of feeds) {
    for (const it of rawAll[feed.id]) {
      if (!it.title) continue;
      if (!withinHorizon(it.pubDate)) { skippedDate++; continue; }

      const fullText = `${it.title}. ${it.description || ""}`.slice(0, 4000);
      const verdict = classifyVerdict(it.title) || classifyVerdict(fullText);
      if (!verdict) { skippedNoVerdict++; continue; }

      let slugs = [];
      let claim = it.title;
      let claimant = null;

      if (feed.id === "politifact") {
        const parsed = parsePolitiFactTitle(it.title);
        claimant = parsed.claimant;
        claim = parsed.body;
        // Try claimant first (most direct), then full body.
        if (claimant) {
          const r = await resolveSlug(claimant);
          if (r) slugs.push(r);
        }
        if (slugs.length === 0) slugs = await matchBrands(fullText);
      } else if (feed.id === "snopes") {
        // Snopes <category> tags often include brand names (Costco,
        // McDonald's, etc.) — these are the cleanest signal.
        for (const c of it.categories || []) {
          const r = await resolveSlug(c);
          if (r) slugs.push(r);
        }
        if (slugs.length === 0) slugs = await matchBrands(fullText);
      } else {
        slugs = await matchBrands(fullText);
      }

      slugs = [...new Set(slugs)];
      if (slugs.length === 0) { skippedNoBrand++; continue; }

      matched++;
      for (const slug of slugs) {
        if (!perBrand[slug]) perBrand[slug] = [];
        perBrand[slug].push({
          source:    feed.id,
          sourceLabel: feed.label,
          claimant:  claimant || null,
          claim:     claim.slice(0, 280),
          rating:    verdict.rating,
          severity:  verdict.severity,
          weight:    verdict.weight,
          url:       it.link,
          pub_date:  it.pubDate || null,
        });
      }
    }
  }

  // ─── Aggregate per brand ───────────────────────────────────────────────
  const out = {};
  for (const [slug, items] of Object.entries(perBrand)) {
    items.sort((a, b) => (Date.parse(b.pub_date) || 0) - (Date.parse(a.pub_date) || 0));
    let trueCount = 0, falseCount = 0, mixedCount = 0;
    for (const v of items) {
      if (v.severity === "positive") trueCount++;
      else if (v.severity === "negative") falseCount++;
      else mixedCount++;
    }
    // sc: predominantly false → "poor", predominantly true → "positive",
    // mixed or single neutral → "mixed".
    let sc = "mixed";
    if (falseCount > trueCount * 2)      sc = "poor";
    else if (trueCount > falseCount * 2) sc = "positive";

    const severity = falseCount > trueCount ? "negative" : trueCount > falseCount ? "positive" : "neutral";
    const sources  = [...new Set(items.map(i => i.sourceLabel))];
    const recent   = items[0];
    const narrative = falseCount > 0
      ? `Fact-checkers rated ${falseCount} corporate-related claim(s) as False/Misleading and ${trueCount} as True (${sources.join(", ")}). Most recent: "${recent.claim.slice(0, 120)}" — rated ${recent.rating}.`
      : `${sources.join(", ")} verified ${trueCount} claim(s) related to this company as accurate. Most recent: "${recent.claim.slice(0, 120)}".`;

    out[slug] = {
      verdicts: items.slice(0, 20),
      summary: { trueCount, falseCount, mixedCount, sc, severity, narrative, sources },
    };
  }

  // Verdict distribution.
  const verdictDist = {};
  for (const list of Object.values(perBrand)) for (const v of list) {
    verdictDist[v.rating] = (verdictDist[v.rating] || 0) + 1;
  }

  const payload = {
    _meta: {
      generated_at: new Date().toISOString(),
      horizon_days: HORIZON_DAYS,
      feeds: feeds.map(f => f.id),
      counts: {
        items_fetched:       Object.values(rawAll).reduce((a, x) => a + x.length, 0),
        items_matched:       matched,
        skipped_date:        skippedDate,
        skipped_no_verdict:  skippedNoVerdict,
        skipped_no_brand:    skippedNoBrand,
        brands_with_signal:  Object.keys(out).length,
      },
      verdict_distribution: verdictDist,
    },
    ...out,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   Brands with verdicts: ${Object.keys(out).length}`);
  console.log(`   Verdicts matched:     ${matched}`);
  console.log(`   Verdict distribution: ${JSON.stringify(verdictDist)}`);

  const top = Object.entries(out)
    .map(([s, d]) => [s, d.verdicts.length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  console.log("   Top brands:");
  for (const [s, n] of top) console.log(`     ${s.padEnd(28)} ${n}`);
}

main().catch(err => {
  console.error("❌ factcheck-verdicts-fetch failed:", err);
  process.exit(1);
});
