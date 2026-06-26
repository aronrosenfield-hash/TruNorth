#!/usr/bin/env node
/**
 * labor-wages — DERIVED AUGMENT for TruNorth (labor signals beyond OSHA/NLRB).
 *
 * Two independent US-government public-records labor signals, merged onto
 * TruNorth brand slugs and written to:
 *
 *   data/derived/labor-wages-augment.json
 *
 * SIGNAL 1 — DOL WHD wage/hour enforcement (WHISARD).
 *   The Department of Labor's "Wage and Hour Division Compliance Action Data"
 *   (aka WHISARD — Wage Hour Investigative Support and Reporting Database):
 *   every concluded compliance action since FY2005 with the employer's legal +
 *   trade name, back wages assessed, employees due back wages, civil money
 *   penalties, and which act was violated (FLSA / MSPA / H-2A / FMLA / …).
 *
 *   Discovery (2026-06): the legacy bulk-CSV host `enforcedata.dol.gov` was
 *   retired and 301-redirects to the `dataportal.dol.gov` single-page app. The
 *   data now lives ONLY behind the DOL Open Data Portal API:
 *
 *       https://apiprod.dol.gov/v4/get/whd/enforcement/csv?X-API-KEY=<key>
 *       (dataset id 10362, agency WHD, endpoint "enforcement")
 *
 *   That API requires a free, self-service registered key on EVERY request
 *   (data + metadata). The portal's own JS bundle only ships the literal
 *   placeholder "ijEJ5wN8…" as doc text, which the API rejects (401). So this
 *   fetcher is KEY-GATED: provide the key via env and we stream the full
 *   dataset; without it we SKIP signal 1 and still ship signal 2.
 *
 *       DOL_API_KEY=<your key>   (register at https://dataportal.dol.gov/)
 *       DOL_WHD_CSV_URL=<url>    (optional: a pre-downloaded WHISARD CSV/endpoint)
 *
 * SIGNAL 2 — State WARN mass-layoff notices (Texas, representative big state).
 *   Texas WARN (WARN Act employer notices) via the open Socrata endpoint
 *   https://data.texas.gov/resource/8w53-c4f6.json — no key, paged. Fields:
 *   job_site_name, total_layoff_number, layoff_date, notice_date. We aggregate
 *   per company: total laid off + most-recent layoff date.
 *
 * AUGMENT SHAPE (per matched slug — only the fields that apply):
 *   {
 *     backWagesUsd,      // SIGNAL 1 — sum of back wages assessed across cases
 *     civilPenaltiesUsd, // SIGNAL 1 — sum of civil money penalties assessed
 *     whdCaseCount,      // SIGNAL 1 — number of WHD compliance actions
 *     warnLayoffs,       // SIGNAL 2 — total employees in TX WARN notices
 *     warnMostRecent,    // SIGNAL 2 — most-recent layoff date (YYYY-MM-DD)
 *     lastUpdated        // ISO timestamp
 *   }
 *
 * MATCHING — STRICT, by design (MISSING beats WRONG):
 *   WHISARD is dominated by tens of thousands of SMALL employers, and TX WARN
 *   carries every local franchisee. Earlier ITEP-style matching emits BARE
 *   prefixes ("walmart", "general") that over-collapse onto unrelated catalog
 *   brands. Here we match ONLY on:
 *     (a) the full normalized employer name, and
 *     (b) the full normalized name with corporate suffixes stripped
 *         (normalizeCompanyName already does this — so (a) and (b) are usually
 *         the same; (b) only differs for names the normalizer can't fully
 *         reduce). We NEVER match on single words or leading n-gram prefixes,
 *         and parent-map fallback is gated to high/medium confidence only.
 *   Result: high-precision matches to named national employers, lots of
 *   small-employer rows correctly left as orphans.
 *
 * NEVER writes public/data/companies/*.json. NEVER commits.
 *
 * Flags:
 *   --apply              write data/derived/labor-wages-augment.json (else dry).
 *   --warn-only          skip WHISARD even if a key is present (fast iteration).
 *   --whd-limit N        cap WHISARD rows streamed (debug).
 *   --warn-max N         cap total TX WARN rows paged (default 50000).
 *
 * Locally:
 *   node scripts/labor-wages-fetch.mjs                    # dry, WARN live + WHISARD if DOL_API_KEY
 *   DOL_API_KEY=... node scripts/labor-wages-fetch.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCSV } from "./lib/csv-mini.mjs";
import { normalizeCompanyName } from "./itep-tax-fetch.mjs";
import { buildIndexLookup } from "./itep-tax-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/labor-wages");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "labor-wages-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const UA = "TruNorth-Labor/1.0 (+https://www.trunorthapp.com; contact@trunorthapp.com)";

// ── WHISARD (DOL WHD enforcement) ────────────────────────────────────
const DOL_API_KEY = process.env.DOL_API_KEY || "";
// The new portal API. Override with a pre-downloaded CSV/endpoint if you have one.
const WHD_API_BASE = "https://apiprod.dol.gov/v4/get/whd/enforcement/csv";
const DOL_WHD_CSV_URL = process.env.DOL_WHD_CSV_URL || "";
const WHD_LANDING = "https://dataportal.dol.gov/datasets/10362";
const WHD_SOURCE = "DOL Wage & Hour Division — Compliance Action Data (WHISARD)";
// Guard: a WHISARD pull that returns fewer than this many rows is almost
// certainly an auth/empty stub, not the real ~hundreds-of-thousands-row file.
const WHD_MIN_ROWS = 1000;

// ── WARN (Texas mass-layoff notices) ─────────────────────────────────
const WARN_BASE = "https://data.texas.gov/resource/8w53-c4f6.json";
const WARN_LANDING = "https://data.texas.gov/dataset/TWC-WARN-Notices/8w53-c4f6";
const WARN_SOURCE = "Texas Workforce Commission — WARN Notices";
const WARN_PAGE = 5000; // Socrata max page
// Guard: TX WARN historically has >2k rows; far fewer means the feed changed.
const WARN_MIN_ROWS = 200;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const WARN_ONLY = argv.includes("--warn-only");
const WHD_LIMIT = numArg("--whd-limit", null);
const WARN_MAX = numArg("--warn-max", 50000);

function numArg(flag, dflt) {
  const i = argv.indexOf(flag);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── strict matching ────────────────────────

/**
 * STRICT name variants for matching — the whole point of this source.
 *
 * Returns at most two candidates:
 *   1. the full normalized employer name, and
 *   2. that name with trailing geo/scope qualifiers dropped
 *      ("amazon com services us" -> "amazon com services").
 *
 * It DELIBERATELY does NOT emit single words or leading n-gram prefixes
 * (which is how ITEP's nameVariants over-collapses small employers onto
 * unrelated brands). normalizeCompanyName already strips inc/corp/llc/etc,
 * so the full normalized form is the suffix-stripped full name.
 */
