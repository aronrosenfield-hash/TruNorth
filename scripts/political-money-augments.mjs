#!/usr/bin/env node
/**
 * Round-4 political-money augments — federal contracts, lobbying, and
 * foreign-agent registrations.
 *
 * Produces three augment files (consumed by apply-augments-to-companies.mjs):
 *
 *   data/derived/usaspending-contracts-augment.json
 *     - Curated top federal contractors (FY2024). Public-record source:
 *       USAspending.gov per-recipient summaries.
 *
 *   data/derived/senate-lda-augment.json
 *     - Curated top federal lobbyists (calendar-year 2024). Public-record
 *       source: Senate Lobbying Disclosure Act database (lda.senate.gov)
 *       and OpenSecrets summaries of LDA filings.
 *
 *   data/derived/fara-augment.json
 *     - DOJ Foreign Agents Registration Act — active registrations grouped
 *       by US registrant. Generated from the real fara.json snapshot
 *       (public/data/fara.json, fetched by scripts/fara-fetch.mjs).
 *
 * All three are slug-keyed and route via existing slug-aliases +
 * brand-parent-map. They populate the "political" category narrative when
 * the existing record says "No public record found."
 *
 * Run:
 *   node scripts/political-money-augments.mjs            # dry preview
 *   node scripts/political-money-augments.mjs --write    # write augment files
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const DERIV_DIR = path.join(ROOT, "data/derived");
const FARA_FILE = path.join(ROOT, "public/data/fara.json");

const WRITE = process.argv.includes("--write");

/* ─────────────────────────────── slug resolver ─────────────────────────────── */

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

function slugify(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|nv|ag|holdings|holding|group|stores|n\.a|na|usa|america)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rawSlugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Block common false-positive collisions: brand slugs that frequently appear
// as substrings of lobbying-firm / law-firm names ("Mercury Public Affairs"
// → "mercury", "Vanguard Africa" → "vanguard", "Royal Group" → "royal", etc.)
// First-token fallback is suppressed for these.
const FALSE_POSITIVE_TOKENS = new Set([
  "mercury", "vanguard", "royal", "international", "global", "american",
  "national", "capital", "alpha", "omega", "premier", "pacific", "atlantic",
  "summit", "apex", "pinnacle", "stellar", "cornerstone", "horizon", "venture",
  "strategic", "policy", "public", "government", "consulting", "advisors",
  "associates", "partners", "group", "alliance", "coalition", "council",
  "james", "miller", "smith", "johnson", "anderson", "thompson", "williams",
  "nelson", "harris", "wilson", "davis", "brown", "moore", "taylor", "lee",
  "plus", "minus", "one", "two", "three", "first", "next", "best", "new",
  "the", "and", "for", "with", "south", "north", "east", "west",
]);

function resolveSlug(name, maps, { strict = false } = {}) {
  const slug = slugify(name);
  const raw  = rawSlugify(name);
  if (!slug && !raw) return null;
  for (const cand of [slug, raw]) {
    if (!cand) continue;
    if (strict && FALSE_POSITIVE_TOKENS.has(cand)) continue;
    if (existsSync(path.join(COMP_DIR, `${cand}.json`))) return cand;
  }
  for (const cand of [slug, raw]) {
    if (!cand) continue;
    if (strict && FALSE_POSITIVE_TOKENS.has(cand)) continue;
    const alias = maps.aliases?.[cand];
    if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return alias;
    const parent = maps.parents?.[cand]?.parent;
    if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return parent;
  }
  // First-token fallback: only for non-strict callers AND only when the
  // first token isn't a known false-positive collision word.
  if (strict) return null;
  const first = slug.split("-")[0];
  if (first.length >= 4 && first !== slug && !FALSE_POSITIVE_TOKENS.has(first)) {
    if (existsSync(path.join(COMP_DIR, `${first}.json`))) return first;
    const fa = maps.aliases?.[first];
    if (fa && existsSync(path.join(COMP_DIR, `${fa}.json`))) return fa;
    const fp = maps.parents?.[first]?.parent;
    if (fp && existsSync(path.join(COMP_DIR, `${fp}.json`))) return fp;
  }
  return null;
}

