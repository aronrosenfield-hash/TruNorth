#!/usr/bin/env node
/**
 * UK Companies House — quarterly fetcher (B-data9).
 *
 * Companies House is the UK's official register of every UK-registered
 * limited company. The public API (https://api.company-information.service.gov.uk)
 * is free and well-documented; richer endpoints (profile + officers +
 * filing history) require a free API key passed as HTTP basic auth
 * (username = API key, password blank).
 *
 *   API root:   https://api.company-information.service.gov.uk
 *   Docs:       https://developer.company-information.service.gov.uk
 *   Get a key:  https://developer.company-information.service.gov.uk/manage-applications
 *
 * For each UK-registered TruNorth brand we resolve a company number from a
 * curated mapping (re-verified quarterly against the public registry) and
 * pull:
 *
 *   - profile         (incorporated date, status, type, SIC codes, office)
 *   - officers        (directors / secretaries — name, role, appointed_on)
 *   - filing history  (latest filing date + description)
 *
 * Output: /public/data/uk-companies-house.json
 *
 * Rate limit: CH public API allows 600 req / 5 min per key. We pace at
 * ~1 req/sec well under the cap. Quarterly cadence (1st of Mar/Jun/Sep/Dec)
 * is plenty for ownership data, which is slow-moving.
 *
 * Modes:
 *   --dry      (default) — no network. Synthesises a structured DRY-RUN
 *                          output across a curated top-30 UK brand list so
 *                          the merger + downstream UI can be reviewed in
 *                          worktree without a live API key.
 *   --live              — hits the Companies House API for the brand list.
 *                          Requires COMPANIES_HOUSE_API_KEY env var.
 *
 * Locally: node scripts/uk-companies-house-fetch.mjs           # DRY-RUN
 *          node scripts/uk-companies-house-fetch.mjs --live    # live
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/uk-companies-house.json");

const API_BASE = "https://api.company-information.service.gov.uk";
const UA = "TruNorth-CompaniesHouse/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1100;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const argv = new Set(process.argv.slice(2));
const LIVE = argv.has("--live");
const DRY_RUN = !LIVE; // --dry is the default

/* -------------------------------- targets -------------------------------- */
// Curated UK brand → Companies House number mapping. Numbers verified against
// https://find-and-update.company-information.service.gov.uk/. Where a brand
// resolves through a parent group, the parent's CH number is used.
//
// Re-verify quarterly. CH numbers are immutable once issued; the company
// names + status may change (rebrand, dissolution, acquisition).
export const UK_TARGETS = [
  { slug: "bp-uk",                   name: "BP p.l.c.",                             company_number: "00102498" },
  { slug: "tesco",                   name: "Tesco PLC",                             company_number: "00445790" },
  { slug: "boots-uk",                name: "Boots UK Limited",                      company_number: "00928555" },
  { slug: "marks-and-spencer",       name: "Marks and Spencer Group plc",           company_number: "04256886" },
  { slug: "sainsburys",              name: "J Sainsbury plc",                       company_number: "00185647" },
  { slug: "lloyds-banking-group",    name: "Lloyds Banking Group plc",              company_number: "SC095000" },
  { slug: "barclays",                name: "Barclays PLC",                          company_number: "00048839" },
  { slug: "hsbc",                    name: "HSBC Holdings plc",                     company_number: "00617987" },
  { slug: "standard-chartered",      name: "Standard Chartered PLC",                company_number: "00966425" },
  { slug: "prudential-uk",           name: "Prudential plc",                        company_number: "01397169" },
  { slug: "vodafone-uk",             name: "Vodafone Group Public Limited Company", company_number: "01833679" },
  { slug: "bt-group",                name: "BT Group plc",                          company_number: "04190816" },
  { slug: "sky-uk",                  name: "Sky Group Limited",                     company_number: "02247735" },
  { slug: "itv",                     name: "ITV plc",                               company_number: "04967001" },
  { slug: "bbc",                     name: "British Broadcasting Corporation",      company_number: "RC000776" },
  { slug: "britvic",                 name: "Britvic plc",                           company_number: "05604923" },
  { slug: "diageo",                  name: "Diageo plc",                            company_number: "00023307" },
  { slug: "glaxosmithkline",         name: "GSK plc",                               company_number: "03888792" },
  { slug: "astrazeneca",             name: "AstraZeneca PLC",                       company_number: "02723534" },
  { slug: "reckitt-benckiser",       name: "Reckitt Benckiser Group plc",           company_number: "06270876" },
  { slug: "unilever-uk",             name: "Unilever PLC",                          company_number: "00041424" },
  { slug: "kingfisher-uk",           name: "Kingfisher plc",                        company_number: "01664812" },
  { slug: "asda",                    name: "Asda Group Limited",                    company_number: "00464777" },
  { slug: "morrisons",               name: "Wm Morrison Supermarkets Limited",      company_number: "00358949" },
  { slug: "royal-mail",              name: "Royal Mail plc",                        company_number: "08680755" },
  { slug: "smiths-group",            name: "Smiths Group plc",                      company_number: "00137013" },
  { slug: "rolls-royce",             name: "Rolls-Royce Holdings plc",              company_number: "07524813" },
  { slug: "jaguar-land-rover",       name: "Jaguar Land Rover Limited",             company_number: "01672070" },
  { slug: "jet2",                    name: "Jet2 plc",                              company_number: "01295221" },
  { slug: "easyjet",                 name: "easyJet plc",                           company_number: "03155593" },
];

