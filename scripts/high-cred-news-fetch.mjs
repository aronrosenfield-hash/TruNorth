#!/usr/bin/env node
/**
 * High-credibility investigative news collector.
 *
 * Pulls RSS feeds from a handful of Pulitzer-grade / nonprofit investigative
 * outlets that we want as a permanent supplement to the Google News pipeline:
 *
 *   - ProPublica           (https://www.propublica.org/feeds/propublica/main)
 *   - The Markup           (https://themarkup.org/feeds/rss.xml)
 *   - Reveal / CIR         (https://revealnews.org/feed/)
 *   - Lead Stories         (https://leadstories.com/atom.xml)
 *
 * NOT INCLUDED (verified unreachable / Cloudflare-locked at the time of
 * authoring — keep them in this list as a TODO if access changes):
 *   - AP News (apnews.com)  — 401 Cloudflare bot challenge on RSS endpoint.
 *     Google News RSS already surfaces AP-bylined content with full bias
 *     weight via the AllSides map, so the gap is small.
 *   - OCCRP (occrp.org)     — 403 Cloudflare on /en/feed.
 *
 * For each item we:
 *   1. Parse the feed (RSS or Atom).
 *   2. Run title+description+content through matchBrands() (shared helper
 *      that uses /public/data/_meta/{slug-aliases,brand-parent-map}.json).
 *   3. Bucket each matched brand to the most appropriate TruNorth category
 *      from a regex-keyword router (labor / environment / privacy / etc.).
 *
 * Aggregated output: data/derived/high-cred-news-augment.json keyed by slug.
 *   {
 *     "walmart": {
 *       investigations: [
 *         { source, title, url, pub_date, category, sc }
 *       ],
 *       categorySummary: {
 *         labor: { count, sc: "poor", narrative: "..." },
 *         ...
 *       }
 *     },
 *     ...
 *   }
 *
 * Designed to run weekly. Locally:
 *   node scripts/high-cred-news-fetch.mjs
 *   node scripts/high-cred-news-fetch.mjs --smoke    # one feed only
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchBrands } from "./lib/news-brand-match.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/high-cred-news");
const OUT_FILE = path.join(ROOT, "data/derived/high-cred-news-augment.json");
const UA = "TruNorth-HighCredNews/1.0 (+https://www.trunorthapp.com)";
const SMOKE = process.argv.includes("--smoke");

const FEEDS = [
  // [id, label, url, paginationFn(page) | null, maxPages]
  { id: "propublica",   label: "ProPublica",
    url: "https://www.propublica.org/feeds/propublica/main",
    paginate: (p) => `https://www.propublica.org/feeds/propublica/main/page/${p}`,
    maxPages: 10 },
  { id: "the-markup",   label: "The Markup",
    url: "https://themarkup.org/feeds/rss.xml",
    paginate: null, maxPages: 1 },
  { id: "reveal",       label: "Reveal / CIR",
    url: "https://revealnews.org/feed/",
    paginate: (p) => `https://revealnews.org/feed/?paged=${p}`,
    maxPages: 5 },
  { id: "lead-stories", label: "Lead Stories",
    url: "https://leadstories.com/atom.xml",
    paginate: null, maxPages: 1 },
];

const HORIZON_DAYS = 180;
const CUTOFF_MS = Date.now() - HORIZON_DAYS * 24 * 60 * 60 * 1000;

// ─── Category routing ────────────────────────────────────────────────────
// Maps regex keywords found in title+description to a TruNorth category +
// sc enum + severity. First match wins. Order matters — more specific
// patterns first.
const ROUTER = [
  // labor — investigative reports are typically negative
  { pat: /wage theft|stolen wages|unpaid wages|overtime violation|child labor|sweatshop|forced labor|trafficking|union[- ]busting|worker abuse|warehouse injur|workplace deaths/i,
    category: "labor", sc: "poor", severity: "negative" },
  // dei — discrimination, harassment investigations
  { pat: /racial discrimination|gender discrimination|sexual harass|hostile workplace|civil rights violation|disparate impact|pregnancy discrim/i,
    category: "dei", sc: "anti_dei", severity: "negative" },
  // environment
  { pat: /pollut|emissions violation|toxic spill|illegal dumping|hazardous waste|drinking water contam|forever chemical|pfas contam|coal ash|methane leak|deforest|greenwash|environmental violation|epa fine|carbon fraud/i,
    category: "environment", sc: "poor", severity: "negative" },
  // animals
  { pat: /animal cruelty|factory farm abuse|slaughterhouse abuse|cage[- ]free violat|live[- ]animal trade|animal welfare violat/i,
    category: "animals", sc: "poor", severity: "negative" },
  // privacy
  { pat: /data breach|data leak|personal data|tracking pixel|surveillance pricing|surveillance ads|location tracking|sold customer|sold user data|biometric collection|facial recognition abuse|privacy violation|ftc consent decree|gdpr fine/i,
    category: "privacy", sc: "poor", severity: "negative" },
  // health (drug-trial / safety / consumer protection)
  { pat: /opioid|fake drug|adulterated|contaminated food|salmonella|listeria|fda warning letter|clinical trial fraud|misleading drug ad|defective device/i,
    category: "health", sc: "poor", severity: "negative" },
  // political (corporate influence, lobbying scandals)
  { pat: /dark money|secret lobbying|paid lobbyist|influence peddling|campaign finance violat|bribery|kickback|corrupt practices/i,
    category: "political", sc: "bipartisan", severity: "negative" },
  // governance / transparency catch-all
  { pat: /accounting fraud|sec fraud|securities fraud|insider trading|misled investors|earnings manipulation|ponzi|shell compan|tax dodging|tax shelter|offshore haven/i,
    category: "transparency", sc: "poor", severity: "negative" },
  // charity (positive)
  { pat: /donated \$\d|pledged \$\d|gift of \$\d|nonprofit partnership|disaster relief commitment|major donation/i,
    category: "charity", sc: "positive", severity: "positive" },
];

function pickCategory(text) {
  for (const r of ROUTER) {
    if (r.pat.test(text)) return { category: r.category, sc: r.sc, severity: r.severity };
  }
  // Fallback router for less-specific business stories. We want to still
  // capture a brand mention with a general investigative tone even if the
  // story doesn't trip one of the specific category regexes above.
  if (/lawsuit|sued|settl(ed|ement)|fine|federal charge|indicted|fraud|misled|violation|investigation|probe|whistleblower|class action/i.test(text)) {
    return { category: "transparency", sc: "poor", severity: "negative" };
  }
  return null;
}

// ─── RSS / Atom parser ───────────────────────────────────────────────────
function decodeXmlText(s) {
  if (!s) return "";
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, "\"")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeed(xml) {
  const items = [];
  // RSS <item>
  const rssRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rssRegex.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
      const x = re.exec(block);
      return x ? x[1].trim() : null;
    };
    items.push({
      title:       decodeXmlText(get("title")),
      link:        decodeXmlText(get("link")),
      pubDate:     decodeXmlText(get("pubDate") || get("dc:date")),
      description: decodeXmlText(get("description") || get("content:encoded") || ""),
    });
  }
  if (items.length > 0) return items;

  // Atom <entry>
  const atomRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
  while ((m = atomRegex.exec(xml)) !== null) {
    const block = m[1];
    const titleM = /<title[^>]*>([\s\S]*?)<\/title>/.exec(block);
    const linkM  = /<link[^>]*href="([^"]+)"/.exec(block);
    const dateM  = /<(?:published|updated)>([\s\S]*?)<\/(?:published|updated)>/.exec(block);
    const sumM   = /<(?:summary|content)[^>]*>([\s\S]*?)<\/(?:summary|content)>/.exec(block);
    items.push({
      title:       decodeXmlText(titleM ? titleM[1] : ""),
      link:        linkM ? linkM[1] : null,
      pubDate:     dateM ? dateM[1].trim() : null,
      description: decodeXmlText(sumM ? sumM[1] : ""),
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const all = [];
  const pages = feed.paginate ? feed.maxPages : 1;
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? feed.url : feed.paginate(p);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, */*" } });
      if (!res.ok) {
        if (p === 1) console.warn(`[${feed.id}] HTTP ${res.status} on ${url}`);
        break;
      }
      const xml = await res.text();
      const items = parseFeed(xml);
      if (items.length === 0) break;
      all.push(...items);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.warn(`[${feed.id}] page ${p} error: ${err.message}`);
      break;
    }
  }
  return all;
}

