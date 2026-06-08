#!/usr/bin/env node
/**
 * Firearms-industry corporate signals — Step 1: curated source aggregation
 * + (optional) FEC PAC enrichment.
 *
 * What this collects
 * ------------------
 * For each consumer brand on TruNorth's catalog, we want a NEUTRAL,
 * source-cited answer to: "is this corporation affiliated with the
 * firearms industry?". The answer rolls together four orthogonal public
 * signals — any one of which is enough to be flagged:
 *
 *   1. NSSF (National Shooting Sports Foundation) corporate membership.
 *      NSSF is the firearms-industry trade association. Its corporate
 *      member list is published at
 *      https://www.nssf.org/about-us/our-members/
 *      (HTML, behind a JS-rendered directory). We mirror the well-known
 *      members below as a curated seed; future iterations may automate
 *      the directory crawl once it stabilizes.
 *
 *   2. NRA Business Alliance corporate membership / corporate sponsors
 *      of NRA, GOA, or other firearms-policy advocacy organizations.
 *      Public membership directory at
 *      https://www.nrabusinessalliance.com/ (when active) and the
 *      historical sponsor lists archived at home.nra.org.
 *
 *   3. FEC corporate PAC donations to firearms-industry committees.
 *      Public via https://api.open.fec.gov/v1/ — no auth for read,
 *      DEMO_KEY good for ~1k req/day. We track:
 *        - NSSF PAC                                  (C00037283 family)
 *        - NRA Political Victory Fund                (C00053553)
 *        - Gun Owners of America (GOA) PAC           (C00254507)
 *      Per-committee contributor totals are sourced from
 *      /v1/schedules/schedule_a/by_employer/ with `committee_id` +
 *      a 5y window. (Note: corporate treasury donations to candidate
 *      committees are illegal post-Tillman Act; these are individual
 *      contributions whose donors self-identify a corporate employer.
 *      We treat large-aggregate matches as a corroborating corporate
 *      signal, not a primary one.)
 *
 *   4. Direct firearms retail/manufacturing.
 *      Curated overlap with retailers who built guns into their floor
 *      plan (Walmart, Bass Pro, Cabela's [merged into Bass Pro 2017],
 *      Academy Sports, Dick's Sporting Goods [exited 2020], Sportsman's
 *      Warehouse, Big 5 Sporting Goods, Rural King, Tractor Supply
 *      [ammo only]) and gun manufacturers (Sturm Ruger, Smith & Wesson,
 *      etc.). Cross-referenced with the existing atf-fetch.mjs FFL
 *      pipeline; THIS script intentionally does NOT duplicate ATF data —
 *      the atf-merge.mjs flow is the source of truth for FFL license
 *      attachment, and this script's `retailsFirearms` /
 *      `manufacturesFirearms` flags are a conservative narrative overlay,
 *      not an FFL claim.
 *
 * Neutrality
 * ----------
 * Language is deliberately neutral: "firearms-industry-affiliated",
 * "manufacturer of firearms", "retailer of firearms". No "gun lobby",
 * no "pro-gun", no "weapons dealer". Each entry carries a
 * `sourceUrls[]` so the app can show receipts.
 *
 * Output
 * ------
 *   data/raw/firearms-industry/<YYYY-MM-DD>.json
 *     {
 *       _license: "Public records / public membership lists / FEC.gov",
 *       _source_urls: [ ... ],
 *       _generated_at: "...",
 *       _stats: { ... },
 *       seed_entries: [   // one row per known-affiliated entity
 *         {
 *           slug,                          // TruNorth catalog slug
 *           name,                          // display name
 *           industryMember: bool,
 *           organizations: ["NSSF", "NRA-BA", ...],
 *           pacContributionsUsd: number,   // 5y window, may be 0
 *           pacContributionsByCommittee: { "C00053553": 25000, ... },
 *           retailsFirearms: bool,
 *           manufacturesFirearms: bool,
 *           sourceUrls: ["https://...", ...],
 *           notes: "..."                    // short, neutral
 *         },
 *         ...
 *       ]
 *     }
 *
 * Flags
 * -----
 *   --dry        (default)  — no network. Uses the curated seed only.
 *   --apply                 — hits the FEC API to enrich pacContributions.
 *                              Writes a fresh timestamped raw file.
 *   --out=PATH              — override output path (mostly for tests).
 *   --fec-window=YEARS      — FEC lookback window in years (default 5).
 *
 * Runs via .github/workflows/firearms-industry-quarterly.yml, quarterly
 * on the 7th of Jan/Apr/Jul/Oct.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/raw/firearms-industry");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const OUT_OVERRIDE = argv
  .find((a) => a.startsWith("--out="))
  ?.slice("--out=".length);
const FEC_WINDOW_YEARS = Number(
  argv.find((a) => a.startsWith("--fec-window="))?.slice("--fec-window=".length)
  || 5,
);

const FEC_API_BASE = "https://api.open.fec.gov/v1";
const FEC_API_KEY = process.env.FEC_API_KEY || "DEMO_KEY";
const UA = "TruNorth-FirearmsIndustry/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1100; // FEC rate limit ~1 req/sec for DEMO_KEY

// ─── Source URL constants ────────────────────────────────────────────────
export const SOURCES = {
  NSSF_MEMBERS: "https://www.nssf.org/about-us/our-members/",
  NRA_BA:       "https://www.nrabusinessalliance.com/",
  NRA_HOME:     "https://home.nra.org/",
  GOA:          "https://gunowners.org/",
  BRADY:        "https://www.bradyunited.org/",
  GIFFORDS:     "https://giffords.org/",
  EVERYTOWN:    "https://www.everytown.org/",
  FEC:          "https://www.fec.gov/",
  ATF_FFL:      "https://www.atf.gov/firearms/listing-federal-firearms-licensees",
};

// FEC committee IDs for firearms-industry political committees.
// Sourced from FEC.gov public filings:
//   - NSSF PAC                       https://www.fec.gov/data/committee/C00037283/
//   - NRA Political Victory Fund     https://www.fec.gov/data/committee/C00053553/
//   - Gun Owners of America Inc PAC  https://www.fec.gov/data/committee/C00254507/
//   - Nat'l Assoc for Gun Rights PAC https://www.fec.gov/data/committee/C00415173/
export const FIREARMS_COMMITTEES = [
  { id: "C00037283", name: "NSSF PAC",                          org: "NSSF" },
  { id: "C00053553", name: "NRA Political Victory Fund",        org: "NRA"  },
  { id: "C00254507", name: "Gun Owners of America PAC",         org: "GOA"  },
  { id: "C00415173", name: "National Assoc for Gun Rights PAC", org: "NAGR" },
];

// ─── Curated seed: firearms-industry-affiliated brands ────────────────────
//
// Each entry cites a public source. Marked neutrally. This list is
// deliberately conservative — we'd rather under-tag than libel.
// All organizations listed are public lobbying / advocacy orgs, all
// membership claims are sourced to publicly visible directories or
// historical press releases.
//
// "organizations" values:
//   "NSSF"    — NSSF corporate member (firearms-industry trade group)
//   "NRA-BA"  — NRA Business Alliance corporate member
//   "GOA"     — public GOA corporate sponsor
//   "FFL"     — holds (or recently held) Federal Firearms License
//   "OEM"     — original-equipment manufacturer of firearms
//
export const SEED_ENTRIES = [
  // ── Tier 1: firearms manufacturers (current) ──
  {
    slug: "sturm-ruger-and-co", name: "Sturm, Ruger & Co.",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://ruger.com/corporate/", SOURCES.ATF_FFL],
    notes: "Publicly traded firearms manufacturer (NYSE: RGR); NSSF member.",
  },
  {
    slug: "smith-and-wesson-brands", name: "Smith & Wesson Brands",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://ir.smith-wesson.com/", SOURCES.ATF_FFL],
    notes: "Publicly traded firearms manufacturer (NASDAQ: SWBI); NSSF member.",
  },
  {
    slug: "vista-outdoor", name: "Vista Outdoor",
    organizations: ["NSSF", "OEM"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://vistaoutdoor.com/"],
    notes: "Parent of Federal Ammunition, CCI, Remington Ammunition; NSSF member.",
  },
  {
    slug: "olin-corporation", name: "Olin Corporation",
    organizations: ["NSSF", "OEM"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.olin.com/businesses/winchester/"],
    notes: "Parent of Winchester Ammunition; NSSF member.",
  },
  {
    slug: "ammo-inc", name: "AMMO Inc.",
    organizations: ["NSSF", "OEM"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://ammoinc.com/"],
    notes: "Ammunition manufacturer; NSSF member; parent of GunBroker.com.",
  },
  {
    slug: "beretta", name: "Beretta U.S.A.",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: true, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.beretta.com/"],
    notes: "U.S. subsidiary of Beretta Holding (Italy); firearms manufacturer.",
  },
  {
    slug: "glock", name: "Glock Inc.",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://us.glock.com/"],
    notes: "Pistol manufacturer; NSSF member.",
  },
  {
    slug: "sig-sauer-inc", name: "SIG Sauer",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.sigsauer.com/"],
    notes: "Firearms manufacturer; NSSF member.",
  },
  {
    slug: "henry-repeating-arms", name: "Henry Repeating Arms",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.henryusa.com/"],
    notes: "Rifle manufacturer; NSSF member.",
  },
  {
    slug: "kimber-mfg", name: "Kimber Manufacturing",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.kimberamerica.com/"],
    notes: "Firearms manufacturer; NSSF member.",
  },
  {
    slug: "savage-arms", name: "Savage Arms",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.savagearms.com/"],
    notes: "Rifle manufacturer; NSSF member.",
  },
  {
    slug: "mossberg", name: "O.F. Mossberg & Sons",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.mossberg.com/"],
    notes: "Shotgun and rifle manufacturer; NSSF member.",
  },
  {
    slug: "browning-arms-company", name: "Browning Arms Company",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.browning.com/"],
    notes: "Subsidiary of FN Herstal; firearms manufacturer.",
  },
  {
    slug: "winchester-repeating-arms-company", name: "Winchester Repeating Arms",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.winchesterguns.com/"],
    notes: "Firearms brand (Winchester rifles); manufacturer.",
  },
  {
    slug: "remington-firearms", name: "Remington Firearms (RemArms)",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.remarms.com/"],
    notes: "Successor to Remington Outdoor firearms division; manufacturer.",
  },
  {
    slug: "colt-s-manufacturing-company", name: "Colt's Manufacturing Company",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.colt.com/"],
    notes: "Subsidiary of CZ Group; firearms manufacturer.",
  },
  {
    slug: "fn-america", name: "FN America",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://fnamerica.com/"],
    notes: "U.S. arm of FN Herstal; firearms manufacturer.",
  },
  {
    slug: "springfield-armory", name: "Springfield Armory Inc.",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.springfield-armory.com/"],
    notes: "Firearms manufacturer; NSSF member.",
  },
  {
    slug: "daniel-defense", name: "Daniel Defense",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://danieldefense.com/"],
    notes: "Modern sporting rifle manufacturer; NSSF member.",
  },
  {
    slug: "palmetto-state-armory", name: "Palmetto State Armory",
    organizations: ["NSSF", "OEM", "FFL"],
    retailsFirearms: true, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://palmettostatearmory.com/"],
    notes: "Manufacturer and online firearms retailer; NSSF member.",
  },

  // ── Ammunition / components ──
  {
    slug: "hornady", name: "Hornady Manufacturing",
    organizations: ["NSSF", "OEM"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.hornady.com/"],
    notes: "Ammunition and reloading components; NSSF member.",
  },
  {
    slug: "federal-cartridge", name: "Federal Ammunition",
    organizations: ["NSSF", "OEM"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.federalpremium.com/"],
    notes: "Ammunition; Vista Outdoor subsidiary; NSSF member.",
  },
  {
    slug: "cci-ammunition", name: "CCI Ammunition",
    organizations: ["NSSF", "OEM"],
    retailsFirearms: false, manufacturesFirearms: true,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.cci-ammunition.com/"],
    notes: "Rimfire ammunition; Vista Outdoor subsidiary; NSSF member.",
  },

  // ── Optics / accessories (NSSF members, conservatively flagged) ──
  {
    slug: "leupold", name: "Leupold & Stevens",
    organizations: ["NSSF"],
    retailsFirearms: false, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.leupold.com/"],
    notes: "Riflescope and optics manufacturer; NSSF member.",
  },
  {
    slug: "vortex-optics", name: "Vortex Optics",
    organizations: ["NSSF"],
    retailsFirearms: false, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://vortexoptics.com/"],
    notes: "Riflescopes and optics; NSSF member.",
  },
  {
    slug: "trijicon", name: "Trijicon",
    organizations: ["NSSF"],
    retailsFirearms: false, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.trijicon.com/"],
    notes: "Optics and aiming systems; NSSF member.",
  },
  {
    slug: "magpul", name: "Magpul Industries",
    organizations: ["NSSF"],
    retailsFirearms: false, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.magpul.com/"],
    notes: "Firearms accessories; NSSF member.",
  },

  // ── Tier 1/2: large retailers selling firearms ──
  {
    slug: "walmart", name: "Walmart",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [
      SOURCES.ATF_FFL,
      "https://corporate.walmart.com/news/2019/09/03/mcmillon-to-associates-and-customers-our-next-steps-in-response-to-the-tragedies-in-el-paso-and-southaven",
    ],
    notes: "Largest U.S. retailer; sells long guns and ammunition. Stopped handgun and short-barreled rifle ammunition sales in 2019.",
  },
  {
    slug: "bass-pro-shops", name: "Bass Pro Shops",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.ATF_FFL, "https://www.basspro.com/shop/en/firearms"],
    notes: "Outdoor retailer; acquired Cabela's in 2017. Significant firearms department.",
  },
  {
    slug: "cabela-s-bass-pro", name: "Cabela's",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.ATF_FFL, "https://www.cabelas.com/category/Firearms/104291480"],
    notes: "Outdoor retailer; subsidiary of Bass Pro Group since 2017.",
  },
  {
    slug: "academy-sports", name: "Academy Sports + Outdoors",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.ATF_FFL, "https://www.academy.com/shop/browse/outdoors/hunting/firearms"],
    notes: "Sporting goods retailer; sells firearms and ammunition.",
  },
  {
    slug: "dick-s-sporting-goods", name: "Dick's Sporting Goods",
    organizations: [],
    retailsFirearms: false, manufacturesFirearms: false,
    sourceUrls: [
      "https://investors.dicks.com/news/news-details/2020/Dicks-Sporting-Goods-Removes-Hunt-Department-from-440-Additional-Stores/default.aspx",
    ],
    notes: "Removed hunting department (including firearms) from majority of stores by 2020; sold remaining Field & Stream stores 2023. No longer a firearms retailer.",
    historicalOnly: true,
  },
  {
    slug: "sportsmans-warehouse", name: "Sportsman's Warehouse",
    organizations: ["NSSF", "FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, SOURCES.ATF_FFL, "https://www.sportsmans.com/shooting-gear/firearms"],
    notes: "Outdoor and shooting-sports retailer; NSSF member.",
  },
  {
    slug: "big-5-sporting-goods", name: "Big 5 Sporting Goods",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.ATF_FFL, "https://www.big5sportinggoods.com/store/c/firearms"],
    notes: "Regional sporting goods retailer; firearms department.",
  },
  {
    slug: "rural-king", name: "Rural King",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.ATF_FFL, "https://www.ruralking.com/sporting-goods/firearms"],
    notes: "Farm and home retailer; sells firearms and ammunition.",
  },
  {
    slug: "tractor-supply", name: "Tractor Supply Company",
    organizations: [],
    retailsFirearms: false, manufacturesFirearms: false,
    sourceUrls: ["https://www.tractorsupply.com/tsc/catalog/ammunition"],
    notes: "Sells ammunition; does not sell firearms in stores.",
  },
  {
    slug: "scheels", name: "Scheels",
    organizations: ["NSSF", "FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, SOURCES.ATF_FFL, "https://www.scheels.com/firearms/"],
    notes: "Sporting goods retailer; significant firearms department; NSSF member.",
  },
  {
    slug: "fleet-farm", name: "Fleet Farm",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.ATF_FFL, "https://www.fleetfarm.com/category/firearms-ammo/firearms"],
    notes: "Midwest farm/home retailer; firearms department.",
  },
  {
    slug: "gander-outdoors", name: "Gander Outdoors",
    organizations: ["FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.ATF_FFL, "https://www.ganderoutdoors.com/firearms"],
    notes: "Outdoor retailer; firearms department.",
  },
  {
    slug: "turners-outdoorsman", name: "Turner's Outdoorsman",
    organizations: ["NSSF", "FFL"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, SOURCES.ATF_FFL, "https://www.turners.com/"],
    notes: "California-based firearms and shooting sports retailer; NSSF member.",
  },

  // ── Online firearms marketplaces ──
  {
    slug: "gunbroker", name: "GunBroker.com",
    organizations: ["NSSF"],
    retailsFirearms: true, manufacturesFirearms: false,
    sourceUrls: [SOURCES.NSSF_MEMBERS, "https://www.gunbroker.com/"],
    notes: "Online firearms marketplace; subsidiary of AMMO Inc.; NSSF member.",
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the raw seed object — no network. Used for the dry path and as
 * the base for --apply (which then enriches with FEC totals).
 */
