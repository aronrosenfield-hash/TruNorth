#!/usr/bin/env node
/**
 * Privacy Enforcement — US state-government public records → TruNorth augment.
 *
 * Targets TruNorth's WEAKEST scoring category (privacy, ~35% coverage) by
 * folding together three clean-license state-government datasets into ONE
 * derived augment keyed by company slug:
 *
 *   data/derived/privacy-enforcement-augment.json
 *
 * TWO SIGNALS:
 *
 *  (1) DATA BREACHES — consumer-notification filings.
 *      • CA Attorney General breach list (bulk CSV, ~5,100 rows):
 *          https://oag.ca.gov/privacy/databreach/list-export
 *          cols: "Organization Name", "Date(s) of Breach ...", "Reported Date"
 *      • WA Attorney General breach (Socrata JSON, ~1,596 rows):
 *          https://data.wa.gov/resource/sb4j-ca4h.json
 *          fields: name, databreachcause, cyberattacktype,
 *                  washingtoniansaffected, industrytype
 *      Aggregated per company:
 *          breaches: { count, mostRecent (ISO date), maxAffected, causes:[...] }
 *      "causes" = the top cyberattack types observed (e.g. Ransomware,
 *      Phishing) plus generic causes when no attack type is recorded.
 *
 *  (2) DATA BROKER — CA CPPA registry (CSV, 77 cols, ~800 rows):
 *          https://cppa.ca.gov/data_broker_registry/registry.csv
 *      A company (or its parent) appearing here self-reported as a registered
 *      data broker. We surface what it collects / who it sells to:
 *          dataBroker: { registered:true, collectsBiometric,
 *                        collectsGeolocation, collectsMinors,
 *                        soldToLawEnforcement, soldToGenAI }
 *
 * AUGMENT SHAPE per slug (only sub-objects that have data are included):
 *   {
 *     breaches:   { count, mostRecent, maxAffected, causes:[...] },
 *     dataBroker: { registered, collectsBiometric, collectsGeolocation,
 *                   collectsMinors, soldToLawEnforcement, soldToGenAI },
 *     lastUpdated: "<ISO>"
 *   }
 *
 * MATCHING — built on the ITEP normalizer + buildIndexLookup against
 * public/data/index.json, with a parent-map fallback against
 * public/data/_meta/brand-parent-map.json. NOTE: unlike the ITEP merge (which
 * runs against ~342 curated Fortune-500 names), this source ingests ~5,000 RAW
 * breach-filing org strings, so we deliberately use STRICTER variants than
 * ITEP's nameVariants: we match on the FULL normalized name (and a geo-stripped
 * full name) only — never bare first-word/2-word prefixes. That avoids
 * "American Lending Center" → `american` or "Blue Cross of California" → the
 * `blue` (=General Mills cheese) parent-map key. See strictNameKeys().
 * Breaches match many national brands (American Express, General Motors,
 * Marriott, ...); the broker registry is adtech-skewed so its match rate is
 * lower and parent-rollup heavy (e.g. doubleclick → google).
 *
 * SAFETY:
 *   • This script ONLY writes data/derived/privacy-enforcement-augment.json.
 *     It NEVER writes public/data/companies/*.json and touches no other
 *     source's files.
 *   • Empty/short downloads are rejected (HTTP guard + min-row guard) so a
 *     transient 200-with-error-body can't wipe the augment.
 *   • Polite UA with a contact address.
 *
 * Flags:
 *   --apply            write the augment (default is DRY: summary only).
 *   --no-wa            skip the WA breach source (CA + CPPA only).
 *   --limit-broker N   cap broker rows parsed (debugging).
 *   --out PATH         write to PATH instead of the default.
 *
 * Locally:
 *   node scripts/privacy-enforcement-fetch.mjs            # dry run + report
 *   node scripts/privacy-enforcement-fetch.mjs --apply    # write augment
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeCompanyName } from "./itep-tax-fetch.mjs";
import { buildIndexLookup } from "./itep-tax-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "privacy-enforcement-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

// ─────────────────────────── sources ────────────────────────────────
const CA_BREACH_CSV = "https://oag.ca.gov/privacy/databreach/list-export";
const CA_BREACH_LANDING = "https://oag.ca.gov/privacy/databreach/list";
const WA_BREACH_JSON = "https://data.wa.gov/resource/sb4j-ca4h.json";
const WA_BREACH_LANDING =
  "https://www.atg.wa.gov/data-breach-notifications";
const CPPA_BROKER_CSV = "https://cppa.ca.gov/data_broker_registry/registry.csv";
const CPPA_BROKER_LANDING = "https://cppa.ca.gov/data_broker_registry/";

const UA =
  "TruNorth-Privacy/1.0 (+https://www.trunorthapp.com; contact@trunorthapp.com)";
const REQUEST_TIMEOUT_MS = 90_000;

const LICENSE_TAG =
  "US state government public records (CA AG + WA AG data-breach lists; CA CPPA Data Broker Registry).";

// Min-row sanity thresholds — a real download is far larger than these. A
// download that comes back shorter is treated as an error (HTML error page,
// truncated body) and we abort rather than emit a gutted augment.
const MIN_CA_ROWS = 1000;
const MIN_WA_ROWS = 500;
const MIN_BROKER_ROWS = 100;

const MAX_CAUSES = 4; // distinct top cyberattack/cause labels per company

// ─────────────────────────── CLI parsing ────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const SKIP_WA = argv.includes("--no-wa");
function flagArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const OUT_PATH = flagArg("--out");
const LIMIT_BROKER = Number(flagArg("--limit-broker")) || 0;

// ─────────────────────────── network ────────────────────────────────
async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/csv,application/json,*/*;q=0.8",
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, label) {
  console.log(`Fetching ${label}: ${url}`);
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const text = await res.text();
  console.log(`  Downloaded ${text.length.toLocaleString()} bytes`);
  if (!text || text.length < 200) {
    throw new Error(`${label} body too small (${text.length} B) — refusing.`);
  }
  return text;
}

