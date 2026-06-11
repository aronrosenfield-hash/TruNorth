#!/usr/bin/env node
/**
 * SEC XBRL `ecd` (Executive Compensation Disclosure) frames fetcher.
 * R6 research (docs/research/data-sources-r6-coverage-gaps-2026-06-10.md).
 *
 * Pulls the pay-versus-performance XBRL frames (Item 402(v), tagged since
 * FY2022) for the last 3 calendar years:
 *   - ecd/PeoTotalCompAmt/USD/CYxxxx        — CEO ("PEO") total comp
 *   - ecd/NonPeoNeoAvgTotalCompAmt/USD/CYxxxx — avg comp of the other NEOs
 *
 * ~1,000–1,500 filers per year, keyed by CIK + entityName. We:
 *   1. Fetch the 6 frames + company_tickers.json (CIK → ticker).
 *   2. Keep the latest year per CIK.
 *   3. Name-match entityName → catalog slugs (public/data/index.json),
 *      normalized (suffix/punctuation-stripped) exact match only — fuzzy
 *      matching on legal entity names produces false positives (e.g.
 *      "Vera Bradley" vs "Vera Wang") so we deliberately don't.
 *   4. Write data/raw/sec-ecd/<date>.json (all records + match info) and
 *      data/derived/sec-ecd-augment.json (matched slugs only).
 *
 * The raw file ALSO feeds scripts/sec-def14a-fetch.mjs: matched companies
 * carry a CIK+ticker even when the catalog record has no ticker field,
 * expanding the proxy-statement pay-ratio crawl beyond the ~340
 * ticker-carrying catalog entries.
 *
 * Note the two tags are NOT a CEO-to-worker pay ratio (that Item 402(u)
 * disclosure is narrative-only, never XBRL-tagged — verified 2026-06-10).
 * The writer therefore emits a factual narrative without an sc verdict;
 * scored execPay values come from sec-def14a's parsed ratios.
 *
 * License: US-government public domain. SEC fair-access: descriptive
 * User-Agent + ≤10 req/s (we make ~7 requests total).
 *
 * Flags:
 *   --dry    (default) reuse the latest raw file; no network.
 *   --apply  hit data.sec.gov for real.
 *
 * B-60/61/62 guard: on fetch failure or zero records we EXIT 1 without
 * touching the augment — an empty/synthetic snapshot must never wipe
 * previously-good data on a rebake.
 */

