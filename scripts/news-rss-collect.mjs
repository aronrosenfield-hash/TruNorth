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

// AllSides bias ratings + outlet weighting.
//
// NEUTRALITY METHODOLOGY (pre-launch audit, 2026-06-08):
// Weights reflect INVESTIGATIVE JOURNALISM QUALITY (Pulitzer wins, fact-check
// accuracy rates, source rigor per NewsGuard + MediaBiasFactCheck.com), NOT
// political lean. Bias label is informational only — used by the AI extraction
// layer to enforce source-diversity requirements per finding.
//
// Tier guide:
//   1.00 — Wire services + central-tier outlets (Reuters, AP, Bloomberg)
//   0.90 — Investigative powerhouses (ProPublica, NYT, WSJ — left, right, center)
//   0.80 — Quality reporting with some opinion overlap (Atlantic, Politico, Forbes)
//   0.70 — Opinion-dominant with quality investigative work (Mother Jones,
//          National Review, Reason — left, right, libertarian)
//   0.50 — Mixed quality (Free Beacon, NY Post, Washington Times)
//   0.30 — Opinion-heavy with weaker fact-check track record (Daily Caller,
//          Salon, Huffpost)
//   0.20 — Sites with documented fabrication issues (Breitbart, etc.)
//
// Both left- AND right-of-center outlets are weighted at each tier. Asymmetry
// would constitute a structural thumb on the scale.
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
  // B-24 (2026-06-06): expanded center/tech/business outlets. These show up
  // frequently in news scrapes for enforcement, security incidents, and recalls
  // — adding them as fact_drivers lets their signal actually move scores.
  "arstechnica.com":      { bias: "center", weight: 0.85, fact_driver: true },
  "techcrunch.com":       { bias: "center", weight: 0.7,  fact_driver: true },
  "bleepingcomputer.com": { bias: "center", weight: 0.9,  fact_driver: true },
  "krebsonsecurity.com":  { bias: "center", weight: 0.95, fact_driver: true },
  "thehill.com":          { bias: "center", weight: 0.8,  fact_driver: true },
  "semafor.com":          { bias: "center", weight: 0.85, fact_driver: true },
  "404media.co":          { bias: "lean-left", weight: 0.8, fact_driver: true },
  "theverge.com":         { bias: "lean-left", weight: 0.75, fact_driver: true },
  "wired.com":            { bias: "lean-left", weight: 0.75, fact_driver: true },

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
  "nationalreview.com":   { bias: "right", weight: 0.7, fact_driver: false },
  "reason.com":           { bias: "lean-right", weight: 0.75, fact_driver: true },
  "freebeacon.com":       { bias: "right", weight: 0.5, fact_driver: false },
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

// ─── B-38 fix (2026-06-06) ─────────────────────────────────────────────────
// Google News RSS does loose substring search. For brand names that are
// also common English words (Mars, Apple, Meta, Target, Prime, Lay's, etc.)
// it returns avalanches of irrelevant hits: "SpaceX IPO filing lays bare
// losses" matched Lay's, "Mars colony plan" matched Mars candy, etc. The
// AI extractor at sonnet-4-6 correctly rejected all 200 such matches as
// "not about the brand" but logged them as failures → final extracted file
// had items: []. Every brand grade has been stale because the pipeline
// produces zero high-signal output.
//
// Fix: validateBrandMatch() filters at collection time. Two-tier:
//   1. Brand-name must literally appear in the TITLE (not just description
//      — Google sometimes promotes items into the feed based on entity
//      matching that doesn't surface the brand text).
//   2. For NEEDS_CONTEXT brands (short common-word names), require a
//      business-context keyword somewhere in title + description.
//
// Tune NEEDS_CONTEXT_BRANDS as we discover more false positives.