// ─────────────────────────── CSV parser ─────────────────────────────
/**
 * RFC-4180-ish CSV parser returning an array of string[] rows. Handles
 * quoted fields with embedded commas / newlines and "" escapes; strips a
 * leading BOM.
 */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (c === "\r") {
        // handled by \n
      } else field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

// Normalize a header label for fuzzy column lookup. The CPPA header uses
// curly apostrophes and non-breaking hyphens — fold them to plain spaces.
function normHeader(s) {
  return String(s)
    .toLowerCase()
    .replace(/[‐-―‘’“”]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isYes(v) {
  return String(v || "").trim().toLowerCase() === "yes";
}

// ─────────────────────────── date helpers ───────────────────────────
/**
 * Parse a US-style date that may carry multiple comma-separated dates
 * ("04/13/2026, 05/21/2026") and return the LATEST as an ISO yyyy-mm-dd,
 * or null. Also tolerates ISO timestamps (WA's datestart/dateend).
 */
function latestIsoDate(raw) {
  if (!raw) return null;
  let best = null;
  for (const part of String(raw).split(/[,;]/)) {
    const s = part.trim();
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  if (best === null) return null;
  return new Date(best).toISOString().slice(0, 10);
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

// ─────────────────────────── CA breach ──────────────────────────────
/**
 * Parse the CA AG breach CSV → [{ org, breachDate(ISO|null) }].
 * Columns are positional but we resolve by header to be resilient.
 */
export function parseCaBreaches(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) return [];
  const header = rows[0].map((h) => normHeader(h));
  const iOrg = header.findIndex((h) => h.includes("organization name"));
  const iBreach = header.findIndex((h) => h.includes("date") && h.includes("breach"));
  const iReported = header.findIndex((h) => h.includes("reported"));
  const orgCol = iOrg >= 0 ? iOrg : 0;
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !c || !c.trim())) continue;
    const org = (r[orgCol] || "").trim();
    if (!org) continue;
    // Prefer the breach date; fall back to the reported date when blank.
    const breachIso =
      latestIsoDate(iBreach >= 0 ? r[iBreach] : "") ||
      latestIsoDate(iReported >= 0 ? r[iReported] : "");
    out.push({ org, breachIso });
  }
  return out;
}

