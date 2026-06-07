#!/usr/bin/env node
/**
 * EU enforcement merge — B-DATA10.
 *
 * Combines OLAF (anti-fraud) + GDPR Enforcement Tracker into per-company JSON.
 *
 * Reads:
 *   public/data/_raw/olaf-cases.json     (from olaf-fetch.mjs)
 *   public/data/_raw/gdpr-fines.json     (from gdpr-enforcement-fetch.mjs)
 * Writes:
 *   public/data/companies/<slug>.json    (per matched company)
 * Sidecar:
 *   public/data/_meta/eu-enforcement-merge-log.json
 *
 * Target schema additions:
 *   co.enriched.political.olaf = {
 *     active_investigations: bool,
 *     recent_cases: [{ year, description, outcome }],
 *     total_recovery_eur: number,
 *     last_updated: ISO,
 *   }
 *   co.enriched.privacy.gdpr = {
 *     total_fines_eur_last_5y: number,
 *     fine_count: number,
 *     largest_fine_eur: number,
 *     primary_violation_type: string|null,
 *     fining_authorities: [string],
 *     last_updated: ISO,
 *   }
 *   co.recent_events += { source: "olaf"|"gdpr", ... }
 *
 * Modes:
 *   node scripts/eu-enforcement-merge.mjs               # DRY (default) — top-50 only, no writes
 *   node scripts/eu-enforcement-merge.mjs --write       # writes per-company JSON for top-50
 *   node scripts/eu-enforcement-merge.mjs --write --all # writes for every resolvable match
 *
 * The --dry default produces a printout of the matches that would be made
 * for the canonical 48-brand TOP_50 list — that's the dry-run preview the
 * task requires.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OLAF_FILE = path.join(RAW_DIR, "olaf-cases.json");
const GDPR_FILE = path.join(RAW_DIR, "gdpr-fines.json");
const LOG_FILE  = path.join(META_DIR, "eu-enforcement-merge-log.json");

const argv = new Set(process.argv.slice(2));
const WRITE_MODE = argv.has("--write");
const ALL_MODE   = argv.has("--all");

// Top-50 dry-run brand list (B-DATA10 spec). 48 unique slugs.
const TOP_50 = [
  "meta", "google", "amazon", "apple", "microsoft", "openai", "twitter",
  "x-corp", "tiktok", "snapchat", "oracle", "salesforce", "ibm", "hp",
  "dell", "criteo", "clearview-ai", "palantir", "stripe", "paypal",
  "equifax", "transunion", "experian", "marriott", "hilton", "hyatt",
  "british-airways", "easyjet", "ryanair", "lufthansa", "bp-uk",
  "shell-usa", "total-energies", "eni-spa", "volkswagen", "daimler",
  "bmw", "dr-oetker", "unilever-uk", "p-and-g", "nestle", "danone",
  "carrefour", "tesco", "h-and-m", "zara", "primark", "asos",
];

// Map dry-run slug → known actual TruNorth slug when files don't match
// directly (the task's TOP_50 contains aspirational names that may not be
// the on-disk slug — the existing /public/data/companies/ files use slightly
// different names for several brands).
const DRY_RUN_SLUG_ALIASES = {
  "meta":           "meta-platforms",
  "google":         "google-alphabet",
  "openai":         null,                   // no canonical file yet
  "tiktok":         null,
  "snapchat":       null,
  "oracle":         "oracle-cloud",
  "criteo":         "criteo-s-a",
  "clearview-ai":   null,
  "palantir":       "palantir-technologies",
  "transunion":     null,
  "experian":       null,
  "british-airways":null,
  "ryanair":        null,
  "lufthansa":      "deutsche-lufthansa-a-g",
  "bp-uk":          "bp-usa",
  "total-energies": null,
  "volkswagen":     "volkswagen-usa",
  "daimler":        "daimler-ag",
  "bmw":            "bmw-usa",
  "unilever-uk":    "unilever",
  "p-and-g":        "procter-and-gamble",
  "nestle":         "nestl",
  "h-and-m":        null,
  "zara":           "zara-inditex",
  "asos":           null,
};

/* --------------------------- slug utilities ----------------------------- */

