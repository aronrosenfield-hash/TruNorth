#!/usr/bin/env node
/**
 * Employee Ratings Aggregator — Glassdoor + Indeed + AmbitionBox + Wikidata
 *
 * ⚠️ TOS WARNING — READ BEFORE --apply ⚠️
 *   Glassdoor and Indeed *explicitly forbid* automated retrieval of their
 *   pages in their Terms of Service. AmbitionBox is less aggressive but
 *   still discourages it. Even though these pages render employer-rating
 *   metadata server-side without a login, scraping them at scale exposes
 *   TruNorth to ToS / CFAA risk.
 *
 *   The pipeline below is *built* (so the engineering work isn't lost)
 *   but the live --apply path is GATED on an env flag
 *   `EMPLOYEE_RATINGS_LIVE=1`. Without it, --apply still runs but only
 *   exercises the Wikidata-only fallback (which is fully ToS-compatible:
 *   Wikidata is CC0). This lets us ship a partial-signal pipeline today
 *   and turn on the scraper later if/when Legal signs off.
 *
 *   See PR description: "feat: Employee ratings aggregator (sprint G —
 *   labor) ⚠️ ToS review needed".
 *
 * SOURCE TIERS
 *   1. Wikidata SPARQL — pulls every company with property
 *      P3057 (Glassdoor company ID) and/or P3475 (Indeed company ID).
 *      Gives us slug + canonical name + GD id + IND id. CC0 license.
 *      ALWAYS the first pass — even if scraping is disabled it tags
 *      "has-public-employee-rating-page" which is itself a signal.
 *
 *   2. Glassdoor company page (gated on EMPLOYEE_RATINGS_LIVE=1):
 *        https://www.glassdoor.com/Overview/Working-at-<Slug>-EI_IE<ID>.htm
 *      Server-rendered JSON-LD <script type="application/ld+json"> blob
 *      contains aggregateRating + reviewCount. Also og:description has
 *      "X out of 5" copy.
 *
 *   3. Indeed company page (gated on EMPLOYEE_RATINGS_LIVE=1):
 *        https://www.indeed.com/cmp/<slug>
 *      Same idea — JSON-LD on the company landing page surfaces the
 *      aggregate rating + counts.
 *
 *   4. AmbitionBox supplemental (less aggressive bot wall but India-
 *      focused; gated on EMPLOYEE_RATINGS_LIVE=1):
 *        https://www.ambitionbox.com/overview/<slug>-overview
 *
 * Output (cache, one file per slug):
 *   /public/data/_cache/employee-ratings/<slug>.json
 * Output (aggregate raw snapshot, written by --apply):
 *   /data/raw/employee-ratings/<YYYY-MM-DD>.json
 *
 * Per-brand record shape:
 *   {
 *     slug,
 *     name,
 *     glassdoor: { id, rating, recommend_to_friend_pct, ceo_approval_pct,
 *                  review_count, url, status, year },
 *     indeed:    { id, rating, review_count, url, status, year },
 *     ambitionbox:{ slug, rating, review_count, url, status, year },
 *     wikidata:  { glassdoor_id, indeed_id, employees, founded, hq_country },
 *     primary_signal: "wikidata-only" | "glassdoor" | "indeed" | "ambitionbox",
 *     last_updated,
 *   }
 *
 * Flags:
 *   --dry   (default) — no network. Reads cache if exists, otherwise
 *                       returns Wikidata-shape synthetic fixture so merger
 *                       can be tested end-to-end.
 *   --apply — runs the Wikidata SPARQL query always; runs Glassdoor +
 *             Indeed + AmbitionBox scrape ONLY if EMPLOYEE_RATINGS_LIVE=1.
 *   --slug X — limit to single slug for debugging.
 *
 * Runs via .github/workflows/employee-ratings-quarterly.yml on the
 * 15th of Jan/Apr/Jul/Oct at 05:00 UTC.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const CACHE_DIR = path.join(ROOT, "public/data/_cache/employee-ratings");
const RAW_DIR   = path.join(ROOT, "data/raw/employee-ratings");

const UA = "TruNorth-EmployeeRatings/1.0 (+https://www.trunorthapp.com; research aggregation)";
const RATE_LIMIT_MS = 2000;   // 2s between brand-level requests (courteous)
const REQUEST_TIMEOUT_MS = 15000;

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

const argv     = new Set(process.argv.slice(2));
const APPLY    = argv.has("--apply");
const DRY      = !APPLY;
const LIVE_SCRAPE = process.env.EMPLOYEE_RATINGS_LIVE === "1";
const SLUG_ARG = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ─────────────────────────── helpers ────────────────────────────

export function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Extract a JSON-LD aggregateRating from raw HTML. Returns
// { ratingValue, reviewCount } or null.
// Glassdoor + Indeed both ship `<script type="application/ld+json">` blocks
// on the company-overview page; we scan each block (there may be several
// — breadcrumbs, organization, employer review aggregate, etc) and pick
// the first one with an aggregateRating sub-object.
export function extractAggregateRating(html) {
  if (!html || typeof html !== "string") return null;
  const blocks = [...html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];
  for (const m of blocks) {
    let raw = m[1].trim();
    // Sometimes wrapped in CDATA or has trailing whitespace.
    raw = raw.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    // Could be an array of @graph items.
    const items = Array.isArray(data) ? data : (data["@graph"] || [data]);
    for (const it of items) {
      const ar = it?.aggregateRating;
      if (ar && (ar.ratingValue || ar.value)) {
        return {
          ratingValue: safeNumber(ar.ratingValue ?? ar.value),
          reviewCount: safeNumber(ar.reviewCount ?? ar.ratingCount ?? null),
        };
      }
    }
  }
  return null;
}

// Glassdoor exposes recommend-to-friend % + CEO approval % only via
// inline data attributes / og:description copy ("Recommend to a friend: 73%,
// Approve of CEO: 81%"). Pulled with permissive regex; either or both may
// be null.
export function extractGlassdoorExtras(html) {
  if (!html) return { recommend_to_friend_pct: null, ceo_approval_pct: null };
  const rec = html.match(/Recommend[^%<]{0,40}?(\d{1,3})\s*%/i);
  const ceo = html.match(/(?:Approve of CEO|CEO Approval)[^%<]{0,40}?(\d{1,3})\s*%/i);
  return {
    recommend_to_friend_pct: rec ? safeNumber(rec[1]) : null,
    ceo_approval_pct:        ceo ? safeNumber(ceo[1]) : null,
  };
}

// AbortController-based timeout — Node 22 native, no dep.
async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─────────────────────────── Wikidata ───────────────────────────
// SPARQL: every Wikidata item with a Glassdoor company ID (P3057) OR an
// Indeed company ID (P3475). Also pulls employees count (P1128),
// inception (P571), country of HQ (P17 via P159).
//
// LIMIT 5000 is well above the ~3-4k US-co items with these properties.
// CC0 license — no ToS issue.

// Filter out humans by excluding P31 wd:Q5. We tried the more correct
// "instance-of organization" filter (P31/P279* wd:Q43229) but the
// transitive closure timed out the public SPARQL endpoint. Excluding humans
// (the dominant polluter) and books (Q571) keeps the query fast and yields
// >95% real organizations.
export const WIKIDATA_QUERY = `
SELECT ?item ?itemLabel ?gd ?ind ?employees ?founded ?hqCountryLabel WHERE {
  { ?item wdt:P3057 ?gd. }
  UNION
  { ?item wdt:P3475 ?ind. }
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 . }
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q571 . }
  OPTIONAL { ?item wdt:P3057 ?gd. }
  OPTIONAL { ?item wdt:P3475 ?ind. }
  OPTIONAL { ?item wdt:P1128 ?employees. }
  OPTIONAL { ?item wdt:P571 ?founded. }
  OPTIONAL { ?item wdt:P159 ?hq. ?hq wdt:P17 ?hqCountry. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 10000`;

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Strip the most common corporate-suffix noise so "Walmart Inc." matches
// TruNorth's "walmart". We strip from the END only, repeatedly, since
// many Wikidata labels have layered suffixes ("The Walmart Corporation Inc.").
const CORP_SUFFIXES = [
  "inc", "incorporated", "corp", "corporation", "company", "co",
  "ltd", "limited", "llc", "plc", "ag", "sa", "se", "nv", "bv",
  "gmbh", "kg", "kgaa", "group", "holdings", "holding", "international",
  "global", "the",
];
export function slugifyCorp(name) {
  let s = slugify(name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of CORP_SUFFIXES) {
      const pat = new RegExp(`(?:^${suf}-|-${suf}$|^${suf}$)`);
      if (pat.test(s)) {
        s = s.replace(pat, "").replace(/^-+|-+$/g, "");
        changed = true;
      }
    }
  }
  return s;
}

// Best-effort match: try direct slug, then corp-suffix-stripped slug,
// then a slug-aliases lookup (if loaded). Returns the matched company
// slug or null.
export function matchSlug(name, realSlugs, aliases = {}) {
  const direct = slugify(name);
  if (realSlugs.has(direct)) return direct;
  const stripped = slugifyCorp(name);
  if (stripped && realSlugs.has(stripped)) return stripped;
  if (aliases[direct] && realSlugs.has(aliases[direct])) return aliases[direct];
  if (aliases[stripped] && realSlugs.has(aliases[stripped])) return aliases[stripped];
  return null;
}

export function parseWikidataResults(json) {
  // Normalize SPARQL JSON binding rows into TruNorth-shaped records, dedup'd
  // by company QID (one row per item, preferring rows with both GD and Indeed
  // IDs over rows with only one).
  const rows = json?.results?.bindings || [];
  const byItem = new Map();
  for (const r of rows) {
    const qid = r.item?.value?.split("/").pop();
    if (!qid) continue;
    const label = r.itemLabel?.value;
    const gd  = r.gd?.value || null;
    const ind = r.ind?.value || null;
    const emp = r.employees?.value ? Number(r.employees.value) : null;
    const founded = r.founded?.value ? r.founded.value.slice(0, 10) : null;
    const hq = r.hqCountryLabel?.value || null;
    const existing = byItem.get(qid);
    const candidate = { qid, label, gd, ind, emp, founded, hq };
    if (!existing) {
      byItem.set(qid, candidate);
      continue;
    }
    // Prefer the row with the most signal.
    const score = (x) => (x.gd ? 1 : 0) + (x.ind ? 1 : 0) + (x.emp ? 1 : 0);
    if (score(candidate) > score(existing)) byItem.set(qid, candidate);
  }
  return [...byItem.values()].map(r => ({
    // Default slug is the naive form; the caller (main / merger) is
    // expected to run matchSlug() against the real-slug set to widen the
    // match (corp-suffix stripping, alias map).
    slug: slugify(r.label || r.qid),
    name: r.label || r.qid,
    qid: r.qid,
    glassdoor_id: r.gd,
    indeed_id: r.ind,
    employees: r.emp,
    founded: r.founded,
    hq_country: r.hq,
  }));
}

async function fetchWikidata() {
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(WIKIDATA_QUERY)}&format=json`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" },
  }, 120_000);
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}`);
  return res.json();
}

// ─────────────────────────── Glassdoor ──────────────────────────
// URL pattern: /Overview/Working-at-<Slug>-EI_IE<NumericID>.htm
// The Slug is the company name without spaces, capitalized. Wikidata's
// P3057 stores the trailing ID portion ("EI_IE12345" or "12345"); both
// forms are accepted in URLs.

export function buildGlassdoorUrl(rawId, name) {
  if (!rawId) return null;
  const id = rawId.replace(/^EI_IE/, "");
  const slug = String(name || "Company")
    .replace(/[^A-Za-z0-9 ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `https://www.glassdoor.com/Overview/Working-at-${slug}-EI_IE${id}.htm`;
}

async function fetchGlassdoor(rec) {
  const url = buildGlassdoorUrl(rec.glassdoor_id, rec.name);
  if (!url) return { status: "no_id" };
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.status === 403 || res.status === 429) {
      return { status: "blocked", http: res.status, url };
    }
    if (!res.ok) return { status: "http_error", http: res.status, url };
    const html = await res.text();
    if (/cloudflare|cf-error|cf_chl_/i.test(html) && html.length < 30_000) {
      return { status: "cf_challenge", url };
    }
    const agg = extractAggregateRating(html);
    const extras = extractGlassdoorExtras(html);
    if (!agg) return { status: "no_data", url };
    return {
      status: "ok",
      url,
      id: rec.glassdoor_id,
      rating: agg.ratingValue,
      review_count: agg.reviewCount,
      recommend_to_friend_pct: extras.recommend_to_friend_pct,
      ceo_approval_pct: extras.ceo_approval_pct,
      year: new Date().getUTCFullYear(),
    };
  } catch (e) {
    return { status: "error", error: e.message, url };
  }
}

// ─────────────────────────── Indeed ─────────────────────────────
// URL pattern: /cmp/<slug-as-stored-in-P3475>

export function buildIndeedUrl(rawId) {
  if (!rawId) return null;
  return `https://www.indeed.com/cmp/${encodeURIComponent(rawId)}`;
}

async function fetchIndeed(rec) {
  const url = buildIndeedUrl(rec.indeed_id);
  if (!url) return { status: "no_id" };
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.status === 403 || res.status === 429) {
      return { status: "blocked", http: res.status, url };
    }
    if (!res.ok) return { status: "http_error", http: res.status, url };
    const html = await res.text();
    if (/cloudflare|cf-error|cf_chl_|px-captcha/i.test(html) && html.length < 30_000) {
      return { status: "cf_challenge", url };
    }
    const agg = extractAggregateRating(html);
    if (!agg) return { status: "no_data", url };
    return {
      status: "ok",
      url,
      id: rec.indeed_id,
      rating: agg.ratingValue,
      review_count: agg.reviewCount,
      year: new Date().getUTCFullYear(),
    };
  } catch (e) {
    return { status: "error", error: e.message, url };
  }
}

// ─────────────────────────── AmbitionBox ────────────────────────
// URL pattern: /overview/<slug>-overview. AmbitionBox is India-focused
// so US coverage is patchy, but their bot wall is far less aggressive.

export function buildAmbitionBoxUrl(name) {
  const s = slugify(name);
  if (!s) return null;
  return `https://www.ambitionbox.com/overview/${s}-overview`;
}

async function fetchAmbitionBox(rec) {
  const url = buildAmbitionBoxUrl(rec.name);
  if (!url) return { status: "no_id" };
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.status === 404) return { status: "not_found", url };
    if (res.status === 403 || res.status === 429) {
      return { status: "blocked", http: res.status, url };
    }
    if (!res.ok) return { status: "http_error", http: res.status, url };
    const html = await res.text();
    const agg = extractAggregateRating(html);
    if (!agg) return { status: "no_data", url };
    return {
      status: "ok",
      url,
      slug: slugify(rec.name),
      rating: agg.ratingValue,
      review_count: agg.reviewCount,
      year: new Date().getUTCFullYear(),
    };
  } catch (e) {
    return { status: "error", error: e.message, url };
  }
}

// ─────────────────────── per-brand orchestration ────────────────

export function assemblePrimarySignal(brand) {
  // Pick the strongest available signal source. Prefer Glassdoor (deepest
  // metadata) → Indeed → AmbitionBox → Wikidata-only.
  if (brand.glassdoor?.status === "ok") return "glassdoor";
  if (brand.indeed?.status === "ok")    return "indeed";
  if (brand.ambitionbox?.status === "ok") return "ambitionbox";
  return "wikidata-only";
}

async function fetchOneBrand(rec) {
  const out = {
    slug: rec.slug,
    name: rec.name,
    qid: rec.qid,
    wikidata: {
      glassdoor_id: rec.glassdoor_id,
      indeed_id:    rec.indeed_id,
      employees:    rec.employees,
      founded:      rec.founded,
      hq_country:   rec.hq_country,
    },
    glassdoor:   { status: "skipped" },
    indeed:      { status: "skipped" },
    ambitionbox: { status: "skipped" },
    last_updated: new Date().toISOString(),
  };

  if (!LIVE_SCRAPE) {
    out.primary_signal = "wikidata-only";
    out._note = "Live scrapers disabled (set EMPLOYEE_RATINGS_LIVE=1 to enable; pending ToS sign-off).";
    return out;
  }

  // Live scrape path. Be polite — wait between sites.
  if (rec.glassdoor_id) {
    out.glassdoor = await fetchGlassdoor(rec);
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }
  if (rec.indeed_id) {
    out.indeed = await fetchIndeed(rec);
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }
  // Always try AmbitionBox — it doesn't require a Wikidata ID.
  out.ambitionbox = await fetchAmbitionBox(rec);

  out.primary_signal = assemblePrimarySignal(out);
  return out;
}

// ────────────────────────── runner ──────────────────────────────

function synthRecord(slug) {
  // Used only in --dry mode when no cache exists. Mimics a Wikidata-only
  // signal (which is the default safe state).
  return {
    slug,
    name: slug,
    qid: "Q0000000",
    wikidata: {
      glassdoor_id: "12345",
      indeed_id:    slug,
      employees:    null,
      founded:      null,
      hq_country:   "United States of America",
    },
    glassdoor:   { status: "skipped" },
    indeed:      { status: "skipped" },
    ambitionbox: { status: "skipped" },
    primary_signal: "wikidata-only",
    last_updated: new Date().toISOString(),
    _synthetic: true,
  };
}

async function main() {
  console.log(`Employee ratings fetcher starting...`);
  console.log(`  mode:         ${DRY ? "DRY (no network)" : "APPLY"}`);
  console.log(`  live scrape:  ${LIVE_SCRAPE ? "ENABLED" : "DISABLED (Wikidata-only)"}`);
  if (SLUG_ARG) console.log(`  slug filter:  ${SLUG_ARG}`);

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR,   { recursive: true });

  // STEP 1 — Wikidata (always, including --dry uses cached snapshot).
  let wdRows = [];
  if (DRY) {
    // Use a tiny built-in fixture so the merger has *something* to chew on.
    wdRows = [
      { slug: "walmart",   name: "Walmart",   qid: "Q483551", glassdoor_id: "715", indeed_id: "walmart", employees: 2_100_000, founded: "1962-07-02", hq_country: "United States of America" },
      { slug: "microsoft", name: "Microsoft", qid: "Q2283",   glassdoor_id: "1651", indeed_id: "microsoft", employees: 221_000, founded: "1975-04-04", hq_country: "United States of America" },
      { slug: "amazon",    name: "Amazon",    qid: "Q3884",   glassdoor_id: "6036", indeed_id: "amazon", employees: 1_540_000, founded: "1994-07-05", hq_country: "United States of America" },
    ];
  } else {
    try {
      const json = await fetchWikidata();
      wdRows = parseWikidataResults(json);
      console.log(`  Wikidata: ${wdRows.length} companies with P3057/P3475`);
    } catch (e) {
      console.error(`  Wikidata fetch FAILED: ${e.message}`);
      process.exit(1);
    }
  }

  // Filter to slugs that map to existing company files. Try direct
  // match → corp-suffix-stripped → slug-aliases. If matched via a
  // non-direct route, REWRITE the record's slug to the matched value so
  // the merger keys correctly.
  const realSlugs = new Set(
    (await fs.readdir(COMP_DIR)).map(f => f.replace(/\.json$/, ""))
  );
  let aliases = {};
  try {
    aliases = JSON.parse(
      await fs.readFile(path.join(ROOT, "public/data/_meta/slug-aliases.json"), "utf-8")
    );
  } catch { /* alias map optional */ }

  let candidates = [];
  for (const r of wdRows) {
    const matched = matchSlug(r.name, realSlugs, aliases);
    if (matched) candidates.push({ ...r, slug: matched });
  }
  if (SLUG_ARG) candidates = candidates.filter(r => r.slug === SLUG_ARG);
  console.log(`  Candidates matching company files: ${candidates.length}`);

  const records = [];
  for (let i = 0; i < candidates.length; i++) {
    const rec = candidates[i];
    let out;
    if (DRY) {
      const cachePath = path.join(CACHE_DIR, `${rec.slug}.json`);
      if (existsSync(cachePath)) {
        out = JSON.parse(await fs.readFile(cachePath, "utf-8"));
      } else {
        out = synthRecord(rec.slug);
        out.name = rec.name;
        out.qid = rec.qid;
        out.wikidata.glassdoor_id = rec.glassdoor_id;
        out.wikidata.indeed_id    = rec.indeed_id;
        out.wikidata.employees    = rec.employees;
        out.wikidata.founded      = rec.founded;
        out.wikidata.hq_country   = rec.hq_country;
      }
    } else {
      out = await fetchOneBrand(rec);
      const cachePath = path.join(CACHE_DIR, `${rec.slug}.json`);
      await fs.writeFile(cachePath, JSON.stringify(out, null, 2));
      if (LIVE_SCRAPE && i < candidates.length - 1) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      }
    }
    records.push(out);
    const tag = out.primary_signal || "?";
    console.log(`  ${(i + 1).toString().padStart(4)}/${candidates.length}  [${tag.padEnd(15)}]  ${rec.slug}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const rawOut = path.join(RAW_DIR, `${today}.json`);
  const summary = {
    generated_at: new Date().toISOString(),
    mode: DRY ? "dry" : "apply",
    live_scrape: LIVE_SCRAPE,
    wikidata_total: wdRows.length,
    candidate_count: candidates.length,
    ok_glassdoor: records.filter(r => r.glassdoor?.status === "ok").length,
    ok_indeed:    records.filter(r => r.indeed?.status === "ok").length,
    ok_ambitionbox: records.filter(r => r.ambitionbox?.status === "ok").length,
    wikidata_only: records.filter(r => r.primary_signal === "wikidata-only").length,
    records,
  };
  await fs.writeFile(rawOut, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${rawOut}`);
  console.log(`Summary: glassdoor_ok=${summary.ok_glassdoor} indeed_ok=${summary.ok_indeed} ambitionbox_ok=${summary.ok_ambitionbox} wikidata_only=${summary.wikidata_only}`);

  if (DRY) {
    console.log(`(DRY — no network. Re-run with --apply.)`);
  } else if (!LIVE_SCRAPE) {
    console.log(`(LIVE SCRAPE DISABLED — Wikidata-only signal. Set EMPLOYEE_RATINGS_LIVE=1 after ToS sign-off.)`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("employee-ratings-fetch failed:", err);
    process.exit(1);
  });
}