// ─────────────────────────── WA breach ──────────────────────────────
/**
 * Fetch ALL WA breach rows via Socrata, paging on $limit/$offset so we
 * aren't capped at the default 1,000-row page.
 */
async function fetchWaBreaches() {
  const PAGE = 5000;
  let offset = 0;
  const all = [];
  for (;;) {
    const url =
      `${WA_BREACH_JSON}?$limit=${PAGE}&$offset=${offset}` +
      `&$select=name,databreachcause,cyberattacktype,washingtoniansaffected,industrytype,dateend,datestart,datesubmitted,year`;
    const text = await fetchText(url, `WA breach (offset ${offset})`);
    let page;
    try {
      page = JSON.parse(text);
    } catch {
      throw new Error("WA breach: response was not valid JSON.");
    }
    if (!Array.isArray(page)) throw new Error("WA breach: expected a JSON array.");
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
    if (offset > 100_000) break; // hard safety stop
  }
  return all;
}

/**
 * Map raw WA Socrata records → [{ org, breachIso, affected, cause }].
 * breachIso uses dateend, then datestart, then datesubmitted, then year.
 */
export function shapeWaBreaches(records) {
  const out = [];
  for (const r of records || []) {
    const org = String(r.name || "").trim();
    if (!org) continue;
    const breachIso =
      latestIsoDate(r.dateend) ||
      latestIsoDate(r.datestart) ||
      latestIsoDate(r.datesubmitted) ||
      (r.year ? `${String(r.year).trim()}-01-01` : null);
    const affectedNum = Number(String(r.washingtoniansaffected || "").replace(/[^0-9.]/g, ""));
    const affected = Number.isFinite(affectedNum) && affectedNum > 0 ? affectedNum : null;
    // Prefer the specific attack type (Ransomware/Phishing/...); fall back to
    // the coarse cause (Cyberattack / Theft / Unauthorized Access / ...).
    const cause =
      (String(r.cyberattacktype || "").trim() || String(r.databreachcause || "").trim()) || null;
    out.push({ org, breachIso, affected, cause });
  }
  return out;
}

// ─────────────────────────── CPPA broker ────────────────────────────
/**
 * Parse the CPPA Data Broker Registry CSV → [{ name, collectsBiometric, ... }].
 * Columns resolved by normalized header substring (the live header uses curly
 * apostrophes + non-breaking hyphens, so exact-string matching is brittle).
 */
export function parseBrokers(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) return [];
  const header = rows[0].map((h) => normHeader(h));
  const find = (pred) => header.findIndex(pred);

  const iName = find((h) => h.includes("data broker name") || h === "legal name");
  const iDba = find((h) => h.includes("doing business as") || h.includes("dba"));
  const iBiometric = find((h) => h.includes("biometric"));
  const iGeo = find((h) => h.includes("precise geolocation"));
  const iMinors = find((h) => h.includes("minors"));
  const iLE = find(
    (h) => h.includes("law enforcement") && h.includes("shared or sold"),
  );
  const iGenAI = find(
    (h) =>
      h.includes("shared or sold") &&
      (h.includes("genai") || h.includes("gen ai") || h.includes("developer of a gen")),
  );

  if (iName < 0) throw new Error("CPPA broker: could not locate the name column.");

  const out = [];
  const limit = LIMIT_BROKER > 0 ? Math.min(LIMIT_BROKER + 1, rows.length) : rows.length;
  for (let i = 1; i < limit; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !c || !c.trim())) continue;
    const name = (r[iName] || "").trim();
    if (!name) continue;
    out.push({
      name,
      dba: iDba >= 0 ? (r[iDba] || "").trim() : "",
      collectsBiometric: iBiometric >= 0 ? isYes(r[iBiometric]) : false,
      collectsGeolocation: iGeo >= 0 ? isYes(r[iGeo]) : false,
      collectsMinors: iMinors >= 0 ? isYes(r[iMinors]) : false,
      soldToLawEnforcement: iLE >= 0 ? isYes(r[iLE]) : false,
      soldToGenAI: iGenAI >= 0 ? isYes(r[iGenAI]) : false,
    });
  }
  return out;
}

