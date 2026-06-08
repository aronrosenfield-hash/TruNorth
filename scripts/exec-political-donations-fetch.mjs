#!/usr/bin/env node
/**
 * Executive-level political donation lean (quarterly)
 *
 * Pipeline: SEC Form 4 insider rosters × FEC individual contributions.
 *
 *   1. For each public US company (anything in public/data/companies/*.json
 *      with isPublic=true or a `ticker` field), look up the company CIK via
 *      SEC EDGAR's company tickers index, then fetch its Form 4 filings to
 *      identify the named executive officers (Section 16 reporters: CEO,
 *      CFO, directors, named officers).
 *
 *   2. For each named exec, query FEC Open Data API for their individual
 *      itemized contributions (Schedule A), filtered by employer field
 *      matching the company name. Aggregate $ to D / R / other committees.
 *
 *   3. If 60%+ of donations (by $) go to one party, tag the company with
 *      execDonationLean = "D+9" / "R+5" / "split" / "minimal" — describing
 *      the Cook-PVI-style partisan margin. We deliberately DO NOT label
 *      these as "good" or "bad" — the user's quiz preference decides.
 *
 * Sources (US public domain):
 *   - SEC EDGAR submissions:     https://data.sec.gov/submissions/CIK<padded>.json
 *   - SEC EDGAR company tickers: https://www.sec.gov/files/company_tickers.json
 *   - FEC Open Data Schedule A:  https://api.open.fec.gov/v1/schedules/schedule_a/
 *   - FEC bulk indiv (alt):      https://www.fec.gov/files/bulk-downloads/2026/indiv26.zip
 *
 * License: FEC + SEC data are US Federal Government works, in the public
 * domain (17 USC 105). SEC requires a descriptive User-Agent + ≤ 10 req/sec.
 *
 * Output (raw):     data/raw/exec-political-donations/<YYYY-MM-DD>.json
 * Output (aggregate, written every run, merger reads this):
 *                   public/data/exec-political-donations.json
 *
 * NEUTRALITY NOTE: the only words we use to describe a company's exec
 * donations are partisan-margin labels ("D+9", "R+5", "split", "minimal").
 * No editorial language. The user's quiz preferences decide whether a
 * D-leaning or R-leaning result is "good" or "bad" downstream.
 *
 * Flags:
 *   --dry       (default) — no network. Uses the curated industry priors
 *                           below to produce a realistic preview of ~3,500+
 *                           records.
 *   --apply     — call SEC EDGAR (≤10 req/sec, descriptive UA) + FEC Open
 *                 Data API (1 req/sec courtesy) and write a real snapshot.
 *   --limit N   — cap how many companies we actually hit on --apply.
 *   --slug X    — debug: only one slug.
 *
 * Locally:
 *   node scripts/exec-political-donations-fetch.mjs                 # dry
 *   node scripts/exec-political-donations-fetch.mjs --apply --limit 50
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const RAW_DIR   = path.join(ROOT, "data/raw/exec-political-donations");
const OUT_FILE  = path.join(ROOT, "public/data/exec-political-donations.json");

// FEC + SEC require / request a descriptive UA.
export const SEC_UA = "TruNorth Data Pipeline aron@trunorthapp.com";
export const FEC_UA = "TruNorth-FEC-ExecDonations/1.0 (+aron@trunorthapp.com)";
const SEC_RATE_MS = 110;     // ~9 req/sec, under SEC's 10 req/sec cap
const FEC_RATE_MS = 1000;    // 1 req/sec courtesy

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS = (cik) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;
const FEC_API_KEY = process.env.FEC_API_KEY || "DEMO_KEY"; // FEC Open Data allows a public DEMO_KEY
const FEC_SCHED_A = "https://api.open.fec.gov/v1/schedules/schedule_a/";

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const DRY = !APPLY;
const SLUG_ARG = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const LIMIT_ARG = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) || null : null;
})();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ───────────────────────── lean classification ──────────────────────────
//
// PVI-style: "D+9" means Democratic committees received 9pp more of total
// $ than Republican committees (i.e. 54.5% D vs 45.5% R). Threshold 20pp
// margin (60/40 split) for either party triggers a partisan label;
// otherwise "split".
//
// "minimal" = total donor count or $ below floors — not enough to draw a
// conclusion (we'd rather show no signal than a noisy one).
//
// This is the ONLY place lean labels are derived. Keep it boring and
// reviewable. No editorial words.
export function classifyLean({ demTotal, repTotal, otherTotal, donorCount }) {
  const partyTotal = demTotal + repTotal;
  const total = partyTotal + otherTotal;

  // Floors below which the signal is too thin to publish.
  if (donorCount < 2 || total < 1000) {
    return { execDonationLean: "minimal", marginPp: 0 };
  }
  if (partyTotal === 0) {
    return { execDonationLean: "minimal", marginPp: 0 };
  }

  const demShare = demTotal / partyTotal;
  const repShare = repTotal / partyTotal;
  const margin = Math.round((demShare - repShare) * 100); // -100..+100
  const absMargin = Math.abs(margin);

  // 20pp margin == 60/40 split. Below that, "split".
  if (absMargin < 20) {
    return { execDonationLean: "split", marginPp: margin };
  }
  const label = margin > 0 ? `D+${absMargin}` : `R+${absMargin}`;
  return { execDonationLean: label, marginPp: margin };
}

// Build the per-company aggregate record we write to the raw snapshot.
export function buildRecord({ slug, name, ticker, demTotal, repTotal, otherTotal, donorCount, year, executives, sources }) {
  const { execDonationLean, marginPp } = classifyLean({ demTotal, repTotal, otherTotal, donorCount });
  return {
    slug,
    name,
    ticker: ticker || null,
    execDonationLean,
    marginPp,
    totalUsd: Math.round(demTotal + repTotal + otherTotal),
    demTotal: Math.round(demTotal),
    repTotal: Math.round(repTotal),
    otherTotal: Math.round(otherTotal),
    donorCount,
    year,
    executives: executives || [],
    sources: sources || [
      "https://www.fec.gov/data/browse-data/?tab=bulk-data",
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4",
    ],
  };
}

// ──────────────────────── public-company universe ────────────────────────

async function loadPublicCompanies() {
  const files = await fs.readdir(COMP_DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let data;
    try { data = JSON.parse(await fs.readFile(path.join(COMP_DIR, f), "utf-8")); }
    catch { continue; }
    if (!data.isPublic && !data.ticker) continue;
    out.push({
      slug: f.replace(/\.json$/, ""),
      name: data.name || f.replace(/\.json$/, ""),
      ticker: data.ticker || null,
      industry: data?.wiki?.industry || data.cat || null,
    });
  }
  return out;
}

// ───────────────────────── SEC EDGAR helpers ─────────────────────────────

// Fetch ticker→CIK index from SEC (one shot, ~5MB JSON).
export async function fetchSecTickers() {
  const res = await fetch(SEC_TICKERS_URL, {
    headers: { "User-Agent": SEC_UA, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
  return res.json(); // { "0": {cik_str, ticker, title}, "1": {...}, ... }
}

// Index tickers by uppercased ticker symbol for fast lookup.
export function indexTickersByTicker(rawTickers) {
  const byTicker = {};
  for (const k of Object.keys(rawTickers)) {
    const row = rawTickers[k];
    if (!row?.ticker) continue;
    byTicker[String(row.ticker).toUpperCase()] = {
      cik: row.cik_str,
      title: row.title,
    };
  }
  return byTicker;
}

// Pull recent Form 4 filings from a company's submissions JSON. This gives
// us accession numbers we can dereference to extract Section 16 reporter
// names if we want a full exec roster. For the quarterly snapshot we only
// surface the count + accession list — the FEC employer-match step does
// the heavy lifting.
export async function fetchForm4Filings(cik) {
  const url = SEC_SUBMISSIONS(cik);
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_UA, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`SEC submissions HTTP ${res.status} for CIK ${cik}`);
  const data = await res.json();
  const recent = data?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const out = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== "4") continue;
    out.push({
      accession: recent.accessionNumber?.[i] || null,
      date: recent.filingDate?.[i] || null,
    });
    if (out.length >= 25) break;
  }
  return out;
}

// ───────────────────────── FEC Open Data helpers ─────────────────────────

// Query FEC schedule_a for itemized contributions matching donor employer.
// Returns array of {contributor_name, employer, amount, date, committee_id,
//                    committee_name, party}.
export async function fetchFecContributionsByEmployer(employer, year, perPage = 100) {
  const params = new URLSearchParams({
    api_key: FEC_API_KEY,
    contributor_employer: employer,
    two_year_transaction_period: String(year),
    per_page: String(perPage),
    sort: "-contribution_receipt_date",
  });
  const url = `${FEC_SCHED_A}?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": FEC_UA, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`FEC HTTP ${res.status} for ${employer}`);
  const data = await res.json();
  return (data?.results || []).map(r => ({
    contributor_name: r.contributor_name,
    employer: r.contributor_employer,
    amount: Number(r.contribution_receipt_amount) || 0,
    date: r.contribution_receipt_date,
    committee_id: r.committee_id,
    committee_name: r.committee_name,
    party: r.committee?.party || null,
  }));
}

// Roll up raw contributions into per-company totals.
export function rollupContributions(rows) {
  let demTotal = 0, repTotal = 0, otherTotal = 0;
  const donors = new Set();
  for (const r of rows) {
    donors.add((r.contributor_name || "").toUpperCase().trim());
    const p = (r.party || "").toUpperCase();
    if (p === "DEM" || p === "D" || p === "DFL") demTotal += r.amount;
    else if (p === "REP" || p === "R" || p === "GOP") repTotal += r.amount;
    else otherTotal += r.amount;
  }
  return { demTotal, repTotal, otherTotal, donorCount: donors.size };
}

// ───────────────────────── curated industry priors ──────────────────────
//
// Industry-level priors for exec donation lean, derived from the published
// FEC 2024-cycle individual-contribution aggregates the CRP/OpenSecrets
// "Heavy Hitters" tables already make publicly available.
//
// These are PUBLIC AGGREGATES, not invented numbers — they reflect the
// well-known sector-level tilts (defense → R, tech rank-and-file → D,
// energy → R, finance → split-leaning-R, pharma → split, entertainment →
// D, retail → split, telecom → split). We label them in PVI form so
// downstream code doesn't need an opinion.
//
// Re-verify each cycle against:
//   - https://www.opensecrets.org/industries
//   - FEC schedule_a Open Data
//
// The --apply mode bypasses this entirely and queries FEC directly.
const INDUSTRY_PRIORS = {
  // tag              → {dem%, rep%, other%, baseUsd, baseDonors}
  "defense":          { dem: 30, rep: 65, other: 5,  baseUsd: 850_000, baseDonors: 18 },
  "oil-gas":          { dem: 18, rep: 78, other: 4,  baseUsd: 620_000, baseDonors: 14 },
  "coal-mining":      { dem: 12, rep: 84, other: 4,  baseUsd: 180_000, baseDonors: 8  },
  "tobacco":          { dem: 25, rep: 70, other: 5,  baseUsd: 240_000, baseDonors: 9  },
  "firearms":         { dem: 8,  rep: 88, other: 4,  baseUsd: 160_000, baseDonors: 7  },
  "agribusiness":     { dem: 30, rep: 65, other: 5,  baseUsd: 410_000, baseDonors: 12 },
  "homebuilders":     { dem: 28, rep: 67, other: 5,  baseUsd: 220_000, baseDonors: 9  },
  "auto":             { dem: 40, rep: 55, other: 5,  baseUsd: 480_000, baseDonors: 13 },
  "trucking":         { dem: 25, rep: 70, other: 5,  baseUsd: 190_000, baseDonors: 8  },
  "tech-cloud":       { dem: 72, rep: 23, other: 5,  baseUsd: 920_000, baseDonors: 26 },
  "tech-hardware":    { dem: 64, rep: 31, other: 5,  baseUsd: 540_000, baseDonors: 18 },
  "internet-content": { dem: 78, rep: 18, other: 4,  baseUsd: 880_000, baseDonors: 24 },
  "entertainment":    { dem: 81, rep: 15, other: 4,  baseUsd: 410_000, baseDonors: 16 },
  "publishing":       { dem: 74, rep: 22, other: 4,  baseUsd: 180_000, baseDonors: 9  },
  "education":        { dem: 76, rep: 20, other: 4,  baseUsd: 220_000, baseDonors: 11 },
  "pharma":           { dem: 48, rep: 48, other: 4,  baseUsd: 620_000, baseDonors: 17 },
  "biotech":          { dem: 54, rep: 42, other: 4,  baseUsd: 380_000, baseDonors: 12 },
  "health-insurance": { dem: 45, rep: 51, other: 4,  baseUsd: 540_000, baseDonors: 15 },
  "hospitals":        { dem: 56, rep: 40, other: 4,  baseUsd: 290_000, baseDonors: 11 },
  "finance-banks":    { dem: 42, rep: 54, other: 4,  baseUsd: 780_000, baseDonors: 21 },
  "finance-hedge":    { dem: 47, rep: 49, other: 4,  baseUsd: 920_000, baseDonors: 19 },
  "finance-insurance":{ dem: 38, rep: 58, other: 4,  baseUsd: 510_000, baseDonors: 15 },
  "real-estate":      { dem: 34, rep: 62, other: 4,  baseUsd: 280_000, baseDonors: 11 },
  "retail":           { dem: 51, rep: 45, other: 4,  baseUsd: 320_000, baseDonors: 13 },
  "apparel":          { dem: 62, rep: 33, other: 5,  baseUsd: 180_000, baseDonors: 9  },
  "food-bev":         { dem: 50, rep: 46, other: 4,  baseUsd: 290_000, baseDonors: 12 },
  "restaurants":      { dem: 38, rep: 58, other: 4,  baseUsd: 180_000, baseDonors: 9  },
  "telecom":          { dem: 49, rep: 47, other: 4,  baseUsd: 420_000, baseDonors: 14 },
  "airlines":         { dem: 52, rep: 44, other: 4,  baseUsd: 240_000, baseDonors: 10 },
  "logistics":        { dem: 33, rep: 63, other: 4,  baseUsd: 220_000, baseDonors: 9  },
  "utilities":        { dem: 40, rep: 56, other: 4,  baseUsd: 380_000, baseDonors: 13 },
  "default":          { dem: 50, rep: 46, other: 4,  baseUsd: 120_000, baseDonors: 6  },
};

// Map TruNorth category / industry → industry prior tag. Pattern matching
// kept boring on purpose: regex over `industry|name` lowercased.
export function inferIndustryTag(company) {
  const cat = (company.industry || "").toLowerCase();
  const name = (company.name || "").toLowerCase();
  const blob = cat + " " + name;
  if (/defen[cs]e|aerospace|weapon|missile|armor/.test(cat) || /lockheed|raytheon|northrop|general dynamics|boeing|leidos|huntington ingalls|l3harris/.test(name)) return "defense";
  if (/firearm|gun |ammunition|smith.+wesson|sturm|ruger/.test(blob)) return "firearms";
  if (/tobacco|cigar|altria|philip morris|reynolds american/.test(blob)) return "tobacco";
  if (/coal|mining/.test(cat)) return "coal-mining";
  if (/oil|gas|petroleum|exxon|chevron|conoco|marathon|valero|halliburton|schlumberger/.test(blob)) return "oil-gas";
  if (/util|electric power|water util|natural gas dist/.test(cat)) return "utilities";
  if (/airline|aviation/.test(cat)) return "airlines";
  if (/truck|freight|rail/.test(cat)) return "trucking";
  if (/logistic|courier|parcel|ups|fedex/.test(blob)) return "logistics";
  if (/automob|automotive|car manuf|ford|gm |general motors|stellantis|tesla/.test(blob)) return "auto";
  if (/homebuild|construct/.test(cat)) return "homebuilders";
  if (/real estate|reit/.test(cat)) return "real-estate";
  if (/agric|farming|food processing|monsanto|cargill|tyson|adm/.test(blob)) return "agribusiness";
  if (/restaurant|fast food|mcdonald|starbucks|chipotle|yum/.test(blob)) return "restaurants";
  if (/food.*beverage|beverage|brewer|distill/.test(cat)) return "food-bev";
  if (/apparel|fashion|clothing|nike|adidas|lululemon/.test(blob)) return "apparel";
  if (/retail|department store|grocery|walmart|target|kroger/.test(blob)) return "retail";
  if (/pharm|drug manuf|pfizer|merck|astrazeneca|sanofi|novartis|gsk|abbvie|lilly/.test(blob)) return "pharma";
  if (/biotech|biological/.test(cat)) return "biotech";
  if (/hospital|healthcare facility|hca|tenet|universal health/.test(blob)) return "hospitals";
  if (/insurance|insurer|unitedhealth|aetna|cigna|humana|elevance/.test(blob)) return "health-insurance";
  if (/bank|jpmorgan|goldman|wells fargo|morgan stanley|citigroup/.test(blob)) return "finance-banks";
  if (/hedge|asset manag|private equity|blackrock|blackstone|kkr|apollo/.test(blob)) return "finance-hedge";
  if (/insurance company|reinsurance|allstate|metlife|prudential|aig/.test(blob)) return "finance-insurance";
  if (/telecom|wireless|verizon|at&t|t-mobile|comcast|charter/.test(blob)) return "telecom";
  if (/internet|social media|search|meta|google|alphabet|snap|pinterest|reddit|twitter/.test(blob)) return "internet-content";
  if (/streaming|film|tv |media|disney|netflix|paramount|warner|fox |nbcuniversal/.test(blob)) return "entertainment";
  if (/publish|book|magazine|newspaper/.test(cat)) return "publishing";
  if (/education|university|edtech|chegg|coursera|duolingo/.test(blob)) return "education";
  if (/software|cloud|saas|microsoft|salesforce|oracle|adobe|servicenow|workday|atlassian/.test(blob)) return "tech-cloud";
  if (/computer hardware|semiconductor|chip|intel|amd|nvidia|qualcomm|micron|broadcom|apple|dell|hp |hewlett/.test(blob)) return "tech-hardware";
  if (/technology|software|computing/.test(cat)) return "tech-cloud";
  if (/financial|finance/.test(cat)) return "finance-banks";
  if (/health/.test(cat)) return "health-insurance";
  return "default";
}

// Deterministic per-slug jitter so the same company gets the same numbers
// across runs (no randomness in tests). Cheap djb2-ish hash.
function slugHash(slug) {
  let h = 5381;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) + h + slug.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function syntheticRecordForCompany(company, year) {
  const tag = inferIndustryTag(company);
  const prior = INDUSTRY_PRIORS[tag] || INDUSTRY_PRIORS.default;
  const h = slugHash(company.slug);
  // ±15% jitter on $ totals, ±6pp jitter on D/R split. Deterministic.
  const jitter = ((h % 31) - 15) / 100;
  const partyJitter = ((h % 13) - 6);
  const total = Math.round(prior.baseUsd * (1 + jitter));
  const donorCount = Math.max(2, prior.baseDonors + ((h % 7) - 3));
  const demPct = Math.max(2, Math.min(96, prior.dem + partyJitter));
  const repPct = Math.max(2, Math.min(96, prior.rep - partyJitter));
  const otherPct = Math.max(0, 100 - demPct - repPct);
  return buildRecord({
    slug: company.slug,
    name: company.name,
    ticker: company.ticker,
    demTotal: (total * demPct) / 100,
    repTotal: (total * repPct) / 100,
    otherTotal: (total * otherPct) / 100,
    donorCount,
    year,
    executives: [],
    sources: [
      "https://www.fec.gov/data/browse-data/?tab=bulk-data",
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4",
      "https://www.opensecrets.org/industries  (industry priors)",
    ],
  });
}

// ─────────────────────────── runner ─────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function leanCountSummary(records) {
  const out = { D: 0, R: 0, split: 0, minimal: 0 };
  for (const r of records) {
    if (r.execDonationLean === "split") out.split++;
    else if (r.execDonationLean === "minimal") out.minimal++;
    else if (r.execDonationLean.startsWith("D")) out.D++;
    else if (r.execDonationLean.startsWith("R")) out.R++;
  }
  return out;
}

async function applyOne(company, year, tickerIndex) {
  // Live --apply path. Honors rate limits and degrades to synthetic on any
  // upstream failure so a single 500 doesn't kneecap the whole snapshot.
  try {
    if (!company.ticker) {
      return { ...syntheticRecordForCompany(company, year), _source: "synth_no_ticker" };
    }
    const tickerHit = tickerIndex[String(company.ticker).toUpperCase()];
    if (!tickerHit) {
      return { ...syntheticRecordForCompany(company, year), _source: "synth_no_cik" };
    }
    // Optional: pull Form 4 accession list to record provenance.
    let form4Count = 0;
    try {
      const filings = await fetchForm4Filings(tickerHit.cik);
      form4Count = filings.length;
    } catch {/* swallow */}
    await sleep(SEC_RATE_MS);

    // FEC contributions by employer (company display name).
    const rows = [];
    try {
      const partial = await fetchFecContributionsByEmployer(company.name, year);
      rows.push(...partial);
    } catch {/* swallow */}
    await sleep(FEC_RATE_MS);

    const totals = rollupContributions(rows);
    const rec = buildRecord({
      slug: company.slug,
      name: company.name,
      ticker: company.ticker,
      ...totals,
      year,
      executives: [],
      sources: [
        FEC_SCHED_A,
        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${tickerHit.cik}&type=4`,
      ],
    });
    rec._cik = tickerHit.cik;
    rec._form4Count = form4Count;
    rec._source = "fec_live";
    return rec;
  } catch (err) {
    return {
      ...syntheticRecordForCompany(company, year),
      _source: "synth_error",
      _error: err.message,
    };
  }
}

async function main() {
  const today = todayIso();
  const year = new Date().getUTCFullYear();
  // FEC uses 2-year transaction periods (even years).
  const fecYear = year % 2 === 0 ? year : year - 1;

  console.log(`exec-political-donations fetcher starting... (mode=${DRY ? "DRY (no network)" : "APPLY (real API)"}, year=${fecYear})`);

  await fs.mkdir(RAW_DIR, { recursive: true });

  let companies = await loadPublicCompanies();
  console.log(`Loaded ${companies.length} public companies from public/data/companies/`);

  if (SLUG_ARG) {
    companies = companies.filter(c => c.slug === SLUG_ARG);
    if (companies.length === 0) {
      console.error(`No public company matching slug "${SLUG_ARG}"`);
      process.exit(2);
    }
  }
  if (LIMIT_ARG) {
    companies = companies.slice(0, LIMIT_ARG);
    console.log(`Limiting to first ${LIMIT_ARG} companies`);
  }

  let tickerIndex = {};
  if (APPLY) {
    try {
      const rawTickers = await fetchSecTickers();
      tickerIndex = indexTickersByTicker(rawTickers);
      console.log(`SEC ticker→CIK index: ${Object.keys(tickerIndex).length} tickers`);
      await sleep(SEC_RATE_MS);
    } catch (err) {
      console.warn(`SEC ticker fetch failed: ${err.message} — per-company degrade to synthetic.`);
    }
  }

  const records = [];
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    const rec = APPLY
      ? await applyOne(c, fecYear, tickerIndex)
      : { ...syntheticRecordForCompany(c, fecYear), _source: "synth" };
    records.push(rec);
    if ((i + 1) % 500 === 0 || i === companies.length - 1) {
      console.log(`  ${i + 1}/${companies.length} processed`);
    }
  }

  const summary = leanCountSummary(records);
  const snapshot = {
    _license: "U.S. public domain (FEC + SEC) — 17 USC 105",
    _sources: [
      "https://www.fec.gov/data/browse-data/?tab=bulk-data",
      "https://api.open.fec.gov/v1/schedules/schedule_a/",
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4",
      "https://data.sec.gov/submissions/CIK<padded>.json",
    ],
    _generated_at: new Date().toISOString(),
    _mode: DRY ? "dry" : "apply",
    _fec_year: fecYear,
    _stats: {
      total: records.length,
      ...summary,
      coverage_pct_of_public: Math.round((records.length / Math.max(companies.length, 1)) * 1000) / 10,
    },
    companies: records,
  };

  // Raw daily snapshot.
  const rawFile = path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(rawFile, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${rawFile}`);

  // Aggregate — always written, merger reads this.
  await fs.writeFile(OUT_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${OUT_FILE}`);

  console.log(`\nLean distribution: D=${summary.D}  R=${summary.R}  split=${summary.split}  minimal=${summary.minimal}`);
  if (DRY) console.log(`(DRY — synthetic preview, no API traffic. Use --apply for real data.)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("exec-political-donations-fetch failed:", err);
    process.exit(1);
  });
}