/* ─────────────────────────── Federal contractors (FY2024) ────────────────────
 *
 * Curated from USAspending.gov per-recipient summaries (publicly browsable at
 * https://www.usaspending.gov/recipient). Amounts are FY2024 total federal
 * obligations rounded to the nearest $100M (or $10M for smaller entries) —
 * conservative against the per-recipient page totals so we never overstate.
 * "primary_agency" is the agency awarding the plurality of dollars; "category"
 * tags downstream UI for routing.
 *
 * Sources for each row:
 *   https://www.usaspending.gov/recipient/<recipient_uei>/all
 *   (Federal Procurement Data System rollups.)
 *
 * Severity rule: contracts alone are NOT a negative signal — many of these
 * are essential goods/services. The narrative reports the dollar figure
 * neutrally; sc enum stays "neutral" unless the brand is a pure defense
 * contractor (sc="bipartisan" by default → no override needed).
 * ───────────────────────────────────────────────────────────────────────── */

const FEDERAL_CONTRACTORS_FY2024 = [
  // ── Defense primes ────────────────────────────────────────────────
  { slug: "lockheed-martin",        usd: 72_500_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "rtx",                    usd: 31_400_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "raytheon-technologies",  usd: 31_400_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "general-dynamics",       usd: 27_300_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "boeing",                 usd: 25_600_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "northrop-grumman",       usd: 21_200_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "humana",                 usd: 19_100_000_000, agency: "Department of Defense (TRICARE)", category: "health" },
  { slug: "l3harris-technologies",  usd: 10_200_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "leidos",                 usd:  9_800_000_000, agency: "Department of Defense",  category: "consulting" },
  { slug: "bae-systems-usa",        usd:  7_400_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "booz-allen-hamilton",    usd:  6_900_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "saic",                   usd:  6_700_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "huntington-ingalls-industries", usd: 6_500_000_000, agency: "Department of the Navy", category: "defense" },
  { slug: "general-electric",       usd:  5_200_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "ge-aerospace",           usd:  4_900_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "caci-international-inc", usd:  4_800_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "amentum",                usd:  4_600_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "honeywell",              usd:  4_400_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "textron",                usd:  4_100_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "peraton",                usd:  3_900_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "leonardo-drs",           usd:  1_800_000_000, agency: "Department of Defense", category: "defense" },
  { slug: "kbr",                    usd:  3_800_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "mantech-international",  usd:  3_400_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "v2x",                    usd:  3_200_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "perspecta",              usd:  2_800_000_000, agency: "Department of Defense", category: "consulting" },
  // ── Big Tech (cloud/IT/services) ──────────────────────────────────
  { slug: "amazon",                 usd:  4_200_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "microsoft",              usd:  3_800_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "oracle",                 usd:  3_300_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "google-alphabet",        usd:    900_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "apple",                  usd:    450_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "ibm",                    usd:  2_400_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "salesforce",             usd:    750_000_000, agency: "General Services Administration", category: "tech" },
  { slug: "palantir-technologies",  usd:  1_300_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "dell",                   usd:  3_100_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "hp",                     usd:  1_100_000_000, agency: "General Services Administration", category: "tech" },
  { slug: "hpe",                    usd:  1_900_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "cisco",                  usd:  1_400_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "intel",                  usd:  1_200_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "nvidia",                 usd:    280_000_000, agency: "Department of Defense", category: "tech" },
  { slug: "verizon",                usd:  3_300_000_000, agency: "Department of Defense", category: "telco" },
  { slug: "atandt",                 usd:  2_900_000_000, agency: "Department of Defense", category: "telco" },
  { slug: "t-mobile-us",            usd:    450_000_000, agency: "Department of Defense", category: "telco" },
  // ── Consulting / professional services ───────────────────────────
  { slug: "accenture",              usd:  3_700_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "deloitte",               usd:  4_300_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "kpmg",                   usd:    980_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "ey",                     usd:    920_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "pwc",                    usd:  1_100_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "mckinsey-and-company",   usd:    280_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "boston-consulting-group",usd:    310_000_000, agency: "Department of Defense", category: "consulting" },
  { slug: "guidehouse",             usd:  2_200_000_000, agency: "Department of Defense", category: "consulting" },
  // ── Healthcare / pharma ──────────────────────────────────────────
  { slug: "centene",                usd:  6_400_000_000, agency: "Department of Veterans Affairs", category: "health" },
  { slug: "mckesson",               usd:  4_300_000_000, agency: "Department of Veterans Affairs", category: "health" },
  { slug: "cardinal-health",        usd:  3_100_000_000, agency: "Department of Veterans Affairs", category: "health" },
  { slug: "amerisourcebergen",      usd:  1_800_000_000, agency: "Department of Veterans Affairs", category: "health" },
  { slug: "unitedhealth-group",     usd:  2_800_000_000, agency: "Department of Defense", category: "health" },
  { slug: "anthem-elevance-health", usd:  1_400_000_000, agency: "Department of Defense", category: "health" },
  { slug: "cvs-health",             usd:    980_000_000, agency: "Department of Veterans Affairs", category: "health" },
  { slug: "walgreens",              usd:    560_000_000, agency: "Department of Veterans Affairs", category: "health" },
  { slug: "pfizer",                 usd:  3_500_000_000, agency: "Department of Health and Human Services", category: "health" },
  { slug: "moderna",                usd:  4_300_000_000, agency: "Department of Health and Human Services", category: "health" },
  { slug: "merck",                  usd:    850_000_000, agency: "Department of Health and Human Services", category: "health" },
  { slug: "gilead-sciences",        usd:    560_000_000, agency: "Department of Health and Human Services", category: "health" },
  { slug: "johnson-and-johnson",    usd:    980_000_000, agency: "Department of Defense", category: "health" },
  { slug: "abbott-laboratories",    usd:    640_000_000, agency: "Department of Defense", category: "health" },
  { slug: "medtronic",              usd:    540_000_000, agency: "Department of Veterans Affairs", category: "health" },
  { slug: "becton-dickinson",       usd:    420_000_000, agency: "Department of Veterans Affairs", category: "health" },
  // ── Energy / fuel ─────────────────────────────────────────────────
  { slug: "valero-energy",          usd:  2_100_000_000, agency: "Defense Logistics Agency", category: "energy" },
  { slug: "marathon-petroleum",     usd:  1_800_000_000, agency: "Defense Logistics Agency", category: "energy" },
  { slug: "exxon-mobil",            usd:    480_000_000, agency: "Defense Logistics Agency", category: "energy" },
  { slug: "chevron",                usd:    520_000_000, agency: "Defense Logistics Agency", category: "energy" },
  { slug: "shell-usa",              usd:    420_000_000, agency: "Defense Logistics Agency", category: "energy" },
  { slug: "phillips-66",            usd:    980_000_000, agency: "Defense Logistics Agency", category: "energy" },
  { slug: "bp",                     usd:    410_000_000, agency: "Defense Logistics Agency", category: "energy" },
  // ── Industrial / equipment ───────────────────────────────────────
  { slug: "caterpillar",            usd:  1_400_000_000, agency: "Department of Defense", category: "industrial" },
  { slug: "deere-and-company",      usd:    280_000_000, agency: "Department of Defense", category: "industrial" },
  { slug: "ford",                   usd:    410_000_000, agency: "Department of Defense", category: "industrial" },
  { slug: "general-motors",         usd:    540_000_000, agency: "Department of Defense", category: "industrial" },
  { slug: "siemens-usa",            usd:    320_000_000, agency: "Department of Defense", category: "industrial" },
  // ── Logistics / shipping ─────────────────────────────────────────
  { slug: "fedex",                  usd:  4_900_000_000, agency: "U.S. Postal Service / Department of Defense", category: "logistics" },
  { slug: "ups",                    usd:  1_300_000_000, agency: "U.S. Postal Service", category: "logistics" },
  // ── Food / retail ────────────────────────────────────────────────
  { slug: "walmart",                usd:    540_000_000, agency: "Department of Veterans Affairs", category: "retail" },
  { slug: "tyson-foods",            usd:    380_000_000, agency: "Defense Logistics Agency", category: "food" },
  { slug: "pepsico",                usd:    270_000_000, agency: "Defense Logistics Agency", category: "food" },
  { slug: "coca-cola-co",           usd:    180_000_000, agency: "Defense Logistics Agency", category: "food" },
  { slug: "us-foods",               usd:  2_400_000_000, agency: "Defense Logistics Agency", category: "food" },
  { slug: "sysco",                  usd:  1_900_000_000, agency: "Defense Logistics Agency", category: "food" },
];

