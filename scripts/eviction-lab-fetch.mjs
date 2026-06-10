#!/usr/bin/env node
/**
 * Eviction Lab + corporate-landlord research — per-landlord scorecard
 * rollup for the major US publicly-traded REITs and institutional
 * single-family / multifamily landlords.
 *
 * Why a curated fetcher and not a live scrape:
 *   Princeton's Eviction Lab publishes the *Top Evicting Landlords*
 *   building-level analysis (evictionlab.org/top-evicting-landlords-
 *   drive-us-eviction-crisis/) but does not name the corporate owners
 *   in machine-readable form. The named, attributable signals on each
 *   corporate landlord live in:
 *
 *     - FTC enforcement orders (ftc.gov/legal-library/browse/cases-proceedings)
 *     - DOJ Antitrust amended complaint vs RealPage (Jan 2025) — names
 *       co-defendant landlords
 *     - State AG actions (MN AG vs HavenBrook/Pretium 2022, DC AG vs
 *       Equity Residential 2022, NJ AG vs AvalonBay 2025, FTC + Colorado
 *       AG vs Greystar 2025)
 *     - Federal Reserve Bank of Atlanta corporate-landlord eviction study
 *     - House Oversight Committee Subcommittee report (Jul 2022) on
 *       corporate landlord pandemic-era eviction filings
 *
 *   This curated dataset transcribes the named signals on each landlord
 *   with the source URL it was read from. Refresh quarterly or whenever
 *   a major settlement / antitrust amendment drops.
 *
 * Output:
 *   data/raw/eviction-lab/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --apply       write snapshot to data/raw/...
 *   --dry         explicit dry (default behaviour without --apply)
 *   --out PATH    override output path
 *   --url URL     URL marker recorded in the snapshot meta (no scraping)
 *   --fixture     load LANDLORDS from scripts/fixtures/eviction-lab/ instead
 *   --limit N     truncate landlord count (debug)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/eviction-lab");
const FIXTURE_DIR = path.join(__dirname, "fixtures/eviction-lab");

export const SOURCE_URLS = {
  evictionLab: "https://evictionlab.org/top-evicting-landlords-drive-us-eviction-crisis/",
  evictionLabResearch: "https://evictionlab.org/research/",
  ftcInvitationHomes: "https://www.ftc.gov/news-events/news/press-releases/2024/09/federal-trade-commission-action-leads-48-million-refunds-renters-harmed-invitation-homes",
  dojRealPage: "https://www.justice.gov/opa/pr/justice-department-sues-realpage-algorithmic-pricing-scheme-harms-millions-american-renters",
  houseOversight: "https://oversightdemocrats.house.gov/news/press-releases/oversight-subcommittee-releases-staff-report-finding-corporate-landlords",
  atlantaFed: "https://www.frbatlanta.org/community-development/publications/discussion-papers/2016/04-corporate-landlords-institutional-investors-and-displacement-12-19-2016",
};

/**
 * Per-landlord curated dataset. Each record cites the source URL it was
 * read from. Fields:
 *   slug            — TruNorth slug (must match public/data/index.json)
 *   name            — corporate landlord display name
 *   landlord_type   — "single-family REIT" | "multifamily REIT" | "private equity"
 *                     | "property manager" | "manufactured housing REIT"
 *   est_units       — approximate total US units under operation
 *   actions         — array of {year, type, regulator, summary, penalty_usd, source_url}
 *   eviction_signal — short tag for severity bucketing:
 *                     "high" | "moderate" | "low" | "unknown"
 *   notes           — optional editorial context (stays short — narrative
 *                     writer formats the public-facing sentence)
 *
 * Severity tier rule (renter / community impact):
 *   any FTC consent order >= $30M  OR  DOJ antitrust co-defendant  OR
 *   tort verdict >= $100M                                          → "very_poor"
 *   any state-AG enforcement settlement OR DOJ Fair Housing case   → "poor"
 *   any documented action only                                     → "mixed"
 *   no actions found                                               → "neutral"
 */