function withinHorizon(pubDateStr) {
  if (!pubDateStr) return true; // be permissive when missing
  const t = Date.parse(pubDateStr);
  if (Number.isNaN(t)) return true;
  return t >= CUTOFF_MS;
}

function summarizeNarrative(category, items) {
  const n = items.length;
  if (n === 0) return null;
  const sample = items[0].title;
  const sources = [...new Set(items.map(i => i.sourceLabel))];
  const sourceStr = sources.length === 1 ? sources[0] : `${sources.slice(0, -1).join(", ")} and ${sources.slice(-1)}`;
  if (n === 1) {
    return `${sourceStr} investigation: "${sample}".`;
  }
  return `${n} investigative reports from ${sourceStr} since ${new Date(CUTOFF_MS).toISOString().slice(0, 10)} (most recent: "${sample}").`;
}

async function main() {
  console.log("📰 High-credibility news fetch starting...");
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });

  const feeds = SMOKE ? FEEDS.slice(0, 1) : FEEDS;

  // Per-source raw items.
  const rawAll = {};
  let totalItems = 0;
  for (const feed of feeds) {
    console.log(`  📡 ${feed.label}...`);
    const items = await fetchFeed(feed);
    rawAll[feed.id] = items;
    totalItems += items.length;
    console.log(`     ${items.length} items`);
  }

  const today = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(RAW_DIR, `${today}.json`), JSON.stringify({
    fetched_at: new Date().toISOString(),
    feeds: rawAll,
  }));

  // ─── Match + bucket ────────────────────────────────────────────────────
  const perBrand = {};
  let matchedItems = 0;
  let skippedDate  = 0;
  let skippedBrand = 0;

  for (const feed of feeds) {
    for (const it of rawAll[feed.id]) {
      if (!it.title) continue;
      if (!withinHorizon(it.pubDate)) { skippedDate++; continue; }

      const text = `${it.title}. ${it.description || ""}`.slice(0, 5000);

      // Brand match FIRST. If a top-500 brand is named in the headline of
      // an investigative outlet article, we want to surface it — the
      // story-as-published is almost certainly about the company. We then
      // try the category router; if no specific bucket matches we fall
      // through to the catch-all "transparency / governance" bucket. This
      // gives investigative coverage a default home even when phrasing
      // doesn't trip a narrow keyword.
      const slugs = await matchBrands(text);
      if (slugs.length === 0) { skippedBrand++; continue; }

      let route = pickCategory(text);
      if (!route) {
        // Brand found but no category matched — bucket as transparency.
        // ProPublica / The Markup / Reveal don't publish puff pieces, so
        // a brand-named story is almost always accountability journalism.
        route = { category: "transparency", sc: "poor", severity: "negative" };
      }

      matchedItems++;
      for (const slug of slugs) {
        if (!perBrand[slug]) perBrand[slug] = [];
        perBrand[slug].push({
          source:    feed.id,
          sourceLabel: feed.label,
          title:     it.title.slice(0, 280),
          url:       it.link,
          pub_date:  it.pubDate || null,
          category:  route.category,
          sc:        route.sc,
          severity:  route.severity,
        });
      }
    }
  }

  // ─── Aggregate per brand → category summaries ─────────────────────────
  const out = {};
  for (const [slug, items] of Object.entries(perBrand)) {
    items.sort((a, b) => (Date.parse(b.pub_date) || 0) - (Date.parse(a.pub_date) || 0));
    const byCategory = {};
    for (const it of items) {
      if (!byCategory[it.category]) byCategory[it.category] = [];
      byCategory[it.category].push(it);
    }
    const categorySummary = {};
    for (const [cat, list] of Object.entries(byCategory)) {
      const sources = [...new Set(list.map(i => i.sourceLabel))];
      const narrative = summarizeNarrative(cat, list);
      // sc = strongest (negative wins over positive for the same cat).
      const negFirst = list.find(i => i.severity === "negative") || list[0];
      categorySummary[cat] = {
        count:     list.length,
        sc:        negFirst.sc,
        severity:  negFirst.severity,
        narrative,
        sources,
        topItems:  list.slice(0, 3).map(i => ({ source: i.sourceLabel, title: i.title, url: i.url, pub_date: i.pub_date })),
      };
    }
    out[slug] = { investigations: items.slice(0, 20), categorySummary };
  }

  const payload = {
    _meta: {
      generated_at: new Date().toISOString(),
      horizon_days: HORIZON_DAYS,
      feeds: feeds.map(f => f.id),
      counts: {
        total_items_fetched: totalItems,
        items_matched:       matchedItems,
        skipped_date:        skippedDate,
        skipped_no_brand:    skippedBrand,
        brands_with_signal:  Object.keys(out).length,
      },
    },
    ...out,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   Brands with signal: ${Object.keys(out).length}`);
  console.log(`   Items matched:      ${matchedItems} / ${totalItems}`);
  console.log(`   Skipped (date / no-brand): ${skippedDate} / ${skippedBrand}`);

  // Top brands by signal count for spot-check.
  const top = Object.entries(out)
    .map(([slug, d]) => [slug, d.investigations.length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  console.log("   Top brands:");
  for (const [s, n] of top) console.log(`     ${s.padEnd(28)} ${n}`);
}

main().catch(err => {
  console.error("❌ high-cred-news-fetch failed:", err);
  process.exit(1);
});