import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data/raw/sec-ecd");
const AUG_FILE = path.join(ROOT, "data/derived/sec-ecd-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

const UA = "TruNorth research@trunorthapp.com (public-records consumer app)";
const YEARS = ["CY2024", "CY2023", "CY2022"];
const TAGS = ["PeoTotalCompAmt", "NonPeoNeoAvgTotalCompAmt"];
const TICKER_CIK_URL = "https://www.sec.gov/files/company_tickers.json";

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");

// ── Name normalization (exact-after-normalize matching only) ─────────────
const SUFFIX_RE = /\b(incorporated|corporation|company|holdings?|group|enterprises|international|brands?|inc|corp|co|ltd|plc|llc|lp|sa|nv|ag|the)\b/g;
export function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null; // frame may not exist for a year
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries) throw new Error(`${url} — ${err.message}`);
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function fetchFrames() {
  // cik → { entityName, peoTotal, avgNeoTotal, year }
  const byCik = new Map();
  for (const tag of TAGS) {
    for (const cy of YEARS) {
      const url = `https://data.sec.gov/api/xbrl/frames/ecd/${tag}/USD/${cy}.json`;
      const frame = await fetchJson(url);
      if (!frame?.data?.length) { console.warn(`  (no data) ${tag}/${cy}`); continue; }
      console.log(`  ${tag}/${cy}: ${frame.data.length} filers`);
      for (const row of frame.data) {
        const year = Number(cy.slice(2));
        const cur = byCik.get(row.cik);
        // Frames are iterated newest-year-first: only fill a field if this
        // year is >= the year we already hold for it.
        if (!cur) {
          byCik.set(row.cik, {
            cik: row.cik,
            entityName: row.entityName,
            year,
            peoTotal: tag === "PeoTotalCompAmt" ? row.val : null,
            avgNeoTotal: tag === "NonPeoNeoAvgTotalCompAmt" ? row.val : null,
          });
        } else {
          const field = tag === "PeoTotalCompAmt" ? "peoTotal" : "avgNeoTotal";
          if (cur[field] == null || year > cur.year) {
            cur[field] = cur[field] == null || year >= cur.year ? row.val : cur[field];
            if (year > cur.year) cur.year = year;
          }
        }
      }
      await new Promise(r => setTimeout(r, 150)); // ≤10 req/s
    }
  }
  return byCik;
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(RAW_DIR, `${today}.json`);

  let records;
  if (APPLY) {
    console.log("📡 Fetching SEC ecd frames…");
    const byCik = await fetchFrames();
    if (byCik.size === 0) {
      console.error("❌ 0 records from all frames — refusing to write (B-60 guard).");
      process.exit(1);
    }
    console.log("📡 Fetching CIK→ticker map…");
    const tickers = await fetchJson(TICKER_CIK_URL);
    const cikToTicker = new Map();
    for (const row of Object.values(tickers || {})) {
      if (!cikToTicker.has(row.cik_str)) cikToTicker.set(row.cik_str, row.ticker);
    }
    records = [...byCik.values()].map(r => ({ ...r, ticker: cikToTicker.get(r.cik) || null }));
  } else {
    // --dry: reuse latest raw snapshot so the merge is testable offline.
    const prior = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter(f => f.endsWith(".json")).sort().pop() : null;
    if (!prior) {
      console.error("❌ --dry with no prior raw file. Run with --apply first.");
      process.exit(1);
    }
    records = JSON.parse(await fs.readFile(path.join(RAW_DIR, prior), "utf-8")).records;
    console.log(`(dry) reusing data/raw/sec-ecd/${prior}: ${records.length} records`);
  }

  // ── Match to catalog ────────────────────────────────────────────────────
  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const nameToSlug = new Map();
  for (const c of index) {
    const k = normName(c.name);
    if (k && !nameToSlug.has(k)) nameToSlug.set(k, c.slug);
  }
  let matched = 0;
  for (const r of records) {
    r.slug = nameToSlug.get(normName(r.entityName)) || null;
    if (r.slug) matched++;
  }
  console.log(`🔎 Matched ${matched}/${records.length} filers to catalog slugs`);
  if (APPLY && matched === 0) {
    console.error("❌ 0 catalog matches — refusing to write augment (B-60 guard).");
    process.exit(1);
  }

  if (APPLY) {
    await fs.writeFile(rawPath, JSON.stringify({
      _generated_at: new Date().toISOString(),
      _source: "https://data.sec.gov/api/xbrl/frames/ecd/",
      records,
    }, null, 2));
    console.log(`💾 ${path.relative(ROOT, rawPath)} (${records.length} records)`);
  }

  const bySlug = {};
  for (const r of records) {
    if (!r.slug || r.peoTotal == null) continue;
    bySlug[r.slug] = {
      execPay: {
        cik: r.cik,
        entityName: r.entityName,
        ticker: r.ticker,
        year: r.year,
        peoTotal: r.peoTotal,
        avgNeoTotal: r.avgNeoTotal ?? null,
        sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${r.cik}&type=DEF+14A`,
      },
    };
  }
  await fs.writeFile(AUG_FILE, JSON.stringify({
    _license: "US Government work — public domain (17 U.S.C. § 105). SEC EDGAR XBRL frames.",
    _source_url: "https://data.sec.gov/api/xbrl/frames/ecd/",
    _generated_at: new Date().toISOString(),
    _stats: { frame_records: records.length, matched_slugs: Object.keys(bySlug).length },
    ...bySlug,
  }, null, 2));
  console.log(`✅ data/derived/sec-ecd-augment.json: ${Object.keys(bySlug).length} slugs`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => { console.error("❌", err.message); process.exit(1); });
}