export const LANDLORDS = [
  {
    slug: "invitation-homes",
    name: "Invitation Homes",
    landlord_type: "single-family REIT",
    est_units: 85000,
    eviction_signal: "high",
    actions: [
      {
        year: 2024,
        type: "FTC consent order",
        regulator: "FTC",
        summary:
          "$48M FTC consent order — Invitation Homes refunded 444,131 renters after the agency found 'unfair and deceptive tactics' including hidden fees, unjustly withheld security deposits, and misleading pandemic-era eviction-policy claims.",
        penalty_usd: 48_000_000,
        source_url:
          "https://www.ftc.gov/news-events/news/press-releases/2024/09/federal-trade-commission-action-leads-48-million-refunds-renters-harmed-invitation-homes",
      },
      {
        year: 2016,
        type: "academic study",
        regulator: "Atlanta Fed",
        summary:
          "Federal Reserve Bank of Atlanta study found Invitation Homes (and predecessor Starwood Waypoint) evicting at materially higher rates than small landlords — 15% for Invitation Homes and 30% for Starwood Waypoint in the study sample.",
        penalty_usd: 0,
        source_url:
          "https://www.frbatlanta.org/community-development/publications/discussion-papers/2016/04-corporate-landlords-institutional-investors-and-displacement-12-19-2016",
      },
    ],
    notes:
      "Largest US single-family REIT (~85K homes). Federal-level consumer-protection enforcement and academic-cited eviction-rate disparity.",
  },
  {
    slug: "american-homes-4-rent",
    name: "American Homes 4 Rent",
    landlord_type: "single-family REIT",
    est_units: 60000,
    eviction_signal: "moderate",
    actions: [
      {
        year: 2022,
        type: "Congressional investigation",
        regulator: "US House Oversight Subcommittee",
        summary:
          "House Oversight Subcommittee on Economic and Consumer Policy staff report named American Homes 4 Rent among the largest corporate landlords that collectively filed thousands of pandemic-era eviction actions, despite many tenants being protected by the CDC moratorium.",
        penalty_usd: 0,
        source_url:
          "https://oversightdemocrats.house.gov/news/press-releases/oversight-subcommittee-releases-staff-report-finding-corporate-landlords",
      },
    ],
    notes:
      "Second-largest US single-family rental REIT. Cited by House Oversight investigation.",
  },
  {
    slug: "starwood",
    name: "Starwood Capital Group",
    landlord_type: "private equity",
    est_units: 30000,
    eviction_signal: "moderate",
    actions: [
      {
        year: 2016,
        type: "academic study",
        regulator: "Atlanta Fed",
        summary:
          "Federal Reserve Bank of Atlanta study found Starwood Waypoint (the Starwood Capital SFR vehicle that later merged into Invitation Homes) evicting 30% of renters in the study sample — the highest rate among the corporate landlords examined.",
        penalty_usd: 0,
        source_url:
          "https://www.frbatlanta.org/community-development/publications/discussion-papers/2016/04-corporate-landlords-institutional-investors-and-displacement-12-19-2016",
      },
    ],
    notes:
      "Starwood Waypoint merged into Invitation Homes in 2017. Starwood Capital remains a major SFR/multifamily PE investor.",
  },
  {
    slug: "mid-america-apartment-communities",
    name: "Mid-America Apartment Communities (MAA)",
    landlord_type: "multifamily REIT",
    est_units: 102000,
    eviction_signal: "moderate",
    actions: [
      {
        year: 2018,
        type: "DOJ Fair Housing settlement",
        regulator: "DOJ Civil Rights Division",
        summary:
          "$11.3M DOJ settlement — Post Properties (acquired by MAA in 2016) violated Fair Housing Act and ADA design-and-construction requirements across 50 properties.",
        penalty_usd: 11_300_000,
        source_url:
          "https://www.justice.gov/opa/pr/justice-department-secures-113-million-settlement-largest-fair-housing-actadafha-case",
      },
      {
        year: 2023,
        type: "civil antitrust class action",
        regulator: "private class action",
        summary:
          "Named co-defendant in the RealPage rent-pricing algorithm class action alleging horizontal collusion across major multifamily landlords; case track moved into the DOJ amended complaint in January 2025.",
        penalty_usd: 0,
        source_url:
          "https://www.justice.gov/opa/pr/justice-department-sues-realpage-algorithmic-pricing-scheme-harms-millions-american-renters",
      },
    ],
    notes:
      "Largest US multifamily REIT by unit count.",
  },
  {
    slug: "sun-communities",
    name: "Sun Communities",
    landlord_type: "manufactured housing REIT",
    est_units: 180000,
    eviction_signal: "moderate",
    actions: [
      {
        year: 2024,
        type: "advocacy investigation",
        regulator: "Private Equity Stakeholder Project / MHAction",
        summary:
          "Private Equity Stakeholder Project and tenant advocates documented rent-hike and lot-fee complaints across Sun Communities manufactured-home parks; MHAction reports tracked tenant organising and state-AG inquiries.",
        penalty_usd: 0,
        source_url:
          "https://pestakeholder.org/issues/housing/",
      },
    ],
    notes:
      "Largest manufactured-housing REIT. Negative signal is investigative / advocacy rather than federal enforcement — flagged 'mixed' not 'poor'.",
  },
  {
    slug: "greystar",
    name: "Greystar Real Estate Partners",
    landlord_type: "property manager",
    est_units: 800000,
    eviction_signal: "high",
    actions: [
      {
        year: 2025,
        type: "DOJ antitrust",
        regulator: "DOJ Antitrust Division",
        summary:
          "DOJ amended complaint vs RealPage (Jan 2025) added Greystar and five other landlords as co-defendants, alleging illegal sharing of competitively sensitive rental information and algorithmic rent fixing.",
        penalty_usd: 0,
        source_url:
          "https://www.justice.gov/opa/pr/justice-department-sues-realpage-algorithmic-pricing-scheme-harms-millions-american-renters",
      },
      {
        year: 2025,
        type: "FTC + state AG suit",
        regulator: "FTC + Colorado Attorney General",
        summary:
          "FTC and Colorado AG sued Greystar for deceptively advertised lease rates that omitted mandatory hidden fees only revealed after nonrefundable application payments were collected.",
        penalty_usd: 0,
        source_url:
          "https://www.ftc.gov/news-events/news/press-releases",
      },
      {
        year: 2023,
        type: "tort verdict",
        regulator: "TX state court",
        summary:
          "Texas jury ordered Greystar to pay $860M to 17 plaintiffs over the 2019 Dallas crane collapse on a Greystar-owned development site, finding the company violated safety regulations.",
        penalty_usd: 860_000_000,
        source_url:
          "https://www.star-telegram.com/news/state/texas/article274488475.html",
      },
    ],
    notes:
      "Largest US apartment property manager (~800K units). DOJ co-defendant + FTC suit + $860M tort verdict — heaviest negative signal in the dataset.",
  },
  {
    slug: "avalon",
    name: "AvalonBay Communities",
    landlord_type: "multifamily REIT",
    est_units: 95000,
    eviction_signal: "moderate",
    actions: [
      {
        year: 2025,
        type: "state antitrust",
        regulator: "NJ Attorney General",
        summary:
          "NJ AG sued AvalonBay and nine other landlords for an 'unlawful conspiracy' using RealPage software to set supracompetitive rents in violation of NJ antitrust law.",
        penalty_usd: 0,
        source_url:
          "https://www.njoag.gov/wp-content/uploads/2025/04/RealPage-Complaint.pdf",
      },
      {
        year: 2025,
        type: "civil rights suit",
        regulator: "Equal Rights Center",
        summary:
          "Equal Rights Center sued AvalonBay (AVA NoMa, DC) alleging properties listed windowless rooms as bedrooms to evade housing-voucher accommodation requirements under DC code.",
        penalty_usd: 0,
        source_url:
          "https://equalrightscenter.org/press-releases/",
      },
    ],
    notes:
      "Top-3 US multifamily REIT (~95K apartment units). Multiple 2025 state AG and civil-rights actions.",
  },
];

