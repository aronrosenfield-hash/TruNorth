#!/usr/bin/env node
/**
 * GSA SAM.gov Excluded Parties List integration (monthly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the public
 * SAM.gov exclusions search endpoint to determine whether that brand
 * (or anyone matching the brand name) is barred from federal contracts.
 *
 * Output: /public/data/gsa-sam-exclusions.json (overwritten monthly)
 *
 * Data source:
 *   https://sam.gov/api/prod/sgs/v1/search?index=ex&q=<brand>&qMode=ALL
 *
 * This is the same backend endpoint that powers https://sam.gov/exclusions.
 * It requires no API key. The official GSA Entity API
 * (https://open.gsa.gov/api/entity-api/) DOES require a free key — if we
 * ever need to switch, register at https://sam.gov/profile/account-details
 * (free, instant) and set GSA_SAM_API_KEY in env, then swap the BASE URL
 * to https://api.sam.gov/entity-information/v3/exclusions?api_key=...
 *
 * Per-brand aggregate (only emitted when at least one exclusion matches):
 *   - is_excluded:        boolean — any active exclusion matching this brand
 *   - exclusion_count:    total matches (active + terminated)
 *   - current_exclusions: count of currently active exclusions
 *   - sample_records:     up to 5 records {title, agency, reason, classification, date_added, date_expires, is_active}
 *
 * The dataset has ~167k records and is dominated by individuals + small
 * contractors. We expect most top-500 brands to show zero matches; the
 * value is catching the rare high-profile debarment (fraud, bribery,
 * sanctions evasion).
 *
 * Title-match strategy:
 *   The q= parameter is fuzzy and searches across all fields (title,
 *   address, etc.) — qMode=ALL just AND's the tokens. So we further
 *   filter results client-side: only keep records whose `title` contains
 *   the brand name as a substring (case-insensitive), or — when an alias
 *   list is provided — any of its aliases. This avoids false positives
 *   like "q=Halliburton" returning a CBP-debarred importer in NJ.
 *
 * Runs monthly via .github/workflows/gsa-sam-monthly.yml
 * Locally: node scripts/gsa-sam-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/gsa-sam-exclusions.json");

const SAM_BASE = "https://sam.gov/api/prod/sgs/v1/search";
const UA = "TruNorth-GSA-SAM/1.0 (+https://www.trunorthapp.com)";
const PAGE_SIZE = 200;   // server allows up to a few hundred per page
const MAX_PAGES = 5;     // 1,000 candidate results per brand is plenty
const REQ_DELAY_MS = 600;

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

const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

// Normalize a name for substring comparison: lowercase, strip punctuation,
// collapse whitespace. "JPMorgan Chase & Co." -> "jpmorgan chase co"
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Skip terms that would match almost anything. We never call the API with
// these alone, because the result set would be huge AND mostly noise.
const STOPWORDS = new Set([
  "the","of","and","a","an","co","corp","corporation","inc","incorporated",
  "llc","ltd","limited","group","holdings","company","companies","brands",
]);

// Token list for matching a record title against a brand name. We require
// that every non-stopword token from the brand appears in the title.
function brandTokens(brandName) {
  return normalize(brandName).split(" ").filter(t => t && !STOPWORDS.has(t));
}

// Common corporate-suffix tokens we accept after a brand phrase. We
// require the title to *equal* the brand phrase, or to equal "<brand>
// <suffix>" optionally with extra suffix words. This avoids false
// positives like "Apple Medical Supplies" or "Big Apple Designers" for
// brand=Apple. Better to miss a legitimate subsidiary than to flag an
// unrelated company.
const CORP_SUFFIXES = new Set([
  "inc","incorporated","corp","corporation","co","company","companies",
  "llc","ltd","limited","lp","llp","group","holdings","plc","ag","sa",
  "nv","gmbh","kg","kk","bv","spa","srl","pte","pty","usa","us","na",
  "international","intl","worldwide","global","brands","industries",
]);

function titleMatches(brandName, recordTitle) {
  const tokens = brandTokens(brandName);
  if (tokens.length === 0) return false;
  const t = normalize(recordTitle);
  const phrase = tokens.join(" ");

  // 1. Exact equality (after normalization). "APPLE INC." vs "Apple" —
  //    normalize both, then strip trailing suffixes from the record title.
  if (t === phrase) return true;

  // 2. Title starts with the brand phrase followed by a word boundary,
  //    and every remaining token in the title is a known corporate suffix.
  const titleTokens = t.split(" ");
  const brandLen = tokens.length;
  if (titleTokens.length < brandLen) return false;
  for (let i = 0; i < brandLen; i++) {
    if (titleTokens[i] !== tokens[i]) return false;
  }
  // All trailing tokens must be corporate-suffix-y.
  for (let i = brandLen; i < titleTokens.length; i++) {
    if (!CORP_SUFFIXES.has(titleTokens[i])) return false;
  }
  return true;
}

async function searchExclusions(brand) {
  const tokens = brandTokens(brand.name);
  if (tokens.length === 0) {
    return { status: "skipped_generic_name" };
  }
  // Query uses the brand name verbatim; qMode=ALL ANDs the tokens.
  const q = encodeURIComponent(brand.name);
  let allHits = [];
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${SAM_BASE}?index=ex&q=${q}&qMode=ALL&size=${PAGE_SIZE}&page=${page}`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          // SAM's gateway rejects "application/json" with HTTP 406; it advertises
          // itself as a HAL endpoint. Curl works because it sends "*/*".
          "Accept": "application/hal+json, application/json;q=0.9, */*;q=0.1",
        },
      });
    } catch (err) {
      return { status: "error", error: err.message };
    }
    if (!res.ok) {
      return { status: "error", code: res.status };
    }
    let data;
    try { data = await res.json(); }
    catch { return { status: "error", error: "json_parse" }; }

    total = data?.page?.totalElements ?? 0;
    const hits = data?._embedded?.results ?? [];
    allHits = allHits.concat(hits);
    if (hits.length < PAGE_SIZE) break;
    if (allHits.length >= total) break;
    await SLEEP(REQ_DELAY_MS);
  }

  // Client-side filter: only keep records whose title contains the full
  // brand phrase, AND whose classification is a corporate entity. We
  // exclude Individuals (random people with surnames like "Apple") and
  // Vessels (OFAC sanctions a ship named "DOVE" — unrelated to the soap
  // brand). What's left is "Firm" / "Special Entity Designation" etc.,
  // which is what we actually care about for corporate debarment.
  const matches = allHits.filter(r => {
    if (!titleMatches(brand.name, r.title)) return false;
    const cls = r.classification?.code || "";
    if (cls === "Individual" || cls === "Vessel") return false;
    return true;
  });

  if (matches.length === 0) {
    return {
      status: "no_match",
      raw_candidate_count: total,
    };
  }

  const active = matches.filter(r => r.isActive === true);
  const sample = matches.slice(0, 5).map(r => ({
    title:           r.title,
    agency:          r.excludingAgencyDesc || r.excludingAgency || null,
    classification:  r.classification?.code || null,
    exclusion_type:  r.exclusionType || null,
    exclusion_program: r.exclusionProgram || null,
    date_added:      r.activationDate || null,
    date_expires:    r.terminationDate || null,
    is_active:       r.isActive === true,
    uei_sam:         r.ueiSam || null,
    cage_code:       r.cageCode || null,
    record_id:       r._id || null,
  }));

  return {
    status:             "ok",
    is_excluded:        active.length > 0,
    exclusion_count:    matches.length,
    current_exclusions: active.length,
    sample_records:     sample,
  };
}

