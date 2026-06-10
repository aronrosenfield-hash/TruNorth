#!/usr/bin/env node
/**
 * LA County restaurant health-inspections — Socrata fetcher.
 *
 * Source: City of Los Angeles "Restaurant and Market Health Inspections"
 *   https://data.lacity.org/Community-Economic-Development/Restaurant-and-Market-Health-Inspections/29fd-3paw
 *
 * This is the freshest publicly downloadable A/B/C-grade dataset for LA
 * County. (LA County's own data.lacounty.gov portal has moved off Socrata
 * and no longer exposes a structured restaurant-inspection feed; the LA
 * City Socrata table mirrors LA County Public Health's grading program
 * within City of LA, ~67k inspections, 2015-07 → 2018-07.)
 *
 * Per-chain rollup:
 *   - Match facility_name against an extensible chain pattern list
 *   - For each matched chain we emit:
 *       outlet_count, inspection_count,
 *       grade_a, grade_b, grade_c (count of inspections that received each grade),
 *       b_or_worse_outlets (distinct facilities with at least one B/C grade),
 *       avg_score, min_score, max_score,
 *       latest_inspection (ISO date),
 *       sample_violations (up to 5 worst inspections with score < 80)
 *
 * Output: data/raw/la-county-restaurants/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --apply / --dry / --url / --limit / --out / --fixture
 *
 * License: City of Los Angeles open data (public domain).
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/la-county-restaurants");
const FIXTURE = path.join(__dirname, "fixtures/la-county-restaurants/sample.json");

export const DATASET_URL =
  "https://data.lacity.org/resource/29fd-3paw.json";
export const SOURCE_URL =
  "https://data.lacity.org/Community-Economic-Development/Restaurant-and-Market-Health-Inspections/29fd-3paw";
export const LICENSE = "City of Los Angeles open data (public domain)";

const UA = "TruNorth Bot https://trunorthapp.com (aron@trunorthapp.com)";
const APP_TOKEN = process.env.LA_SOCRATA_APP_TOKEN || null;
const PAGE_SIZE = 50000; // Socrata caps at 50k per request

// ─── Chain patterns ─────────────────────────────────────────────────────
// Map each LA-area restaurant chain we care about to:
//   - a regex against facility_name (matches early in the name, case-insens)
//   - the TruNorth parent slug (must exist in public/data/index.json)
//
// Keep this list focused on chains big enough for outlet-level signal in
// LA County (≥3 LA outlets typically). New chains can be added without
// schema changes.
export const CHAIN_PATTERNS = [
  { rx: /^MCDONALD'?S\b/i,                      slug: "mcdonald-s" },
  { rx: /^STARBUCKS\b/i,                        slug: "starbucks" },
  { rx: /^SUBWAY\b/i,                           slug: "subway" },
  { rx: /^BURGER KING\b/i,                      slug: "burger-king" },
  { rx: /^TACO BELL\b/i,                        slug: "taco-bell" },
  { rx: /^KFC\b|^KENTUCKY FRIED CHICKEN\b/i,    slug: "kfc" },
  { rx: /^WENDY'?S\b/i,                         slug: "wendy-s" },
  { rx: /^JACK IN THE BOX\b/i,                  slug: "jack-in-the-box" },
  { rx: /^CARL'?S? JR\b/i,                      slug: "carl-s-jr" },
  { rx: /^IN-?N-?OUT\b/i,                       slug: "in-n-out-burger" },
  { rx: /^DEL TACO\b/i,                         slug: "del-taco" },
  { rx: /^EL POLLO LOCO\b/i,                    slug: "el-pollo-loco" },
  { rx: /^CHIPOTLE\b/i,                         slug: "chipotle" },
  { rx: /^PANDA EXPRESS\b/i,                    slug: "panda-express" },
  { rx: /^DOMINO'?S\b/i,                        slug: "domino-s" },
  { rx: /^PIZZA HUT\b/i,                        slug: "pizza-hut" },
  { rx: /^PAPA JOHN'?S\b/i,                     slug: "papa-john-s" },
  { rx: /^LITTLE CAESAR'?S\b/i,                 slug: "little-caesars" },
  { rx: /^DUNKIN'?( DONUTS)?\b/i,               slug: "dunkin-donuts" },
  { rx: /^BASKIN-?ROBBINS\b/i,                  slug: "baskin-robbins" },
  { rx: /^DAIRY QUEEN\b/i,                      slug: "dairy-queen" },
  { rx: /^7-?ELEVEN\b/i,                        slug: "7-eleven" },
  { rx: /^IHOP\b/i,                             slug: "ihop" },
  { rx: /^DENNY'?S\b/i,                         slug: "denny-s" },
  { rx: /^APPLEBEE'?S\b/i,                      slug: "applebee-s" },
  { rx: /^CHILI'?S\b/i,                         slug: "chili-s" },
  { rx: /^OLIVE GARDEN\b/i,                     slug: "olive-garden" },
  { rx: /^OUTBACK STEAKHOUSE\b/i,               slug: "outback-steakhouse" },
  { rx: /^RED LOBSTER\b/i,                      slug: "red-lobster" },
  { rx: /^CHEESECAKE FACTORY\b/i,               slug: "cheesecake-factory" },
  { rx: /^BUFFALO WILD WINGS\b/i,               slug: "buffalo-wild-wings" },
  { rx: /^PANERA( BREAD)?\b/i,                  slug: "panera-bread" },
  { rx: /^JIMMY JOHN'?S\b/i,                    slug: "jimmy-john-s" },
  { rx: /^JERSEY MIKE'?S\b/i,                   slug: "jersey-mike-s" },
  { rx: /^FIVE GUYS\b/i,                        slug: "five-guys" },
  { rx: /^SHAKE SHACK\b/i,                      slug: "shake-shack" },
  { rx: /^WHATABURGER\b/i,                      slug: "whataburger" },
  { rx: /^POPEYES?\b/i,                         slug: "popeyes" },
  { rx: /^CHICK-?FIL-?A\b/i,                    slug: "chick-fil-a" },
  { rx: /^ARBY'?S\b/i,                          slug: "arby-s" },
  { rx: /^SONIC( DRIVE-?IN)?\b/i,               slug: "sonic-drive-in" },
  { rx: /^HARDEE'?S\b/i,                        slug: "hardee-s" },
  { rx: /^QUIZNOS?\b/i,                         slug: "quiznos" },
  { rx: /^WINGSTOP\b/i,                         slug: "wingstop" },
  { rx: /^TGI ?FRIDAY/i,                        slug: "tgi-friday-s" },
  { rx: /^P\.?F\.? CHANG'?S\b/i,                slug: "p-f-chang-s" },
  { rx: /^BJ'?S RESTAURANT\b/i,                 slug: "bj-s-restaurants" },
  { rx: /^RUBY TUESDAY\b/i,                     slug: "ruby-tuesday" },
  { rx: /^CRACKER BARREL\b/i,                   slug: "cracker-barrel" },
  { rx: /^WAFFLE HOUSE\b/i,                     slug: "waffle-house" },
  { rx: /^COFFEE BEAN/i,                        slug: "coffee-bean-and-tea-leaf" },
  { rx: /^PEET'?S COFFEE/i,                     slug: "peet-s-coffee" },
  { rx: /^BOSTON MARKET\b/i,                    slug: "boston-market" },
  { rx: /^YOSHINOYA\b/i,                        slug: "yoshinoya" },
  { rx: /^FATBURGER\b/i,                        slug: "fatburger" },
  { rx: /^TOMMY'?S( ORIGINAL)?\b/i,             slug: "original-tommy-s" },
  // markets
  { rx: /^TRADER JOE'?S\b/i,                    slug: "trader-joe-s" },
  { rx: /^WHOLE FOODS\b/i,                      slug: "whole-foods" },
  { rx: /^RALPHS\b/i,                           slug: "ralphs" },
  { rx: /^VONS\b/i,                             slug: "vons" },
  { rx: /^ALBERTSONS\b/i,                       slug: "albertsons" },
  { rx: /^WALMART\b/i,                          slug: "walmart" },
  { rx: /^TARGET\b/i,                           slug: "target" },
  { rx: /^COSTCO\b/i,                           slug: "costco" },
  { rx: /^SAM'?S CLUB\b/i,                      slug: "sam-s-club" },
  { rx: /^FOOD ?4 ?LESS\b/i,                    slug: "food-4-less" },
  { rx: /^SMART ?(&|AND) ?FINAL\b/i,            slug: "smart-and-final" },
  { rx: /^SPROUTS\b/i,                          slug: "sprouts-farmers-market" },
];

export function classifyChain(name) {
  if (!name) return null;
  for (const c of CHAIN_PATTERNS) {
    if (c.rx.test(name)) return c.slug;
  }
  return null;
}

// ─── CLI ────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const args = { limit: null, out: null, url: null, dry: false, apply: false, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 1000);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--dry") args.dry = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--fixture") args.fixture = true;
  }
  return args;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, { offset, limit }) {
  const u = new URL(url);
  // Only pull rows likely to map to a chain: facility_name pattern OR
  // grade present. Server-side filter cuts response size to <30 MB total.
  u.searchParams.set("$select",
    "serial_number,activity_date,facility_name,facility_id,score,grade," +
    "service_description,pe_description,facility_city,facility_zip");
  u.searchParams.set("$where", "grade IS NOT NULL AND score IS NOT NULL");
  u.searchParams.set("$order", "activity_date DESC");
  u.searchParams.set("$limit", String(limit));
  u.searchParams.set("$offset", String(offset));
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  if (APP_TOKEN) headers["X-App-Token"] = APP_TOKEN;
  const res = await fetch(u.toString(), { headers });
  if (!res.ok) throw new Error(`LA Socrata HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// Normalize a single inspection row.
export function normalizeRow(r) {
  if (!r) return null;
  const name = String(r.facility_name || "").trim();
  if (!name) return null;
  const slug = classifyChain(name);
  if (!slug) return null;
  const score = r.score == null ? null : Number(r.score);
  if (!Number.isFinite(score)) return null;
  return {
    slug,
    facility_id: r.facility_id || "",
    facility_name: name,
    activity_date: (r.activity_date || "").slice(0, 10),
    score,
    grade: String(r.grade || "").trim().toUpperCase(),
    city: r.facility_city || "",
    zip: r.facility_zip || "",
    service: r.service_description || "",
  };
}

// ─── Per-chain rollup ───────────────────────────────────────────────────
export function rollupByChain(rows) {
  const byChain = {};
  for (const r of rows) {
    const c = byChain[r.slug] ||= {
      slug: r.slug,
      inspection_count: 0,
      grade_a: 0, grade_b: 0, grade_c: 0,
      score_sum: 0, min_score: 100, max_score: 0,
      latest_inspection: "",
      _outlets: new Set(),
      _b_or_worse_outlets: new Set(),
      _worst: [],
    };
    c.inspection_count++;
    c.score_sum += r.score;
    c.min_score = Math.min(c.min_score, r.score);
    c.max_score = Math.max(c.max_score, r.score);
    if (r.grade === "A") c.grade_a++;
    else if (r.grade === "B") { c.grade_b++; c._b_or_worse_outlets.add(r.facility_id); }
    else if (r.grade === "C") { c.grade_c++; c._b_or_worse_outlets.add(r.facility_id); }
    if (r.facility_id) c._outlets.add(r.facility_id);
    if (!c.latest_inspection || r.activity_date > c.latest_inspection) {
      c.latest_inspection = r.activity_date;
    }
    // Track worst inspections — final cap of 5 happens at emit.
    if (r.score < 80) {
      c._worst.push(r);
      if (c._worst.length > 40) {
        c._worst.sort((a, b) => a.score - b.score);
        c._worst.length = 20;
      }
    }
  }
  const out = [];
  for (const c of Object.values(byChain)) {
    c._worst.sort((a, b) => a.score - b.score);
    const sample_violations = c._worst.slice(0, 5).map(w => ({
      facility_name: w.facility_name,
      activity_date: w.activity_date,
      score: w.score,
      grade: w.grade,
      city: w.city,
      zip: w.zip,
    }));
    out.push({
      slug: c.slug,
      outlet_count: c._outlets.size,
      inspection_count: c.inspection_count,
      grade_a: c.grade_a,
      grade_b: c.grade_b,
      grade_c: c.grade_c,
      b_or_worse_outlets: c._b_or_worse_outlets.size,
      pct_b_or_worse_outlets: c._outlets.size
        ? Math.round((c._b_or_worse_outlets.size / c._outlets.size) * 1000) / 10
        : 0,
      avg_score: c.inspection_count
        ? Math.round((c.score_sum / c.inspection_count) * 10) / 10
        : 0,
      min_score: c.min_score,
      max_score: c.max_score,
      latest_inspection: c.latest_inspection,
      sample_violations,
      source_url: SOURCE_URL,
    });
  }
  out.sort((a, b) => b.inspection_count - a.inspection_count);
  return out;
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

  console.log(`LA County restaurants fetcher starting...  (mode=${args.dry || args.fixture ? "FIXTURE" : "LIVE"})`);
  console.log(`License: ${LICENSE}`);

  let chains;
  let rawCount = 0;

  if (args.dry || args.fixture) {
    if (!existsSync(FIXTURE)) {
      console.error(`Fixture missing: ${FIXTURE}`);
      process.exit(2);
    }
    const fix = await replayFixture();
    const rows = (fix.rows || []).map(normalizeRow).filter(Boolean);
    rawCount = rows.length;
    chains = rollupByChain(rows);
  } else {
    const url = args.url || DATASET_URL;
    const cap = args.apply ? Infinity : (args.limit ?? 50000);
    let offset = 0;
    const all = [];
    let pages = 0;
    while (offset < cap) {
      const pageSize = Math.min(PAGE_SIZE, cap - offset);
      let page;
      try {
        page = await fetchPage(url, { offset, limit: pageSize });
      } catch (e) {
        console.warn(`Live fetch failed at offset=${offset}: ${e.message}`);
        if (offset === 0) {
          console.warn("  Falling back to fixture.");
          const fix = await replayFixture();
          const rows = (fix.rows || []).map(normalizeRow).filter(Boolean);
          rawCount = rows.length;
          chains = rollupByChain(rows);
          break;
        }
        break;
      }
      if (!page.length) break;
      rawCount += page.length;
      for (const r of page) {
        const n = normalizeRow(r);
        if (n) all.push(n);
      }
      offset += page.length;
      pages++;
      console.log(`  page ${pages}: +${page.length} rows  (cumulative raw=${rawCount}, chain-matched=${all.length})`);
      if (page.length < pageSize) break;
      await sleep(250); // polite to Socrata even with anonymous limits
    }
    if (!chains) chains = rollupByChain(all);
  }

  const bundle = {
    _license: LICENSE,
    _source: SOURCE_URL,
    _dataset_url: DATASET_URL,
    _generated_at: new Date().toISOString(),
    _stats: {
      raw_rows_fetched:        rawCount,
      chain_inspections:       chains.reduce((s, c) => s + c.inspection_count, 0),
      chains:                  chains.length,
    },
    chains,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nWrote ${outFile}  (${chains.length} chains, ${bundle._stats.chain_inspections} inspections)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("la-county-restaurants-fetch failed:", e); process.exit(1); });
}
