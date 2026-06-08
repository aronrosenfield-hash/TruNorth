#!/usr/bin/env node
/**
 * ITEP "Corporate Tax Avoidance" — Institute on Taxation and Economic Policy.
 *
 * ITEP (https://itep.org/corporate-tax-avoidance-report) periodically publishes
 * a multi-year audit of the U.S. federal income tax payments of profitable
 * Fortune-500 corporations. The headline finding — e.g. "Amazon, Nike, FedEx
 * and 50 other big companies paid $0 in federal income tax" — drives months
 * of mainstream coverage every release.
 *
 * The report ships a downloadable Excel/CSV appendix with one row per company:
 *
 *   - Company name
 *   - Total U.S. pretax profits over the study window (USD millions)
 *   - Federal income tax paid (USD millions; often negative = refund)
 *   - Effective federal tax rate over the window
 *   - Number of years out of the study window with $0 (or negative) federal tax
 *
 * For TruNorth this is THE story-on-a-page: a single, headline-friendly
 * "Amazon paid $0 in federal tax in 4 of the last 5 years" badge.
 *
 *   Landing page:     https://itep.org/corporate-tax-avoidance-report
 *   Headline mirror:  https://itep.org/55-corporations-paid-0-in-federal-taxes
 *
 * ⚠️ LICENSING
 *
 * ITEP's published data is not under an open public-records license. Before
 * we surface ITEP-derived flags in any paid (Pro) tier we need explicit
 * written reuse permission from ITEP. The free tier shipping the data is
 * lower-risk (clear attribution + a small slice of well-known Fortune-500
 * names) but still warrants the email-and-go pattern.
 *
 * Until that permission lands, this pipeline:
 *
 *   - runs in fixture mode by default (ITEP_INTEGRATION_ENABLED=false)
 *   - stamps every output record with a `_license` field naming the open
 *     question, so the augment is obviously dormant downstream
 *   - the merge script flips the augment file to a clearly-tagged dormant
 *     shape until the env gate is opened
 *
 * Fetch strategy:
 *   1. Try the landing page; pick the first downloadable .xlsx / .csv asset
 *      that mentions "appendix", "data", or "company".
 *   2. Excel parsing is intentionally out of scope for v1 — we only handle
 *      CSV in the live path. When the upstream asset is XLSX we surface a
 *      clear error and fall back to the bundled fixture.
 *   3. Map rows into a canonical shape and write the snapshot to
 *      data/raw/itep-tax/<date>.json.
 *
 * Per-row record shape:
 *   {
 *     company,
 *     totalProfitsUsdMillions,        // e.g. 78420
 *     federalTaxesPaidUsdMillions,    // e.g. 0 or -129  (negative = refund)
 *     effectiveFederalTaxRate,        // decimal: 0.0 = 0%, 0.21 = 21%
 *     zeroTaxYears,                   // count of $0-tax years in study window
 *     studyYears,                     // total years in study window (e.g. 5)
 *     reportEdition,                  // e.g. "2024"
 *     sourceUrl,
 *   }
 *
 * Flags:
 *   --apply        — perform the real network fetch and write the snapshot.
 *                    Requires ITEP_INTEGRATION_ENABLED=true (license gate).
 *   --dry          — (default) read the most recent snapshot on disk, falling
 *                    back to the bundled fixture (scripts/fixtures/itep-tax/).
 *   --out PATH     — write to PATH instead of the default snapshot path.
 *   --edition E    — record the report edition tag in the snapshot
 *                    (defaults to "2024").
 *
 * Locally:
 *   node scripts/itep-tax-fetch.mjs                          # dry, fixture
 *   ITEP_INTEGRATION_ENABLED=true node scripts/itep-tax-fetch.mjs --apply
 *   node --test scripts/itep-tax-fetch.test.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/itep-tax");
const FIXTURE_DIR = path.join(__dirname, "fixtures/itep-tax");
const DEFAULT_FIXTURE = path.join(FIXTURE_DIR, "sample.json");

const LANDING = "https://itep.org/corporate-tax-avoidance-report";
const HEADLINE_MIRROR =
  "https://itep.org/55-corporations-paid-0-in-federal-taxes";

const UA =
  "TruNorth-ITEP/1.0 (+https://www.trunorthapp.com; contact@trunorthapp.com)";
const REQUEST_TIMEOUT_MS = 30_000;

export const LICENSE_TAG =
  "ITEP Corporate Tax Avoidance — reuse permission pending";

// Env gate: explicit opt-in only. Defaults to false so CI / local runs
// never accidentally hit the upstream while the license question is open.
export const INTEGRATION_ENABLED =
  String(process.env.ITEP_INTEGRATION_ENABLED || "").toLowerCase() === "true";

// ─────────────────────────── CLI parsing ────────────────────────────
const argv = process.argv.slice(2);
function flagArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const OUT_PATH = flagArg("--out");
const EDITION = flagArg("--edition") || "2024";

// ─────────────────────────── normalization ──────────────────────────

/**
 * Lowercase, accent-strip, drop legal suffixes / punctuation, collapse
 * whitespace. Used for slug-matching ITEP company names against the
 * TruNorth brand index.
 */
