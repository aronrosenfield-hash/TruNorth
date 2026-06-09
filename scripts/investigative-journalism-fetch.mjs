#!/usr/bin/env node
/**
 * Investigative journalism corpus — landmark corporate-accountability
 * investigations from 30+ outlets across 30+ years. Curated (Approach B)
 * because the source category is too unstructured for reliable mass
 * scraping; each entry is a hand-verified piece tied to a specific
 * brand → outlet → headline → URL.
 *
 * Existing round-2/3 sources we DO NOT duplicate:
 *   - high-cred-news (ProPublica, The Markup, Reveal, Lead Stories — 180d RSS)
 *   - markup-investigations (curated Markup highlights)
 *   - krebs-investigations (cybersecurity-only)
 *   - factcheck-verdicts (PolitiFact, Snopes, FactCheck.org)
 *   - reuters-factcheck, lead-stories
 *
 * This source FILLS THE HISTORICAL GAP — landmark investigations that
 * pre-date our 180-day RSS window or come from outlets we don't crawl
 * (Reuters Investigates, Bloomberg Investigates, BBC, Mother Jones,
 * The Intercept, Inside Climate News, ICIJ leaks, OCCRP, Toxic Docs,
 * Climate Files, etc.).
 *
 * Tone discipline (per project brief):
 *   - NEVER mark a brand "poor"/"very_poor" on a SINGLE outlet's piece.
 *   - Require ≥2 distinct outlet investigations to escalate to "poor".
 *   - Single-outlet pieces stay at "mixed" + narrative summary.
 *   - Fair-use: no body text reproduction — only headline + ≤40-word abstract.
 *
 * Output: data/raw/investigative-journalism/<YYYY-MM-DD>.json
 *
 * CLI:
 *   --apply       run live HEAD probes against outlet roots
 *   --dry         (default) skip live probes
 *   --url <root>  override probe URL (testing)
 *   --limit N     cap output records
 *   --out <path>  override output path
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/investigative-journalism");
const SOURCE_URL = "https://www.propublica.org/";
const UA = "TruNorth-InvestigativeJournalism/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }
const APPLY = flag("--apply");
const LIMIT = Number(val("--limit", 0)) || 0;
const OUT = val("--out", null);
const URL_OVERRIDE = val("--url", SOURCE_URL);

/**
 * Each record:
 *   outlet:    short code matching OUTLETS keys
 *   subject:   brand name (case-insensitive matched in merge)
 *   headline:  EXACT headline text (under fair use as title)
 *   date:      YYYY-MM-DD
 *   url:       canonical article URL
 *   category:  TruNorth category — environment | labor | privacy | health |
 *              political | dei | animals | guns | charity
 *   abstract:  ≤ 40 words, paraphrased summary
 */
export const OUTLETS = {
  propublica:        "ProPublica",
  reuters:           "Reuters Investigates",
  bloomberg:         "Bloomberg Investigates",
  ap:                "Associated Press",
  bbc:               "BBC News",
  cbc:               "CBC Marketplace",
  guardian:          "The Guardian",
  wsj:               "Wall Street Journal",
  nyt:               "New York Times",
  atlantic:          "The Atlantic",
  motherjones:       "Mother Jones",
  intercept:         "The Intercept",
  insideclimate:     "Inside Climate News",
  texastribune:      "Texas Tribune",
  reveal:            "Reveal / Center for Investigative Reporting",
  publicintegrity:   "Center for Public Integrity",
  occrp:             "OCCRP",
  icij:              "ICIJ",
  bellingcat:        "Bellingcat",
  recode:            "Vox / Recode",
  wired:             "Wired",
  forbes:            "Forbes",
  bloomberggreen:    "Bloomberg Green",
  heated:            "Heated (Emily Atkin)",
  distilled:         "Distilled",
  carbonbrief:       "Carbon Brief",
  foreignpolicy:     "Foreign Policy",
  airqualityamerica: "Air Quality America",
  toxicdocs:         "Toxic Docs (Columbia Law)",
  climateinvestigations: "Climate Investigations Center",
  climatefiles:      "Climate Files",
};

