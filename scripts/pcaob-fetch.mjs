#!/usr/bin/env node
/**
 * PCAOB Enforcement Actions scraper (monthly).
 *
 * The PCAOB (Public Company Accounting Oversight Board) publishes settled
 * disciplinary orders, adjudicated disciplinary orders, and bar terminations
 * for audit firms and individuals it sanctions. The public-facing index
 * (https://pcaobus.org/oversight/enforcement/enforcement-actions) is rendered
 * client-side via HawkSearch; we hit the underlying JSON endpoint directly.
 *
 * Endpoint (no auth, public): POST https://essearchapi-na.hawksearch.com/api/v2/search/
 *   body: { ClientGuid, Keyword, PageNo, MaxPerPage, IndexName,
 *           FacetSelections: { contenttypelabel: ["Enforcement Document"] } }
 *
 * For each brand in /public/data/top-500-brands.txt, the script searches the
 * Enforcement Document index by display name and aggregates hits whose
 * `title` (the respondent / firm caption) word-boundary-matches the brand.
 * This naturally covers both audit firms (KPMG, Deloitte, EY, PwC, BDO, etc.)
 * and their occasional audit-client co-respondents.
 *
 * Output: /public/data/pcaob-enforcement.json
 *
 * Per-brand aggregates:
 *   - total_PCAOB_actions_lifetime  — all-time match count
 *   - total_fines_usd               — null (PCAOB fine amounts live inside
 *                                     order PDFs; we don't pull them here to
 *                                     keep the pipeline dependency-free.
 *                                     Downstream can backfill from press
 *                                     releases or AuditAnalytics if needed)
 *   - latest_action_date            — most recent effective ISO date
 *   - sample_actions                — top 5 most recent (title, date,
 *                                     order_type, firm_id, pdf_url)
 *
 * Rate limit: 1 req/sec. UA: "TruNorth-PCAOB/1.0".
 *
 * Runs via .github/workflows/pcaob-monthly.yml on the 1st @ 16:00 UTC.
 * Locally: node scripts/pcaob-fetch.mjs              (all brands)
 *          node scripts/pcaob-fetch.mjs --smoke      (KPMG/Deloitte/EY/PwC/BDO)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/pcaob-enforcement.json");

const API_URL    = "https://essearchapi-na.hawksearch.com/api/v2/search/";
const CLIENT_GUID = "e962e95324cb46ef8955c0b09a3904b9";
const INDEX_NAME  = "pcaob.20260515.140735.all-data-types";
const UA          = "TruNorth-PCAOB/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const MAX_PER_PAGE = 100;
const MAX_PAGES    = 10; // 1000 hits cap per brand (more than enough; biggest
                          // audit firms have <100 lifetime actions)

const SMOKE = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set(["kpmg", "deloitte", "ey", "pwc", "bdo"]);

// Aliases for audit firms whose case-caption form differs from display name.
// Adjudicated orders typically cite the legal entity name ("KPMG LLP",
// "Deloitte & Touche LLP", "Ernst & Young LLP").
const BRAND_ALIASES = {
  "EY":         { aliases: ["Ernst & Young", "Ernst Young"] },
  "PwC":        { aliases: ["PricewaterhouseCoopers", "Pricewaterhouse Coopers"] },
  "KPMG":       { aliases: ["KPMG LLP"] },
  "Deloitte":   { aliases: ["Deloitte & Touche", "Deloitte Touche", "Deloitte LLP"] },
  "BDO":        { aliases: ["BDO USA", "BDO Seidman"] },
  // Short brand names that risk false positives — only match strict aliases.
  "Meta":       { strictOnly: true, aliases: ["Meta Platforms"] },
  "Apple":      { strictOnly: true, aliases: ["Apple Inc"] },
  "Target":     { strictOnly: true, aliases: ["Target Corporation"] },
};

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchPage(keyword, pageNo) {
  const body = {
    ClientGuid: CLIENT_GUID,
    Keyword: keyword,
    PageNo: pageNo,
    MaxPerPage: MAX_PER_PAGE,
    IndexName: INDEX_NAME,
    FacetSelections: { contenttypelabel: ["Enforcement Document"] },
  };
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for keyword="${keyword}" page=${pageNo}`);
  return res.json();
}

function brandRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}\\b`, "i");
}

function matchersFor(brand) {
  const entry = BRAND_ALIASES[brand.name];
  let names;
  if (entry && !Array.isArray(entry) && entry.strictOnly) {
    names = entry.aliases;
  } else if (entry && Array.isArray(entry.aliases)) {
    names = [brand.name, ...entry.aliases];
  } else if (Array.isArray(entry)) {
    names = [brand.name, ...entry];
  } else {
    names = [brand.name];
  }
  return names.map(brandRegex);
}

// Pull fields out of one HawkSearch result row.
function normalizeHit(row) {
  const d = row.Document || {};
  const first = (k) => Array.isArray(d[k]) ? d[k][0] : d[k];
  // enforcementorderdocument is JSON-encoded — parse for the PDF URL.
  let pdfUrl = null;
  const rawOrder = first("enforcementorderdocument");
  if (rawOrder && typeof rawOrder === "string") {
    try {
      const o = JSON.parse(rawOrder);
      pdfUrl = o.mediaUrl || null;
    } catch { /* ignore */ }
  }
  return {
    title:      first("title") || "",
    date:       first("effectivedate") || first("publicationdate") || "",
    order_type: first("enforcementordertypes") || "",
    firm_id:    first("firmid") || null,
    pdf_url:    pdfUrl,
    doc_id:     row.DocId || first("id") || null,
  };
}