export function normalizeCompanyName(s) {
  if (s == null) return "";
  let out = String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  out = out.toLowerCase();
  // Strip common US corporate suffixes & forms.
  out = out
    .replace(/\b(inc|incorporated|corp|corporation|co|company|companies|holdings|holding|group|plc|llc|llp|lp|ltd|sa|nv|ag|se|s\.?a\.?)\b\.?/g, " ")
    .replace(/\b(the|and|&)\b/g, " ")
    .replace(/[.,'’"`/()-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/**
 * Parse a money-shaped string into a number (USD millions). Tolerates
 * "$1,234", "1,234.5", "(129)" → -129, "$-129", "—" → null.
 */
export function parseMoneyMillions(s) {
  if (s == null) return null;
  let v = String(s).trim();
  if (!v || v === "—" || v === "-" || v.toLowerCase() === "n/a") return null;
  // Parentheses denote negatives in many accounting CSVs.
  let negative = false;
  if (/^\(.*\)$/.test(v)) { negative = true; v = v.slice(1, -1); }
  v = v.replace(/[$,\s]/g, "");
  if (v === "" || v === "-") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse an effective-tax-rate string into a decimal in [-1, 1+].
 *   "21%"   → 0.21
 *   "0%"    → 0
 *   "-5%"   → -0.05
 *   "0.21"  → 0.21   (already decimal)
 *   "21"    → 0.21   (bare number — treat as a percent)
 *   "—"     → null
 */
export function parseRate(s) {
  if (s == null) return null;
  let v = String(s).trim();
  if (!v || v === "—" || v === "-" || v.toLowerCase() === "n/a") return null;
  const hasPct = /%/.test(v);
  v = v.replace(/[%,\s]/g, "");
  if (v === "" || v === "-") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // If it already looks like a decimal in [-1, 1], pass through.
  if (!hasPct && Math.abs(n) <= 1) return n;
  return n / 100;
}

/**
 * Map a parsed CSV row (lower-cased header keys) → canonical record. Returns
 * null when no company name can be extracted.
 */
export function shapeRow(row, { edition = "2024", sourceUrl = LANDING } = {}) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
      const knorm = k.toLowerCase();
      for (const rk of Object.keys(row)) {
        if (rk.toLowerCase() === knorm && row[rk] != null && String(row[rk]).trim() !== "") {
          return String(row[rk]).trim();
        }
      }
    }
    return "";
  };

  const company = get("company", "name", "corporation", "company name");
  if (!company) return null;

  const totalProfitsUsdMillions = parseMoneyMillions(
    get(
      "total profits",
      "us profits",
      "u.s. profits",
      "pretax profits",
      "pretax us profits",
      "total pretax profits",
      "profits ($m)",
      "profits",
    ),
  );

  const federalTaxesPaidUsdMillions = parseMoneyMillions(
    get(
      "federal taxes",
      "federal tax",
      "federal income tax",
      "federal income taxes",
      "fed tax",
      "fed taxes",
      "current federal tax",
      "taxes paid",
    ),
  );

  const effectiveFederalTaxRate = parseRate(
    get(
      "effective rate",
      "effective tax rate",
      "effective federal rate",
      "effective federal tax rate",
      "etr",
      "rate",
    ),
  );

  const zeroTaxYearsRaw = get(
    "zero-tax years",
    "zero tax years",
    "# zero-tax years",
    "no. zero-tax years",
    "no of zero-tax years",
    "years $0",
    "$0 years",
    "zero years",
  );
  const zeroTaxYears = zeroTaxYearsRaw
    ? Number(String(zeroTaxYearsRaw).replace(/\D+/g, "")) || 0
    : null;

  const studyYearsRaw = get("study years", "years", "n years", "window years");
  const studyYears = studyYearsRaw
    ? Number(String(studyYearsRaw).replace(/\D+/g, "")) || null
    : null;

  return {
    company,
    totalProfitsUsdMillions,
    federalTaxesPaidUsdMillions,
    effectiveFederalTaxRate,
    zeroTaxYears,
    studyYears,
    reportEdition: edition,
    sourceUrl,
  };
}

// ─────────────────────────── CSV parser ─────────────────────────────

/**
 * Minimal RFC-4180-ish CSV parser with auto-detected separator. Reused
 * from the brazil-lista-suja pipeline pattern (no extra deps).
 */
export function parseCsv(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length >
    (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false; continue;
      }
      field += ch; continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === sep) { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1)
    .filter((r) => r.some((c) => (c || "").trim() !== ""))
    .map((r) => {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] || "").trim();
      return obj;
    });
}