export function buildSeedSnapshot(entries = SEED_ENTRIES) {
  const rows = entries.map((e) => ({
    slug: e.slug,
    name: e.name,
    industryMember: (e.organizations || []).some(
      (o) => o === "NSSF" || o === "NRA-BA" || o === "GOA",
    ),
    organizations: [...(e.organizations || [])].sort(),
    pacContributionsUsd: 0,
    pacContributionsByCommittee: {},
    retailsFirearms: !!e.retailsFirearms,
    manufacturesFirearms: !!e.manufacturesFirearms,
    sourceUrls: [...(e.sourceUrls || [])],
    notes: e.notes || "",
    historicalOnly: !!e.historicalOnly,
  }));
  return {
    _license:
      "Public records: NSSF/NRA public membership directories, ATF FFL list, FEC.gov disclosures. Free to redistribute with attribution.",
    _source_urls: Object.values(SOURCES),
    _generated_at: new Date().toISOString(),
    _stats: computeStats(rows),
    seed_entries: rows,
  };
}

export function computeStats(rows) {
  const total = rows.length;
  const members = rows.filter((r) => r.industryMember).length;
  const manufacturers = rows.filter((r) => r.manufacturesFirearms).length;
  const retailers = rows.filter((r) => r.retailsFirearms).length;
  const historical = rows.filter((r) => r.historicalOnly).length;
  const withPac = rows.filter((r) => r.pacContributionsUsd > 0).length;
  return {
    total_entries: total,
    industry_members: members,
    manufacturers,
    retailers,
    historical_only: historical,
    with_pac_contributions: withPac,
  };
}

