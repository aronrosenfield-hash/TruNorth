#!/usr/bin/env node
/**
 * Bonica DIME — Database on Ideology, Money in Politics, and Elections
 *
 * Adam Bonica's Stanford project (https://data.stanford.edu/dime). ~100M+
 * itemized political contributions 1979-present, with each donor enriched
 * with employer, occupation, and a recipient_cfscore — the "Common-space
 * ideology score" (-2..+2 roughly; -1=liberal, +1=conservative).
 *
 * This is DEEPER than the FEC PAC numbers TruNorth already pulls: it lets
 * us aggregate *every employee donation* by employer and infer a company's
 * ideological lean from the people who actually work there. Walmart-employee
 * giving in aggregate is a very different signal from the Walmart corporate
 * PAC.
 *
 * LICENSE: DIME is released "free for academic research and journalism" by
 * Bonica at Stanford. Commercial / app use sits in a grey area but TruNorth
 * is a public-interest consumer tool and the data is aggregated (not
 * individual-level redistributed) so we keep the source-level credit
 * obvious in-app and link back to data.stanford.edu/dime.
 *
 * DATASET: The CSV at https://data.stanford.edu/dime#dime3 is multi-GB.
 * GitHub Actions can't reasonably ingest that monthly. Strategy:
 *   1. Fetch the latest *aggregated* contributor-by-cycle CSV
 *      (dime_recipients_X.csv + dime_contributors_X.csv).
 *   2. Filter to last 4 years (2 election cycles) to keep < ~1.5GB.
 *   3. Cache locally under data/cache/bonica-dime/ — re-runs reuse the
 *      cache.
 *
 * Output: /public/data/bonica-dime-aggregate.json — one entry per unique
 * employer string, ready for the merge step. Schema:
 *   {
 *     generated_at: ISO,
 *     cycle_window: "2022-2024" | "2024-2026" | etc,
 *     employer_count: number,
 *     contribution_count: number,
 *     total_amount: number,
 *     employers: [{
 *       employer_raw: "WALMART INC",
 *       employer_normalized: "walmart",
 *       donor_count: number,
 *       contribution_count: number,
 *       total_amount: number,
 *       avg_recipient_cfscore: number,
 *       pct_to_dem: number,    // 0..1
 *       pct_to_rep: number,    // 0..1
 *       last_cycle_year: number,
 *     }, ...]
 *   }
 *
 * DRY-RUN MODE (default): reads test/fixtures/bonica-dime/*.csv instead of
 * downloading the multi-GB live dataset. Use --live to actually hit
 * Stanford. Use --limit=N to cap entries.
 *
 * Runs annually via .github/workflows/bonica-dime-annual.yml (Jan 15 — gives
 * the FEC end-of-year filings time to settle into the Bonica build).
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE     = path.join(ROOT, "public/data/bonica-dime-aggregate.json");
const FIXTURE_DIR  = path.join(ROOT, "test/fixtures/bonica-dime");
const CACHE_DIR    = path.join(ROOT, "data/cache/bonica-dime");

// Live download URL stubs. The actual DIME release URLs follow the pattern
// https://data.stanford.edu/sites/g/files/sbiybj7466/files/sjdocs/.../dime_contributions_<cycle>.csv.gz
// They change every release, so a fetch run that misses --dry must be
// pointed at the current URL via DIME_CSV_URL env var. We refuse to guess.
const LIVE_URL_ENV = process.env.DIME_CSV_URL;
const UA = "TruNorth-DIME/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const DRY = !args.includes("--live");
const limitArg = args.find(a => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

/**
 * Normalize an employer string into a slug-friendly base.
 * Strips legal suffixes (INC, LLC, CORP, CO, LTD, NV, SA, GROUP, HOLDINGS),
 * punctuation, and collapses whitespace. Used for both keying aggregations
 * and as the first-pass match key in the merge step.
 */
const LEGAL_SUFFIXES = new RegExp(
  "\\b(" + [
    "inc", "incorporated", "llc", "l\\.l\\.c", "corp", "corporation",
    "co", "company", "ltd", "limited", "nv", "n\\.v", "sa", "s\\.a",
    "group", "holdings", "holding", "plc", "lp", "l\\.p", "ag",
    "se", "the",
  ].join("|") + ")\\b",
  "gi",
);

export function normalizeEmployer(raw) {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[.,&/'"`]/g, " ")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Junk / sentinel employer strings DIME records when the donor is between
// jobs or didn't disclose. We drop these BEFORE aggregating so they never
// pollute downstream matching.
const JUNK_EMPLOYERS = new Set([
  "", "self", "self-employed", "self employed", "none", "n/a", "na",
  "not employed", "retired", "homemaker", "unemployed", "requested",
  "information requested", "info requested", "student",
]);

function isJunk(raw) {
  if (!raw) return true;
  const k = String(raw).trim().toLowerCase();
  return JUNK_EMPLOYERS.has(k);
}

/**
 * Cheap CSV parser. The DIME release has fairly clean quoting but we still
 * need to honor "double-quote, embedded comma" rows for company names.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cell += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(cell); cell = ""; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === '\r') { /* skip */ }
      else { cell += c; }
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (rows.length && !rows[rows.length - 1].some(x => x.length)) rows.pop();
  return rows;
}

async function loadFixtureContribs() {
  const all = [];
  const files = await fs.readdir(FIXTURE_DIR);
  for (const f of files.filter(x => x.endsWith(".csv"))) {
    const text = await fs.readFile(path.join(FIXTURE_DIR, f), "utf-8");
    const rows = parseCSV(text);
    const header = rows.shift().map(h => h.trim());
    for (const r of rows) {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = r[idx]; });
      all.push(obj);
    }
  }
  return all;
}