// ─────────────────────────── live fetch ─────────────────────────────

/**
 * Scrape the landing page for the most likely data asset link. Prefer
 * CSV (which we can parse) over XLSX (which we cannot in v1).
 */
async function discoverAsset() {
  const res = await fetchWithTimeout(LANDING);
  if (!res.ok) throw new Error(`itep landing HTTP ${res.status}`);
  const html = await res.text();
  const linkRe = /href=["']([^"']+)["'][^>]*>([^<]{0,200})/gi;
  const candidates = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const label = (m[2] || "").toLowerCase();
    const hl = href.toLowerCase();
    if (!/\.(csv|xlsx?)(\?|$)/.test(hl)) continue;
    if (!/(appendix|company|data|tax|corporate)/i.test(href + " " + label)) continue;
    candidates.push({ href: new URL(href, LANDING).toString(), label });
  }
  candidates.sort((a, b) => priority(a.href) - priority(b.href));
  function priority(u) {
    if (/\.csv(\?|$)/i.test(u)) return 0;
    if (/\.xlsx?(\?|$)/i.test(u)) return 1;
    return 2;
  }
  return candidates[0] || null;
}

async function realFetch() {
  if (!INTEGRATION_ENABLED) {
    throw new Error(
      "ITEP_INTEGRATION_ENABLED=false — refusing to hit upstream until reuse permission lands.",
    );
  }
  const asset = await discoverAsset();
  if (!asset) throw new Error("itep: no CSV/XLSX asset link found on landing page");
  const ext = asset.href.toLowerCase().match(/\.(csv|xlsx?)(\?|$)/)?.[1] || "";
  const res = await fetchWithTimeout(asset.href);
  if (!res.ok) throw new Error(`itep asset HTTP ${res.status}`);
  if (ext === "csv") {
    const text = await res.text();
    const rows = parseCsv(text)
      .map((r) => shapeRow(r, { edition: EDITION, sourceUrl: asset.href }))
      .filter(Boolean);
    return { rows, sourceUrl: asset.href, sourceKind: "itep-csv" };
  }
  throw new Error(
    `itep asset is ${ext.toUpperCase()} (parser not implemented in v1) — see scripts/itep-tax-fetch.mjs`,
  );
}

// ─────────────────────────── network helper ─────────────────────────
async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,text/csv,application/vnd.ms-excel,*/*;q=0.8",
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
  } finally { clearTimeout(t); }
}

// ─────────────────────────── snapshot helpers ───────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function latestSnapshot() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

// ─────────────────────────── main ───────────────────────────────────

async function main() {
  console.log(
    `itep-tax fetcher starting... (mode=${DRY ? "DRY" : "APPLY"}, integration_enabled=${INTEGRATION_ENABLED}, edition=${EDITION})`,
  );

  let snapshot;

  if (DRY || !INTEGRATION_ENABLED) {
    if (!DRY && !INTEGRATION_ENABLED) {
      console.log(
        "ITEP_INTEGRATION_ENABLED=false — falling back to fixture mode.",
      );
    }
    const latest = await latestSnapshot();
    if (latest) {
      console.log(`Reading cached snapshot: ${path.relative(ROOT, latest)}`);
      snapshot = JSON.parse(await fs.readFile(latest, "utf-8"));
    } else if (existsSync(DEFAULT_FIXTURE)) {
      console.log(
        `No cached snapshot — using bundled fixture ${path.relative(ROOT, DEFAULT_FIXTURE)}.`,
      );
      snapshot = JSON.parse(await fs.readFile(DEFAULT_FIXTURE, "utf-8"));
    } else {
      throw new Error("No cached snapshot and no fixture available.");
    }
  } else {
    const { rows, sourceUrl, sourceKind } = await realFetch();
    snapshot = {
      _license: LICENSE_TAG,
      _dormant: true,
      sourceUrl,
      sourceKind,
      landingUrl: LANDING,
      headlineMirror: HEADLINE_MIRROR,
      reportEdition: EDITION,
      fetchedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows,
    };
  }

  const outPath = OUT_PATH
    ? path.resolve(OUT_PATH)
    : path.join(RAW_DIR, `${todayIso()}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));

  console.log(
    `Wrote ${path.relative(ROOT, outPath)} (${snapshot.rowCount ?? snapshot.rows?.length ?? 0} companies).`,
  );
  if (!INTEGRATION_ENABLED) {
    console.log(
      "(license-pending: set ITEP_INTEGRATION_ENABLED=true to enable live fetch + merge writes.)",
    );
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("itep-tax-fetch failed:", err);
    process.exit(1);
  });
}