export function strictVariants(name) {
  const base = normalizeCompanyName(name);
  if (!base) return [];
  const out = new Set([base]);
  const stripped = base
    .replace(/\b(us|usa|north america|na|global|americas|international|intl|worldwide|services|service|stores|store|restaurants|restaurant|supercenter|fulfillment)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Only keep the stripped form if it's still substantial (>= 3 chars and
  // not collapsed to a single short token) — guards against "Tyson Foods US"
  // -> "tyson" style over-reduction sneaking back in.
  if (stripped && stripped !== base && stripped.length >= 3) out.add(stripped);
  return [...out].sort((a, b) => b.length - a.length);
}

/** Strict direct match: full (or suffix/geo-stripped full) name only. */
export function matchStrict(name, byName) {
  for (const v of strictVariants(name)) {
    const hit = byName.get(v);
    if (hit) return hit;
  }
  return null;
}

/**
 * CONSERVATIVE normalization for the parent-map route ONLY.
 *
 * normalizeCompanyName strips generic descriptor nouns (companies / group /
 * holdings / services …), which is fine for matching FULL index brand names
 * but dangerous against the parent map: "Epic Companies LLC" collapses to the
 * key "epic" (-> General Mills' Epic Provisions) and "The Expo Group Inc" to
 * "expo" (-> Newell's Expo markers). Both are WRONG.
 *
 * So here we strip ONLY pure incorporation suffixes + leading "the" — we keep
 * descriptor nouns. Then the parent-map key must equal this result EXACTLY.
 * That blocks the over-collapse (epic companies != epic, expo group != expo)
 * while still allowing unambiguous single-token names (lycra, genpact).
 */
function conservativeKey(name) {
  if (name == null) return "";
  let out = String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  out = out
    .replace(/\b(inc|incorporated|corp|corporation|co|ltd|plc|llc|llp|lp|sa|nv|ag|se)\b\.?/g, " ")
    .replace(/^\s*the\b/, " ")
    .replace(/[.,'’"`/()\-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/**
 * Parent-map fallback, STRICT: only the EXACT conservative-name slug
 * candidate (descriptor nouns preserved), and only when the mapping is
 * high/medium confidence. The parent map is keyed by alphanumeric-lowercase
 * brand keys (spaces -> hyphens).
 */
export function matchParentStrict(name, parentMap) {
  if (!parentMap || typeof parentMap !== "object") return null;
  const key = conservativeKey(name).replace(/\s+/g, "-");
  if (key.length < 4) return null; // never match ultra-short keys
  const entry = parentMap[key];
  if (entry && entry.parent && (entry.confidence === "high" || entry.confidence === "medium")) {
    return entry.parent;
  }
  return null;
}

// ─────────────────────────── WHISARD fetch + aggregate ──────────────

function toInt(v) {
  if (v == null || v === "") return 0;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
function toFloat(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function isoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Accept "2023-06-30", "2023-06-30T00:00:00.000", "06/30/2023".
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return null;
}

/**
 * Map one WHISARD CSV row to the fields we use. Tolerant of both the legacy
 * `enforcedata.dol.gov` column names and the new portal API's variants.
 */
export function parseWhdRow(row) {
  const get = (...keys) => {
    for (const k of keys) if (row[k] != null && row[k] !== "") return row[k];
    return "";
  };
  const legal = String(get("legal_name", "legal_nm", "employer_legal_name", "er_legal_name")).trim();
  const trade = String(get("trade_nm", "trade_name", "employer_trade_name", "er_trade_name")).trim();
  return {
    legal_name: legal,
    trade_name: trade,
    // Prefer legal name for matching (more stable than per-store trade names).
    matchName: legal || trade,
    back_wages_usd: toFloat(get("bw_atp_amt", "back_wages_usd", "flsa_bw_atp_amt", "bw_atp")),
    civil_penalty_usd: toFloat(get("cmp_assd_amt", "civil_penalty_usd", "flsa_cmp_assd_amt", "cmp_assessed")),
    employees_affected: toInt(get("ee_violtd_cnt", "employees_affected", "flsa_ee_atp_cnt")),
    end_date: isoDate(get("findings_end_date", "findings_end_dt", "review_end_date")),
  };
}

async function fetchWhisard() {
  if (WARN_ONLY) {
    console.log("WHISARD: skipped (--warn-only).");
    return { skipped: true, reason: "--warn-only" };
  }
  let url = DOL_WHD_CSV_URL;
  if (!url) {
    if (!DOL_API_KEY) {
      console.log(
        "WHISARD: skipped — no DOL_API_KEY and no DOL_WHD_CSV_URL.\n" +
          "         The DOL Open Data Portal API requires a free registered key\n" +
          "         (register at https://dataportal.dol.gov/). WARN data below is unaffected.",
      );
      return { skipped: true, reason: "no-key" };
    }
    const params = new URLSearchParams({ "X-API-KEY": DOL_API_KEY });
    if (WHD_LIMIT) params.set("limit", String(WHD_LIMIT));
    url = `${WHD_API_BASE}?${params.toString()}`;
  }

  console.log(`WHISARD: GET ${url.replace(/X-API-KEY=[^&]+/, "X-API-KEY=***")}`);
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv" } });
  } catch (e) {
    console.log(`WHISARD: fetch error (${e.message}) — skipping signal 1.`);
    return { skipped: true, reason: `fetch-error: ${e.message}` };
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    console.log(`WHISARD: HTTP ${res.status} — skipping signal 1. ${body}`);
    return { skipped: true, reason: `http-${res.status}` };
  }
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (/json/i.test(ct) && text.trim().startsWith("{")) {
    console.log(`WHISARD: server returned JSON, not CSV (${text.slice(0, 120)}) — skipping.`);
    return { skipped: true, reason: "non-csv" };
  }
  const rows = parseCSV(text);
  console.log(`WHISARD: parsed ${rows.length.toLocaleString()} rows (${(text.length / 1e6).toFixed(1)} MB).`);
  if (rows.length < WHD_MIN_ROWS) {
    console.log(`WHISARD: only ${rows.length} rows (< ${WHD_MIN_ROWS}) — treating as empty/auth stub; skipping.`);
    return { skipped: true, reason: "below-min-rows" };
  }

  // Persist raw for auditability.
  await fs.mkdir(RAW_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(RAW_DIR, `whisard-${stamp}.csv`), text);

  const parsed = rows.map(parseWhdRow).filter((r) => r.matchName);
  return { skipped: false, rows: parsed, rowCount: rows.length };
}

/** Aggregate WHISARD cases per (strict-matched) slug. */
function aggregateWhisard(rows, { byName, parentMap }) {
  const bySlug = new Map();
  let direct = 0;
  let parent = 0;
  let orphan = 0;
  for (const r of rows) {
    let slug = matchStrict(r.matchName, byName);
    let route = "direct";
    if (!slug) {
      slug = matchParentStrict(r.matchName, parentMap);
      if (slug) route = "parent";
    }
    if (!slug) {
      orphan++;
      continue;
    }
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { backWagesUsd: 0, civilPenaltiesUsd: 0, whdCaseCount: 0 });
      if (route === "direct") direct++;
      else parent++;
    }
    const agg = bySlug.get(slug);
    agg.backWagesUsd += r.back_wages_usd;
    agg.civilPenaltiesUsd += r.civil_penalty_usd;
    agg.whdCaseCount += 1;
  }
  return { bySlug, stats: { direct, parent, orphan } };
}

// ─────────────────────────── WARN fetch + aggregate ─────────────────

async function fetchWarn() {
  const all = [];
  let offset = 0;
  while (offset < WARN_MAX) {
    const url =
      `${WARN_BASE}?$select=job_site_name,total_layoff_number,layoff_date,notice_date` +
      `&$limit=${WARN_PAGE}&$offset=${offset}&$order=:id`;
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    } catch (e) {
      console.log(`WARN: fetch error at offset ${offset} (${e.message}) — using ${all.length} rows so far.`);
      break;
    }
    if (!res.ok) {
      console.log(`WARN: HTTP ${res.status} at offset ${offset} — using ${all.length} rows so far.`);
      break;
    }
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < WARN_PAGE) break;
    offset += WARN_PAGE;
    await sleep(150); // be polite to Socrata
  }
  console.log(`WARN: pulled ${all.length} Texas WARN notice rows.`);
  return all;
}