export function slugify(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|s\.a|s\.r\.l|sarl|nv|n\.v|ag|a\.g|gmbh|kg|holdings|holding|group|stores|n\.a|na|usa|america|europe|ireland|operations|core|international|distribution|technology|technologies|information)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rawSlugify(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

// Resolve a free-text company name to a TruNorth slug on disk.
export function resolveSlug(name, maps = { aliases: {}, parents: {} }) {
  if (!name) return { slug: null, routed_via: "no-name" };
  const slug = slugify(name);
  const raw  = rawSlugify(name);
  for (const cand of [slug, raw]) {
    if (cand && existsSync(path.join(COMP_DIR, `${cand}.json`))) {
      return { slug: cand, routed_via: cand === slug ? "direct" : "raw" };
    }
  }
  for (const cand of [slug, raw]) {
    const alias = maps.aliases?.[cand];
    if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return { slug: alias, routed_via: "alias" };
    const parent = maps.parents?.[cand]?.parent;
    if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return { slug: parent, routed_via: "parent" };
  }
  // Brand-specific heuristics for common parent companies:
  const lower = name.toLowerCase();
  const hints = [
    [/\bmeta\b|facebook|instagram|whatsapp/i, "meta-platforms"],
    [/\bgoogle\b|alphabet/i,                  "google-alphabet"],
    [/\bamazon\b/i,                           "amazon"],
    [/\bapple\b/i,                            "apple"],
    [/\bmicrosoft\b/i,                        "microsoft"],
    [/\bbritish\s+airways\b/i,                "british-airways"],
    [/\blufthansa\b/i,                        "deutsche-lufthansa-a-g"],
    [/\bvolkswagen\b/i,                       "volkswagen-usa"],
    [/\bbmw\b/i,                              "bmw-usa"],
    [/\bdaimler\b/i,                          "daimler-ag"],
    [/\bnestl[eé]\b/i,                        "nestl"],
    [/\bcriteo\b/i,                           "criteo-s-a"],
    [/\bpalantir\b/i,                         "palantir-technologies"],
    [/\boracle\b/i,                           "oracle-cloud"],
    [/\bunilever\b/i,                         "unilever"],
    [/\bcarrefour\b/i,                        "carrefour"],
    [/\bdanone\b/i,                           "danone"],
    [/\bmarriott\b/i,                         "marriott"],
    [/\bbp\b/i,                               "bp-usa"],
    [/\beni\b/i,                              "eni-spa"],
  ];
  for (const [re, candidate] of hints) {
    if (re.test(lower) && existsSync(path.join(COMP_DIR, `${candidate}.json`))) {
      return { slug: candidate, routed_via: "hint" };
    }
  }
  // First-token fallback
  const first = slug.split("-")[0];
  if (first && first.length >= 3 && existsSync(path.join(COMP_DIR, `${first}.json`))) {
    return { slug: first, routed_via: "first-token" };
  }
  return { slug: null, routed_via: "orphan" };
}

/* ----------------------- aggregation helpers ---------------------------- */

function fiveYearCutoff() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

function aggregateOlaf(cases) {
  if (!cases?.length) return null;
  const active = cases.some(c => c.status === "ongoing");
  const total_recovery_eur = cases.reduce((s, c) => s + (c.financial_recovery_eur || 0), 0);
  const recent_cases = cases
    .sort((a, b) => (b.year || 0) - (a.year || 0))
    .slice(0, 10)
    .map(c => ({
      year:        c.year,
      description: c.description?.slice(0, 300) || null,
      outcome:     c.status || null,
      recovery_eur: c.financial_recovery_eur || 0,
      url:         c.url,
    }));
  return {
    active_investigations: active,
    case_count:            cases.length,
    total_recovery_eur,
    recent_cases,
    last_updated: new Date().toISOString(),
  };
}

function aggregateGdpr(fines) {
  if (!fines?.length) return null;
  const cutoff = fiveYearCutoff();
  const last5 = fines.filter(f => f.date && f.date >= cutoff);
  const total_fines_eur_last_5y = last5.reduce((s, f) => s + (f.fine_eur || 0), 0);
  const largest_fine_eur = fines.reduce((m, f) => Math.max(m, f.fine_eur || 0), 0);

  // Primary violation type = mode of violation_type across all-time fines.
  const vtCounts = {};
  for (const f of fines) {
    if (!f.violation_type) continue;
    vtCounts[f.violation_type] = (vtCounts[f.violation_type] || 0) + 1;
  }
  const primary_violation_type = Object.entries(vtCounts)
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0])[0] || null;

  const fining_authorities = [...new Set(fines.map(f => f.authority).filter(Boolean))];

  return {
    total_fines_eur_last_5y,
    fine_count:               fines.length,
    fine_count_last_5y:       last5.length,
    largest_fine_eur,
    primary_violation_type,
    fining_authorities,
    last_updated: new Date().toISOString(),
  };
}

