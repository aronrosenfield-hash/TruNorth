#!/usr/bin/env node
/**
 * FSIS — USDA Food Safety and Inspection Service Recall API (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the FSIS
 * Recall API for meat/poultry/egg-product recalls naming that brand's
 * establishment.
 *
 * Output: /public/data/fsis-recalls.json (overwritten weekly)
 *
 * The FSIS dataset is the authoritative US source for meat, poultry, and
 * egg product recalls. It does NOT cover non-meat consumer products
 * (those are CPSC) or financial complaints (CFPB) or non-meat food
 * recalls (those are FDA's enforcement reports). For brands with no
 * recalls we record status="no_recalls"; the merger skips them.
 *
 * API:   https://www.fsis.usda.gov/fsis/api/recall/v/1   (returns ~1200 records)
 * Docs:  https://www.fsis.usda.gov/science-data/developer-resources/recall-api
 *
 * The endpoint returns ALL recalls in one JSON array. We download once,
 * dedupe English/Spanish duplicates by field_recall_number, then locally
 * substring-match each brand against field_establishment. This is far
 * more efficient than per-brand queries (1 HTTP request, not 528).
 *
 * Per-brand aggregates:
 *   - total_recalls            — all-time count of recalls
 *   - recent_24mo_count        — last 24 months
 *   - recent_class_I_count     — Class I (high risk) in last 24 months
 *   - top_reasons              — top 5 recall-reason categories
 *   - sample_recalls           — 5 most recent recalls
 *
 * Runs via .github/workflows/fsis-weekly.yml Monday 04:00 UTC.
 * Locally: node scripts/fsis-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/fsis-recalls.json");

const FSIS_URL = "https://www.fsis.usda.gov/fsis/api/recall/v/1";
const UA = "TruNorth-FSIS/1.0 (+https://www.trunorthapp.com)";
const TWENTY_FOUR_MONTHS_MS = 730 * 24 * 60 * 60 * 1000;

// Some brand display names need different match tokens to hit FSIS's
// `field_establishment` strings (which are corporate legal names, often
// with sub-brands). When the brand slug is a key here, we OR-match using
// these tokens INSTEAD of the brand display name.
//
// Conservative — only added for brands we already know exist in FSIS
// data. Easy to extend.
const ESTABLISHMENT_ALIASES = {
  "tyson-foods":       ["Tyson Foods", "Tyson Fresh Meats", "Tyson Poultry", "Tyson Prepared Foods"],
  "jbs-n-v":           ["JBS"],
  "jbs":               ["JBS"],
  "smithfield-foods":  ["Smithfield"],
  "cargill":           ["Cargill"],
  "hormel-foods":      ["Hormel"],
  "perdue-farms":      ["Perdue"],
  "conagra-brands":    ["Conagra", "ConAgra"],
  "kraft-heinz":       ["Kraft Heinz", "Kraft Foods", "Heinz"],
  "general-mills":     ["General Mills"],
  "nestl":             ["Nestle", "Nestlé"],
  "nestle":            ["Nestle", "Nestlé"],
  "pilgrim-s-pride":   ["Pilgrim's Pride", "Pilgrims Pride"],
  "boar-s-head":       ["Boar's Head", "Boars Head"],
  "oscar-mayer":       ["Oscar Mayer"],
  "butterball":        ["Butterball"],
};

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function trim(s, max = 240) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Strip HTML tags from FSIS summary fields.
function stripHtml(s) {
  if (!s) return "";
  return String(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// Parse FSIS qty strings like "798 pounds " / "4,120 pounds" / "0 pounds"
// → integer pounds; null if unparseable.
function parsePounds(s) {
  if (!s) return null;
  const m = String(s).match(/([\d,]+(?:\.\d+)?)\s*pound/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Fetch the full FSIS recall dump (one HTTP request, ~10-15 MB).
//
// Akamai sometimes 403s; one retry with brief backoff handles transient
// edge issues without making the workflow brittle.
async function fetchFsisDump() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(FSIS_URL, {
        headers: {
          "User-Agent": UA,
          "Accept": "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error(`Unexpected response shape: ${typeof data}`);
      return data;
    } catch (err) {
      lastErr = err;
      console.warn(`FSIS fetch attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
  throw lastErr;
}

// Dedupe by recall_number, preferring English over Spanish records.
function dedupe(records) {
  const byNum = new Map();
  for (const r of records) {
    const num = r.field_recall_number || `${r.field_title}|${r.field_recall_date}`;
    const existing = byNum.get(num);
    const isEnglish = (r.langcode || "").toLowerCase() === "english";
    if (!existing) {
      byNum.set(num, r);
    } else {
      const existingIsEnglish = (existing.langcode || "").toLowerCase() === "english";
      if (isEnglish && !existingIsEnglish) byNum.set(num, r);
    }
  }
  return [...byNum.values()];
}

// Match a brand against an FSIS record by checking whether any of the
// brand's establishment-name tokens appears (case-insensitive) inside
// field_establishment. Token matching avoids false positives like
// "Cargo" → "Cargill" by requiring whole brand-name substring.
function matchesBrand(record, tokens) {
  const est = (record.field_establishment || "").toLowerCase();
  if (!est) return false;
  return tokens.some(t => est.includes(t.toLowerCase()));
}

function aggregateBrand(brand, records, scrapedAt) {
  const tokens = ESTABLISHMENT_ALIASES[brand.slug] || [brand.name];
  const matched = records.filter(r => matchesBrand(r, tokens));

  if (matched.length === 0) {
    return {
      slug: brand.slug,
      name: brand.name,
      tokens_used: tokens,
      status: "no_recalls",
      total_recalls: 0,
    };
  }

  // Newest first
  matched.sort((a, b) => {
    const ta = Date.parse(a.field_recall_date || 0);
    const tb = Date.parse(b.field_recall_date || 0);
    return tb - ta;
  });

  const cutoff = Date.now() - TWENTY_FOUR_MONTHS_MS;
  const recent24mo = matched.filter(r => {
    const t = Date.parse(r.field_recall_date || 0);
    return !Number.isNaN(t) && t > cutoff;
  });
  const recentClassI = recent24mo.filter(r =>
    /class\s*i\b/i.test(r.field_recall_classification || "") &&
    !/class\s*ii/i.test(r.field_recall_classification || "")
  );

  const reasons = matched.flatMap(r => {
    const raw = r.field_recall_reason || "";
    // FSIS reasons are often comma-separated e.g. "Misbranding, Unreported Allergens"
    return raw.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
  });

  const totalPounds = matched.reduce((s, r) => s + (parsePounds(r.field_qty_recovered) || 0), 0);

  return {
    slug:                  brand.slug,
    name:                  brand.name,
    tokens_used:           tokens,
    status:                "ok",
    total_recalls:         matched.length,
    recent_24mo_count:     recent24mo.length,
    recent_class_I_count:  recentClassI.length,
    total_pounds_recalled: totalPounds,
    establishments:        [...new Set(matched.map(r => r.field_establishment).filter(Boolean))].slice(0, 10),
    top_reasons:           topN(reasons, 5),
    sample_recalls:        matched.slice(0, 5).map(r => ({
      recall_number:   r.field_recall_number,
      recall_date:     r.field_recall_date,
      classification:  r.field_recall_classification,
      risk_level:      r.field_risk_level,
      establishment:   r.field_establishment,
      reason:          r.field_recall_reason,
      product:         trim(r.field_product_items, 320),
      pounds:          parsePounds(r.field_qty_recovered),
      qty_raw:         r.field_qty_recovered || null,
      states:          r.field_states,
      url:             r.field_recall_url,
      title:           trim(r.field_title, 240),
      summary:         trim(stripHtml(r.field_summary), 480),
    })),
    scraped_at:            scrapedAt,
  };
}

async function main() {
  console.log("FSIS recall fetcher starting...");

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  console.log(`Downloading FSIS recall dump from ${FSIS_URL} ...`);
  const dump = await fetchFsisDump();
  console.log(`Raw records: ${dump.length}`);

  const records = dedupe(dump);
  console.log(`After English-preferred dedupe: ${records.length}`);

  const scrapedAt = new Date().toISOString();
  const results = brands.map(b => aggregateBrand(b, records, scrapedAt));

  const withRecalls = results.filter(r => r.status === "ok").length;
  const noRecalls   = results.filter(r => r.status === "no_recalls").length;

  // Polite courtesy delay even though we only made 1 HTTP request;
  // 1 req/sec rate cap is a no-op here but satisfies stated policy.
  await new Promise(r => setTimeout(r, 1000));

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        scrapedAt,
    source_url:          FSIS_URL,
    raw_record_count:    dump.length,
    deduped_count:       records.length,
    brand_count:         brands.length,
    with_recalls_count:  withRecalls,
    no_recalls_count:    noRecalls,
    recalls:             results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With recalls: ${withRecalls}`);
  console.log(`   No recalls:   ${noRecalls}`);
}

main().catch(err => {
  console.error("fsis-fetch failed:", err);
  process.exit(1);
});
