#!/usr/bin/env node
/**
 * USAspending.gov — Federal contracts per recipient (quarterly)
 *
 * For each of a curated set of high-exposure brand slugs, queries
 * USAspending.gov's /search/spending_by_award/ endpoint with the brand
 * name as recipient_search_text. Aggregates the last 5 years of federal
 * contract awards (>$25K — every federal contract is reported there)
 * into a single, compact per-brand record.
 *
 * Output (cache, one file per slug):
 *   /public/data/_cache/usaspending/<slug>.json
 * Output (aggregate, written by --apply):
 *   /public/data/usaspending-contracts.json
 *
 * Source:
 *   https://api.usaspending.gov/api/v2/search/spending_by_award/
 *   - Free, no auth, public.
 *   - POST body { filters, fields, page, limit, sort, order }
 *   - 100 results per page, paginate until done or 5 pages (500 awards).
 *
 * Per-brand record shape (matches the docstring of usaspending-merge.mjs):
 *   {
 *     slug,
 *     name,
 *     total_obligated_USD_last_5y,
 *     award_count_last_5y,
 *     recent_top5: [{date, agency, naics, amount, description}],
 *     primary_agency,
 *     primary_naics,
 *     status: "ok" | "no_contracts" | "error" | "orphan",
 *     last_updated,
 *     source_url,
 *   }
 *
 * Flags:
 *   --dry      (default) — DOES NOT hit the network. Reads the cache if it
 *                          exists, otherwise emits a synthetic preview from
 *                          a hand-curated profile so the merger can be tested
 *                          end-to-end without API traffic.
 *   --apply    — actually call the USAspending API (1 req/sec courtesy
 *                throttle) and OVERWRITE the per-slug cache files + the
 *                aggregate file.
 *   --slug X   — only run for slug X (debug/iteration).
 *
 * Runs via .github/workflows/usaspending-quarterly.yml on the 1st of
 * Jan/Apr/Jul/Oct at 04:00 UTC.
 *
 * Locally:
 *   node scripts/usaspending-fetch.mjs                # dry run, all targets
 *   node scripts/usaspending-fetch.mjs --apply        # real network call
 *   node scripts/usaspending-fetch.mjs --slug walmart # one brand
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const CACHE_DIR = path.join(ROOT, "public/data/_cache/usaspending");
const OUT_FILE  = path.join(ROOT, "public/data/usaspending-contracts.json");

const API_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const UA = "TruNorth-USAspending/1.0 (+https://www.trunorthapp.com)";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;          // safety cap — 500 awards per brand
const RATE_LIMIT_MS = 1000;   // courtesy 1 req/sec

const argv      = new Set(process.argv.slice(2));
const APPLY     = argv.has("--apply");
const DRY       = !APPLY;     // default is dry
const SLUG_ARG  = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ─────────────────────────── targets ────────────────────────────
// Top-50 high-exposure brands. Each entry is { slug, name } where:
//   slug — the existing TruNorth company file slug
//   name — the recipient_search_text query to USAspending
//
// USAspending's recipient_search_text does a fuzzy LIKE match on
// recipient_name AND parent_recipient_name, so e.g. "Boeing" picks
// up "The Boeing Company", "Boeing Defense, Space & Security",
// "Boeing Aerospace Operations Inc." etc. — exactly what we want.
export const TARGETS = [
  { slug: "walmart",                  name: "Walmart" },
  { slug: "boeing",                   name: "Boeing" },
  { slug: "lockheed-martin",          name: "Lockheed Martin" },
  { slug: "raytheon-technologies",    name: "Raytheon" },
  { slug: "northrop-grumman",         name: "Northrop Grumman" },
  { slug: "general-dynamics",         name: "General Dynamics" },
  { slug: "leidos",                   name: "Leidos" },
  // No company file — kept so the merger logs it as orphan (high signal).
  { slug: "booz-allen-hamilton",      name: "Booz Allen Hamilton" },
  { slug: "oracle",                   name: "Oracle" },
  { slug: "microsoft",                name: "Microsoft" },
  { slug: "amazon",                   name: "Amazon" },
  { slug: "google-alphabet",          name: "Google" },
  { slug: "apple",                    name: "Apple" },
  { slug: "ibm",                      name: "International Business Machines" },
  { slug: "hp",                       name: "Hewlett Packard" },
  { slug: "dell",                     name: "Dell" },
  { slug: "accenture",                name: "Accenture" },
  { slug: "deloitte",                 name: "Deloitte" },
  { slug: "kpmg",                     name: "KPMG" },
  { slug: "pfizer",                   name: "Pfizer" },
  { slug: "moderna",                  name: "Moderna" },
  { slug: "johnson-and-johnson",      name: "Johnson & Johnson" },
  { slug: "abbott-laboratories",      name: "Abbott Laboratories" },
  { slug: "medtronic",                name: "Medtronic" },
  { slug: "mckesson",                 name: "McKesson" },
  { slug: "cardinal-health",          name: "Cardinal Health" },
  { slug: "unitedhealth-group",       name: "UnitedHealth Group" },
  { slug: "anthem-elevance-health",   name: "Elevance Health" },
  { slug: "humana",                   name: "Humana" },
  { slug: "cvs-health",               name: "CVS Health" },
  { slug: "walgreens",                name: "Walgreens" },
  { slug: "fedex",                    name: "FedEx" },
  { slug: "ups",                      name: "United Parcel Service" },
  { slug: "caterpillar",              name: "Caterpillar" },
  { slug: "ge-aerospace",             name: "GE Aerospace" },
  { slug: "honeywell",                name: "Honeywell" },
  // No 3M company file — kept so the merger logs it as orphan.
  { slug: "3m",                       name: "3M Company" },
  { slug: "dupont",                   name: "DuPont" },
  { slug: "dow",                      name: "Dow Chemical" },
  { slug: "exxon-mobil",              name: "Exxon Mobil" },
  { slug: "chevron",                  name: "Chevron" },
  { slug: "shell-usa",                name: "Shell USA" },
  { slug: "valero-energy",            name: "Valero Energy" },
  { slug: "marathon-petroleum",       name: "Marathon Petroleum" },
  { slug: "verizon",                  name: "Verizon" },
  { slug: "atandt",                   name: "AT&T" },
  { slug: "t-mobile-us",              name: "T-Mobile" },
  { slug: "comcast",                  name: "Comcast" },
  { slug: "charter-communications",   name: "Charter Communications" },
];

// ─────────────────────────── helpers ────────────────────────────

export function fiveYearWindow(now = new Date()) {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 5);
  return { start_date: start.toISOString().slice(0, 10), end_date: end };
}

// Tops N by total $ from an array of {label, amount}.
export function topByAmount(items, n = 1) {
  const sums = {};
  for (const { label, amount } of items) {
    if (!label) continue;
    sums[label] = (sums[label] || 0) + (Number(amount) || 0);
  }
  return Object.entries(sums)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, amount]) => ({ label, amount }));
}

// Parse the API's /search/spending_by_award/ "results" array into our shape.
// The API returns objects with keys like:
//   "Award ID", "Recipient Name", "Award Amount", "Description",
//   "Awarding Agency", "Awarding Sub Agency", "Start Date", "End Date",
//   "Last Modified Date", "NAICS", "naics_code", "naics_description"
// We tolerate the slight differences in field names that surface across
// award_type_codes (contracts vs. IDVs).
export function parseAwardRow(row) {
  const amount = Number(
    row["Award Amount"] ??
    row.total_obligation ??
    row.base_and_all_options_value ??
    0
  );
  const date =
    row["Start Date"] ??
    row["Period of Performance Start Date"] ??
    row["Action Date"] ??
    row["Last Modified Date"] ??
    null;
  const agency =
    row["Awarding Agency"] ??
    row.awarding_agency_name ??
    null;
  const naics =
    row["NAICS"] ??
    row.naics_description ??
    (row.naics_code ? String(row.naics_code) : null);
  const description =
    row["Description"] ??
    row.transaction_description ??
    row.description ??
    "";
  return {
    date,
    agency,
    naics,
    amount,
    description: description ? String(description).slice(0, 240) : "",
  };
}

// Roll a list of parsed awards into our final per-brand record.
export function aggregateAwards(target, awards) {
  if (awards.length === 0) {
    return {
      slug: target.slug,
      name: target.name,
      status: "no_contracts",
      total_obligated_USD_last_5y: 0,
      award_count_last_5y: 0,
      recent_top5: [],
      primary_agency: null,
      primary_naics: null,
      last_updated: new Date().toISOString(),
      source_url: API_URL,
    };
  }
  const total = awards.reduce((s, a) => s + (a.amount || 0), 0);
  // Recent top 5 by amount (the API filter already enforces the 5y window).
  const recentTop5 = [...awards]
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 5);
  const primaryAgency = topByAmount(
    awards.map(a => ({ label: a.agency, amount: a.amount })), 1
  )[0]?.label ?? null;
  const primaryNaics = topByAmount(
    awards.map(a => ({ label: a.naics, amount: a.amount })), 1
  )[0]?.label ?? null;
  return {
    slug: target.slug,
    name: target.name,
    status: "ok",
    total_obligated_USD_last_5y: Math.round(total),
    award_count_last_5y: awards.length,
    recent_top5: recentTop5,
    primary_agency: primaryAgency,
    primary_naics: primaryNaics,
    last_updated: new Date().toISOString(),
    source_url: API_URL,
  };
}

// ────────────────────────── network ─────────────────────────────

async function fetchOnePage(target, win, page) {
  const body = {
    filters: {
      recipient_search_text: [target.name],
      // A = Contracts. B/C/D are IDVs (indefinite-delivery vehicles).
      // We want awarded contracts >$25K, all of A/B/C/D capture that.
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [win],
    },
    fields: [
      "Award ID",
      "Recipient Name",
      "Award Amount",
      "Description",
      "Awarding Agency",
      "Awarding Sub Agency",
      "Start Date",
      "End Date",
      "Last Modified Date",
      "NAICS",
    ],
    page,
    limit: PAGE_SIZE,
    sort: "Award Amount",
    order: "desc",
  };
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`USAspending ${res.status} for ${target.name} page ${page}`);
  }
  return res.json();
}

async function fetchAllAwards(target) {
  const win = fiveYearWindow();
  const all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const data = await fetchOnePage(target, win, p);
    const rows = data.results || [];
    for (const r of rows) all.push(parseAwardRow(r));
    const hasNext = !!data?.page_metadata?.hasNext;
    if (!hasNext || rows.length === 0) break;
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }
  return all;
}

// ───────────────────────── dry-run synth ────────────────────────
// Hand-tuned "obvious" defense/health/IT contractor profiles. The
// merger and downstream code path don't care that the numbers are
// synthetic — they just want to see realistic shape. Values are
// deliberately conservative (well below the recipient's actual public
// 5y totals) so a future --apply diff is obvious.
const SYNTH_PROFILES = {
  defense: {
    total: 28_400_000_000,
    award_count: 412,
    primary_agency: "Department of Defense",
    primary_naics: "Other Aircraft Parts and Auxiliary Equipment Manufacturing",
  },
  health: {
    total: 4_200_000_000,
    award_count: 87,
    primary_agency: "Department of Health and Human Services",
    primary_naics: "Pharmaceutical Preparation Manufacturing",
  },
  tech: {
    total: 9_800_000_000,
    award_count: 1_240,
    primary_agency: "Department of Defense",
    primary_naics: "Custom Computer Programming Services",
  },
  energy: {
    total: 1_300_000_000,
    award_count: 56,
    primary_agency: "Department of Defense",
    primary_naics: "Petroleum Refineries",
  },
  consulting: {
    total: 6_700_000_000,
    award_count: 980,
    primary_agency: "Department of Defense",
    primary_naics: "Administrative Management and General Management Consulting Services",
  },
  retail: {
    total: 410_000_000,
    award_count: 1_120,
    primary_agency: "Department of Veterans Affairs",
    primary_naics: "Supermarkets and Other Grocery Retailers",
  },
  telco: {
    total: 980_000_000,
    award_count: 220,
    primary_agency: "General Services Administration",
    primary_naics: "Wired Telecommunications Carriers",
  },
  none: { total: 0, award_count: 0, primary_agency: null, primary_naics: null },
};

const SYNTH_TAG = {
  "walmart": "retail",
  "boeing": "defense",
  "lockheed-martin": "defense",
  "raytheon-technologies": "defense",
  "northrop-grumman": "defense",
  "general-dynamics": "defense",
  "leidos": "consulting",
  "booz-allen-hamilton": "consulting",
  "oracle": "tech",
  "microsoft": "tech",
  "amazon": "tech",
  "google-alphabet": "tech",
  "apple": "tech",
  "ibm": "consulting",
  "hp": "tech",
  "dell": "tech",
  "accenture": "consulting",
  "deloitte": "consulting",
  "kpmg": "consulting",
  "pfizer": "health",
  "moderna": "health",
  "johnson-and-johnson": "health",
  "abbott-laboratories": "health",
  "medtronic": "health",
  "mckesson": "health",
  "cardinal-health": "health",
  "unitedhealth-group": "health",
  "anthem-elevance-health": "health",
  "humana": "health",
  "cvs-health": "health",
  "walgreens": "retail",
  "fedex": "consulting",
  "ups": "consulting",
  "caterpillar": "defense",
  "ge-aerospace": "defense",
  "honeywell": "defense",
  "3m": "defense",
  "dupont": "energy",
  "dow": "energy",
  "exxon-mobil": "energy",
  "chevron": "energy",
  "shell-usa": "energy",
  "valero-energy": "energy",
  "marathon-petroleum": "energy",
  "verizon": "telco",
  "atandt": "telco",
  "t-mobile-us": "telco",
  "comcast": "telco",
  "charter-communications": "telco",
};

function synthRecord(target) {
  const profile = SYNTH_PROFILES[SYNTH_TAG[target.slug] ?? "none"];
  if (profile.total === 0) {
    return {
      ...aggregateAwards(target, []),
      _synthetic: true,
    };
  }
  // Build 5 plausible recent_top5 entries deterministically.
  const top = [];
  const now = new Date();
  for (let i = 0; i < 5; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i * 6);
    top.push({
      date: d.toISOString().slice(0, 10),
      agency: profile.primary_agency,
      naics: profile.primary_naics,
      amount: Math.round(profile.total / profile.award_count * (5 - i)),
      description: `[SYNTHETIC --dry] Top-${i + 1} ${target.name} award (use --apply for real data)`,
    });
  }
  return {
    slug: target.slug,
    name: target.name,
    status: "ok",
    total_obligated_USD_last_5y: profile.total,
    award_count_last_5y: profile.award_count,
    recent_top5: top,
    primary_agency: profile.primary_agency,
    primary_naics: profile.primary_naics,
    last_updated: new Date().toISOString(),
    source_url: API_URL,
    _synthetic: true,
  };
}

// ─────────────────────────── runner ─────────────────────────────

function fmtUSD(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

async function processOne(target) {
  // Orphan check: target slug must correspond to a real company file.
  // We still process — the merger is the one that decides what to do
  // with orphans — but we tag the record so logs are honest.
  const compFile = path.join(COMP_DIR, `${target.slug}.json`);
  const orphan = !existsSync(compFile);

  if (DRY) {
    // Prefer cached real data if it's there; otherwise synth.
    const cachePath = path.join(CACHE_DIR, `${target.slug}.json`);
    if (existsSync(cachePath)) {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf-8"));
      return { ...cached, _orphan: orphan, _source: "cache" };
    }
    return { ...synthRecord(target), _orphan: orphan, _source: "synth" };
  }

  // --apply: real network call
  try {
    const awards = await fetchAllAwards(target);
    const record = aggregateAwards(target, awards);
    record._orphan = orphan;
    return record;
  } catch (err) {
    return {
      slug: target.slug,
      name: target.name,
      status: "error",
      error: err.message,
      last_updated: new Date().toISOString(),
      source_url: API_URL,
      _orphan: orphan,
    };
  }
}

async function main() {
  console.log(`USAspending fetcher starting... (mode=${DRY ? "DRY (no network)" : "APPLY (real API)"})`);

  await fs.mkdir(CACHE_DIR, { recursive: true });

  // R7 #2 (2026-06-11): --public-cos extends the curated TARGETS to every
  // public company in the catalog (ticker/cik/isPublic) — primarily the
  // 1,583 EDGAR-expansion mid-caps. Resumable: slugs with a cache file
  // newer than 90 days are skipped, so quarterly runs only do new work.
  let targets = SLUG_ARG
    ? TARGETS.filter(t => t.slug === SLUG_ARG)
    : TARGETS;
  if (process.argv.includes("--public-cos")) {
    const compsDir = path.join(ROOT, "public/data/companies");
    const have = new Set(TARGETS.map(t => t.slug));
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    const extra = [];
    for (const f of (await fs.readdir(compsDir))) {
      if (!f.endsWith(".json")) continue;
      const slug = f.replace(/\.json$/, "");
      if (have.has(slug)) continue;
      try {
        const d = JSON.parse(await fs.readFile(path.join(compsDir, f), "utf8"));
        if (!(d.ticker || d.cik || d.isPublic === true)) continue;
        try {
          const st = await fs.stat(path.join(CACHE_DIR, `${slug}.json`));
          if (st.mtimeMs > cutoff) continue;
        } catch {}
        extra.push({ slug, name: d.legalName || d.name });
      } catch {}
    }
    const cap = Number((process.argv.find(a => a.startsWith("--max=")) || "").split("=")[1]) || extra.length;
    targets = targets.concat(extra.slice(0, cap));
    console.log(`[usaspending] --public-cos added ${Math.min(cap, extra.length)} dynamic targets (of ${extra.length} uncached public cos)`);
  }
  if (targets.length === 0) {
    console.error(`No target matching slug "${SLUG_ARG}"`);
    process.exit(2);
  }

  const records = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const rec = await processOne(t);
    records.push(rec);
    const tag = rec._orphan ? " [ORPHAN]" : "";
    const src = rec._source ? ` [${rec._source}]` : "";
    const $$ = rec.total_obligated_USD_last_5y
      ? fmtUSD(rec.total_obligated_USD_last_5y).padStart(10)
      : "        $0";
    console.log(`  ${(i + 1).toString().padStart(2)}/${targets.length} ${$$}  ${rec.status.padEnd(13)} ${t.slug}${tag}${src}`);

    if (APPLY) {
      // Write per-brand cache file every time so a mid-run failure is recoverable.
      const cachePath = path.join(CACHE_DIR, `${t.slug}.json`);
      await fs.writeFile(cachePath, JSON.stringify(rec, null, 2));
      // Courtesy throttle between brands.
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  // Write the aggregate. In dry mode this is informational only; in apply
  // mode this is the file the merger reads.
  const aggregate = {
    generated_at: new Date().toISOString(),
    mode: DRY ? "dry" : "apply",
    target_count: targets.length,
    ok_count: records.filter(r => r.status === "ok").length,
    no_contracts_count: records.filter(r => r.status === "no_contracts").length,
    error_count: records.filter(r => r.status === "error").length,
    orphan_count: records.filter(r => r._orphan).length,
    source_url: API_URL,
    contracts: records,
  };

  // We always write the aggregate file. In --dry mode it's the synthetic
  // preview the merger consumes (also --dry); in --apply mode it's the
  // real quarterly snapshot. Per-company JSON files are ONLY touched by
  // the merger when ITS --apply flag is set.
  await fs.writeFile(OUT_FILE, JSON.stringify(aggregate, null, 2));
  console.log(`\nWrote ${OUT_FILE}`);
  if (DRY) {
    console.log(`(DRY — synthetic preview, no API traffic, no per-company writes. Use --apply to fetch real data.)`);
    console.log(`Summary: ok=${aggregate.ok_count} no_contracts=${aggregate.no_contracts_count} orphan=${aggregate.orphan_count}`);
  }
}

// Allow imports from tests without running main.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("usaspending-fetch failed:", err);
    process.exit(1);
  });
}
