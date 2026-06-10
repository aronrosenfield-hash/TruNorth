#!/usr/bin/env node
/**
 * Powerbase (Spinwatch) MediaWiki scraper.
 *
 * Powerbase — https://powerbase.info — is a UK-based investigative wiki
 * focused on PR firms, front groups, lobbying networks, and revolving-door
 * relationships. For each TruNorth brand we look up the page (if any) and
 * pull:
 *   - the lead extract (plain text, first ~800 chars)
 *   - the page categories (industry / lobbying / spin tags)
 *   - external link / reference counts (for severity gating)
 *   - section list (so the merger can pick up Controversies / Lobbying
 *     sections explicitly when present)
 *
 * MediaWiki API endpoints used:
 *   - action=query&list=search             → resolve page title from brand name
 *   - action=query&titles=...&prop=info|categories|extracts (TextExtracts ext)
 *   - action=parse&page=...&prop=externallinks|sections
 *
 * Scraping etiquette (per the prompt):
 *   - Real User-Agent: "TruNorth Bot https://trunorthapp.com"
 *   - Max 1 request per second
 *   - On-disk caching at .cache/powerbase/
 *   - Every record cites the source URL (CC BY-SA)
 *
 * Output:
 *   data/raw/powerbase/<YYYY-MM-DD>.json
 *
 * CLI:
 *   --apply / --dry / --url / --limit / --out / --cache
 *
 * Severity: editorial wiki content alone → "mixed". Upgrade to "poor" only
 * when ≥2 external citations are present. (Enforced in the merger.)
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/powerbase");
const CACHE_DIR = path.join(ROOT, ".cache/powerbase");
const FIXTURE = path.join(__dirname, "fixtures/powerbase/sample.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

export const POWERBASE_API = "https://powerbase.info/api.php";
export const POWERBASE_HOST = "https://powerbase.info";
const UA = "TruNorth Bot https://trunorthapp.com (aron@trunorthapp.com)";
const RATE_MS = 1000;            // ≤1 req/sec per the prompt
const MAX_EXTRACT_CHARS = 800;
export const LICENSE = "CC BY-SA 3.0 — Powerbase (Spinwatch), https://powerbase.info";

// Brands we explicitly want to attempt — narrative-heavy targets called out
// in the round-5 plan: big oil, tobacco, big finance, big tech, big food.
// Beyond this seed list, we walk the index sorted by realCats (low-first or
// high-first depending on --sort) for broader coverage.
export const SEED_BRANDS = [
  "ExxonMobil", "Chevron", "BP", "Shell", "Royal Dutch Shell", "Total", "TotalEnergies",
  "Koch Industries", "Philip Morris International", "Altria", "British American Tobacco",
  "Goldman Sachs", "JPMorgan Chase", "Citigroup", "Morgan Stanley", "Wells Fargo",
  "Bank of America", "HSBC", "Barclays", "Deutsche Bank", "BlackRock", "Vanguard",
  "Pfizer", "Johnson & Johnson", "GlaxoSmithKline", "AstraZeneca", "Bayer",
  "Monsanto", "Nestle", "Coca-Cola", "PepsiCo", "Unilever", "McDonald's",
  "Walmart", "Amazon", "Google", "Meta Platforms", "Facebook", "Microsoft",
  "Boeing", "Lockheed Martin", "Raytheon", "BAE Systems",
  "Rio Tinto", "BHP", "Glencore", "Vale",
  "Halliburton", "Schlumberger", "Bechtel",
];

// Powerbase category-name patterns we treat as binary signals — when a page
// is tagged with one of these we surface it independent of section content.
export const CATEGORY_PATTERNS = [
  // political / lobbying / front groups
  { rx: /Lobby(ing|ist|groups?)?/i,              signal: "lobbying",          cat: "political" },
  { rx: /Front groups?|Astroturf/i,              signal: "front_group",       cat: "political" },
  { rx: /PR firms?|Public relations/i,           signal: "pr_firm",           cat: "political" },
  { rx: /Revolving door/i,                       signal: "revolving_door",    cat: "political" },
  { rx: /Think tanks?/i,                         signal: "think_tank",        cat: "political" },
  { rx: /Tax avoidance/i,                        signal: "tax_avoidance",     cat: "political" },
  // environment / climate
  { rx: /Climate denial|Climate sceptic|Climate skeptic/i, signal: "climate_denial", cat: "environment" },
  { rx: /Oil Industry|Coal Industry|Fracking/i,  signal: "fossil_fuel",       cat: "environment" },
  { rx: /Mining (Industry|and Metals)/i,         signal: "mining_industry",   cat: "environment" },
  // labor / supply chain
  { rx: /Sweatshops?|Labour rights|Labor rights/i, signal: "labor_issue",     cat: "labor" },
  // dei / front-group critique (greenwashing/diversity-washing)
  { rx: /Greenwash/i,                            signal: "greenwashing",      cat: "environment" },
  { rx: /Astroturf/i,                            signal: "astroturf",         cat: "dei" },
];

// ─── CLI ────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const args = { limit: null, out: null, url: null, cache: false, dry: false, apply: false, skip: 0, sort: "seed-first" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 100);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--cache") args.cache = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--skip") args.skip = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--sort") args.sort = argv[++i];
  }
  return args;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Tracks whether the most recent cachedFetchJson invocation was a hot
// cache hit. The runner uses this to skip its post-call rate-limit sleep
// when no HTTP request was actually issued (etiquette only applies to
// live traffic).
let LAST_WAS_CACHE_HIT = false;
async function cachedFetchJson(url, cacheName, useCache) {
  const cf = path.join(CACHE_DIR, cacheName);
  if (useCache && existsSync(cf)) {
    LAST_WAS_CACHE_HIT = true;
    return JSON.parse(await fs.readFile(cf, "utf-8"));
  }
  LAST_WAS_CACHE_HIT = false;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Powerbase HTTP ${res.status}`);
  const payload = await res.json();
  if (useCache) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cf, JSON.stringify(payload));
  }
  return payload;
}
function wasCacheHit() { return LAST_WAS_CACHE_HIT; }

// ─── Title resolution ───────────────────────────────────────────────────
// Direct-title only (with redirects). Fuzzy search produced too many false
// positives for short names (Vanguard → Ulster Vanguard, Intel → Total
// Intel) so we only accept a hit when the brand name itself (or a known
// "(company)" disambig variant) maps to a page.
export async function resolveTitle(brand, { cache } = {}) {
  const candidates = [brand, `${brand} (company)`, `${brand} Inc.`, `${brand} Corporation`];
  const u = new URL(POWERBASE_API);
  u.searchParams.set("action", "query");
  u.searchParams.set("titles", candidates.join("|"));
  u.searchParams.set("redirects", "1");
  u.searchParams.set("format", "json");
  u.searchParams.set("formatversion", "2");
  const key = `pb_title_${hashStr(candidates.join("|"))}.json`;
  try {
    const payload = await cachedFetchJson(u.toString(), key, cache);
    const pages = payload.query?.pages || [];
    for (const p of pages) {
      if (!p.missing) return p.title;
    }
  } catch {}
  return null;
}

// Strip the worst wikitext artifacts so the lead reads as prose.
// Powerbase's MediaWiki doesn't ship TextExtracts, so we approximate.
export function stripWikitext(wt) {
  if (!wt) return "";
  let s = String(wt);
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*\/>/gi, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/\{\{[^{}]*?\}\}/g, "");
    if (next === s) break;
    s = next;
  }
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\[\[(?:File|Image):[^\[\]]*(?:\[\[[^\[\]]*\]\][^\[\]]*)*\]\]/gi, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\[https?:\/\/\S+\]/g, "");
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  s = s.replace(/={2,}\s*[^=]+\s*={2,}/g, "");
  s = s.replace(/[\[\]]+/g, " ");
  s = s.replace(/'{2,5}/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ─── Page fetcher: extract + categories + sections + externallinks ──────
export async function fetchPage(title, { cache } = {}) {
  // 1) categories (TextExtracts isn't enabled on Powerbase — we ignore the
  //    prop=extracts response and synthesize the extract from the lead
  //    section's wikitext below).
  let categories = [];
  {
    const u = new URL(POWERBASE_API);
    u.searchParams.set("action", "query");
    u.searchParams.set("titles", title);
    u.searchParams.set("prop", "categories");
    u.searchParams.set("cllimit", "max");
    u.searchParams.set("redirects", "1");
    u.searchParams.set("format", "json");
    u.searchParams.set("formatversion", "2");
    const key = `pb_q_${hashStr(title)}.json`;
    try {
      const payload = await cachedFetchJson(u.toString(), key, cache);
      const pages = payload.query?.pages || [];
      const p = pages.find(x => !x.missing);
      if (!p) return null;
      categories = (p.categories || []).map(c => c.title);
    } catch (e) {
      return null;
    }
  }
  // 2) parse: external links + section list + lead-section wikitext
  let externalLinks = [];
  let sections = [];
  let extract = "";
  {
    const u = new URL(POWERBASE_API);
    u.searchParams.set("action", "parse");
    u.searchParams.set("page", title);
    u.searchParams.set("prop", "externallinks|sections|wikitext");
    u.searchParams.set("section", "0");           // lead section only
    u.searchParams.set("redirects", "1");
    u.searchParams.set("format", "json");
    u.searchParams.set("formatversion", "2");
    const key = `pb_p_${hashStr(title)}.json`;
    try {
      const payload = await cachedFetchJson(u.toString(), key, cache);
      externalLinks = payload.parse?.externallinks || [];
      sections = (payload.parse?.sections || []).map(s => s.line);
      const wt = payload.parse?.wikitext || "";
      extract = stripWikitext(wt).slice(0, MAX_EXTRACT_CHARS);
    } catch {
      // page exists but parse failed — still emit what we have
    }
  }
  return {
    title,
    page_url: `${POWERBASE_HOST}/index.php/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    extract,
    extract_chars: extract.length,
    categories,
    sections,
    external_link_count: externalLinks.length,
    external_links: externalLinks.slice(0, 20),  // sample only — keep raw small
  };
}

// ─── Category match ─────────────────────────────────────────────────────
export function classifyCategory(catTitle) {
  if (!catTitle) return null;
  for (const p of CATEGORY_PATTERNS) {
    if (p.rx.test(catTitle)) return { signal: p.signal, cat: p.cat };
  }
  return null;
}

// ─── Fixture replay ─────────────────────────────────────────────────────
export async function replayFixture(fixturePath = FIXTURE) {
  return JSON.parse(await fs.readFile(fixturePath, "utf-8"));
}

// ─── Runner ─────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  console.log(`Powerbase fetcher starting...   (mode=${args.dry ? "DRY" : "LIVE"})`);
  console.log(`License: ${LICENSE}`);

  if (args.dry) {
    const bundle = await replayFixture();
    await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
    console.log(`[dry] wrote ${outFile} with ${(bundle.pages || []).length} fixture pages`);
    return;
  }

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  // Build the work queue.
  // 1) Seeded high-value targets (resolved via name → page title)
  // 2) Top-N index entries (default: high-realCats first so editorial-heavy
  //    brands get hit first; --sort low-first available too)
  const candidates = [];
  for (const name of SEED_BRANDS) {
    // Try to match a slug in the index for this name; ok if it doesn't
    // exist (we'll still scrape, the merger will skip unmatched slugs).
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    candidates.push({ slug, name, source: "seed" });
  }
  const seedSlugs = new Set(candidates.map(c => c.slug));
  const sorted = [...index].sort((a, b) =>
    args.sort === "low-first"
      ? (a.realCats || 0) - (b.realCats || 0)
      : (b.realCats || 0) - (a.realCats || 0)
  );
  for (const b of sorted) {
    if (seedSlugs.has(b.slug)) continue;
    candidates.push({ slug: b.slug, name: b.name, source: "index" });
  }

  const offset = args.skip;
  const cap = args.apply ? candidates.length : (args.limit ?? 200);
  const work = candidates.slice(offset, offset + cap);

  const pages = [];
  let processed = 0;
  let resolved = 0;
  let withCategories = 0;

  for (const b of work) {
    processed++;
    let title = await resolveTitle(b.name, { cache: args.cache });
    if (!wasCacheHit()) await sleep(RATE_MS);
    if (!title) continue;
    resolved++;

    const page = await fetchPage(title, { cache: args.cache });
    if (!wasCacheHit()) await sleep(RATE_MS);
    if (!page) continue;

    // Filter categories to signal-bearing ones
    const matched = [];
    for (const c of page.categories) {
      const hit = classifyCategory(c);
      if (hit) matched.push({ category_title: c, ...hit });
    }
    if (matched.length || (page.extract && page.extract.length > 100)) {
      withCategories++;
      pages.push({
        slug: b.slug,
        name: b.name,
        source_kind: b.source,
        title: page.title,
        page_url: page.page_url,
        extract: page.extract,
        extract_chars: page.extract_chars,
        categories: matched,
        sections: page.sections,
        external_link_count: page.external_link_count,
        external_links_sample: page.external_links,
      });
    }

    if (processed % 25 === 0 || processed === work.length) {
      console.log(`  ${processed}/${work.length}  resolved=${resolved}  hits=${withCategories}  pages_emitted=${pages.length}`);
    }
  }

  const bundle = {
    _license: LICENSE,
    _source: POWERBASE_HOST,
    _generated_at: new Date().toISOString(),
    _stats: {
      brands_probed:   work.length,
      pages_resolved:  resolved,
      pages_with_hits: withCategories,
      pages_emitted:   pages.length,
    },
    pages,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nWrote ${outFile}  (${pages.length} pages, ${withCategories} with category hits)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("powerbase-fetch failed:", e); process.exit(1); });
}
