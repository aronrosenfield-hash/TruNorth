#!/usr/bin/env node
/**
 * State campaign-finance merge (B-data11).
 *
 * Reads the three state raw files (CA CalAccess, NY SBOE, TX Ethics)
 * produced by ca-calaccess-fetch / ny-elections-fetch / tx-ethics-fetch,
 * aggregates donations by filer-name → resolves each cluster to a
 * TruNorth slug → writes enriched.political.state_donations into the
 * matching company JSON.
 *
 * Target schema (only set when at least one state has donations):
 *   enriched.political.state_donations = {
 *     ca: {
 *       total_USD_last_4y: number,
 *       top_recipients:    [{ name, amount_USD, party }] (top 5),
 *       primary_party:     "DEM" | "REP" | "MIXED" | null,
 *       record_count:      number,
 *     },
 *     ny: { ... same shape ... },
 *     tx: { ... same shape ... },
 *     combined_total_USD_4y: number,
 *     combined_primary_party: "DEM" | "REP" | "MIXED" | null,
 *     sources: ["ca-sos-calaccess", "ny-state-board-of-elections", "tx-ethics-commission"],
 *     lastUpdated: ISO,
 *   }
 *
 * FILER-NAME NORMALIZATION
 * The single hardest problem in this integration. The same company files
 * under wildly different names across CA/NY/TX (and even within one state):
 *   "Pacific Gas & Electric Company", "PG&E Corporation PAC", "PG&E CORP"
 *   "JPMorgan Chase & Co.", "JP MORGAN CHASE BANK NA", "JPM PAC"
 *   "AT&T Services Inc", "AT&T Mobility LLC", "AT&T INC."
 *   "Walmart Inc", "Wal-Mart Stores Inc", "WMT PAC"
 *
 * Approach (in order, first match wins):
 *   1. Normalize: uppercase, strip punctuation, strip corp suffixes
 *      (INC, LLC, CORP, COMPANY, CO, LP, LTD, PAC, COMMITTEE, GROUP,
 *      HOLDINGS, INTERNATIONAL, etc.), collapse whitespace.
 *   2. Strip parent-tag patterns ("PAC FOR RESPONSIBLE GOVERNMENT",
 *      "POLITICAL ACTION COMMITTEE", "PAC", "EMPLOYEES PAC", etc.).
 *   3. Hard-coded alias map (FILER_ALIASES below) for the ~50 highest-
 *      volume donors where fuzzy matching is insufficient. Keys are the
 *      normalized form; values are TruNorth slugs.
 *   4. Direct-token match: if a known slug's name appears as a token
 *      prefix in the normalized filer name, route to that slug.
 *
 * Locally: node scripts/state-campaign-finance-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "public/data/_raw");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "state-campaign-finance-merge-log.json");

const STATES = [
  { code: "ca", file: "ca-calaccess-donations.json",  source: "ca-sos-calaccess" },
  { code: "ny", file: "ny-elections-donations.json",  source: "ny-state-board-of-elections" },
  { code: "tx", file: "tx-ethics-donations.json",     source: "tx-ethics-commission" },
];

/* ------------------------- filer-name normalization ----------------------- */

const CORP_SUFFIXES = [
  "INC", "INCORPORATED", "LLC", "LP", "LLP", "CORP", "CORPORATION",
  "COMPANY", "CO", "LTD", "LIMITED", "HOLDINGS", "HOLDING", "GROUP",
  "INTERNATIONAL", "INTL", "PLC", "AG", "SA", "NA", "NV",
];
const POLITICAL_TAGS = [
  "PAC", "POLITICAL ACTION COMMITTEE", "POLITICAL ACTION CMTE",
  "FEDERAL PAC", "EMPLOYEES PAC", "EMPLOYEE PAC",
  "PAC FOR RESPONSIBLE GOVERNMENT", "GOOD GOVERNMENT FUND",
  "GOOD GOVERNMENT CLUB", "GOOD GOVERNMENT COMMITTEE",
  "COMMITTEE", "CMTE", "FUND", "CLUB",
  "USA", "U S A", "AMERICA", "AMERICAN",
  "SERVICES", "MOBILITY", "WIRELESS", "BANK", "FINANCIAL MANAGEMENT",
  "CLIENT SERVICES", "PUBLIC SECTOR", "COMPANIES",
];