/* ------------------------------- live calls ------------------------------ */
function authHeader(apiKey) {
  // CH uses HTTP basic: username = API key, password empty.
  return "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
}

async function fetchJson(url, apiKey) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Authorization": authHeader(apiKey),
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\n${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchTargetLive(target, apiKey) {
  const cn = target.company_number;
  const profile        = await fetchJson(`${API_BASE}/company/${cn}`, apiKey);
  await SLEEP(REQ_DELAY_MS);
  const officersBundle = await fetchJson(`${API_BASE}/company/${cn}/officers?items_per_page=35`, apiKey);
  await SLEEP(REQ_DELAY_MS);
  const filingBundle   = await fetchJson(`${API_BASE}/company/${cn}/filing-history?items_per_page=1`, apiKey);
  return shape(target, profile, officersBundle, filingBundle);
}

/* --------------------------- response shaping --------------------------- */
export function shape(target, profile, officersBundle, filingBundle) {
  const officers = (officersBundle?.items || [])
    .filter(o => !o.resigned_on)
    .slice(0, 12)
    .map(o => ({
      name:      o.name,
      role:      o.officer_role,
      appointed: o.appointed_on || null,
    }));
  const latestFiling = (filingBundle?.items || [])[0] || null;
  const addr = profile?.registered_office_address || {};
  const addrLine = [
    addr.address_line_1, addr.address_line_2, addr.locality, addr.region,
    addr.postal_code, addr.country,
  ].filter(Boolean).join(", ");

  return {
    slug:                       target.slug,
    name:                       target.name,
    status:                     "ok",
    company_number:             profile?.company_number || target.company_number,
    incorporated:               profile?.date_of_creation || null,
    company_status:             profile?.company_status || null,
    company_type:               profile?.type || null,
    sic_codes:                  profile?.sic_codes || [],
    officers,
    latest_filing_date:         latestFiling?.date || null,
    latest_filing_description:  latestFiling?.description || null,
    registered_office_address:  addrLine,
    source_url:                 `https://find-and-update.company-information.service.gov.uk/company/${target.company_number}`,
  };
}

/* ------------------------------ dry synth ------------------------------- */
// Deterministic dry-run output — mirrors the shape that `live` will emit.
// Reviewers can vet the merger + downstream UI without an API key.
function synthDryRun(target) {
  const numericPart = parseInt(target.company_number.replace(/\D/g, ""), 10) || 0;
  const seedYear = 1900 + (numericPart % 120);
  const officers = [
    { name: "DOE, John Example",             role: "director",  appointed: `${seedYear + 80}-04-12` },
    { name: "SMITH, Jane Example",           role: "director",  appointed: `${seedYear + 85}-09-30` },
    { name: "EXAMPLE NOMINEES (UK) LIMITED", role: "secretary", appointed: `${seedYear + 60}-01-15` },
  ];
  return {
    slug:                       target.slug,
    name:                       target.name,
    status:                     "ok_dry",
    company_number:             target.company_number,
    incorporated:               `${seedYear}-01-01`,
    company_status:             "active",
    company_type:               "plc",
    sic_codes:                  ["DRY-RUN: see live fetch"],
    officers,
    latest_filing_date:         new Date().toISOString().slice(0, 10),
    latest_filing_description:  "DRY-RUN: confirmation statement",
    registered_office_address:  "DRY-RUN, London, United Kingdom",
    source_url:                 `https://find-and-update.company-information.service.gov.uk/company/${target.company_number}`,
  };
}

/* --------------------------------- main ---------------------------------- */
async function main() {
  console.log(`UK Companies House fetcher — mode: ${DRY_RUN ? "DRY-RUN (no network)" : "LIVE"}`);
  console.log(`Targets: ${UK_TARGETS.length}`);

  let apiKey = null;
  if (LIVE) {
    apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      console.error("ERROR: COMPANIES_HOUSE_API_KEY env var required for --live mode.");
      console.error("Get a free key at https://developer.company-information.service.gov.uk/manage-applications");
      process.exit(1);
    }
  }

  const results = [];
  for (const t of UK_TARGETS) {
    try {
      if (DRY_RUN) {
        results.push(synthDryRun(t));
      } else {
        process.stdout.write(`  ${t.slug} (${t.company_number}) ... `);
        const shaped = await fetchTargetLive(t, apiKey);
        console.log("ok");
        results.push(shaped);
        await SLEEP(REQ_DELAY_MS);
      }
    } catch (err) {
      console.error(`  ${t.slug}: ${err.message}`);
      results.push({
        slug:           t.slug,
        name:           t.name,
        company_number: t.company_number,
        status:         "error",
        error:          err.message,
      });
    }
  }

  const ok     = results.filter(r => r.status === "ok" || r.status === "ok_dry").length;
  const errors = results.filter(r => r.status === "error").length;

  // Smoke set surfaces a small, stable subset for readable CI logs.
  const smokeSlugs = ["tesco", "barclays", "astrazeneca", "bbc"];
  const smoke = smokeSlugs.map(s => {
    const r = results.find(x => x.slug === s);
    if (!r) return { slug: s, status: "not_in_target_list" };
    return {
      slug:           s,
      status:         r.status,
      company_number: r.company_number || null,
      incorporated:   r.incorporated || null,
      officer_count:  r.officers?.length ?? 0,
    };
  });

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    mode:         DRY_RUN ? "dry-run-synth" : "live",
    source:       "UK Companies House (api.company-information.service.gov.uk)",
    source_url:   "https://developer.company-information.service.gov.uk/",
    target_count: UK_TARGETS.length,
    ok_count:     ok,
    error_count:  errors,
    smoke,
    note:         DRY_RUN ? "DRY-RUN SYNTH — review only, do not treat as authoritative" : null,
    companies:    results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   OK:     ${ok}/${UK_TARGETS.length}`);
  console.log(`   Errors: ${errors}`);
  console.log(`\nSmoke (tesco, barclays, astrazeneca, bbc):`);
  for (const s of smoke) {
    const detail = s.company_number
      ? ` -- CN ${s.company_number}, inc ${s.incorporated}, officers ${s.officer_count}`
      : "";
    console.log(`   - ${s.slug}: ${s.status}${detail}`);
  }
}

// Only run when invoked as a script.
const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) {
  main().catch(err => {
    console.error("uk-companies-house-fetch failed:", err);
    process.exit(1);
  });
}
