#!/usr/bin/env node
/**
 * SEC annual-revenue fetcher — input for revenue-normalized penalty severity
 * (R7.1, 2026-06-13). The un-quizzed baseline previously scored penalty
 * severity in ABSOLUTE dollars, so a $10M fine sank a $500B company exactly
 * like a $500M one and big, heavily-scrutinized brands bottomed out. This
 * pulls each public brand's latest ANNUAL revenue from SEC XBRL companyfacts
 * so rebake-scoring.mjs can score penalties as a share of revenue.
 *
 * Coverage: only brands that resolve to a SEC CIK — via a ticker (SEC's
 * ticker→CIK file, reused from sec-def14a-fetch.mjs) or a CIK embedded in an
 * existing payRatio sourceUrl. That's the public mega-brands (Walmart, Amazon,
 * Target…) — exactly the ones the absolute-dollar curve over-penalized. Brands
 * without a CIK (private / subsidiaries) keep the absolute-dollar fallback.
 *
 * Output: public/data/_meta/company-revenue.json  →  { slug: {revenue, year, end, tag, cik} }
 * Read directly by rebake-scoring.mjs (no per-company merge — revenue is a
 * scoring input, not display data; the baked csc carries it downstream so the
 * client engine needs no revenue of its own).
 *
 * License: SEC EDGAR is US-government / public domain; we send a descriptive
 * User-Agent per SEC fair-access and throttle under 10 req/sec.
 *
 * Flags:
 *   (default)  — DRY: no network, no write.
 *   --apply    — actually hit SEC.
 *   --limit N  — cap fetches (debug).
 *
 * GUARD (per the sandboxed-pr-fetch-empties lesson): refuses to write a file
 * with < 20 revenues, or one that would shrink an existing good snapshot by
 * >50% — a blocked/partial network run must never clobber real data.
 */
import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTickerCikMap } from "./sec-def14a-fetch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPS = path.join(ROOT, "public/data/companies");
const OUT = path.join(ROOT, "public/data/_meta/company-revenue.json");

const UA = "TruNorth Data Pipeline aron@trunorthapp.com";
const RATE_LIMIT_MS = 120; // < 10 req/sec
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : null;
})();

// Tried in order; first tag with a usable annual figure wins.
const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
];

async function fetchJson(url, retries = 3) {
  for (let a = 1; a <= retries; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.status === 404) return { _notFound: true };
      if (res.status === 429 || res.status >= 500) { await sleep(1000 * a); continue; }
      if (!res.ok) return { _error: true, status: res.status };
      return await res.json();
    } catch (e) {
      if (a === retries) return { _error: true, message: e.message };
      await sleep(1000 * a);
    }
  }
  return { _error: true, message: "exhausted retries" };
}

// Most recent FULL-YEAR revenue (350–380 day period) — never a 10-Q quarter.
function pickAnnualRevenue(facts) {
  const usGaap = facts?.facts?.["us-gaap"] || {};
  for (const tag of REVENUE_TAGS) {
    const node = usGaap[tag];
    if (!node) continue;
    const units = node.units?.USD || [];
    let best = null;
    for (const u of units) {
      if (!u.start || !u.end || u.val == null) continue;
      const days = (new Date(u.end) - new Date(u.start)) / 86400000;
      if (days < 350 || days > 380) continue; // annual only
      if (best === null || u.end > best.end) best = { value: u.val, year: u.fy ?? null, end: u.end };
    }
    if (best && best.value > 0) return { ...best, tag };
  }
  return null;
}

function cikFromCompany(co, cikMap) {
  const t = String(co.ticker || co.symbol || "").toUpperCase();
  if (t && cikMap[t]) return cikMap[t].cik;
  const m = String(co.payRatio?.sourceUrl || "").match(/edgar\/data\/(\d+)/);
  if (m) return String(m[1]).padStart(10, "0");
  return null;
}

async function main() {
  if (!APPLY) {
    console.log("[sec-revenue] DRY — pass --apply to hit SEC. No network, no write.");
    return;
  }
  const cikMap = await loadTickerCikMap({ apply: true });
  if (!cikMap || Object.keys(cikMap).length < 1000) {
    throw new Error("ticker→CIK map too small — aborting (guard)");
  }

  const files = readdirSync(COMPS).filter((f) => f.endsWith(".json"));
  const targets = [];
  for (const f of files) {
    let co;
    try { co = JSON.parse(await fs.readFile(path.join(COMPS, f), "utf8")); } catch { continue; }
    if (co.overall == null) continue; // graded brands only
    const cik = cikFromCompany(co, cikMap);
    if (cik) targets.push({ slug: co.slug || f.slice(0, -5), cik });
  }
  const list = LIMIT ? targets.slice(0, LIMIT) : targets;
  console.log(`[sec-revenue] ${targets.length} graded brands resolve to a CIK; fetching ${list.length}`);

  const out = {};
  let ok = 0, miss = 0, err = 0;
  for (const { slug, cik } of list) {
    const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    await sleep(RATE_LIMIT_MS);
    if (!facts || facts._error) { err++; continue; }
    if (facts._notFound) { miss++; continue; }
    const rev = pickAnnualRevenue(facts);
    if (rev && rev.value > 1e6 && rev.value < 1e13) {
      out[slug] = { revenue: rev.value, year: rev.year, end: rev.end, tag: rev.tag, cik };
      ok++;
    } else miss++;
    if ((ok + miss + err) % 50 === 0) console.log(`  …${ok + miss + err}/${list.length} (ok=${ok})`);
  }
  console.log(`[sec-revenue] ok=${ok} miss=${miss} err=${err}`);

  // GUARD: never write an empty/partial snapshot over real data.
  if (ok < 20) {
    console.error(`[sec-revenue] only ${ok} revenues — refusing to write (empty/partial guard).`);
    process.exit(1);
  }
  if (existsSync(OUT)) {
    try {
      const prevN = Object.keys(JSON.parse(await fs.readFile(OUT, "utf8"))).length;
      if (ok < prevN * 0.5) {
        console.error(`[sec-revenue] ${ok} < 50% of existing ${prevN} — refusing to clobber.`);
        process.exit(1);
      }
    } catch { /* unreadable prior file — proceed */ }
  }
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`[sec-revenue] wrote ${ok} revenues → ${OUT}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