async function fetchAllForBrand(brand) {
  // We search by the display name (lets HawkSearch's tokenizer do its job);
  // we then filter the results by our brand-aware regex.
  const regexes = matchersFor(brand);
  const seen = new Set();
  const hits = [];

  // Use the broadest keyword that disambiguates well — usually the brand name.
  // For strictOnly brands we use the first alias as the query string.
  const entry = BRAND_ALIASES[brand.name];
  const keyword = (entry && !Array.isArray(entry) && entry.strictOnly)
    ? entry.aliases[0]
    : brand.name;

  for (let p = 1; p <= MAX_PAGES; p++) {
    let resp;
    try {
      resp = await searchPage(keyword, p);
    } catch (e) {
      return { status: "error", error: e.message, partial: hits.length };
    }
    const results = resp.Results || [];
    for (const r of results) {
      const h = normalizeHit(r);
      if (!h.title) continue;
      if (!regexes.some(re => re.test(h.title))) continue;
      const key = h.doc_id || `${h.title}|${h.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }
    const pag = resp.Pagination || {};
    const total = pag.NofResults || 0;
    if (results.length === 0) break;
    if (p * MAX_PER_PAGE >= total) break;
    await sleep(REQ_DELAY_MS);
  }

  if (hits.length === 0) {
    return { status: "no_actions" };
  }

  // newest first
  hits.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const sample = hits.slice(0, 5);

  return {
    status: "ok",
    total_PCAOB_actions_lifetime: hits.length,
    total_fines_usd: null, // not extractable from index metadata (lives in PDF)
    latest_action_date: hits[0].date || null,
    sample_actions: sample,
  };
}

async function main() {
  console.log("PCAOB enforcement fetcher starting…");
  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE) {
    brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));
    console.log(`SMOKE — testing ${brands.length}: ${brands.map(b => b.slug).join(", ")}`);
    if (brands.length === 0) {
      // smoke firms may not be in top-500; synthesize minimal entries.
      brands = [
        { slug: "kpmg",     name: "KPMG",     category: "Professional Services" },
        { slug: "deloitte", name: "Deloitte", category: "Professional Services" },
        { slug: "ey",       name: "EY",       category: "Professional Services" },
        { slug: "pwc",      name: "PwC",      category: "Professional Services" },
        { slug: "bdo",      name: "BDO",      category: "Professional Services" },
      ];
      console.log(`(smoke brands not in brands.txt — using synthesized list)`);
    }
  }

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    const r = await fetchAllForBrand(brand);
    results.push({ slug: brand.slug, name: brand.name, ...r });
    if (r.status === "ok") {
      console.log(`  ${brand.slug}: ${r.total_PCAOB_actions_lifetime} actions (latest ${r.latest_action_date?.slice(0,10) || "?"})`);
    }
    if (i % 25 === 0 && i > 0) console.log(`  …${i}/${brands.length}`);
    await sleep(REQ_DELAY_MS);
  }

  const okCount   = results.filter(r => r.status === "ok").length;
  const noneCount = results.filter(r => r.status === "no_actions").length;
  const errCount  = results.filter(r => r.status === "error").length;

  const outPath = SMOKE ? OUT_FILE.replace(/\.json$/, ".smoke.json") : OUT_FILE;
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:        new Date().toISOString(),
    smoke:               SMOKE || undefined,
    source:              "pcaob-enforcement-actions",
    source_url:          "https://pcaobus.org/oversight/enforcement/enforcement-actions",
    brand_count:         brands.length,
    with_actions_count:  okCount,
    no_actions_count:    noneCount,
    error_count:         errCount,
    firms:               results,
  }, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`   With actions: ${okCount}`);
  console.log(`   None:         ${noneCount}`);
  console.log(`   Errors:       ${errCount}`);
}

main().catch(err => {
  console.error("pcaob-fetch failed:", err);
  process.exit(1);
});
