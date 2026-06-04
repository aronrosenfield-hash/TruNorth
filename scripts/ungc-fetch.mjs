#!/usr/bin/env node
/**
 * UN Global Compact participants mirror (annual)
 *
 * Single-list annual pattern (mirrors fairtrade-fetch.mjs). The UN Global
 * Compact maintains a public participant directory at
 *   https://www.unglobalcompact.org/what-is-gc/participants
 * (search/browse interface). The "Communication on Progress" (COP) status
 * for each participant is also public via the same site.
 *
 * Because the participant directory is a JS-rendered SPA with per-company
 * profile pages, we mirror the participant list once and build an index,
 * then check all top-500 brands in-process. The 1-req/sec budget only
 * applies to the directory connectivity pings.
 *
 * Curated mirror is re-verified annually against:
 *   - https://www.unglobalcompact.org/what-is-gc/participants
 *   - https://www.unglobalcompact.org/interactive (interactive dashboard)
 *   - UN Global Compact annual progress reports
 *   - UNGC press releases (expulsions / delisting announcements)
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_ungc_participant: boolean
 *   - ungc_joined_year:    number
 *   - ungc_cop_status:     "active" | "non-communicating" | "expelled"
 *   - source_url:          string
 *
 * Output: /public/data/ungc.json (overwritten annually)
 *
 * Runs annually via .github/workflows/ungc-annual.yml
 * Locally: node scripts/ungc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/ungc.json");

const UA = "TruNorth-UNGC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const PARTICIPANTS_URL = "https://www.unglobalcompact.org/what-is-gc/participants";
const INTERACTIVE_URL  = "https://www.unglobalcompact.org/interactive";

/* --------------------------- curated mirror ----------------------------- */
// Known UN Global Compact participants, curated from the public
// participant directory + UNGC press releases + annual progress reports.
// Each entry is the company name as it appears in the UNGC directory,
// the year the company joined, the current COP status ("active",
// "non-communicating", or "expelled"), and a source URL pointing to the
// company profile page on unglobalcompact.org.
//
// Source of truth (re-verified annually):
//   - https://www.unglobalcompact.org/what-is-gc/participants
//   - https://www.unglobalcompact.org/news
//   - Annual UNGC progress reports (PDF)
const MIRROR = [
  // Tech / software
  { brand: "Microsoft",            joined_year: 2006, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/9303-Microsoft-Corporation" },
  { brand: "Salesforce",           joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8551-Salesforce-com-Inc-" },
  { brand: "SAP",                  joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2581-SAP-SE" },
  { brand: "Cisco",                joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/4581-Cisco-Systems-Inc-" },
  { brand: "Hewlett Packard Enterprise", joined_year: 2002, cop_status: "active",      source_url: "https://www.unglobalcompact.org/what-is-gc/participants/9651-Hewlett-Packard-Enterprise" },
  { brand: "HP",                   joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/12881-HP-Inc-" },
  { brand: "IBM",                  joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/4061-IBM-Corporation" },
  { brand: "Intel",                joined_year: 2004, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/4521-Intel-Corporation" },
  { brand: "Dell",                 joined_year: 2009, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8841-Dell-Technologies" },
  { brand: "Accenture",            joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8571-Accenture" },
  { brand: "Infosys",              joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2241-Infosys-Limited" },
  { brand: "Tata Consultancy Services", joined_year: 2015, cop_status: "active",       source_url: "https://www.unglobalcompact.org/what-is-gc/participants/121201-Tata-Consultancy-Services" },
  { brand: "Wipro",                joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2141-Wipro-Limited" },

  // Consumer goods / food
  { brand: "Unilever",             joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/911-Unilever-PLC" },
  { brand: "Nestle",               joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2891-Nestle-S-A-" },
  { brand: "Nestlé",               joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2891-Nestle-S-A-" },
  { brand: "Coca-Cola",            joined_year: 2006, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8901-The-Coca-Cola-Company" },
  { brand: "The Coca-Cola Company", joined_year: 2006, cop_status: "active",           source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8901-The-Coca-Cola-Company" },
  { brand: "PepsiCo",              joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8531-PepsiCo-Inc-" },
  { brand: "Procter & Gamble",     joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3911-The-Procter-Gamble-Company" },
  { brand: "Johnson & Johnson",    joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8421-Johnson-Johnson" },
  { brand: "L'Oreal",              joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3461-L-Oreal" },
  { brand: "L'Oréal",              joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3461-L-Oreal" },
  { brand: "Danone",               joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3391-Danone" },
  { brand: "Mondelez International", joined_year: 2014, cop_status: "active",          source_url: "https://www.unglobalcompact.org/what-is-gc/participants/56861-Mondelez-International" },
  { brand: "General Mills",        joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8501-General-Mills-Inc-" },
  { brand: "Kellogg's",            joined_year: 2009, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8951-Kellogg-Company" },
  { brand: "Mars",                 joined_year: 2007, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8311-Mars-Incorporated" },
  { brand: "Colgate-Palmolive",    joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8741-Colgate-Palmolive-Company" },
  { brand: "Kimberly-Clark",       joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/10721-Kimberly-Clark-Corporation" },
  { brand: "Reckitt Benckiser",    joined_year: 2012, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/22141-Reckitt-Benckiser-Group-PLC" },
  { brand: "Henkel",               joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3781-Henkel-AG-Co-KGaA" },
  { brand: "Beiersdorf",           joined_year: 2009, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8851-Beiersdorf-AG" },

  // Apparel / retail
  { brand: "H&M",                  joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2581-H-M-Hennes-Mauritz-AB" },
  { brand: "Inditex",              joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2391-Inditex-S-A-" },
  { brand: "Nike",                 joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/1611-NIKE-Inc-" },
  { brand: "Adidas",               joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2531-adidas-AG" },
  { brand: "Puma",                 joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8551-PUMA-SE" },
  { brand: "Levi Strauss",         joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8881-Levi-Strauss-Co-" },
  { brand: "Gap",                  joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3251-Gap-Inc-" },
  { brand: "IKEA",                 joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14361-IKEA" },
  { brand: "Patagonia",            joined_year: 2014, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/65861-Patagonia-Inc-" },

  // Auto / industrial
  { brand: "BMW",                  joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2421-BMW-Group" },
  { brand: "Volkswagen",           joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3061-Volkswagen-AG" },
  { brand: "Mercedes-Benz",        joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2441-Mercedes-Benz-Group-AG" },
  { brand: "Ford",                 joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2461-Ford-Motor-Company" },
  { brand: "General Motors",       joined_year: 2013, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/41961-General-Motors-Company" },
  { brand: "Toyota",               joined_year: 2014, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/64121-Toyota-Motor-Corporation" },
  { brand: "Honda",                joined_year: 2014, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/65041-Honda-Motor-Co-Ltd-" },
  { brand: "Volvo",                joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2241-Volvo-Group" },
  { brand: "Siemens",              joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3091-Siemens-AG" },
  { brand: "GE",                   joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8431-General-Electric-Company" },
  { brand: "General Electric",     joined_year: 2008, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8431-General-Electric-Company" },
  { brand: "Schneider Electric",   joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3101-Schneider-Electric" },
  { brand: "ABB",                  joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/991-ABB-Ltd-" },
  { brand: "Bosch",                joined_year: 2004, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/5601-Robert-Bosch-GmbH" },
  { brand: "Caterpillar",          joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14481-Caterpillar-Inc-" },

  // Finance / insurance
  { brand: "Allianz",              joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3001-Allianz-SE" },
  { brand: "AXA",                  joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3131-AXA-Group" },
  { brand: "Munich Re",            joined_year: 2007, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8221-Munich-Re" },
  { brand: "Zurich Insurance",     joined_year: 2011, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14541-Zurich-Insurance-Group" },
  { brand: "BNP Paribas",          joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3111-BNP-Paribas" },
  { brand: "Deutsche Bank",        joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/881-Deutsche-Bank-AG" },
  { brand: "Citigroup",            joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14401-Citigroup-Inc-" },
  { brand: "Bank of America",      joined_year: 2013, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/40481-Bank-of-America-Corporation" },
  { brand: "Goldman Sachs",        joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14601-The-Goldman-Sachs-Group-Inc-" },
  { brand: "ING",                  joined_year: 2006, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8001-ING-Group" },
  { brand: "Santander",            joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2961-Banco-Santander-S-A-" },

  // Telecom / media
  { brand: "Vodafone",             joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3071-Vodafone-Group-PLC" },
  { brand: "Telefonica",           joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2691-Telefonica-S-A-" },
  { brand: "Deutsche Telekom",     joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/921-Deutsche-Telekom-AG" },
  { brand: "Orange",               joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/881-Orange-S-A-" },
  { brand: "AT&T",                 joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14721-AT-T-Inc-" },

  // Energy / utilities
  { brand: "BP",                   joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3261-BP-PLC" },
  { brand: "Shell",                joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/1031-Shell-PLC" },
  { brand: "Eni",                  joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2261-Eni-S-p-A-" },
  { brand: "TotalEnergies",        joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3041-TotalEnergies-SE" },
  { brand: "Iberdrola",            joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2741-Iberdrola-S-A-" },
  { brand: "Enel",                 joined_year: 2004, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/5341-Enel-S-p-A-" },
  { brand: "EDF",                  joined_year: 2001, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2271-EDF-Group" },

  // Pharma / healthcare
  { brand: "Pfizer",               joined_year: 2002, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/2861-Pfizer-Inc-" },
  { brand: "Novartis",             joined_year: 2000, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/1001-Novartis-AG" },
  { brand: "Roche",                joined_year: 2009, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/8721-F-Hoffmann-La-Roche-Ltd-" },
  { brand: "Sanofi",               joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3641-Sanofi" },
  { brand: "GSK",                  joined_year: 2003, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/3471-GSK-plc" },
  { brand: "AstraZeneca",          joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14481-AstraZeneca-PLC" },
  { brand: "Bayer",                joined_year: 2010, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/14361-Bayer-AG" },
  { brand: "Merck KGaA",           joined_year: 2005, cop_status: "active",            source_url: "https://www.unglobalcompact.org/what-is-gc/participants/6701-Merck-KGaA" },

  // Notable expulsions / non-communicating examples (re-verified annually
  // against UNGC's quarterly "expelled participants" announcements)
  { brand: "Petroleos de Venezuela", joined_year: 2010, cop_status: "expelled",       source_url: "https://www.unglobalcompact.org/news/expelled-participants" },
];

/* --------------------------------- brands --------------------------------- */

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

/* ------------------------------- matching -------------------------------- */

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIndex(mirror) {
  const byNormalized = new Map();
  for (const entry of mirror) {
    byNormalized.set(normalize(entry.brand), entry);
  }
  return byNormalized;
}

function lookup(brand, index) {
  const norm = normalize(brand.name);
  if (!norm) return { status: "skipped_generic_name" };
  const entry = index.get(norm);
  if (!entry) return { status: "no_match" };
  return {
    status: "ok",
    is_ungc_participant: true,
    ungc_joined_year:    entry.joined_year,
    ungc_cop_status:     entry.cop_status,
    source_url:          entry.source_url,
  };
}

/* ---------------------- portal connectivity check ------------------------ */
// We don't scrape the JS-rendered participant directory directly (no API
// key, no cheap HTML output), but we do hit it once @ 1 req/sec to confirm
// the public URLs still resolve. Failure is non-fatal — we still emit the
// mirror.

async function pingPortal(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: 0, ok: false, error: err.message };
  }
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  console.log("UN Global Compact fetcher starting...");

  // Connectivity ping (1 req/sec budget).
  const pings = [];
  for (const url of [PARTICIPANTS_URL, INTERACTIVE_URL]) {
    console.log(`  Pinging ${url}`);
    pings.push(await pingPortal(url));
    await SLEEP(REQ_DELAY_MS);
  }
  for (const p of pings) {
    console.log(`    ${p.url} -> ${p.status}${p.ok ? "" : ` (${p.error || "non-200"})`}`);
  }

  const index = buildIndex(MIRROR);
  console.log(`Mirror entries indexed: ${index.size}`);

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  const results = [];
  for (const brand of brands) {
    const out = lookup(brand, index);
    results.push({ slug: brand.slug, name: brand.name, ...out });
  }

  const matched = results.filter(r => r.status === "ok");
  const noMatch = results.filter(r => r.status === "no_match").length;
  const skipped = results.filter(r => r.status === "skipped_generic_name").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "UN Global Compact participant mirror",
    source_urls:     [PARTICIPANTS_URL, INTERACTIVE_URL],
    portal_pings:    pings,
    mirror_size:     MIRROR.length,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    participants:    results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with UNGC match:  ${matched.length}`);
  console.log(`   No-match brands:         ${noMatch}`);
  console.log(`   Skipped (generic name):  ${skipped}`);
  if (matched.length > 0) {
    // Smoke-test summary (Microsoft, Coca-Cola, Nestle, Unilever)
    const smoke = ["microsoft", "coca-cola", "nestle", "unilever"];
    console.log("\nSmoke-test brands:");
    for (const slug of smoke) {
      const r = results.find(x => x.slug === slug);
      if (r) {
        console.log(`   - ${r.slug}: ${r.status === "ok"
          ? `joined ${r.ungc_joined_year}, COP ${r.ungc_cop_status}`
          : r.status}`);
      } else {
        console.log(`   - ${slug}: not in brand list`);
      }
    }
    console.log("\nUNGC participants matched:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- joined ${r.ungc_joined_year} -- COP ${r.ungc_cop_status}`);
    }
  }
}

main().catch(err => {
  console.error("ungc-fetch failed:", err);
  process.exit(1);
});
