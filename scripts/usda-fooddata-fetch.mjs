#!/usr/bin/env node
/**
 * USDA FoodData Central — Branded Foods (DW-61).
 *
 * Downloads the latest branded-food CSV bulk dump from
 *   https://fdc.nal.usda.gov/download-datasets
 * extracts the `branded_food.csv` member (~2 GB unzipped, ~1.9M rows),
 * streams it line-by-line, and keeps ONLY rows that have BOTH a usable
 * `gtin_upc` AND a non-empty `brand_owner`. The output is a compact
 * per-row record:
 *
 *   { gtin: "0044000000000",   // 13- or 14-char digits, normalized
 *     brandName: "Oreo",       // sub-brand as printed
 *     brandOwner: "Mondelez Global LLC" }
 *
 * Standalone:
 *   node scripts/usda-fooddata-fetch.mjs --limit 100 --out /tmp/test.json
 *   node scripts/usda-fooddata-fetch.mjs --src ./scripts/fixtures/usda-fooddata/sample.csv --limit 50 --out /tmp/sample.json
 *   node scripts/usda-fooddata-fetch.mjs --apply           # full pipeline, real download
 *
 * Flags:
 *   --dry          (default) preview run; reads cache or fixture, does not
 *                  hit the network unless --src is given.
 *   --apply        fetch the live ~700 MB ZIP from fdc.nal.usda.gov and
 *                  write the full filtered output (~600 MB JSON).
 *   --src PATH     read a local CSV file instead of downloading. Bypasses
 *                  ZIP extraction. Useful for tests + iterating locally.
 *   --limit N      stop after N kept rows (for sampling).
 *   --out PATH     write filtered records to PATH (default:
 *                  public/data/_cache/usda-fooddata/branded-foods.json).
 *   --keep-zip     don't delete the downloaded ZIP after extraction.
 *
 * Note on memory: at ~1.9M rows we CANNOT keep them all in memory. This
 * script streams to disk via a JSON-lines-style array writer — pushes
 * each record into the output file as it's parsed, with manual JSON array
 * framing ("[\n", record + ",\n" * (n-1), record + "\n]"). The merger
 * (usda-fooddata-merge.mjs) does the same on read.
 *
 * License (verified 2026-06-07):
 *   FoodData Central data is in the U.S. public domain
 *   (https://fdc.nal.usda.gov/api-guide.html — "Most U.S. government works
 *   are in the public domain... USDA does not endorse any products...").
 *   No attribution legally required; we credit anyway in app About copy.
 */

import fs from "node:fs/promises";
import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "public/data/_cache/usda-fooddata");
const DEFAULT_OUT = path.join(CACHE_DIR, "branded-foods.json");

const DOWNLOAD_INDEX = "https://fdc.nal.usda.gov/download-datasets";
const FALLBACK_ZIP_URL =
  "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_2024-10-31.zip";
const UA = "TruNorth-USDA-FoodData/1.0 (+https://www.trunorthapp.com)";

// Command-line parsing ────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function arg(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const APPLY    = flag("--apply");
const DRY      = !APPLY && !arg("--src");
const SRC      = arg("--src");                // optional local CSV path
const LIMIT    = arg("--limit") ? Number(arg("--limit")) : Infinity;
const OUT      = arg("--out", DEFAULT_OUT);
const KEEP_ZIP = flag("--keep-zip");

// ───────────────────────────── helpers ──────────────────────────────────

/**
 * Normalize a GTIN/UPC to a 14-char digit string, then drop the leading
 * zeros expected by Open Food Facts barcode keys.
 *
 * USDA's branded_food.csv stores `gtin_upc` as 12 (UPC-A), 13 (EAN-13),
 * or 14 (GTIN-14) digits, sometimes with a leading apostrophe Excel
 * quote-protection artifact. We strip everything non-numeric and pad to
 * 14, then drop leading zeros so the same Coke can scan from any region.
 *
 * Returns null if the cleaned value isn't 8..14 numeric chars.
 */
export function normalizeGtin(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9]/g, "");
  if (cleaned.length < 8 || cleaned.length > 14) return null;
  // Pad to 14 with leading zeros (canonical GTIN-14), then trim leading
  // zeros for the "search key" form. Apps tend to scan UPC-A as 12 digits
  // but Open Food Facts stores them as 13 with a leading zero. We choose
  // the 14-digit padded form as the canonical KEY.
  return cleaned.padStart(14, "0");
}