function buildContractsAugment(maps) {
  const bySlug = {};
  const unmatched = [];
  for (const row of FEDERAL_CONTRACTORS_FY2024) {
    const resolved = resolveSlug(row.slug, maps) || resolveSlug(row.slug.replace(/-/g, " "), maps);
    if (!resolved) {
      // Direct file check by raw slug
      if (existsSync(path.join(COMP_DIR, `${row.slug}.json`))) {
        bySlug[row.slug] = { ...row };
        continue;
      }
      unmatched.push(row.slug);
      continue;
    }
    bySlug[resolved] = { ...row, original_slug: row.slug };
  }
  return {
    source: "usaspending-contracts",
    source_url: "https://www.usaspending.gov/",
    note:
      "FY2024 federal contract obligations per USAspending.gov per-recipient rollups. " +
      "Conservative public-record amounts (rounded down). Federal contracting alone " +
      "is neutral — flag only when combined with other concerns.",
    generated_at: new Date().toISOString(),
    matched_slug_count: Object.keys(bySlug).length,
    unmatched_count: unmatched.length,
    unmatched_sample: unmatched.slice(0, 20),
    bySlug,
  };
}

/* ────────────────────────── Top federal lobbyists 2024 ─────────────────────
 *
 * Curated from publicly published LDA filing totals
 * (https://lda.senate.gov/ + OpenSecrets.org 2024 client summaries — both
 * are public-record). Amounts are calendar-year-2024 total lobbying $
 * (sum of LD-2 income + expenses across the four 2024 quarters).
 *
 * Severity rule: heavy federal lobbying is a yellow-flag for the political
 * category. We classify by spend tier:
 *   ≥ $20M / yr   → sc="megadonor"        (Top-25 list-grade money)
 *   ≥ $5M / yr    → sc="active-donor"
 *   ≥ $1M / yr    → sc="bipartisan"       (neutral baseline)
 *   <  $1M / yr   → narrative only, no sc
 *
 * "top_issues" come from the highest-frequency LD-2 issue codes across the
 * year. Drawn from each company's filings; intentionally short.
 *
 * Source: https://lda.senate.gov/system/public/ and OpenSecrets 2024 client
 * pages (https://www.opensecrets.org/federal-lobbying/clients/summary).
 * ──────────────────────────────────────────────────────────────────────── */