// ─────────────────────────── matching ───────────────────────────────
/**
 * STRICT name keys for a raw org string. Returns the candidate normalized
 * names we'll accept as a match, LONGEST first:
 *   1. the full normalized name ("general motors company" → "general motors"
 *      after suffix-strip in normalizeCompanyName),
 *   2. the full name with a trailing geo qualifier dropped
 *      ("amazon web services us" → "amazon web services").
 * Crucially we DO NOT emit bare first-word / 2-word prefixes (the loose ITEP
 * behaviour), because against 5,000 raw filings those collapse far too many
 * unrelated orgs onto short single-word brands ("american", "city", "next").
 */
export function strictNameKeys(s) {
  const base = normalizeCompanyName(s);
  const out = new Set();
  if (base) out.add(base);
  const stripped = base
    .replace(/\b(us|usa|north america|global|americas|international)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && stripped !== base) out.add(stripped);
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * Resolve a company name to a TruNorth slug: strict direct index match first,
 * then a strict brand-parent-map fallback (full-name slug candidates only).
 * Returns { slug, route } or null.
 */
function resolveSlug(name, byName, parentMap) {
  const keys = strictNameKeys(name);
  for (const k of keys) {
    const hit = byName.get(k);
    if (hit) return { slug: hit, route: "direct" };
  }
  if (parentMap && typeof parentMap === "object") {
    for (const k of keys) {
      const slugKey = k.replace(/\s+/g, "-");
      const entry = parentMap[slugKey];
      if (entry && entry.parent) return { slug: entry.parent, route: "parent" };
    }
  }
  return null;
}

function topCauses(causeCounts) {
  return Object.entries(causeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CAUSES)
    .map(([label]) => label);
}

// ─────────────────────────── merge ──────────────────────────────────
/**
 * Build the slug-keyed augment from the three parsed datasets.
 * Pure function (no I/O) so it's unit-testable.
 */
export function buildAugment({ caRows, waRows, brokerRows, index, parentMap }) {
  const byName = buildIndexLookup(index);

  // Per-slug breach accumulator.
  const breachAcc = new Map(); // slug -> { count, mostRecent, maxAffected, causeCounts }
  // Per-slug data-broker record (last write wins; OR the boolean flags so a
  // parent that has several registered subsidiaries reflects ANY "yes").
  const brokerAcc = new Map(); // slug -> { registered, collects..., sold... }

  let caMatched = 0;
  let waMatched = 0;
  let brokerMatched = 0;
  const breachSlugs = new Set();
  const brokerSlugs = new Set();
  const orphanBreaches = new Set();
  const orphanBrokers = new Set();

  const addBreach = (slug, { breachIso, affected, cause }) => {
    let acc = breachAcc.get(slug);
    if (!acc) {
      acc = { count: 0, mostRecent: null, maxAffected: 0, causeCounts: {} };
      breachAcc.set(slug, acc);
    }
    acc.count += 1;
    acc.mostRecent = maxIso(acc.mostRecent, breachIso);
    if (affected && affected > acc.maxAffected) acc.maxAffected = affected;
    if (cause) acc.causeCounts[cause] = (acc.causeCounts[cause] || 0) + 1;
  };

  // ── CA breaches ──
  for (const row of caRows) {
    const hit = resolveSlug(row.org, byName, parentMap);
    if (!hit) {
      orphanBreaches.add(row.org);
      continue;
    }
    caMatched++;
    breachSlugs.add(hit.slug);
    addBreach(hit.slug, { breachIso: row.breachIso, affected: null, cause: null });
  }

  // ── WA breaches ──
  for (const row of waRows) {
    const hit = resolveSlug(row.org, byName, parentMap);
    if (!hit) {
      orphanBreaches.add(row.org);
      continue;
    }
    waMatched++;
    breachSlugs.add(hit.slug);
    addBreach(hit.slug, {
      breachIso: row.breachIso,
      affected: row.affected,
      cause: row.cause,
    });
  }

  // ── CPPA brokers ──
  for (const row of brokerRows) {
    const hit = resolveSlug(row.name, byName, parentMap);
    if (!hit) {
      orphanBrokers.add(row.name);
      continue;
    }
    brokerMatched++;
    brokerSlugs.add(hit.slug);
    const prev = brokerAcc.get(hit.slug) || {
      registered: true,
      collectsBiometric: false,
      collectsGeolocation: false,
      collectsMinors: false,
      soldToLawEnforcement: false,
      soldToGenAI: false,
    };
    brokerAcc.set(hit.slug, {
      registered: true,
      collectsBiometric: prev.collectsBiometric || row.collectsBiometric,
      collectsGeolocation: prev.collectsGeolocation || row.collectsGeolocation,
      collectsMinors: prev.collectsMinors || row.collectsMinors,
      soldToLawEnforcement: prev.soldToLawEnforcement || row.soldToLawEnforcement,
      soldToGenAI: prev.soldToGenAI || row.soldToGenAI,
    });
  }

  // ── assemble the slug-keyed augment ──
  const nowIso = new Date().toISOString();
  const augment = {};
  const allSlugs = new Set([...breachSlugs, ...brokerSlugs]);
  for (const slug of allSlugs) {
    const entry = {};
    const b = breachAcc.get(slug);
    if (b) {
      entry.breaches = {
        count: b.count,
        mostRecent: b.mostRecent,
        maxAffected: b.maxAffected || null,
        causes: topCauses(b.causeCounts),
      };
    }
    const br = brokerAcc.get(slug);
    if (br) entry.dataBroker = br;
    entry.lastUpdated = nowIso;
    augment[slug] = entry;
  }

  return {
    augment,
    stats: {
      caRows: caRows.length,
      waRows: waRows.length,
      brokerRows: brokerRows.length,
      caMatched,
      waMatched,
      brokerMatched,
      breachSlugCount: breachSlugs.size,
      brokerSlugCount: brokerSlugs.size,
      totalSlugCount: allSlugs.size,
      orphanBreachOrgs: orphanBreaches.size,
      orphanBrokerOrgs: orphanBrokers.size,
    },
  };
}

// ─────────────────────────── loaders ────────────────────────────────
async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

// ─────────────────────────── main ───────────────────────────────────
async function main() {
  console.log(
    `privacy-enforcement fetch starting... (mode=${DRY ? "DRY" : "APPLY"}${SKIP_WA ? ", no-wa" : ""})`,
  );

  // 1) Download + parse the three sources (guard against empty/short bodies).
  const caText = await fetchText(CA_BREACH_CSV, "CA AG breach CSV");
  const caRows = parseCaBreaches(caText);
  console.log(`  CA breach rows parsed: ${caRows.length.toLocaleString()}`);
  if (caRows.length < MIN_CA_ROWS) {
    throw new Error(`CA breach parsed only ${caRows.length} rows (< ${MIN_CA_ROWS}); aborting.`);
  }

  let waRows = [];
  if (!SKIP_WA) {
    const waRaw = await fetchWaBreaches();
    console.log(`  WA breach rows fetched: ${waRaw.length.toLocaleString()}`);
    if (waRaw.length < MIN_WA_ROWS) {
      throw new Error(`WA breach fetched only ${waRaw.length} rows (< ${MIN_WA_ROWS}); aborting.`);
    }
    waRows = shapeWaBreaches(waRaw);
  } else {
    console.log("  WA breach: skipped (--no-wa).");
  }

  const brokerText = await fetchText(CPPA_BROKER_CSV, "CPPA broker CSV");
  const brokerRows = parseBrokers(brokerText);
  console.log(`  CPPA broker rows parsed: ${brokerRows.length.toLocaleString()}`);
  if (brokerRows.length < MIN_BROKER_ROWS) {
    throw new Error(`CPPA broker parsed only ${brokerRows.length} rows (< ${MIN_BROKER_ROWS}); aborting.`);
  }

  // 2) Load TruNorth index + parent-map for matching.
  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  if (!Array.isArray(index) || !index.length) {
    throw new Error(`Could not load brand index at ${INDEX_FILE}`);
  }
  console.log(
    `Loaded index (${index.length.toLocaleString()} brands) + parent-map (${Object.keys(parentMap).length.toLocaleString()} entries).`,
  );

  // 3) Build the augment.
  const { augment, stats } = buildAugment({ caRows, waRows, brokerRows, index, parentMap });

  // 4) Report.
  console.log("\nResults:");
  console.log(`  CA breach row→slug matches:   ${stats.caMatched.toLocaleString()}`);
  console.log(`  WA breach row→slug matches:   ${stats.waMatched.toLocaleString()}`);
  console.log(`  CPPA broker row→slug matches: ${stats.brokerMatched.toLocaleString()}`);
  console.log(`  Distinct slugs w/ breaches:   ${stats.breachSlugCount.toLocaleString()}`);
  console.log(`  Distinct slugs w/ broker:     ${stats.brokerSlugCount.toLocaleString()}`);
  console.log(`  TOTAL distinct matched slugs: ${stats.totalSlugCount.toLocaleString()}`);
  console.log(`  Orphan breach orgs (no slug): ${stats.orphanBreachOrgs.toLocaleString()}`);
  console.log(`  Orphan broker orgs (no slug): ${stats.orphanBrokerOrgs.toLocaleString()}`);

  // Top breached brands by count for a sanity eyeball.
  const topBreached = Object.entries(augment)
    .filter(([, v]) => v.breaches)
    .sort((a, b) => b[1].breaches.count - a[1].breaches.count)
    .slice(0, 12);
  if (topBreached.length) {
    console.log("\n  Top breached slugs (by filing count):");
    for (const [slug, v] of topBreached) {
      console.log(
        `    ${String(v.breaches.count).padStart(3)}  ${slug}` +
          `${v.breaches.mostRecent ? `  (latest ${v.breaches.mostRecent})` : ""}` +
          `${v.breaches.causes.length ? `  [${v.breaches.causes.join(", ")}]` : ""}`,
      );
    }
  }

  const brokerExamples = Object.entries(augment)
    .filter(([, v]) => v.dataBroker)
    .slice(0, 8);
  if (brokerExamples.length) {
    console.log("\n  Sample registered data brokers:");
    for (const [slug, v] of brokerExamples) {
      const d = v.dataBroker;
      const tags = [
        d.collectsBiometric && "biometric",
        d.collectsGeolocation && "geo",
        d.collectsMinors && "minors",
        d.soldToLawEnforcement && "→LE",
        d.soldToGenAI && "→GenAI",
      ].filter(Boolean);
      console.log(`    ${slug}${tags.length ? `  {${tags.join(", ")}}` : ""}`);
    }
  }

  const out = {
    _license: LICENSE_TAG,
    _sources: {
      caBreach: { url: CA_BREACH_CSV, landing: CA_BREACH_LANDING, rows: stats.caRows },
      waBreach: { url: WA_BREACH_JSON, landing: WA_BREACH_LANDING, rows: stats.waRows },
      cppaBroker: { url: CPPA_BROKER_CSV, landing: CPPA_BROKER_LANDING, rows: stats.brokerRows },
    },
    _generatedAt: new Date().toISOString(),
    _stats: stats,
    ...augment,
  };

  if (APPLY) {
    const outPath = OUT_PATH ? path.resolve(OUT_PATH) : OUT_FILE;
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, outPath)} (${stats.totalSlugCount} slugs).`);
  } else {
    console.log(
      `\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`,
    );
  }

  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("privacy-enforcement-fetch failed:", err);
    process.exit(1);
  });
}
