#!/usr/bin/env node
/**
 * OSHA Severe Injury Reports (SIR) — monthly bulk-CSV fetch.
 *
 * Downloads the official SIR dataset (single ZIP containing one CSV covering
 * Jan 2015 → most recent month), parses it once, and aggregates per-brand
 * statistics for every entry in /public/data/top-500-brands.txt.
 *
 *   https://www.osha.gov/severe-injury-reports
 *
 * SIR is the establishment-level injury database (employers must report
 * any work-related amputation, in-patient hospitalization, or eye loss
 * within 24 hours). This is *separate* from the violations/citation
 * endpoint already covered by other pipelines.
 *
 * Output: /public/data/osha-sir.json  (overwritten monthly)
 *
 * Per-brand aggregates:
 *   - total_severe_injuries_2y         (last 24 months from latest data)
 *   - total_amputations_2y
 *   - total_hospitalizations_2y
 *   - by_year             { 2024: 123, 2025: 98, ... } — all years
 *   - sample_records      up to 5 most recent rows
 *
 * Matching strategy: employer name (raw) is normalized (lowercased,
 * punctuation collapsed) and tested for inclusion of the brand's key
 * tokens. We hand-curate a small variations table to catch the most
 * common corporate suffixes ("Walmart Stores Inc." / "Wal-Mart" /
 * "Walmart Distribution Center #...") without sweeping up false
 * positives ("Tyson Plumbing" vs "Tyson Foods").
 *
 * Honor-system rate limit: a single download per run (1 req/sec spacing
 * for the HTML probe + the ZIP). User-Agent: TruNorth-OSHA-SIR/1.0.
 *
 * Runs via .github/workflows/osha-sir-monthly.yml on the 1st of each
 * month at 01:00 UTC.
 *
 * Locally:    node scripts/osha-sir-fetch.mjs
 * Smoke test: node scripts/osha-sir-fetch.mjs --smoke
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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/osha-sir.json");

const UA = "TruNorth-OSHA-SIR/1.0 (+https://www.trunorthapp.com)";
const SIR_PAGE = "https://www.osha.gov/severe-injury-reports";
const SIR_HOST = "https://www.osha.gov";

const SMOKE = process.argv.includes("--smoke");
const SMOKE_SLUGS = new Set(["tyson-foods", "walmart", "amazon"]);

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

  if (SMOKE) return brands.filter((b) => SMOKE_SLUGS.has(b.slug));
  return brands;
}

// ─── name matching ────────────────────────────────────────────────────────
// Normalize: lowercase, strip punctuation, collapse whitespace.
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// For each brand, derive a list of token-strings that an employer's
// normalized name must *include* to count as a match. Hand-tuned for the
// trickiest brands; otherwise we just use the normalized brand name.
// Each entry is { matchAny: [strings] }: any of the strings, when found
// inside the normalized employer name, counts as a match.
const BRAND_MATCHERS = {
  // Industrial / large-employer brands likely to dominate SIR results:
  "tyson-foods":   { matchAny: ["tyson foods", "tyson fresh meats", "tyson poultry", "tyson chicken", "tyson farms"] },
  "walmart":       { matchAny: ["walmart", "wal mart"] },
  "sams-club":     { matchAny: ["sams club", "sam s club"] },
  "amazon":        { matchAny: ["amazon com", "amazon dist", "amazon ful", "amazon log", "amazon ware", "amazon delivery", "amazon transp", "amazon air", "amazon services", "amazon data"] },
  "home-depot":    { matchAny: ["home depot"] },
  "lowes":         { matchAny: ["lowe s home", "lowes home", "lowes companies", "lowe s companies"] },
  "target":        { matchAny: ["target corp", "target stores", "target dist", "target ful"] },
  "costco":        { matchAny: ["costco wholesale", "costco "] },
  "ups":           { matchAny: ["united parcel service", "ups inc", "ups freight", "ups ground"] },
  "fedex":         { matchAny: ["fedex", "federal express"] },
  "ford":          { matchAny: ["ford motor"] },
  "general-motors":{ matchAny: ["general motors"] },
  "boeing":        { matchAny: ["boeing"] },
  "smithfield":    { matchAny: ["smithfield foods", "smithfield pack"] },
  "perdue":        { matchAny: ["perdue farms", "perdue foods"] },
  "jbs":           { matchAny: ["jbs usa", "jbs swift", "jbs foods", "jbs beef", "jbs pork"] },
  "cargill":       { matchAny: ["cargill"] },
  "kroger":        { matchAny: ["kroger"] },
  "publix":        { matchAny: ["publix super"] },
  "starbucks":     { matchAny: ["starbucks"] },
  "mcdonalds":     { matchAny: ["mcdonald"] },
  "coca-cola":     { matchAny: ["coca cola"] },
  "pepsi":         { matchAny: ["pepsi"] },
  "pepsico":       { matchAny: ["pepsico", "pepsi co"] },
  "nestle":        { matchAny: ["nestle "] },
  "unilever":      { matchAny: ["unilever"] },
  "kellogg":       { matchAny: ["kellogg"] },
  "general-mills": { matchAny: ["general mills"] },
};

function matchersFor(brand) {
  const m = BRAND_MATCHERS[brand.slug];
  if (m) return m.matchAny;
  // Default: the brand display name, normalized. We require at least
  // 4-character names to avoid runaway false positives.
  const n = norm(brand.name);
  return n.length >= 4 ? [n] : [];
}

// ─── HTTP / download ──────────────────────────────────────────────────────
async function discoverZipUrl() {
  // The OSHA page links to a ZIP whose filename encodes the date range
  // (e.g. "January2015toAugust2025.zip") and changes each refresh.
  const res = await fetch(SIR_PAGE, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`SIR page HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/href="(\/sites\/default\/files\/[A-Za-z0-9_-]+\.zip)"/);
  if (!m) throw new Error("Could not find SIR ZIP link on osha.gov page");
  return SIR_HOST + m[1];
}

async function downloadZip(url, destPath) {
  await sleep(1000); // 1 req/sec courtesy
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ZIP download HTTP ${res.status}`);
  if (!res.body) throw new Error("Empty response body");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

async function unzipTo(zipPath, destDir) {
  // `unzip` ships with macOS and ubuntu-latest by default. -o = overwrite.
  await execFileP("unzip", ["-o", zipPath, "-d", destDir], { maxBuffer: 1024 * 1024 * 1024 });
  const files = await fs.readdir(destDir);
  const csv = files.find((f) => f.toLowerCase().endsWith(".csv"));
  if (!csv) throw new Error("No CSV found in extracted ZIP");
  return path.join(destDir, csv);
}

// ─── streaming CSV parse ──────────────────────────────────────────────────
// Minimal RFC-4180-ish parser: handles quoted fields, embedded commas,
// embedded newlines (multi-line narratives are common in this dataset),
// and "" → " escapes. Builds rows one at a time and invokes onRow.
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
      header = row;
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
  // flush trailing partial
  if (field.length > 0 || row.length > 0) { finishField(); finishRow(); }
  await handle.close();
}

// ─── aggregation ──────────────────────────────────────────────────────────
function parseEventDate(raw) {
  if (!raw) return null;
  // Formats observed: "1/1/2015", "01/01/2015", ISO. Date.parse handles both.
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}

function pickInt(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.round(n);
}

function aggregateBrand(brand, hits) {
  // hits: array of matched CSV rows for this brand
  const now = Date.now();
  const TWO_Y_MS = 2 * 365 * 24 * 60 * 60 * 1000;
  const cutoff = now - TWO_Y_MS;

  const byYear = {};
  let total2y = 0;
  let amputations2y = 0;
  let hospitalizations2y = 0;

  const sorted = [];

  for (const r of hits) {
    const d = parseEventDate(r["EventDate"]);
    if (!d) continue;
    const yr = d.getUTCFullYear();
    byYear[yr] = (byYear[yr] || 0) + 1;
    sorted.push({ d, r });

    if (d.getTime() >= cutoff) {
      total2y++;
      amputations2y     += pickInt(r["Amputation"]);
      hospitalizations2y += pickInt(r["Hospitalized"]);
    }
  }

  sorted.sort((a, b) => b.d.getTime() - a.d.getTime());
  const samples = sorted.slice(0, 5).map(({ d, r }) => ({
    event_date:        d.toISOString().slice(0, 10),
    employer:          r["Employer"],
    city:              r["City"],
    state:             r["State"],
    part_of_body:      r["Part of Body Title"] || null,
    nature:            r["NatureTitle"] || null,
    event_description: r["EventTitle"] || null,
    final_narrative:   (r["Final Narrative"] || "").slice(0, 400),
    amputation:        pickInt(r["Amputation"]) > 0,
    hospitalized:      pickInt(r["Hospitalized"]) > 0,
  }));

  return {
    slug:                       brand.slug,
    name:                       brand.name,
    status:                     hits.length ? "ok" : "no_records",
    total_severe_injuries_2y:   total2y,
    total_amputations_2y:       amputations2y,
    total_hospitalizations_2y:  hospitalizations2y,
    by_year:                    byYear,
    total_records_all_time:     hits.length,
    sample_records:             samples,
    scraped_at:                 new Date().toISOString(),
  };
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`OSHA SIR fetcher starting${SMOKE ? " (SMOKE)" : ""}...`);

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brand${brands.length === 1 ? "" : "s"}`);

  // Pre-compute matcher tokens per brand
  const matchers = brands.map((b) => ({ brand: b, tokens: matchersFor(b) }));
  const hits = new Map(brands.map((b) => [b.slug, []]));

  // 1. Discover URL + download
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "osha-sir-"));
  const zipUrl = await discoverZipUrl();
  console.log(`Found SIR ZIP: ${zipUrl}`);
  const zipPath = path.join(tmp, "sir.zip");
  await downloadZip(zipUrl, zipPath);
  const zipStat = await fs.stat(zipPath);
  console.log(`Downloaded ${(zipStat.size / 1024 / 1024).toFixed(1)} MB`);

  // 2. Extract
  const csvPath = await unzipTo(zipPath, tmp);
  console.log(`Extracted: ${path.basename(csvPath)}`);

  // 3. Stream-parse and match
  let totalRows = 0;
  let matchedRows = 0;
  await parseCsv(csvPath, (row) => {
    totalRows++;
    const employerNorm = norm(row["Employer"]);
    if (!employerNorm) return;
    for (const { brand, tokens } of matchers) {
      for (const t of tokens) {
        if (employerNorm.includes(t)) {
          hits.get(brand.slug).push(row);
          matchedRows++;
          return; // a row counts against at most one brand
        }
      }
    }
  });

  console.log(`Parsed ${totalRows.toLocaleString()} rows; ${matchedRows.toLocaleString()} matched`);

  // 4. Aggregate
  const results = brands.map((b) => aggregateBrand(b, hits.get(b.slug)));

  const withRecords = results.filter((r) => r.status === "ok").length;
  const noRecords   = results.filter((r) => r.status === "no_records").length;

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source_url:      zipUrl,
    dataset_rows:    totalRows,
    brand_count:     brands.length,
    with_records_count: withRecords,
    no_records_count:   noRecords,
    brands:          results,
  }, null, 2));

  // 5. Cleanup
  try { await fs.rm(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  With records: ${withRecords}`);
  console.log(`  No records:   ${noRecords}`);

  if (SMOKE) {
    console.log("\nSMOKE summary:");
    for (const r of results) {
      console.log(
        `  ${r.slug.padEnd(14)} status=${r.status.padEnd(10)} 2y=${r.total_severe_injuries_2y} amp=${r.total_amputations_2y} hosp=${r.total_hospitalizations_2y} all_time=${r.total_records_all_time}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("osha-sir-fetch failed:", err);
  process.exit(1);
});