export function todayUTC() { return new Date().toISOString().slice(0, 10); }

export function severityFor(l) {
  const actions = l.actions || [];
  const ftcLarge = actions.some(a =>
    /FTC/i.test(a.regulator || "") && (a.penalty_usd || 0) >= 30_000_000
  );
  const dojAntitrust = actions.some(a => /DOJ Antitrust/i.test(a.regulator || ""));
  const stateAg = actions.some(a => /Attorney General/i.test(a.regulator || ""));
  const housingDoj = actions.some(a => /DOJ Civil Rights/i.test(a.regulator || ""));
  const tortLarge = actions.some(a =>
    /tort|jury|verdict/i.test(a.type || "") && (a.penalty_usd || 0) >= 100_000_000
  );
  if (ftcLarge || dojAntitrust || tortLarge) return "very_poor";
  if (stateAg || housingDoj) return "poor";
  if (actions.length) return "mixed";
  return "neutral";
}

export function buildSnapshot(landlords) {
  return {
    source: "eviction-lab",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    landlord_count: landlords.length,
    landlords,
    license:
      "Public-records compilation. Federal enforcement (FTC, DOJ) is US-Federal public domain. State AG filings and academic studies are linked to original publishers.",
    methodology:
      "Per-landlord rollup of FTC consent orders, DOJ Antitrust Division complaints (incl. Jan 2025 RealPage amended complaint), state-AG suits, US House Oversight 2022 staff report on corporate landlord pandemic evictions, and the Federal Reserve Bank of Atlanta 2016 corporate-landlord eviction study. Each action cites the source URL it was read from.",
  };
}

function parseArgs(argv) {
  const out = { apply: false, dry: false, out: null, url: null, fixture: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--dry") out.dry = true;
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--fixture") out.fixture = true;
    else if (a === "--limit") out.limit = Number(argv[++i]);
  }
  return out;
}

async function runFixture() {
  const fp = path.join(FIXTURE_DIR, "landlords.json");
  const raw = JSON.parse(await fs.readFile(fp, "utf-8"));
  return buildSnapshot(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let landlords = LANDLORDS.slice();
  if (args.limit && args.limit > 0) landlords = landlords.slice(0, args.limit);

  const snap = args.fixture ? await runFixture() : buildSnapshot(landlords);
  if (args.url) snap.cli_url_marker = args.url;

  if (!args.apply || args.dry) {
    console.log(`Eviction Lab: ${snap.landlord_count} landlords (dry — no write). Use --apply to persist.`);
    console.log(JSON.stringify({
      preview: snap.landlords.map(l => ({ slug: l.slug, name: l.name, actions: (l.actions||[]).length, severity: severityFor(l) })),
    }, null, 2));
    return;
  }
  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.out || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath}  landlords=${snap.landlord_count}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("eviction-lab-fetch failed:", err); process.exit(1); });
}
