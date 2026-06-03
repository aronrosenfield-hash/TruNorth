#!/usr/bin/env node
/**
 * Option A — Step 3: Merge extracted news signals into per-company JSON.
 *
 * Reads /public/data/news/YYYY-MM-DD.extracted.json (from news-rss-extract.mjs)
 * and writes the relevant items into:
 *   1. company.news[]              — visible in the app's detail panel
 *   2. company.recent_events[]     — structured signals for future score rebake
 *   3. company.dataLastUpdated.news_rss  — freshness timestamp
 *
 * We deliberately DO NOT mutate company.sc.* score values from a single
 * article. Reasons:
 *   - One article shouldn't move a brand's grade by itself
 *   - Scoring should stay deterministic and re-runnable from raw signals
 *   - A separate scoring rebake (weekly/monthly) can read recent_events[]
 *     and re-derive scores with full context
 *
 * Orphan brand slugs (in top-500-brands.txt but no /companies/<slug>.json)
 * are logged but not auto-created — most are sub-brands of an existing
 * parent (Sprite → Coca-Cola, Mountain Dew → PepsiCo). A future
 * sub-brand→parent mapping is a follow-up; for now just log.
 *
 * Locally: node scripts/news-extracted-merge.mjs                 # today
 *          node scripts/news-extracted-merge.mjs 2026-06-02     # specific day
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// existsSync is already imported above but resolveSlug uses it inside
// a non-async helper, so it's fine to keep this single import.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NEWS_DIR  = path.join(ROOT, "public/data/news");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(NEWS_DIR, "merge-log.json");

const MAX_NEWS_PER_COMPANY    = 50;   // cap visible news list
const MAX_EVENTS_PER_COMPANY  = 30;   // cap structured events for scoring
const NEWS_TTL_DAYS           = 180;  // drop news older than this

// B-22: slug-alias and sub-brand→parent mappings let the merger route
// news for orphan slugs (top-500 brands without their own company file)
// into the correct destination. Sources, in priority order:
//   1. slug-aliases.json — same brand, different slugification
//      (Lay's: "lays" → "lay-s") — high confidence, file IS that brand
//   2. brand-parent-map.json — sub-brand → parent corporate slug
//      (Sprite → Coca-Cola, Bud Light → AB InBev) — news lands on
//      the parent's file
async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

// Resolve an item's brand_slug to the actual /companies/<slug>.json that
// exists. Returns { slug, routed_via } where routed_via is "direct",
// "alias", "parent", or "orphan".
function resolveSlug(slug, maps) {
  const direct = path.join(COMP_DIR, `${slug}.json`);
  if (existsSync(direct)) return { slug, routed_via: "direct" };

  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

async function loadExtracted(dateStr) {
  const file = path.join(NEWS_DIR, `${dateStr}.extracted.json`);
  return JSON.parse(await fs.readFile(file, "utf-8"));
}

function ageDays(isoDate) {
  if (!isoDate) return Infinity;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function dedupeByUrl(arr) {
  const seen = new Set();
  return arr.filter(x => {
    if (!x?.url || seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });
}

// Compute the aggregate `news` object the UI reads:
//   enriched.news = { mentionCount90d, avgTone, scandalSignals, topArticles }
// from the raw array of items we've stored at news_items[].
//
// avgTone: per-item tone is severity-weighted. high=±3, medium=±1.5, low=±0.5.
// Sign flips on score_impact.direction (positive event → positive tone).
// Mean across items in the 90-day window.
//
// scandalSignals: uppercase category labels from high+medium severity
// negative-direction items. Deduped, capped at 5. Shown as red chips.
//
// topArticles: 3 most recent items overall (the panel cap is 3).
function buildAggregateNews(items) {
  const now = Date.now();
  const NINETY_D_MS = 90 * 24 * 60 * 60 * 1000;
  const recent = items.filter(it => {
    const t = Date.parse(it.date);
    return !Number.isNaN(t) && now - t <= NINETY_D_MS;
  });

  const sevWeight = { high: 3, medium: 1.5, low: 0.5 };
  const tones = recent.map(it => {
    const w = sevWeight[it.severity] ?? 1;
    const dir = it.direction === "positive" ? 1 : it.direction === "negative" ? -1 : 0;
    return dir * w;
  });
  const avgTone = tones.length ? tones.reduce((a, b) => a + b, 0) / tones.length : 0;

  const scandalSet = new Set();
  for (const it of recent) {
    if ((it.severity === "high" || it.severity === "medium") && it.direction !== "positive") {
      // Use the news category if available, fall back to the score_impact category
      const label = (it.category || it.trunorth_category || "").toUpperCase();
      if (label && label !== "OTHER") scandalSet.add(label);
    }
  }
  const scandalSignals = [...scandalSet].slice(0, 5);

  // Most recent articles regardless of severity, capped at 3
  const sorted = [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const topArticles = sorted.slice(0, 3).map(it => ({
    title: it.title,
    url:   it.url,
  }));

  return {
    mentionCount90d: recent.length,
    avgTone:         Number(avgTone.toFixed(2)),
    scandalSignals,
    topArticles,
    lastUpdated:     new Date().toISOString(),
    source:          "rss-extraction",
  };
}

async function mergeOneCompany(slug, items, now) {
  const file = path.join(COMP_DIR, `${slug}.json`);
  if (!existsSync(file)) return { slug, status: "orphan", count: items.length };

  const raw = await fs.readFile(file, "utf-8");
  let company;
  try { company = JSON.parse(raw); }
  catch (e) { return { slug, status: "parse_error", error: e.message }; }

  // --- 1. Build the raw item array (used by news_items for audit + score rebake) ---
  const newsEntries = items.map(it => ({
    date:      it.pub_date,
    title:     it.title,
    outlet:    it.outlet,
    bias:      it.bias,
    summary:   it.summary,
    category:  it.category,
    severity:  it.severity,
    direction: it.score_impact?.direction,
    url:       it.url,
    source:    "rss-extraction",
  }));

  // news_items[] is the raw audit/score-rebake list — capped + TTL'd.
  // Preserves any prior items so the 90-day window is honored across runs.
  const allItems = dedupeByUrl([...newsEntries, ...(company.news_items || [])])
    .filter(n => ageDays(n.date) < NEWS_TTL_DAYS);
  company.news_items = allItems.slice(0, MAX_NEWS_PER_COMPANY);

  // --- 2. Compute aggregate `news` OBJECT (what the UI reads) ---
  // Critical schema match: enriched.news.{mentionCount90d, avgTone,
  // scandalSignals, topArticles}.
  company.news = buildAggregateNews(company.news_items);

  // --- 3. Append to recent_events[] (separate path for score rebake) ---
  const eventEntries = items
    .filter(it => it.score_impact?.trunorth_category && it.score_impact.trunorth_category !== "none")
    .map(it => ({
      date:        it.pub_date,
      category:    it.score_impact.trunorth_category,
      direction:   it.score_impact.direction,
      magnitude:   it.score_impact.magnitude,
      severity:    it.severity,
      summary:     it.summary,
      url:         it.url,
      ingested_at: now,
    }));

  company.recent_events = dedupeByUrl([...eventEntries, ...(company.recent_events || [])])
    .filter(e => ageDays(e.date) < NEWS_TTL_DAYS)
    .slice(0, MAX_EVENTS_PER_COMPANY);

  // --- 4. Freshness tracking ---
  // Some legacy company files store dataLastUpdated as a bare string
  // (e.g. "2026-05-28") rather than an object. Coerce to object,
  // preserving the legacy value for audit.
  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated
      ? { legacy: company.dataLastUpdated }
      : {};
  }
  company.dataLastUpdated.news_rss = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    slug,
    status:        "merged",
    news_added:    newsEntries.length,
    events_added:  eventEntries.length,
    items_total:   company.news_items.length,
    events_total:  company.recent_events.length,
    aggregate:     company.news,
  };
}

async function main() {
  const dateArg = process.argv[2];
  const today = dateArg || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  console.log(`🔀 News merge starting for ${today}…`);
  const maps = await loadMaps();
  console.log(`🗺️  Loaded ${Object.keys(maps.aliases).length} slug aliases + ${Object.keys(maps.parents).length} parent mappings`);
  const extracted = await loadExtracted(today);
  const items = extracted.items || [];
  console.log(`📋 ${items.length} extracted items to merge`);

  if (items.length === 0) {
    console.log("⚠ No items to merge — writing empty log + skipping");
    // Always write merge-log.json so the workflow's `git add` doesn't
    // error on missing pathspec on no-data days.
    await fs.writeFile(LOG_FILE, JSON.stringify({
      merged_at: now,
      total_items: 0,
      brand_count: 0,
      merged_count: 0,
      note: "no items_for_ai in extracted file — skipped merge",
    }, null, 2));
    return;
  }

  // Resolve each item's brand_slug through alias + parent maps BEFORE
  // grouping, so news about Sprite lands on Coca-Cola and Lay's lands
  // on lay-s.
  const routing = { direct: 0, alias: 0, parent: 0, orphan: 0 };
  const byBrand = {};
  for (const it of items) {
    if (!it.brand_slug) continue;
    const { slug: resolvedSlug, routed_via } = resolveSlug(it.brand_slug, maps);
    routing[routed_via]++;
    if (!resolvedSlug) continue;  // orphan — log only, don't merge
    (byBrand[resolvedSlug] = byBrand[resolvedSlug] || []).push(it);
  }
  const brandCount = Object.keys(byBrand).length;
  console.log(`🔀 Routing: ${routing.direct} direct · ${routing.alias} alias · ${routing.parent} parent · ${routing.orphan} orphan`);
  console.log(`🏷️  Items now span ${brandCount} unique destination brands`);

  // Merge each brand serially (file IO, no need to parallelize)
  const results = [];
  let i = 0;
  for (const [slug, brandItems] of Object.entries(byBrand)) {
    const r = await mergeOneCompany(slug, brandItems, now);
    results.push(r);
    i++;
    if (i % 50 === 0) console.log(`  …${i}/${brandCount}`);
  }

  const merged    = results.filter(r => r.status === "merged");
  const orphans   = results.filter(r => r.status === "orphan");
  const errors    = results.filter(r => r.status === "parse_error");

  // Log summary for triage
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:    now,
    source_file:  `${today}.extracted.json`,
    total_items:  items.length,
    brand_count:  brandCount,
    merged_count: merged.length,
    orphan_count: orphans.length,
    error_count:  errors.length,
    orphans:      orphans.map(o => o.slug),
    errors,
    sample_merged: merged.slice(0, 10),
  }, null, 2));

  console.log(`\n✅ Merge complete`);
  console.log(`   Merged:        ${merged.length} companies`);
  console.log(`   Orphan slugs:  ${orphans.length}  (logged to merge-log.json)`);
  console.log(`   Parse errors:  ${errors.length}`);
  console.log(`   Total events added: ${merged.reduce((a,b) => a + (b.events_added || 0), 0)}`);
  console.log(`   Total news added:   ${merged.reduce((a,b) => a + (b.news_added || 0), 0)}`);
}

main().catch(err => {
  console.error("❌ news-extracted-merge failed:", err);
  process.exit(1);
});
