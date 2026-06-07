#!/usr/bin/env node
/**
 * GDPR Enforcement Tracker fetcher — B-DATA10.
 *
 *   https://www.enforcementtracker.com/
 *
 * EnforcementTracker is a community-maintained database of every GDPR fine
 * issued by EU/EEA + UK data-protection authorities. ~2,500 records as of
 * 2026, including blockbuster fines (Meta €1.2B, Amazon €746M) that don't
 * show up in our HIBP breach feed because they're regulator penalties, not
 * data breaches. Direct privacy-category signal for TruNorth scoring.
 *
 * STRATEGY
 *   1. Their public endpoint returns a JSON-shaped DataTables payload with
 *      every fine: { date, fine_eur, controller, authority, country,
 *      violation_type, article, url }.
 *   2. We hit the bulk endpoint once per quarter, dedupe by ETid, and write
 *      the normalised list to public/data/_raw/gdpr-fines.json.
 *
 * ENDPOINT
 *   The site exposes the underlying dataset as JSON via its API; details
 *   change over time, so a single JSON-fixture path is honoured in dry-run.
 *
 * THROTTLE / POLITENESS
 *   - 1 req every 2 sec
 *   - Honest UA
 *   - We only hit once per quarter — minimal load on a volunteer-run site
 *
 * OUTPUT
 *   public/data/_raw/gdpr-fines.json
 *   {
 *     generated_at,
 *     dry_run: bool,
 *     fine_count,
 *     fines: [{ id, date, fine_eur, controller, authority, country,
 *               violation_type, article, url }]
 *   }
 *
 * Runs quarterly via .github/workflows/eu-enforcement-quarterly.yml.
 *
 * Locally:
 *   node scripts/gdpr-enforcement-fetch.mjs            # DRY-RUN (default)
 *   node scripts/gdpr-enforcement-fetch.mjs --live     # live fetch (cron only)
 *   node scripts/gdpr-enforcement-fetch.mjs --fixture  # explicit fixture mode
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const OUT_FILE = path.join(RAW_DIR, "gdpr-fines.json");
const FIXTURE_FILE = path.join(ROOT, "test/fixtures/eu-enforcement/gdpr-fines.json");

const ET_BASE = "https://www.enforcementtracker.com";
// EnforcementTracker exposes the dataset behind a DataTables JSON endpoint;
// the exact path drifts as they iterate. We default to the documented
// "data.json" mirror they publish alongside the public site.
const ET_DATA_PATH = "/data.json";

const UA = "TruNorth-GDPR/1.0 (+https://www.trunorthapp.com; data pipeline for EU privacy enforcement transparency)";

const argv = new Set(process.argv.slice(2));
const LIVE_MODE    = argv.has("--live");
const FIXTURE_MODE = !LIVE_MODE;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchJson(url, attempt = 0) {
  if (FIXTURE_MODE) {
    if (existsSync(FIXTURE_FILE)) {
      return JSON.parse(await fs.readFile(FIXTURE_FILE, "utf-8"));
    }
    return { fines: [] };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      redirect: "follow",
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchJson(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

/* ----------------------------- normalize -------------------------------- */
// Accept both the DataTables-style payload {data:[[...],[...]]} and a
// pre-normalised {fines:[{...}]} shape (our fixture format).

export function normalizeFines(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.fines)) {
    return payload.fines.map(normalizeOne).filter(Boolean);
  }
  if (Array.isArray(payload.data)) {
    // DataTables column order on enforcementtracker.com (subject to change):
    //   [ETid, country, date, fine_eur, controller, authority,
    //    sector, violation_type, article, source]
    return payload.data.map(row => normalizeOne({
      id:             row[0],
      country:        row[1],
      date:           row[2],
      fine_eur:       parseEur(row[3]),
      controller:     row[4],
      authority:      row[5],
      sector:         row[6],
      violation_type: row[7],
      article:        row[8],
      url:            row[9],
    })).filter(Boolean);
  }
  return [];
}

function normalizeOne(f) {
  if (!f || !f.controller) return null;
  const fine_eur = typeof f.fine_eur === "number" ? f.fine_eur : parseEur(f.fine_eur);
  return {
    id:             f.id || slugifyId(`${f.controller}-${f.date || ""}`),
    date:           normalizeDate(f.date),
    fine_eur:       Number.isFinite(fine_eur) ? fine_eur : 0,
    controller:     String(f.controller).trim(),
    authority:      f.authority ? String(f.authority).trim() : null,
    country:        f.country ? String(f.country).trim() : null,
    violation_type: f.violation_type ? String(f.violation_type).trim() : null,
    article:        f.article ? String(f.article).trim() : null,
    url:            f.url || (f.id ? `${ET_BASE}/${f.id}` : null),
  };
}

function parseEur(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = String(v).replace(/[€\sEUR,]/gi, "").replace(/\.(?=\d{3}(\D|$))/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  // Try DD/MM/YYYY
  const m = String(v).match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  return null;
}

function slugifyId(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function dedupeById(arr) {
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/* ------------------------------- main ----------------------------------- */

export async function fetchAllFines() {
  const payload = await fetchJson(`${ET_BASE}${ET_DATA_PATH}`);
  return dedupeById(normalizeFines(payload));
}

async function main() {
  console.log(`GDPR enforcement fetcher starting (${LIVE_MODE ? "LIVE" : "DRY/fixture"} mode)…`);

  const fines = await fetchAllFines();
  console.log(`Collected ${fines.length} fines`);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const out = {
    generated_at: new Date().toISOString(),
    source_url:   `${ET_BASE}${ET_DATA_PATH}`,
    dry_run:      !LIVE_MODE,
    fixture_mode: FIXTURE_MODE,
    fine_count:   fines.length,
    fines,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_FILE}`);

  // Summary
  const total = fines.reduce((s, f) => s + (f.fine_eur || 0), 0);
  const big = fines.filter(f => f.fine_eur >= 100_000_000).length;
  console.log(`  total EUR: ${total.toLocaleString()}`);
  console.log(`  >€100M fines: ${big}`);
  const byCountry = {};
  for (const f of fines) byCountry[f.country || "?"] = (byCountry[f.country || "?"] || 0) + 1;
  console.log("  by country:", byCountry);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("GDPR enforcement fetcher failed:", err);
    process.exit(1);
  });
}