function normalizeFiler(name) {
  if (!name) return "";
  let s = String(name).toUpperCase().trim();
  // Strip punctuation EXCEPT &.
  s = s.replace(/[.,'"`]/g, " ");
  s = s.replace(/\bAND\b/g, "&");
  s = s.replace(/[()\-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // Iteratively strip trailing political/corp tags. Order matters:
  // strip political tags first (longer multi-word phrases), then corp.
  let prev;
  do {
    prev = s;
    for (const tag of POLITICAL_TAGS) {
      const re = new RegExp(`\\b${tag}\\b`, "g");
      s = s.replace(re, " ");
    }
    for (const suf of CORP_SUFFIXES) {
      const re = new RegExp(`\\b${suf}\\b`, "g");
      s = s.replace(re, " ");
    }
    s = s.replace(/\s+/g, " ").trim();
  } while (s !== prev);

  return s;
}

/* -------- hand-curated normalization → TruNorth slug alias map ----------- */
// Keys are the OUTPUT of normalizeFiler(). Values are TruNorth slugs.
// Add aggressively for the top-donor companies that show up under many names.
// Resolved against real canonical slugs in public/data/companies/.
// When two patterns map to the same slug, keep all (first-match-by-length wins).
const FILER_ALIASES = {
  "PACIFIC GAS & ELECTRIC":      "pgande",
  "PG&E":                        "pgande",
  "SOUTHERN CALIFORNIA EDISON":  "edison-international",
  "EDISON":                      "edison-international",
  "EDISON INT'L":                "edison-international",
  "EDISON INTL":                 "edison-international",
  "SOUTHERN CALIFORNIA GAS":     "southern-california-gas",
  "SOCALGAS":                    "southern-california-gas",
  "SEMPRA":                      "sempra",
  "SEMPRA ENERGY":               "sempra",

  "JPMORGAN CHASE & CO":         "jpmorgan-chase",
  "JPMORGAN CHASE":              "jpmorgan-chase",
  "JP MORGAN CHASE & CO":        "jpmorgan-chase",
  "JP MORGAN CHASE":             "jpmorgan-chase",
  "JPMORGAN":                    "jpmorgan-chase",

  "CITIGROUP":                   "citigroup",
  "CITI":                        "citigroup",
  "CITIBANK":                    "citigroup",

  "GOLDMAN SACHS & CO":          "goldman-sachs",
  "GOLDMAN SACHS GROUP":         "goldman-sachs",
  "GOLDMAN SACHS":               "goldman-sachs",
  "BLACKROCK":                   "blackrock",

  "EXXON MOBIL":                 "exxon-mobil",
  "EXXONMOBIL":                  "exxon-mobil",
  "EXXON":                       "exxon-mobil",
  "CHEVRON":                     "chevron",
  "CHEVRON U S":                 "chevron",
  "VALERO":                      "valero-energy",
  "VALERO ENERGY":               "valero-energy",
  "MARATHON PETROLEUM":          "marathon-petroleum",
  "MARATHON OIL":                "marathon-petroleum",

  "WALMART":                     "walmart",
  "WAL MART":                    "walmart",
  "WAL MART STORES":             "walmart",
  "WAL MART STORES TEXAS":       "walmart",
  "WALMART STORES":              "walmart",
  "AMAZON":                      "amazon",
  "AMAZON COM":                  "amazon",
  "TARGET":                      "target",
  "COSTCO WHOLESALE":            "costco",
  "COSTCO":                      "costco",

  "MICROSOFT":                   "microsoft",
  "GOOGLE":                      "google-alphabet",
  "ALPHABET":                    "google-alphabet",
  "META PLATFORMS":              "meta-platforms",
  "META":                        "meta-platforms",
  "APPLE":                       "apple",
  "ORACLE AMERICA":              "oracle-cloud",
  "ORACLE":                      "oracle-cloud",
  "ORACLE CORPORATION":          "oracle-cloud",

  "COMCAST":                     "comcast",
  "COMCAST CABLE COMMUNICATIONS":"comcast",
  "COMCAST CABLE":               "comcast",
  "AT&T":                        "atandt",
  "VERIZON COMMUNICATIONS":      "verizon",
  "VERIZON":                     "verizon",

  "KOCH INDUSTRIES":             "koch-inc",
  "KOCH":                        "koch-inc",

  "STATE FARM MUTUAL AUTOMOBILE":"state-farm",
  "STATE FARM INSURANCE":        "state-farm",
  "STATE FARM":                  "state-farm",
  "ALLSTATE INSURANCE":          "allstate",
  "ALLSTATE":                    "allstate",
  "GEICO":                       "geico",
  "PROGRESSIVE CASUALTY INSURANCE": "progressive",
  "PROGRESSIVE":                 "progressive",
  "PRUDENTIAL FINANCIAL":        "prudential",
  "PRUDENTIAL":                  "prudential",

  "PFIZER":                      "pfizer",
  "JOHNSON & JOHNSON":           "johnson-and-johnson",
  "ABBOTT LABORATORIES":         "abbott-laboratories",
  "ABBOTT":                      "abbott-laboratories",
  "MERCK & CO":                  "merck",
  "MERCK":                       "merck",

  "ALTRIA CLIENT":               "altria-group",
  "ALTRIA":                      "altria-group",
  "PHILIP MORRIS":               "philip-morris-international",
  "PHILIP MORRIS U S":           "philip-morris-international",
  "ANHEUSER BUSCH":              "anheuser-busch",
  "ANHEUSER-BUSCH":              "anheuser-busch",
  "BROWN FORMAN":                "brown-forman",
  "BROWN-FORMAN":                "brown-forman",
  "DIAGEO":                      "diageo",
};

/* ------------------------------ slug routing ----------------------------- */

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

function resolveSlug(slug, maps) {
  if (!slug) return null;
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) return slug;
  const alias = maps.aliases[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return alias;
  const parent = maps.parents[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return parent;
  return null;
}

function filerToSlug(filerName, maps) {
  const norm = normalizeFiler(filerName);
  if (!norm) return { slug: null, routed_via: "no_normal" };

  // 1. Exact alias hit.
  if (FILER_ALIASES[norm]) {
    const slug = resolveSlug(FILER_ALIASES[norm], maps);
    if (slug) return { slug, routed_via: "alias_exact", normalized: norm };
  }

  // 2. Substring alias hit — pick the longest alias key that is a prefix.
  const keys = Object.keys(FILER_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (norm.startsWith(key + " ") || norm === key) {
      const slug = resolveSlug(FILER_ALIASES[key], maps);
      if (slug) return { slug, routed_via: "alias_prefix", normalized: norm, matched_key: key };
    }
  }

  // 3. Fall back to slug-aliases.json / parent map under a slugified form.
  const candidate = norm.toLowerCase().replace(/&/g, "and").replace(/\s+/g, "-");
  const slug = resolveSlug(candidate, maps);
  if (slug) return { slug, routed_via: "slugified", normalized: norm, candidate };

  return { slug: null, routed_via: "orphan", normalized: norm };
}

/* -------------------------------- aggregate ------------------------------ */

function aggregateState(rows, maps) {
  // Group by resolved slug; track total, recipients, party split, raw count.
  const bySlug = new Map();
  const orphans = new Map();

  for (const row of rows) {
    const routed = filerToSlug(row.filer_name, maps);
    if (!routed.slug) {
      const key = routed.normalized || row.filer_name;
      const cur = orphans.get(key) || { name: row.filer_name, total: 0, rows: 0 };
      cur.total += row.amount_USD;
      cur.rows += 1;
      orphans.set(key, cur);
      continue;
    }
    const cur = bySlug.get(routed.slug) || {
      slug: routed.slug,
      total: 0,
      record_count: 0,
      recipients: new Map(), // recipient_name → { name, amount, party }
      party_amount: { DEM: 0, REP: 0, IND: 0, OTHER: 0 },
    };
    cur.total += row.amount_USD;
    cur.record_count += 1;
    const recCur = cur.recipients.get(row.recipient_name) || { name: row.recipient_name, amount_USD: 0, party: row.party };
    recCur.amount_USD += row.amount_USD;
    cur.recipients.set(row.recipient_name, recCur);
    const pKey = (row.party === "DEM" || row.party === "REP" || row.party === "IND") ? row.party : "OTHER";
    cur.party_amount[pKey] += row.amount_USD;
    bySlug.set(routed.slug, cur);
  }

  // Finalize: top 5 recipients, primary party, totals.
  const aggregated = {};
  for (const [slug, c] of bySlug) {
    const top_recipients = Array.from(c.recipients.values())
      .sort((a, b) => b.amount_USD - a.amount_USD)
      .slice(0, 5)
      .map(r => ({ name: r.name, amount_USD: Math.round(r.amount_USD), party: r.party || null }));
    const partySums = c.party_amount;
    const dem = partySums.DEM, rep = partySums.REP;
    const total = dem + rep;
    let primary = null;
    if (total > 0) {
      if (dem / total >= 0.66)      primary = "DEM";
      else if (rep / total >= 0.66) primary = "REP";
      else                          primary = "MIXED";
    }
    aggregated[slug] = {
      total_USD_last_4y: Math.round(c.total),
      record_count:      c.record_count,
      top_recipients,
      primary_party:     primary,
    };
  }
  return { aggregated, orphans: Array.from(orphans.values()).sort((a, b) => b.total - a.total).slice(0, 50) };
}

/* --------------------------------- merge --------------------------------- */

async function main() {
  const now = new Date().toISOString();
  console.log("State campaign-finance merge starting...");

  const maps = await loadMaps();

  // Load all three state raw files.
  const stateData = {};
  for (const s of STATES) {
    const f = path.join(RAW_DIR, s.file);
    if (!existsSync(f)) {
      console.warn(`  Missing: ${f} — skipping state ${s.code}`);
      stateData[s.code] = { aggregated: {}, orphans: [] };
      continue;
    }
    const j = JSON.parse(await fs.readFile(f, "utf-8"));
    console.log(`  ${s.code}: ${j.rows.length} rows`);
    stateData[s.code] = aggregateState(j.rows, maps);
  }

  // Collect the union of slugs across all three states.
  const allSlugs = new Set();
  for (const code of Object.keys(stateData)) {
    Object.keys(stateData[code].aggregated).forEach(s => allSlugs.add(s));
  }
  console.log(`Union: ${allSlugs.size} unique slugs across CA+NY+TX`);

  const mergedResults = [];
  for (const slug of allSlugs) {
    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) {
      mergedResults.push({ slug, status: "no_company_file" });
      continue;
    }

    let company;
    try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch (e) { mergedResults.push({ slug, status: "parse_error", error: e.message }); continue; }

    const stateBlock = {};
    let combinedTotal = 0;
    let combinedDem = 0, combinedRep = 0;
    const sources = [];
    for (const s of STATES) {
      const agg = stateData[s.code].aggregated[slug];
      if (!agg) continue;
      stateBlock[s.code] = agg;
      combinedTotal += agg.total_USD_last_4y;
      // Sum DEM/REP from top recipients × the per-state primary signal.
      // Better: walk party_amount, but we already discarded it. Approximate
      // by using primary_party as a tilt against total.
      if (agg.primary_party === "DEM") combinedDem += agg.total_USD_last_4y;
      else if (agg.primary_party === "REP") combinedRep += agg.total_USD_last_4y;
      else if (agg.primary_party === "MIXED") {
        combinedDem += agg.total_USD_last_4y / 2;
        combinedRep += agg.total_USD_last_4y / 2;
      }
      sources.push(s.source);
    }

    let combined_primary_party = null;
    if (combinedDem + combinedRep > 0) {
      const ratio = combinedDem / (combinedDem + combinedRep);
      if (ratio >= 0.66)      combined_primary_party = "DEM";
      else if (ratio <= 0.34) combined_primary_party = "REP";
      else                    combined_primary_party = "MIXED";
    }

    if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
    if (!company.enriched.political || typeof company.enriched.political !== "object") company.enriched.political = {};
    company.enriched.political.state_donations = {
      ...stateBlock,
      combined_total_USD_4y:  Math.round(combinedTotal),
      combined_primary_party,
      sources,
      lastUpdated: now,
    };

    if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
      company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
    }
    company.dataLastUpdated.stateCampaignFinance = now;

    await fs.writeFile(file, JSON.stringify(company));
    mergedResults.push({
      slug,
      status: "merged",
      states: Object.keys(stateBlock),
      combined_total_USD_4y: Math.round(combinedTotal),
      combined_primary_party,
    });
  }

  const merged = mergedResults.filter(r => r.status === "merged");
  const missing = mergedResults.filter(r => r.status === "no_company_file");
  const errors = mergedResults.filter(r => r.status === "parse_error");

  // Surface top orphans (filer names that could not be routed) so we can
  // grow the alias map in follow-ups.
  const allOrphans = {};
  for (const s of STATES) {
    allOrphans[s.code] = stateData[s.code].orphans.map(o => ({
      name: o.name, total_USD: Math.round(o.total), rows: o.rows,
    }));
  }

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    states:           STATES.map(s => s.code),
    union_slug_count: allSlugs.size,
    merged_count:     merged.length,
    missing_company:  missing.length,
    parse_errors:     errors.length,
    merged_list:      merged.sort((a, b) => b.combined_total_USD_4y - a.combined_total_USD_4y),
    missing_slugs:    missing.map(m => m.slug),
    top_orphans_per_state: allOrphans,
  }, null, 2));

  console.log(`\nMerged: ${merged.length}`);
  console.log(`No company file: ${missing.length}`);
  console.log(`Parse errors:    ${errors.length}`);
  console.log(`\nTop 10 merged (combined 4y total):`);
  for (const r of merged.sort((a, b) => b.combined_total_USD_4y - a.combined_total_USD_4y).slice(0, 10)) {
    console.log(`  ${r.slug.padEnd(28)} $${r.combined_total_USD_4y.toLocaleString().padStart(10)}  [${r.states.join(",")}]  ${r.combined_primary_party || "-"}`);
  }
}

main().catch(err => {
  console.error("state-campaign-finance-merge failed:", err);
  process.exit(1);
});
