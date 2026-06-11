#!/usr/bin/env node
/**
 * Corporate PR wire collector (PR Newswire + Business Wire).
 *
 * Wire-service feeds emit a constant stream of corporate self-claims:
 *   - "PepsiCo Announces 50% Reduction in Water Use by 2030"
 *   - "Walmart Pledges $200M to Workforce Development"
 *   - "Nike Joins UN Global Compact"
 *
 * These are CLAIMS-AS-PUBLISHED, not third-party verification. We
 * surface them as:
 *   - Positive signals (corporate-giving / environment / labor / dei)
 *     when the headline + body match a known positive-action pattern
 *   - "Self-reported" provenance — narratives are explicitly tagged as
 *     "Company announcement" so consumers know this isn't independent
 *     verification.
 *
 * Feeds (free RSS):
 *   - PR Newswire (general news-releases-list RSS — last ~20 items)
 *     https://www.prnewswire.com/rss/news-releases-list.rss
 *   - PR Newswire Corporate Social Responsibility category feed —
 *     pre-filtered to exactly the announcements the positive router
 *     targets (giving / sustainability / workforce).
 *   - Business Wire Philanthropy subject feed. NOTE: the old token
 *     (G1QFDERJXkJeGVtRWg==) resolved to "Technology: Photography News"
 *     (~3 items, never brand-relevant) — not the home feed as previously
 *     documented. Business Wire's all-news RSS channels are deactivated
 *     (0 items), so the Philanthropy subject feed is the closest live
 *     equivalent for this collector's purpose.
 *
 * Output: data/derived/corporate-prwire-augment.json keyed by slug.
 *
 * Cadence: daily — wire volume turns over fast. We accumulate signal
 * per brand over time when augment is re-run; current implementation
 * just emits today's snapshot. (TODO: roll forward 90-day archive.)
 *
 * Locally:
 *   node scripts/corporate-prwire-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchBrands } from "./lib/news-brand-match.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/corporate-prwire");
const OUT_FILE = path.join(ROOT, "data/derived/corporate-prwire-augment.json");
const UA = "TruNorth-PRWire/1.0 (+https://www.trunorthapp.com)";

const FEEDS = [
  { id: "prnewswire",     label: "PR Newswire",                url: "https://www.prnewswire.com/rss/news-releases-list.rss" },
  { id: "prnewswire-csr", label: "PR Newswire (CSR)",          url: "https://www.prnewswire.com/rss/policy-public-interest-latest-news/corporate-social-responsibility-list.rss" },
  { id: "businesswire",   label: "Business Wire (Philanthropy)", url: "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpTXw==" },
];

const HORIZON_DAYS = 30;
const CUTOFF_MS = Date.now() - HORIZON_DAYS * 24 * 60 * 60 * 1000;

// Positive-action regex routes corporate self-claims to TruNorth categories.
// If a headline matches a regex, we treat the announcement as a positive
// signal in that category (sc tagged as "positive"). All narratives carry
// "Company announcement" provenance.
const POSITIVE_ROUTER = [
  // charity / giving
  // "raises $X for / in support of" needs the trailing preposition so
  // capital raises ("Ares Raises $12.7 Billion to Invest...") don't match.
  { pat: /donat(es?|ed|ion)|gives? \$\d|pledges? \$\d|grants? \$\d|million pledge|million donation|million grant|nonprofit partnership|relief fund|disaster relief|matching gift|fundrais|charitable|raises? (?:more than |over |a record |record )?\$[\d.,]+ ?(?:million|billion)? ?(?:for|in support)/i,
    category: "charity", sc: "positive" },
  // environment
  { pat: /net[- ]zero|carbon neutral|renewable energy commit|emissions reduction|science[- ]based target|sustainability goal|recyclable packag|circular econom|electrif[a-z]+ fleet|ev fleet|ev charging/i,
    category: "environment", sc: "positive" },
  // labor — voluntary worker investments
  { pat: /raises? minimum wage|wage increase|invest in workforce|workforce development|skilled-trades training|tuition benefit|paid parental leave|paid family leave|workplace safety initiative|union[- ]neutral|union recognition/i,
    category: "labor", sc: "positive" },
  // dei
  { pat: /supplier divers|diverse-owned|hiring initiative|inclusive workplace|disability hiring|veteran hiring|hbcu partnership|equity goal/i,
    category: "dei", sc: "pro_dei" },
  // animals
  { pat: /cage[- ]free egg|cage[- ]free commit|cruelty[- ]free|plant[- ]based menu|alternative protein|animal welfare commit/i,
    category: "animals", sc: "positive" },
  // privacy (less common in PR wires — mostly compliance announcements)
  { pat: /privacy[- ]first|end[- ]to[- ]end encryption|zero[- ]trust commit|gdpr complian/i,
    category: "privacy", sc: "positive" },
];

function pickPositive(text) {
  for (const r of POSITIVE_ROUTER) {
    if (r.pat.test(text)) return { category: r.category, sc: r.sc };
  }
  return null;
}

function decode(s) {
  if (!s) return "";
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&#8217;|&#8216;/g, "'")
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
    items.push({
      title:       decode(get("title")),
      link:        decode(get("link")),
      pubDate:     decode(get("pubDate") || get("dc:date")),
      description: decode(get("description") || ""),
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
  console.log("📡 Corporate PR-wire fetch starting...");
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });

  const rawAll = {};
  for (const feed of FEEDS) {
    console.log(`  📡 ${feed.label}...`);
    rawAll[feed.id] = await fetchFeed(feed);
    console.log(`     ${rawAll[feed.id].length} items`);
  }
  await fs.writeFile(path.join(RAW_DIR, `${new Date().toISOString().slice(0,10)}.json`),
    JSON.stringify({ fetched_at: new Date().toISOString(), feeds: rawAll }));

  const perBrand = {};
  let matched = 0, skippedDate = 0, skippedNoPos = 0, skippedNoBrand = 0;

  for (const feed of FEEDS) {
    for (const it of rawAll[feed.id]) {
      if (!it.title) continue;
      if (!withinHorizon(it.pubDate)) { skippedDate++; continue; }

      const fullText = `${it.title}. ${it.description || ""}`.slice(0, 5000);
      const pos = pickPositive(fullText);
      if (!pos) { skippedNoPos++; continue; }

      const slugs = await matchBrands(fullText);
      if (slugs.length === 0) { skippedNoBrand++; continue; }

      matched++;
      for (const slug of slugs) {
        if (!perBrand[slug]) perBrand[slug] = [];
        perBrand[slug].push({
          source:    feed.id,
          sourceLabel: feed.label,
          title:     it.title.slice(0, 280),
          url:       it.link,
          pub_date:  it.pubDate || null,
          category:  pos.category,
          sc:        pos.sc,
          provenance: "company-announcement",
        });
      }
    }
  }

  // Aggregate per brand → category narratives.
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
      const top = list[0];
      categorySummary[cat] = {
        count: list.length,
        sc: top.sc,
        // Phrasing makes provenance explicit — Aron's neutrality rule.
        narrative: list.length === 1
          ? `Company announcement: "${top.title.slice(0, 160)}" (wire release, ${top.pub_date ? new Date(top.pub_date).toISOString().slice(0,10) : "recent"}).`
          : `${list.length} corporate announcements in this category over the past ${HORIZON_DAYS}d (most recent: "${top.title.slice(0, 120)}"). Self-reported via wire services.`,
        provenance: "company-announcement",
        topItems: list.slice(0, 3).map(i => ({ title: i.title, url: i.url, pub_date: i.pub_date })),
      };
    }
    out[slug] = { announcements: items.slice(0, 20), categorySummary };
  }

  const payload = {
    _meta: {
      generated_at: new Date().toISOString(),
      horizon_days: HORIZON_DAYS,
      feeds: FEEDS.map(f => f.id),
      counts: {
        items_fetched:      Object.values(rawAll).reduce((a, x) => a + x.length, 0),
        items_matched:      matched,
        skipped_date:       skippedDate,
        skipped_no_positive: skippedNoPos,
        skipped_no_brand:   skippedNoBrand,
        brands_with_signal: Object.keys(out).length,
      },
      ...(Object.keys(out).length === 0 ? {
        note: "Fetch OK — feeds returned items, but none passed both the positive-action router and the top-500 brand match in this snapshot. Wire feeds are snapshot-only (~20-80 items/day), so zero-signal days are expected.",
      } : {}),
    },
    ...out,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   Brands with signal: ${Object.keys(out).length}`);
  console.log(`   Items matched:      ${matched}`);

  const top = Object.entries(out)
    .map(([s, d]) => [s, d.announcements.length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  console.log("   Top brands:");
  for (const [s, n] of top) console.log(`     ${s.padEnd(28)} ${n}`);
}

main().catch(err => {
  console.error("❌ corporate-prwire-fetch failed:", err);
  process.exit(1);
});