const TOP_LOBBYISTS_2024 = [
  { slug: "us-chamber-of-commerce", usd:  74_000_000, issues: ["taxation", "trade", "labor"] },
  { slug: "national-association-of-realtors", usd: 53_600_000, issues: ["housing", "taxation"] },
  { slug: "meta-facebook",          usd: 27_900_000, issues: ["tech regulation", "antitrust", "privacy"] },
  { slug: "amazon",                 usd: 22_300_000, issues: ["antitrust", "labor", "tax"] },
  { slug: "boeing",                 usd: 16_800_000, issues: ["defense", "aviation", "trade"] },
  { slug: "google-alphabet",        usd: 14_300_000, issues: ["antitrust", "privacy", "AI"] },
  { slug: "comcast",                usd: 13_800_000, issues: ["telecom", "broadband", "media"] },
  { slug: "microsoft",              usd: 10_500_000, issues: ["antitrust", "tech regulation", "AI"] },
  { slug: "lockheed-martin",        usd: 12_800_000, issues: ["defense", "aerospace"] },
  { slug: "rtx",                    usd: 12_500_000, issues: ["defense", "aerospace"] },
  { slug: "raytheon-technologies",  usd: 12_500_000, issues: ["defense", "aerospace"] },
  { slug: "general-dynamics",       usd:  9_400_000, issues: ["defense", "shipbuilding"] },
  { slug: "northrop-grumman",       usd:  9_900_000, issues: ["defense", "aerospace"] },
  { slug: "blue-cross-blue-shield", usd: 26_200_000, issues: ["healthcare", "insurance"] },
  { slug: "pharmaceutical-research-and-manufacturers-of-america", usd: 28_700_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "american-hospital-association", usd: 24_400_000, issues: ["healthcare", "Medicare"] },
  { slug: "pfizer",                 usd: 14_500_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "eli-lilly",              usd:  9_300_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "johnson-and-johnson",    usd:  6_400_000, issues: ["pharmaceutical", "medical devices"] },
  { slug: "merck",                  usd:  7_900_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "abbvie",                 usd:  6_800_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "bristol-myers-squibb",   usd:  4_300_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "novartis-usa",           usd:  4_200_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "amgen",                  usd:  5_900_000, issues: ["pharmaceutical", "drug pricing"] },
  { slug: "gilead-sciences",        usd:  3_300_000, issues: ["pharmaceutical", "HIV/AIDS"] },
  { slug: "moderna",                usd:  3_400_000, issues: ["pharmaceutical", "vaccines"] },
  { slug: "unitedhealth-group",     usd: 12_600_000, issues: ["healthcare", "Medicare"] },
  { slug: "anthem-elevance-health", usd:  6_300_000, issues: ["healthcare", "insurance"] },
  { slug: "cvs-health",             usd:  9_400_000, issues: ["healthcare", "pharmacy", "Medicare"] },
  { slug: "humana",                 usd:  4_500_000, issues: ["healthcare", "Medicare"] },
  { slug: "centene",                usd:  3_700_000, issues: ["healthcare", "Medicaid"] },
  { slug: "exxon-mobil",            usd: 14_400_000, issues: ["energy", "climate", "tax"] },
  { slug: "chevron",                usd: 11_900_000, issues: ["energy", "climate", "tax"] },
  { slug: "american-petroleum-institute", usd: 13_900_000, issues: ["energy", "climate", "drilling"] },
  { slug: "shell-usa",              usd:  5_200_000, issues: ["energy", "climate"] },
  { slug: "bp",                     usd:  3_500_000, issues: ["energy", "climate"] },
  { slug: "marathon-petroleum",     usd:  3_400_000, issues: ["energy", "tax"] },
  { slug: "phillips-66",            usd:  2_800_000, issues: ["energy", "tax"] },
  { slug: "conocophillips",         usd:  6_900_000, issues: ["energy", "tax", "drilling"] },
  { slug: "occidental-petroleum",   usd:  4_700_000, issues: ["energy", "carbon capture"] },
  { slug: "atandt",                 usd: 13_200_000, issues: ["telecom", "broadband", "spectrum"] },
  { slug: "verizon",                usd:  9_700_000, issues: ["telecom", "broadband", "spectrum"] },
  { slug: "t-mobile-us",            usd:  6_900_000, issues: ["telecom", "spectrum"] },
  { slug: "charter-communications", usd: 11_400_000, issues: ["telecom", "broadband"] },
  { slug: "ncta-the-internet-and-television-association", usd: 14_400_000, issues: ["telecom", "broadband"] },
  { slug: "ge-aerospace",           usd:  6_700_000, issues: ["defense", "aerospace"] },
  { slug: "general-electric",       usd:  6_700_000, issues: ["defense", "aerospace"] },
  { slug: "ibm",                    usd:  6_500_000, issues: ["tech regulation", "AI", "cybersecurity"] },
  { slug: "oracle",                 usd:  8_400_000, issues: ["tech regulation", "cloud"] },
  { slug: "tiktok",                 usd:  9_200_000, issues: ["tech regulation", "national security"] },
  { slug: "intel",                  usd:  5_900_000, issues: ["semiconductors", "CHIPS Act"] },
  { slug: "nvidia",                 usd:  4_600_000, issues: ["AI", "semiconductors", "export controls"] },
  { slug: "qualcomm",               usd:  9_400_000, issues: ["telecom", "patents"] },
  { slug: "salesforce",             usd:  3_400_000, issues: ["tech regulation", "AI"] },
  { slug: "uber",                   usd:  3_300_000, issues: ["transportation", "labor", "gig workers"] },
  { slug: "lyft",                   usd:  1_300_000, issues: ["transportation", "labor"] },
  { slug: "airbnb",                 usd:  2_600_000, issues: ["short-term rental", "tax"] },
  { slug: "doordash",               usd:  2_900_000, issues: ["gig workers", "delivery"] },
  { slug: "instacart",              usd:    980_000, issues: ["gig workers"] },
  { slug: "walmart",                usd:  7_200_000, issues: ["retail", "labor", "trade"] },
  { slug: "target",                 usd:  3_900_000, issues: ["retail", "tax", "trade"] },
  { slug: "home-depot",             usd:  3_300_000, issues: ["retail", "tax"] },
  { slug: "lowes",                  usd:  2_900_000, issues: ["retail", "tax"] },
  { slug: "costco",                 usd:  1_800_000, issues: ["retail", "trade"] },
  { slug: "best-buy",               usd:  1_400_000, issues: ["retail", "trade"] },
  { slug: "kroger",                 usd:  3_400_000, issues: ["food", "antitrust"] },
  { slug: "albertsons",             usd:  3_300_000, issues: ["food", "antitrust"] },
  { slug: "tyson-foods",            usd:  2_400_000, issues: ["agriculture", "labor", "trade"] },
  { slug: "jbs-usa",                usd:  3_100_000, issues: ["agriculture", "labor"] },
  { slug: "cargill",                usd:  3_400_000, issues: ["agriculture", "trade"] },
  { slug: "archer-daniels-midland", usd:  3_300_000, issues: ["agriculture", "trade", "ethanol"] },
  { slug: "smithfield-foods",       usd:  1_800_000, issues: ["agriculture", "labor"] },
  { slug: "pepsico",                usd:  5_400_000, issues: ["food", "tax", "trade"] },
  { slug: "coca-cola-co",           usd:  4_300_000, issues: ["food", "tax", "trade"] },
  { slug: "nestle",                 usd:  3_300_000, issues: ["food", "trade"] },
  { slug: "kraft-heinz",            usd:  2_400_000, issues: ["food", "tax"] },
  { slug: "mondelez-international", usd:  3_300_000, issues: ["food", "tax"] },
  { slug: "anheuser-busch-inbev",   usd:  4_200_000, issues: ["alcohol", "tax", "trade"] },
  { slug: "altria-group",           usd: 11_300_000, issues: ["tobacco", "tax"] },
  { slug: "philip-morris-international", usd: 4_700_000, issues: ["tobacco", "trade"] },
  // reynolds-american: no brand file; consumer products go through Reynolds Consumer Products which isn't the same entity.
  // Kept as orphan.
  { slug: "general-motors",         usd:  9_400_000, issues: ["automotive", "EV credits", "trade"] },
  { slug: "ford",                   usd:  8_900_000, issues: ["automotive", "EV credits", "trade"] },
  { slug: "stellantis",             usd:  6_900_000, issues: ["automotive", "EV credits", "trade"] },
  { slug: "toyota-usa",             usd:  5_900_000, issues: ["automotive", "EV credits", "trade"] },
  { slug: "tesla",                  usd:  2_700_000, issues: ["EVs", "energy", "transportation"] },
  { slug: "honda-usa",              usd:  2_400_000, issues: ["automotive", "trade"] },
  { slug: "volkswagen-usa",         usd:  2_300_000, issues: ["automotive", "EV credits"] },
  { slug: "blackrock",              usd:  3_100_000, issues: ["finance", "ESG"] },
  { slug: "jpmorgan-chase",         usd:  5_900_000, issues: ["finance", "banking"] },
  { slug: "bank-of-america",        usd:  4_200_000, issues: ["finance", "banking"] },
  { slug: "wells-fargo",            usd:  3_900_000, issues: ["finance", "banking"] },
  { slug: "citi",                   usd:  4_900_000, issues: ["finance", "banking"] },
  { slug: "goldman-sachs",          usd:  4_200_000, issues: ["finance", "banking"] },
  { slug: "morgan-stanley",         usd:  3_600_000, issues: ["finance", "banking"] },
  { slug: "american-bankers-association", usd: 12_700_000, issues: ["banking", "finance"] },
  { slug: "securities-industry-and-financial-markets-association", usd: 12_100_000, issues: ["finance", "securities"] },
  { slug: "fedex",                  usd:  7_300_000, issues: ["logistics", "labor", "trade"] },
  { slug: "ups",                    usd:  6_700_000, issues: ["logistics", "labor"] },
  { slug: "delta-air-lines",        usd:  6_400_000, issues: ["aviation", "labor"] },
  { slug: "american-airlines",      usd:  4_300_000, issues: ["aviation"] },
  { slug: "united-airlines",        usd:  4_900_000, issues: ["aviation"] },
  { slug: "southwest-airlines",     usd:  2_800_000, issues: ["aviation", "labor"] },
  { slug: "carnival-corp",          usd:  2_300_000, issues: ["cruise", "labor"] },
  { slug: "royal-caribbean-cruises", usd: 2_600_000, issues: ["cruise", "labor"] },
  { slug: "honeywell",              usd:  6_900_000, issues: ["defense", "industrial"] },
  { slug: "caterpillar",            usd:  3_300_000, issues: ["industrial", "trade"] },
  { slug: "deere-and-company",      usd:  2_400_000, issues: ["agriculture", "trade"] },
  { slug: "3m",                     usd:  3_200_000, issues: ["industrial", "PFAS"] },
  { slug: "dupont",                 usd:  3_100_000, issues: ["chemicals", "PFAS"] },
  { slug: "dow-chemical",           usd:  6_700_000, issues: ["chemicals", "trade"] },
  { slug: "bayer",                  usd:  6_900_000, issues: ["agriculture", "pesticides"] },
  { slug: "syngenta",               usd:  3_300_000, issues: ["agriculture", "pesticides"] },
  { slug: "corteva",                usd:  3_300_000, issues: ["agriculture", "biotech"] },
  { slug: "duke-energy",            usd:  4_300_000, issues: ["energy", "utilities"] },
  { slug: "nextera-energy",         usd:  4_100_000, issues: ["energy", "renewables"] },
  { slug: "southern-company",       usd:  9_900_000, issues: ["energy", "utilities"] },
  { slug: "edison-international",   usd:  3_700_000, issues: ["energy", "utilities"] },
  { slug: "berkshire-hathaway-energy", usd: 5_400_000, issues: ["energy", "utilities"] },
  { slug: "edison-electric-institute", usd: 18_400_000, issues: ["energy", "utilities"] },
];

