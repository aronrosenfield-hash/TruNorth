#!/usr/bin/env node
/**
 * FDAAA TrialsTracker — clinical-trial reporting compliance (monthly)
 *
 * Source: https://fdaaa.trialstracker.net
 *   - Sponsor + trial-count list:  /api/sponsors/?format=csv
 *   - Per-sponsor compliance ranking (due / reported / %): /api/rankings/?format=csv
 *   - Per-trial detail:             /api/trials/?format=csv (~49k rows)
 *
 * About the data:
 *   The US Food and Drug Administration Amendments Act (FDAAA 801) requires
 *   sponsors of "applicable clinical trials" to report summary results to
 *   ClinicalTrials.gov within 12 months of the trial's primary completion
 *   date. The Bennett Institute / DataLab at the University of Oxford
 *   tracks every "applicable" trial and publishes the resulting compliance
 *   gap — i.e. who is hiding clinical-trial results from the public.
 *
 * License:
 *   Apache-2.0 (per https://github.com/ebmdatalab/clinicaltrials-act-tracker
 *   and the explicit "open data" labelling on fdaaa.trialstracker.net).
 *   We capture the source URL on every record and stamp `_license` on the
 *   raw + derived files.
 *
 * STRATEGY
 *   1. GET /api/rankings/?format=csv  → one row per sponsor (≈9,800 incl.
 *      academic; ~5,000 industry). Columns: date, due, reported, percentage,
 *      sponsor_name, sponsor_slug, is_industry_sponsor, …
 *   2. GET /api/sponsors/?format=csv  → total trial count per sponsor.
 *      Columns: is_industry_sponsor, name, num_trials, slug, updated_date.
 *   3. Optionally GET /api/trials/?format=csv  → per-trial breakdown so
 *      downstream pipelines can audit/explain compliance. Enabled by
 *      default; skip with --no-trials for a quick smoke test.
 *   4. Per sponsor, derive:
 *        totalTrials                ← from /sponsors/
 *        trialsDue                  ← from /rankings/
 *        trialsReported             ← from /rankings/
 *        trialsLateOrMissing        ← due − reported  (≥ 0)
 *        compliancePct              ← rankings.percentage (0–100, integer)
 *      Plus pass-throughs: sponsor_slug, sponsor_name, is_industry_sponsor,
 *      year (from rankings.date), source URLs.
 *
 * THROTTLE
 *   We only hit 3 endpoints, so no per-row throttling is needed. We set a
 *   single-request timeout (120 s) and retry transient 5xx with exponential
 *   backoff (3 tries, 4/8/16 s).
 *
 * OUTPUT
 *   data/raw/fdaaa-trials/<YYYY-MM-DD>.json
 *   {
 *     _license: "Apache-2.0",
 *     _source: "https://fdaaa.trialstracker.net",
 *     _generated_at: "...",
 *     _endpoints: { sponsors, rankings, trials },
 *     _row_counts: { sponsors, rankings, trials },
 *     sponsors: [
 *       { slug, name, isIndustry, totalTrials, trialsDue, trialsReported,
 *         trialsLateOrMissing, compliancePct, year, asOfDate, sourceUrl }
 *     ],
 *     trials: [ … per-trial compact records, optional ]
 *   }
 *
 * USAGE
 *   node scripts/fdaaa-trials-fetch.mjs
 *   node scripts/fdaaa-trials-fetch.mjs --no-trials              # skip trials CSV
 *   node scripts/fdaaa-trials-fetch.mjs --out /tmp/out.json
 *   node scripts/fdaaa-trials-fetch.mjs --fixture                # use sample CSVs
 *
 * Runs monthly via .github/workflows/fdaaa-trials-monthly.yml.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/fdaaa-trials");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/fdaaa-trials");

const BASE = "https://fdaaa.trialstracker.net";
const ENDPOINTS = {
  sponsors: `${BASE}/api/sponsors/?format=csv`,
  rankings: `${BASE}/api/rankings/?format=csv`,
  trials:   `${BASE}/api/trials/?format=csv`,
};
const UA = "TruNorth-FDAAA/1.0 (+https://www.trunorthapp.com; data pipeline for pharma transparency)";
const FETCH_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 4000;

// ─── CLI ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const SKIP_TRIALS  = argv.includes("--no-trials");
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── fetch ────────────────────────────────────────────────────────────────
async function fetchText(url, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept": "text/csv,*/*" },
      redirect: "follow",
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        clearTimeout(timer);
        const wait = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`  ${res.status} for ${url} — retrying in ${wait}ms (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(wait);
        return fetchText(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const wait = RETRY_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(`  fetch error "${err.message}" for ${url} — retrying in ${wait}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(wait);
      return fetchText(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── CSV parser ───────────────────────────────────────────────────────────
/**
 * Minimal RFC 4180 CSV parser tailored to the FDAAA TrialsTracker output.
 * Handles:
 *   - quoted fields containing commas + escaped double-quotes ("")
 *   - quoted fields containing line breaks
 *   - bare fields
 * Returns an array of objects keyed by the header row.
 *
 * Exported for tests.
 */
export function parseCsv(text) {
  if (!text || typeof text !== "string") return [];
  const rows = [];
  let i = 0;
  const len = text.length;

  // Tolerate leading BOM
  if (text.charCodeAt(0) === 0xFEFF) i = 1;

  let field = "";
  let row = [];
  let inQuotes = false;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    // not in quotes
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ""; i++; continue; }
    if (ch === '\r') { i++; continue; } // skip CR; LF handles record end
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      field = ""; row = []; i++; continue;
    }
    field += ch; i++;
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0] === "") continue; // blank line
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = cells[c] ?? "";
    out.push(obj);
  }
  return out;
}