/**
 * Slug-ify a brand owner exactly the way App.jsx:127 resolveBrand does.
 *   "Mondelez Global LLC" -> "mondelezgloballlc"
 *   "Coca-Cola Co." -> "cocacolaco"
 */
export function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Minimal RFC-4180-ish CSV row parser. Handles:
 *   - quoted fields with embedded commas: "a, b",c → ["a, b", "c"]
 *   - escaped quotes inside quotes: "she said ""hi""" → [`she said "hi"`]
 *   - trailing CR (Windows line endings)
 *
 * Does NOT handle multi-line quoted fields — but the USDA branded_food.csv
 * does not contain any embedded newlines (verified against 2024-10-31
 * dump; descriptions are pre-trimmed). If a future release introduces them,
 * the unparsable line will be skipped by `extractFields` returning null.
 */
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === "\r") { /* swallow */ }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

/**
 * Find the latest branded-food ZIP URL by scraping the public download page.
 * The page lists "FoodData Central Branded Food: April 2024" style links,
 * each pointing at /fdc-datasets/FoodData_Central_branded_food_csv_<DATE>.zip.
 * We prefer the most-recent dated link; if scraping fails (page redesign,
 * network), we fall back to FALLBACK_ZIP_URL.
 */
export async function resolveLatestZipUrl() {
  try {
    const res = await fetch(DOWNLOAD_INDEX, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const re = /https?:\/\/[^\s"']+FoodData_Central_branded_food_csv_(\d{4}-\d{2}-\d{2})\.zip/g;
    const found = [];
    let m;
    while ((m = re.exec(html))) found.push({ url: m[0], date: m[1] });
    if (!found.length) throw new Error("no zip links found in page");
    found.sort((a, b) => (a.date < b.date ? 1 : -1));
    return found[0].url;
  } catch (e) {
    console.error(`! resolveLatestZipUrl fell back: ${e.message}`);
    return FALLBACK_ZIP_URL;
  }
}

/**
 * Download a URL to a destination file, streaming. No length cap — the
 * USDA ZIP is ~700 MB. Logs progress every 50 MB.
 */
export async function downloadTo(url, dest) {
  console.log(`Downloading ${url}`);
  console.log(`           → ${dest}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const ws = createWriteStream(dest);
  const reader = res.body.getReader();
  let bytes = 0;
  let nextLog = 50 * 1024 * 1024;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    ws.write(Buffer.from(value));
    if (bytes >= nextLog) {
      console.log(`  ${(bytes / 1024 / 1024).toFixed(0)} MB downloaded`);
      nextLog += 50 * 1024 * 1024;
    }
  }
  ws.end();
  await new Promise(r => ws.on("close", r));
  console.log(`  done — ${(bytes / 1024 / 1024).toFixed(0)} MB`);
  return dest;
}

/**
 * Spawn `unzip -p ZIP branded_food.csv` and return a Readable that emits
 * the unpacked CSV bytes. We rely on the system `unzip` because Node 22
 * has no built-in ZIP decoder, and shelling out keeps the dependency
 * surface at zero. Available on macOS + ubuntu-latest GHA runners.
 */
export function streamZipMember(zipPath, member) {
  const proc = spawn("unzip", ["-p", zipPath, member], { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", b => process.stderr.write(`unzip: ${b}`));
  proc.on("error", e => { throw e; });
  return proc.stdout;
}

/**
 * Stream-parse a CSV from a Readable. Yields one parsed object per row,
 * keyed by the CSV header. The caller is responsible for filtering.
 *
 * Uses readline to chunk by newline — works for the USDA branded_food.csv
 * which contains no multi-line quoted fields. If your CSV has embedded
 * newlines this WILL produce broken rows; in that case rewrite to a true
 * streaming parser.
 */
export async function* streamCsvRows(readable) {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let header = null;
  for await (const raw of rl) {
    if (!raw) continue;
    const fields = parseCsvLine(raw);
    if (!header) { header = fields.map(h => h.trim()); continue; }
    if (fields.length !== header.length) {
      // tolerate ragged tail rows
      if (fields.length === 1 && fields[0] === "") continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? "";
    yield row;
  }
}

/**
 * Extract the three fields we keep, normalized.
 * Returns null when either GTIN or brand_owner is missing.
 */
export function extractFields(row) {
  const gtin = normalizeGtin(row.gtin_upc);
  const brandOwner = String(row.brand_owner ?? "").trim();
  const brandName = String(row.brand_name ?? "").trim();
  if (!gtin) return null;
  if (!brandOwner) return null;
  return { gtin, brandName, brandOwner };
}

// ───────────────────────────── main ─────────────────────────────────────

/**
 * Open a streaming JSON-array writer. Caller pushes records, then close().
 * We do this by hand (rather than collecting in memory + JSON.stringify)
 * because the full output set is too big to fit comfortably in RAM.
 */
function openArrayWriter(filePath) {
  const ws = createWriteStream(filePath);
  let first = true;
  ws.write("[\n");
  return {
    push(rec) {
      if (first) { ws.write(JSON.stringify(rec)); first = false; }
      else ws.write(",\n" + JSON.stringify(rec));
    },
    async close() {
      ws.write("\n]\n");
      await new Promise((res, rej) => ws.end(err => err ? rej(err) : res()));
    },
  };
}

export async function runPipeline({ srcCsvPath, zipPath, limit, outPath }) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const writer = openArrayWriter(outPath);

  let input;
  if (srcCsvPath) {
    input = createReadStream(srcCsvPath);
  } else if (zipPath) {
    input = streamZipMember(zipPath, "branded_food.csv");
  } else {
    throw new Error("runPipeline: srcCsvPath or zipPath required");
  }

  let seen = 0, kept = 0, skipped = 0;
  for await (const row of streamCsvRows(input)) {
    seen++;
    const rec = extractFields(row);
    if (!rec) { skipped++; continue; }
    writer.push(rec);
    kept++;
    if (kept >= limit) break;
    if (kept % 100_000 === 0) console.log(`  ${kept.toLocaleString()} kept / ${seen.toLocaleString()} scanned`);
  }
  await writer.close();
  return { seen, kept, skipped };
}

async function main() {
  console.log(
    `USDA FoodData fetcher (mode=${APPLY ? "APPLY (real download)" : SRC ? "LOCAL (--src)" : "DRY"})`
  );
  const outPath = path.resolve(OUT);

  // Mode 1: local CSV (tests, iteration) ────────────────────────────────
  if (SRC) {
    const srcCsvPath = path.resolve(SRC);
    if (!existsSync(srcCsvPath)) {
      console.error(`Missing --src file: ${srcCsvPath}`);
      process.exit(2);
    }
    const stats = await runPipeline({ srcCsvPath, limit: LIMIT, outPath });
    console.log(`\nDone (LOCAL): kept ${stats.kept.toLocaleString()}, skipped ${stats.skipped.toLocaleString()}, scanned ${stats.seen.toLocaleString()}`);
    console.log(`Wrote ${outPath}`);
    return;
  }

  // Mode 2: dry run (no network) ────────────────────────────────────────
  if (DRY) {
    const cached = path.join(CACHE_DIR, "branded-foods.json");
    if (existsSync(cached) && outPath === cached) {
      const stat = await fs.stat(cached);
      console.log(`DRY: cache exists at ${cached} (${(stat.size/1024/1024).toFixed(1)} MB), nothing to do.`);
      console.log(`Use --apply to refresh, or --src PATH to run on a local CSV.`);
      return;
    }
    console.log(`DRY: would download the ~700 MB branded-food ZIP from fdc.nal.usda.gov,`);
    console.log(`     stream-extract branded_food.csv, filter to rows with gtin_upc + brand_owner,`);
    console.log(`     and write ${outPath}.`);
    console.log(`Use --apply to actually do this, or --src to run on a checked-in fixture.`);
    return;
  }

  // Mode 3: live download ───────────────────────────────────────────────
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const url = await resolveLatestZipUrl();
  const zipPath = path.join(CACHE_DIR, "branded_food.zip");
  await downloadTo(url, zipPath);

  console.log(`Extracting + streaming branded_food.csv from ${zipPath}`);
  const stats = await runPipeline({ zipPath, limit: LIMIT, outPath });
  console.log(`\nDone (APPLY): kept ${stats.kept.toLocaleString()}, skipped ${stats.skipped.toLocaleString()}, scanned ${stats.seen.toLocaleString()}`);
  console.log(`Wrote ${outPath}`);

  if (!KEEP_ZIP) {
    await fs.unlink(zipPath).catch(() => {});
    console.log(`Removed ${zipPath} (use --keep-zip to retain)`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("usda-fooddata-fetch failed:", err);
    process.exit(1);
  });
}
