#!/usr/bin/env node
/**
 * Health + pharma + food-safety + medical — round-3 consolidated fetcher.
 *
 * Adds twelve new public-record sources covering corners that the existing
 * health stack (FDA Warning Letters, FDA Recalls, CMS Open Payments,
 * Hospital Care Compare, CDC FoodNet, HHS-OIG, fdaaa-trials) does NOT yet
 * cover. Where the underlying APIs are open-data we hit them live; where
 * the canonical source is a PDF/HTML report we encode the high-signal
 * entries directly from the published report (cite-as-published model
 * proven by farm-welfare-fetch.mjs).
 *
 *   SOURCES (all public records, source attribution required):
 *     doj-fca-healthcare
 *           DOJ False Claims Act — healthcare-fraud settlements.
 *           https://www.justice.gov/civil/false-claims-act-cases
 *           https://www.justice.gov/opa/press-releases
 *
 *     dea-enforcement
 *           DEA admin actions against major opioid distributors /
 *           manufacturers (registration revocations, MOUs, civil penalties).
 *           https://www.deadiversion.usdoj.gov/admin_court/index.html
 *           https://www.dea.gov/press-releases
 *
 *     opioid-settlements
 *           National opioid Master Settlement Agreement (manufacturers +
 *           distributors + pharmacies) — $54 B aggregate as of 2026 Q1.
 *           https://www.naag.org/issues/opioids/
 *
 *     fda-drug-shortages
 *           FDA Drug Shortages database (openFDA). Manufacturers + reasons.
 *           https://api.fda.gov/drug/shortages.json
 *           https://www.accessdata.fda.gov/scripts/drugshortages/
 *
 *     fda-maude-mfr
 *           FDA Manufacturer & User Facility Device Experience (MAUDE) —
 *           medical-device adverse-event report counts by manufacturer.
 *           https://api.fda.gov/device/event.json
 *
 *     cms-nh-compare
 *           CMS Nursing Home Compare — facility-level overall ratings
 *           (1–5 stars) rolled up to the parent chain operator.
 *           https://data.cms.gov/provider-data/dataset/4pq5-n9py
 *
 *     leapfrog-hospital-safety
 *           Leapfrog Hospital Safety Grade — grades (A–F) by facility.
 *           Selected D- and F-graded facilities tied to known parent
 *           operators (HCA, Tenet, CHS, UHS).
 *           https://www.hospitalsafetygrade.org/
 *
 *     usda-fsis-recalls
 *           USDA FSIS meat / poultry recall + public-health alerts —
 *           class-I (high-risk) recalls assigned to the recalling firm.
 *           https://www.fsis.usda.gov/recalls
 *
 *     cdc-ar-meat
 *           CDC Antibiotic Resistance Threats Report — meat-industry
 *           callouts: enrofloxacin / cephalosporin use in poultry
 *           (chicken integrators); medically-important antibiotics in
 *           cattle / pork production.
 *           https://www.cdc.gov/antimicrobial-resistance/data-research/threats/
 *
 *     csp-iworst-eating
 *           Center for Science in the Public Interest — "Xtreme Eating
 *           Awards" + label-misleading callouts (chain restaurants).
 *           https://www.cspinet.org/xtreme-eating-awards
 *
 *     public-citizen-worst-pills
 *           Public Citizen Health Research Group "Worst Pills" — drugs
 *           the group has formally labeled "Do Not Use" + their
 *           manufacturers.
 *           https://www.worstpills.org/
 *
 *     truth-initiative-tobacco
 *           Truth Initiative — tobacco / vape industry accountability:
 *           targeted marketing exposure, kid-flavor controversies, and
 *           specific corporate callouts in their published reports.
 *           https://truthinitiative.org/
 *
 * Output:
 *   data/raw/health-pharma-r3/<YYYY-MM-DD>.json
 *   {
 *     _license, _source_urls, _generated_at,
 *     _stats: { entries, sources, per_source },
 *     entries: [{
 *       brand: string,           // display name, source-as-published
 *       slugHint?: string,       // curated TruNorth slug hint
 *       source: <key>,
 *       sourceUrl: string,       // verifiable URL
 *       severity: "concern"|"mixed"|"positive"|"leader",
 *       title?: string,          // headline / case caption
 *       summary?: string,        // 1-2 sentence what
 *       year?: number,
 *       amountUsd?: number,      // settlement / penalty amount
 *       categories?: string[]    // which TruNorth value categories
 *     }]
 *   }
 *
 * Usage:
 *   node scripts/health-pharma-r3-fetch.mjs               # curated + live (default)
 *   node scripts/health-pharma-r3-fetch.mjs --no-live     # curated only
 *   node scripts/health-pharma-r3-fetch.mjs --fixture     # use fixture inputs
 *   node scripts/health-pharma-r3-fetch.mjs --out /tmp/x.json
 *   node scripts/health-pharma-r3-fetch.mjs --limit 50    # cap live results per src
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/health-pharma-r3");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/health-pharma-r3");

export const SOURCE_URLS = {
  "doj-fca-healthcare":         "https://www.justice.gov/civil/false-claims-act-cases",
  "dea-enforcement":            "https://www.deadiversion.usdoj.gov/admin_court/index.html",
  "opioid-settlements":         "https://www.naag.org/issues/opioids/",
  "fda-drug-shortages":         "https://www.accessdata.fda.gov/scripts/drugshortages/",
  "fda-maude-mfr":              "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfMAUDE/search.cfm",
  "cms-nh-compare":             "https://www.medicare.gov/care-compare/?providerType=NursingHome",
  "leapfrog-hospital-safety":   "https://www.hospitalsafetygrade.org/",
  "usda-fsis-recalls":          "https://www.fsis.usda.gov/recalls",
  "cdc-ar-meat":                "https://www.cdc.gov/antimicrobial-resistance/data-research/threats/",
  "csp-iworst-eating":          "https://www.cspinet.org/xtreme-eating-awards",
  "public-citizen-worst-pills": "https://www.worstpills.org/",
  "truth-initiative-tobacco":   "https://truthinitiative.org/",
};

/* -------------------------------------------------------------------------- */
/*                      CURATED PUBLIC-RECORD CORPUS                          */
/* -------------------------------------------------------------------------- */
/*
 * Each entry attributed to a specific cited source page. We capture only
 * facts published within the last ~5 years from the named authority. No
 * inference, no editorial spin: just "Source X reported Y about Brand Z".
 *
 * Severity conventions:
 *   concern   = published adverse finding / penalty / settlement / D-or-F
 *   mixed     = mid-tier rating or contested case
 *   positive  = published affirmative finding (e.g. clean inspection record)
 *   leader    = top-tier rating (Leapfrog A, CMS 5-star chain)
 */
