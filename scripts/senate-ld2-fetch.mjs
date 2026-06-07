#!/usr/bin/env node
/**
 * B-data4 (1/3) — Senate LD-2 lobbying disclosure fetcher
 *
 * Pulls the last 8 quarterly LD-2 filings from the public Senate Lobbying
 * Disclosure Act REST API (lda.senate.gov).
 *
 *   API root:  https://lda.senate.gov/api/v1/filings/
 *   Auth:      none required for read-only endpoints (token recommended
 *              to raise rate-limits to 120 req/min — set LDA_API_TOKEN)
 *   Docs:      https://lda.senate.gov/api/redoc/v1/
 *
 * For each registrant filing we keep:
 *   - filing_uuid           — stable per-filing key
 *   - filing_year, filing_period (Q1..Q4)
 *   - income (USD; what the client paid the firm) or expenses (self-filed)
 *   - registrant.name       — the lobbying firm (or self-filer)
 *   - client.name           — the entity benefiting from the lobbying
 *   - lobbying_activities[] — issue codes, descriptions, gov entities
 *
 * Output: /public/data/senate-ld2.json
 *   {
 *     generated_at,
 *     quarters: ["2025Q2","2025Q3","2025Q4","2026Q1", ...],
 *     filings: [ { ...minimal shape, see RAW_SCHEMA below... } ],
 *     stats: { total_filings, total_clients, total_USD_last_4q, by_quarter }
 *   }
 *
 * Pairs with: scripts/fara-fetch.mjs (foreign-principal side) and
 *             scripts/lobbying-merge.mjs (slug resolver + writer).
 *
 * Modes:
 *   --dry  (default)  → read test/fixtures/lobbying/senate-ld2-sample.json,
 *                       no network. Safe in CI/agents/worktrees.
 *   --live            → hit the real LDA API.
 *
 * Locally:
 *   node scripts/senate-ld2-fetch.mjs        # dry-run
 *   node scripts/senate-ld2-fetch.mjs --live # real fetch
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/senate-ld2.json");
const FIXTURE_FILE = path.join(ROOT, "test/fixtures/lobbying/senate-ld2-sample.json");

const LDA_BASE = "https://lda.senate.gov/api/v1/filings/";
const PAGE_SIZE = 250;
const REQ_DELAY_MS = 600;
const QUARTERS_TO_FETCH = 8;

const DRY = !process.argv.includes("--live");

/* --------------------------- quarter math --------------------------------- */

function currentQuarter(d = new Date()) {
  const m = d.getUTCMonth();
  return { year: d.getUTCFullYear(), q: Math.floor(m / 3) + 1 };
}

function lastNQuarters(n, from = currentQuarter()) {
  // Filings are released ~30 days after a quarter closes — so the *latest*
  // fully-published quarter is generally `from` minus 1.
  const out = [];
  let { year, q } = from;
  q -= 1;
  if (q === 0) { q = 4; year -= 1; }
  for (let i = 0; i < n; i++) {
    out.push({ year, q, key: `${year}Q${q}` });
    q -= 1;
    if (q === 0) { q = 4; year -= 1; }
  }
  return out.reverse();
}

const PERIOD_TO_Q = {
  first_quarter: 1,
  second_quarter: 2,
  third_quarter: 3,
  fourth_quarter: 4,
};

function quarterKeyOfFiling(f) {
  const y = f.filing_year;
  const p = PERIOD_TO_Q[f.filing_period] ||
    (f.filing_type && Number(f.filing_type.replace(/[^0-9]/g, "")) || null);
  return p ? `${y}Q${p}` : null;
}

/* ------------------------------ live fetch -------------------------------- */