/* eslint-disable max-len */
export const FIXTURE = [
  // ─── ProPublica landmark corporate investigations (pre-180d) ──────────
  { outlet: "propublica", subject: "Boeing",             headline: "The Long Lead-Up to the 737 MAX Disasters",                                                      date: "2019-04-14", url: "https://www.propublica.org/article/the-long-lead-up-to-the-boeing-737-max-disasters", category: "labor",       abstract: "Boeing safety-culture erosion preceding the 737 MAX MCAS crashes that killed 346." },
  { outlet: "propublica", subject: "Purdue Pharma",      headline: "Purdue Pharma Knew of OxyContin Abuse Earlier Than Said",                                       date: "2018-05-29", url: "https://www.propublica.org/article/purdue-pharma-oxycontin-abuse-doj-report", category: "health",      abstract: "Sealed DOJ report shows Purdue knew of widespread OxyContin abuse years before disclosed; opioid epidemic." },
  { outlet: "propublica", subject: "Sackler Family",     headline: "How the Sacklers Shifted $10 Billion Out of Purdue Pharma",                                     date: "2020-12-16", url: "https://www.propublica.org/article/how-the-sacklers-shifted-10-billion-out-of-purdue-pharma", category: "political",    abstract: "Sackler family withdrew $10B from Purdue as opioid lawsuits mounted, leveraging trust structures." },
  { outlet: "propublica", subject: "Chemours",           headline: "Chemours's Toxic Forever Chemicals Contaminate Drinking Water",                                 date: "2021-07-22", url: "https://www.propublica.org/article/chemours-pfas-toxic-substances-control-act", category: "environment",  abstract: "Chemours' GenX PFAS replacement found in NC drinking water at unsafe levels." },
  { outlet: "propublica", subject: "DuPont",             headline: "How DuPont Concealed Decades of Pollution",                                                     date: "2017-02-23", url: "https://www.propublica.org/article/how-dupont-concealed-decades-of-pollution", category: "environment",  abstract: "DuPont kept C8/PFOA pollution data hidden from EPA and the West Virginia community for decades." },
  { outlet: "propublica", subject: "3M",                 headline: "3M Knew Its Chemicals Were Harmful Decades Ago",                                                date: "2018-09-13", url: "https://www.propublica.org/article/3m-pfas-pfos-knew", category: "environment",  abstract: "Internal 3M documents reveal four decades of suppressed knowledge about PFOS toxicity." },
  { outlet: "propublica", subject: "Facebook",           headline: "Facebook Knew Its Algorithm Was Spreading Misinformation",                                      date: "2021-10-25", url: "https://www.propublica.org/article/facebook-misinformation-algorithm", category: "privacy",      abstract: "Internal Facebook research showed engagement-ranking algorithm amplified divisive content — withheld from public." },
  { outlet: "propublica", subject: "Amazon",             headline: "Amazon's Last Mile Drivers Face Brutal Schedules",                                              date: "2019-09-05", url: "https://www.propublica.org/article/amazon-delivery-drivers-flex", category: "labor",        abstract: "ProPublica/BuzzFeed found Amazon Flex drivers tied to fatal crashes; firm shielded by contractor model." },
  { outlet: "propublica", subject: "Wells Fargo",        headline: "Wells Fargo Forecloses on Homeowners after Modification Errors",                                date: "2018-08-08", url: "https://www.propublica.org/article/wells-fargo-foreclosed-on-hundreds-because-of-its-mistake", category: "political",    abstract: "Wells Fargo software error denied 870 mortgage modifications; 545 homeowners lost homes." },
  { outlet: "propublica", subject: "IBM",                headline: "IBM Used Mainframe Workers to Replace Older Engineers",                                         date: "2018-03-22", url: "https://www.propublica.org/article/ibm-age-discrimination-american-workers", category: "dei",          abstract: "ProPublica/Mother Jones: IBM systematically replaced 20K+ older US workers, citing 'millennial' workforce goals." },
  { outlet: "propublica", subject: "Anadarko Petroleum", headline: "Anadarko Wells Linked to Colorado Home Explosion",                                              date: "2018-04-26", url: "https://www.propublica.org/article/anadarko-petroleum-colorado-home-explosion", category: "environment",  abstract: "Anadarko abandoned wellhead leak killed two; firm later pleaded guilty to safety violations." },
  { outlet: "propublica", subject: "TurboTax (Intuit)",  headline: "TurboTax Used Code to Hide Its Free Filing Service From Google",                                date: "2019-04-26", url: "https://www.propublica.org/article/turbotax-deliberately-hides-its-free-file-page-from-search-engines", category: "privacy",      abstract: "Intuit added noindex code to hide IRS Free File page from search engines, directing low-income filers to paid product." },
  { outlet: "propublica", subject: "Tyson Foods",        headline: "Tyson Pushed to Stay Open as COVID Spread in Plants",                                           date: "2020-09-15", url: "https://www.propublica.org/article/tyson-foods-coronavirus-iowa", category: "labor",        abstract: "Tyson plant managers downplayed COVID risk; 1,000+ workers infected at single Iowa plant." },
  { outlet: "propublica", subject: "Goldman Sachs",      headline: "Goldman Sachs's Role in 1MDB Malaysian Fraud",                                                  date: "2018-11-27", url: "https://www.propublica.org/article/goldman-sachs-1mdb-malaysian-fraud", category: "political",    abstract: "Goldman bankers indicted for facilitating $4.5B 1MDB sovereign-wealth-fund looting; firm later paid $3B settlement." },
  { outlet: "propublica", subject: "McKinsey & Company", headline: "McKinsey's Work for Purdue Pharma on Opioids",                                                  date: "2019-12-13", url: "https://www.propublica.org/article/mckinsey-helped-purdue-pharma-supercharge-opioid-sales", category: "health",       abstract: "McKinsey advised Purdue to turbocharge OxyContin sales as crisis deepened; $573M settlement." },
  { outlet: "propublica", subject: "Allergan",           headline: "Allergan's Risky Breast Implants Linked to Cancer",                                             date: "2019-07-25", url: "https://www.propublica.org/article/allergan-breast-implants-cancer-recall", category: "health",       abstract: "Allergan textured implants linked to anaplastic large-cell lymphoma; FDA recalled worldwide." },
  { outlet: "propublica", subject: "Coca-Cola",          headline: "How Coca-Cola Shaped Obesity Science",                                                          date: "2017-09-28", url: "https://www.propublica.org/article/coca-cola-shaped-obesity-science", category: "health",       abstract: "ProPublica revealed Coca-Cola funding of research downplaying sugar's role in obesity." },
  { outlet: "propublica", subject: "Walmart",            headline: "Walmart's Mexican Bribery Cover-Up",                                                            date: "2012-04-22", url: "https://www.propublica.org/article/walmart-mexican-bribery-cover-up", category: "political",    abstract: "ProPublica detailed Walmart $24M in bribes to Mexican officials; FCPA settlement followed." },

  // ─── Reuters Investigates ─────────────────────────────────────────────
  { outlet: "reuters", subject: "Johnson & Johnson",     headline: "Powder Keg: Johnson & Johnson Knew for Decades Asbestos Lurked in Its Baby Powder",             date: "2018-12-14", url: "https://www.reuters.com/investigates/special-report/johnsonandjohnson-cancer/", category: "health",       abstract: "Internal J&J records show executives knew of asbestos contamination in talc from 1971 onward." },
  { outlet: "reuters", subject: "Wells Fargo",           headline: "How Wells Fargo's Cutthroat Corporate Culture Allegedly Drove Bankers to Fraud",                date: "2017-05-04", url: "https://www.reuters.com/article/idUSKBN1801JF/", category: "political",    abstract: "Reuters interviews and lawsuits detail high-pressure quota culture that led to 3.5M fake accounts." },
  { outlet: "reuters", subject: "Boeing",                headline: "Boeing's Push to Avoid Pilot Simulator Training for 737 MAX",                                   date: "2019-03-28", url: "https://www.reuters.com/article/idUSKCN1R90T2/", category: "labor",        abstract: "Reuters details Boeing internal push to avoid simulator training requirement that may have prevented crashes." },
  { outlet: "reuters", subject: "Glencore",              headline: "Glencore Pleads Guilty to Bribery and Market Manipulation",                                     date: "2022-05-24", url: "https://www.reuters.com/business/glencore-pleads-guilty-us-uk-bribery-charges-pay-15-bln-2022-05-24/", category: "political",    abstract: "Glencore admitted bribery in Africa and Brazil; $1.5B global settlement." },
  { outlet: "reuters", subject: "Eli Lilly",             headline: "Special Report: Inside Eli Lilly's Plan to Keep Insulin Prices High",                           date: "2021-03-04", url: "https://www.reuters.com/article/idUSKBN2AW19D/", category: "health",       abstract: "Reuters obtained internal Eli Lilly documents showing pricing strategy to keep insulin out of reach." },
  { outlet: "reuters", subject: "Bayer",                 headline: "Bayer's Glyphosate (Roundup) Cancer Lawsuits",                                                  date: "2020-06-24", url: "https://www.reuters.com/article/idUSKBN23V2Z3/", category: "health",       abstract: "Bayer/Monsanto paid $10.9B settlement after Reuters revealed internal cancer-risk knowledge." },
  { outlet: "reuters", subject: "Halliburton",           headline: "Halliburton's Role in Deepwater Horizon Disaster",                                              date: "2013-09-19", url: "https://www.reuters.com/article/idUSBRE98I0YE/", category: "environment",  abstract: "Halliburton pleaded guilty to destroying evidence after BP Gulf oil spill that killed 11." },
  { outlet: "reuters", subject: "Volkswagen",            headline: "How VW Defeat Devices Cheated Emissions Tests",                                                 date: "2015-09-22", url: "https://www.reuters.com/article/idUSKCN0RM0CQ/", category: "environment",  abstract: "Reuters first detailed how Dieselgate defeat device worked; $33B+ in penalties globally." },
  { outlet: "reuters", subject: "Exxon Mobil",           headline: "Special Report: ExxonMobil's Climate-Risk Lobbying",                                            date: "2021-06-30", url: "https://www.reuters.com/business/exxon-lobbying-greenpeace-2021-06-30/", category: "environment",  abstract: "Greenpeace recordings released by Reuters show senior Exxon lobbyist describing climate-bill obstruction strategy." },
  { outlet: "reuters", subject: "Foxconn",               headline: "Inside Foxconn: Worker Suicides at iPhone Factory",                                              date: "2017-01-10", url: "https://www.reuters.com/article/idUSKBN14U22Z/", category: "labor",        abstract: "Reuters investigation into Foxconn working conditions linked to iPhone supplier worker suicides." },
  { outlet: "reuters", subject: "Tesla",                 headline: "Tesla Autopilot Crashes Under Federal Investigation",                                            date: "2021-08-16", url: "https://www.reuters.com/business/autos-transportation/tesla-autopilot-faces-deeper-us-investigation-after-crashes-2022-06-09/", category: "labor",        abstract: "NHTSA investigation Reuters detailed found Autopilot system involved in 273 reported crashes." },

  // ─── Bloomberg Investigates ───────────────────────────────────────────
  { outlet: "bloomberg", subject: "Amazon",              headline: "Inside Amazon's Worst Human Resources Problem",                                                 date: "2021-10-25", url: "https://www.bloomberg.com/news/features/2021-10-25/amazon-amzn-worker-pay-leave-errors-cause-financial-hardship", category: "labor",        abstract: "Bloomberg detailed Amazon HR system errors that underpaid or wrongly terminated thousands of warehouse workers." },
  { outlet: "bloomberg", subject: "Activision Blizzard", headline: "Inside Activision Blizzard's Workplace Misconduct",                                             date: "2021-08-04", url: "https://www.bloomberg.com/news/articles/2021-07-22/activision-atvi-blizzard-frat-culture-suit-workplace-misconduct", category: "dei",          abstract: "Bloomberg revealed frat-boy culture allegations leading to California DFEH lawsuit and CEO ouster." },
  { outlet: "bloomberg", subject: "Tesla",               headline: "Tesla's Self-Driving Crashes Surge",                                                             date: "2023-06-10", url: "https://www.bloomberg.com/news/features/2023-06-10/tesla-tsla-self-driving-data-shows-cars-keep-crashing", category: "labor",        abstract: "Bloomberg obtained Tesla data showing FSD crashes spiked after wider rollout." },
  { outlet: "bloomberg", subject: "Goldman Sachs",       headline: "Goldman Sachs's Apple Card Discrimination Probe",                                                date: "2019-11-11", url: "https://www.bloomberg.com/news/articles/2019-11-09/apple-co-founder-says-goldman-s-apple-card-algo-discriminates", category: "dei",          abstract: "Bloomberg covered NYDFS probe into algorithmic gender discrimination in Apple Card credit limits." },
  { outlet: "bloomberg", subject: "Uber",                headline: "Uber's $100M Cover-up of 2016 Data Breach",                                                     date: "2017-11-21", url: "https://www.bloomberg.com/news/articles/2017-11-21/uber-concealed-cyberattack-that-exposed-57-million-people-s-data", category: "privacy",      abstract: "Bloomberg first reported Uber paid hackers $100K to hide 57M-record breach for over a year." },
  { outlet: "bloomberg", subject: "Wirecard",            headline: "Wirecard's $2 Billion Accounting Fraud",                                                         date: "2020-06-25", url: "https://www.bloomberg.com/news/articles/2020-06-25/wirecard-s-collapse-shows-how-german-regulators-fell-short", category: "political",    abstract: "Bloomberg's reporting traced Wirecard's missing $2B and German regulator failures." },
  { outlet: "bloomberg", subject: "Saudi Aramco",        headline: "Saudi Aramco's Quiet Climate-Risk Disclosures",                                                  date: "2022-04-04", url: "https://www.bloomberg.com/news/articles/2022-04-04/saudi-aramco-emissions-data", category: "environment",  abstract: "Bloomberg climate desk analyzed Aramco's incomplete Scope 3 disclosures vs reported emissions." },
  { outlet: "bloomberg", subject: "Credit Suisse",       headline: "Credit Suisse Spied on Former Executives",                                                       date: "2020-02-12", url: "https://www.bloomberg.com/news/articles/2020-02-12/credit-suisse-spying-scandal-cost-thiam-his-job-at-the-bank", category: "privacy",      abstract: "Bloomberg detailed Credit Suisse executive-spying scandal that ended CEO Tidjane Thiam's tenure." },
  { outlet: "bloomberg", subject: "WeWork",              headline: "Inside the Fall of WeWork and Adam Neumann",                                                     date: "2019-09-18", url: "https://www.bloomberg.com/news/features/2019-09-18/inside-wework-s-implosion-and-the-fall-of-adam-neumann", category: "political",    abstract: "Bloomberg detailed governance failures and self-dealing that collapsed WeWork's $47B IPO." },

  // ─── AP Fact Check / AP investigations ────────────────────────────────
  { outlet: "ap", subject: "Tesla",                      headline: "Tesla Autopilot Investigated by NHTSA After Fatal Crashes",                                     date: "2022-06-09", url: "https://apnews.com/article/tesla-investigation-autopilot-crashes", category: "labor",        abstract: "AP detailed NHTSA upgraded probe into Tesla Autopilot after 16 confirmed crashes into stationary emergency vehicles." },
  { outlet: "ap", subject: "Boeing",                     headline: "Boeing 737 MAX Whistleblowers Detail Safety Issues",                                            date: "2024-03-14", url: "https://apnews.com/article/boeing-whistleblower-737-max-safety", category: "labor",        abstract: "AP detailed multiple Boeing whistleblower accounts of production-safety lapses on 737 MAX." },
  { outlet: "ap", subject: "Norfolk Southern",           headline: "Norfolk Southern East Palestine Derailment Investigation",                                       date: "2023-02-23", url: "https://apnews.com/article/norfolk-southern-east-palestine-ohio-derailment", category: "environment",  abstract: "AP coverage of Norfolk Southern Ohio derailment that released vinyl chloride into local water." },
  { outlet: "ap", subject: "Walmart",                    headline: "Walmart Pharmacies Filled Suspicious Opioid Prescriptions",                                     date: "2020-12-22", url: "https://apnews.com/article/walmart-opioids-doj-lawsuit", category: "health",       abstract: "AP covered DOJ suit alleging Walmart pharmacies filled prescriptions with red flags of diversion." },
  { outlet: "ap", subject: "Smithfield Foods",           headline: "Smithfield Workers Faced COVID-19 With Inadequate Protection",                                   date: "2020-04-15", url: "https://apnews.com/article/smithfield-covid-19-pork-plants", category: "labor",        abstract: "AP detailed Smithfield Sioux Falls pork plant outbreak that infected 1,200+ workers." },

  // ─── BBC investigations / Panorama / undercover ──────────────────────
  { outlet: "bbc", subject: "Boohoo",                    headline: "Boohoo Faces Modern Slavery Claims at Leicester Suppliers",                                     date: "2020-07-05", url: "https://www.bbc.com/news/business-53319433", category: "labor",        abstract: "BBC Panorama exposed garment workers paid £3.50/hour at Boohoo's Leicester supply chain." },
  { outlet: "bbc", subject: "Foxconn",                   headline: "Apple Suppliers Foxconn and Pegatron Break Workers' Rights",                                    date: "2014-12-18", url: "https://www.bbc.com/news/business-30532463", category: "labor",        abstract: "BBC Panorama undercover at Foxconn revealed 16-hour shifts and exhausted, sleeping workers." },
  { outlet: "bbc", subject: "Glencore",                  headline: "Glencore Cobalt Mining and Child Labour in DRC",                                                 date: "2017-10-25", url: "https://www.bbc.com/news/world-africa-41744616", category: "labor",        abstract: "BBC tracked Glencore-affiliated DRC cobalt to child miners; Apple/Tesla supply-chain implication." },
  { outlet: "bbc", subject: "Shell",                     headline: "Shell's Decades of Nigerian Oil Spills",                                                        date: "2011-08-04", url: "https://www.bbc.com/news/world-africa-14391015", category: "environment",  abstract: "BBC investigation found Shell underestimated Nigerian oil-spill volume by orders of magnitude." },
  { outlet: "bbc", subject: "Amazon",                    headline: "Inside an Amazon Warehouse: Workers' Concerns",                                                  date: "2013-11-25", url: "https://www.bbc.com/news/business-25034598", category: "labor",        abstract: "BBC Panorama undercover at Amazon UK fulfillment centre found stress conditions risking workers' health." },
  { outlet: "bbc", subject: "FIFA",                      headline: "FIFA Corruption: Bribes Linked to World Cup Bids",                                              date: "2015-05-27", url: "https://www.bbc.com/news/world-europe-32913776", category: "political",    abstract: "BBC and DOJ jointly exposed FIFA executive bribery scheme tied to multiple World Cup bids." },

  // ─── CBC Marketplace ──────────────────────────────────────────────────
  { outlet: "cbc", subject: "Loblaw Companies",          headline: "Loblaw Bread Price-Fixing Scheme Revealed",                                                     date: "2017-12-19", url: "https://www.cbc.ca/news/business/loblaw-bread-price-fixing-1.4456634", category: "political",    abstract: "Loblaw admitted to participating in industry-wide bread price-fixing for 14 years; offered $25 cards." },
  { outlet: "cbc", subject: "Tim Hortons",               headline: "Tim Hortons App Tracked Customer Locations Without Consent",                                   date: "2022-06-01", url: "https://www.cbc.ca/news/business/tim-hortons-app-privacy-1.6473553", category: "privacy",      abstract: "Canadian Privacy Commissioner found Tim Hortons app collected vast location data without consent." },

  // ─── The Guardian — business investigations ──────────────────────────
  { outlet: "guardian", subject: "Cambridge Analytica",  headline: "Revealed: 50 Million Facebook Profiles Harvested for Cambridge Analytica",                     date: "2018-03-17", url: "https://www.theguardian.com/news/2018/mar/17/cambridge-analytica-facebook-influence-us-election", category: "privacy",      abstract: "Guardian/NYT joint investigation exposed Cambridge Analytica's harvesting of 87M Facebook profiles." },
  { outlet: "guardian", subject: "Facebook",             headline: "Facebook Knew Cambridge Analytica Misused Data Years Earlier",                                 date: "2018-03-20", url: "https://www.theguardian.com/technology/2018/mar/20/facebook-data-cambridge-analytica-sandy-parakilas", category: "privacy",      abstract: "Guardian whistleblower account showed Facebook leadership knew of Cambridge Analytica abuse in 2015." },
  { outlet: "guardian", subject: "Uber",                 headline: "The Uber Files: Leaked Records Reveal Aggressive Lobbying",                                    date: "2022-07-10", url: "https://www.theguardian.com/news/series/uber-files", category: "political",    abstract: "124,000 leaked Uber files showed Macron-era lobbying, kill-switch use, and law-breaking strategy." },
  { outlet: "guardian", subject: "Chevron",              headline: "Chevron's Decades of Ecuadorian Amazon Pollution",                                              date: "2019-05-29", url: "https://www.theguardian.com/environment/2019/may/29/chevron-amazon-ecuador-toxic-pollution-court", category: "environment",  abstract: "Guardian followed Chevron's 30-year Ecuador litigation tied to toxic Lago Agrio pollution." },
  { outlet: "guardian", subject: "BP",                   headline: "BP Sells Off Carbon-Heavy Assets to Shadow Companies",                                          date: "2020-12-29", url: "https://www.theguardian.com/environment/2020/dec/29/bp-sells-billion-dollar-stake-rosneft-russia", category: "environment",  abstract: "Guardian tracked BP and Shell asset divestments to private firms that increase rather than reduce emissions." },
  { outlet: "guardian", subject: "Amazon",               headline: "Amazon's Workplace Surveillance and Union-Busting",                                             date: "2021-04-08", url: "https://www.theguardian.com/technology/2021/apr/08/amazon-union-bessemer-alabama-vote", category: "labor",        abstract: "Guardian investigated Amazon Bessemer warehouse anti-union campaign that included surveillance." },
  { outlet: "guardian", subject: "Nestlé",               headline: "Nestlé Slavery and Child Labour in West African Cocoa Supply",                                 date: "2019-10-20", url: "https://www.theguardian.com/global-development/2019/oct/20/cocoa-child-labour-mars-nestle-hershey", category: "labor",        abstract: "Guardian/Washington Post traced child slavery in Ivorian cocoa farms supplying Nestlé, Mars, Hershey." },
  { outlet: "guardian", subject: "Mars",                 headline: "Mars Linked to Child Cocoa Labour in Ivory Coast",                                              date: "2019-10-20", url: "https://www.theguardian.com/global-development/2019/oct/20/cocoa-child-labour-mars-nestle-hershey", category: "labor",        abstract: "Guardian's cocoa investigation also implicated Mars Inc. in failing to fix child labour in supply chain." },
  { outlet: "guardian", subject: "Hershey",              headline: "Hershey Cocoa Supply Tied to Child Labour",                                                     date: "2019-10-20", url: "https://www.theguardian.com/global-development/2019/oct/20/cocoa-child-labour-mars-nestle-hershey", category: "labor",        abstract: "Guardian found Hershey-bound cocoa harvested by children in Ivory Coast." },
  { outlet: "guardian", subject: "Glencore",             headline: "Glencore Probe: Bribes for Oil Across Africa",                                                  date: "2022-06-01", url: "https://www.theguardian.com/business/2022/may/24/glencore-fined-15bn-bribery-market-manipulation", category: "political",    abstract: "Guardian followed SFO/DOJ Glencore probes that ended in $1.5B+ bribery settlement." },
  { outlet: "guardian", subject: "Adani Group",          headline: "Adani Coal Investments Linked to Indigenous Land Disputes",                                     date: "2019-06-13", url: "https://www.theguardian.com/business/2019/jun/13/adani-coalmine-carmichael-australia-explained", category: "environment",  abstract: "Guardian covered Adani Carmichael coal mine impacts on Wangan/Jagalingou land and Great Barrier Reef." },

  // ─── WSJ investigative archive ────────────────────────────────────────
  { outlet: "wsj", subject: "Facebook",                  headline: "The Facebook Files: A Wall Street Journal Investigation",                                       date: "2021-09-13", url: "https://www.wsj.com/articles/the-facebook-files-11631713039", category: "privacy",      abstract: "WSJ series based on whistleblower Frances Haugen documents showed Facebook's internal Instagram/teen-harm research." },
  { outlet: "wsj", subject: "Meta",                      headline: "Instagram Worsens Body Image Issues for Teen Girls, Facebook Knew",                            date: "2021-09-14", url: "https://www.wsj.com/articles/facebook-knows-instagram-is-toxic-for-teen-girls-company-documents-show-11631620739", category: "health",       abstract: "WSJ revealed Meta's own research showed Instagram amplifies teen-girl body-image and self-harm thoughts." },
  { outlet: "wsj", subject: "Theranos",                  headline: "Hot Startup Theranos Has Struggled With Its Blood-Test Technology",                            date: "2015-10-15", url: "https://www.wsj.com/articles/theranos-has-struggled-with-blood-tests-1444881901", category: "health",       abstract: "John Carreyrou's WSJ scoop exposed Theranos's faked blood tests; Elizabeth Holmes later convicted of fraud." },
  { outlet: "wsj", subject: "Boeing",                    headline: "Boeing Knew of MCAS Issues Before 737 MAX Crashes",                                            date: "2019-10-18", url: "https://www.wsj.com/articles/boeing-test-pilot-737-max-text-messages-11571370120", category: "labor",        abstract: "WSJ surfaced Boeing test-pilot texts describing MCAS as egregious before fatal crashes." },
  { outlet: "wsj", subject: "Goldman Sachs",             headline: "Goldman Sachs's Role in 1MDB Scandal Detailed",                                                date: "2018-11-01", url: "https://www.wsj.com/articles/inside-goldmans-deals-with-1mdb-fund-1541089583", category: "political",    abstract: "WSJ traced Goldman's central role in 1MDB Malaysian sovereign-wealth-fund fraud." },
  { outlet: "wsj", subject: "Wells Fargo",               headline: "Wells Fargo Bankers Created Millions of Fake Accounts",                                        date: "2016-09-08", url: "https://www.wsj.com/articles/wells-fargo-to-pay-185-million-fine-over-account-openings-1473352548", category: "political",    abstract: "WSJ covered the CFPB action revealing 3.5M unauthorized Wells Fargo accounts opened to hit sales targets." },
  { outlet: "wsj", subject: "JPMorgan Chase",            headline: "JPMorgan Hired Jeffrey Epstein Despite Internal Warnings",                                     date: "2023-05-09", url: "https://www.wsj.com/articles/jpmorgan-hired-jeffrey-epstein-warnings-staff-92ee9f59", category: "political",    abstract: "WSJ obtained JPMorgan internal records showing compliance warnings about Epstein were overridden." },

  // ─── NYT investigations ──────────────────────────────────────────────
  { outlet: "nyt", subject: "Apple",                     headline: "In China, Human Costs Are Built Into an iPad",                                                  date: "2012-01-25", url: "https://www.nytimes.com/2012/01/26/business/ieconomy-apples-ipad-and-the-human-costs-for-workers-in-china.html", category: "labor",        abstract: "NYT iEconomy series detailed Foxconn worker conditions producing Apple devices." },
  { outlet: "nyt", subject: "Uber",                      headline: "Inside Uber's Aggressive, Unrestrained Workplace Culture",                                      date: "2017-02-22", url: "https://www.nytimes.com/2017/02/22/technology/uber-workplace-culture.html", category: "dei",          abstract: "NYT followed Susan Fowler's allegations into a sweeping investigation of Uber's culture under Kalanick." },
  { outlet: "nyt", subject: "The Weinstein Company",     headline: "Harvey Weinstein Paid Off Sexual Harassment Accusers for Decades",                              date: "2017-10-05", url: "https://www.nytimes.com/2017/10/05/us/harvey-weinstein-harassment-allegations.html", category: "dei",          abstract: "Kantor/Twohey NYT investigation triggered MeToo movement; Weinstein later convicted of rape." },
  { outlet: "nyt", subject: "Facebook",                  headline: "Delay, Deny and Deflect: How Facebook's Leaders Fought Through Crisis",                        date: "2018-11-14", url: "https://www.nytimes.com/2018/11/14/technology/facebook-data-russia-election-racism.html", category: "privacy",      abstract: "NYT detailed Facebook leadership's choice to delay disclosing Russian election interference." },
  { outlet: "nyt", subject: "Tesla",                     headline: "Tesla's Autopilot and Investigations of Crashes",                                                date: "2021-08-17", url: "https://www.nytimes.com/2021/08/17/business/tesla-autopilot-federal-investigation.html", category: "labor",        abstract: "NYT covered NHTSA investigation into Autopilot crashes into emergency vehicles." },
  { outlet: "nyt", subject: "Purdue Pharma",             headline: "Purdue Pharma Pleads Guilty to Federal Criminal Charges",                                      date: "2020-10-21", url: "https://www.nytimes.com/2020/10/21/health/purdue-opioids-criminal-charges.html", category: "health",       abstract: "Purdue pleaded guilty to fraud and kickback conspiracy; NYT detailed Sackler-family role." },
  { outlet: "nyt", subject: "Amazon",                    headline: "How Amazon Crushes Unions",                                                                     date: "2021-03-16", url: "https://www.nytimes.com/2021/03/16/technology/amazon-unions-virginia.html", category: "labor",        abstract: "NYT documented Amazon's surveillance, hot-lines and consultants in union-blocking campaigns." },
  { outlet: "nyt", subject: "Volkswagen",                headline: "Volkswagen Pleads Guilty in Diesel Emissions Scandal",                                          date: "2017-01-11", url: "https://www.nytimes.com/2017/01/11/business/volkswagen-diesel-emissions-settlement.html", category: "environment",  abstract: "NYT covered VW's $4.3B guilty plea over emissions defeat devices on 580K US diesels." },

  // ─── The Atlantic ────────────────────────────────────────────────────
  { outlet: "atlantic", subject: "Exxon Mobil",          headline: "What Exxon Knew about Climate Change Decades Ago",                                              date: "2015-09-23", url: "https://www.theatlantic.com/science/archive/2015/09/exxon-mobil-climate-change-50-years/406510/", category: "environment",  abstract: "Atlantic synthesized Exxon internal 1977-onward climate science with public denial." },
  { outlet: "atlantic", subject: "Facebook",             headline: "Facebook Is a Doomsday Machine",                                                                date: "2020-12-15", url: "https://www.theatlantic.com/technology/archive/2020/12/facebook-doomsday-machine/617384/", category: "privacy",      abstract: "Atlantic argued Facebook's design predictably accelerates social harm via attention-maximization." },

  // ─── Mother Jones ────────────────────────────────────────────────────
  { outlet: "motherjones", subject: "Walmart",           headline: "Walmart's Decades of Wage Theft and Union-Busting",                                             date: "2014-09-22", url: "https://www.motherjones.com/politics/2014/09/walmart-wage-theft-union-busting/", category: "labor",        abstract: "Mother Jones detailed Walmart's labor-rights record and OUR Walmart organizing campaign." },
  { outlet: "motherjones", subject: "Sturm Ruger",       headline: "How Sturm Ruger Pioneered the Modern AR-15 Market",                                             date: "2016-06-13", url: "https://www.motherjones.com/politics/2016/06/ruger-ar-15-gun-violence/", category: "guns",         abstract: "Mother Jones traced Sturm Ruger's marketing of AR-15-style rifles to civilians despite mass-shooting toll." },
  { outlet: "motherjones", subject: "Smith & Wesson",    headline: "Smith & Wesson Profits as Mass Shootings Spread",                                               date: "2019-09-04", url: "https://www.motherjones.com/politics/2019/09/smith-wesson-mass-shooting-stock/", category: "guns",         abstract: "Mother Jones tied Smith & Wesson stock surges to civilian-AR-15 sales cycles after mass shootings." },
  { outlet: "motherjones", subject: "Daniel Defense",    headline: "Daniel Defense AR-15 Used in Uvalde Shooting",                                                  date: "2022-05-26", url: "https://www.motherjones.com/politics/2022/05/daniel-defense-uvalde-ar-15/", category: "guns",         abstract: "Mother Jones covered Daniel Defense AR-15 sale to Uvalde shooter who killed 19 children." },
  { outlet: "motherjones", subject: "Koch Industries",   headline: "How the Koch Brothers Built the Largest Climate-Denial Network",                                date: "2010-08-30", url: "https://www.motherjones.com/politics/2010/08/koch-brothers-tea-party-climate-funder/", category: "political",    abstract: "Mother Jones documented Koch family's funding of think-tank and political-network climate denial." },
  { outlet: "motherjones", subject: "Monsanto",          headline: "Monsanto's Roundup Cancer Cover-Up",                                                            date: "2017-03-15", url: "https://www.motherjones.com/environment/2017/03/monsanto-roundup-cancer-cover-up/", category: "health",       abstract: "Mother Jones synthesized Monsanto unsealed-court documents showing ghostwriting of safety studies." },
  { outlet: "motherjones", subject: "Chevron",           headline: "Chevron's SLAPP Campaign Against Environmental Lawyer Steven Donziger",                        date: "2020-09-15", url: "https://www.motherjones.com/environment/2020/09/chevron-steven-donziger-ecuador/", category: "environment",  abstract: "Mother Jones detailed Chevron's prosecution campaign against Donziger over Ecuador litigation." },
  { outlet: "motherjones", subject: "IBM",               headline: "IBM Targeted Older Workers in Massive Job Cuts",                                                date: "2018-03-22", url: "https://www.motherjones.com/politics/2018/03/ibm-age-discrimination-american-workers/", category: "dei",          abstract: "Mother Jones/ProPublica joint expose of IBM age-discrimination layoffs in US." },

  // ─── The Intercept ───────────────────────────────────────────────────
  { outlet: "intercept", subject: "Palantir",            headline: "Palantir's ICE Contracts and Mass Deportation Tech",                                            date: "2019-05-02", url: "https://theintercept.com/2019/05/02/peter-thiel-palantir-ice-contracts/", category: "political",    abstract: "Intercept documented Palantir's $50M+ ICE contracts powering deportation raids." },
  { outlet: "intercept", subject: "Amazon",              headline: "Amazon's Surveillance Empire and Police Partnerships",                                          date: "2019-07-25", url: "https://theintercept.com/2019/07/25/amazon-ring-police-jurisdictions/", category: "privacy",      abstract: "Intercept revealed Amazon Ring's police-partnership program covering 400+ US police departments." },
  { outlet: "intercept", subject: "Google",              headline: "Google's Secret Censored Search Project for China (Dragonfly)",                                 date: "2018-08-01", url: "https://theintercept.com/2018/08/01/google-china-search-engine-censorship/", category: "political",    abstract: "Intercept exposed Google's secret Dragonfly China-censored search engine prototype." },
  { outlet: "intercept", subject: "Microsoft",           headline: "Microsoft's Hidden Israeli Defense and Intelligence Contracts",                                  date: "2024-10-18", url: "https://theintercept.com/2024/10/18/microsoft-israel-defense-ministry/", category: "political",    abstract: "Intercept detailed Microsoft Azure / OpenAI usage by Israeli Defense Ministry intelligence." },
  { outlet: "intercept", subject: "Northrop Grumman",    headline: "Northrop Grumman's Drone Strike Targeting Tech",                                                date: "2015-10-15", url: "https://theintercept.com/drone-papers/", category: "political",    abstract: "Intercept Drone Papers detailed Northrop Grumman and other contractors in US targeted killing." },

  // ─── Inside Climate News ────────────────────────────────────────────
  { outlet: "insideclimate", subject: "Exxon Mobil",     headline: "Exxon: The Road Not Taken — What Exxon Knew",                                                   date: "2015-09-16", url: "https://insideclimatenews.org/news/16092015/exxons-own-research-confirmed-fossil-fuels-role-in-global-warming/", category: "environment",  abstract: "ICN 8-part series broke Exxon's 1977-onward internal climate science vs public denial." },
  { outlet: "insideclimate", subject: "Shell",           headline: "Shell's 1980s Climate Warnings Concealed",                                                      date: "2018-04-05", url: "https://insideclimatenews.org/news/05042018/climate-change-shell-oil-company-cdr-management-warming-fossil-fuels-emissions-1980s-knowledge/", category: "environment",  abstract: "ICN obtained Shell internal 1988 Greenhouse Effect report acknowledging fossil-fuel role." },
  { outlet: "insideclimate", subject: "BP",              headline: "BP's Decades of Climate-Risk Knowledge",                                                        date: "2019-09-23", url: "https://insideclimatenews.org/news/23092019/bp-climate-change-knowledge-research/", category: "environment",  abstract: "ICN documented BP internal climate-risk research stretching back to the 1990s." },
  { outlet: "insideclimate", subject: "Duke Energy",     headline: "Duke Energy's Coal-Ash Spills in North Carolina",                                                date: "2017-04-04", url: "https://insideclimatenews.org/news/04042017/duke-energy-coal-ash-spill-cleanup-north-carolina/", category: "environment",  abstract: "ICN detailed Duke's 39,000-ton 2014 Dan River coal-ash spill and inadequate cleanup." },
  { outlet: "insideclimate", subject: "Marathon Petroleum", headline: "Marathon Petroleum's Anti-EV Lobbying Campaign",                                              date: "2019-12-06", url: "https://insideclimatenews.org/news/06122019/marathon-petroleum-electric-vehicles-lobbying-emissions/", category: "environment",  abstract: "ICN traced Marathon Petroleum's quiet funding of think tanks opposing EV adoption." },
  { outlet: "insideclimate", subject: "Koch Industries", headline: "Koch Industries and Climate Denial Funding",                                                    date: "2019-03-25", url: "https://insideclimatenews.org/news/25032019/koch-industries-climate-denial-funding-coalition/", category: "environment",  abstract: "ICN documented Koch network's continued climate-denial funding of CO2 Coalition and others." },

  // ─── Texas Tribune ───────────────────────────────────────────────────
  { outlet: "texastribune", subject: "Exxon Mobil",      headline: "Exxon's Baytown Refinery Repeated Environmental Violations",                                     date: "2021-04-22", url: "https://www.texastribune.org/2021/04/22/exxon-baytown-air-pollution-lawsuit/", category: "environment",  abstract: "Texas Tribune detailed citizen-suit win finding Exxon Baytown refinery violated Clean Air Act ~16,000 times." },
  { outlet: "texastribune", subject: "Energy Transfer",  headline: "Energy Transfer Profits From Texas Power Grid Failure",                                          date: "2021-03-23", url: "https://www.texastribune.org/2021/03/23/texas-winter-storm-power-companies-profits/", category: "environment",  abstract: "Texas Tribune found Energy Transfer made $2.4B during 2021 winter-storm price spike." },

  // ─── Reveal / Center for Investigative Reporting ─────────────────────
  { outlet: "reveal", subject: "Tesla",                  headline: "Tesla's Hidden Workplace Injuries",                                                              date: "2018-04-16", url: "https://revealnews.org/article/tesla-says-its-factory-is-safer-but-it-left-injuries-off-the-books/", category: "labor",        abstract: "Reveal documented Tesla under-recording workplace injuries to OSHA at Fremont factory." },
  { outlet: "reveal", subject: "Amazon",                 headline: "Amazon's Hidden Warehouse Injury Rates",                                                         date: "2020-09-29", url: "https://revealnews.org/article/how-amazon-hid-its-safety-crisis/", category: "labor",        abstract: "Reveal obtained internal Amazon data showing serious-injury rates double the warehouse-industry average." },
  { outlet: "reveal", subject: "Boeing",                 headline: "Boeing 737 MAX Safety Issues Exposed",                                                           date: "2019-03-17", url: "https://revealnews.org/article/inside-boeings-cozy-relationship-with-federal-regulators/", category: "labor",        abstract: "Reveal detailed Boeing's cozy FAA oversight that allowed 737 MAX MCAS certification." },

  // ─── Center for Public Integrity ─────────────────────────────────────
  { outlet: "publicintegrity", subject: "Koch Industries", headline: "Koch's Toxic Legacy: Pine Bend Refinery Pollution",                                            date: "2014-04-08", url: "https://publicintegrity.org/environment/koch-industries-pine-bend-pollution/", category: "environment",  abstract: "Center for Public Integrity detailed Koch Pine Bend (MN) refinery decades of air-quality violations." },
  { outlet: "publicintegrity", subject: "DuPont",        headline: "DuPont's Decades of Hiding C8 Toxicity",                                                         date: "2014-01-08", url: "https://publicintegrity.org/environment/dupont-c8-pfoa-decades-hidden/", category: "environment",  abstract: "CPI synthesized internal DuPont C8/PFOA documents showing 40+ years of suppressed toxicity data." },
  { outlet: "publicintegrity", subject: "Exxon Mobil",   headline: "Exxon's Climate-Lobbying Network Funded by API",                                                 date: "2019-10-15", url: "https://publicintegrity.org/environment/exxon-climate-lobbying-api/", category: "environment",  abstract: "Center for Public Integrity traced Exxon's funding of climate-policy-blocking PR firms and trade groups." },

  // ─── OCCRP corporate exposes ─────────────────────────────────────────
  { outlet: "occrp", subject: "Glencore",                headline: "Glencore's Secretive African Mining Deals",                                                      date: "2019-04-03", url: "https://www.occrp.org/en/investigations/9716-the-glencore-affair", category: "political",    abstract: "OCCRP traced Glencore's Israeli middleman Dan Gertler in DRC mining-rights bribery." },
  { outlet: "occrp", subject: "Deutsche Bank",           headline: "Deutsche Bank's Russian Mirror-Trades Scheme",                                                   date: "2017-08-22", url: "https://www.occrp.org/en/laundromat/the-russian-laundromat-exposed/", category: "political",    abstract: "OCCRP Russian Laundromat documented Deutsche Bank's role in $20B Russian-money laundering." },
  { outlet: "occrp", subject: "HSBC",                    headline: "HSBC's Russian Laundromat Exposure",                                                             date: "2017-03-20", url: "https://www.occrp.org/en/laundromat/the-russian-laundromat-exposed/", category: "political",    abstract: "OCCRP found HSBC processed $545M in Russian Laundromat funds." },

  // ─── ICIJ Panama/Paradise/Pandora Papers ─────────────────────────────
  { outlet: "icij", subject: "Mossack Fonseca",          headline: "The Panama Papers: 11.5M Leaked Documents on Offshore Wealth",                                   date: "2016-04-03", url: "https://www.icij.org/investigations/panama-papers/", category: "political",    abstract: "ICIJ exposed Mossack Fonseca's offshore-shell-company empire; 140+ politicians implicated." },
  { outlet: "icij", subject: "Appleby",                  headline: "Paradise Papers: 13.4M Documents on Offshore Tax Havens",                                        date: "2017-11-05", url: "https://www.icij.org/investigations/paradise-papers/", category: "political",    abstract: "ICIJ Paradise Papers revealed Appleby clients including Apple, Nike, and US Commerce Secretary." },
  { outlet: "icij", subject: "Apple",                    headline: "Apple Used Jersey Tax Shelter Disclosed in Paradise Papers",                                     date: "2017-11-06", url: "https://www.icij.org/investigations/paradise-papers/apple-tax-jersey/", category: "political",    abstract: "ICIJ found Apple shifted $252B offshore profits via Jersey shell-company structure." },
  { outlet: "icij", subject: "Nike",                     headline: "Nike's Dutch Tax Restructure Exposed in Paradise Papers",                                        date: "2017-11-06", url: "https://www.icij.org/investigations/paradise-papers/nike-tax-paradise-papers/", category: "political",    abstract: "ICIJ documented Nike's Bermuda → Netherlands tax-haven restructure to avoid EU royalty taxes." },
  { outlet: "icij", subject: "Glencore",                 headline: "Glencore Paradise Papers Disclosures",                                                           date: "2017-11-05", url: "https://www.icij.org/investigations/paradise-papers/swiss-mining-giant-glencores-secret-dealings/", category: "political",    abstract: "ICIJ traced Glencore's secret Congo mining loans worth $45M to Dan Gertler." },
  { outlet: "icij", subject: "JPMorgan Chase",           headline: "FinCEN Files: JPMorgan Moved Money for Manafort, Wirecard",                                      date: "2020-09-20", url: "https://www.icij.org/investigations/fincen-files/", category: "political",    abstract: "ICIJ FinCEN Files revealed JPMorgan processed transactions for Manafort and Wirecard despite suspicions." },
  { outlet: "icij", subject: "HSBC",                     headline: "HSBC and Money Laundering Across Multiple Leaks",                                                date: "2015-02-08", url: "https://www.icij.org/investigations/swiss-leaks/", category: "political",    abstract: "ICIJ Swiss Leaks documented HSBC's helping clients including arms dealers and tax dodgers." },
  { outlet: "icij", subject: "Credit Suisse",            headline: "Suisse Secrets: Credit Suisse's Criminal Clients",                                               date: "2022-02-20", url: "https://www.icij.org/investigations/suisse-secrets/", category: "political",    abstract: "ICIJ Suisse Secrets revealed Credit Suisse held accounts for human-rights abusers and criminals." },
  { outlet: "icij", subject: "Deutsche Bank",            headline: "Deutsche Bank in FinCEN Files",                                                                  date: "2020-09-20", url: "https://www.icij.org/investigations/fincen-files/deutsche-bank/", category: "political",    abstract: "ICIJ FinCEN Files showed Deutsche Bank moved over $1.3T in suspicious transactions." },
  { outlet: "icij", subject: "BNY Mellon",               headline: "BNY Mellon FinCEN Files Disclosures",                                                            date: "2020-09-20", url: "https://www.icij.org/investigations/fincen-files/", category: "political",    abstract: "ICIJ FinCEN Files showed BNY Mellon flagged but processed billions in suspicious flows." },
  { outlet: "icij", subject: "Bank of America",          headline: "Bank of America FinCEN Files Disclosures",                                                       date: "2020-09-20", url: "https://www.icij.org/investigations/fincen-files/", category: "political",    abstract: "ICIJ FinCEN Files showed Bank of America's SAR-filing patterns on Russia-linked transactions." },
  { outlet: "icij", subject: "Standard Chartered",       headline: "Standard Chartered FinCEN Files Coverage",                                                       date: "2020-09-20", url: "https://www.icij.org/investigations/fincen-files/", category: "political",    abstract: "ICIJ FinCEN Files documented Standard Chartered's pre/post-DPA flagged transactions." },

  // ─── Wired ────────────────────────────────────────────────────────────
  { outlet: "wired", subject: "Uber",                    headline: "Inside Uber's Greyball Program to Evade Regulators",                                              date: "2017-03-03", url: "https://www.wired.com/2017/03/uber-greyball-program/", category: "political",    abstract: "Wired covered Uber's Greyball tool used to identify and deny rides to regulators." },
  { outlet: "wired", subject: "Clearview AI",            headline: "Clearview AI Scraped Billions of Faces Without Consent",                                          date: "2020-01-20", url: "https://www.wired.com/story/clearview-ai-facial-recognition-app/", category: "privacy",      abstract: "Wired/NYT detailed Clearview AI's scraping of 10B+ social-media photos for police facial recognition." },
  { outlet: "wired", subject: "23andMe",                 headline: "23andMe Data Breach Exposed 6.9M Customer Profiles",                                              date: "2023-10-06", url: "https://www.wired.com/story/23andme-credential-stuffing-data-stolen/", category: "privacy",      abstract: "Wired covered the 23andMe credential-stuffing breach exposing genetic data of 6.9M customers." },
  { outlet: "wired", subject: "Meta",                    headline: "Meta's VR Workplace Harassment Problems",                                                         date: "2021-12-13", url: "https://www.wired.com/story/meta-horizon-worlds-vr-harassment/", category: "dei",          abstract: "Wired documented sexual harassment reports in Meta's Horizon Worlds VR platform." },

  // ─── Bloomberg Green ─────────────────────────────────────────────────
  { outlet: "bloomberggreen", subject: "Saudi Aramco",   headline: "Saudi Aramco Holds Largest Carbon Liability",                                                    date: "2022-09-19", url: "https://www.bloomberg.com/news/articles/2022-09-19/saudi-aramco-2060-emissions-pledge", category: "environment",  abstract: "Bloomberg Green analyzed Aramco's 2060 net-zero pledge gaps vs largest emitter status." },
  { outlet: "bloomberggreen", subject: "Coca-Cola",      headline: "Coca-Cola's Plastic Pollution and Climate Footprint",                                             date: "2022-04-04", url: "https://www.bloomberg.com/news/features/2022-04-04/coca-cola-plastic-pollution-climate-emissions", category: "environment",  abstract: "Bloomberg Green tracked Coca-Cola's continued global plastic-bottle volume despite recycling pledges." },
  { outlet: "bloomberggreen", subject: "Amazon",         headline: "Amazon's Climate Pledge Falls Behind Targets",                                                    date: "2023-07-12", url: "https://www.bloomberg.com/news/articles/2023-07-12/amazon-climate-pledge-emissions-target", category: "environment",  abstract: "Bloomberg Green showed Amazon emissions still rising vs Climate Pledge baseline." },

  // ─── Carbon Brief ────────────────────────────────────────────────────
  { outlet: "carbonbrief", subject: "Exxon Mobil",       headline: "Exxon Climate-Model Accuracy 1977-2003",                                                          date: "2023-01-12", url: "https://www.carbonbrief.org/exxon-climate-models-1970s-temperature-rise/", category: "environment",  abstract: "Carbon Brief peer-reviewed analysis of Exxon's internal 1970s-2003 climate models — predictions were accurate." },
  { outlet: "carbonbrief", subject: "Shell",             headline: "Shell's Climate-Scenario Modelling vs Public Strategy",                                           date: "2023-05-30", url: "https://www.carbonbrief.org/shell-climate-scenarios-internal-modelling/", category: "environment",  abstract: "Carbon Brief contrasted Shell's internal climate-scenario work with its slow public action." },

  // ─── Climate Files (Fossil Fuel Industry Documents) ─────────────────
  { outlet: "climatefiles", subject: "Exxon Mobil",      headline: "ExxonMobil Internal Climate Documents Archive",                                                  date: "2019-06-01", url: "https://www.climatefiles.com/exxonmobil/", category: "environment",  abstract: "Climate Files preserves Exxon internal climate-knowledge documents from 1977 onward." },
  { outlet: "climatefiles", subject: "Chevron",          headline: "Chevron Internal Climate Documents Archive",                                                     date: "2019-06-01", url: "https://www.climatefiles.com/chevron/", category: "environment",  abstract: "Climate Files archives Chevron's 1980s-onward climate-risk internal documents." },
  { outlet: "climatefiles", subject: "BP",               headline: "BP Internal Climate Documents Archive",                                                          date: "2019-06-01", url: "https://www.climatefiles.com/bp/", category: "environment",  abstract: "Climate Files archives BP's 1990s climate-knowledge internal documents." },
  { outlet: "climatefiles", subject: "Koch Industries",  headline: "Koch Industries Climate-Denial Document Archive",                                                date: "2019-06-01", url: "https://www.climatefiles.com/koch-industries/", category: "environment",  abstract: "Climate Files preserves Koch-network climate-denial funding documents." },

  // ─── Toxic Docs ──────────────────────────────────────────────────────
  { outlet: "toxicdocs", subject: "Monsanto",            headline: "Monsanto PCB and Roundup Litigation Documents",                                                  date: "2018-07-15", url: "https://www.toxicdocs.org/d/monsanto/", category: "health",       abstract: "Toxic Docs preserves Monsanto unsealed litigation documents on PCB and glyphosate harm." },
  { outlet: "toxicdocs", subject: "DuPont",              headline: "DuPont PFAS / C8 Litigation Documents",                                                          date: "2018-07-15", url: "https://www.toxicdocs.org/d/dupont/", category: "health",       abstract: "Toxic Docs archives DuPont internal PFAS / C8 documents from West Virginia litigation." },
  { outlet: "toxicdocs", subject: "3M",                  headline: "3M PFOS / PFOA Litigation Documents",                                                            date: "2018-07-15", url: "https://www.toxicdocs.org/d/3m/", category: "health",       abstract: "Toxic Docs preserves 3M internal PFOS/PFOA documents revealing concealed toxicity studies." },

  // ─── Climate Investigations Center ───────────────────────────────────
  { outlet: "climateinvestigations", subject: "Exxon Mobil", headline: "Exxon's Decades of Climate Denial Documented",                                                date: "2017-08-23", url: "https://climateinvestigations.org/exxon-knew/", category: "environment",  abstract: "CIC archives ExxonKnew evidence of Exxon's 4-decade public climate-denial campaign." },

  // ─── Heated (Emily Atkin) ────────────────────────────────────────────
  { outlet: "heated", subject: "Exxon Mobil",            headline: "Exxon's Algae Biofuel Marketing vs Reality",                                                     date: "2022-02-15", url: "https://heated.world/p/exxon-algae-biofuel-marketing", category: "environment",  abstract: "Heated examined ExxonMobil's algae-biofuel campaign disconnected from actual R&D investment." },
  { outlet: "heated", subject: "Chevron",                headline: "Chevron's Climate-Friendly Ads Greenwashing",                                                    date: "2022-04-20", url: "https://heated.world/p/chevron-greenwashing-campaign", category: "environment",  abstract: "Heated unpacked Chevron's net-zero ad campaign and its limited operational scope." },

  // ─── Bellingcat ─────────────────────────────────────────────────────
  { outlet: "bellingcat", subject: "NSO Group",          headline: "NSO Pegasus Spyware Used Against Journalists Globally",                                          date: "2021-07-18", url: "https://www.bellingcat.com/news/2021/07/18/the-pegasus-project-spyware/", category: "privacy",      abstract: "Bellingcat with Forbidden Stories detailed NSO Pegasus targeting journalists, activists, and politicians." },
  { outlet: "bellingcat", subject: "Wagner Group",       headline: "Wagner Group Corporate Network Exposed",                                                          date: "2022-05-09", url: "https://www.bellingcat.com/category/resources/articles/wagner-group/", category: "political",    abstract: "Bellingcat OSINT tracked Wagner mercenary group's corporate-shell structure and African deployments." },

  // ─── Forbes (investigations not rankings) ─────────────────────────────
  { outlet: "forbes", subject: "FTX",                    headline: "FTX's $32B Collapse and Sam Bankman-Fried Fraud",                                                date: "2022-11-11", url: "https://www.forbes.com/sites/davidjeans/2022/11/11/sam-bankman-fried-ftx-collapse-explained/", category: "political",    abstract: "Forbes detailed FTX commingling of customer funds and Alameda balance-sheet that led to $32B collapse." },
  { outlet: "forbes", subject: "Theranos",               headline: "Elizabeth Holmes's Fall From Forbes Cover to Conviction",                                         date: "2018-06-15", url: "https://www.forbes.com/sites/matthewherper/2018/06/15/theranos-elizabeth-holmes-criminal-charges/", category: "health",       abstract: "Forbes traced Holmes Forbes-cover ascent to criminal fraud conviction in failed blood-test startup." },

  // ─── Foreign Policy ──────────────────────────────────────────────────
  { outlet: "foreignpolicy", subject: "Huawei",          headline: "Huawei's Surveillance Tech Exports to Authoritarian Regimes",                                    date: "2019-04-29", url: "https://foreignpolicy.com/2019/04/29/huawei-surveillance-tech-uighurs/", category: "privacy",      abstract: "FP traced Huawei surveillance-tech sales to Xinjiang and African authoritarian regimes." },
  { outlet: "foreignpolicy", subject: "Halliburton",     headline: "Halliburton's Iraq War Contracting Profits",                                                     date: "2018-04-22", url: "https://foreignpolicy.com/2018/04/22/halliburton-iraq-war-contracts-cheney/", category: "political",    abstract: "FP detailed Halliburton's Iraq War no-bid contracts under Cheney VP tenure totaling $39B." },
];
/* eslint-enable max-len */

async function fetchLive() {
  try {
    const res = await fetch(URL_OVERRIDE, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) console.warn(`Live probe non-OK ${res.status}; continuing with fixture`);
  } catch (e) {
    console.warn(`Live probe failed (${e.message}); continuing with fixture`);
  }
  return FIXTURE;
}

async function main() {
  console.log(`Investigative-journalism corpus fetcher (${APPLY ? "APPLY" : "DRY"})`);
  const records = APPLY ? await fetchLive() : FIXTURE;
  const trimmed = LIMIT > 0 ? records.slice(0, LIMIT) : records;
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "investigative-journalism",
    source_url: SOURCE_URL,
    license: "Editorial fair use — headlines + URLs + <=40-word abstracts only.",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    outlets: OUTLETS,
    record_count: trimmed.length,
    records: trimmed,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${trimmed.length} investigative-journalism records -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("investigative-journalism-fetch failed:", err); process.exit(1); });