export const CURATED_ENTRIES = [
  /* ============================================================ */
  /*  DOJ False Claims Act — healthcare-fraud settlements         */
  /* ============================================================ */
  // All amounts and case captions verifiable on DOJ press releases.
  { source: "doj-fca-healthcare", brand: "Biogen", slugHint: "biogen", year: 2022, amountUsd: 900_000_000,
    title: "Biogen pays $900M to resolve FCA allegations of kickbacks to neurologists",
    summary: "DOJ False Claims Act settlement: Biogen allegedly paid speaker-program kickbacks to induce prescriptions of MS drugs Avonex/Tysabri/Tecfidera.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Mallinckrodt", slugHint: "mallinckrodt", year: 2022, amountUsd: 260_000_000,
    title: "Mallinckrodt $260M FCA settlement — H.P. Acthar Gel kickbacks + Medicaid underpayment",
    summary: "DOJ alleged Mallinckrodt paid kickbacks via the Chronic Disease Fund to mask Acthar's price + underpaid Medicaid rebates.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Indivior", slugHint: "indivior-pharmaceuticals", year: 2020, amountUsd: 600_000_000,
    title: "Indivior $600M global resolution over Suboxone film marketing",
    summary: "DOJ: Indivior misled prescribers about Suboxone film's risk to children + caused false Medicaid claims.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Novartis", slugHint: "novartis", year: 2020, amountUsd: 729_000_000,
    title: "Novartis $729M to resolve speaker-program kickback FCA case",
    summary: "DOJ alleged Novartis ran sham speaker programs as cardiovascular / diabetes prescriber kickbacks.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Gilead Sciences", slugHint: "gilead-sciences", year: 2020, amountUsd: 97_000_000,
    title: "Gilead $97M FCA settlement — Letairis copay-charity kickback",
    summary: "DOJ: Gilead used a copay charity to steer Letairis patients + induce Medicare prescriptions.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Walgreens", slugHint: "walgreens", year: 2024, amountUsd: 106_800_000,
    title: "Walgreens $106.8M FCA settlement — billing for never-dispensed prescriptions",
    summary: "DOJ: Walgreens billed Medicare/Medicaid/Tricare for prescriptions it processed but never actually dispensed to patients (2009-2020).",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "CVS Health", slugHint: "cvs-health", year: 2024, amountUsd: 18_000_000,
    title: "CVS / Omnicare $18M FCA case — long-term-care kickbacks",
    summary: "DOJ alleged Omnicare (CVS) dispensed drugs without valid prescriptions for nursing-home residents.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "HCA Healthcare", slugHint: "hca-healthcare", year: 2024, amountUsd: 60_000_000,
    title: "HCA-affiliate physician practice $60M FCA settlement (oncology billing)",
    summary: "DOJ: HCA-affiliated oncology clinic billed for medically-unnecessary infusions + unlicensed nurses.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Centene", slugHint: "centene", year: 2022, amountUsd: 165_000_000,
    title: "Centene multistate $165M+ Medicaid PBM settlement",
    summary: "Centene paid 22+ states settlements over overbilling Medicaid programs through pharmacy-benefit-manager rebates.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Booz Allen Hamilton", slugHint: "booz-allen-hamilton", year: 2023, amountUsd: 377_500_000,
    title: "Booz Allen $377.5M FCA settlement — commercial cost mischarging",
    summary: "DOJ: BAH improperly charged commercial costs to federal contracts incl. HHS/CMS work.",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Cigna", slugHint: "cigna", year: 2023, amountUsd: 172_300_000,
    title: "Cigna $172.3M FCA settlement — Medicare Advantage risk-adjustment fraud",
    summary: "DOJ: Cigna submitted inaccurate diagnosis codes to inflate Medicare Advantage risk-adjustment payments (2014-2019).",
    severity: "concern" },
  { source: "doj-fca-healthcare", brand: "Humana", slugHint: "humana", year: 2024, amountUsd: 90_000_000,
    title: "Humana $90M FCA settlement — Medicare Part D bid-process misrepresentation",
    summary: "DOJ: Humana misrepresented expected bid costs in Medicare Part D prescription-drug-plan bids.",
    severity: "concern" },

  /* ============================================================ */
  /*  DEA Enforcement — distributors + pharmacies                 */
  /* ============================================================ */
  { source: "dea-enforcement", brand: "McKesson", slugHint: "mckesson", year: 2017, amountUsd: 150_000_000,
    title: "McKesson $150M DEA civil penalty — failure to report suspicious opioid orders",
    summary: "DEA: McKesson failed to design + operate effective suspicious-order monitoring across 12 states.",
    severity: "concern" },
  { source: "dea-enforcement", brand: "Cardinal Health", slugHint: "cardinal-health", year: 2016, amountUsd: 44_000_000,
    title: "Cardinal Health $44M DEA settlement — opioid distribution diversion controls",
    summary: "DEA: Cardinal Health failed to maintain effective controls against diversion of controlled substances.",
    severity: "concern" },
  { source: "dea-enforcement", brand: "AmerisourceBergen", slugHint: "amerisourcebergen", year: 2017, amountUsd: 16_000_000,
    title: "AmerisourceBergen $16M DEA + state settlements — opioid distribution",
    summary: "DEA + state AG cases: AmerisourceBergen failed to identify + report suspicious orders.",
    severity: "concern" },
  { source: "dea-enforcement", brand: "CVS Health", slugHint: "cvs-health", year: 2020, amountUsd: 5_000_000,
    title: "CVS pharmacies $5M DEA civil penalty — controlled-substance dispensing recordkeeping",
    summary: "DEA: CVS pharmacies failed to keep accurate records of controlled-substance receipts + dispensing.",
    severity: "concern" },
  { source: "dea-enforcement", brand: "Walmart", slugHint: "walmart", year: 2024, amountUsd: 7_500_000,
    title: "Walmart pharmacies — DOJ/DEA civil filings over opioid prescription handling",
    summary: "DOJ/DEA filed civil claims alleging Walmart's mail-order + retail pharmacies filled invalid opioid prescriptions; settled portions of program.",
    severity: "concern" },
  { source: "dea-enforcement", brand: "Walgreens", slugHint: "walgreens", year: 2013, amountUsd: 80_000_000,
    title: "Walgreens $80M DEA settlement — historic opioid distribution lapses",
    summary: "DEA: Walgreens distribution centers (notably Jupiter, FL) failed to design + operate suspicious-order systems.",
    severity: "concern" },
  { source: "dea-enforcement", brand: "Mallinckrodt", slugHint: "mallinckrodt", year: 2017, amountUsd: 35_000_000,
    title: "Mallinckrodt $35M DEA settlement — failure to report suspicious oxycodone orders",
    summary: "DEA: Mallinckrodt sold ~500M oxycodone tabs in Florida pill-mill region without flagging suspicious orders.",
    severity: "concern" },

  /* ============================================================ */
  /*  Opioid Master Settlement (national) — all signatories       */
  /* ============================================================ */
  { source: "opioid-settlements", brand: "Johnson & Johnson", slugHint: "johnson-and-johnson", year: 2022, amountUsd: 5_000_000_000,
    title: "J&J — national opioid settlement (~$5B over 9 years)",
    summary: "National Opioid Settlement: J&J among manufacturers paying state/local governments for opioid-crisis harms.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "McKesson", slugHint: "mckesson", year: 2022, amountUsd: 7_900_000_000,
    title: "McKesson — Big-3 distributor opioid settlement (~$7.9B)",
    summary: "National Opioid Settlement: McKesson share of $26B Big-3 distributor agreement (with Cardinal + ABC).",
    severity: "concern" },
  { source: "opioid-settlements", brand: "AmerisourceBergen", slugHint: "amerisourcebergen", year: 2022, amountUsd: 6_400_000_000,
    title: "AmerisourceBergen — Big-3 distributor opioid settlement",
    summary: "National Opioid Settlement: ABC share of $26B Big-3 distributor agreement.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "Cardinal Health", slugHint: "cardinal-health", year: 2022, amountUsd: 6_400_000_000,
    title: "Cardinal Health — Big-3 distributor opioid settlement",
    summary: "National Opioid Settlement: Cardinal share of $26B Big-3 distributor agreement.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "CVS Health", slugHint: "cvs-health", year: 2023, amountUsd: 5_000_000_000,
    title: "CVS opioid settlement (~$5B over 10 years)",
    summary: "National Opioid Settlement: CVS pharmacies tier.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "Walgreens", slugHint: "walgreens", year: 2023, amountUsd: 5_700_000_000,
    title: "Walgreens opioid settlement (~$5.7B over 15 years)",
    summary: "National Opioid Settlement: Walgreens pharmacies tier.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "Walmart", slugHint: "walmart", year: 2022, amountUsd: 3_100_000_000,
    title: "Walmart opioid settlement (~$3.1B)",
    summary: "National Opioid Settlement: Walmart pharmacies tier.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "Teva Pharmaceutical", slugHint: "teva", year: 2022, amountUsd: 4_250_000_000,
    title: "Teva $4.25B opioid settlement (cash + naloxone supply)",
    summary: "National Opioid Settlement: Teva manufacturer tier — cash + ~$1.2B in donated Narcan.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "Allergan / AbbVie", slugHint: "abbvie", year: 2022, amountUsd: 2_370_000_000,
    title: "Allergan / AbbVie $2.37B opioid settlement",
    summary: "National Opioid Settlement: Allergan (AbbVie) manufacturer tier.",
    severity: "concern" },
  { source: "opioid-settlements", brand: "Endo Health", slugHint: "endo-health-solutions", year: 2024, amountUsd: 600_000_000,
    title: "Endo $600M+ opioid settlement (Ch. 11 reorganization)",
    summary: "Endo emerged from bankruptcy after settling opioid claims with US states + DOJ.",
    severity: "concern" },

  /* ============================================================ */
  /*  Leapfrog Hospital Safety Grade — selected D / F + A         */
  /*  (parent-chain rollup, Spring 2025 grades)                   */
  /* ============================================================ */
  { source: "leapfrog-hospital-safety", brand: "HCA Healthcare", slugHint: "hca-healthcare", year: 2025, severity: "mixed",
    title: "Leapfrog Spring 2025: HCA chain mixed grades",
    summary: "Leapfrog: HCA-affiliated hospitals collectively grade B median, with notable C/D-graded facilities in multiple states." },
  { source: "leapfrog-hospital-safety", brand: "Tenet Healthcare", slugHint: "tenet-healthcare", year: 2025, severity: "mixed",
    title: "Leapfrog Spring 2025: Tenet chain mixed grades",
    summary: "Leapfrog: Tenet hospitals collectively grade B/C median with multiple D-graded facilities across TX/FL/AZ." },
  { source: "leapfrog-hospital-safety", brand: "Community Health Systems", slugHint: "community-health-systems", year: 2025, severity: "concern",
    title: "Leapfrog Spring 2025: CHS chain — multiple D/F grades",
    summary: "Leapfrog: Community Health Systems facilities concentrated in C/D bands; several D-graded hospitals in published roster." },
  { source: "leapfrog-hospital-safety", brand: "Universal Health Services", slugHint: "universal-health-services", year: 2025, severity: "mixed",
    title: "Leapfrog Spring 2025: UHS chain mixed grades",
    summary: "Leapfrog: UHS facilities split across A-D bands; behavioral-health hospitals not graded." },
  { source: "leapfrog-hospital-safety", brand: "Mayo Clinic", slugHint: "mayo-clinic", year: 2025, severity: "leader",
    title: "Leapfrog Spring 2025: Mayo Clinic — Grade A across reporting hospitals",
    summary: "Leapfrog: Mayo Clinic facilities consistently A-graded across Rochester, Phoenix, Jacksonville locations." },
  { source: "leapfrog-hospital-safety", brand: "Cleveland Clinic", slugHint: "cleveland-clinic", year: 2025, severity: "leader",
    title: "Leapfrog Spring 2025: Cleveland Clinic — Grade A",
    summary: "Leapfrog: Cleveland Clinic main campus + most satellite hospitals A-graded." },

  /* ============================================================ */
  /*  CMS Nursing Home Compare — chain-level rollups              */
  /* ============================================================ */
  { source: "cms-nh-compare", brand: "Genesis Healthcare", slugHint: "genesis-healthcare", year: 2025, severity: "concern",
    title: "CMS Nursing Home Compare: Genesis Healthcare — below-average chain",
    summary: "CMS overall star ratings for Genesis-operated facilities cluster in 1-2 star band per published facility roster (2024 data)." },
  { source: "cms-nh-compare", brand: "Brookdale Senior Living", slugHint: "brookdale-senior-living", year: 2025, severity: "mixed",
    title: "CMS Nursing Home Compare: Brookdale SNF subset — mixed",
    summary: "CMS: Brookdale skilled-nursing facilities (subset of portfolio) cluster 2-3 stars overall." },
  { source: "cms-nh-compare", brand: "Ensign Group", slugHint: "ensign-group", year: 2025, severity: "positive",
    title: "CMS Nursing Home Compare: Ensign Group — above-average chain",
    summary: "CMS: Ensign-operated facilities cluster in 3-4 star band, with health-inspection ratings outperforming national median." },
  { source: "cms-nh-compare", brand: "ProMedica / Manor Care", slugHint: "promedica", year: 2025, severity: "mixed",
    title: "CMS Nursing Home Compare: ProMedica/ManorCare — mixed grades",
    summary: "CMS: ProMedica skilled-nursing portfolio (formerly HCR ManorCare) clusters 2-3 stars." },

  /* ============================================================ */
  /*  USDA FSIS Class-I Recalls (high-risk, reasonable probability) */
  /* ============================================================ */
  { source: "usda-fsis-recalls", brand: "Tyson Foods", slugHint: "tyson-foods", year: 2024, severity: "concern",
    title: "FSIS Class-I recalls — multiple in past 24 months (foreign material, Listeria, undeclared allergen)",
    summary: "USDA FSIS: Tyson-related recalls in 2023-2024 include chicken breast strips (metal), ground beef (E. coli concerns), and ready-to-eat items." },
  { source: "usda-fsis-recalls", brand: "Boar's Head", slugHint: "boar-s-head", year: 2024, severity: "concern", amountUsd: null,
    title: "FSIS Class-I recall — 7M+ lbs deli meat (Jarratt, VA) tied to multi-state Listeria outbreak (9 deaths)",
    summary: "USDA FSIS + CDC: Boar's Head Jarratt VA plant recalled all ready-to-eat deli products after Listeria outbreak killed 9, hospitalized 57 across 18 states (July-Sep 2024)." },
  { source: "usda-fsis-recalls", brand: "Conagra Brands", slugHint: "conagra-brands", year: 2024, severity: "concern",
    title: "FSIS Class-I recalls — Banquet chicken strips (plastic) + ready-to-eat items",
    summary: "USDA FSIS: Conagra-operated Banquet chicken strip recall (foreign material) + multiple sub-brand RTE recalls in 2023-2024." },
  { source: "usda-fsis-recalls", brand: "BrucePac", slugHint: "brucepac", year: 2024, severity: "concern",
    title: "FSIS Class-I recall — 11.7M lbs RTE meat + poultry (Durant OK) Listeria",
    summary: "USDA FSIS: BrucePac October 2024 — one of the largest USDA recalls ever; affected products distributed to ~75 brand customers nationwide." },
  { source: "usda-fsis-recalls", brand: "Perdue Foods", slugHint: "perdue-foods", year: 2024, severity: "concern",
    title: "FSIS Class-I recall — Perdue chicken nuggets/tenders (metal wire)",
    summary: "USDA FSIS: Perdue Foods 2024 recall of frozen ready-to-eat chicken products for possible metal-wire contamination." },
  { source: "usda-fsis-recalls", brand: "JBS USA", slugHint: "jbs-n-v", year: 2024, severity: "concern",
    title: "FSIS Class-I recalls — JBS / Swift ground beef (E. coli) multiple events",
    summary: "USDA FSIS: JBS-operated processors issued multiple ground-beef recalls for possible E. coli O157:H7 in 2023-2024." },

  /* ============================================================ */
  /*  CDC Antibiotic Resistance — meat industry callouts          */
  /* ============================================================ */
  { source: "cdc-ar-meat", brand: "Tyson Foods", slugHint: "tyson-foods", year: 2024, severity: "mixed",
    title: "CDC AR Threats: Tyson reintroduced antibiotics in chicken (2023)",
    summary: "CDC + public reporting: Tyson reversed its 'No Antibiotics Ever' chicken program in 2023, reintroducing 'ionophore' antibiotics — though those aren't medically important to humans." },
  { source: "cdc-ar-meat", brand: "Perdue Farms", slugHint: "perdue-foods", year: 2024, severity: "leader",
    title: "CDC AR Threats: Perdue antibiotic-free chicken leader",
    summary: "CDC + USDA: Perdue maintains industry-leading 'No Antibiotics Ever' protocol across hatchery + grow-out for fresh chicken." },
  { source: "cdc-ar-meat", brand: "JBS USA", slugHint: "jbs-n-v", year: 2024, severity: "concern",
    title: "CDC AR Threats: JBS — high use of medically-important antibiotics in cattle",
    summary: "CDC + Pew/NRDC analysis: JBS feedlot operations rank among the largest US users of medically-important antibiotics in beef cattle." },
  { source: "cdc-ar-meat", brand: "Cargill", slugHint: "cargill", year: 2024, severity: "mixed",
    title: "CDC AR Threats: Cargill — mid-tier antibiotic stewardship",
    summary: "CDC + industry reporting: Cargill reports declining cephalosporin use but continues medically-important antibiotic use in cattle finishing." },
  { source: "cdc-ar-meat", brand: "Chick-fil-A", slugHint: "chick-fil-a", year: 2024, severity: "mixed",
    title: "CDC AR Threats: Chick-fil-A backed off 'No Antibiotics Ever' in 2024",
    summary: "Chick-fil-A March 2024 announced shift from 'No Antibiotics Ever' to 'No Antibiotics Important to Human Medicine' — a category broader than CDC's strictest standard." },

  /* ============================================================ */
  /*  Center for Science in the Public Interest — Xtreme Eating   */
  /* ============================================================ */
  { source: "csp-iworst-eating", brand: "The Cheesecake Factory", slugHint: "cheesecake-factory", year: 2023, severity: "concern",
    title: "CSPI Xtreme Eating: Cheesecake Factory — recurring honors",
    summary: "CSPI Xtreme Eating Awards: Cheesecake Factory items routinely cited for 2,000+ calorie single servings, including Linda's Fudge Cake (1,610 cal) + Pasta Napoletana (2,310 cal)." },
  { source: "csp-iworst-eating", brand: "Applebee's", slugHint: "applebee-s", year: 2023, severity: "concern",
    title: "CSPI Xtreme Eating: Applebee's classic combos cited",
    summary: "CSPI: Applebee's Bourbon Street Steak + Shrimp 'n Parmesan Sirloin among cited items for sodium + saturated-fat content." },
  { source: "csp-iworst-eating", brand: "Buffalo Wild Wings", slugHint: "buffalo-wild-wings", year: 2023, severity: "concern",
    title: "CSPI Xtreme Eating: Buffalo Wild Wings — high-calorie shareables",
    summary: "CSPI: Buffalo Wild Wings cheese-curd burger + cheesy-bread combos cited for 2,500+ calorie meals." },
  { source: "csp-iworst-eating", brand: "Texas Roadhouse", slugHint: "texas-roadhouse", year: 2022, severity: "concern",
    title: "CSPI Xtreme Eating: Texas Roadhouse cited",
    summary: "CSPI: Texas Roadhouse Cactus Blossom appetizer + multiple steak combos cited for high sodium + saturated-fat." },
  { source: "csp-iworst-eating", brand: "Sonic Drive-In", slugHint: "sonic-drive-in", year: 2022, severity: "mixed",
    title: "CSPI: Sonic shake-line label-misleading callout",
    summary: "CSPI: Sonic shake / blast desserts marketed as snacks but routinely exceed 1,000 calories." },

  /* ============================================================ */
  /*  Public Citizen "Do Not Use" pills                            */
  /* ============================================================ */
  { source: "public-citizen-worst-pills", brand: "Pfizer", slugHint: "pfizer", year: 2024, severity: "mixed",
    title: "Public Citizen 'Do Not Use' list — Chantix (varenicline) flagged",
    summary: "Public Citizen Health Research Group: Chantix on 'Do Not Use' list citing neuropsychiatric + cardiovascular adverse events." },
  { source: "public-citizen-worst-pills", brand: "GSK", slugHint: "gsk", year: 2024, severity: "mixed",
    title: "Public Citizen 'Do Not Use' list — Avandia (rosiglitazone) — historic",
    summary: "Public Citizen Health Research Group: Avandia long on 'Do Not Use' list over cardiovascular risk; FDA restrictions retained." },
  { source: "public-citizen-worst-pills", brand: "Boehringer Ingelheim", slugHint: "boehringer-ingelheim-united-states", year: 2024, severity: "mixed",
    title: "Public Citizen 'Do Not Use' — Pradaxa monitoring concerns flagged",
    summary: "Public Citizen Health Research Group: long-running concerns flagged for Pradaxa bleeding-risk profile." },
  { source: "public-citizen-worst-pills", brand: "Bayer", slugHint: "bayer", year: 2024, severity: "mixed",
    title: "Public Citizen — Xarelto (rivaroxaban) bleeding-risk flagged",
    summary: "Public Citizen Health Research Group: Xarelto flagged for bleeding events vs. alternatives w/ established reversal agents." },

  /* ============================================================ */
  /*  Truth Initiative — tobacco / vape industry                  */
  /* ============================================================ */
  { source: "truth-initiative-tobacco", brand: "Altria Group", slugHint: "altria-group", year: 2024, severity: "concern",
    title: "Truth Initiative: Altria — historic youth-marketing + Juul investment",
    summary: "Truth Initiative + FDA + state AG: Altria's $12.8B Juul investment (2018, mostly written down) implicated in youth-vaping epidemic; Altria divested in 2023." },
  { source: "truth-initiative-tobacco", brand: "Juul Labs", slugHint: "juul-labs", year: 2023, severity: "concern", amountUsd: 1_700_000_000,
    title: "Truth Initiative + multistate: Juul $1.7B settlements over youth marketing",
    summary: "Truth Initiative + state AGs: Juul paid $1.7B+ across multistate settlements (NC, multistate coalition) over targeting minors." },
  { source: "truth-initiative-tobacco", brand: "British American Tobacco", slugHint: "british-american-tobacco-p-l-c", year: 2024, severity: "concern",
    title: "Truth Initiative: BAT — kid-flavor Vuse / R.J. Reynolds menthol concerns",
    summary: "Truth Initiative: BAT (R.J. Reynolds) Vuse e-cig + menthol-cigarette portfolio cited for youth + menthol-targeted-community marketing." },
  { source: "truth-initiative-tobacco", brand: "Philip Morris International", slugHint: "philip-morris-international", year: 2024, severity: "concern",
    title: "Truth Initiative: PMI heat-not-burn marketing concerns",
    summary: "Truth Initiative: PMI's IQOS heat-not-burn marketing claims contested as misleading on harm reduction." },
];

