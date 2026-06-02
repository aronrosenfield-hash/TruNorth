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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NEWS_DIR  = path.join(ROOT, "public/data/news");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const LOG_FILE  = path.join(NEWS_DIR, "merge-log.json");

const MAX_NEWS_PER_COMPANY    = 50;   // cap visible news list
const MAX_EVENTS_PER_COMPANY  = 30;   // cap structured events for scoring
const NEWS_TTL_DAYS           = 180;  // drop news older than this

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

async function mergeOneCompany(slug, items, now) {
  const file = path.join(COMP_DIR, `${slug}.json`);
  if (!existsSync(file)) return { slug, status: "orphan", count: items.length };

  const raw = await fs.readFile(file, "utf-8");
  let company;
  try { company = JSON.parse(raw); }
  catch (e) { return { slug, status: "parse_error", error: e.message }; }

  // --- 1. Append to news[] (user-visible) ---
  const newsEntries = items.map(it => ({
    date:     it.pub_date,
    title:    it.title,
    outlet:   it.outlet,
    bias:     it.bias,
    summary:  it.summary,
    category: it.category,
    severity: it.severity,
    url:      it.url,
    source:   "rss-extraction",
  }));

  company.news = dedupeByUrl([...newsEntries, ...(company.news || [])])
    .filter(n => ageDays(n.date) < NEWS_TTL_DAYS)
    .slice(0, MAX_NEWS_PER_COMPANY);

  // --- 2. Append to recent_events[] (for future score rebake) ---
  const eventEntries = items
    .filter(it => it.score_impact?.trunorth_category && it.score_impact.trunorth_category !== "none")
    .map(it => ({
      date:      it.pub_date,
      category:  it.score_impact.trunorth_category,
      direction: it.score_impact.direction,
      magnitude: it.score_impact.magnitude,
      severity:  it.severity,
      summary:   it.summary,
      url:       it.url,
      ingested_at: now,
    }));

  company.recent_events = dedupeByUrl([...eventEntries, ...(company.recent_events || [])])
    .filter(e => ageDays(e.date) < NEWS_TTL_DAYS)
    .slice(0, MAX_EVENTS_PER_COMPANY);

  // --- 3. Freshness tracking ---
  // Some legacy company files store dataLastUpdated as a bare string
  // (e.g. "2026-05-28") rather than an object. Coerce to object,
  // preserving the legacy value for audit.
  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated
      ? { legacy: company.dataLastUpdated }
      : {};
  }
  company.dataLastUpdated.news_rss = now;

  // Write back — NO pretty-print to keep file size down (matches existing convention)
  await fs.writeFile(file, JSON.stringify(company));

  return {
    slug,
    status:        "merged",
    news_added:    newsEntries.length,
    events_added:  eventEntries.length,
    news_total:    company.news.length,
    events_total:  company.recent_events.length,
  };
}

async function main() {
  const dateArg = process.argv[2];
  const today = dateArg || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  console.log(`🔀 News merge starting for ${today}…`);
  const extracted = await loadExtracted(today);
  const items = extracted.items || [];
  console.log(`📋 ${items.length} extracted items to merge`);

  if (items.length === 0) {
    console.log("⚠ No items to merge — skipping");
    return;
  }

  // Group items by brand_slug
  const byBrand = {};
  for (const it of items) {
    const slug = it.brand_slug;
    if (!slug) continue;
    (byBrand[slug] = byBrand[slug] || []).push(it);
  }
  const brandCount = Object.keys(byBrand).length;
  console.log(`🏷️  Items span ${brandCount} unique brands`);

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