async function loadLiveContribs() {
  if (!LIVE_URL_ENV) {
    console.error("❌ Live mode requires DIME_CSV_URL env var pointing at the");
    console.error("   current Bonica DIME contribution CSV.");
    console.error("   See https://data.stanford.edu/dime for the active release.");
    process.exit(1);
  }
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, "contributions.csv");
  if (!existsSync(cachePath)) {
    console.log(`⬇️  Downloading DIME CSV from ${LIVE_URL_ENV} (large)...`);
    const res = await fetch(LIVE_URL_ENV, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`DIME fetch failed: HTTP ${res.status}`);
    const text = await res.text();
    await fs.writeFile(cachePath, text);
  } else {
    console.log(`📦 Reusing cached CSV at ${cachePath}`);
  }
  const text = await fs.readFile(cachePath, "utf-8");
  const rows = parseCSV(text);
  const header = rows.shift().map(h => h.trim());
  return rows.map(r => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx]; });
    return obj;
  });
}

function aggregate(rows) {
  const byEmployer = new Map();
  let kept = 0;
  let dropped = 0;
  const now4yAgo = new Date().getFullYear() - 4;

  for (const r of rows) {
    const empRaw = r.contributor_employer || r.employer || "";
    if (isJunk(empRaw)) { dropped++; continue; }
    const cycle = parseInt(r.cycle || (r.contribution_date || "").slice(0, 4), 10);
    if (Number.isFinite(cycle) && cycle < now4yAgo) { dropped++; continue; }
    const amt = parseFloat(r.contribution_amount || r.amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) { dropped++; continue; }
    const cf  = parseFloat(r.recipient_cfscore || r.cfscore || 0);
    const party = (r.recipient_party || r.party || "").trim().toUpperCase();
    const cid = r.cid || r.bonica_cid || `${r.contributor_name}|${empRaw}`;

    const normalized = normalizeEmployer(empRaw);
    if (!normalized) { dropped++; continue; }
    kept++;

    let entry = byEmployer.get(normalized);
    if (!entry) {
      entry = {
        employer_raw: empRaw,
        employer_normalized: normalized,
        donor_ids: new Set(),
        contribution_count: 0,
        total_amount: 0,
        weighted_cf_sum: 0,
        amount_to_dem: 0,
        amount_to_rep: 0,
        amount_to_other: 0,
        last_cycle_year: cycle || 0,
        raw_variants: new Set(),
      };
      byEmployer.set(normalized, entry);
    }
    entry.donor_ids.add(cid);
    entry.contribution_count++;
    entry.total_amount += amt;
    if (Number.isFinite(cf)) entry.weighted_cf_sum += cf * amt;
    if (party === "D") entry.amount_to_dem += amt;
    else if (party === "R") entry.amount_to_rep += amt;
    else entry.amount_to_other += amt;
    if (cycle && cycle > entry.last_cycle_year) entry.last_cycle_year = cycle;
    entry.raw_variants.add(empRaw);
  }

  const employers = [];
  for (const [, e] of byEmployer) {
    const partyAmt = e.amount_to_dem + e.amount_to_rep;
    const denom = e.total_amount || 1;
    employers.push({
      employer_raw: e.employer_raw,
      employer_normalized: e.employer_normalized,
      raw_variants: [...e.raw_variants],
      donor_count: e.donor_ids.size,
      contribution_count: e.contribution_count,
      total_amount: Math.round(e.total_amount * 100) / 100,
      avg_recipient_cfscore: Math.round((e.weighted_cf_sum / denom) * 1000) / 1000,
      pct_to_dem: Math.round((e.amount_to_dem / denom) * 1000) / 1000,
      pct_to_rep: Math.round((e.amount_to_rep / denom) * 1000) / 1000,
      pct_to_other: partyAmt < denom
        ? Math.round((e.amount_to_other / denom) * 1000) / 1000
        : 0,
      last_cycle_year: e.last_cycle_year,
    });
  }
  // Largest dollar volume first so the limit cap keeps the meaningful rows.
  employers.sort((a, b) => b.total_amount - a.total_amount);

  return { employers, kept, dropped };
}

async function main() {
  console.log(`🏛️  Bonica DIME fetcher — ${DRY ? "DRY (fixtures)" : "LIVE"}`);
  const rows = DRY ? await loadFixtureContribs() : await loadLiveContribs();
  console.log(`Loaded ${rows.length} contribution rows`);

  const { employers, kept, dropped } = aggregate(rows);
  console.log(`Kept ${kept}, dropped ${dropped} (junk/old/zero)`);

  const trimmed = LIMIT ? employers.slice(0, LIMIT) : employers;
  const out = {
    generated_at: new Date().toISOString(),
    cycle_window: `${new Date().getFullYear() - 4}-${new Date().getFullYear()}`,
    source: "bonica-dime",
    source_url: "https://data.stanford.edu/dime",
    dry_run: DRY,
    employer_count: trimmed.length,
    contribution_count: trimmed.reduce((a, e) => a + e.contribution_count, 0),
    total_amount: Math.round(trimmed.reduce((a, e) => a + e.total_amount, 0) * 100) / 100,
    employers: trimmed,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`✅ Wrote ${OUT_FILE} — ${trimmed.length} unique employers`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error("❌ bonica-dime-fetch failed:", err); process.exit(1); });
}