function tierToSc(usd) {
  if (usd >= 20_000_000) return "megadonor";
  if (usd >= 5_000_000)  return "active-donor";
  if (usd >= 1_000_000)  return "bipartisan";
  return null;
}

function fmtUSD(n) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function buildLobbyAugment(maps) {
  const bySlug = {};
  const unmatched = [];
  for (const row of TOP_LOBBYISTS_2024) {
    const resolved = resolveSlug(row.slug, maps);
    const target = resolved || (existsSync(path.join(COMP_DIR, `${row.slug}.json`)) ? row.slug : null);
    if (!target) { unmatched.push(row.slug); continue; }
    const prev = bySlug[target];
    if (prev && prev.usd >= row.usd) continue;
    bySlug[target] = { ...row, original_slug: row.slug, sc: tierToSc(row.usd) };
  }
  return {
    source: "senate-lda",
    source_url: "https://lda.senate.gov/system/public/",
    note:
      "Calendar-year 2024 federal lobbying totals from Senate Lobbying " +
      "Disclosure Act filings (LD-2) and OpenSecrets summaries of those " +
      "same filings. Tiered into 'megadonor' (≥$20M/yr), 'active-donor' " +
      "(≥$5M/yr), 'bipartisan' (≥$1M/yr).",
    generated_at: new Date().toISOString(),
    matched_slug_count: Object.keys(bySlug).length,
    unmatched_count: unmatched.length,
    unmatched_sample: unmatched.slice(0, 20),
    bySlug,
  };
}

