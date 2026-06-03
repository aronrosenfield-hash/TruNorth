#!/usr/bin/env node
/**
 * DOL WHD (Wage and Hour Division) — monthly wage-theft enforcement fetch.
 *
 * Downloads the Department of Labor's WHD WHISARD (Wage Hour Investigative
 * Support and Reporting Database) bulk dataset and aggregates per-brand
 * statistics for every entry in /public/data/top-500-brands.txt.
 *
 *   Landing:     https://enforcedata.dol.gov
 *   Summary UI:  https://enforcedata.dol.gov/views/data_summary.php
 *
 * The WHD dataset covers Fair Labor Standards Act (FLSA), Family and Medical
 * Leave Act (FMLA), Migrant and Seasonal Agricultural Worker Protection Act
 * (MSPA), Davis-Bacon (DBRA), Service Contract Act (SCA), and H-2A/H-2B/H-1B
 * temporary-worker visa enforcement actions. Each row is one concluded
 * compliance action against one employer establishment, with back wages
 * found-owed and number of employees affected.
 *
 * Per-brand aggregates (last 5 fiscal years):
 *   - total_whd_cases_5y          — count of concluded actions
 *   - total_back_wages_owed_usd   — sum of bw_atp_amt (back wages agreed to pay)
 *   - total_employees_affected    — sum of ee_violtd_cnt (employees with violations)
 *   - top_violation_types         — top 5 by case_violtn_cnt
 *   - sample_cases                — 5 most recent cases
 *   - by_year                     — count by fiscal year (FY)
 *
 * Matching strategy mirrors osha-sir-fetch.mjs: a hand-tuned BRAND_MATCHERS
 * table for large/ambiguous employers (Walmart, Amazon, etc.) plus a
 * normalized-name fallback for the rest. A row counts against at most one
 * brand.
 *
 * Network strategy (DOL site is a React SPA — no public REST API for the
 * dataset, and the v4 / OData APIs require auth):
 *   1. Probe a small set of well-known bulk-download URLs in priority order.
 *   2. The first one that returns a binary ZIP / CSV is used.
 *   3. If none respond, write an `unavailable` result and exit 0 so the
 *      monthly workflow doesn't fail noisily; we just keep stale data.
 *
 * 1 req/sec courtesy spacing. UA: TruNorth-DOL-WHD/1.0.
 *
 * Output: /public/data/dol-whd.json  (overwritten monthly)
 *
 * Runs via .github/workflows/dol-whd-monthly.yml on the 1st of each month
 * at 06:00 UTC.
 *
 * Locally:    node scripts/dol-whd-fetch.mjs
 * Smoke test: node scripts/dol-whd-fetch.mjs --smoke
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileP = promisify(execFile);
const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/dol-whd.json");

const UA = "TruNorth-DOL-WHD/1.0 (+https://www.trunorthapp.com)";

// Candidate bulk-download URLs, in priority order. The DOL enforcement-data
// SPA references these under the hood for the "download" buttons; the exact
// host has moved a few times (enfxfr → data → enforcedata). We probe each
// and use the first ZIP/CSV that responds with a binary payload.
const BULK_CANDIDATES = [
  "https://enforcedata.dol.gov/data_catalog/WHD/whd_whisard.csv.zip",
  "https://enforcedata.dol.gov/data_catalog/WHD/whd_whisard.json.zip",
  "https://data.dol.gov/data_catalog/WHD/whd_whisard.csv.zip",
  "https://enfxfr.dol.gov/data_catalog/WHD/whd_whisard.csv.zip",
];

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const SMOKE = process.argv.includes("--smoke");
const SMOKE_SLUGS = new Set(["walmart", "mcdonalds", "amazon", "tyson-foods"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── brand loading ────────────────────────────────────────────────────────
async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  const brands = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name, category] = l.split("|").map((s) => s.trim());
      return { slug, name, category };
    })
    .filter((b) => b.slug && b.name);

  if (SMOKE) return brands.filter((b) => SMOKE_SLUGS.has(b.slug));
  return brands;
}

// ─── name matching ────────────────────────────────────────────────────────
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// For large/ambiguous employers, list the substrings that — when found
// inside the normalized employer name — count as a positive match.
// Default-case brands use the normalized brand display name.
const BRAND_MATCHERS = {
  "walmart":        { matchAny: ["walmart", "wal mart"] },
  "sams-club":      { matchAny: ["sams club", "sam s club"] },
  "amazon":         { matchAny: ["amazon com", "amazon dist", "amazon ful", "amazon log", "amazon ware", "amazon delivery", "amazon transp", "amazon air", "amazon services", "amazon data"] },
  "mcdonalds":      { matchAny: ["mcdonald"] },
  "tyson-foods":    { matchAny: ["tyson foods", "tyson fresh meats", "tyson poultry", "tyson chicken", "tyson farms"] },
  "burger-king":    { matchAny: ["burger king"] },
  "wendys":         { matchAny: ["wendy s ", "wendys "] },
  "subway":         { matchAny: ["subway ", "doctor s associates", "doctors associates"] },
  "kfc":            { matchAny: ["kfc ", "kentucky fried chicken"] },
  "chipotle":       { matchAny: ["chipotle"] },
  "starbucks":      { matchAny: ["starbucks"] },
  "dunkin":         { matchAny: ["dunkin"] },
  "dominos":        { matchAny: ["domino s pizza", "dominos pizza"] },
  "pizza-hut":      { matchAny: ["pizza hut"] },
  "papa-johns":     { matchAny: ["papa john"] },
  "target":         { matchAny: ["target corp", "target stores", "target dist", "target ful"] },
  "home-depot":     { matchAny: ["home depot"] },
  "lowes":          { matchAny: ["lowe s home", "lowes home", "lowes companies", "lowe s companies"] },
  "costco":         { matchAny: ["costco wholesale", "costco "] },
  "kroger":         { matchAny: ["kroger"] },
  "publix":         { matchAny: ["publix super"] },
  "ups":            { matchAny: ["united parcel service", "ups inc", "ups freight", "ups ground"] },
  "fedex":          { matchAny: ["fedex", "federal express"] },
  "ford":           { matchAny: ["ford motor"] },
  "general-motors": { matchAny: ["general motors"] },
  "boeing":         { matchAny: ["boeing"] },
  "smithfield":     { matchAny: ["smithfield foods", "smithfield pack"] },
  "perdue":         { matchAny: ["perdue farms", "perdue foods"] },
  "jbs":            { matchAny: ["jbs usa", "jbs swift", "jbs foods", "jbs beef", "jbs pork"] },
  "cargill":        { matchAny: ["cargill"] },
  "coca-cola":      { matchAny: ["coca cola"] },
  "pepsi":          { matchAny: ["pepsi"] },
  "pepsico":        { matchAny: ["pepsico", "pepsi co"] },
  "nestle":         { matchAny: ["nestle "] },
  "unilever":       { matchAny: ["unilever"] },
  "kellogg":        { matchAny: ["kellogg"] },
  "general-mills":  { matchAny: ["general mills"] },
  "tesla":          { matchAny: ["tesla "] },
  "apple":          { matchAny: ["apple inc", "apple computer", "apple retail"] },
  "google":         { matchAny: ["google llc", "google inc"] },
  "meta":           { matchAny: ["meta platforms", "facebook inc"] },
  "microsoft":      { matchAny: ["microsoft corp"] },
};

function matchersFor(brand) {
  const m = BRAND_MATCHERS[brand.slug];
  if (m) return m.matchAny;
  const n = norm(brand.name);
  // Require 4+ chars to avoid runaway false positives.
  return n.length >= 4 ? [n] : [];
}

// ─── bulk-download discovery ──────────────────────────────────────────────
async function probeBulk(url) {
  // HEAD first so we don't waste a download on HTML-redirect SPAs.
  try {
    const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
    if (!head.ok) return null;
    const ct = (head.headers.get("content-type") || "").toLowerCase();
    const len = Number(head.headers.get("content-length") || 0);
    // Reject obvious SPA HTML shells (~11 KB on the DOL site).
    if (ct.startsWith("text/html")) return null;
    if (ct.includes("zip") || ct.includes("octet-stream") || ct.includes("csv") || ct.includes("json")) {
      return { url, contentType: ct, contentLength: len };
    }
    return null;
  } catch {
    return null;
  }
}

async function discoverBulkUrl() {
  for (const cand of BULK_CANDIDATES) {
    await sleep(1000); // 1 req/sec courtesy
    const hit = await probeBulk(cand);
    if (hit) return hit;
  }
  return null;
}

async function downloadBinary(url, destPath) {
  await sleep(1000);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  if (!res.body) throw new Error("empty body");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

async function unzipTo(zipPath, destDir) {
  await execFileP("unzip", ["-o", zipPath, "-d", destDir], { maxBuffer: 1024 * 1024 * 1024 });
  const files = await fs.readdir(destDir);
  // Prefer the largest CSV/JSON in the archive.
  let best = null;
  let bestSize = -1;
  for (const f of files) {
    const lower = f.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".json")) continue;
    const st = await fs.stat(path.join(destDir, f));
    if (st.size > bestSize) { best = f; bestSize = st.size; }
  }
  if (!best) throw new Error("no CSV/JSON found in extracted ZIP");
  return path.join(destDir, best);
}

// ─── streaming CSV parse (RFC-4180-ish, handles quoted multi-line fields) ─
async function parseCsv(filePath, onRow) {
  const handle = await fs.open(filePath, "r");
  const stream = handle.createReadStream({ encoding: "utf-8" });

  let header = null;
  let buf = "";
  let inQuotes = false;
  let field = "";
  let row = [];

  const finishField = () => { row.push(field); field = ""; };
  const finishRow = () => {
    if (!header) {
      header = row.map((h) => h.trim());
    } else if (row.length > 1) {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? "";
      onRow(obj);
    }
    row = [];
  };

  for await (const chunk of stream) {
    buf += chunk;
    let i = 0;
    while (i < buf.length) {
      const c = buf[i];
      if (inQuotes) {
        if (c === '"') {
          if (buf[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { finishField(); i++; continue; }
      if (c === "\n") { finishField(); finishRow(); i++; continue; }
      if (c === "\r") { i++; continue; }
      field += c; i++;
    }
    buf = "";
  }
  if (field.length > 0 || row.length > 0) { finishField(); finishRow(); }
  await handle.close();
}

// ─── streaming JSON parse (array-of-objects) ──────────────────────────────
// Some DOL bulk drops are a JSON array of records. We do a forgiving parse:
// read the whole file (these are bounded, ~hundreds of MB at worst for WHD)
// then iterate. For files >500 MB we'd need a streaming JSON parser; today
// the WHD WHISARD JSON file is well under that.
async function parseJson(filePath, onRow) {
  const text = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(text);
  const arr = Array.isArray(parsed) ? parsed : (parsed.data || parsed.rows || []);
  for (const r of arr) onRow(r);
}

// ─── field accessors (be liberal — DOL renames columns occasionally) ─────
function pickField(row, candidates) {
  for (const c of candidates) {
    if (row[c] != null && row[c] !== "") return row[c];
    // Case-insensitive fallback
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === c.toLowerCase() && row[k] != null && row[k] !== "") return row[k];
    }
  }
  return null;
}

function rowEmployer(row) {
  return pickField(row, ["trade_nm", "legal_name", "employer", "trade_name", "legal_nm", "case_employer_name"]);
}
function rowBackWages(row) {
  const v = pickField(row, ["bw_atp_amt", "back_wages", "bw_amt", "amt_due", "amount_owed"]);
  const n = Number(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function rowEmployeesAffected(row) {
  const v = pickField(row, ["ee_violtd_cnt", "ee_pd_cnt", "employees_affected", "employees", "ee_cnt"]);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function rowViolationCount(row) {
  const v = pickField(row, ["case_violtn_cnt", "violations_count", "violtn_cnt"]);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function rowViolationType(row) {
  return pickField(row, ["acts", "act_id_lbl", "violation_type", "act_desc", "primary_act"]);
}
function rowCaseDate(row) {
  const raw = pickField(row, ["findings_end_date", "case_end_date", "findings_end_dt", "end_dt", "concluded_date"]);
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? null : new Date(t);
}
function rowCaseId(row) {
  return pickField(row, ["case_id", "case_no", "case_number", "case_idnum"]);
}
function rowCity(row)  { return pickField(row, ["st_cd_lbl", "city", "city_nm"]); }
function rowState(row) { return pickField(row, ["st_cd", "state", "st_abbrev"]); }

// ─── aggregation ──────────────────────────────────────────────────────────
function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function aggregateBrand(brand, hits) {
  const now = Date.now();
  const cutoff = now - FIVE_YEARS_MS;

  let total5y = 0;
  let backWages5y = 0;
  let employeesAffected5y = 0;
  const byYear = {};
  const violationTypes = [];
  const sorted = [];

  for (const r of hits) {
    const d = rowCaseDate(r);
    if (!d) continue;
    const yr = d.getUTCFullYear();
    byYear[yr] = (byYear[yr] || 0) + 1;
    sorted.push({ d, r });

    if (d.getTime() >= cutoff) {
      total5y++;
      backWages5y         += rowBackWages(r);
      employeesAffected5y += rowEmployeesAffected(r);
      const vt = rowViolationType(r);
      if (vt) violationTypes.push(vt);
    }
  }

  sorted.sort((a, b) => b.d.getTime() - a.d.getTime());
  const samples = sorted.slice(0, 5).map(({ d, r }) => ({
    case_id:              rowCaseId(r),
    end_date:             d.toISOString().slice(0, 10),
    employer:             rowEmployer(r),
    city:                 rowCity(r),
    state:                rowState(r),
    violation_type:       rowViolationType(r),
    violations_count:     rowViolationCount(r),
    back_wages_owed_usd:  rowBackWages(r),
    employees_affected:   rowEmployeesAffected(r),
  }));

  return {
    slug:                       brand.slug,
    name:                       brand.name,
    status:                     hits.length ? "ok" : "no_records",
    total_whd_cases_5y:         total5y,
    total_back_wages_owed_usd:  Math.round(backWages5y),
    total_employees_affected:   employeesAffected5y,
    top_violation_types:        topN(violationTypes, 5),
    by_year:                    byYear,
    total_records_all_time:     hits.length,
    sample_cases:               samples,
    scraped_at:                 new Date().toISOString(),
  };
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`DOL WHD fetcher starting${SMOKE ? " (SMOKE)" : ""}...`);

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brand${brands.length === 1 ? "" : "s"}`);

  // 1. Discover the bulk URL.
  const bulk = await discoverBulkUrl();
  if (!bulk) {
    console.warn("⚠ No reachable DOL WHD bulk-download URL — site is SPA-only");
    console.warn("  Writing 'unavailable' result; existing per-company data preserved.");
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify({
      generated_at:    new Date().toISOString(),
      source_url:      null,
      status:          "source_unavailable",
      note:            "DOL enforcedata.dol.gov is a React SPA with no public REST API for the WHD WHISARD dataset; bulk-download URLs probed: " + BULK_CANDIDATES.join(", "),
      brand_count:     brands.length,
      brands:          brands.map((b) => ({ slug: b.slug, name: b.name, status: "source_unavailable" })),
    }, null, 2));
    return;
  }

  console.log(`Found bulk URL: ${bulk.url} (${bulk.contentType}, ${(bulk.contentLength / 1024 / 1024).toFixed(1)} MB)`);

  // 2. Download to temp.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dol-whd-"));
  const dlPath = path.join(tmp, "whd_whisard" + (bulk.url.endsWith(".zip") ? ".zip" : path.extname(bulk.url) || ".bin"));
  await downloadBinary(bulk.url, dlPath);
  const dlStat = await fs.stat(dlPath);
  console.log(`Downloaded ${(dlStat.size / 1024 / 1024).toFixed(1)} MB`);

  // 3. Extract if ZIP, else use directly.
  let dataPath;
  if (bulk.url.endsWith(".zip")) {
    dataPath = await unzipTo(dlPath, tmp);
  } else {
    dataPath = dlPath;
  }
  console.log(`Data file: ${path.basename(dataPath)}`);

  // 4. Stream-parse + match.
  const matchers = brands.map((b) => ({ brand: b, tokens: matchersFor(b) }));
  const hits = new Map(brands.map((b) => [b.slug, []]));

  let totalRows = 0;
  let matchedRows = 0;
  const onRow = (row) => {
    totalRows++;
    const employerNorm = norm(rowEmployer(row));
    if (!employerNorm) return;
    for (const { brand, tokens } of matchers) {
      for (const t of tokens) {
        if (employerNorm.includes(t)) {
          hits.get(brand.slug).push(row);
          matchedRows++;
          return;
        }
      }
    }
  };

  if (dataPath.toLowerCase().endsWith(".json")) {
    await parseJson(dataPath, onRow);
  } else {
    await parseCsv(dataPath, onRow);
  }

  console.log(`Parsed ${totalRows.toLocaleString()} rows; ${matchedRows.toLocaleString()} matched`);

  // 5. Aggregate.
  const results = brands.map((b) => aggregateBrand(b, hits.get(b.slug)));
  const withRecords = results.filter((r) => r.status === "ok").length;
  const noRecords   = results.filter((r) => r.status === "no_records").length;

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date().toISOString(),
    source_url:          bulk.url,
    status:              "ok",
    dataset_rows:        totalRows,
    brand_count:         brands.length,
    with_records_count:  withRecords,
    no_records_count:    noRecords,
    brands:              results,
  }, null, 2));

  try { await fs.rm(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  With records: ${withRecords}`);
  console.log(`  No records:   ${noRecords}`);

  if (SMOKE) {
    console.log("\nSMOKE summary:");
    for (const r of results) {
      console.log(
        `  ${r.slug.padEnd(14)} status=${r.status.padEnd(10)} 5y_cases=${r.total_whd_cases_5y} back_wages=$${r.total_back_wages_owed_usd.toLocaleString()} ee=${r.total_employees_affected}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("dol-whd-fetch failed:", err);
  process.exit(1);
});
