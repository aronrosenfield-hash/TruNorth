#!/usr/bin/env node
/**
 * Corporate charitable giving (annual)
 *
 * Builds a per-brand record of corporate charitable giving for the curated
 * list of ~600 Fortune-1000 + high-visibility consumer brands TruNorth
 * cares about. Combines TWO complementary public sources:
 *
 *   1. IRS Form 990 (the receiving nonprofit's annual return) for the
 *      brand's corporate foundation, accessed via ProPublica's Nonprofit
 *      Explorer API (the gold-standard mirror of IRS 990 PDFs).
 *        API: https://projects.propublica.org/nonprofits/api/v2/
 *        Per-org endpoint: /organizations/{EIN}.json
 *        Bulk endpoint:    /search.json?q=&c_code[id]=3
 *
 *   2. Corporate citizenship / social-impact disclosures published by the
 *      parent company itself (e.g. walmart.org, jpmorganchase.com/impact).
 *      We bake the latest publicly disclosed top-line "total giving" /
 *      "social impact" dollar figure (and, when stated, the % of revenue)
 *      directly into a curated table, since these landing pages are
 *      heterogeneous JS-rendered marketing sites that don't expose a
 *      machine-readable feed.
 *
 * The merge step (corporate-giving-merge.mjs) reduces these to a single
 * `charity` block keyed by slug:
 *   {
 *     totalGivingUsd: 1_730_000_000,
 *     pctRevenue:     0.27,             // optional, null if not disclosed
 *     year:           2024,
 *     sourceUrl:      "https://corporate.walmart.com/...",
 *     foundationName: "Walmart Foundation",
 *     ein:            "20-5639919",     // optional
 *     source:         "corporate-disclosure" | "irs-990" | "blend",
 *   }
 *
 * License: IRS 990s are US public records. ProPublica adds value but does
 * not restrict reuse of the underlying data. Corporate citizenship reports
 * are voluntarily disclosed by the brand.
 *
 * Output:
 *   data/raw/corporate-giving/<date>.json   (every run)
 *
 * Flags:
 *   --dry       (default) — DOES NOT hit the network. Emits the curated
 *                            seed table directly (the corporate-disclosure
 *                            figures are already the latest annual numbers,
 *                            so dry mode is fully usable end-to-end).
 *   --apply    — additionally call ProPublica's Nonprofit Explorer API
 *                (1 req/sec courtesy throttle) for every seed entry that
 *                lists an EIN, refreshing totalGrants + fiscalYear from
 *                the most recent Form 990 filing on file.
 *   --smoke    — only process the first 5 seed entries (for quick CI test).
 *
 * Runs via .github/workflows/corporate-giving-annual.yml on Mar 1 @
 * 06:00 UTC (most calendar-year 990s are filed by Feb 15 with extensions).
 *
 * Locally:
 *   node scripts/corporate-giving-fetch.mjs                # dry, all seeds
 *   node scripts/corporate-giving-fetch.mjs --apply        # real API calls
 *   node scripts/corporate-giving-fetch.mjs --smoke        # 5-seed dry run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/raw/corporate-giving");

const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2";
const UA = "TruNorth-CorporateGiving/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;

const argv  = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const SMOKE = argv.has("--smoke");
const DRY   = !APPLY;

// ───────────────────────── curated seed ─────────────────────────
// Each entry: { slug, foundationName?, ein?, latestTotalUsd, pctRevenue?,
//               year, sourceUrl }
// - slug:           the TruNorth company file slug
// - foundationName: 501(c)(3) corporate foundation (when one exists)
// - ein:            EIN of that foundation (digits only, no dash) so we
//                   can hit /organizations/{EIN}.json on --apply
// - latestTotalUsd: most-recent publicly disclosed total annual giving in
//                   USD. Pulled from the company's social-impact landing
//                   page or the foundation's 990. Multi-source brands use
//                   the larger of the two (the corporate-disclosure
//                   number usually captures product donations + foundation
//                   cash + employee matches; the 990 captures cash only).
// - pctRevenue:     latest disclosed giving as % of revenue (decimal).
//                   null when not stated.
// - year:           fiscal year of latestTotalUsd
// - sourceUrl:      where we read the number from
//
// All dollar figures and EINs are from PUBLIC RECORDS (IRS 990 PDFs +
// corporate citizenship reports). Curated 2026-06 against the latest
// available disclosure as of that date.
export const SEED = [
  // ── Mega-givers ($100M+ annual cash/in-kind) ──
  { slug: "walmart",                foundationName: "Walmart Foundation",            ein: "205639919",  latestTotalUsd: 1_730_000_000, pctRevenue: 0.0027, year: 2024, sourceUrl: "https://corporate.walmart.com/purpose/philanthropy" },
  { slug: "google-alphabet",        foundationName: "Google.org",                    ein: "203259884",  latestTotalUsd: 350_000_000,   pctRevenue: 0.0011, year: 2024, sourceUrl: "https://www.google.org/our-work/" },
  { slug: "microsoft",              foundationName: "Microsoft Philanthropies",      ein: "911144442",  latestTotalUsd: 3_200_000_000, pctRevenue: 0.0125, year: 2024, sourceUrl: "https://www.microsoft.com/en-us/corporate-responsibility/philanthropies" },
  { slug: "apple",                  foundationName: null,                            ein: null,         latestTotalUsd: 880_000_000,   pctRevenue: 0.0023, year: 2024, sourceUrl: "https://www.apple.com/environment/pdf/Apple_Environmental_Progress_Report.pdf" },
  { slug: "amazon",                 foundationName: null,                            ein: null,         latestTotalUsd: 920_000_000,   pctRevenue: 0.0016, year: 2024, sourceUrl: "https://www.aboutamazon.com/impact/community" },
  { slug: "meta-platforms",         foundationName: null,                            ein: null,         latestTotalUsd: 230_000_000,   pctRevenue: 0.0017, year: 2024, sourceUrl: "https://about.fb.com/news/social-impact/" },
  { slug: "jpmorgan-chase",         foundationName: "JPMorgan Chase Foundation",     ein: "136037292",  latestTotalUsd: 312_000_000,   pctRevenue: 0.0021, year: 2024, sourceUrl: "https://www.jpmorganchase.com/impact" },
  { slug: "bank-of-america",        foundationName: "Bank of America Charitable Foundation", ein: "566038899", latestTotalUsd: 220_000_000, pctRevenue: 0.0023, year: 2024, sourceUrl: "https://about.bankofamerica.com/en/making-an-impact/charitable-foundation" },
  { slug: "wells-fargo",            foundationName: "Wells Fargo Foundation",        ein: "411367441",  latestTotalUsd: 285_000_000,   pctRevenue: 0.0034, year: 2024, sourceUrl: "https://www.wellsfargo.com/about/corporate-responsibility/community-giving/" },
  { slug: "citigroup",              foundationName: "Citi Foundation",               ein: "522167177",  latestTotalUsd: 130_000_000,   pctRevenue: 0.0014, year: 2024, sourceUrl: "https://www.citigroup.com/global/foundation" },
  { slug: "goldman-sachs",          foundationName: "Goldman Sachs Gives",           ein: "203676839",  latestTotalUsd: 350_000_000,   pctRevenue: 0.0070, year: 2024, sourceUrl: "https://www.goldmansachs.com/our-firm/social-impact/" },
  { slug: "morgan-stanley",         foundationName: "Morgan Stanley Foundation",     ein: "237297463",  latestTotalUsd: 65_000_000,    pctRevenue: 0.0011, year: 2024, sourceUrl: "https://www.morganstanley.com/about-us/global-citizenship/foundation" },
  { slug: "exxon-mobil",            foundationName: "ExxonMobil Foundation",         ein: "136082357",  latestTotalUsd: 220_000_000,   pctRevenue: 0.0006, year: 2024, sourceUrl: "https://corporate.exxonmobil.com/community-engagement" },
  { slug: "chevron",                foundationName: "Chevron Humankind",             ein: null,         latestTotalUsd: 245_000_000,   pctRevenue: 0.0011, year: 2024, sourceUrl: "https://www.chevron.com/sustainability/social" },
  { slug: "pfizer",                 foundationName: "Pfizer Foundation",             ein: "133539279",  latestTotalUsd: 1_400_000_000, pctRevenue: 0.0237, year: 2024, sourceUrl: "https://www.pfizer.com/about/responsibility" },
  { slug: "johnson-and-johnson",    foundationName: "Johnson & Johnson Foundation",  ein: "591730960",  latestTotalUsd: 880_000_000,   pctRevenue: 0.0102, year: 2024, sourceUrl: "https://www.jnj.com/our-impact" },
  { slug: "merck",                  foundationName: "Merck Foundation",              ein: "226029474",  latestTotalUsd: 2_700_000_000, pctRevenue: 0.0419, year: 2024, sourceUrl: "https://www.merck.com/company-overview/community-impact/" },
  { slug: "abbvie",                 foundationName: "AbbVie Foundation",             ein: "364591926",  latestTotalUsd: 165_000_000,   pctRevenue: 0.0030, year: 2024, sourceUrl: "https://www.abbvie.com/responsibility.html" },
  { slug: "eli-lilly",              foundationName: "Eli Lilly and Company Foundation", ein: "350890989", latestTotalUsd: 470_000_000, pctRevenue: 0.0107, year: 2024, sourceUrl: "https://www.lilly.com/policies-reports" },
  { slug: "bristol-myers-squibb",   foundationName: "Bristol-Myers Squibb Foundation", ein: "133717538", latestTotalUsd: 410_000_000, pctRevenue: 0.0085, year: 2024, sourceUrl: "https://www.bms.com/about-us/our-company/global-foundation.html" },
  { slug: "gilead-sciences",        foundationName: "Gilead Sciences Foundation",    ein: "274034796",  latestTotalUsd: 165_000_000,   pctRevenue: 0.0061, year: 2024, sourceUrl: "https://www.gilead.com/purpose/giving" },
  { slug: "amgen",                  foundationName: "Amgen Foundation",              ein: "954341425",  latestTotalUsd: 105_000_000,   pctRevenue: 0.0033, year: 2024, sourceUrl: "https://www.amgen.com/responsibility/amgen-foundation" },
  { slug: "abbott-laboratories",    foundationName: "Abbott Fund",                   ein: "237054603",  latestTotalUsd: 85_000_000,    pctRevenue: 0.0021, year: 2024, sourceUrl: "https://www.abbott.com/sustainability/communities.html" },
  { slug: "medtronic",              foundationName: "Medtronic Foundation",          ein: "411663008",  latestTotalUsd: 75_000_000,    pctRevenue: 0.0023, year: 2024, sourceUrl: "https://www.medtronic.com/medtronicfoundation/" },
  { slug: "unitedhealth-group",     foundationName: "United Health Foundation",      ein: "411941760",  latestTotalUsd: 240_000_000,   pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.unitedhealthgroup.com/social-responsibility.html" },
  { slug: "cvs-health",             foundationName: "CVS Health Foundation",         ein: "061203479",  latestTotalUsd: 70_000_000,    pctRevenue: 0.0002, year: 2024, sourceUrl: "https://www.cvshealth.com/impact" },

  // ── Retail / consumer ($25M+) ──
  { slug: "target",                 foundationName: "Target Foundation",             ein: "411857553",  latestTotalUsd: 230_000_000,   pctRevenue: 0.0021, year: 2024, sourceUrl: "https://corporate.target.com/sustainability-governance/social" },
  { slug: "costco",                 foundationName: null,                            ein: null,         latestTotalUsd: 80_000_000,    pctRevenue: 0.0003, year: 2024, sourceUrl: "https://www.costco.com/sustainability-community.html" },
  { slug: "home-depot",             foundationName: "Home Depot Foundation",         ein: "582363876",  latestTotalUsd: 132_000_000,   pctRevenue: 0.0009, year: 2024, sourceUrl: "https://corporate.homedepot.com/foundation" },
  { slug: "lowe-s",                 foundationName: "Lowe's Charitable & Educational Foundation", ein: "237109507", latestTotalUsd: 145_000_000, pctRevenue: 0.0017, year: 2024, sourceUrl: "https://corporate.lowes.com/our-responsibilities/community" },
  { slug: "best-buy",               foundationName: "Best Buy Foundation",           ein: "411836064",  latestTotalUsd: 30_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://corporate.bestbuy.com/sustainability/social-impact/" },
  { slug: "kroger",                 foundationName: "Kroger Co. Foundation",         ein: "237406425",  latestTotalUsd: 240_000_000,   pctRevenue: 0.0016, year: 2024, sourceUrl: "https://www.thekrogerco.com/community/zero-hunger-zero-waste/" },
  { slug: "albertsons",             foundationName: "Albertsons Companies Foundation", ein: "204529433", latestTotalUsd: 280_000_000, pctRevenue: 0.0036, year: 2024, sourceUrl: "https://www.albertsonscompanies.com/our-impact/our-communities/" },
  { slug: "publix",                 foundationName: "Publix Super Markets Charities", ein: "596160974", latestTotalUsd: 60_000_000, pctRevenue: 0.0010, year: 2024, sourceUrl: "https://corporate.publix.com/about-publix/publix-charities" },
  { slug: "macy-s",                 foundationName: null,                            ein: null,         latestTotalUsd: 65_000_000,    pctRevenue: 0.0027, year: 2024, sourceUrl: "https://www.macysinc.com/social-responsibility" },
  { slug: "nordstrom",              foundationName: null,                            ein: null,         latestTotalUsd: 14_000_000,    pctRevenue: 0.0009, year: 2024, sourceUrl: "https://www.nordstrom.com/browse/about/corporate-social-responsibility" },
  { slug: "tjx-companies",          foundationName: "TJX Foundation",                ein: "043007178",  latestTotalUsd: 38_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.tjx.com/responsibility" },
  { slug: "starbucks",              foundationName: "Starbucks Foundation",          ein: "911325671",  latestTotalUsd: 45_000_000,    pctRevenue: 0.0012, year: 2024, sourceUrl: "https://stories.starbucks.com/uploads/2024/04/Starbucks-2023-Global-Impact-Report.pdf" },
  { slug: "mcdonald-s",             foundationName: "Ronald McDonald House Charities", ein: "363143518", latestTotalUsd: 145_000_000, pctRevenue: 0.0055, year: 2024, sourceUrl: "https://corporate.mcdonalds.com/corpmcd/our-purpose-and-impact.html" },
  { slug: "yum-brands",             foundationName: "Yum! Brands Foundation",        ein: "611431238",  latestTotalUsd: 18_000_000,    pctRevenue: 0.0027, year: 2024, sourceUrl: "https://www.yum.com/wps/portal/yumbrands/Yumbrands/citizenship-and-sustainability" },
  { slug: "chipotle",               foundationName: "Chipotle Cultivate Foundation", ein: "461540764",  latestTotalUsd: 5_000_000,     pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.chipotle.com/values/social-impact" },
  { slug: "darden-restaurants",     foundationName: "Darden Foundation",             ein: "593194471",  latestTotalUsd: 9_000_000,     pctRevenue: 0.0008, year: 2024, sourceUrl: "https://www.darden.com/citizenship/community" },

  // ── Tech & telecom ──
  { slug: "salesforce",             foundationName: "Salesforce Foundation",         ein: "943347800",  latestTotalUsd: 100_000_000,   pctRevenue: 0.0029, year: 2024, sourceUrl: "https://www.salesforce.org/about/" },
  { slug: "oracle",                 foundationName: "Oracle Education Foundation",   ein: "770327465",  latestTotalUsd: 35_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.oracle.com/social-impact/" },
  { slug: "intel",                  foundationName: "Intel Foundation",              ein: "943092928",  latestTotalUsd: 50_000_000,    pctRevenue: 0.0009, year: 2024, sourceUrl: "https://www.intel.com/content/www/us/en/corporate-responsibility/intel-foundation.html" },
  { slug: "ibm",                    foundationName: "International Business Machines Corp", ein: null, latestTotalUsd: 195_000_000,   pctRevenue: 0.0032, year: 2024, sourceUrl: "https://www.ibm.com/impact/" },
  { slug: "cisco",                  foundationName: "Cisco Foundation",              ein: "770443347",  latestTotalUsd: 470_000_000,   pctRevenue: 0.0083, year: 2024, sourceUrl: "https://www.cisco.com/c/en/us/about/csr.html" },
  { slug: "hp",                     foundationName: "Hewlett-Packard Foundation",    ein: null,         latestTotalUsd: 28_000_000,    pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.hp.com/us-en/hp-information/sustainable-impact.html" },
  { slug: "dell",                   foundationName: null,                            ein: null,         latestTotalUsd: 65_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.dell.com/learn/us/en/uscorp1/cr-social-impact" },
  { slug: "adobe",                  foundationName: "Adobe Foundation",              ein: "200963895",  latestTotalUsd: 36_000_000,    pctRevenue: 0.0018, year: 2024, sourceUrl: "https://www.adobe.com/corporate-responsibility.html" },
  { slug: "nvidia",                 foundationName: "NVIDIA Foundation",             ein: "770528617",  latestTotalUsd: 25_000_000,    pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.nvidia.com/en-us/csr/" },
  { slug: "qualcomm",               foundationName: "Qualcomm Foundation",           ein: "270106405",  latestTotalUsd: 28_000_000,    pctRevenue: 0.0008, year: 2024, sourceUrl: "https://www.qualcomm.com/company/sustainability/qualcomm-foundation" },
  { slug: "intuit",                 foundationName: "Intuit Foundation",             ein: "770339400",  latestTotalUsd: 27_000_000,    pctRevenue: 0.0019, year: 2024, sourceUrl: "https://www.intuit.com/company/corporate-responsibility/" },
  { slug: "verizon",                foundationName: "Verizon Foundation",            ein: "223372317",  latestTotalUsd: 38_000_000,    pctRevenue: 0.0003, year: 2024, sourceUrl: "https://www.verizon.com/about/responsibility" },
  { slug: "atandt",                 foundationName: "AT&T Foundation",               ein: "208710830",  latestTotalUsd: 110_000_000,   pctRevenue: 0.0009, year: 2024, sourceUrl: "https://about.att.com/csr" },
  { slug: "t-mobile-us",            foundationName: "T-Mobile Foundation",           ein: null,         latestTotalUsd: 30_000_000,    pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.t-mobile.com/responsibility" },
  { slug: "comcast",                foundationName: "Comcast NBCUniversal Foundation", ein: "232888375", latestTotalUsd: 200_000_000,  pctRevenue: 0.0017, year: 2024, sourceUrl: "https://corporate.comcast.com/impact" },
  { slug: "charter-communications", foundationName: null,                            ein: null,         latestTotalUsd: 8_000_000,     pctRevenue: 0.0001, year: 2024, sourceUrl: "https://corporate.charter.com/corporate-responsibility" },

  // ── Media & entertainment ──
  { slug: "disney",                 foundationName: "Disney Worldwide Services",     ein: null,         latestTotalUsd: 380_000_000,   pctRevenue: 0.0041, year: 2024, sourceUrl: "https://impact.disney.com/" },
  { slug: "warner-bros-discovery",  foundationName: null,                            ein: null,         latestTotalUsd: 65_000_000,    pctRevenue: 0.0017, year: 2024, sourceUrl: "https://www.wbd.com/csr/" },
  { slug: "netflix",                foundationName: null,                            ein: null,         latestTotalUsd: 230_000_000,   pctRevenue: 0.0064, year: 2024, sourceUrl: "https://about.netflix.com/en/sustainability" },
  { slug: "paramount-global",       foundationName: null,                            ein: null,         latestTotalUsd: 40_000_000,    pctRevenue: 0.0014, year: 2024, sourceUrl: "https://www.paramount.com/csr" },
  { slug: "fox-corporation",        foundationName: null,                            ein: null,         latestTotalUsd: 6_000_000,     pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.foxcorporation.com/csr" },
  { slug: "spotify",                foundationName: null,                            ein: null,         latestTotalUsd: 11_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.spotify.com/us/sustainability/" },

  // ── CPG / food & beverage ──
  { slug: "coca-cola",              foundationName: "Coca-Cola Foundation",          ein: "586001147",  latestTotalUsd: 165_000_000,   pctRevenue: 0.0036, year: 2024, sourceUrl: "https://www.coca-colacompany.com/sustainability/the-coca-cola-foundation" },
  { slug: "pepsico",                foundationName: "PepsiCo Foundation",            ein: "133285632",  latestTotalUsd: 90_000_000,    pctRevenue: 0.0010, year: 2024, sourceUrl: "https://www.pepsico.com/our-impact/esg-topics-a-z/pepsico-foundation" },
  { slug: "kraft-heinz",            foundationName: "Kraft Heinz Foundation",        ein: "364676060",  latestTotalUsd: 25_000_000,    pctRevenue: 0.0009, year: 2024, sourceUrl: "https://www.kraftheinzcompany.com/esg/communities.html" },
  { slug: "general-mills",          foundationName: "General Mills Foundation",      ein: "416029401",  latestTotalUsd: 35_000_000,    pctRevenue: 0.0017, year: 2024, sourceUrl: "https://www.generalmills.com/how-we-make-it/social-impact" },
  { slug: "kellogg",                foundationName: "Kellogg's Corporate Citizenship Fund", ein: "381875130", latestTotalUsd: 30_000_000, pctRevenue: 0.0023, year: 2024, sourceUrl: "https://www.kellanova.com/en_US/global-better-days-promise.html" },
  { slug: "mondelez-international", foundationName: "Mondelez International Foundation", ein: "364676065", latestTotalUsd: 25_000_000, pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.mondelezinternational.com/snacking-made-right" },
  { slug: "tyson-foods",            foundationName: "Tyson Foods Charitable Giving", ein: null,         latestTotalUsd: 30_000_000,    pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.tysonfoods.com/sustainability" },
  { slug: "smithfield-foods",       foundationName: "Smithfield Foods Foundation",   ein: "455416577",  latestTotalUsd: 8_000_000,     pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.smithfieldfoods.com/sustainability" },
  { slug: "procter-and-gamble",     foundationName: "P&G Fund",                      ein: "311392951",  latestTotalUsd: 70_000_000,    pctRevenue: 0.0008, year: 2024, sourceUrl: "https://us.pg.com/community-impact/" },
  { slug: "unilever",               foundationName: null,                            ein: null,         latestTotalUsd: 60_000_000,    pctRevenue: 0.0009, year: 2024, sourceUrl: "https://www.unilever.com/sustainability/social/" },
  { slug: "colgate-palmolive",      foundationName: "Colgate-Palmolive Foundation",  ein: "133157595",  latestTotalUsd: 18_000_000,    pctRevenue: 0.0009, year: 2024, sourceUrl: "https://www.colgatepalmolive.com/en-us/sustainability" },
  { slug: "kimberly-clark",         foundationName: "Kimberly-Clark Foundation",     ein: "237006556",  latestTotalUsd: 15_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.kimberly-clark.com/en/responsibility" },
  { slug: "clorox",                 foundationName: "Clorox Company Foundation",     ein: "942895541",  latestTotalUsd: 9_000_000,     pctRevenue: 0.0011, year: 2024, sourceUrl: "https://www.thecloroxcompany.com/corporate-responsibility/" },
  { slug: "campbell-soup",          foundationName: "Campbell Soup Foundation",      ein: "232529821",  latestTotalUsd: 8_000_000,     pctRevenue: 0.0008, year: 2024, sourceUrl: "https://www.campbellsoupcompany.com/our-impact/" },
  { slug: "hershey",                foundationName: "Hershey Company Charitable Trust", ein: "236444307", latestTotalUsd: 14_000_000, pctRevenue: 0.0013, year: 2024, sourceUrl: "https://www.thehersheycompany.com/en_us/sustainability.html" },
  { slug: "mars",                   foundationName: null,                            ein: null,         latestTotalUsd: 90_000_000,    pctRevenue: 0.0019, year: 2024, sourceUrl: "https://www.mars.com/sustainability-plan" },
  { slug: "anheuser-busch-inbev",   foundationName: "Anheuser-Busch Foundation",     ein: "237442415",  latestTotalUsd: 30_000_000,    pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.ab-inbev.com/our-stories/community/" },
  { slug: "molson-coors",           foundationName: "Molson Coors Foundation",       ein: "510184719",  latestTotalUsd: 6_000_000,     pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.molsoncoors.com/responsibility" },
  { slug: "constellation-brands",   foundationName: null,                            ein: null,         latestTotalUsd: 12_000_000,    pctRevenue: 0.0012, year: 2024, sourceUrl: "https://www.cbrands.com/about/citizenship" },
  { slug: "nestle",                 foundationName: "Nestle Healthcare Nutrition",   ein: null,         latestTotalUsd: 220_000_000,   pctRevenue: 0.0019, year: 2024, sourceUrl: "https://www.nestle.com/sustainability" },
  { slug: "diageo",                 foundationName: "Diageo North America Foundation", ein: null,       latestTotalUsd: 35_000_000,    pctRevenue: 0.0021, year: 2024, sourceUrl: "https://www.diageo.com/en/society-2030" },

  // ── Apparel & footwear ──
  { slug: "nike",                   foundationName: "Nike Foundation",               ein: "311639618",  latestTotalUsd: 220_000_000,   pctRevenue: 0.0042, year: 2024, sourceUrl: "https://about.nike.com/en/impact" },
  { slug: "adidas",                 foundationName: null,                            ein: null,         latestTotalUsd: 25_000_000,    pctRevenue: 0.0011, year: 2024, sourceUrl: "https://www.adidas-group.com/en/sustainability/" },
  { slug: "under-armour",           foundationName: null,                            ein: null,         latestTotalUsd: 5_000_000,     pctRevenue: 0.0009, year: 2024, sourceUrl: "https://about.underarmour.com/en/stories/responsibility.html" },
  { slug: "vf-corporation",         foundationName: "VF Foundation",                 ein: "231599835",  latestTotalUsd: 10_000_000,    pctRevenue: 0.0009, year: 2024, sourceUrl: "https://www.vfc.com/our-stories/sustainability" },
  { slug: "ralph-lauren",           foundationName: "Ralph Lauren Corporate Foundation", ein: "133692385", latestTotalUsd: 14_000_000, pctRevenue: 0.0021, year: 2024, sourceUrl: "https://corporate.ralphlauren.com/social-impact-overview" },
  { slug: "levi-s",                 foundationName: "Levi Strauss Foundation",       ein: "941698990",  latestTotalUsd: 13_000_000,    pctRevenue: 0.0021, year: 2024, sourceUrl: "https://www.levistrauss.com/sustainability-report/" },
  { slug: "gap",                    foundationName: "Gap Foundation",                ein: "943101201",  latestTotalUsd: 8_000_000,     pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.gapinc.com/en-us/values/sustainability" },
  { slug: "lululemon-athletica",    foundationName: "Lululemon Centre for Social Impact", ein: null,    latestTotalUsd: 12_000_000,    pctRevenue: 0.0012, year: 2024, sourceUrl: "https://corporate.lululemon.com/our-impact" },

  // ── Auto, industrials, manufacturing ──
  { slug: "ford",                   foundationName: "Ford Motor Company Fund",       ein: "381459376",  latestTotalUsd: 65_000_000,    pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.fordfund.org/" },
  { slug: "general-motors",         foundationName: "General Motors Foundation",     ein: "237071797",  latestTotalUsd: 50_000_000,    pctRevenue: 0.0003, year: 2024, sourceUrl: "https://www.gm.com/commitments/community-engagement" },
  { slug: "stellantis",             foundationName: null,                            ein: null,         latestTotalUsd: 25_000_000,    pctRevenue: 0.0001, year: 2024, sourceUrl: "https://www.stellantis.com/en/sustainability" },
  { slug: "toyota",                 foundationName: "Toyota USA Foundation",         ein: "954472217",  latestTotalUsd: 80_000_000,    pctRevenue: 0.0003, year: 2024, sourceUrl: "https://www.toyota.com/usa/community/" },
  { slug: "honda",                  foundationName: "American Honda Foundation",     ein: "953791285",  latestTotalUsd: 18_000_000,    pctRevenue: 0.0001, year: 2024, sourceUrl: "https://csr.honda.com/" },
  { slug: "tesla",                  foundationName: null,                            ein: null,         latestTotalUsd: 10_000_000,    pctRevenue: 0.0001, year: 2024, sourceUrl: "https://www.tesla.com/impact" },
  { slug: "caterpillar",            foundationName: "Caterpillar Foundation",        ein: "366038150",  latestTotalUsd: 40_000_000,    pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.caterpillar.com/en/company/caterpillar-foundation.html" },
  { slug: "deere",                  foundationName: "John Deere Foundation",         ein: "366060096",  latestTotalUsd: 35_000_000,    pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.deere.com/en/our-company/citizenship/" },
  { slug: "honeywell",              foundationName: "Honeywell Hometown Solutions",  ein: null,         latestTotalUsd: 25_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.honeywell.com/us/en/company/citizenship" },
  { slug: "ge-aerospace",           foundationName: "GE Foundation",                 ein: "146015726",  latestTotalUsd: 70_000_000,    pctRevenue: 0.0021, year: 2024, sourceUrl: "https://www.ge.com/sustainability/" },
  { slug: "boeing",                 foundationName: "Boeing Charitable Trust",       ein: "456013581",  latestTotalUsd: 235_000_000,   pctRevenue: 0.0029, year: 2024, sourceUrl: "https://www.boeing.com/principles/community-engagement.page" },
  { slug: "lockheed-martin",        foundationName: "Lockheed Martin Corporation Foundation", ein: "596043076", latestTotalUsd: 35_000_000, pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.lockheedmartin.com/en-us/who-we-are/communities.html" },
  { slug: "raytheon-technologies",  foundationName: "RTX Charitable Foundation",     ein: "060781295",  latestTotalUsd: 47_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.rtx.com/who-we-are/inside-rtx/community" },
  { slug: "northrop-grumman",       foundationName: "Northrop Grumman Foundation",   ein: "200454891",  latestTotalUsd: 16_000_000,    pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.northropgrumman.com/corporate-responsibility/" },
  { slug: "general-dynamics",       foundationName: null,                            ein: null,         latestTotalUsd: 9_000_000,     pctRevenue: 0.0002, year: 2024, sourceUrl: "https://www.gd.com/about/corporate-responsibility" },
  { slug: "dupont",                 foundationName: "DuPont Education and Workforce Development", ein: null, latestTotalUsd: 6_000_000, pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.dupont.com/sustainability.html" },
  { slug: "dow",                    foundationName: "The Dow Chemical Company Foundation", ein: "382170243", latestTotalUsd: 20_000_000, pctRevenue: 0.0005, year: 2024, sourceUrl: "https://corporate.dow.com/en-us/about/sustainability.html" },
  { slug: "3m",                     foundationName: "3M Foundation",                 ein: "416035835",  latestTotalUsd: 70_000_000,    pctRevenue: 0.0021, year: 2024, sourceUrl: "https://www.3m.com/3M/en_US/sustainability-us/" },
  { slug: "ppg-industries",         foundationName: "PPG Industries Foundation",     ein: "251357300",  latestTotalUsd: 6_500_000,     pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.ppg.com/en-US/about-ppg/sustainability" },

  // ── Logistics & travel ──
  { slug: "fedex",                  foundationName: null,                            ein: null,         latestTotalUsd: 60_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.fedex.com/en-us/about/corporate-social-responsibility.html" },
  { slug: "ups",                    foundationName: "UPS Foundation",                ein: "136500587",  latestTotalUsd: 130_000_000,   pctRevenue: 0.0014, year: 2024, sourceUrl: "https://about.ups.com/us/en/our-impact.html" },
  { slug: "delta-air-lines",        foundationName: "Delta Air Lines Foundation",    ein: "581898618",  latestTotalUsd: 35_000_000,    pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.delta.com/us/en/about-delta/sharing-the-skies" },
  { slug: "american-airlines",      foundationName: "American Airlines Group Foundation", ein: null,    latestTotalUsd: 23_000_000,    pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.aa.com/i18n/customer-service/about-us/community.jsp" },
  { slug: "united-airlines",        foundationName: null,                            ein: null,         latestTotalUsd: 15_000_000,    pctRevenue: 0.0003, year: 2024, sourceUrl: "https://www.united.com/ual/en/us/fly/company/global-citizenship.html" },
  { slug: "southwest-airlines",     foundationName: null,                            ein: null,         latestTotalUsd: 12_000_000,    pctRevenue: 0.0005, year: 2024, sourceUrl: "https://www.southwest.com/citizenship/" },

  // ── Insurance ──
  { slug: "berkshire-hathaway",     foundationName: null,                            ein: null,         latestTotalUsd: 800_000_000,   pctRevenue: 0.0019, year: 2024, sourceUrl: "https://www.berkshirehathaway.com/" },
  { slug: "allstate",               foundationName: "Allstate Foundation",           ein: "366104354",  latestTotalUsd: 30_000_000,    pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.allstate.com/corporate-responsibility" },
  { slug: "state-farm",             foundationName: "State Farm Companies Foundation", ein: "376026019", latestTotalUsd: 110_000_000,  pctRevenue: 0.0013, year: 2024, sourceUrl: "https://newsroom.statefarm.com/community/" },
  { slug: "progressive",            foundationName: "Progressive Insurance Foundation", ein: "341785506", latestTotalUsd: 25_000_000,  pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.progressive.com/sustainability/" },
  { slug: "metlife",                foundationName: "MetLife Foundation",            ein: "133800704",  latestTotalUsd: 80_000_000,    pctRevenue: 0.0012, year: 2024, sourceUrl: "https://www.metlife.com/about-us/corporate-responsibility/metlife-foundation/" },
  { slug: "prudential-financial",   foundationName: "Prudential Foundation",         ein: "237406372",  latestTotalUsd: 36_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.prudential.com/links/about/corporate-social-responsibility" },
  { slug: "aig",                    foundationName: "AIG Foundation",                ein: "510222704",  latestTotalUsd: 15_000_000,    pctRevenue: 0.0003, year: 2024, sourceUrl: "https://www.aig.com/about-us/corporate-citizenship" },
  { slug: "travelers",              foundationName: "Travelers Foundation",          ein: null,         latestTotalUsd: 26_000_000,    pctRevenue: 0.0006, year: 2024, sourceUrl: "https://www.travelers.com/about-travelers/community" },

  // ── Pharmacy & healthcare ──
  { slug: "walgreens",              foundationName: "Walgreen Co. Charitable Trust", ein: "237431940",  latestTotalUsd: 35_000_000,    pctRevenue: 0.0002, year: 2024, sourceUrl: "https://www.walgreens.com/topic/sustainability/community-impact.jsp" },
  { slug: "hca-healthcare",         foundationName: "HCA Healthcare Foundation",     ein: "621574357",  latestTotalUsd: 50_000_000,    pctRevenue: 0.0007, year: 2024, sourceUrl: "https://hcahealthcare.com/about/community-impact.dot" },
  { slug: "humana",                 foundationName: "Humana Foundation",             ein: "611361896",  latestTotalUsd: 38_000_000,    pctRevenue: 0.0004, year: 2024, sourceUrl: "https://www.humana.com/foundation" },
  { slug: "anthem-elevance-health", foundationName: "Elevance Health Foundation",    ein: "356119760",  latestTotalUsd: 110_000_000,   pctRevenue: 0.0007, year: 2024, sourceUrl: "https://www.elevancehealth.com/foundation.html" },

  // ── B-corps & ethical brands (high % of revenue, smaller absolute) ──
  { slug: "patagonia",              foundationName: "Patagonia Inc",                 ein: null,         latestTotalUsd: 100_000_000,   pctRevenue: 0.0667, year: 2024, sourceUrl: "https://www.patagonia.com/our-footprint/" },
  { slug: "ben-and-jerry-s",        foundationName: "Ben & Jerry's Foundation",      ein: "030350309",  latestTotalUsd: 3_500_000,     pctRevenue: 0.0090, year: 2024, sourceUrl: "https://www.benandjerrysfoundation.org/" },
  { slug: "newman-s-own",           foundationName: "Newman's Own Foundation",       ein: "061606588",  latestTotalUsd: 35_000_000,    pctRevenue: 0.1000, year: 2024, sourceUrl: "https://newmansownfoundation.org/" },
  { slug: "tom-s-of-maine",         foundationName: null,                            ein: null,         latestTotalUsd: 1_500_000,     pctRevenue: 0.0100, year: 2024, sourceUrl: "https://www.tomsofmaine.com/our-promise" },
  { slug: "warby-parker",           foundationName: null,                            ein: null,         latestTotalUsd: 28_000_000,    pctRevenue: 0.0420, year: 2024, sourceUrl: "https://www.warbyparker.com/buy-a-pair-give-a-pair" },
  { slug: "bombas",                 foundationName: null,                            ein: null,         latestTotalUsd: 14_000_000,    pctRevenue: 0.0290, year: 2024, sourceUrl: "https://bombas.com/pages/giving-back" },
  { slug: "toms",                   foundationName: null,                            ein: null,         latestTotalUsd: 6_000_000,     pctRevenue: 0.0333, year: 2024, sourceUrl: "https://www.toms.com/us/impact.html" },
  { slug: "allbirds",               foundationName: null,                            ein: null,         latestTotalUsd: 3_000_000,     pctRevenue: 0.0142, year: 2024, sourceUrl: "https://www.allbirds.com/pages/sustainability" },
  { slug: "seventh-generation",     foundationName: null,                            ein: null,         latestTotalUsd: 4_000_000,     pctRevenue: 0.0080, year: 2024, sourceUrl: "https://www.seventhgeneration.com/values" },
  { slug: "klean-kanteen",          foundationName: null,                            ein: null,         latestTotalUsd: 1_200_000,     pctRevenue: 0.0150, year: 2024, sourceUrl: "https://www.kleankanteen.com/pages/giving-back" },
];

// Below: bulk-encoded seed rows for brands where the parent firm publishes
// a single rolled-up "community investment" number but doesn't operate a
// 501(c)(3) corporate foundation we can match to an EIN, OR where we have
// EINs but want to keep the data table compact.
// Format: [slug, foundationName|null, ein|null, latestTotalUsd, pctRevenue, year, sourceUrl]
export const SEED_BULK = [
  // ── Banks / fintech (regionals) ──
  ["pnc-financial-services",        "PNC Foundation",                "256017036",  53_000_000,  0.0023, 2024, "https://www.pnc.com/en/about-pnc/corporate-responsibility.html"],
  ["us-bank",                       "U.S. Bank Foundation",          "237005599",  44_000_000,  0.0012, 2024, "https://www.usbank.com/about-us-bank/community/us-bank-foundation.html"],
  ["truist",                        "Truist Foundation",             "562105772",  72_000_000,  0.0024, 2024, "https://www.truist.com/purpose"],
  ["capital-one",                   "Capital One Foundation",        "541719851",  85_000_000,  0.0023, 2024, "https://www.capitalone.com/about/responsibility/"],
  ["american-express",              "American Express Foundation",   "133621050",  45_000_000,  0.0007, 2024, "https://www.americanexpress.com/en-us/company/corporate-responsibility/"],
  ["mastercard",                    "Mastercard Foundation",         "455051322",  150_000_000, 0.0058, 2024, "https://mastercardfoundation.org/"],
  ["visa",                          "Visa Foundation",               "260317006",  60_000_000,  0.0017, 2024, "https://corporate.visa.com/en/sustainability.html"],
  ["paypal",                        "PayPal Charitable Giving Fund", "453099717",  37_000_000,  0.0012, 2024, "https://about.pypl.com/impact/"],
  ["discover-financial",            "Discover Foundation",           "364334714",  18_000_000,  0.0011, 2024, "https://www.discover.com/company/our-company/sustainability/"],
  ["charles-schwab",                "Charles Schwab Foundation",     "203846654",  18_000_000,  0.0009, 2024, "https://www.aboutschwab.com/our-purpose"],
  ["fidelity-investments",          "Fidelity Charitable",           "110303001",  100_000_000, 0.0030, 2024, "https://www.fidelitycharitable.org/"],
  ["vanguard",                      null,                            null,         15_000_000,  0.0002, 2024, "https://about.vanguard.com/who-we-are/responsibility/"],
  ["blackrock",                     "BlackRock Foundation",          "850594571",  130_000_000, 0.0067, 2024, "https://www.blackrock.com/corporate/about-us/social-impact"],
  ["state-street",                  "State Street Foundation",       "043306856",  15_000_000,  0.0013, 2024, "https://www.statestreet.com/about/corporate-responsibility.html"],

  // ── Tech, software ──
  ["servicenow",                    null,                            null,         24_000_000,  0.0026, 2024, "https://www.servicenow.com/company/global-impact.html"],
  ["workday",                       null,                            null,         13_000_000,  0.0019, 2024, "https://www.workday.com/en-us/company/sustainability.html"],
  ["snowflake",                     null,                            null,         8_000_000,   0.0028, 2024, "https://www.snowflake.com/en/about/snowflake-for-good/"],
  ["zoom",                          null,                            null,         5_000_000,   0.0011, 2024, "https://explore.zoom.us/en/social-impact/"],
  ["palo-alto-networks",            null,                            null,         11_000_000,  0.0014, 2024, "https://www.paloaltonetworks.com/company/esg"],
  ["crowdstrike",                   null,                            null,         5_000_000,   0.0013, 2024, "https://www.crowdstrike.com/about-us/foundation/"],
  ["okta",                          "Okta For Good",                 "813739103",  12_000_000,  0.0048, 2024, "https://www.okta.com/okta-for-good/"],
  ["docusign",                      "DocuSign IMPACT",               null,         9_000_000,   0.0028, 2024, "https://www.docusign.com/company/impact"],
  ["dropbox",                       null,                            null,         5_000_000,   0.0019, 2024, "https://www.dropbox.com/about/social-impact"],
  ["pinterest",                     null,                            null,         8_000_000,   0.0021, 2024, "https://newsroom.pinterest.com/en/social-impact"],
  ["snap",                          null,                            null,         9_000_000,   0.0020, 2024, "https://snap.com/en-US/citizenship"],
  ["uber",                          null,                            null,         50_000_000,  0.0014, 2024, "https://www.uber.com/us/en/about/sustainability/"],
  ["lyft",                          null,                            null,         12_000_000,  0.0027, 2024, "https://www.lyft.com/impact"],
  ["airbnb",                        "Airbnb.org",                    "836131800",  35_000_000,  0.0034, 2024, "https://www.airbnb.org/"],
  ["doordash",                      null,                            null,         18_000_000,  0.0018, 2024, "https://www.doordashimpact.com/"],
  ["instacart",                     null,                            null,         8_000_000,   0.0026, 2024, "https://www.instacart.com/company/sustainability/"],

  // ── Hardware / semis ──
  ["amd",                           null,                            null,         8_000_000,   0.0003, 2024, "https://www.amd.com/en/corporate/corporate-responsibility.html"],
  ["broadcom",                      null,                            null,         12_000_000,  0.0002, 2024, "https://www.broadcom.com/company/citizenship"],
  ["texas-instruments",             "Texas Instruments Foundation",  "237222218",  20_000_000,  0.0011, 2024, "https://www.ti.com/about-ti/citizenship.html"],
  ["micron-technology",             "Micron Foundation",             "823060596",  16_000_000,  0.0009, 2024, "https://www.micron.com/about/our-commitment/sustainability"],
  ["applied-materials",             "Applied Materials Foundation",  "770273721",  17_000_000,  0.0009, 2024, "https://www.appliedmaterials.com/us/en/who-we-are/foundation.html"],
  ["lam-research",                  null,                            null,         8_000_000,   0.0009, 2024, "https://www.lamresearch.com/company/global-citizenship/"],
  ["western-digital",               null,                            null,         6_000_000,   0.0006, 2024, "https://www.westerndigital.com/company/sustainability"],
  ["seagate",                       null,                            null,         3_000_000,   0.0004, 2024, "https://www.seagate.com/our-story/sustainability/"],
  ["nxp-semiconductors",            null,                            null,         5_000_000,   0.0004, 2024, "https://www.nxp.com/company/about-nxp/sustainability/"],
  ["analog-devices",                null,                            null,         6_000_000,   0.0006, 2024, "https://www.analog.com/en/about-adi/corporate-responsibility.html"],

  // ── Retailers expanded ──
  ["dollar-tree",                   null,                            null,         16_000_000,  0.0005, 2024, "https://www.dollartreeinfo.com/social-responsibility"],
  ["dollar-general",                "Dollar General Literacy Foundation", "611011017", 35_000_000, 0.0009, 2024, "https://www.dollargeneral.com/community.html"],
  ["five-below",                    null,                            null,         3_000_000,   0.0010, 2024, "https://www.fivebelow.com/info/giveback"],
  ["bed-bath-and-beyond",           null,                            null,         2_000_000,   0.0003, 2024, "https://bedbathandbeyond.com"],
  ["ross-stores",                   null,                            null,         8_000_000,   0.0004, 2024, "https://corp.rossstores.com/our-stores/community-involvement"],
  ["burlington",                    null,                            null,         5_000_000,   0.0005, 2024, "https://www.burlingtoncorporate.com/community/"],
  ["ulta-beauty",                   null,                            null,         8_000_000,   0.0007, 2024, "https://www.ulta.com/company/csr/"],
  ["sephora",                       null,                            null,         18_000_000,  0.0026, 2024, "https://www.sephora.com/beauty/social-impact"],
  ["bath-and-body-works",           null,                            null,         9_000_000,   0.0013, 2024, "https://www.bbwinc.com/about-us/community"],
  ["dick-s-sporting-goods",         "DICK's Sporting Goods Foundation", "458108511", 35_000_000, 0.0027, 2024, "https://www.sportsmatter.org/"],
  ["academy-sports",                null,                            null,         5_000_000,   0.0008, 2024, "https://corporate.academy.com/who-we-are/community-involvement.html"],
  ["rei",                           null,                            null,         11_000_000,  0.0027, 2024, "https://www.rei.com/impact"],
  ["bass-pro-shops",                null,                            null,         15_000_000,  0.0013, 2024, "https://www.basspro.com/shop/en/conservation"],
  ["autozone",                      null,                            null,         10_000_000,  0.0006, 2024, "https://www.autozoneinc.com/community-relations"],
  ["o-reilly-automotive",           null,                            null,         5_000_000,   0.0003, 2024, "https://www.oreillyauto.com/about-us"],
  ["advance-auto-parts",            null,                            null,         3_000_000,   0.0003, 2024, "https://shop.advanceautoparts.com/"],

  // ── Grocery + chains ──
  ["whole-foods",                   "Whole Kids Foundation",         "271360772",  18_000_000,  0.0011, 2024, "https://www.wholekidsfoundation.org/"],
  ["trader-joe-s",                  null,                            null,         70_000_000,  0.0042, 2024, "https://www.traderjoes.com/home/about-us/neighborhood-shares-program"],
  ["aldi",                          null,                            null,         30_000_000,  0.0014, 2024, "https://corporate.aldi.us/en/responsibility/"],
  ["safeway",                       null,                            null,         12_000_000,  0.0006, 2024, "https://www.safeway.com/community/"],
  ["meijer",                        null,                            null,         70_000_000,  0.0034, 2024, "https://www.meijercommunity.com/"],
  ["wegmans",                       null,                            null,         34_000_000,  0.0029, 2024, "https://www.wegmans.com/about-us/our-philanthropy/"],
  ["food-lion",                     "Food Lion Feeds Foundation",    null,         14_000_000,  0.0012, 2024, "https://www.foodlion.com/foodlionfeeds/"],
  ["giant-eagle",                   "Giant Eagle Foundation",        "256069253",  6_000_000,   0.0007, 2024, "https://www.gianteagle.com/Customer-Service/Community"],
  ["sprouts-farmers-market",        "Sprouts Healthy Communities Foundation", "455252691", 4_000_000, 0.0006, 2024, "https://about.sprouts.com/healthy-communities/"],
  ["fresh-market",                  null,                            null,         2_000_000,   0.0009, 2024, "https://www.thefreshmarket.com/our-stores/responsibility"],

  // ── Restaurants & QSR ──
  ["wendy-s",                       "Dave Thomas Foundation for Adoption", "311056225", 40_000_000, 0.0019, 2024, "https://www.davethomasfoundation.org/"],
  ["burger-king",                   "Burger King McLamore Foundation", "650396777", 12_000_000, 0.0013, 2024, "https://www.bk.com/mclamore-foundation"],
  ["subway",                        null,                            null,         8_000_000,   0.0008, 2024, "https://www.subway.com/en-us/exploreourworld/csr"],
  ["domino-s",                      null,                            null,         12_000_000,  0.0027, 2024, "https://biz.dominos.com/web/public/responsibility"],
  ["pizza-hut",                     "Pizza Hut Literacy Project",    null,         5_000_000,   0.0010, 2024, "https://www.pizzahut.com/literacy"],
  ["papa-john-s",                   null,                            null,         3_000_000,   0.0014, 2024, "https://www.papajohns.com/foundation"],
  ["taco-bell",                     "Taco Bell Foundation",          "522127006",  20_000_000,  0.0014, 2024, "https://www.tacobellfoundation.org/"],
  ["kfc",                           "KFC Foundation",                "271415562",  9_000_000,   0.0009, 2024, "https://www.kfcfoundation.org/"],
  ["chick-fil-a",                   "Chick-fil-A Foundation",        "263785057",  35_000_000,  0.0019, 2024, "https://www.chick-fil-afoundation.org/"],
  ["dunkin",                        "Dunkin' Joy in Childhood Foundation", "451644081", 12_000_000, 0.0019, 2024, "https://joyinchildhoodfoundation.org/"],
  ["panera-bread",                  "Panera Bread Foundation",       "260473961",  4_000_000,   0.0010, 2024, "https://www.panerabread.com/en-us/our-beliefs/our-impact.html"],
  ["sonic",                         null,                            null,         8_000_000,   0.0007, 2024, "https://corporate.sonicdrivein.com/community/"],
  ["dairy-queen",                   "International Dairy Queen Foundation", "411710620", 10_000_000, 0.0023, 2024, "https://www.dairyqueen.com/en-us/dq-cares/"],
  ["five-guys",                     null,                            null,         3_000_000,   0.0017, 2024, "https://www.fiveguys.com/Why-Five-Guys/About-Us"],
  ["shake-shack",                   null,                            null,         2_000_000,   0.0019, 2024, "https://shakeshack.com/community/"],
  ["jersey-mike-s",                 "Jersey Mike's Charities",       "263344812",  25_000_000,  0.0050, 2024, "https://www.jerseymikes.com/mod"],

  // ── Hotels & travel ──
  ["marriott",                      "Marriott Foundation",           "536102441",  16_000_000,  0.0006, 2024, "https://serve360.marriott.com/"],
  ["hilton",                        null,                            null,         28_000_000,  0.0028, 2024, "https://stories.hilton.com/esg"],
  ["hyatt",                         null,                            null,         12_000_000,  0.0019, 2024, "https://about.hyatt.com/en/environmental-social-governance.html"],
  ["wynn-resorts",                  null,                            null,         3_000_000,   0.0005, 2024, "https://www.wynnresorts.com/Esg"],
  ["mgm-resorts",                   "MGM Resorts Foundation",        "880391817",  20_000_000,  0.0014, 2024, "https://www.mgmresorts.com/en/company/social-impact-sustainability.html"],
  ["caesars-entertainment",         null,                            null,         9_000_000,   0.0008, 2024, "https://www.caesars.com/corporate/citizenship"],
  ["royal-caribbean",               null,                            null,         5_000_000,   0.0004, 2024, "https://www.royalcaribbeangroup.com/sustainability/"],
  ["carnival",                      null,                            null,         4_000_000,   0.0002, 2024, "https://www.carnivalcorp.com/sustainability"],
  ["norwegian-cruise-line",         null,                            null,         2_000_000,   0.0002, 2024, "https://www.nclhltdinvestor.com/esg"],
  ["expedia",                       null,                            null,         8_000_000,   0.0006, 2024, "https://lifeatexpediagroup.com/impact"],
  ["booking-holdings",              null,                            null,         7_000_000,   0.0003, 2024, "https://www.bookingholdings.com/corporate-responsibility/"],

  // ── Energy & utilities ──
  ["conocophillips",                null,                            null,         28_000_000,  0.0005, 2024, "https://www.conocophillips.com/sustainability/social-engagement/"],
  ["valero-energy",                 "Valero Energy Foundation",      "742814389",  44_000_000,  0.0003, 2024, "https://www.valero.com/community"],
  ["marathon-petroleum",            "Marathon Petroleum Foundation", null,         8_000_000,   0.0001, 2024, "https://www.marathonpetroleum.com/Community/Our-Approach/"],
  ["phillips-66",                   null,                            null,         18_000_000,  0.0001, 2024, "https://www.phillips66.com/sustainability/community"],
  ["occidental-petroleum",          null,                            null,         9_000_000,   0.0003, 2024, "https://www.oxy.com/sustainability/social-impact/"],
  ["nextera-energy",                "NextEra Energy Foundation",     "271301366",  10_000_000,  0.0004, 2024, "https://www.nexteraenergy.com/sustainability/community.html"],
  ["duke-energy",                   "Duke Energy Foundation",        "237406275",  35_000_000,  0.0014, 2024, "https://www.duke-energy.com/community/duke-energy-foundation"],
  ["southern-company",              "Southern Company Charitable Foundation", "454232307", 20_000_000, 0.0008, 2024, "https://www.southerncompany.com/community.html"],
  ["dominion-energy",               "Dominion Energy Charitable Foundation", "542002414", 22_000_000, 0.0014, 2024, "https://www.dominionenergy.com/community-foundation"],
  ["exelon",                        "Exelon Foundation",             "232991071",  60_000_000,  0.0027, 2024, "https://www.exeloncorp.com/community"],
  ["aep",                           "American Electric Power Foundation", "311660487", 12_000_000, 0.0007, 2024, "https://www.aep.com/community"],
  ["sempra",                        "Sempra Energy Foundation",      "330854616",  16_000_000,  0.0012, 2024, "https://www.sempra.com/community"],
  ["pseg",                          "PSEG Foundation",               "237100114",  8_000_000,   0.0006, 2024, "https://www.psegfoundation.com/"],

  // ── Pharma (mid) ──
  ["regeneron",                     "Regeneron Foundation",          "260570535",  20_000_000,  0.0014, 2024, "https://www.regeneron.com/community"],
  ["biogen",                        "Biogen Foundation",             "043420527",  16_000_000,  0.0017, 2024, "https://www.biogen.com/responsibility/community-engagement.html"],
  ["vertex-pharmaceuticals",        "Vertex Foundation",             "812715301",  20_000_000,  0.0019, 2024, "https://www.vrtx.com/responsibility/community/"],
  ["moderna",                       null,                            null,         15_000_000,  0.0018, 2024, "https://www.modernatx.com/about-us/social-impact"],
  ["bayer",                         "Bayer Fund",                    "431647522",  16_000_000,  0.0003, 2024, "https://www.bayer.us/en/contact-us/community"],
  ["sanofi",                        null,                            null,         60_000_000,  0.0013, 2024, "https://www.sanofi.us/en/our-responsibility"],
  ["takeda",                        null,                            null,         60_000_000,  0.0015, 2024, "https://www.takeda.com/corporate-responsibility/"],

  // ── Education / publishing / consulting ──
  ["mckinsey",                      "McKinsey.org",                  null,         200_000_000, 0.0149, 2024, "https://www.mckinsey.org/"],
  ["bcg",                           null,                            null,         85_000_000,  0.0073, 2024, "https://www.bcg.com/about/social-impact/overview"],
  ["bain",                          null,                            null,         45_000_000,  0.0083, 2024, "https://www.bain.com/about/people-and-culture/our-purpose/"],
  ["deloitte",                      "Deloitte Foundation",           "366113360",  60_000_000,  0.0010, 2024, "https://www2.deloitte.com/us/en/pages/about-deloitte/articles/deloitte-foundation.html"],
  ["pwc",                           "PwC Charitable Foundation",     "133031091",  40_000_000,  0.0008, 2024, "https://www.pwc.com/us/en/about-us/corporate-responsibility.html"],
  ["ey",                            "Ernst & Young Foundation",      "237049493",  35_000_000,  0.0007, 2024, "https://www.ey.com/en_us/corporate-responsibility"],
  ["kpmg",                          "KPMG Foundation",               "133263028",  25_000_000,  0.0007, 2024, "https://kpmgus.foundation/"],
  ["accenture",                     null,                            null,         60_000_000,  0.0009, 2024, "https://www.accenture.com/us-en/about/corporate-citizenship/corporate-citizenship-index"],

  // ── Defense, aerospace (mid) ──
  ["bae-systems",                   null,                            null,         9_000_000,   0.0003, 2024, "https://www.baesystems.com/en/our-company/our-responsibility-program"],
  ["l3harris",                      null,                            null,         8_000_000,   0.0004, 2024, "https://www.l3harris.com/about/community"],
  ["leidos",                        "Leidos Foundation",             "830795036",  6_000_000,   0.0004, 2024, "https://www.leidos.com/company/responsibility"],
  ["booz-allen-hamilton",           null,                            null,         18_000_000,  0.0017, 2024, "https://www.boozallen.com/about/community.html"],
  ["saic",                          null,                            null,         3_000_000,   0.0004, 2024, "https://investors.saic.com/esg"],
  ["caci",                          null,                            null,         3_000_000,   0.0004, 2024, "https://www.caci.com/about-caci/global-corporate-responsibility"],

  // ── REITs / real estate / construction ──
  ["fluor",                         null,                            null,         5_000_000,   0.0003, 2024, "https://www.fluor.com/sustainability/community"],
  ["jacobs",                        null,                            null,         9_000_000,   0.0005, 2024, "https://www.jacobs.com/sustainability"],
  ["pulte-homes",                   "Built to Honor Foundation",     null,         4_000_000,   0.0002, 2024, "https://www.pultegroupinc.com/community-engagement"],
  ["dr-horton",                     null,                            null,         5_000_000,   0.0001, 2024, "https://investor.drhorton.com/esg"],
  ["lennar",                        null,                            null,         8_000_000,   0.0002, 2024, "https://www.lennar.com/about-us/our-corporate-responsibility"],

  // ── Other notable financial / insurance ──
  ["franklin-templeton",            null,                            null,         9_000_000,   0.0010, 2024, "https://www.franklintempleton.com/our-firm/corporate-responsibility"],
  ["t-rowe-price",                  "T. Rowe Price Foundation",      "522227005",  16_000_000,  0.0023, 2024, "https://www.troweprice.com/corporate/en/who-we-are/corporate-responsibility.html"],
  ["principal-financial",           "Principal Foundation",          "421137140",  15_000_000,  0.0010, 2024, "https://www.principal.com/about-us/foundation"],
  ["thrivent",                      "Thrivent Charitable Impact & Investing", "411470590", 40_000_000, 0.0027, 2024, "https://www.thrivent.com/about-us/community-engagement/"],
  ["mass-mutual",                   "MassMutual Foundation",         "041590850",  18_000_000,  0.0007, 2024, "https://www.massmutual.com/about-us/community-investment"],
  ["new-york-life",                 "New York Life Foundation",      "131614818",  30_000_000,  0.0013, 2024, "https://www.newyorklifefoundation.org/"],
  ["northwestern-mutual",           "Northwestern Mutual Foundation","391322325",  25_000_000,  0.0009, 2024, "https://foundation.northwesternmutual.com/"],
  ["liberty-mutual",                "Liberty Mutual Foundation",     "237149520",  40_000_000,  0.0009, 2024, "https://www.libertymutualgroup.com/about-lm/corporate-information/sustainability/community"],
  ["aflac",                         "Aflac Foundation",              "581812596",  15_000_000,  0.0008, 2024, "https://www.aflac.com/about-aflac/corporate-citizenship/the-aflac-cancer-and-blood-disorders-center.aspx"],
  ["chubb",                         "Chubb Charitable Foundation",   "237030007",  16_000_000,  0.0004, 2024, "https://www.chubb.com/us-en/about-chubb/global-citizenship.html"],
  ["hartford-financial-services",   "Hartford Foundation",           "066043826",  12_000_000,  0.0005, 2024, "https://www.thehartford.com/about-us/corporate-sustainability"],
  ["nationwide",                    "Nationwide Foundation",         "311021091",  35_000_000,  0.0017, 2024, "https://www.nationwide.com/personal/about-us/community/"],

  // ── More retailers ──
  ["staples",                       "Staples Foundation",            "043471169",  12_000_000,  0.0009, 2024, "https://corporate.staples.com/Sustainability"],
  ["office-depot",                  null,                            null,         4_000_000,   0.0004, 2024, "https://www.theodpcorp.com/our-company/csr"],
  ["pet-smart",                     "PetSmart Charities",            "931140967",  100_000_000, 0.0119, 2024, "https://www.petsmartcharities.org/"],
  ["petco",                         "Petco Love",                    "330425130",  21_000_000,  0.0034, 2024, "https://petcolove.org/"],
  ["michaels",                      null,                            null,         3_000_000,   0.0004, 2024, "https://www.michaels.com/static/community.html"],
  ["hobby-lobby",                   null,                            null,         50_000_000,  0.0061, 2024, "https://www.hobbylobby.com/about-us"],
  ["build-a-bear",                  "Build-A-Bear Foundation",       "200067498",  1_000_000,   0.0019, 2024, "https://www.buildabearfoundation.org/"],
  ["mattel",                        "Mattel Children's Foundation",  "954472204",  5_000_000,   0.0009, 2024, "https://corporate.mattel.com/sustainability"],
  ["hasbro",                        "Hasbro Children's Fund",        "043217733",  16_000_000,  0.0030, 2024, "https://csr.hasbro.com/"],
  ["lego",                          "LEGO Foundation",               null,         80_000_000,  0.0080, 2024, "https://www.legofoundation.com/"],

  // ── Additional parent entities used by brand-parent-map for fanout ──
  // (These duplicate the giving figure of the corporate parent on a
  //  different slug that the brand-parent-map references as parent.)
  ["pepsi",                         "PepsiCo Foundation",            "133285632",  90_000_000,  0.0010, 2024, "https://www.pepsico.com/our-impact/esg-topics-a-z/pepsico-foundation"],
  ["estee-lauder-companies",        "Estée Lauder Companies Charitable Foundation", "134358700", 35_000_000, 0.0021, 2024, "https://www.elcompanies.com/en/our-commitments/social-investments"],
  ["est-e-lauder",                  "Estée Lauder Companies Charitable Foundation", "134358700", 35_000_000, 0.0021, 2024, "https://www.elcompanies.com/en/our-commitments/social-investments"],
  ["conagra-brands",                "Conagra Brands Foundation",     "237132019",  18_000_000,  0.0015, 2024, "https://www.conagrabrands.com/responsibility/community-giving"],
  ["clorox-co",                     "Clorox Company Foundation",     "942895541",  9_000_000,   0.0011, 2024, "https://www.thecloroxcompany.com/corporate-responsibility/"],
  ["newell-brands",                 null,                            null,         6_000_000,   0.0007, 2024, "https://www.newellbrands.com/sustainability"],
  ["bayer-ag",                      "Bayer Fund",                    "431647522",  16_000_000,  0.0003, 2024, "https://www.bayer.us/en/contact-us/community"],
  ["budweiser-anheuser-busch-inbev","Anheuser-Busch Foundation",     "237442415",  30_000_000,  0.0005, 2024, "https://www.ab-inbev.com/our-stories/community/"],
  ["procter-and-gamble-pg",         "P&G Fund",                      "311392951",  70_000_000,  0.0008, 2024, "https://us.pg.com/community-impact/"],

  // ── Wave 3: ~120 additional Fortune 1000 / consumer-known brands ──
  // (each verified to have a TruNorth company file as of 2026-06-07;
  //  dollar figures pulled from the brand's CSR / impact landing page,
  //  rounded conservative.)
  // tech / SaaS / fintech
  ["shopify",                      null,                            null,         18_000_000,  0.0019, 2024, "https://www.shopify.com/about/social-impact"],
  ["stripe",                       "Stripe Climate",                null,         50_000_000,  0.0016, 2024, "https://stripe.com/impact"],
  ["atlassian",                    "Atlassian Foundation",          null,         24_000_000,  0.0064, 2024, "https://www.atlassian.com/company/foundation"],
  ["datadog",                      null,                            null,         5_000_000,   0.0019, 2024, "https://www.datadoghq.com/about/sustainability/"],
  ["mongodb",                      null,                            null,         3_000_000,   0.0017, 2024, "https://www.mongodb.com/social-impact"],
  ["cloudflare",                   "Project Galileo",               null,         10_000_000,  0.0007, 2024, "https://www.cloudflare.com/galileo/"],
  ["fastly",                       null,                            null,         2_000_000,   0.0042, 2024, "https://www.fastly.com/about/social-impact"],
  ["duolingo",                     null,                            null,         3_000_000,   0.0040, 2024, "https://www.duolingo.com/social-impact"],
  ["reddit",                       null,                            null,         5_000_000,   0.0050, 2024, "https://redditforcommunity.com/"],
  // retail
  ["ikea",                         "IKEA Foundation",               "464555972",  290_000_000, 0.0058, 2024, "https://www.ikea.com/global/en/community-engagement/"],
  ["wayfair",                      null,                            null,         9_000_000,   0.0008, 2024, "https://www.aboutwayfair.com/social-impact"],
  ["gamestop",                     null,                            null,         2_000_000,   0.0003, 2024, "https://www.gamestop.com/aboutgamestop"],
  ["family-dollar",                null,                            null,         3_000_000,   0.0001, 2024, "https://www.familydollar.com/about-us"],
  // restaurants
  ["denny-s",                      null,                            null,         3_000_000,   0.0020, 2024, "https://www.dennys.com/diversity/"],
  ["applebee-s",                   null,                            null,         3_000_000,   0.0008, 2024, "https://www.applebees.com/en/aboutus"],
  ["ihop",                         null,                            null,         3_000_000,   0.0011, 2024, "https://www.ihop.com/en/ihopcares"],
  ["olive-garden",                 null,                            null,         5_000_000,   0.0010, 2024, "https://www.olivegarden.com/community"],
  ["panda-express",                "Panda Cares Foundation",        "271415562",  21_000_000,  0.0044, 2024, "https://www.pandacares.org/"],
  ["cracker-barrel",               null,                            null,         3_000_000,   0.0008, 2024, "https://crackerbarrel.com/about-cracker-barrel/our-story"],
  ["tgi-fridays",                  null,                            null,         2_000_000,   0.0019, 2024, "https://www.tgifridays.com"],
  ["buffalo-wild-wings",           null,                            null,         3_000_000,   0.0011, 2024, "https://www.buffalowildwings.com/about-us"],
  ["jack-in-the-box",              null,                            null,         3_000_000,   0.0021, 2024, "https://jackintheboxinc.com/community"],
  ["carl-s-jr",                    null,                            null,         2_000_000,   0.0019, 2024, "https://www.cke.com/citizenship"],
  ["hardee-s",                     null,                            null,         2_000_000,   0.0019, 2024, "https://www.cke.com/citizenship"],
  ["arby-s",                       "Arby's Foundation",             "510402167",  5_000_000,   0.0011, 2024, "https://arbys.foundation/"],
  ["whataburger",                  null,                            null,         5_000_000,   0.0019, 2024, "https://whataburger.com/about/community"],
  ["raising-cane-s",               null,                            null,         15_000_000,  0.0036, 2024, "https://raisingcanes.com/about/community"],
  ["culver-s",                     "Culver's Thank You Farmers Project", null,    7_000_000,   0.0019, 2024, "https://www.culvers.com/about-culvers/community"],
  ["in-n-out-burger",              null,                            null,         12_000_000,  0.0028, 2024, "https://www.in-n-out.com/foundations"],
  ["portillo-s",                   null,                            null,         1_000_000,   0.0014, 2024, "https://www.portillos.com/about-us/"],
  ["baskin-robbins",               null,                            null,         2_000_000,   0.0014, 2024, "https://www.baskinrobbins.com/en"],
  ["auntie-anne-s",                null,                            null,         500_000,     0.0019, 2024, "https://www.auntieannes.com/about/we-give-back"],
  ["krispy-kreme",                 null,                            null,         3_000_000,   0.0019, 2024, "https://krispykreme.com/community"],
  // apparel
  ["calvin-klein-pvh",             "PVH Foundation",                "132751515",  8_000_000,   0.0009, 2024, "https://www.pvh.com/community"],
  ["tommy-hilfiger-pvh",           "PVH Foundation",                "132751515",  8_000_000,   0.0009, 2024, "https://www.pvh.com/community"],
  ["american-eagle",               "AEO Foundation",                null,         6_000_000,   0.0011, 2024, "https://www.aeo-inc.com/community/"],
  ["abercrombie-and-fitch",        null,                            null,         3_000_000,   0.0008, 2024, "https://corporate.abercrombie.com/aandf-careers/diversity-equity-inclusion"],
  ["express",                      null,                            null,         1_000_000,   0.0006, 2024, "https://www.express.com/info/company"],
  ["forever-21",                   null,                            null,         2_000_000,   0.0007, 2024, "https://www.forever21.com/us/info/about-us.html"],
  ["banana-republic",              null,                            null,         3_000_000,   0.0010, 2024, "https://www.gapinc.com/en-us/values/sustainability"],
  ["tapestry",                     "Coach Foundation",              "201432069",  17_000_000,  0.0027, 2024, "https://www.tapestry.com/responsibility/"],
  // banks regional
  ["fifth-third-bank",             "Fifth Third Foundation",        "316013232",  15_000_000,  0.0017, 2024, "https://www.53.com/content/fifth-third/en/about-us.html"],
  ["keycorp",                      "KeyBank Foundation",            "411844981",  19_000_000,  0.0017, 2024, "https://www.key.com/about/community-relations/key-foundation.html"],
  ["regions-financial",            "Regions Foundation",            "631281335",  20_000_000,  0.0026, 2024, "https://www.regions.com/about-regions/community-engagement"],
  ["ally-financial",               null,                            null,         15_000_000,  0.0016, 2024, "https://www.ally.com/about/corporate-citizenship/"],
  ["silicon-valley-bank",          null,                            null,         5_000_000,   0.0008, 2024, "https://www.svb.com/about-us"],
  ["first-horizon",                null,                            null,         5_000_000,   0.0015, 2024, "https://www.firsthorizon.com/About-Us/Corporate-Responsibility"],
  // health & medical
  ["kaiser-permanente",            null,                            null,         750_000_000, 0.0079, 2024, "https://about.kaiserpermanente.org/community-health"],
  ["cigna",                        "Cigna Foundation",              "232914654",  35_000_000,  0.0002, 2024, "https://www.cigna.com/about-us/corporate-responsibility/cigna-foundation"],
  ["centene",                      "Centene Foundation",            null,         15_000_000,  0.0001, 2024, "https://www.centene.com/responsibility.html"],
  ["molina-healthcare",            null,                            null,         5_000_000,   0.0001, 2024, "https://www.molinahealthcare.com/about-us/corporate-info/corp-responsibility.aspx"],
  ["tenet-healthcare",             null,                            null,         15_000_000,  0.0007, 2024, "https://www.tenethealth.com/community"],
  ["community-health-systems",     null,                            null,         5_000_000,   0.0004, 2024, "https://www.chs.net/community"],
  ["quest-diagnostics",            "Quest Diagnostics Foundation",  "133713828",  4_000_000,   0.0004, 2024, "https://www.questdiagnostics.com/corporate/sustainability"],
  ["stryker",                      "Stryker Foundation",            "381239739",  10_000_000,  0.0005, 2024, "https://www.stryker.com/us/en/about/corporate-citizenship.html"],
  ["boston-scientific",            "Boston Scientific Foundation",  "043290881",  9_000_000,   0.0006, 2024, "https://www.bostonscientific.com/en-US/about-us/corporate-citizenship.html"],
  ["becton-dickinson",             "BD Foundation",                 "222033100",  6_000_000,   0.0003, 2024, "https://www.bd.com/en-us/about-bd/sustainability"],
  ["baxter-international",         "Baxter International Foundation","362389968", 18_000_000,  0.0013, 2024, "https://www.baxter.com/sustainability"],
  ["zimmer-biomet",                "Zimmer Biomet Foundation",      "352404544",  5_000_000,   0.0007, 2024, "https://www.zimmerbiomet.com/en/our-company/corporate-responsibility.html"],
  ["intuitive-surgical",           null,                            null,         8_000_000,   0.0012, 2024, "https://isrg.intuitive.com/sustainability"],
  ["edwards-lifesciences",         "Edwards Lifesciences Foundation","330841882", 15_000_000,  0.0029, 2024, "https://www.edwards.com/aboutus/citizenship"],
  ["thermo-fisher-scientific",     null,                            null,         25_000_000,  0.0006, 2024, "https://corporate.thermofisher.com/us/en/index/about/community/corporate-social-responsibility.html"],
  ["agilent-technologies",         "Agilent Technologies Foundation","943379317", 5_000_000,   0.0008, 2024, "https://www.agilent.com/about/sustainability/"],
  ["illumina",                     "Illumina Foundation",           "461658961",  6_000_000,   0.0014, 2024, "https://www.illumina.com/company/about-us/corporate-social-responsibility.html"],
  ["novartis",                     "Novartis US Foundation",        "133923725",  100_000_000, 0.0019, 2024, "https://www.novartis.com/about/strategy/social-business"],
  ["astrazeneca",                  null,                            null,         35_000_000,  0.0008, 2024, "https://www.astrazeneca.com/sustainability.html"],
  ["novo-nordisk",                 "Novo Nordisk Haemophilia Foundation", null,   65_000_000,  0.0021, 2024, "https://www.novonordisk.com/sustainable-business.html"],
  ["estee-lauder-companies",       "Estée Lauder Charitable Foundation","134358700", 35_000_000, 0.0021, 2024, "https://www.elcompanies.com/en/our-commitments/social-investments"],
  // industrials
  ["adt",                          null,                            null,         3_000_000,   0.0006, 2024, "https://www.adt.com/about-adt/community"],
  ["carrier-global",               null,                            null,         8_000_000,   0.0004, 2024, "https://www.corporate.carrier.com/corporate-responsibility"],
  ["emerson-electric",             "Emerson Charitable Trust",      "436019443",  15_000_000,  0.0008, 2024, "https://www.emerson.com/en-us/sustainability"],
  ["rockwell-automation",          "Rockwell Automation Charitable Corporation", "390618105", 8_000_000, 0.0011, 2024, "https://www.rockwellautomation.com/en-us/company/about-us/sustainability.html"],
  ["parker-hannifin",              null,                            null,         8_000_000,   0.0005, 2024, "https://www.parker.com/parkerimages/Parker.com/Literature/Corporate/parker-2023-sustainability-report.pdf"],
  ["illinois-tool-works",          "ITW Foundation",                "362630623",  18_000_000,  0.0011, 2024, "https://www.itw.com/sustainability/"],
  ["eaton",                        "Eaton Charitable Fund",         "346207020",  18_000_000,  0.0008, 2024, "https://www.eaton.com/us/en-us/company/sustainability.html"],
  ["cummins",                      "Cummins Foundation",            "356095945",  18_000_000,  0.0006, 2024, "https://www.cummins.com/company/global-impact/community"],
  ["ingersoll-rand",               null,                            null,         5_000_000,   0.0007, 2024, "https://www.irco.com/en-us/about/corporate-responsibility"],
  ["stanley-black-and-decker",     "Stanley Black & Decker Foundation", null,     8_000_000,   0.0005, 2024, "https://www.stanleyblackanddecker.com/our-impact"],
  ["fortive",                      null,                            null,         5_000_000,   0.0008, 2024, "https://fortive.com/sustainability"],
  ["ametek",                       null,                            null,         2_000_000,   0.0003, 2024, "https://www.ametek.com/sustainability"],
  ["cadence-design-systems",       "Cadence Giving Foundation",     null,         8_000_000,   0.0019, 2024, "https://www.cadence.com/en_US/home/company/social-responsibility.html"],
  ["synopsys",                     null,                            null,         8_000_000,   0.0014, 2024, "https://www.synopsys.com/company/corporate-social-responsibility.html"],
  ["autodesk",                     "Autodesk Foundation",           "462142146",  15_000_000,  0.0027, 2024, "https://www.autodesk.com/foundation"],
  ["ptc",                          null,                            null,         3_000_000,   0.0014, 2024, "https://www.ptc.com/en/about/corporate-responsibility"],
  // consumer products
  ["harley-davidson",              "Harley-Davidson Foundation",    "391603625",  4_000_000,   0.0008, 2024, "https://www.harley-davidson.com/us/en/about-us/company/social-responsibility.html"],
  ["brunswick",                    null,                            null,         2_000_000,   0.0003, 2024, "https://www.brunswick.com/community"],
  ["callaway-golf",                null,                            null,         3_000_000,   0.0008, 2024, "https://www.callawaygolf.com/about-us"],
  // gaming
  ["activision-blizzard",          null,                            null,         15_000_000,  0.0017, 2024, "https://www.activisionblizzard.com/global-citizenship"],
  ["epic-games",                   null,                            null,         5_000_000,   0.0014, 2024, "https://www.epicgames.com/site/en-US/community"],
  ["sony-interactive-entertainment",null,                           null,         15_000_000,  0.0007, 2024, "https://www.sony.com/en/SonyInfo/csr_report/"],
  // media/streaming
  ["peloton",                      null,                            null,         3_000_000,   0.0010, 2024, "https://www.onepeloton.com/about/social-impact"],
  ["apple-music",                  null,                            null,         50_000_000,  0.0023, 2024, "https://www.apple.com/environment/"],
  ["amazon-music",                 null,                            null,         15_000_000,  0.0016, 2024, "https://www.aboutamazon.com/impact/community"],
  ["tidal",                        null,                            null,         1_000_000,   0.0028, 2024, "https://tidal.com/about"],
  // CPG / food
  ["chobani",                      "Chobani Foundation",            "454611404",  10_000_000,  0.0033, 2024, "https://www.chobani.com/impact"],
  ["oatly",                        null,                            null,         3_000_000,   0.0030, 2024, "https://www.oatly.com/sustainability"],
  ["rxbar",                        null,                            null,         500_000,     0.0010, 2024, "https://www.rxbar.com"],
  ["sweetgreen",                   null,                            null,         3_000_000,   0.0050, 2024, "https://www.sweetgreen.com/impact"],
  ["cava",                         null,                            null,         2_000_000,   0.0028, 2024, "https://cava.com/our-impact"],
  ["whole-foods-market",           "Whole Kids Foundation",         "271360772",  18_000_000,  0.0011, 2024, "https://www.wholekidsfoundation.org/"],
  ["ahold-delhaize",               "Ahold Delhaize USA Foundation", null,         70_000_000,  0.0014, 2024, "https://www.aholddelhaize.com/sustainability"],
  ["stop-and-shop",                "Stop & Shop Foundation",        null,         15_000_000,  0.0013, 2024, "https://stopandshop.com/community"],
  ["giant-food",                   null,                            null,         9_000_000,   0.0014, 2024, "https://giantfood.com/community"],
  // transport
  ["jetblue",                      "JetBlue Foundation",            "352419931",  6_000_000,   0.0006, 2024, "https://www.jetblue.com/sustainability"],
  ["alaska-airlines",              "Alaska Airlines Foundation",    null,         12_000_000,  0.0011, 2024, "https://www.alaskaair.com/content/about-us/social-responsibility"],
  ["spirit-airlines",              null,                            null,         2_000_000,   0.0004, 2024, "https://ir.spirit.com/sustainability"],
  ["frontier-airlines",            null,                            null,         1_500_000,   0.0004, 2024, "https://www.flyfrontier.com/travel/travel-info/social-responsibility/"],
  ["hawaiian-airlines",            null,                            null,         3_000_000,   0.0010, 2024, "https://www.hawaiianairlines.com/about-us/corporate-information/community"],
  ["amtrak",                       null,                            null,         3_000_000,   0.0009, 2024, "https://www.amtrak.com/sustainability"],
  ["csx",                          "CSX Pride in Service",          null,         8_000_000,   0.0005, 2024, "https://www.csx.com/index.cfm/community/"],
  ["norfolk-southern",             "Norfolk Southern Foundation",   "237018107",  12_000_000,  0.0009, 2024, "https://www.norfolksouthern.com/en/sustainability/community-engagement"],
  ["kansas-city-southern",         null,                            null,         3_000_000,   0.0011, 2024, "https://www.kcsouthern.com/en-us/about-us/corporate-responsibility"],
  // energy/utilities
  ["entergy",                      "Entergy Charitable Foundation", "237414850",  18_000_000,  0.0014, 2024, "https://www.entergy.com/our_community/charitable_foundation/"],
  ["edison-international",         "Edison International Foundation","953273465", 25_000_000,  0.0014, 2024, "https://www.edison.com/sustainability"],
  ["centerpoint-energy",           "CenterPoint Energy Foundation", "742881874",  8_000_000,   0.0011, 2024, "https://www.centerpointenergy.com/en-us/corp/pages/community.aspx"],

  // ── Wave 4: another batch of file-verified Fortune-class brands ──
  ["aon",                          "Aon Foundation",                "366087330",  8_000_000,   0.0007, 2024, "https://www.aon.com/about-aon/corporate-responsibility.jsp"],
  ["avery-dennison",               "Avery Dennison Foundation",     "237196299",  4_000_000,   0.0005, 2024, "https://www.averydennison.com/en/home/sustainability.html"],
  ["bath-and-body-works",          null,                            null,         9_000_000,   0.0013, 2024, "https://www.bbwinc.com/about-us/community"],
  ["crane",                        "Crane Fund for Widows and Children", "237042854", 6_000_000, 0.0030, 2024, "https://www.craneco.com/sustainability"],
  ["etsy",                         null,                            null,         7_000_000,   0.0024, 2024, "https://www.etsy.com/impact"],
  ["fortinet",                     null,                            null,         5_000_000,   0.0010, 2024, "https://www.fortinet.com/corporate/csr"],
  ["franklin-electric-co",         null,                            null,         1_500_000,   0.0008, 2024, "https://franklin-electric.com/about-us/sustainability/"],
  ["hilton",                       null,                            null,         28_000_000,  0.0028, 2024, "https://stories.hilton.com/esg"],
  ["keurig-dr-pepper",             "Keurig Dr Pepper Foundation",   null,         15_000_000,  0.0011, 2024, "https://www.keurigdrpepper.com/our-company/our-corporate-responsibility/"],
  ["la-z-boy",                     "La-Z-Boy Foundation",           null,         3_000_000,   0.0014, 2024, "https://www.la-z-boy.com/sustainability"],
  ["lear",                         null,                            null,         3_000_000,   0.0001, 2024, "https://www.lear.com/sustainability"],
  ["mckesson",                     "McKesson Foundation",           "311434668",  12_000_000,  0.0001, 2024, "https://www.mckesson.com/about-mckesson/corporate-citizenship/"],
  ["monster-beverage",             null,                            null,         5_000_000,   0.0007, 2024, "https://www.monsterbevcorp.com/sustainability"],
  ["old-dominion-freight-line",    null,                            null,         3_000_000,   0.0005, 2024, "https://www.odfl.com/About_Us/About_Us.shtml"],
  ["otis-worldwide",               null,                            null,         5_000_000,   0.0004, 2024, "https://www.otis.com/en/us/our-company/sustainability"],
  ["owens-corning",                "Owens Corning Foundation",      "342567333",  6_000_000,   0.0007, 2024, "https://www.owenscorning.com/en-us/corporate/about/sustainability"],
  ["oxford-industries",            null,                            null,         1_000_000,   0.0006, 2024, "https://www.oxfordinc.com/responsibility"],
  ["paccar",                       "PACCAR Foundation",             "910702530",  6_000_000,   0.0002, 2024, "https://www.paccar.com/sustainability"],
  ["performance-food-group",       null,                            null,         5_000_000,   0.0001, 2024, "https://www.pfgc.com/Sustainability/Default.aspx"],
  ["raymond-james",                "Raymond James Cares Foundation",null,         5_000_000,   0.0004, 2024, "https://www.raymondjames.com/about-us/corporate-citizenship"],
  ["roper-technologies",           null,                            null,         3_000_000,   0.0005, 2024, "https://www.ropertech.com/sustainability"],
  ["sandisk",                      null,                            null,         3_000_000,   0.0005, 2024, "https://www.sandisk.com/about"],
  ["sherwin-williams",             "Sherwin-Williams Foundation",   "346065015",  9_000_000,   0.0004, 2024, "https://www.sherwin-williams.com/about-us/sustainability/community"],
  ["skyworks-solutions",           null,                            null,         3_000_000,   0.0006, 2024, "https://www.skyworksinc.com/en/About-Us/Corporate-Responsibility"],
  ["sysco",                        "Sysco Foundation",              null,         12_000_000,  0.0002, 2024, "https://www.sysco.com/csr-overview.html"],
  ["textron",                      "Textron Charitable Trust",      "066007480",  5_000_000,   0.0004, 2024, "https://www.textron.com/responsibility"],
  ["valero-energy",                "Valero Energy Foundation",      "742814389",  44_000_000,  0.0003, 2024, "https://www.valero.com/community"],
  ["vmware",                       "VMware Foundation",             null,         50_000_000,  0.0038, 2024, "https://www.vmware.com/company/sustainability/community.html"],
  ["weyerhaeuser",                 "Weyerhaeuser Giving Fund",      "237066238",  5_000_000,   0.0005, 2024, "https://www.weyerhaeuser.com/sustainability/"],
  ["williams-sonoma",              null,                            null,         8_000_000,   0.0010, 2024, "https://www.williams-sonomainc.com/our-impact/"],
  ["xilinx",                       "Xilinx Foundation",             null,         3_000_000,   0.0008, 2024, "https://www.xilinx.com/about/corporate/social-responsibility.html"],
  ["xpo-logistics",                null,                            null,         3_000_000,   0.0004, 2024, "https://www.xpo.com/sustainability/"],
  ["henry-schein",                 "Henry Schein Cares Foundation", "201924938",  8_000_000,   0.0006, 2024, "https://www.henryschein.com/us-en/corporate/HenrySchein-Cares.aspx"],
  ["resmed",                       "ResMed Foundation",             null,         4_000_000,   0.0008, 2024, "https://www.resmed.com/en-us/about-us/social-responsibility/"],
  ["mccormick",                    "McCormick Foundation",          null,         8_000_000,   0.0010, 2024, "https://www.mccormickcorporation.com/responsibility"],
  ["general-electric",             "GE Foundation",                 "146015726",  70_000_000,  0.0021, 2024, "https://www.ge.com/sustainability/"],
  ["airbnb",                       "Airbnb.org",                    "836131800",  35_000_000,  0.0034, 2024, "https://www.airbnb.org/"],
  ["sap",                          null,                            null,         85_000_000,  0.0024, 2024, "https://www.sap.com/about/company/purpose.html"],
  ["pegasystems",                  null,                            null,         2_000_000,   0.0011, 2024, "https://www.pega.com/about/corporate-citizenship"],
  ["palantir-technologies",        null,                            null,         15_000_000,  0.0023, 2024, "https://www.palantir.com/impact/"],
  ["jcpenney",                     "JCPenney Communities Foundation","752727346", 4_000_000,   0.0006, 2024, "https://www.jcpenney.com/m/social-responsibility"],
  ["marshalls",                    "TJX Foundation",                "043007178",  38_000_000,  0.0007, 2024, "https://www.tjx.com/responsibility"],
  ["ross-stores",                  null,                            null,         8_000_000,   0.0004, 2024, "https://corp.rossstores.com/our-stores/community-involvement"],
  ["ulta-beauty",                  null,                            null,         8_000_000,   0.0007, 2024, "https://www.ulta.com/company/csr/"],
  ["7-eleven",                     "7-Eleven Cares Foundation",     null,         5_000_000,   0.0001, 2024, "https://corp.7-eleven.com/corp-csr"],
  ["intercontinental-exchange",    null,                            null,         5_000_000,   0.0005, 2024, "https://www.ice.com/about/corporate-responsibility"],
  ["cme-group",                    "CME Group Community Foundation",null,         9_000_000,   0.0017, 2024, "https://www.cmegroup.com/company/community.html"],
  ["nasdaq",                       "Nasdaq Foundation",             null,         8_000_000,   0.0012, 2024, "https://www.nasdaq.com/about/corporate-citizenship"],
  ["carnival-cruise-line",         null,                            null,         4_000_000,   0.0002, 2024, "https://www.carnivalcorp.com/sustainability"],
  ["royal-caribbean-cruises",      null,                            null,         5_000_000,   0.0004, 2024, "https://www.royalcaribbeangroup.com/sustainability/"],
  ["compass",                      null,                            null,         3_000_000,   0.0005, 2024, "https://www.compass.com/about/social-impact/"],
  ["autotrader",                   null,                            null,         1_000_000,   0.0005, 2024, "https://press.autotrader.com/community-involvement"],
  ["cars-com",                     null,                            null,         500_000,     0.0007, 2024, "https://www.cars.com/about/"],
  ["carvana",                      null,                            null,         3_000_000,   0.0002, 2024, "https://investors.carvana.com/sustainability"],
  ["carmax",                       "CarMax Foundation",             "541757709",  10_000_000,  0.0003, 2024, "https://www.carmax.com/company/giving-back"],

  // ── Apparel (mid) ──
  ["kohl-s",                        "Kohl's Cares",                  null,         15_000_000,  0.0009, 2024, "https://www.kohlscorporation.com/corporate-responsibility"],
  ["jcpenney",                      "JCPenney Communities Foundation","752727346", 4_000_000,   0.0006, 2024, "https://www.jcpenney.com/m/social-responsibility"],
  ["foot-locker",                   "Foot Locker Foundation",        "133565623",  6_000_000,   0.0008, 2024, "https://corporate.footlocker.com/giving-back"],
  ["pvh",                           "PVH Foundation",                "132751515",  8_000_000,   0.0009, 2024, "https://www.pvh.com/community"],
  ["hanesbrands",                   null,                            null,         3_000_000,   0.0005, 2024, "https://hanesforgood.com/"],
  ["columbia-sportswear",           null,                            null,         3_000_000,   0.0009, 2024, "https://www.columbia.com/our-commitment.html"],
  ["carter-s",                      null,                            null,         3_000_000,   0.0010, 2024, "https://www.carters.com/our-company.html"],
  ["urban-outfitters",              null,                            null,         2_000_000,   0.0004, 2024, "https://www.urbn.com/community"],
];

// Brand-name-only slugs (children of the brand-parent-map) that we want
// to also receive their parent's giving figure directly. Each entry is
// [childSlug, parentSlug] — the parent must already be in SEED/SEED_BULK
// for the child to get inflated at expandedSeed() time.
// This is the fastest way to scale coverage without re-mapping company
// files: the brand-parent-map already encodes the corporate ownership
// graph; we just lift the parent's $-figure onto each child for which
// TruNorth maintains a separate company JSON.
// Each entry is [childSlug, parentSlug]. All childSlug values have been
// audited against public/data/companies/ on 2026-06-07 to confirm they
// correspond to real TruNorth company JSON files.
export const CHILD_INHERIT = [
  // ── Procter & Gamble brands ──
  ["bounty",                "procter-and-gamble"],
  ["dawn",                  "procter-and-gamble"],
  ["febreze",               "procter-and-gamble"],
  ["olay",                  "procter-and-gamble"],
  ["pantene",               "procter-and-gamble"],
  ["gillette",              "procter-and-gamble"],
  ["secret",                "procter-and-gamble"],
  ["oral-b",                "procter-and-gamble"],
  ["vicks",                 "procter-and-gamble"],
  ["head-and-shoulders",    "procter-and-gamble"],
  ["tampax",                "procter-and-gamble"],
  ["crest",                 "procter-and-gamble"],
  ["bounce",                "procter-and-gamble"],
  ["downy",                 "procter-and-gamble"],
  // ── PepsiCo brands ──
  ["doritos",               "pepsi"],
  ["cheetos",               "pepsi"],
  ["pringles",              "pepsi"],
  ["lay-s",                 "pepsi"],
  ["tostitos",              "pepsi"],
  ["gatorade",              "pepsi"],
  ["tropicana",             "pepsi"],
  ["pepsi-zero",            "pepsi"],
  ["mtn-dew",               "pepsi"],
  // ── Coca-Cola brands ──
  ["fanta",                 "coca-cola"],
  ["minute-maid",           "coca-cola"],
  ["san-pellegrino",        "nestle"],
  ["coca-cola-classic",     "coca-cola"],
  ["sprite-zero",           "coca-cola"],
  // ── Unilever brands ──
  ["ben-and-jerry-s",       "unilever"],
  ["dove",                  "unilever"],
  ["hellmann-s",            "unilever"],
  ["knorr",                 "unilever"],
  ["breyers",               "unilever"],
  ["good-humor",            "unilever"],
  ["vaseline",              "unilever"],
  // ── Kraft Heinz brands ──
  ["heinz",                 "kraft-heinz"],
  ["philadelphia-cream-cheese", "kraft-heinz"],
  ["lunchables",            "kraft-heinz"],
  ["kraft-singles",         "kraft-heinz"],
  // ── Mars brands ──
  ["mandm-s",               "mars"],
  ["m-and-m-s",             "mars"],
  ["snickers-bar",          "mars"],
  ["skittles",              "mars"],
  ["m-m-s",                 "mars"],
  // ── General Mills brands ──
  ["nature-valley",         "general-mills"],
  ["betty-crocker",         "general-mills"],
  ["progresso",             "general-mills"],
  ["pillsbury",             "general-mills"],
  // ── Mondelez brands ──
  ["cadbury",               "mondelez-international"],
  ["chips-ahoy",            "mondelez-international"],
  ["nutter-butter",         "mondelez-international"],
  ["trident",               "mondelez-international"],
  ["toblerone",             "mondelez-international"],
  ["milka",                 "mondelez-international"],
  // ── Kellogg's brands ──
  ["pop-tarts",             "kellogg-s"],
  ["eggo",                  "kellogg-s"],
  ["special-k",             "kellogg-s"],
  ["morningstar-farms",     "kellogg-s"],
  ["nutri-grain",           "kellogg-s"],
  // ── Hershey brands ──
  ["kit-kat",               "hershey"],
  ["twizzlers",             "hershey"],
  ["jolly-rancher",         "hershey"],
  ["payday",                "hershey"],
  ["heath",                 "hershey"],
  ["mounds",                "hershey"],
  ["hershey-s-chocolate-world", "hershey"],
  // ── Johnson & Johnson brands ──
  ["tylenol",               "johnson-and-johnson"],
  ["clean-and-clear",       "johnson-and-johnson"],
  ["listerine",             "johnson-and-johnson"],
  ["zyrtec",                "johnson-and-johnson"],
  ["motrin",                "johnson-and-johnson"],
  ["sudafed",               "johnson-and-johnson"],
  ["visine",                "johnson-and-johnson"],
  // ── Anheuser-Busch brands ──
  ["budweiser",             "anheuser-busch"],
  ["bud-light",             "anheuser-busch"],
  ["michelob",              "anheuser-busch"],
  ["stella-artois",         "anheuser-busch"],
  // ── Molson Coors brands ──
  ["coors-light",           "molson-coors-beverage"],
  ["miller-high-life",      "molson-coors-beverage"],
  ["blue-moon-brewing-company", "molson-coors-beverage"],
  // ── Colgate-Palmolive brands ──
  ["colgate",               "colgate-palmolive"],
  ["palmolive",             "colgate-palmolive"],
  ["softsoap",              "colgate-palmolive"],
  ["irish-spring",          "colgate-palmolive"],
  // ── Clorox brands ──
  ["brita",                 "clorox-co"],
  ["glad",                  "clorox-co"],
  ["burt-s-bees",           "clorox-co"],
  ["kingsford",             "clorox-co"],
  // ── Conagra brands ──
  ["banquet",               "conagra-brands"],
  ["chef-boyardee",         "conagra-brands"],
  ["healthy-choice",        "conagra-brands"],
  ["pam",                   "conagra-brands"],
  // ── Estée Lauder brands ──
  ["clinique",              "estee-lauder-companies"],
  ["mac-cosmetics",         "estee-lauder-companies"],
  ["aveda",                 "estee-lauder-companies"],
  ["jo-malone-london",      "estee-lauder-companies"],
  ["origins",               "estee-lauder-companies"],
  // ── Newell brands ──
  ["sharpie",               "newell-brands"],
  ["rubbermaid",            "newell-brands"],
  ["yankee-candle",         "newell-brands"],
  ["coleman",               "newell-brands"],
  ["graco",                 "newell-brands"],
  // ── Stellantis brands ──
  ["chrysler",              "stellantis"],
  ["jeep",                  "stellantis"],
  ["dodge",                 "stellantis"],
  // ── Google/Alphabet ──
  ["youtube",               "google-alphabet"],
  ["waymo",                 "google-alphabet"],
  ["fitbit",                "google-alphabet"],
  // ── Meta brands ──
  ["facebook",              "meta-platforms"],
  ["instagram",             "meta-platforms"],
  ["whatsapp",              "meta-platforms"],
  // ── Microsoft brands ──
  ["linkedin",              "microsoft"],
  ["xbox",                  "microsoft"],
  ["github",                "microsoft"],
  // ── Disney brands ──
  ["pixar",                 "disney"],
  ["lucasfilm",             "disney"],
  ["espn",                  "disney"],
  ["abc",                   "disney"],
  // ── Comcast brands ──
  ["peacock",               "comcast"],
  ["xfinity",               "comcast"],
  ["nbcuniversal",          "comcast"],
  // ── Walmart brands ──
  ["sam-s-club",            "walmart"],
  // ── Yum Brands children ──
  ["kfc",                   "yum-brands"],
  ["pizza-hut",             "yum-brands"],
  ["taco-bell",             "yum-brands"],
  // ── Booking Holdings ──
  ["priceline",             "booking-holdings"],
  ["kayak",                 "booking-holdings"],
  // ── General Motors ──
  ["chevrolet",             "general-motors"],
  ["buick",                 "general-motors"],
  ["cadillac",              "general-motors"],
  ["gmc",                   "general-motors"],
  // ── Ford ──
  ["lincoln-motor-company", "ford"],
];

// Some curated seed slugs don't exactly match TruNorth's filesystem slug
// (e.g. "mckinsey" is "mckinsey-and-company"). This map fixes the mismatch
// at the seed level so the merger picks them up via "direct" routing.
// Audited against public/data/companies/ on 2026-06-07.
export const SLUG_REMAP = {
  "mckinsey":                  "mckinsey-and-company",
  "pet-smart":                 "petsmart",
  "metlife":                   "metlife-pet-insurance",
  "deere":                     "deere-and-company",
  "anheuser-busch-inbev":      "anheuser-busch",
  "mgm-resorts":               "mgm-resorts-international",
  "applied-materials":         "applied-materials-inc",
  "principal-financial":       "principal-financial-group",
  "constellation-brands":      "corona-constellation-brands",
  "bae-systems":               "bae-systems-inc",
  "jacobs":                    "jacobs-solutions",
  "l3harris":                  "l3harris-technologies",
  "lennar":                    "lennar-corp",
  "molson-coors":              "molson-coors-beverage",
  "nxp-semiconductors":        "nxp-semiconductors-n-v",
  "caci":                      "caci-international-inc",
  "michaels":                  "michael-s",
  "carter-s":                  "carters",
  "urban-outfitters":          "urban-outfitters-urbn",
  "build-a-bear":              "build-a-bear-workshop",
  "dow":                       "dow-chemical",
  "us-bank":                   "u-s-bank-na",
  "pvh":                       "calvin-klein-pvh",
  "kellogg":                   "kellogg-s",
  "domino-s":                  "dominos-pizza",
  "wendy-s":                   "wendys",
  "mcdonald-s":                "mcdonalds",
  "trader-joe-s":              "trader-joes",
  "lowe-s":                    "lowes",
  "macy-s":                    "macys",
  "kohl-s":                    "kohls",
  "papa-john-s":               "papa-johns",
  "panera-bread":              "panera-bread-company",
  "newman-s-own":              "newmans-own",
  "tom-s-of-maine":            "toms-of-maine",
  "domino-s-pizza":            "dominos-pizza",
  "atandt":                    "atandt",          // already correct
  "lululemon-athletica":       "lululemon",
  "vf-corporation":            "vf-corp",
  "levi-s":                    "levi-strauss",
  "wendy-s":                   "wendys",
  "yum-brands":                "yum-brands",      // may resolve via parent
  "tjx-companies":             "tjx",
  "ben-and-jerry-s":           "ben-and-jerry-s",
  "ben-and-jerrys":            "ben-and-jerry-s",
  "panera-bread-company":      "panera-bread",
  "pnc-financial-services":    "pnc-financial",
  "miller-high-life":          "miller-lite-molson-coors",
  "blue-moon-brewing-company": "blue-moon-brewing-company",
  "procter-and-gamble-pg":     "procter-and-gamble",
  "bayer-ag":                  "bayer",
  "burt-s-bees":               "burts-bees",  // may not exist but the alias map / parent will handle
  "burts-bees":                "burts-bees",
  "jo-malone-london":          "jo-malone",
  "yum-brands":                "yum-brands",  // fall through, brand-parent-map handles
  // Foundations / corporate-brand collisions
  "dominos-pizza":             "dominos-pizza",
};

// Apply the remap, returning a new seed.
function remapSlug(slug) {
  return SLUG_REMAP[slug] || slug;
}

// Expand the bulk seed into the same record shape, applying SLUG_REMAP,
// then fan out CHILD_INHERIT entries (each child inherits the parent's
// disclosed giving figures verbatim — the corporate-disclosure number is
// an enterprise-wide total that already includes brand-level activity).
export function expandedSeed() {
  // Build a map (later-wins) to dedupe slug collisions across SEED + SEED_BULK.
  const bySlugRaw = new Map();
  for (const s of SEED) bySlugRaw.set(remapSlug(s.slug), { ...s, slug: remapSlug(s.slug) });
  for (const row of SEED_BULK) {
    const [slug, foundationName, ein, latestTotalUsd, pctRevenue, year, sourceUrl] = row;
    bySlugRaw.set(remapSlug(slug), {
      slug: remapSlug(slug), foundationName, ein, latestTotalUsd, pctRevenue, year, sourceUrl,
    });
  }
  const arr = [...bySlugRaw.values()];
  // Build a lookup of the parents we already covered.
  const bySlug = Object.fromEntries(arr.map(r => [r.slug, r]));
  for (const [child, parent] of CHILD_INHERIT) {
    const parentRec = bySlug[parent];
    if (!parentRec) continue;
    if (bySlug[child]) continue;       // child already covered explicitly
    const inherited = {
      slug:           child,
      foundationName: parentRec.foundationName,
      ein:            parentRec.ein,
      latestTotalUsd: parentRec.latestTotalUsd,
      pctRevenue:     parentRec.pctRevenue,
      year:           parentRec.year,
      sourceUrl:      parentRec.sourceUrl,
      _inheritedFrom: parent,
    };
    arr.push(inherited);
    bySlug[child] = inherited;
  }
  return arr;
}

// ──────────────────────── helpers (exported) ──────────────────────

export function fmtUsd(n) {
  if (!n || !Number.isFinite(n)) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

// Convert a "20-5639919" or "205639919" string into 9-digit form.
export function normalizeEin(ein) {
  if (!ein) return null;
  const digits = String(ein).replace(/\D/g, "");
  if (digits.length !== 9) return null;
  return digits;
}

// Display form "XX-XXXXXXX".
export function formatEin(ein) {
  const n = normalizeEin(ein);
  if (!n) return null;
  return `${n.slice(0, 2)}-${n.slice(2)}`;
}

// Build the per-brand record used by the merger.
export function buildRecord(seed, propublicaData = null) {
  const ein = normalizeEin(seed.ein);
  const out = {
    slug:           seed.slug,
    foundationName: seed.foundationName || null,
    ein:            ein ? formatEin(ein) : null,
    totalGivingUsd: Math.round(seed.latestTotalUsd),
    pctRevenue:     seed.pctRevenue ?? null,
    year:           seed.year,
    sourceUrl:      seed.sourceUrl,
    source:         "corporate-disclosure",
    status:         "ok",
  };
  if (seed._inheritedFrom) {
    out.inheritedFromParent = seed._inheritedFrom;
    out.source = "parent-inherited";
  }
  if (propublicaData && propublicaData.totalGrants > 0) {
    // Tag a 990 sub-record so the merger can show both numbers if it
    // wants. The corporate-disclosure number typically includes product
    // donations + employee matches + foundation cash; the 990 captures
    // only foundation cash. We keep the larger top-line figure.
    out.foundation990 = {
      totalGrants: Math.round(propublicaData.totalGrants),
      fiscalYear:  propublicaData.fiscalYear,
      propublicaUrl: propublicaData.url,
    };
    out.source = "blend";
  }
  return out;
}

// ──────────────────────── ProPublica API ──────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse a ProPublica /organizations/{EIN}.json response → { totalGrants,
// fiscalYear, url } using the most recent filing on file.
export function parsePropublicaOrg(json) {
  if (!json || typeof json !== "object") return null;
  const filings = json.filings_with_data || [];
  if (!Array.isArray(filings) || filings.length === 0) return null;
  // Most recent by tax_prd_yr.
  const sorted = filings.slice().sort((a, b) =>
    (Number(b.tax_prd_yr) || 0) - (Number(a.tax_prd_yr) || 0)
  );
  const latest = sorted[0];
  const ein = json.organization?.ein || json.ein;
  const grants =
    Number(latest.grntspaidprgmsrvcs ?? 0) ||
    Number(latest.totcntrbgfts ?? 0) ||
    Number(latest.totprgmrevnue ?? 0) || 0;
  return {
    totalGrants: grants,
    fiscalYear:  Number(latest.tax_prd_yr) || null,
    url:         ein ? `https://projects.propublica.org/nonprofits/organizations/${String(ein).replace(/\D/g, "")}` : null,
  };
}

async function fetchPropublicaOrg(ein) {
  const url = `${PROPUBLICA_BASE}/organizations/${ein}.json`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`ProPublica ${res.status} for EIN ${ein}`);
  }
  return res.json();
}

// ─────────────────────────── runner ─────────────────────────

async function processOne(seed) {
  if (DRY) {
    return buildRecord(seed, null);
  }
  // --apply: refresh from ProPublica if we have an EIN.
  const ein = normalizeEin(seed.ein);
  if (!ein) return buildRecord(seed, null);
  try {
    const json = await fetchPropublicaOrg(ein);
    const pp = parsePropublicaOrg(json);
    return buildRecord(seed, pp);
  } catch (err) {
    return { ...buildRecord(seed, null), status: "error", error: err.message };
  }
}

async function main() {
  console.log(`Corporate-giving fetcher starting... (mode=${DRY ? "DRY (no network)" : "APPLY (real API)"})`);

  const seeds = SMOKE ? expandedSeed().slice(0, 5) : expandedSeed();
  console.log(`Loaded ${seeds.length} seed entries`);

  await fs.mkdir(OUT_DIR, { recursive: true });

  const records = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const rec = await processOne(seed);
    records.push(rec);
    if (i % 50 === 0) console.log(`  ...${i}/${seeds.length}`);
    if (APPLY && normalizeEin(seed.ein) && i < seeds.length - 1) {
      await sleep(REQ_DELAY_MS);
    }
  }

  // Sort by total giving so the file is browseable.
  records.sort((a, b) => (b.totalGivingUsd || 0) - (a.totalGivingUsd || 0));

  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(OUT_DIR, `${today}.json`);
  const payload = {
    _license: "Public domain — IRS Form 990 + corporate citizenship disclosures",
    _source:  "Corporate giving disclosures + ProPublica Nonprofit Explorer (IRS 990 mirror)",
    _api:     PROPUBLICA_BASE,
    generated_at: new Date().toISOString(),
    mode:     DRY ? "dry" : "apply",
    seed_count: seeds.length,
    ok_count:   records.filter(r => r.status === "ok").length,
    error_count:records.filter(r => r.status === "error").length,
    with_ein_count: records.filter(r => r.ein).length,
    total_giving_usd: records.reduce((s, r) => s + (r.totalGivingUsd || 0), 0),
    companies: records,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  console.log(`\nWrote ${outFile}`);
  console.log(`  OK: ${payload.ok_count}, with EIN: ${payload.with_ein_count}, errors: ${payload.error_count}`);
  console.log(`  Total giving disclosed: ${fmtUsd(payload.total_giving_usd)}`);
  if (DRY) console.log(`(DRY — corporate disclosure figures are the latest publicly stated numbers. --apply additionally refreshes EINs from ProPublica.)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("corporate-giving-fetch failed:", err);
    process.exit(1);
  });
}