const NEEDS_CONTEXT_BRANDS = new Set([
  // Common English-word brand names (high false-positive rate without context)
  "apple", "meta", "mars", "target", "prime", "lays", "lay-s",
  "bang", "gem", "fox", "fox-corporation",
  "circle", "fortune", "century", "carters",
  "eldorado", "ace", "ace-hardware", "true-value",
  // 3-4 letter acronym brands — almost always need disambiguation
  "amd", "hp", "sap", "ati", "kla", "slm", "dac", "ibm", "ge",
  "gm", "ms", "rca", "mks", "iac", "eos", "sos", "dts-inc",
  "nrj", "geo", "apa", "aec", "brp", "bce", "bbc", "edf-inc",
  "hci-group", "cme-group", "skunk-works",
  // Single-word common nouns
  "dove", "tide", "joy", "ivory", "axe", "raid", "fab", "dawn",
  "windex", "pledge", "pinesol", "shout", "tilex", "scrub",
  "honda", "ford", "tesla", // car brands - "ford" especially common verb
  "amazon", // "Amazon rainforest"
  "shell",  // "seashell", "shell of"
  "guess",  // verb
  "kind",   // adj
  "tide",   // noun
  // Brands sharing names with people, places, generic terms
  "james", "rogers", "wilson-sporting-goods",
  "sawyer-s", "huntsman", "graco", "noble", "eagle",
  "hansens", "sierra-nevada", "french-s",
  "kennametal", "moog", "winners", "lloyd-s",
]);

const BUSINESS_CONTEXT_WORDS = [
  // Corporate-identity markers
  "company", "companies", "corp", "corporation", "inc.", "inc ",
  "ltd.", "ltd ", "llc", "holdings", "group",
  // Business-context verbs / nouns
  "ceo", "cfo", "coo", "executive", "founder",
  "earnings", "revenue", "ipo", "stock", "shares", "shareholder",
  "store", "stores", "products", "brand", "consumer", "customers",
  "sales", "profit", "loss", "quarter", "fiscal", "board",
  "merger", "acquisition", "investor", "investors",
  // Plus all SIGNAL_KEYWORDS are valid context (lawsuit, recall, etc.)
];

