#!/usr/bin/env node
/**
 * Stanford DIME v4.0 — slug-keyed augment for the unified writer pipeline
 *
 * Adam Bonica's Database on Ideology, Money in Politics, and Elections
 * (Stanford). v4.0 covers ~850M itemized contributions 1979-2024, ~36M
 * donors, with CFscores (Common-space ideology, roughly -2..+2) for
 * recipients.
 *
 * Why a NEW script instead of touching `bonica-dime-fetch.mjs`?
 *
 *   That older pipeline writes directly into
 *   `public/data/companies/<slug>.json` under `co.enriched.political.dime`,
 *   which is a structured block but does NOT feed
 *   `apply-augments-to-companies.mjs` and therefore never reaches the
 *   user-visible `political.s` narrative. This script produces a
 *   slug-keyed augment under `data/derived/dime-augment.json` that the
 *   unified writer DOES read, so DIME signal finally surfaces in the
 *   politics card. The two pipelines coexist (one for structured detail,
 *   one for narrative).
 *
 * ─── Pre-filtering rationale (CRITICAL — DIME v4.0 raw is multi-GB) ───
 *
 *   1. Cycle window: last 4 years (2 election cycles). Donor histories
 *      older than that aren't load-bearing for present-day brand signal.
 *   2. Junk strings (self/retired/none/etc.) dropped BEFORE aggregation.
 *   3. Amounts ≤ 0 dropped.
 *   4. Aggregate per normalized employer → resolve to TruNorth slug via
 *      slug-aliases + brand-parent-map (no fuzzy here — DIME's
 *      bonica-dime-merge.mjs already keeps a fuzzy review queue; for the
 *      narrative augment we stay conservative).
 *   5. Sort by total $ desc, keep TOP 1000 slugs (hard cap from brief).
 *
 *   These steps collapse a multi-GB CSV down to a ~1MB JSON.
 *
 * ─── Output shape ────────────────────────────────────────────────────
 *
 *   data/derived/dime-augment.json:
 *     {
 *       _license: "Stanford DIME v4.0 — free for research/journalism use",
 *       _source: "Bonica, Adam. 2024. Database on Ideology, Money in
 *                 Politics, and Elections: Public version 4.0",
 *       _source_url: "https://data.stanford.edu/dime",
 *       _generated_at: ISO,
 *       _cycle_window: "2022-2026" | ...,
 *       _dry_run: bool,
 *       _stats: { rows, kept, dropped, employers, matched, capped_to },
 *       companies: {
 *         "<slug>": {
 *           political: {
 *             totalUsd:           number,    // last 4y
 *             donorCount:         number,
 *             contributionCount:  number,
 *             pctToDem:           number,    // 0..1
 *             pctToRep:           number,    // 0..1
 *             pctToOther:         number,    // 0..1
 *             avgCfscore:         number,    // amount-weighted, -1..+1
 *             lastCycleYear:      number,
 *             employersMatched:   string[],
 *             sources: [source_url],
 *           }
 *         }
 *       }
 *     }
 *
 * ─── Modes ───────────────────────────────────────────────────────────
 *
 *   --dry            (default) read test/fixtures/bonica-dime/*.csv
 *   --apply / --live download from DIME_CSV_URL (env var) and cache
 *   --url <URL>      one-off override of the source URL (test or PR)
 *   --limit N        cap final per-slug rows (after sort)
 *   --out <path>     override output path (default data/derived/dime-augment.json)
 *
 * Cron: quarterly via .github/workflows/dime-augment-quarterly.yml. The
 * heavyweight DIME annual snapshot is still on Jan-15, but the augment
 * refreshes 4x/year so brand narratives don't get stale between
 * Stanford releases.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_OUT  = path.join(ROOT, "data/derived/dime-augment.json");
const FIXTURE_DIR  = path.join(ROOT, "test/fixtures/bonica-dime");
const CACHE_DIR    = path.join(ROOT, "data/cache/dime-augment");
const COMP_DIR     = path.join(ROOT, "public/data/companies");
const META_DIR     = path.join(ROOT, "public/data/_meta");

const SOURCE_URL = "https://data.stanford.edu/dime";
const UA = "TruNorth-DIME-Augment/1.0 (+https://www.trunorthapp.com)";

// Cap from brief — at most 1000 slugs per refresh keeps the augment under
// the ~30MB project cap and avoids burying significant brands behind
// long-tail employers with $100 contributions.
const HARD_CAP = 1000;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply") || argv.includes("--live");
const DRY = !APPLY;
const URL_ARG = (() => {
  const i = argv.indexOf("--url");
  return i >= 0 ? argv[i + 1] : null;
})();
const LIMIT_ARG = (() => {
  const i = argv.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(argv[i + 1]) || 0) || null : null;
})();
const OUT_FILE = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 ? path.resolve(argv[i + 1]) : DEFAULT_OUT;
})();

// ─────────────────────── normalization helpers ──────────────────────

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

const JUNK_EMPLOYERS = new Set([
  "", "self", "self-employed", "self employed", "none", "n/a", "na",
  "not employed", "retired", "homemaker", "unemployed", "requested",
  "information requested", "info requested", "student",
]);

export function isJunk(raw) {
  if (!raw) return true;
  const k = String(raw).trim().toLowerCase();
  return JUNK_EMPLOYERS.has(k);
}

// ─────────────────────── CSV parsing ────────────────────────────────

export function parseCSV(text) {
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

async function loadLiveContribs(url) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, "contributions.csv");
  if (!existsSync(cachePath)) {
    console.log(`Downloading DIME CSV from ${url} (large)...`);
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`DIME fetch failed: HTTP ${res.status}`);
    const text = await res.text();
    await fs.writeFile(cachePath, text);
  } else {
    console.log(`Reusing cached CSV at ${cachePath}`);
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

// ─────────────────────── aggregation ────────────────────────────────

export function aggregateByEmployer(rows, { cutoffYear } = {}) {
  const byEmployer = new Map();
  let kept = 0;
  let dropped = 0;
  const minYear = cutoffYear ?? (new Date().getFullYear() - 4);

  for (const r of rows) {
    const empRaw = r.contributor_employer || r.employer || "";
    if (isJunk(empRaw)) { dropped++; continue; }
    const cycle = parseInt(r.cycle || (r.contribution_date || "").slice(0, 4), 10);
    if (Number.isFinite(cycle) && cycle < minYear) { dropped++; continue; }
    const amt = parseFloat(r.contribution_amount || r.amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) { dropped++; continue; }
    const cf = parseFloat(r.recipient_cfscore || r.cfscore || 0);
    const party = (r.recipient_party || r.party || "").trim().toUpperCase();
    const cid = r.cid || r.bonica_cid || `${r.contributor_name || ""}|${empRaw}`;

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
      };
      byEmployer.set(normalized, entry);
    }
    entry.donor_ids.add(cid);
    entry.contribution_count++;
    entry.total_amount += amt;
    if (Number.isFinite(cf)) entry.weighted_cf_sum += cf * amt;
    if (party === "D" || party === "DEM" || party === "DFL") entry.amount_to_dem += amt;
    else if (party === "R" || party === "REP" || party === "GOP") entry.amount_to_rep += amt;
    else entry.amount_to_other += amt;
    if (cycle && cycle > entry.last_cycle_year) entry.last_cycle_year = cycle;
  }

  return { byEmployer, kept, dropped };
}

// ─────────────────────── slug resolution ────────────────────────────

export function resolveSlug(normalized, { slugSet, aliases, parents, dimeAliases }) {
  if (!normalized) return null;
  const candidates = [normalized, normalized.replace(/-/g, "")];
  for (const c of candidates) {
    if (!c) continue;
    if (slugSet.has(c)) return { slug: c, method: "direct" };
    const dimeAlias = dimeAliases?.[c];
    if (dimeAlias && slugSet.has(dimeAlias)) return { slug: dimeAlias, method: "alias" };
    const alias = aliases?.[c];
    if (alias && slugSet.has(alias)) return { slug: alias, method: "alias" };
    const parent = parents?.[c]?.parent;
    if (parent && slugSet.has(parent)) return { slug: parent, method: "parent" };
  }
  return null;
}

async function loadMaps() {
  const tryLoad = async (full) => {
    try { return JSON.parse(await fs.readFile(full, "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases:     await tryLoad(path.join(META_DIR, "slug-aliases.json")),
    parents:     await tryLoad(path.join(META_DIR, "brand-parent-map.json")),
    dimeAliases: await tryLoad(path.join(__dirname, "bonica-dime-employer-aliases.json")),
  };
}

async function loadCompanySlugs() {
  const files = await fs.readdir(COMP_DIR);
  return new Set(files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)));
}

// ─────────────────────── per-slug coalescing ────────────────────────

export function coalesceBySlug(byEmployer, maps, slugSet) {
  const bySlug = new Map();
  let matched = 0;
  let unmatched = 0;
  for (const entry of byEmployer.values()) {
    const m = resolveSlug(entry.employer_normalized, {
      slugSet, aliases: maps.aliases, parents: maps.parents, dimeAliases: maps.dimeAliases,
    });
    if (!m) { unmatched++; continue; }
    matched++;
    let agg = bySlug.get(m.slug);
    if (!agg) {
      agg = {
        slug: m.slug,
        total_amount: 0,
        donor_count: 0,
        contribution_count: 0,
        weighted_cf_sum: 0,
        amount_to_dem: 0,
        amount_to_rep: 0,
        amount_to_other: 0,
        last_cycle_year: 0,
        employers_matched: new Set(),
        methods: new Set(),
      };
      bySlug.set(m.slug, agg);
    }
    agg.total_amount        += entry.total_amount;
    agg.donor_count         += entry.donor_ids.size;
    agg.contribution_count  += entry.contribution_count;
    agg.weighted_cf_sum     += entry.weighted_cf_sum;
    agg.amount_to_dem       += entry.amount_to_dem;
    agg.amount_to_rep       += entry.amount_to_rep;
    agg.amount_to_other     += entry.amount_to_other;
    agg.last_cycle_year      = Math.max(agg.last_cycle_year, entry.last_cycle_year);
    agg.employers_matched.add(entry.employer_raw);
    agg.methods.add(m.method);
  }
  return { bySlug, matched, unmatched };
}

export function buildAugmentBlock(agg) {
  const denom = agg.total_amount || 1;
  return {
    totalUsd: Math.round(agg.total_amount * 100) / 100,
    donorCount: agg.donor_count,
    contributionCount: agg.contribution_count,
    pctToDem: Math.round((agg.amount_to_dem / denom) * 1000) / 1000,
    pctToRep: Math.round((agg.amount_to_rep / denom) * 1000) / 1000,
    pctToOther: Math.round((agg.amount_to_other / denom) * 1000) / 1000,
    avgCfscore: Math.round((agg.weighted_cf_sum / denom) * 1000) / 1000,
    lastCycleYear: agg.last_cycle_year,
    employersMatched: [...agg.employers_matched],
    sources: [SOURCE_URL],
  };
}

// ─────────────────────── runner ─────────────────────────────────────

async function main() {
  console.log(`DIME augment fetcher — ${DRY ? "DRY (fixtures)" : "LIVE"}`);

  let rows;
  if (DRY) {
    rows = await loadFixtureContribs();
  } else {
    const url = URL_ARG || process.env.DIME_CSV_URL;
    if (!url) {
      console.error("--apply requires DIME_CSV_URL env var or --url <URL>");
      console.error("See https://data.stanford.edu/dime for current release URLs.");
      process.exit(1);
    }
    rows = await loadLiveContribs(url);
  }
  console.log(`Loaded ${rows.length} contribution rows`);

  const { byEmployer, kept, dropped } = aggregateByEmployer(rows);
  console.log(`Per-employer: kept ${kept} contribs, dropped ${dropped} (junk/old/zero)`);
  console.log(`Unique employers: ${byEmployer.size}`);

  const maps = await loadMaps();
  const slugSet = await loadCompanySlugs();
  const { bySlug, matched, unmatched } = coalesceBySlug(byEmployer, maps, slugSet);
  console.log(`Slug resolution: ${matched} matched, ${unmatched} unmatched (dropped)`);

  // Sort by total $ desc, hard-cap at top 1000.
  const ordered = [...bySlug.values()].sort((a, b) => b.total_amount - a.total_amount);
  const limit = LIMIT_ARG || HARD_CAP;
  const capped = ordered.slice(0, limit);

  const companies = {};
  for (const agg of capped) {
    companies[agg.slug] = { political: buildAugmentBlock(agg) };
  }

  const now = new Date().toISOString();
  const cycleWindow = `${new Date().getFullYear() - 4}-${new Date().getFullYear()}`;
  const out = {
    _license: "Stanford DIME v4.0 — free for academic research and journalism (Bonica)",
    _source: "Bonica, Adam. 2024. Database on Ideology, Money in Politics, and Elections: Public version 4.0",
    _source_url: SOURCE_URL,
    _generated_at: now,
    _cycle_window: cycleWindow,
    _dry_run: DRY,
    _stats: {
      rows: rows.length,
      kept,
      dropped,
      employers: byEmployer.size,
      matched,
      unmatched,
      capped_to: capped.length,
    },
    companies,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_FILE} — ${capped.length} slugs (cap ${limit})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("dime-augment-fetch failed:", err);
    process.exit(1);
  });
}