// ─── FEC enrichment (apply mode only) ─────────────────────────────────────

/**
 * Pull aggregated contributions by employer for a committee from FEC.
 * Endpoint: /v1/schedules/schedule_a/by_employer/ aggregates Sch A
 * (individual + connected-org) contributions per employer string,
 * which gives us a corporate-name signal even for individual
 * contributions where executives identify their employer.
 *
 * We use this to spot brands whose executives are top contributors to
 * NSSF/NRA/GOA PACs. Treated as a corroborating signal, not a primary
 * one — the curated seed is the primary.
 */
async function fetchByEmployer(committeeId, cycle) {
  const url = new URL(`${FEC_API_BASE}/schedules/schedule_a/by_employer/`);
  url.searchParams.set("api_key", FEC_API_KEY);
  url.searchParams.set("committee_id", committeeId);
  url.searchParams.set("cycle", String(cycle));
  url.searchParams.set("per_page", "100");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!res.ok) {
    console.warn(`  FEC ${res.status} for committee ${committeeId} cycle ${cycle}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

/**
 * For each entry in `rows`, look up its employer aggregate against each
 * firearms-industry committee for the FEC_WINDOW_YEARS window. Sum into
 * pacContributionsUsd and pacContributionsByCommittee.
 *
 * Match employer ↔ brand by case-insensitive substring on the seed name.
 * Conservative: stops at the seed entries — does NOT discover new ones
 * via FEC (that would risk libel from name collisions).
 */
export async function enrichWithFec(rows, opts = {}) {
  const {
    committees = FIREARMS_COMMITTEES,
    windowYears = FEC_WINDOW_YEARS,
    fetchFn = fetchByEmployer,
    delayMs = REQ_DELAY_MS,
    now = new Date(),
  } = opts;
  // FEC "cycles" are even years; walk back N years.
  const cycles = [];
  for (let y = now.getUTCFullYear(); y > now.getUTCFullYear() - windowYears; y -= 2) {
    cycles.push(y % 2 === 0 ? y : y + 1);
  }
  const dedupCycles = Array.from(new Set(cycles));

  // Index rows by normalized name for fuzzy match. We normalize by
  // lowercasing, replacing &/, with spaces, and collapsing whitespace
  // so that "Sturm, Ruger & Co." matches "STURM RUGER AND CO".
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[.,'"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const rowByNormName = new Map(rows.map((r) => [norm(r.name), r]));

  for (const cycle of dedupCycles) {
    for (const cmte of committees) {
      const aggregates = await fetchFn(cmte.id, cycle);
      for (const a of aggregates) {
        const employer = String(a.employer || "").trim();
        if (!employer) continue;
        const total = Number(a.total || 0);
        if (!total) continue;
        const employerNorm = norm(employer);
        for (const [name, row] of rowByNormName.entries()) {
          if (employerNorm.includes(name)) {
            row.pacContributionsUsd += total;
            row.pacContributionsByCommittee[cmte.id] =
              (row.pacContributionsByCommittee[cmte.id] || 0) + total;
            if (!row.sourceUrls.includes(SOURCES.FEC)) {
              row.sourceUrls.push(SOURCES.FEC);
            }
          }
        }
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  return rows;
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `firearms-industry-fetch: mode=${DRY ? "DRY (curated seed only)" : "APPLY (curated seed + FEC enrichment)"}`,
  );

  const snapshot = buildSeedSnapshot();

  if (APPLY) {
    console.log(`  Enriching ${snapshot.seed_entries.length} entries with FEC PAC data (${FEC_WINDOW_YEARS}y window)…`);
    try {
      await enrichWithFec(snapshot.seed_entries);
      snapshot._stats = computeStats(snapshot.seed_entries);
    } catch (e) {
      console.warn(`  FEC enrichment failed: ${e.message}. Falling back to curated seed only.`);
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = OUT_OVERRIDE
    ? path.resolve(OUT_OVERRIDE)
    : path.join(OUT_DIR, `${isoDate()}.json`);
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`  Wrote ${path.relative(ROOT, outPath)}`);
  console.log(`  Stats: ${JSON.stringify(snapshot._stats)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("firearms-industry-fetch failed:", err);
    process.exit(1);
  });
}