// Normalize for matching: lowercase + strip ASCII-style apostrophes + accents
// + collapse multiple spaces. "McDonald's" / "Mcdonalds" / "McDonalds" all
// reduce to "mcdonalds"; "Estée Lauder" → "estee lauder".
function normalizeForMatch(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip combining accents
    .replace(/[‘’‚‛'`]/g, "") // strip smart + plain apostrophes
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Per-brand "negative context" — words that strongly suggest the article
// is using the brand name in a non-trademark sense. If ANY of these
// appear in the title, the match is dropped regardless of context.
// Expand as we discover more noise.
const NEGATIVE_CONTEXT = {
  mars:    ["spacex", "planet mars", "mars rover", "mars mission", "mars colony", "mars surface", "mars spacecraft", "perseverance", "curiosity", "musk's mars", "to mars", "nasa", "maven", "isro", "sari", "smiths" /* Smithsonian */, "spins out of control"],
  apple:   ["apple pie", "apple tree", "apple of his", "rotten apple", "candied apple"],
  target:  ["on target", "off target", "target audience", "target practice", "missile target", "easy target"],
  amazon:  ["amazon rainforest", "amazon river", "amazon basin", "amazon jungle", "amazon tribe"],
  shell:   ["seashell", "shell shock", "shell of", "egg shell"],
  prime:   ["prime minister", "prime suspect", "prime time", "prime real estate", "subprime", "primer"],
  meta:    ["meta-analysis", "meta level", "meta description", "meta-physical", "metadata"],
  fox:     ["arctic fox", "red fox", "silver fox", "fox in the"],
  honda:   [], // placeholder; tune as needed
  ford:    ["ford river", "ford a stream", "henry ford ii", "rob ford", "harrison ford", "tom ford"],
  gem:     ["gem stone", "hidden gem"],
  bang:    ["big bang", "bang for the buck"],
  // Verb-form collisions that survive context check via unrelated business words.
  lays:    ["lays bare", "lays out", "lays the groundwork", "lays claim", "lays down", "lays the foundation", "lays the blame"],
  "lay-s": ["lays bare", "lays out", "lays the groundwork", "lays claim", "lays down", "lays the foundation", "lays the blame"],
  tide:    ["tide turns", "tide turning", "high tide", "low tide", "tide of", "rising tide"],
  axe:     ["must axe", "to axe", "axe the", "axe to", "axed the"],
  dawn:    ["at dawn", "dawn of", "dawn raid", "before dawn"],
  joy:     ["joy of", "tears of joy", "pure joy"],
  raid:    ["raid on", "police raid", "fbi raid"],
  pledge:  ["pledge of", "took the pledge"],
  shout:   ["shout out", "shout at"],
};

function brandAppearsInTitle(brand, title) {
  if (!title) return false;
  const t = normalizeForMatch(title);
  const name = normalizeForMatch(brand.name);
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word boundary on the left so "smart" doesn't match "walmart", but the
  // right side allows possessives ("walmart's plans") and plurals.
  return new RegExp(`(?:^|[^a-z0-9])${escaped}`, "i").test(t);
}

function validateBrandMatch(brand, item) {
  if (!brandAppearsInTitle(brand, item.title)) return false;

  const title = normalizeForMatch(item.title);
  const desc  = normalizeForMatch(item.description);
  const text  = `${title} ${desc}`;
  const name  = normalizeForMatch(brand.name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Negative context — strong rejection signals per brand.
  const neg = NEGATIVE_CONTEXT[brand.slug];
  if (neg && neg.some(phrase => text.includes(phrase))) return false;

  // For common-word brands, require either:
  //   (a) brand starts the title (high confidence it's the subject), OR
  //   (b) brand is followed by Inc/Corp/Co/Ltd ('Mars Inc'), OR
  //   (c) business or signal context word elsewhere in title+desc.
  if (NEEDS_CONTEXT_BRANDS.has(brand.slug)) {
    const startsWithBrand = new RegExp(`^${escaped}\\b`, "i").test(title);
    const followedByCorp  = new RegExp(`${escaped}['s]*\\s+(inc|corp|co\\.|company|llc|ltd|holdings|group|stores?|brand|consumer|wrigley|wireless|motors?|technologies?)`, "i").test(title);
    if (startsWithBrand || followedByCorp) return true;

    const allContext = [...BUSINESS_CONTEXT_WORDS, ...SIGNAL_KEYWORDS];
    if (!allContext.some(w => text.includes(w))) return false;
  }
  return true;
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
    // <source url="https://www.reuters.com">Reuters</source>
    //   ^ has attributes, so plain get("source") (which only matches
    //   <source>X</source>) returns null. Extract both the text and the
    //   url attribute separately.
    const sourceMatch = /<source\s+url="([^"]+)"\s*>([\s\S]*?)<\/source>/.exec(block);
    const sourceUrl  = sourceMatch ? sourceMatch[1] : null;
    const sourceName = sourceMatch ? sourceMatch[2].replace(/<!\[CDATA\[(.*?)\]\]>/s, "$1").trim() : null;

    items.push({
      title:       get("title"),
      link:        get("link"),
      pubDate:     get("pubDate"),
      description: get("description"),
      source:      sourceName,   // human-readable, eg "Reuters"
      sourceUrl,                 // publisher domain URL, eg "https://www.reuters.com"
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
    // B-38 (2026-06-06): drop noise BEFORE building output objects.
    // Otherwise 200 false-positive matches per day clog the AI extractor.
    const validItems = items.filter(it => validateBrandMatch(brand, it));
    return validItems.map(it => {
      // Use the <source url="..."> attribute to find the REAL publisher
      // domain. it.link points at news.google.com (Google's redirect),
      // which is useless for outlet identification.
      const domain = it.sourceUrl ? extractDomain(it.sourceUrl) : extractDomain(it.link);
      const meta = OUTLET_BIAS[domain] || { bias: "unknown", weight: 0.3, fact_driver: false };
      return {
        brand_slug: brand.slug,
        brand_name: brand.name,
        title:      it.title,
        url:        it.link,
        domain,
        outlet:     it.source,        // human-readable outlet name
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