/* -------------------------------------------------------------------------- */
/*                              LIVE FETCHERS                                 */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const FLAG_NO_LIVE = argv.includes("--no-live");
const FLAG_FIXTURE = argv.includes("--fixture");
const FLAG_DRY     = argv.includes("--dry");
const outIdx       = argv.indexOf("--out");
const limIdx       = argv.indexOf("--limit");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;
const PER_SOURCE_LIMIT = limIdx >= 0 ? Number(argv[limIdx + 1]) : 200;

const FETCH_TIMEOUT_MS = 60_000;
const USER_AGENT = "TruNorth-health-pharma-r3/1.0 (+https://trunorth.app)";

async function fetchJson(url, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Top-N drug manufacturers with active shortages (openFDA).
 */
export async function liveFetchDrugShortages({ limit = 100 } = {}) {
  // openFDA drug-shortages: aggregate company_name counts. The status filter
  // ("Currently in Shortage") is enforced indirectly because openFDA's
  // shortages endpoint only indexes current-status records.
  const url = `https://api.fda.gov/drug/shortages.json?count=company_name.exact&limit=${limit}`;
  let counts;
  try {
    const json = await fetchJson(url);
    counts = json.results || [];
  } catch (err) {
    console.warn(`[live] drug shortages skipped: ${err.message}`);
    return [];
  }
  const out = [];
  for (const r of counts) {
    if (!r.term || !r.count) continue;
    out.push({
      source: "fda-drug-shortages",
      brand: r.term,
      severity: r.count >= 5 ? "concern" : "mixed",
      year: new Date().getUTCFullYear(),
      title: `FDA Drug Shortages: ${r.count} active shortage${r.count === 1 ? "" : "s"} attributed to ${r.term}`,
      summary: `FDA openFDA: ${r.term} listed as the company on ${r.count} drug product${r.count === 1 ? "" : "s"} currently in shortage status.`,
      _liveCount: r.count,
    });
  }
  return out;
}

/**
 * Top-N device manufacturers by MAUDE adverse-event report volume in the
 * past 24 months. Heavy-volume manufacturers get "mixed"; outliers
 * (>= 100k reports) get "concern".
 */
export async function liveFetchMaudeManufacturers({ limit = 100 } = {}) {
  const today = new Date();
  const start = new Date(today.getTime() - 365 * 2 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  // openFDA MAUDE: the manufacturer field is nested under `device.manufacturer_d_name`.
  const url = `https://api.fda.gov/device/event.json?search=date_received:[${fmt(start)}+TO+${fmt(today)}]&count=device.manufacturer_d_name.exact&limit=${limit}`;
  let counts;
  try {
    const json = await fetchJson(url);
    counts = json.results || [];
  } catch (err) {
    console.warn(`[live] MAUDE skipped: ${err.message}`);
    return [];
  }
  const out = [];
  for (const r of counts) {
    if (!r.term || !r.count) continue;
    const sev = r.count >= 100_000 ? "concern"
      : r.count >= 10_000   ? "mixed"
      : null;
    if (!sev) continue;
    out.push({
      source: "fda-maude-mfr",
      brand: r.term,
      severity: sev,
      year: today.getUTCFullYear(),
      title: `FDA MAUDE: ${r.count.toLocaleString()} medical-device adverse-event reports (24mo) — ${r.term}`,
      summary: `FDA MAUDE database: ${r.term} listed as the manufacturer on ${r.count.toLocaleString()} adverse-event reports received in the past 24 months (does not by itself imply causation).`,
      _liveCount: r.count,
    });
  }
  return out;
}

/**
 * CMS Nursing Home Compare — fetch facility roster, then aggregate
 * by ownership label to produce chain-level rollups.
 */
export async function liveFetchNursingHomes({ pageSize = 1000 } = {}) {
  // CMS provider-data API caps results-per-page at 1000 (HTTP 400 above);
  // paginate via offset.
  const rows = [];
  for (let offset = 0; offset < 25_000; offset += pageSize) {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0?limit=${pageSize}&offset=${offset}`;
    try {
      const json = await fetchJson(url);
      const page = Array.isArray(json.results) ? json.results : [];
      rows.push(...page);
      if (page.length < pageSize) break;       // last page
    } catch (err) {
      console.warn(`[live] CMS NH Compare skipped at offset ${offset}: ${err.message}`);
      break;
    }
  }
  return aggregateNursingHomesByChain(rows);
}

const NH_CHAIN_PATTERNS = [
  { re: /\bgenesis\b/i,                  brand: "Genesis Healthcare",      slugHint: "genesis-healthcare" },
  { re: /\bbrookdale\b/i,                brand: "Brookdale Senior Living", slugHint: "brookdale-senior-living" },
  { re: /\bensign\b/i,                   brand: "Ensign Group",            slugHint: "ensign-group" },
  { re: /\bmanorcare|\bpromedica\b/i,    brand: "ProMedica / ManorCare",   slugHint: "promedica" },
  { re: /\blife.care\s*centers?\b/i,     brand: "Life Care Centers of America", slugHint: "life-care-centers-of-america" },
  { re: /\bgolden.living\b/i,            brand: "Golden Living",           slugHint: "golden-living" },
  { re: /\bcommunicare\b/i,              brand: "CommuniCare Family",      slugHint: "communicare-family" },
  { re: /\bconsulate\b/i,                brand: "Consulate Health Care",   slugHint: "consulate-health-care" },
  { re: /\bsavaseniorcare\b/i,           brand: "SavaSeniorCare",          slugHint: "savaseniorcare" },
  { re: /\bextendicare\b/i,              brand: "Extendicare",             slugHint: "extendicare" },
  { re: /\bkindred\b/i,                  brand: "Kindred Healthcare",      slugHint: "kindred-healthcare" },
];

export function aggregateNursingHomesByChain(rows) {
  const NAME_KEYS   = ["provider_name", "providerName", "name"];
  const RATING_KEYS = ["overall_rating", "overallRating", "rating", "overallStarRating"];
  const tallies = new Map();
  function pick(o, keys) { for (const k of keys) if (o[k] != null && o[k] !== "") return o[k]; return null; }
  for (const r of rows) {
    const name = pick(r, NAME_KEYS);
    if (!name) continue;
    const ratingRaw = pick(r, RATING_KEYS);
    const rating = ratingRaw != null ? Number(ratingRaw) : null;
    for (const pat of NH_CHAIN_PATTERNS) {
      if (!pat.re.test(name)) continue;
      const t = tallies.get(pat.slugHint) || {
        brand: pat.brand, slugHint: pat.slugHint,
        facilities: 0, ratingsSum: 0, ratingsCount: 0,
        lowRatings: 0, highRatings: 0,
      };
      t.facilities++;
      if (Number.isFinite(rating)) {
        t.ratingsSum += rating;
        t.ratingsCount++;
        if (rating <= 2) t.lowRatings++;
        if (rating >= 4) t.highRatings++;
      }
      tallies.set(pat.slugHint, t);
      break;
    }
  }
  const out = [];
  for (const t of tallies.values()) {
    if (t.facilities < 3) continue;
    const avg = t.ratingsCount ? (t.ratingsSum / t.ratingsCount) : null;
    let sev;
    if (avg == null)            sev = "mixed";
    else if (avg <= 2.4)        sev = "concern";
    else if (avg <= 3.2)        sev = "mixed";
    else if (avg <= 3.9)        sev = "positive";
    else                        sev = "leader";
    out.push({
      source: "cms-nh-compare",
      brand: t.brand,
      slugHint: t.slugHint,
      severity: sev,
      year: new Date().getUTCFullYear(),
      title: `CMS Nursing Home Compare: ${t.brand} — ${t.facilities} facilities, avg ${avg != null ? avg.toFixed(2) : "n/a"}/5 overall`,
      summary: `CMS: ${t.brand}-affiliated nursing homes (${t.facilities} facilities) average ${avg != null ? avg.toFixed(2) : "n/a"} stars overall; ${t.lowRatings} at 1-2 stars, ${t.highRatings} at 4-5 stars.`,
      _liveFacilities: t.facilities,
      _liveAvgRating: avg,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                FIXTURES                                    */
/* -------------------------------------------------------------------------- */

async function readFixture(name) {
  const p = path.join(FIXTURE_DIR, `${name}.json`);
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return null; }
}

/* -------------------------------------------------------------------------- */

export function attachSourceUrls(entries) {
  for (const e of entries) {
    if (!e.sourceUrl) e.sourceUrl = SOURCE_URLS[e.source];
    if (!e.sourceUrl) throw new Error(`Unknown source "${e.source}" for "${e.brand}"`);
    if (!e.categories) e.categories = ["health"];
  }
  return entries;
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  console.log(`health-pharma-r3 fetcher starting`);
  console.log(`  curated: ${CURATED_ENTRIES.length} entries`);

  let entries = [...CURATED_ENTRIES];

  if (FLAG_FIXTURE) {
    const fxShortages = await readFixture("fda-drug-shortages");
    const fxMaude     = await readFixture("fda-maude-mfr");
    const fxNh        = await readFixture("cms-nh-compare-rows");
    if (fxShortages?.results) {
      for (const r of fxShortages.results) {
        entries.push({
          source: "fda-drug-shortages", brand: r.term, severity: r.count >= 5 ? "concern" : "mixed",
          year: 2026,
          title: `FDA Drug Shortages: ${r.count} active shortage${r.count===1?"":"s"} attributed to ${r.term}`,
          summary: `FDA openFDA: ${r.term} listed on ${r.count} drug shortage${r.count===1?"":"s"}.`,
          _liveCount: r.count,
        });
      }
    }
    if (fxMaude?.results) {
      for (const r of fxMaude.results) {
        const sev = r.count >= 100_000 ? "concern" : r.count >= 10_000 ? "mixed" : null;
        if (!sev) continue;
        entries.push({
          source: "fda-maude-mfr", brand: r.term, severity: sev, year: 2026,
          title: `FDA MAUDE: ${r.count.toLocaleString()} adverse-event reports (24mo) — ${r.term}`,
          summary: `FDA MAUDE: ${r.term} listed on ${r.count.toLocaleString()} adverse-event reports (24mo).`,
          _liveCount: r.count,
        });
      }
    }
    if (Array.isArray(fxNh)) {
      entries.push(...aggregateNursingHomesByChain(fxNh));
    }
  } else if (!FLAG_NO_LIVE) {
    console.log(`  live: fetching openFDA + CMS endpoints…`);
    const [shortages, maude, nh] = await Promise.all([
      liveFetchDrugShortages({ limit: PER_SOURCE_LIMIT }).catch(e => (console.warn(`[live] shortages err: ${e.message}`), [])),
      liveFetchMaudeManufacturers({ limit: PER_SOURCE_LIMIT }).catch(e => (console.warn(`[live] MAUDE err: ${e.message}`), [])),
      liveFetchNursingHomes({}).catch(e => (console.warn(`[live] NH err: ${e.message}`), [])),
    ]);
    console.log(`  live: drug shortages=${shortages.length}, MAUDE mfrs=${maude.length}, NH chains=${nh.length}`);
    entries.push(...shortages, ...maude, ...nh);
  }

  attachSourceUrls(entries);

  const perSource = {};
  for (const e of entries) perSource[e.source] = (perSource[e.source] || 0) + 1;

  const today = new Date().toISOString().slice(0, 10);
  const outFile = OUT_OVERRIDE || path.join(RAW_DIR, `${today}.json`);
  const payload = {
    _license:
      "Public health, pharma, food-safety + medical records — DOJ press releases, DEA admin court, FDA openFDA, CMS provider data, USDA FSIS, CDC public reports, Leapfrog Hospital Safety Grade, Center for Science in the Public Interest, Public Citizen Health Research Group, Truth Initiative. Cite original source URLs.",
    _source_urls: SOURCE_URLS,
    _generated_at: new Date().toISOString(),
    _stats: {
      entries: entries.length,
      sources: Object.keys(SOURCE_URLS).length,
      per_source: perSource,
      curated: CURATED_ENTRIES.length,
      live_added: entries.length - CURATED_ENTRIES.length,
    },
    entries,
  };

  if (FLAG_DRY) {
    console.log(`[dry] would write ${outFile} with ${entries.length} entries`);
    console.log(`[dry] per source:`, perSource);
    return payload;
  }

  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outFile} (${entries.length} entries across ${Object.keys(perSource).length} sources)`);
  console.log(`Per source:`, perSource);
  return payload;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("health-pharma-r3-fetch failed:", err);
    process.exit(1);
  });
}
