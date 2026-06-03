#!/usr/bin/env node
/**
 * HUD Fair Housing — monthly enforcement fetch.
 *
 * The Department of Housing and Urban Development's Office of Fair Housing
 * and Equal Opportunity (FHEO) publishes:
 *   - Charges filed under the Fair Housing Act (landlords, mortgage lenders,
 *     real-estate firms, HOAs, municipalities)
 *   - Conciliation agreements & settlements (with $ amounts)
 *   - Final agency decisions
 *
 * The canonical public surfaces are:
 *   - https://www.hud.gov/program_offices/fair_housing_equal_opp/enforcement
 *   - https://archives.hud.gov/news/  (older press releases)
 *   - https://www.hud.gov/press/press_releases_media_advisories  (newer)
 *
 * HUD does NOT publish a structured JSON dataset of FHEO charges
 * per landlord/lender, so this fetcher relies on HUD's own press-release
 * search endpoint (which indexes both charge announcements and settlement
 * announcements) and parses each matching page for charge/settlement
 * structured data.
 *
 * Output: /public/data/hud-fairhousing.json (overwritten monthly)
 *
 * Per-brand aggregates (5-year window):
 *   - total_HUD_charges_5y     count of FHEO charge press releases
 *   - total_settlements_usd    summed $ across conciliation/settlement releases
 *   - top_violations           breakdown (race, disability, familial status,
 *                              national origin, sex, religion, source-of-income,
 *                              redlining, accessibility, retaliation)
 *   - sample_cases             up to 5 most recent (title, date, url, type, $)
 *
 * Smoke targets (--smoke): wells-fargo, bank-of-america (mortgage redlining),
 * realtor-com, zillow (digital-platform steering / advertising cases).
 *
 * Honor-system courtesy: 1 req/sec between HTTP calls,
 * UA "TruNorth-HUD/1.0".
 *
 * Runs via .github/workflows/hud-monthly.yml — 1st of month 19:00 UTC.
 *
 * Locally:    node scripts/hud-fetch.mjs
 * Smoke test: node scripts/hud-fetch.mjs --smoke
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/hud-fairhousing.json");

const UA          = "TruNorth-HUD/1.0 (+https://www.trunorthapp.com)";
const HUD_HOST    = "https://www.hud.gov";
// HUD's site-search endpoint. It indexes press releases under
// /press/press_releases_media_advisories/ and returns an HTML results page
// listing each hit with title + permalink + date. We parse the result HTML.
const HUD_SEARCH  = `${HUD_HOST}/press/press_releases_media_advisories/search`;

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const SMOKE = process.argv.includes("--smoke");
const SMOKE_SLUGS = new Set([
  "wells-fargo",
  "bank-of-america",
  "realtor-com",
  "zillow",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── brand loading ────────────────────────────────────────────────────────
async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  const brands = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name] = l.split("|").map((s) => s.trim());
      return { slug, name };
    })
    .filter((b) => b.slug && b.name);

  if (SMOKE) {
    const filtered = brands.filter((b) => SMOKE_SLUGS.has(b.slug));
    const have = new Set(filtered.map((b) => b.slug));
    for (const slug of SMOKE_SLUGS) {
      if (!have.has(slug)) {
        filtered.push({ slug, name: slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") });
      }
    }
    return filtered;
  }
  return brands;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────
async function hudFetch(url) {
  await sleep(1000); // 1 req/sec courtesy
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept":     "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) return { ok: false, status: res.status, html: "" };
  return { ok: true, status: res.status, html: await res.text() };
}

// ─── HTML parsing helpers ─────────────────────────────────────────────────
function stripTags(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract result links from the HUD press-release search page. The search
// page renders each result as <a href="/press/press_releases_media_advisories/HUD_No_..." …>title</a>
// in a results list. We pull every press-release-style anchor.
function extractSearchResults(html) {
  const links = [];
  const re = /<a\s+[^>]*href="([^"]*\/press\/press_releases_media_advisories\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].startsWith("http") ? m[1] : `${HUD_HOST}${m[1]}`;
    const title = stripTags(m[2]);
    if (!title || title.length < 8) continue;
    if (/\/search/i.test(href)) continue;
    links.push({ url: href, title });
  }
  // dedupe by url
  const seen = new Set();
  return links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

// Pull a release date from a press-release HTML page. HUD's pages typically
// surface dates like "WASHINGTON - June 5, 2024" or a <time> element.
function extractReleaseDate(html) {
  const tm = /<time[^>]*datetime="([^"]+)"/i.exec(html);
  if (tm) {
    const d = new Date(tm[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const text = stripTags(html);
  const m = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/.exec(text);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Also try the URL itself: HUD_No_24-123 → 2024
  return null;
}

// Pull a dollar amount from text — e.g. "$1.5 million", "$250,000", "$2,500,000"
function extractDollarAmount(text) {
  const t = String(text || "");
  // Largest "$X.X million/billion" first
  let max = 0;
  const mil = /\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion|m|b)\b/gi;
  let m;
  while ((m = mil.exec(t)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    const mult = /^b/i.test(m[2]) ? 1e9 : 1e6;
    const v = Math.round(n * mult);
    if (v > max) max = v;
  }
  if (max > 0) return max;
  // Plain $123,456 — pick the largest in the text
  const plain = /\$\s*([\d]{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?)/g;
  while ((m = plain.exec(t)) !== null) {
    const v = Math.round(parseFloat(m[1].replace(/,/g, "")));
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max || 0;
}

// Classify a press release into charge / settlement / decision based on
// title + body keywords.
function classifyRelease(titleAndBody) {
  const t = titleAndBody.toLowerCase();
  const isCharge =
    /\bcharge[sd]?\b/.test(t) ||
    /\bfiles?\s+complaint\b/.test(t) ||
    /\binitiate[sd]?\s+enforcement\b/.test(t);
  const isSettlement =
    /\bsettle(?:s|d|ment)?\b/.test(t) ||
    /\bconciliation\b/.test(t) ||
    /\bagree(?:s|d|ment)\s+to\s+pay\b/.test(t) ||
    /\bresolve[sd]?\b/.test(t) ||
    /\bvoluntary\s+compliance\b/.test(t);
  return {
    is_charge:     isCharge && !isSettlement,
    is_settlement: isSettlement,
  };
}

// Detect protected-class / violation categories mentioned in the page.
const VIOLATION_PATTERNS = [
  { label: "race",                re: /\b(race|racial|african[-\s]american|black|hispanic|latino)\b/i },
  { label: "disability",          re: /\b(disabilit|wheelchair|service animal|accessib|reasonable accommodation)/i },
  { label: "familial-status",     re: /\b(familial status|families with children|with children|child(?:ren)?)\b/i },
  { label: "national-origin",     re: /\bnational origin\b/i },
  { label: "sex",                 re: /\b(sex|gender|sexual harassment|sexual orientation|gender identity|lgbt)\b/i },
  { label: "religion",            re: /\b(religion|religious|muslim|jewish|christian)\b/i },
  { label: "source-of-income",    re: /\b(source of income|housing voucher|section 8|housing choice voucher)\b/i },
  { label: "redlining",           re: /\b(redlin|modern[-\s]day redlining|disparate impact|appraisal bias)\b/i },
  { label: "accessibility-design",re: /\b(design and construction|accessibility design|ada|fair housing accessibility)/i },
  { label: "retaliation",         re: /\bretaliat/i },
  { label: "advertising",         re: /\b(discriminatory advertis|targeted advertis|advertis(?:ing|ement))/i },
];

function extractViolations(text) {
  const out = [];
  for (const { label, re } of VIOLATION_PATTERNS) {
    if (re.test(text)) out.push(label);
  }
  return out;
}

// ─── per-brand fetch ──────────────────────────────────────────────────────
function buildSearchUrls(brand) {
  // HUD's site search accepts ?q=...&type=press
  // We issue two searches to maximize recall: brand name + "fair housing"
  // and brand name + "FHEO" anchor.
  const q  = encodeURIComponent(`"${brand.name}" fair housing`);
  const q2 = encodeURIComponent(`"${brand.name}" FHEO`);
  return [
    `${HUD_SEARCH}?q=${q}`,
    `${HUD_SEARCH}?q=${q2}`,
  ];
}

async function fetchBrandCases(brand, now) {
  const urls = buildSearchUrls(brand);
  const allHits = [];
  for (const url of urls) {
    const r = await hudFetch(url);
    if (!r.ok) continue;
    const hits = extractSearchResults(r.html);
    allHits.push(...hits);
  }
  // dedupe by url
  const seen = new Set();
  const hits = allHits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));

  if (hits.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_records" };
  }

  // Filter to plausible brand mentions in title (cheap relevance filter)
  const brandNorm = brand.name.toLowerCase();
  const candidates = hits.filter((h) =>
    h.title.toLowerCase().includes(brandNorm) ||
    h.title.toLowerCase().includes(brand.slug.replace(/-/g, " "))
  );

  if (candidates.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_records", searched: hits.length };
  }

  // Fetch each candidate page (capped at 25 for runtime / politeness)
  const cutoff = now - FIVE_YEARS_MS;
  const detailed = [];
  for (const hit of candidates.slice(0, 25)) {
    const page = await hudFetch(hit.url);
    if (!page.ok) continue;
    const text = stripTags(page.html);
    // Confirm the brand actually appears in body (rejects unrelated mentions)
    if (!text.toLowerCase().includes(brandNorm)) continue;
    const date = extractReleaseDate(page.html);
    if (!date) continue;
    if (date.getTime() < cutoff) continue;

    const { is_charge, is_settlement } = classifyRelease(`${hit.title} ${text.slice(0, 4000)}`);
    if (!is_charge && !is_settlement) continue;

    const violations = extractViolations(`${hit.title} ${text.slice(0, 6000)}`);
    const amount = is_settlement ? extractDollarAmount(text) : 0;

    detailed.push({
      title:         hit.title,
      url:           hit.url,
      date:          date.toISOString().slice(0, 10),
      is_charge,
      is_settlement,
      settlement_usd: amount,
      violations,
    });
  }

  if (detailed.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_records", searched: hits.length, candidates: candidates.length };
  }

  const charges = detailed.filter((d) => d.is_charge).length;
  const settlements = detailed.filter((d) => d.is_settlement);
  const totalSettlement = settlements.reduce((s, d) => s + (d.settlement_usd || 0), 0);

  // Top violations across all matched cases
  const counts = {};
  for (const d of detailed) for (const v of d.violations) counts[v] = (counts[v] || 0) + 1;
  const topViolations = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  // 5 most recent cases as sample
  const sample = detailed
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
    .map((d) => ({
      date:           d.date,
      title:          d.title,
      url:            d.url,
      type:           d.is_charge ? "charge" : "settlement",
      settlement_usd: d.settlement_usd || null,
      violations:     d.violations,
    }));

  return {
    slug:                   brand.slug,
    name:                   brand.name,
    status:                 "ok",
    total_HUD_charges_5y:   charges,
    settlement_count_5y:    settlements.length,
    total_settlements_usd:  Math.round(totalSettlement),
    top_violations:         topViolations,
    sample_cases:           sample,
    matched_case_count:     detailed.length,
    scraped_at:             new Date().toISOString(),
  };
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`HUD Fair Housing fetcher starting${SMOKE ? " (SMOKE)" : ""}...`);
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brand${brands.length === 1 ? "" : "s"}`);

  const now = Date.now();
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    try {
      const r = await fetchBrandCases(brands[i], now);
      results.push(r);
    } catch (err) {
      results.push({ slug: brands[i].slug, name: brands[i].name, status: "error", error: err.message });
    }
    if (i % 25 === 0) console.log(`  …${i}/${brands.length}`);
  }

  const ok        = results.filter((r) => r.status === "ok").length;
  const noRecords = results.filter((r) => r.status === "no_records").length;
  const errors    = results.filter((r) => r.status === "error").length;

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:         new Date().toISOString(),
    source_url:           "https://www.hud.gov/program_offices/fair_housing_equal_opp/enforcement",
    search_endpoint:      HUD_SEARCH,
    brand_count:          brands.length,
    with_records_count:   ok,
    no_records_count:     noRecords,
    error_count:          errors,
    brands:               results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  With records: ${ok}`);
  console.log(`  No records:   ${noRecords}`);
  console.log(`  Errors:       ${errors}`);

  if (SMOKE) {
    console.log("\nSMOKE summary:");
    for (const r of results) {
      if (r.status !== "ok") {
        console.log(`  ${r.slug.padEnd(20)} status=${r.status}`);
        continue;
      }
      console.log(
        `  ${r.slug.padEnd(20)} charges=${String(r.total_HUD_charges_5y).padStart(3)} ` +
        `settlements=${String(r.settlement_count_5y).padStart(3)} ` +
        `$=${r.total_settlements_usd.toLocaleString()} ` +
        `top=${r.top_violations.map((v) => v.label).join(",") || "-"}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("hud-fetch failed:", err);
  process.exit(1);
});