async function main() {
  console.log("🏛️  GSA SAM.gov exclusion fetcher starting…");
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    const out = await searchExclusions(brand);
    results.push({ slug: brand.slug, name: brand.name, ...out });
    if (i % 50 === 0) console.log(`  …${i}/${brands.length}`);
    await SLEEP(REQ_DELAY_MS);
  }

  const matched = results.filter(r => r.status === "ok");
  const excluded = matched.filter(r => r.is_excluded);
  const noMatch  = results.filter(r => r.status === "no_match").length;
  const errors   = results.filter(r => r.status === "error").length;
  const skipped  = results.filter(r => r.status === "skipped_generic_name").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date().toISOString(),
    source:              "sam.gov public exclusions search",
    source_endpoint:     SAM_BASE,
    brand_count:         brands.length,
    matched_count:       matched.length,
    actively_excluded:   excluded.length,
    no_match_count:      noMatch,
    error_count:         errors,
    skipped_count:       skipped,
    exclusions:          results,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   Brands with any match:    ${matched.length}`);
  console.log(`   Brands currently excluded:${excluded.length}`);
  console.log(`   No-match brands:          ${noMatch}`);
  console.log(`   Errors:                   ${errors}`);
  console.log(`   Skipped (generic name):   ${skipped}`);
  if (excluded.length > 0) {
    console.log("\n🚨 Actively excluded brands:");
    for (const e of excluded) {
      console.log(`   - ${e.name} (${e.slug}) — ${e.current_exclusions} active record(s)`);
    }
  }
}

main().catch(err => {
  console.error("❌ gsa-sam-fetch failed:", err);
  process.exit(1);
});