// ─── normalisers ──────────────────────────────────────────────────────────
/** "True" / "False" / "true" / "" → boolean. */
export function parseBool(v) {
  if (v === true || v === false) return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "t" || s === "1" || s === "yes";
}

/** Parse non-negative integer; null on failure. */
export function parseIntSafe(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Extract YYYY from a "YYYY-MM-DD" date string. */
export function yearOf(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

// ─── join sponsors + rankings → per-sponsor record ────────────────────────
/**
 * Given parsed `sponsors` (from /sponsors/) and `rankings` (from /rankings/),
 * return a unified array keyed by sponsor_slug. Sponsors in /sponsors/ but
 * missing from /rankings/ are skipped (no compliance signal). Sponsors in
 * /rankings/ but missing from /sponsors/ are emitted with totalTrials=null.
 *
 * Exported for tests.
 */
export function joinSponsorsAndRankings(sponsorsRows, rankingsRows) {
  const trialsBySlug = new Map();
  for (const r of sponsorsRows) {
    const slug = r.slug || r.sponsor_slug;
    if (!slug) continue;
    trialsBySlug.set(slug, parseIntSafe(r.num_trials));
  }

  const out = [];
  for (const r of rankingsRows) {
    const slug = r.sponsor_slug || r.slug;
    if (!slug) continue;
    const due       = parseIntSafe(r.due);
    const reported  = parseIntSafe(r.reported);
    const pct       = parseIntSafe(r.percentage);
    const lateOrMissing = (due != null && reported != null)
      ? Math.max(0, due - reported)
      : null;

    out.push({
      slug,
      name: r.sponsor_name || r.name || slug,
      isIndustry: parseBool(r.is_industry_sponsor),
      totalTrials: trialsBySlug.has(slug) ? trialsBySlug.get(slug) : null,
      trialsDue: due,
      trialsReported: reported,
      trialsLateOrMissing: lateOrMissing,
      compliancePct: pct,
      year: yearOf(r.date),
      asOfDate: r.date || null,
      sourceUrl: `https://fdaaa.trialstracker.net/sponsor/${slug}/`,
    });
  }
  return out;
}

// ─── trial detail summary (optional) ──────────────────────────────────────
/**
 * Trim the per-trial CSV down to a compact record. We keep only the fields
 * that explain compliance — registry id, status, days_late, has_results,
 * dates, sponsor_slug, publication url, title (truncated).
 *
 * Exported for tests.
 */
export function compactTrial(row) {
  return {
    registryId:    row.registry_id || null,
    sponsorSlug:   row.sponsor_slug || null,
    title:         (row.title || "").slice(0, 250),
    status:        row.status || null,
    startDate:     row.start_date || null,
    completionDate: row.completion_date || null,
    resultsDue:    parseBool(row.results_due),
    hasResults:    parseBool(row.has_results),
    hasExemption:  parseBool(row.has_exemption),
    daysLate:      parseIntSafe(row.days_late),
    publicationUrl: row.publication_url || null,
  };
}

// ─── load source CSVs (live or fixture) ───────────────────────────────────
async function loadCsv(name) {
  if (FIXTURE_MODE) {
    const fp = path.join(FIXTURE_DIR, `${name}.csv`);
    return await fs.readFile(fp, "utf-8");
  }
  const url = ENDPOINTS[name];
  console.log(`  GET ${url}`);
  return await fetchText(url);
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`FDAAA TrialsTracker fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);

  const sponsorsCsv = await loadCsv("sponsors");
  const sponsorsRows = parseCsv(sponsorsCsv);
  console.log(`  /sponsors/ — ${sponsorsRows.length} rows`);

  const rankingsCsv = await loadCsv("rankings");
  const rankingsRows = parseCsv(rankingsCsv);
  console.log(`  /rankings/ — ${rankingsRows.length} rows`);

  const sponsors = joinSponsorsAndRankings(sponsorsRows, rankingsRows);
  console.log(`  joined → ${sponsors.length} sponsor records`);

  let trials = [];
  if (!SKIP_TRIALS) {
    const trialsCsv = await loadCsv("trials");
    const trialsRows = parseCsv(trialsCsv);
    console.log(`  /trials/ — ${trialsRows.length} rows`);
    trials = trialsRows.map(compactTrial);
  } else {
    console.log("  /trials/ — skipped (--no-trials)");
  }

  const output = {
    _license: "Apache-2.0",
    _license_source: "https://github.com/ebmdatalab/clinicaltrials-act-tracker (LICENSE)",
    _source: BASE,
    _endpoints: ENDPOINTS,
    _generated_at: new Date().toISOString(),
    _row_counts: {
      sponsors: sponsorsRows.length,
      rankings: rankingsRows.length,
      trials:   trials.length,
    },
    sponsors,
    trials,
  };

  let outPath;
  if (OUT_OVERRIDE) {
    outPath = OUT_OVERRIDE;
  } else {
    await fs.mkdir(RAW_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    outPath = path.join(RAW_DIR, `${today}.json`);
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  const industry = sponsors.filter(s => s.isIndustry);
  console.log(`  Sponsors: ${sponsors.length} total, ${industry.length} industry (pharma/device)`);
  const withFullData = industry.filter(s => s.compliancePct != null && s.trialsDue != null);
  const noncompliant = withFullData.filter(s => s.compliancePct < 100 && s.trialsDue >= 2);
  console.log(`  Industry sponsors with >=2 trials due and <100% compliance: ${noncompliant.length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("fdaaa-trials-fetch failed:", err);
    process.exit(1);
  });
}
