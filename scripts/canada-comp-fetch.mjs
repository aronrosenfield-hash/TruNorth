#!/usr/bin/env node
/**
 * Canadian Competition Bureau enforcement actions (monthly).
 *
 * The Competition Bureau of Canada — an independent law-enforcement agency
 * under Innovation, Science and Economic Development Canada (ISED) —
 * publishes a public listing of enforcement actions, merger reviews,
 * deceptive marketing investigations, and consent agreements. There is no
 * official bulk API, but the public news/announcement listing under
 * canada.ca is paginated and machine-readable.
 *
 * Sources:
 *   - Landing page (EN): https://www.canada.ca/en/competition-bureau.html
 *   - News listing:       https://www.canada.ca/en/competition-bureau/news.html
 *   - Pagination:         https://www.canada.ca/en/competition-bureau/news.html?pagename=...&pg=N
 *
 * The page renders an ordered list of news/release tiles. Each tile gives
 * a title (linked), a date, and a short teaser. We crawl pages until we
 * cross a 5-year cutoff or reach a hard page-cap, fetch each linked
 * release for the full body text, then full-text scan per brand.
 *
 * Per-brand aggregate written to:
 *   /public/data/canada-comp-actions.json
 *
 * Per-brand schema (when there are hits):
 *   {
 *     slug, name, status: "ok",
 *     total_canada_actions_5y: number,
 *     total_fines_cad:         number,    // sum of CAD penalties parsed
 *     sample_actions: [                   // up to 5 most recent
 *       { title, url, date, snippet, fine_cad, action_type }
 *     ],
 *     source_url:              string,    // stable search URL on canada.ca
 *     scraped_at:              ISO,
 *   }
 *
 * Throttle: 1 req/sec (REQUEST_DELAY_MS=1000), UA "TruNorth-CanadaComp/1.0".
 *
 * Runs via .github/workflows/canada-comp-monthly.yml on the 2nd of each
 * month at 06:00 UTC.
 *
 * Locally:
 *   node scripts/canada-comp-fetch.mjs
 *   node scripts/canada-comp-fetch.mjs --smoke   # google/amazon/meta/loblaws
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/canada-comp-actions.json");

const BASE = "https://www.canada.ca";
const LISTING_URL = `${BASE}/en/competition-bureau/news.html`;
const SEARCH_URL  = `${BASE}/en/competition-bureau/search.html`;
const UA = "TruNorth-CanadaComp/1.0 (+https://www.trunorthapp.com)";

const REQUEST_DELAY_MS = 1000;     // 1 req/sec — polite for canada.ca
const FIVE_YEARS_MS    = 5 * 365 * 24 * 60 * 60 * 1000;
const MAX_LISTING_PAGES = 60;       // ~25 tiles/page → ~1,500 releases cap
const MAX_DETAILS       = 800;      // per-release detail fetches cap

const SMOKE_MODE   = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set(["google", "amazon", "meta", "facebook", "loblaws"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name, category] = l.split("|").map((s) => s.trim());
      return { slug, name, category };
    })
    .filter((b) => b.slug && b.name);
}

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-CA,en;q=0.9",
      },
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchText(url, attempt + 1);
      }
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `${BASE}${href}`;
  return `${BASE}/${href}`;
}

// Extract release tiles from the news listing page. Each tile is roughly:
//   <li>... <a href="/en/competition-bureau/news/2025/...">title</a> ...
//   <time datetime="2025-04-12">April 12, 2025</time> ... teaser ... </li>
// We use a forgiving regex pass because the markup occasionally changes.
function extractTiles(html) {
  if (!html) return [];
  const tiles = [];
  // Match anchors that look like Competition Bureau news/release URLs.
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    if (!/competition-bureau\/(news|services\/announcements|notices)/i.test(href)) continue;
    if (/\.(pdf|jpg|png|gif)(\?|$)/i.test(href)) continue;
    if (href.endsWith("/news.html") || href.endsWith("/news")) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const url = absoluteUrl(href);
    const title = stripHtml(m[2]);
    if (!title || title.length < 4) continue;

    // Try to find a date near this anchor (within ~400 chars window).
    const ctxStart = Math.max(0, m.index - 200);
    const ctxEnd   = Math.min(html.length, m.index + m[0].length + 600);
    const ctx = html.slice(ctxStart, ctxEnd);
    const dateMatch =
      ctx.match(/datetime="(\d{4}-\d{2}-\d{2})"/i) ||
      ctx.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const date = dateMatch ? dateMatch[1] : null;

    tiles.push({ url, title, date });
  }
  return tiles;
}

function tileDateMs(t) {
  if (!t.date) return null;
  const ms = Date.parse(t.date);
  return Number.isFinite(ms) ? ms : null;
}

// Walk listing pages until we've crossed the 5-year cutoff for at least two
// consecutive pages, then stop. (Some early pages may interleave promoted
// content without dates.)
async function collectListing() {
  const tiles = [];
  const seen = new Set();
  const cutoff = Date.now() - FIVE_YEARS_MS;
  let oldPagesInARow = 0;

  for (let pg = 1; pg <= MAX_LISTING_PAGES; pg++) {
    const url = pg === 1 ? LISTING_URL : `${LISTING_URL}?pg=${pg}`;
    const html = await fetchText(url);
    await sleep(REQUEST_DELAY_MS);
    if (!html) { oldPagesInARow++; if (oldPagesInARow >= 2) break; continue; }

    const pageTiles = extractTiles(html);
    if (!pageTiles.length) {
      oldPagesInARow++;
      if (oldPagesInARow >= 2) break;
      continue;
    }

    let pageHadInWindow = false;
    for (const t of pageTiles) {
      if (seen.has(t.url)) continue;
      seen.add(t.url);
      const ms = tileDateMs(t);
      if (ms === null || ms >= cutoff) {
        tiles.push(t);
        if (ms !== null && ms >= cutoff) pageHadInWindow = true;
      }
    }

    if (pg % 5 === 0) {
      console.log(`  …scanned listing page ${pg} (${tiles.length} tiles in window)`);
    }
    if (!pageHadInWindow && pg > 2) {
      oldPagesInARow++;
      if (oldPagesInARow >= 2) break;
    } else {
      oldPagesInARow = 0;
    }
  }

  console.log(`  Collected ${tiles.length} listing tiles within 5y window`);
  return tiles;
}

// Pull the main-content body text from a release detail page. The Canada.ca
// release template wraps the article body in <main ...> ... </main> with
// id="wb-cont". We slice that section then strip HTML to plain text.
function extractDetailBody(html) {
  if (!html) return "";
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  const section = mainMatch ? mainMatch[0] : html;
  return stripHtml(section);
}

function extractDetailDate(html) {
  if (!html) return null;
  // Prefer the explicit date-published meta tag on canada.ca releases.
  const meta = html.match(/<meta\s+name="dcterms\.issued"\s+content="([^"]+)"/i)
            || html.match(/<meta\s+name="date"\s+content="([^"]+)"/i);
  if (meta) {
    const ms = Date.parse(meta[1]);
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  const m = html.match(/datetime="(\d{4}-\d{2}-\d{2})"/i);
  return m ? m[1] : null;
}

async function hydrateDetails(tiles) {
  const out = [];
  const limit = Math.min(tiles.length, MAX_DETAILS);
  for (let i = 0; i < limit; i++) {
    const t = tiles[i];
    let html = null;
    try { html = await fetchText(t.url); }
    catch (err) { console.warn(`  detail fetch failed ${t.url}: ${err.message}`); }
    await sleep(REQUEST_DELAY_MS);

    const body = extractDetailBody(html);
    const date = t.date || extractDetailDate(html);
    out.push({
      url:      t.url,
      title:    t.title,
      date,
      body,
      haystack: `${t.title}\n${body}`.toLowerCase(),
    });
    if ((i + 1) % 25 === 0) console.log(`  …hydrated ${i + 1}/${limit} releases`);
  }
  return out;
}

// Word-boundary matcher for brand names. Multi-word phrases match as whole
// phrases. Avoids matching "apple" inside "snapple" or "Meta" inside
// "metadata".
function compileMatcher(name) {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
}

// Parse a CAD amount embedded in the body. The Bureau typically writes
// penalties as "$10 million", "$1.5 million", or "$250,000".
// We sum every matched amount in the release, with a sanity cap of $1B
// per release to avoid runaway false positives.
function parseFinesCAD(body) {
  if (!body) return 0;
  const lower = body.toLowerCase();
  if (!lower.includes("$") && !lower.includes("penalty") &&
      !lower.includes("fine") && !lower.includes("administrative monetary")) return 0;

  let total = 0;
  const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)?/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || "").toLowerCase();
    let amt;
    if (unit === "billion")  amt = n * 1_000_000_000;
    else if (unit === "million") amt = n * 1_000_000;
    else if (unit === "thousand") amt = n * 1_000;
    else amt = n;
    // Ignore obviously irrelevant tiny figures (e.g. price quotes "$2").
    if (amt < 1000) continue;
    total += amt;
  }
  return Math.min(Math.round(total), 1_000_000_000);
}

function classifyAction(haystack) {
  const tags = [];
  if (/\bmerger\b/.test(haystack))                           tags.push("merger_review");
  if (/deceptive marketing|misleading|false claim/.test(haystack)) tags.push("deceptive_marketing");
  if (/\bcartel\b|price[- ]fix|bid[- ]rig/.test(haystack))   tags.push("cartel");
  if (/abuse of dominance|monopolization/.test(haystack))    tags.push("abuse_of_dominance");
  if (/consent agreement/.test(haystack))                    tags.push("consent_agreement");
  if (/administrative monetary penalt|civil penalt|fine/.test(haystack)) tags.push("penalty");
  if (/investigation/.test(haystack) && !tags.length)        tags.push("investigation");
  if (!tags.length)                                          tags.push("enforcement");
  return tags;
}

function snippetAround(text, needleLc, ctx = 120) {
  const lower = text.toLowerCase();
  const i = lower.indexOf(needleLc);
  if (i < 0) return text.slice(0, 240);
  const start = Math.max(0, i - ctx);
  const end   = Math.min(text.length, i + needleLc.length + ctx);
  let s = text.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}

function scanBrand(brand, releases, now) {
  const re = compileMatcher(brand.name);
  const needleLc = brand.name.toLowerCase();
  const hits = [];
  for (const r of releases) {
    if (!re.test(r.haystack)) continue;
    const tags = classifyAction(r.haystack);
    const fine = parseFinesCAD(r.body);
    hits.push({
      title: r.title,
      url: r.url,
      date: r.date,
      snippet: snippetAround(r.body || r.title, needleLc),
      fine_cad: fine,
      action_types: tags,
    });
  }
  if (!hits.length) {
    return { slug: brand.slug, name: brand.name, status: "no_actions", total_canada_actions_5y: 0 };
  }

  const totalFines = hits.reduce((s, h) => s + (h.fine_cad || 0), 0);
  const sample = hits.slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);

  return {
    slug:                    brand.slug,
    name:                    brand.name,
    status:                  "ok",
    total_canada_actions_5y: hits.length,
    total_fines_cad:         totalFines,
    sample_actions:          sample,
    source_url:              `${SEARCH_URL}?q=${encodeURIComponent(brand.name)}`,
    scraped_at:              new Date(now).toISOString(),
  };
}

async function main() {
  console.log(`Canada Competition Bureau fetcher starting${SMOKE_MODE ? " (smoke)" : ""}...`);

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE_MODE) {
    brands = brands.filter((b) => SMOKE_BRANDS.has(b.slug));
    console.log(`Smoke mode: ${brands.length} brands -> ${brands.map((b) => b.slug).join(", ")}`);
  }

  console.log("Crawling Competition Bureau news listing...");
  const tiles = await collectListing();
  if (!tiles.length) {
    console.error("Got zero release tiles — aborting without overwriting output.");
    process.exit(1);
  }

  console.log(`Hydrating ${Math.min(tiles.length, MAX_DETAILS)} release detail pages...`);
  const releases = await hydrateDetails(tiles);

  const now = Date.now();
  const results = brands.map((b) => scanBrand(b, releases, now));
  const withActions = results.filter((r) => r.status === "ok").length;
  const noActions   = results.filter((r) => r.status === "no_actions").length;

  const payload = {
    generated_at:        new Date(now).toISOString(),
    source_landing:      LISTING_URL,
    window_years:        5,
    listing_tile_count:  tiles.length,
    releases_scanned:    releases.length,
    brand_count:         brands.length,
    with_actions_count:  withActions,
    no_actions_count:    noActions,
    smoke:               SMOKE_MODE,
    brands:              results,
  };

  if (SMOKE_MODE) {
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\nSmoke output -> ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  }
  console.log(`   Brands with actions: ${withActions}`);
  console.log(`   Releases scanned:    ${releases.length}`);

  for (const r of results.filter((x) => x.status === "ok").slice(0, 5)) {
    console.log(`\n   ${r.name} — ${r.total_canada_actions_5y} actions, CAD $${(r.total_fines_cad || 0).toLocaleString()}`);
    for (const a of r.sample_actions.slice(0, 3)) {
      console.log(`     [${a.date || "?"}] ${a.title.slice(0, 100)}`);
    }
  }
}

main().catch((err) => {
  console.error("canada-comp-fetch failed:", err);
  process.exit(1);
});
