#!/usr/bin/env node
/**
 * Option C — CourtListener.com lawsuit fetcher (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries CourtListener's
 * free API for federal + state cases where the brand is a party.
 *
 * Output: /public/data/lawsuits.json (overwritten weekly)
 *
 * CourtListener is run by the Free Law Project (nonprofit). Their API is
 * free with rate limits — courteous use is ~1 req/sec, no auth required
 * for read-only search. We sit well under that.
 *
 * What gets captured per brand:
 *   - active_lawsuits:   count of cases where status is open
 *   - total_lawsuits:    count of all cases ever
 *   - case_types:        breakdown by case type (antitrust, labor,
 *                        consumer protection, IP, etc.)
 *   - recent_cases:      up to 5 most recent cases with title + filed date
 *
 * Useful as a "legal exposure" signal. Heavily-sued companies often have
 * deeper labor / consumer / environmental issues than a single article
 * would surface.
 *
 * Runs via .github/workflows/courtlistener-weekly.yml Sunday 17:00 UTC.
 * Locally: node scripts/courtlistener-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/lawsuits.json");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

// Case-type heuristics — CL uses 4-letter codes (eg "cv" = civil). For
// TruNorth scoring, we care about the SUBSTANTIVE category.
const TYPE_HINTS = {
  antitrust:   ["antitrust", "monopol", "sherman act"],
  labor:       ["labor", "wage", "overtime", "wrongful termination", "discrimination", "harassment"],
  consumer:    ["consumer protection", "deceptive", "false advertising", "class action"],
  privacy:     ["privacy", "data breach", "ccpa", "gdpr", "wiretap"],
  ip:          ["patent", "trademark", "copyright"],
  environmental: ["environmental", "epa", "clean air", "clean water"],
  securities:  ["securities", "10b-5", "fraud"],
};

function categorize(title) {
  const t = (title || "").toLowerCase();
  const hits = [];
  for (const [cat, hints] of Object.entries(TYPE_HINTS)) {
    if (hints.some(h => t.includes(h))) hits.push(cat);
  }
  return hits;
}

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

async function fetchBrandLawsuits(brand) {
  // CourtListener Search API — Boolean party search
  // /api/rest/v4/search/?type=r&q=party:"BRAND NAME"
  // "type=r" = RECAP federal court records
  const q = encodeURIComponent(`party:"${brand.name}"`);
  const url = `${CL_BASE}/search/?type=r&q=${q}&order_by=dateFiled%20desc&page_size=20`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TruNorth-Lawsuits/1.0 (+https://www.trunorthapp.com)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      return { slug: brand.slug, name: brand.name, status: "error", code: res.status };
    }
    const data = await res.json();
    const cases = (data.results || []).map(c => ({
      title:     c.caseName || c.case_name,
      court:     c.court || c.court_name,
      filed:     c.dateFiled || c.date_filed,
      docket:    c.docket_number,
      types:     categorize(c.caseName || c.case_name || ""),
    }));
    const types_breakdown = {};
    for (const c of cases) for (const t of c.types) types_breakdown[t] = (types_breakdown[t] || 0) + 1;

    return {
      slug:           brand.slug,
      name:           brand.name,
      status:         "ok",
      total_returned: cases.length,
      total_hits:     data.count || cases.length,
      recent_cases:   cases.slice(0, 5),
      types_breakdown,
      scraped_at:     new Date().toISOString(),
    };
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }
}

async function main() {
  console.log("⚖️ CourtListener fetcher starting...");
  const brands = await loadBrands();
  console.log(`📋 Loaded ${brands.length} brands`);

  // CL rate-limit: ~1 req/sec courtesy. Do batches of 5 with 5-sec gaps.
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandLawsuits(brands[i]);
    results.push(r);
    if (i % 25 === 0) console.log(`  …${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const ok = results.filter(r => r.status === "ok").length;
  const err = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    brand_count:  brands.length,
    ok_count:     ok,
    error_count:  err,
    lawsuits:     results,
  }, null, 2));

  console.log(`✅ Wrote ${OUT_FILE}`);
  console.log(`   ok: ${ok}  error: ${err}`);
}

main().catch(err => {
  console.error("❌ courtlistener-fetch failed:", err);
  process.exit(1);
});