async function fetchPageLive(params, attempt = 1) {
  const url = `${LDA_BASE}?${new URLSearchParams(params).toString()}`;
  const headers = {
    "User-Agent": "TruNorth-LDA/1.0 (+https://www.trunorthapp.com)",
    Accept: "application/json",
  };
  if (process.env.LDA_API_TOKEN) {
    headers.Authorization = `Token ${process.env.LDA_API_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (res.status === 429 && attempt < 4) {
    await new Promise(r => setTimeout(r, 2000 * attempt));
    return fetchPageLive(params, attempt + 1);
  }
  if (!res.ok) throw new Error(`LDA ${res.status} on ${url}`);
  return res.json();
}

async function fetchLive(quarters) {
  const filings = [];
  for (const { year, q } of quarters) {
    let page = 1;
    while (true) {
      const data = await fetchPageLive({
        filing_year: year,
        filing_period: ["", "first_quarter","second_quarter","third_quarter","fourth_quarter"][q],
        page,
        page_size: PAGE_SIZE,
      });
      const results = data.results || [];
      filings.push(...results.map(minimize));
      if (!data.next || results.length < PAGE_SIZE) break;
      page += 1;
      await new Promise(r => setTimeout(r, REQ_DELAY_MS));
    }
    console.log(`  ${year}Q${q}: cumulative=${filings.length}`);
  }
  return filings;
}

/* ------------------------------- dry-run ---------------------------------- */

async function fetchDry() {
  const raw = JSON.parse(await fs.readFile(FIXTURE_FILE, "utf-8"));
  return (raw.results || []).map(minimize);
}

/* --------------------------- minimal shape -------------------------------- *
 * What we persist per filing. This is the contract lobbying-merge.mjs reads.
 * Anything else is dropped to keep senate-ld2.json small.
 *
 * RAW_SCHEMA = {
 *   filing_uuid:    string,
 *   year:           number,
 *   quarter:        1|2|3|4,
 *   quarter_key:    "2026Q1",
 *   amount_USD:     number | null,
 *   registrant:     string,           // lobbying firm
 *   client:         string,           // who they're lobbying for
 *   issues:         [string, ...],    // human-readable issue codes
 *   issue_codes:    [string, ...],    // raw 3-letter codes
 *   gov_entities:   [string, ...],    // who they lobbied
 * }
 * --------------------------------------------------------------------------*/

function minimize(f) {
  const acts = Array.isArray(f.lobbying_activities) ? f.lobbying_activities : [];
  const issues = [];
  const issue_codes = [];
  const gov_entities = new Set();
  for (const a of acts) {
    if (a.general_issue_code_display) issues.push(a.general_issue_code_display);
    if (a.general_issue_code) issue_codes.push(a.general_issue_code);
    for (const g of a.government_entities || []) {
      if (g?.name) gov_entities.add(normalizeAgency(g.name));
    }
  }
  const incomeRaw = f.income != null ? f.income : f.expenses;
  const amount_USD = incomeRaw != null && incomeRaw !== "" ? Number(incomeRaw) : null;
  return {
    filing_uuid: f.filing_uuid,
    year: f.filing_year,
    quarter: PERIOD_TO_Q[f.filing_period] ||
      (f.filing_type ? Number(String(f.filing_type).replace(/[^0-9]/g, "")) : null),
    quarter_key: quarterKeyOfFiling(f),
    amount_USD: Number.isFinite(amount_USD) ? amount_USD : null,
    registrant: f.registrant?.name || null,
    client: f.client?.name || null,
    issues,
    issue_codes,
    gov_entities: [...gov_entities],
  };
}

// Collapse verbose agency labels to short canonical names.
function normalizeAgency(raw) {
  const s = String(raw).trim();
  const lookup = [
    [/U\.S\.\s*SENATE/i, "U.S. Senate"],
    [/U\.S\.\s*HOUSE/i, "U.S. House"],
    [/^Health\s*&\s*Human\s*Services|HHS/i, "HHS"],
    [/Centers?\s*for\s*Medicare|CMS\b/i, "CMS"],
    [/Food\s*&\s*Drug|FDA\b/i, "FDA"],
    [/Defense\s*Dept|DOD\b/i, "DOD"],
    [/Treasury/i, "Treasury"],
    [/Justice|DOJ\b/i, "DOJ"],
    [/State\s*Dept/i, "State Dept"],
    [/Federal\s*Trade|FTC\b/i, "FTC"],
    [/Federal\s*Communications|FCC\b/i, "FCC"],
    [/Federal\s*Aviation|FAA\b/i, "FAA"],
    [/Securities\s*&?\s*Exchange|SEC\b/i, "SEC"],
    [/Environmental\s*Protection|EPA\b/i, "EPA"],
    [/U\.S\.\s*Trade\s*Representative|USTR\b/i, "USTR"],
    [/White\s*House/i, "White House"],
    [/Office\s*of\s*Management.*Budget|OMB\b/i, "OMB"],
  ];
  for (const [rx, label] of lookup) if (rx.test(s)) return label;
  return s;
}

/* --------------------------------- main ----------------------------------- */

async function main() {
  const mode = DRY ? "DRY" : "LIVE";
  console.log(`Senate LD-2 fetcher (${mode}) starting…`);
  const quarters = lastNQuarters(QUARTERS_TO_FETCH);
  console.log(`Quarters of interest: ${quarters.map(q => q.key).join(", ")}`);

  const filings = DRY ? await fetchDry() : await fetchLive(quarters);

  // Stats
  const byQuarter = {};
  const clients = new Set();
  let total4q = 0;
  const last4Keys = new Set(quarters.slice(-4).map(q => q.key));
  for (const f of filings) {
    if (f.client) clients.add(f.client);
    byQuarter[f.quarter_key] = (byQuarter[f.quarter_key] || 0) + 1;
    if (last4Keys.has(f.quarter_key) && f.amount_USD) total4q += f.amount_USD;
  }

  const payload = {
    generated_at: new Date().toISOString(),
    mode,
    quarters: quarters.map(q => q.key),
    filings,
    stats: {
      total_filings: filings.length,
      total_clients: clients.size,
      total_USD_last_4q: total4q,
      by_quarter: byQuarter,
    },
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  filings:        ${filings.length}`);
  console.log(`  clients:        ${clients.size}`);
  console.log(`  last 4q total:  $${total4q.toLocaleString()}`);
}

main().catch(err => {
  console.error("senate-ld2-fetch failed:", err);
  process.exit(1);
});