/** Aggregate WARN notices per (strict-matched) slug. */
function aggregateWarn(rows, { byName, parentMap }) {
  const bySlug = new Map();
  let direct = 0;
  let parent = 0;
  let orphan = 0;
  for (const r of rows) {
    const name = String(r.job_site_name || "").trim();
    if (!name) continue;
    let slug = matchStrict(name, byName);
    let route = "direct";
    if (!slug) {
      slug = matchParentStrict(name, parentMap);
      if (slug) route = "parent";
    }
    if (!slug) {
      orphan++;
      continue;
    }
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { warnLayoffs: 0, warnMostRecent: null });
      if (route === "direct") direct++;
      else parent++;
    }
    const agg = bySlug.get(slug);
    agg.warnLayoffs += toInt(r.total_layoff_number);
    const d = isoDate(r.layoff_date) || isoDate(r.notice_date);
    if (d && (!agg.warnMostRecent || d > agg.warnMostRecent)) agg.warnMostRecent = d;
  }
  return { bySlug, stats: { direct, parent, orphan } };
}

// ─────────────────────────── merge + main ───────────────────────────

async function loadJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  console.log(`labor-wages fetch starting... (mode=${APPLY ? "APPLY" : "DRY"})`);

  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  const byName = buildIndexLookup(index);
  console.log(`Loaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).\n`);

  // SIGNAL 1 — WHISARD.
  const whd = await fetchWhisard();
  let whdAgg = { bySlug: new Map(), stats: { direct: 0, parent: 0, orphan: 0 } };
  if (!whd.skipped) {
    whdAgg = aggregateWhisard(whd.rows, { byName, parentMap });
    console.log(
      `WHISARD: matched ${whdAgg.bySlug.size} slugs ` +
        `(direct ${whdAgg.stats.direct}, parent ${whdAgg.stats.parent}, orphan ${whdAgg.stats.orphan}).`,
    );
  }
  console.log("");

  // SIGNAL 2 — WARN.
  const warnRows = await fetchWarn();
  let warnAgg = { bySlug: new Map(), stats: { direct: 0, parent: 0, orphan: 0 } };
  const warnOk = warnRows.length >= WARN_MIN_ROWS;
  if (!warnOk) {
    console.log(`WARN: only ${warnRows.length} rows (< ${WARN_MIN_ROWS}) — treating WARN as unavailable this run.`);
  } else {
    warnAgg = aggregateWarn(warnRows, { byName, parentMap });
    console.log(
      `WARN: matched ${warnAgg.bySlug.size} slugs ` +
        `(direct ${warnAgg.stats.direct}, parent ${warnAgg.stats.parent}, orphan ${warnAgg.stats.orphan}).`,
    );
  }
  console.log("");

  // ── merge the two signals onto one augment, keyed by slug ──
  const lastUpdated = new Date().toISOString();
  const augment = {};
  const slugs = new Set([...whdAgg.bySlug.keys(), ...warnAgg.bySlug.keys()]);
  for (const slug of slugs) {
    const entry = { lastUpdated };
    const w = whdAgg.bySlug.get(slug);
    if (w) {
      if (w.backWagesUsd > 0) entry.backWagesUsd = round2(w.backWagesUsd);
      if (w.civilPenaltiesUsd > 0) entry.civilPenaltiesUsd = round2(w.civilPenaltiesUsd);
      if (w.whdCaseCount > 0) entry.whdCaseCount = w.whdCaseCount;
    }
    const v = warnAgg.bySlug.get(slug);
    if (v) {
      if (v.warnLayoffs > 0) entry.warnLayoffs = v.warnLayoffs;
      if (v.warnMostRecent) entry.warnMostRecent = v.warnMostRecent;
    }
    // Drop a slug that ended up with only the timestamp (no real signal).
    const realKeys = Object.keys(entry).filter((k) => k !== "lastUpdated");
    if (realKeys.length) augment[slug] = entry;
  }

  const matchCount = Object.keys(augment).length;
  console.log("Results:");
  console.log(`  Distinct matched slugs (union): ${matchCount}`);
  console.log(`    with WHISARD wage/penalty data: ${[...slugs].filter((s) => whdAgg.bySlug.has(s)).length}`);
  console.log(`    with TX WARN layoff data:       ${[...slugs].filter((s) => warnAgg.bySlug.has(s)).length}`);

  // Examples — rank by total dollar/people impact for a useful log.
  const examples = Object.entries(augment)
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => {
      const ai = (a.backWagesUsd || 0) + (a.civilPenaltiesUsd || 0) + (a.warnLayoffs || 0) * 1000;
      const bi = (b.backWagesUsd || 0) + (b.civilPenaltiesUsd || 0) + (b.warnLayoffs || 0) * 1000;
      return bi - ai;
    })
    .slice(0, 8);
  if (examples.length) {
    console.log("\n  Top examples (by combined wage + penalty + layoff impact):");
    for (const e of examples) {
      const parts = [];
      if (e.backWagesUsd) parts.push(`backWages=$${Math.round(e.backWagesUsd).toLocaleString()}`);
      if (e.civilPenaltiesUsd) parts.push(`penalties=$${Math.round(e.civilPenaltiesUsd).toLocaleString()}`);
      if (e.whdCaseCount) parts.push(`whdCases=${e.whdCaseCount}`);
      if (e.warnLayoffs) parts.push(`warnLayoffs=${e.warnLayoffs}`);
      if (e.warnMostRecent) parts.push(`warnMostRecent=${e.warnMostRecent}`);
      console.log(`    ${e.slug.padEnd(24)} ${parts.join("  ")}`);
    }
  }

  const out = {
    _source: "DOL WHD WHISARD + Texas WARN (US government public records)",
    _signals: {
      whisard: { source: WHD_SOURCE, landingUrl: WHD_LANDING, available: !whd.skipped, skipReason: whd.skipped ? whd.reason : null },
      warn: { source: WARN_SOURCE, landingUrl: WARN_LANDING, available: warnOk, rowsPulled: warnRows.length },
    },
    _matching: "STRICT — full normalized name + suffix/geo-stripped full name only; never bare words or n-gram prefixes; parent-map gated to high/medium confidence.",
    generatedAt: lastUpdated,
    matchCount,
    whisardSlugCount: whdAgg.bySlug.size,
    warnSlugCount: warnAgg.bySlug.size,
    ...augment,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)} (${matchCount} slugs).`);
    console.log("  (Derived augment only — no company-file writes, no commits.)");
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("labor-wages-fetch failed:", err);
    process.exit(1);
  });
}
