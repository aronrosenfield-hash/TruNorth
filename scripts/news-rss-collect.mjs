#!/usr/bin/env node
/**
 * Option A — Google News RSS nightly collector
 *
 * Pulls Google News RSS for each brand in /public/data/top-500-brands.txt,
 * filters to high-signal items (lawsuit, fine, donation, violation, etc.),
 * applies bias safeguards, and writes a per-day digest to
 * /public/data/news/YYYY-MM-DD.json.
 *
 * Bias safeguards:
 * 1. Outlet whitelist for "facts" — only Reuters / AP / Bloomberg / BBC /
 *    NPR / WSJ / NYT / ProPublica / Politico count as fact-driving sources
 * 2. Source diversity — single-source signals get confidence=low; require
 *    multiple outlets for confidence=high
 * 3. Annotated with AllSides bias rating per outlet
 * 4. Facts not opinions — schema forces verifiable claims
 *
 * Runs via .github/workflows/news-rss-nightly.yml at 04:00 UTC daily.
 * Locally: node scripts/news-rss-collect.mjs
 *
 * No paid API calls — Google News RSS is free.
 * The AI extraction step (news-rss-extract.mjs) runs separately and uses
 * Anthropic API. Splitting them lets us cache RSS pulls cheaply and only
 * pay for AI when items genuinely look high-signal.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_DIR = path.join(ROOT, "public/data/news");

// AllSides bias ratings — used to annotate every article we pull so the
// AI extraction layer can apply diversity requirements.
const OUTLET_BIAS = {
  // CENTER — fact-driving outlets
  "reuters.com":          { bias: "center", weight: 1.0, fact_driver: true },
  "apnews.com":           { bias: "center", weight: 1.0, fact_driver: true },
  "bloomberg.com":        { bias: "center", weight: 1.0, fact_driver: true },
  "bbc.com":              { bias: "center", weight: 1.0, fact_driver: true },
  "bbc.co.uk":            { bias: "center", weight: 1.0, fact_driver: true },
  "npr.org":              { bias: "center", weight: 0.9, fact_driver: true },
  "axios.com":            { bias: "center", weight: 0.9, fact_driver: true },
  "csmonitor.com":        { bias: "center", weight: 0.9, fact_driver: true },
  "marketwatch.com":      { bias: "center", weight: 0.85, fact_driver: true },
  "cnbc.com":             { bias: "center", weight: 0.8, fact_driver: true },

  // LEAN LEFT — fact-driving when news, not opinion
  "nytimes.com":          { bias: "lean-left", weight: 0.9, fact_driver: true },
  "washingtonpost.com":   { bias: "lean-left", weight: 0.9, fact_driver: true },
  "theguardian.com":      { bias: "lean-left", weight: 0.85, fact_driver: true },
  "propublica.org":       { bias: "lean-left", weight: 0.95, fact_driver: true },
  "politico.com":         { bias: "lean-left", weight: 0.85, fact_driver: true },
  "theatlantic.com":      { bias: "lean-left", weight: 0.7, fact_driver: false },
  "newyorker.com":        { bias: "lean-left", weight: 0.7, fact_driver: false },

  // LEAN RIGHT — fact-driving when news, not opinion
  "wsj.com":              { bias: "lean-right", weight: 0.9, fact_driver: true },
  "forbes.com":           { bias: "lean-right", weight: 0.8, fact_driver: true },
  "ft.com":               { bias: "lean-right", weight: 0.85, fact_driver: true },
  "businessinsider.com":  { bias: "center", weight: 0.7, fact_driver: false },
  "fortune.com":          { bias: "center", weight: 0.8, fact_driver: true },
  "barrons.com":          { bias: "lean-right", weight: 0.85, fact_driver: true },

  // LEFT — opinion-heavy, monitor only
  "huffpost.com":         { bias: "left", weight: 0.4, fact_driver: false },
  "msnbc.com":            { bias: "left", weight: 0.4, fact_driver: false },
  "vox.com":              { bias: "left", weight: 0.5, fact_driver: false },
  "salon.com":            { bias: "left", weight: 0.3, fact_driver: false },
  "motherjones.com":      { bias: "left", weight: 0.7, fact_driver: true },

  // RIGHT — opinion-heavy, monitor only
  "foxnews.com":          { bias: "right", weight: 0.4, fact_driver: false },
  "nypost.com":           { bias: "right", weight: 0.5, fact_driver: false },
  "dailycaller.com":      { bias: "right", weight: 0.3, fact_driver: false },
  "breitbart.com":        { bias: "right", weight: 0.2, fact_driver: false },
  "nationalreview.com":   { bias: "right", weight: 0.6, fact_driver: false },
  "washingtontimes.com":  { bias: "right", weight: 0.5, fact_driver: false },

  // Trade press — usually fact-heavy but topic-specific
  "trec.com":             { bias: "center", weight: 0.7, fact_driver: true },
  "retaildive.com":       { bias: "center", weight: 0.85, fact_driver: true },
  "modernretail.co":      { bias: "center", weight: 0.85, fact_driver: true },
  "techcrunch.com":       { bias: "center", weight: 0.8, fact_driver: true },
  "theverge.com":         { bias: "lean-left", weight: 0.8, fact_driver: true },
  "wired.com":            { bias: "lean-left", weight: 0.75, fact_driver: true },
  "arstechnica.com":      { bias: "center", weight: 0.85, fact_driver: true },
  "esgtoday.com":         { bias: "center", weight: 0.85, fact_driver: true },
};

// High-signal keywords — only articles matching these are sent for AI extraction.
// Saves $$$ vs running the LLM on every press release.
const SIGNAL_KEYWORDS = [
  // Legal
  "lawsuit", "sued", "settlement", "verdict", "court", "fine",
  // Regulatory
  "fec", "osha", "epa", "nlrb", "sec investigation", "doj", "ftc",
  // Labor
  "layoff", "layoffs", "union", "strike", "walkout", "fired", "wage theft",
  // Environmental
  "emissions", "violation", "spill", "pollution", "carbon", "climate",
  // Political donations
  "donation", "donated", "pac", "lobbying", "contribution",
  // DEI / governance
  "diversity", "discrimination", "harassment", "audit", "investigation",
  // Recall / safety
  "recall", "recalled", "defect", "safety",
  // Privacy
  "breach", "leak", "hacked", "data exposed", "ftc consent",
];

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch { return null; }
}

function isHighSignal(title, description) {
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  return SIGNAL_KEYWORDS.some(kw => text.includes(kw));
}

function parseRssItems(xml) {
  // Lightweight RSS parser — Google News RSS is well-formed enough
  // that a regex-based parse works fine. No dep needed.
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
      const x = re.exec(block);
      return x ? x[1].replace(/<!\[CDATA\[(.*?)\]\]>/s, "$1").trim() : null;
    };
    items.push({
      title:       get("title"),
      link:        get("link"),
      pubDate:     get("pubDate"),
      description: get("description"),
      source:      get("source"),
    });
  }
  return items;
}

async function fetchBrandNews(brand) {
  // Google News RSS — search-specific
  // "when:30d" limits to last 30 days
  const q = encodeURIComponent(brand.name);
  const url = `https://news.google.com/rss/search?q=${q}+when:30d&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TruNorth-RSS-Collector/1.0 (+https://www.trunorthapp.com)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRssItems(xml);
    return items.map(it => {
      const domain = extractDomain(it.link);
      const meta = OUTLET_BIAS[domain] || { bias: "unknown", weight: 0.3, fact_driver: false };
      return {
        brand_slug: brand.slug,
        brand_name: brand.name,
        title:      it.title,
        url:        it.link,
        domain,
        pub_date:   it.pubDate,
        source_name: it.source,
        bias:       meta.bias,
        weight:     meta.weight,
        fact_driver: meta.fact_driver,
        high_signal: isHighSignal(it.title, it.description),
      };
    });
  } catch (err) {
    console.warn(`[news-rss] ${brand.slug} failed:`, err.message);
    return [];
  }
}

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

async function main() {
  console.log("📰 News RSS collector starting...");
  const brands = await loadBrands();
  console.log(`📋 Loaded ${brands.length} brands`);

  // Throttle: 10 brands at a time, 1.5s between batches (Google News tolerates this)
  const BATCH = 10;
  const all = [];
  for (let i = 0; i < brands.length; i += BATCH) {
    const slice = brands.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(fetchBrandNews));
    all.push(...results.flat());
    if (i + BATCH < brands.length) await new Promise(r => setTimeout(r, 1500));
    if (i % 100 === 0) console.log(`  …${i}/${brands.length}`);
  }

  // Dedupe by URL
  const seen = new Set();
  const deduped = all.filter(item => {
    if (!item.url) return false;
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  // Split into high-signal (to be sent to AI extraction) vs monitoring (logged only)
  const highSignal  = deduped.filter(d => d.high_signal && d.fact_driver);
  const monitoring  = deduped.filter(d => !d.high_signal || !d.fact_driver);

  const today = new Date().toISOString().slice(0, 10);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${today}.json`);
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:   new Date().toISOString(),
    brand_count:    brands.length,
    total_items:    deduped.length,
    high_signal:    highSignal.length,
    monitoring:     monitoring.length,
    items_for_ai:   highSignal.slice(0, 200),   // cap AI batch to top 200 for cost
    monitoring_log: monitoring.slice(0, 1000),
  }, null, 2));

  console.log(`✅ Wrote ${outPath}`);
  console.log(`   Total: ${deduped.length} unique articles`);
  console.log(`   High-signal (for AI): ${highSignal.length}`);
  console.log(`   Monitoring only: ${monitoring.length}`);
}

main().catch(err => {
  console.error("❌ news-rss-collect failed:", err);
  process.exit(1);
});