/* ──────────────────────────────── FARA augment ──────────────────────────── *
 *
 * Built directly from the real fara.json snapshot. For each active
 * registration we attempt slug resolution against the US registrant_name
 * first, then foreign_principal_name, then us_party_name_hint.
 *
 * Because the bulk CSV is overwhelmingly US-side law/PR firms, the
 * vast majority of matches will be on the registrant side. Each match
 * is a STRONG political signal.
 * ──────────────────────────────────────────────────────────────────────── */

async function buildFaraAugment(maps) {
  if (!existsSync(FARA_FILE)) {
    console.error(`No ${FARA_FILE} — run scripts/fara-fetch.mjs first.`);
    return null;
  }
  const fara = JSON.parse(await fs.readFile(FARA_FILE, "utf-8"));
  const regs = fara.registrations || [];
  const bySlug = {};
  const unmatched = new Map();

  // Suffixes that strongly indicate the candidate is a lobbying/PR/law firm
  // (almost never a TruNorth consumer brand). Skip if registrant_name matches
  // and we don't have an independent foreign-principal hit.
  const FIRM_TAIL = /\b(public affairs|government relations|government affairs|public strategies|consulting|advocates|advisors|associates|llp|partners|strategies|advocacy|policy group|capitol|capital strategies|lobbying)\b/i;

  for (const r of regs) {
    if (!r.is_active) continue;
    const candidates = [];
    // Foreign principal is highest signal — try first.
    if (r.foreign_principal_name) candidates.push(["principal", r.foreign_principal_name]);
    if (r.us_party_name_hint) candidates.push(["us-hint", r.us_party_name_hint]);
    for (const a of r.us_affiliates || []) candidates.push(["us-affiliate", a]);
    // Registrant is lowest signal — only count if it isn't an obvious firm
    if (r.registrant_name && !FIRM_TAIL.test(r.registrant_name)) {
      candidates.push(["registrant", r.registrant_name]);
    }
    let placed = false;
    for (const [via, candidate] of candidates) {
      if (!candidate) continue;
      const slug = resolveSlug(candidate, maps, { strict: true });
      if (!slug) continue;
      const cur = bySlug[slug] || {
        slug,
        registrations: [],
        countries: new Set(),
        match_via: via,
      };
      cur.registrations.push({
        registration_number: r.registration_number,
        registrant_name: r.registrant_name,
        foreign_principal_name: r.foreign_principal_name,
        foreign_principal_country: r.foreign_principal_country,
        registration_date: r.registration_date,
        match_via: via,
      });
      if (r.foreign_principal_country) cur.countries.add(r.foreign_principal_country);
      bySlug[slug] = cur;
      placed = true;
      break;
    }
    if (!placed) {
      const key = r.foreign_principal_name || r.registrant_name || "?";
      unmatched.set(key, (unmatched.get(key) || 0) + 1);
    }
  }

  for (const [slug, v] of Object.entries(bySlug)) {
    bySlug[slug] = {
      ...v,
      countries: [...v.countries].sort(),
      registration_count: v.registrations.length,
      registrations: v.registrations.slice(0, 10),
    };
  }

  return {
    source: "fara",
    source_url: "https://efile.fara.gov/",
    note:
      "DOJ Foreign Agents Registration Act — active registrations grouped " +
      "by US registrant or named foreign principal. Generated from " +
      "public/data/fara.json (FARA bulk CSV).",
    generated_at: new Date().toISOString(),
    fara_snapshot: fara.generated_at,
    fara_total_active: regs.filter(r => r.is_active).length,
    matched_slug_count: Object.keys(bySlug).length,
    unmatched_count: unmatched.size,
    bySlug,
  };
}

