#!/usr/bin/env node
/**
 * Violation Tracker (VT) v2 fetcher — Good Jobs First parent-level enforcement.
 *
 *   Landing:        https://violationtracker.goodjobsfirst.org/
 *   Parent summary: https://violationtracker.goodjobsfirst.org/parent/<parent-slug>
 *   Detail search:  https://violationtracker.goodjobsfirst.org/?parent=<slug>&detail=1
 *                   &year_min=<YYYY>&year_max=<YYYY>&state=<XX>&offense_group=<key>
 *                   &order=pen_year&sort=DESC
 *
 * v1 captured: totalPenalty, totalRecords, offenseGroups, primaryOffenses.
 * v2 adds:
 *   - violations_by_state:  { CA: $X, TX: $Y, ... }  — penalty $ rolled up by US state
 *   - yoy_trend:            { 2021: $, 2022: $, ... 2025: $ }  (last 5 years)
 *   - active_last_6mo:      boolean — true if any record's pen_year_quarter lands
 *                           within the last 180d
 *   - recent_top5:          [{ date, agency, penalty, offense }] — 5 newest
 *                           records, sorted by date DESC then penalty DESC
 *
 * VT does NOT expose a public REST/JSON API.  Each "page" is a server-rendered
 * HTML table.  We scrape the parent-detail listing in three passes per brand:
 *
 *   1. Parent summary  → totals + matched name (already in v1 cache)
 *   2. Detail listing with state facet  → per-state penalty rollup
 *   3. Detail listing sorted by date DESC, first 50 rows
 *      → top5 recent + active_last_6mo + yoy_trend buckets
 *
 * SCRAPING ETIQUETTE (critical — VT is volunteer-run, low-bandwidth):
 *   - 4-second delay between requests (15 req/min, well under their soft cap)
 *   - User-Agent identifies us with a contact URL
 *   - 429/503 → exponential backoff (60s, 120s, 300s), max 3 retries
 *   - Hard cap of 1500 brand-fetches per run; resume from a cache.
 *   - We cache parent HTML for 30 days so re-runs against the same parent are
 *     no-ops.  Cache dir: /public/data/_cache/vt-v2/<slug>.html
 *   - This script is INTENTIONALLY NOT WIRED INTO GH ACTIONS YET.  Aron should
 *     review one full DRY-RUN locally before scheduling.
 *
 * Output:
 *   /public/data/vt-v2.json — overwritten per run.  Same outer shape as
 *   v1 cache so vt-merge-v2.mjs can adopt it without disruption.
 *
 *   {
 *     fetched_at: ISO,
 *     source: "violation-tracker-v2",
 *     entries: [
 *       { slug, status: "ok"|"no_match"|"error", ...v2 fields, raw: {...} },
 *       ...
 *     ]
 *   }
 *
 * Locally:
 *   node scripts/vt-fetch-v2.mjs --smoke
 *     → fetches the 10 dry-run brands (walmart, amazon, mcdonald-s, ...)
 *   node scripts/vt-fetch-v2.mjs --slug walmart
 *     → one brand only.
 *   node scripts/vt-fetch-v2.mjs
 *     → all brands with an existing v1 VT block (~1700) — slow, ~2hrs.
 *
 *   IMPORTANT: the --dry-run flag DOES NOT hit the network.  It synthesizes
 *   plausible v2 fields from the existing v1 cache so you can preview how
 *   the merge would shape the data.  This is what B-30's review uses.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const OUT_FILE  = path.join(ROOT, "public/data/vt-v2.json");
const CACHE_DIR = path.join(ROOT, "public/data/_cache/vt-v2");

const VT_BASE   = "https://violationtracker.goodjobsfirst.org";
const UA        = "TruNorth-VT/2.0 (+https://www.trunorthapp.com; contact: hello@trunorthapp.com)";
const THROTTLE_MS    = 4000;
const BACKOFF_429_MS = [60_000, 120_000, 300_000];
const MAX_RETRIES    = 3;
const HARD_CAP       = 1500;
const SIX_MONTHS_MS  = 180 * 24 * 60 * 60 * 1000;

const DRY_RUN_SMOKE_SLUGS = [
  "walmart", "amazon", "mcdonald-s", "wells-fargo", "jpmorgan-chase",
  "fedex", "ups", "target", "kroger", "starbucks",
];

const argv      = new Set(process.argv.slice(2));
const SMOKE     = argv.has("--smoke");
const DRY_RUN   = argv.has("--dry-run") || argv.has("--dryrun");
const SLUG_ARG  = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 ? process.argv[i + 1] : null;
})();

/* ──────────────────────── helpers ──────────────────────── */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHtml(url, attempt = 0) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html" },
  });
  if (res.status === 429 || res.status === 503) {
    if (attempt >= MAX_RETRIES) throw new Error(`${res.status} after ${MAX_RETRIES} retries`);
    const wait = BACKOFF_429_MS[attempt];
    console.warn(`  ⏸  ${res.status} throttle, backing off ${wait/1000}s …`);
    await sleep(wait);
    return fetchHtml(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function cachedFetch(url, cacheKey, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${cacheKey}.html`);
  try {
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs < maxAgeMs) return fs.readFile(file, "utf-8");
  } catch { /* miss */ }
  const html = await fetchHtml(url);
  await fs.writeFile(file, html);
  return html;
}

/* ──────────────────────── parsers ──────────────────────── */
// VT pages use a predictable HTML table structure. The parsers below are
// defensive — if VT redesigns, we degrade to empty fields rather than crash.

const STATE_2CHAR = /^[A-Z]{2}$/;

function parseStateBreakdown(html) {
  // VT renders state facets as <a> links in the left sidebar:
  //   <a href="/?parent=walmart&detail=1&state=CA">California ($50,000,000)</a>
  const out = {};
  const re = /href="[^"]*[?&]state=([A-Z]{2})[^"]*"[^>]*>([^<]*)\(\$([\d,]+)\)/g;
  let m;
  while ((m = re.exec(html))) {
    const st = m[1];
    const amt = parseInt(m[3].replace(/,/g, ""), 10);
    if (STATE_2CHAR.test(st) && Number.isFinite(amt)) out[st] = (out[st] || 0) + amt;
  }
  return out;
}

function parseDetailRows(html) {
  // Each VT detail-table row is:
  //   <tr>
  //     <td>Walmart Inc.</td>
  //     <td>2025-08-15</td>
  //     <td>DOL-WHD</td>
  //     <td>wage and hour violation</td>
  //     <td>$1,500,000</td>
  //   </tr>
  const out = [];
  const rowRe = /<tr[^>]*class="[^"]*record[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let r;
  while ((r = rowRe.exec(html))) {
    const cells = [];
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(r[1])) && cells.length < 8) {
      cells.push(c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    }
    if (cells.length < 5) continue;
    const [, dateRaw, agency, offense, penRaw] = cells;
    const date = (dateRaw.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || null;
    const penalty = parseInt((penRaw || "").replace(/[^\d]/g, ""), 10) || 0;
    if (!date) continue;
    out.push({ date, agency, offense, penalty });
  }
  return out;
}

/* ──────────────────────── aggregation ──────────────────────── */

function summarizeRows(rows, now = Date.now()) {
  const yoy = {};
  const thisYear = new Date(now).getUTCFullYear();
  for (let y = thisYear - 4; y <= thisYear; y++) yoy[y] = 0;

  let active_last_6mo = false;
  for (const r of rows) {
    const y = parseInt(r.date.slice(0, 4), 10);
    if (yoy[y] !== undefined) yoy[y] += r.penalty;
    const t = Date.parse(r.date);
    if (Number.isFinite(t) && now - t <= SIX_MONTHS_MS) active_last_6mo = true;
  }

  const recent_top5 = [...rows]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.penalty - a.penalty))
    .slice(0, 5)
    .map(r => ({ date: r.date, agency: r.agency, penalty: r.penalty, offense: r.offense }));

  return { yoy_trend: yoy, active_last_6mo, recent_top5 };
}

/* ──────────────────────── live fetch path ──────────────────────── */

async function fetchOneLive(slug, vtSlug) {
  // 1. State facets from the parent summary listing
  const parentUrl = `${VT_BASE}/parent/${encodeURIComponent(vtSlug)}`;
  const parentHtml = await cachedFetch(parentUrl, `parent-${vtSlug}`);
  await sleep(THROTTLE_MS);

  const violations_by_state = parseStateBreakdown(parentHtml);

  // 2. Detail listing sorted by date DESC, first 50 rows
  const detailUrl = `${VT_BASE}/?parent=${encodeURIComponent(vtSlug)}&detail=1&order=pen_year_quarter&sort=DESC&pp=50`;
  const detailHtml = await cachedFetch(detailUrl, `detail-${vtSlug}`);
  await sleep(THROTTLE_MS);
  const rows = parseDetailRows(detailHtml);
  const { yoy_trend, active_last_6mo, recent_top5 } = summarizeRows(rows);

  return {
    slug,
    status: "ok",
    violations_by_state,
    yoy_trend,
    active_last_6mo,
    recent_top5,
    fetched_at: new Date().toISOString(),
    parent_url: parentUrl,
  };
}

/* ──────────────────────── dry-run synth path ──────────────────────── */
// When --dry-run is set we don't hit VT.  Instead we read the existing v1
// VT block from the per-company JSON and synthesize *deterministic* but
// plausible v2 numbers so the merge + UI can be reviewed end-to-end.
// The synth distributes the existing totalPenalty across:
//   - 5 states (weighted toward HQ state if known)
//   - 5 years (heavier in the most recent two years)
//   - a top5 sample drawn from primaryOffenses
// This is ONLY for review — Aron must run live before shipping.

function deterministicHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const US_STATE_NAME_TO_CODE = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
  Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

const SYNTH_STATES_BY_INDUSTRY = {
  retail:        ["CA", "TX", "FL", "NY", "IL"],
  banking:       ["NY", "CA", "TX", "NC", "FL"],
  restaurants:   ["CA", "TX", "FL", "NY", "OH"],
  logistics:     ["TN", "CA", "TX", "GA", "OH"],
  default:       ["CA", "TX", "NY", "FL", "IL"],
};

function pickStates(hq, industry) {
  const ind = (industry || "").toLowerCase();
  const key = ind.includes("bank") || ind.includes("financ") ? "banking"
            : ind.includes("retail") ? "retail"
            : ind.includes("restaurant") ? "restaurants"
            : ind.includes("freight") || ind.includes("package") || ind.includes("logist") ? "logistics"
            : "default";
  const states = SYNTH_STATES_BY_INDUSTRY[key].slice();
  const hqState = hq ? (US_STATE_NAME_TO_CODE[hq] || null) : null;
  if (hqState) {
    const i = states.indexOf(hqState);
    if (i >= 0) states.splice(i, 1);
    states.unshift(hqState);
    if (states.length > 5) states.length = 5;
  }
  return states;
}

function synthOne(slug, v1) {
  if (!v1 || !v1.totalPenalty) return { slug, status: "no_v1", v2: null };
  const total = v1.totalPenalty;
  const h = deterministicHash(slug);
  const states = pickStates(v1.hq, v1.majorIndustry);
  // Power-law-ish split: 40 / 25 / 15 / 12 / 8
  const weights = [0.40, 0.25, 0.15, 0.12, 0.08];
  const violations_by_state = {};
  states.forEach((st, i) => { violations_by_state[st] = Math.round(total * weights[i]); });

  // YoY: heavier in latest 2 years; deterministic jitter per slug.
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const yWeights = [0.10, 0.15, 0.20, 0.25, 0.30].map((w, i) => {
    const jitter = ((h >> (i * 3)) & 0xff) / 255 * 0.10 - 0.05;
    return Math.max(0.02, w + jitter);
  });
  const yWeightSum = yWeights.reduce((a, b) => a + b, 0);
  const yoy_trend = {};
  for (let i = 0; i < 5; i++) {
    const yr = thisYear - 4 + i;
    yoy_trend[yr] = Math.round(total * (yWeights[i] / yWeightSum));
  }

  // active_last_6mo — flip on if the brand has 50+ records or the hash bit says so.
  const active_last_6mo = (v1.totalRecords || 0) >= 50 && (h & 1) === 1;

  // recent_top5 — synthesize from primaryOffenses, walk back from today.
  const offenses = (v1.primaryOffenses || []).slice(0, 5);
  const agencies = ["DOL-WHD", "OSHA", "EEOC", "DOJ", "EPA", "CFPB", "NLRB"];
  const recent_top5 = offenses.map((o, i) => {
    const daysAgo = active_last_6mo && i === 0
      ? 60 + ((h >> (i * 5)) & 0x3f)            // < 180d
      : 200 + i * 120 + ((h >> (i * 5)) & 0x7f); // older
    const d = new Date(now.getTime() - daysAgo * 86400_000);
    const penalty = Math.round((o.penalty || total / Math.max(v1.totalRecords || 1, 1)) / Math.max(o.records || 1, 1));
    return {
      date: d.toISOString().slice(0, 10),
      agency: agencies[(h >> (i * 4)) & 7] || "DOL-WHD",
      penalty,
      offense: o.category || "violation",
    };
  });

  return {
    slug,
    status: "ok_synth",
    violations_by_state,
    yoy_trend,
    active_last_6mo,
    recent_top5,
    fetched_at: now.toISOString(),
    note: "DRY-RUN SYNTH — review only, do not merge to production",
  };
}

/* ──────────────────────── driver ──────────────────────── */

async function loadV1ForSlug(slug) {
  const f = path.join(COMP_DIR, `${slug}.json`);
  if (!existsSync(f)) return null;
  try {
    const d = JSON.parse(await fs.readFile(f, "utf-8"));
    return d.violationTracker || d.laborAPI?.violationTracker || null;
  } catch { return null; }
}

async function pickSlugs() {
  if (SLUG_ARG) return [SLUG_ARG];
  if (SMOKE || DRY_RUN) return DRY_RUN_SMOKE_SLUGS;
  // Full mode: every brand with an existing v1 VT block.
  const files = await fs.readdir(COMP_DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const slug = f.slice(0, -5);
    const v1 = await loadV1ForSlug(slug);
    if (v1) out.push(slug);
    if (out.length >= HARD_CAP) break;
  }
  return out;
}

async function main() {
  console.log(`📋 VT v2 fetch — mode: ${DRY_RUN ? "DRY-RUN (synth, no network)" : SMOKE ? "smoke (10 brands, live)" : "full"}`);
  const slugs = await pickSlugs();
  console.log(`   ${slugs.length} slugs queued`);

  const entries = [];
  for (const slug of slugs) {
    const v1 = await loadV1ForSlug(slug);
    if (!v1) {
      entries.push({ slug, status: "no_v1" });
      continue;
    }
    try {
      if (DRY_RUN) {
        const synth = synthOne(slug, v1);
        entries.push({ ...synth, v1 });
        console.log(`  · ${slug}  synth ok (${Object.keys(synth.violations_by_state || {}).length} states, ${synth.recent_top5?.length || 0} recent)`);
      } else {
        const vtSlug = v1.slug || slug.replace(/-/g, "");
        const out = await fetchOneLive(slug, vtSlug);
        entries.push({ ...out, v1 });
        console.log(`  · ${slug}  ok (${Object.keys(out.violations_by_state).length} states)`);
      }
    } catch (err) {
      console.warn(`  · ${slug}  ERROR ${err.message}`);
      entries.push({ slug, status: "error", error: String(err) });
    }
  }

  await fs.writeFile(OUT_FILE, JSON.stringify({
    fetched_at: new Date().toISOString(),
    source: "violation-tracker-v2",
    mode: DRY_RUN ? "dry-run-synth" : SMOKE ? "smoke" : "full",
    entries,
  }, null, 2));
  console.log(`✅ Wrote ${OUT_FILE} (${entries.length} entries)`);
}

main().catch(err => {
  console.error("❌ vt-fetch-v2 failed:", err);
  process.exit(1);
});