/* ----------------------- recent_events sidecars ------------------------- */

function olafToRecentEvent(c, now) {
  return {
    source:            "olaf",
    date:              c.year ? `${c.year}-01-01` : null,
    category:          "political",
    direction:         "negative",
    severity:          c.financial_recovery_eur > 10_000_000 ? "high"
                     : c.financial_recovery_eur > 100_000    ? "medium"
                     : "low",
    evidence_strength: c.status === "ongoing" ? 7 : 9,
    summary:           c.description?.slice(0, 240) || c.company,
    url:               c.url,
    ingested_at:       now,
  };
}

function gdprToRecentEvent(f, now) {
  return {
    source:            "gdpr",
    date:              f.date,
    category:          "privacy",
    direction:         "negative",
    severity:          f.fine_eur >= 100_000_000 ? "high"
                     : f.fine_eur >= 1_000_000   ? "medium"
                     : "low",
    evidence_strength: 10, // signed regulator fine
    fine_eur:          f.fine_eur || null,
    summary:           `${f.authority || "EU DPA"}: €${(f.fine_eur || 0).toLocaleString()} — ${f.violation_type || "GDPR violation"}`,
    url:               f.url,
    ingested_at:       now,
  };
}

/* ------------------------------- merge ---------------------------------- */

function dedupeByUrl(arr) {
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    const k = a.url || JSON.stringify(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

async function mergeOneSlug(slug, { olafCases, gdprFines }, now) {
  const file = path.join(COMP_DIR, `${slug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { slug, status: "parse_error", error: e.message }; }

  company.enriched = company.enriched || {};

  // OLAF -> enriched.political.olaf
  if (olafCases?.length) {
    company.enriched.political = company.enriched.political || {};
    company.enriched.political.olaf = aggregateOlaf(olafCases);
  }
  // GDPR -> enriched.privacy.gdpr
  if (gdprFines?.length) {
    company.enriched.privacy = company.enriched.privacy || {};
    company.enriched.privacy.gdpr = aggregateGdpr(gdprFines);
  }

  // recent_events sidecar
  const events = [
    ...(olafCases || []).map(c => olafToRecentEvent(c, now)),
    ...(gdprFines || []).map(f => gdprToRecentEvent(f, now)),
  ];
  if (events.length) {
    company.recent_events = dedupeByUrl([...events, ...(company.recent_events || [])]);
  }

  // _meta freshness
  company._meta = company._meta || {};
  if (olafCases?.length) company._meta.lastOLAFFetch = now;
  if (gdprFines?.length) company._meta.lastGDPRFetch = now;
  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  if (olafCases?.length) company.dataLastUpdated.olaf = now;
  if (gdprFines?.length) company.dataLastUpdated.gdpr = now;

  await fs.writeFile(file, JSON.stringify(company));
  return {
    slug,
    status: "merged",
    olaf_cases: olafCases?.length || 0,
    gdpr_fines: gdprFines?.length || 0,
  };
}

/* ------------------------------- main ----------------------------------- */

async function loadRaw() {
  if (!existsSync(OLAF_FILE)) throw new Error(`Missing ${OLAF_FILE} — run olaf-fetch.mjs first`);
  if (!existsSync(GDPR_FILE)) throw new Error(`Missing ${GDPR_FILE} — run gdpr-enforcement-fetch.mjs first`);
  const olaf = JSON.parse(await fs.readFile(OLAF_FILE, "utf-8"));
  const gdpr = JSON.parse(await fs.readFile(GDPR_FILE, "utf-8"));
  return { olafCases: olaf.cases || [], gdprFines: gdpr.fines || [] };
}

// Group raw data by resolved slug.
async function groupBySlug({ olafCases, gdprFines }, maps) {
  const buckets = new Map(); // slug -> { olafCases:[], gdprFines:[], names:Set, routed_via:Set }
  const orphans = { olaf: [], gdpr: [] };

  const route = (rawName) => {
    const r = resolveSlug(rawName, maps);
    return r;
  };

  for (const c of olafCases) {
    const r = route(c.company);
    if (!r.slug) { orphans.olaf.push({ name: c.company, year: c.year }); continue; }
    const b = buckets.get(r.slug) || { olafCases: [], gdprFines: [], names: new Set(), routes: new Set() };
    b.olafCases.push(c);
    b.names.add(c.company);
    b.routes.add(r.routed_via);
    buckets.set(r.slug, b);
  }
  for (const f of gdprFines) {
    const r = route(f.controller);
    if (!r.slug) { orphans.gdpr.push({ name: f.controller, date: f.date }); continue; }
    const b = buckets.get(r.slug) || { olafCases: [], gdprFines: [], names: new Set(), routes: new Set() };
    b.gdprFines.push(f);
    b.names.add(f.controller);
    b.routes.add(r.routed_via);
    buckets.set(r.slug, b);
  }
  return { buckets, orphans };
}

function dryRunTop50Report(buckets) {
  console.log("\n=== TOP-50 DRY-RUN preview ===\n");
  const rows = [];
  for (const wanted of TOP_50) {
    const actual = (Object.prototype.hasOwnProperty.call(DRY_RUN_SLUG_ALIASES, wanted)
                    ? DRY_RUN_SLUG_ALIASES[wanted]
                    : wanted) || wanted;
    const b = buckets.get(actual);
    if (!b) {
      const exists = existsSync(path.join(COMP_DIR, `${actual}.json`));
      rows.push({ wanted, actual, on_disk: exists, olaf: 0, gdpr: 0, sample: null });
      continue;
    }
    const olaf = b.olafCases.length;
    const gdpr = b.gdprFines.length;
    const sample = b.gdprFines[0]
      ? `GDPR €${(b.gdprFines[0].fine_eur || 0).toLocaleString()} (${b.gdprFines[0].authority})`
      : b.olafCases[0]
        ? `OLAF ${b.olafCases[0].year} ${b.olafCases[0].status || ""}`
        : null;
    rows.push({ wanted, actual, on_disk: true, olaf, gdpr, sample });
  }

  const w = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  console.log(w("WANTED", 17), w("ACTUAL SLUG", 28), w("DISK", 5), w("OLAF", 5), w("GDPR", 5), "SAMPLE");
  console.log("-".repeat(110));
  for (const r of rows) {
    console.log(w(r.wanted, 17), w(r.actual, 28), w(r.on_disk ? "yes" : "no", 5),
                w(r.olaf, 5), w(r.gdpr, 5), r.sample || "");
  }
  const hits = rows.filter(r => r.on_disk && (r.olaf + r.gdpr) > 0).length;
  const missingSlugs = rows.filter(r => !r.on_disk).length;
  console.log(`\nResolved hits: ${hits}/${rows.length} | missing slug files: ${missingSlugs}`);
  return rows;
}

async function main() {
  const now = new Date().toISOString();
  console.log(`EU enforcement merge starting (${WRITE_MODE ? "WRITE" : "DRY"}${ALL_MODE ? " --all" : ""})…`);

  const raw = await loadRaw();
  console.log(`  OLAF cases: ${raw.olafCases.length}, GDPR fines: ${raw.gdprFines.length}`);
  const maps = await loadMaps();
  const { buckets, orphans } = await groupBySlug(raw, maps);
  console.log(`  resolved into ${buckets.size} unique slugs`);
  console.log(`  orphans: OLAF=${orphans.olaf.length}, GDPR=${orphans.gdpr.length}`);

  const dryRows = dryRunTop50Report(buckets);

  let results = [];
  if (WRITE_MODE) {
    const targetSlugs = ALL_MODE
      ? [...buckets.keys()]
      : dryRows.filter(r => r.on_disk && (r.olaf + r.gdpr) > 0).map(r => r.actual);
    console.log(`\nWriting ${targetSlugs.length} per-company JSON files…`);
    for (const slug of targetSlugs) {
      const b = buckets.get(slug);
      if (!b) continue;
      results.push(await mergeOneSlug(slug, b, now));
    }
  } else {
    console.log("\n(DRY mode — no per-company JSON written. Re-run with --write to apply.)");
  }

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at: now,
    mode: WRITE_MODE ? (ALL_MODE ? "write-all" : "write-top50") : "dry-run",
    olaf_cases_in: raw.olafCases.length,
    gdpr_fines_in: raw.gdprFines.length,
    unique_resolved_slugs: buckets.size,
    orphan_counts: { olaf: orphans.olaf.length, gdpr: orphans.gdpr.length },
    top50_dry_run: dryRows,
    sample_orphans: {
      olaf: orphans.olaf.slice(0, 20),
      gdpr: orphans.gdpr.slice(0, 20),
    },
    written: results.length,
    results: results.slice(0, 200),
  }, null, 2));
  console.log(`\nLog written → ${LOG_FILE}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("EU enforcement merge failed:", err);
    process.exit(1);
  });
}