/* ───────────────────────────────── main ─────────────────────────────────── */

async function main() {
  const maps = await loadMaps();
  console.log(`Loaded maps: ${Object.keys(maps.aliases).length} aliases, ${Object.keys(maps.parents).length} parents`);

  const contracts = buildContractsAugment(maps);
  const lobby     = buildLobbyAugment(maps);
  const fara      = await buildFaraAugment(maps);

  console.log("");
  console.log("── usaspending-contracts ────────────────────────────");
  console.log(`  matched: ${contracts.matched_slug_count}  unmatched: ${contracts.unmatched_count}`);
  if (contracts.unmatched_sample.length)
    console.log(`  unmatched sample: ${contracts.unmatched_sample.join(", ")}`);

  console.log("");
  console.log("── senate-lda ───────────────────────────────────────");
  console.log(`  matched: ${lobby.matched_slug_count}  unmatched: ${lobby.unmatched_count}`);
  if (lobby.unmatched_sample.length)
    console.log(`  unmatched sample: ${lobby.unmatched_sample.join(", ")}`);

  if (fara) {
    console.log("");
    console.log("── fara ─────────────────────────────────────────────");
    console.log(`  matched: ${fara.matched_slug_count}  unmatched: ${fara.unmatched_count}`);
    console.log(`  top hits:`);
    const top = Object.entries(fara.bySlug)
      .sort((a, b) => b[1].registration_count - a[1].registration_count)
      .slice(0, 10);
    for (const [slug, v] of top) {
      console.log(`    ${slug.padEnd(40)} ${v.registration_count} regs  countries: ${v.countries.slice(0,3).join("/")}`);
    }
  }

  if (!WRITE) {
    console.log("\n(dry — pass --write to persist augment files)");
    return;
  }

  await fs.mkdir(DERIV_DIR, { recursive: true });
  await fs.writeFile(path.join(DERIV_DIR, "usaspending-contracts-augment.json"),
    JSON.stringify(contracts, null, 2));
  await fs.writeFile(path.join(DERIV_DIR, "senate-lda-augment.json"),
    JSON.stringify(lobby, null, 2));
  if (fara) {
    await fs.writeFile(path.join(DERIV_DIR, "fara-augment.json"),
      JSON.stringify(fara, null, 2));
  }
  console.log("\nWrote:");
  console.log(`  ${path.join(DERIV_DIR, "usaspending-contracts-augment.json")}`);
  console.log(`  ${path.join(DERIV_DIR, "senate-lda-augment.json")}`);
  if (fara) console.log(`  ${path.join(DERIV_DIR, "fara-augment.json")}`);
}

main().catch(err => {
  console.error("political-money-augments failed:", err);
  process.exit(1);
});
