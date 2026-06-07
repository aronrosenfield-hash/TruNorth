#!/usr/bin/env node
/**
 * B-27 — Merge ca-ag-actions.json into per-company JSON.
 *
 * Reads:    public/data/_raw/ca-ag-actions.json   (from ca-ag-fetch.mjs)
 * Writes:   public/data/companies/<slug>.json     (per matched defendant)
 * Sidecar:  recent_events[] append for the news-extract score-rebake pipeline
 *
 * Target schema additions:
 *   co.enriched.legal.ca_ag = [{
 *     date, action_type, category, settlement_USD, summary, url
 *   }]
 *   co._meta.lastCAAGFetch = ISO timestamp
 *   co.recent_events = [...existing, { source: "ca_ag", evidence_strength: 9-10, ... }]
 *
 * Name-resolution order:
 *   1. Direct slug match (slugify(defendant) → companies/<slug>.json)
 *   2. slug-aliases.json
 *   3. brand-parent-map.json
 *   4. Skip if no match — do NOT create stubs from CA AG alone.
 *
 * Locally: node scripts/ca-ag-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_FILE = path.join(ROOT, "public/data/_raw/ca-ag-actions.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "ca-ag-merge-log.json");

/* --------------------------- slug utilities ----------------------------- */

// Normalize a company name to a TruNorth-style slug for direct match.
// Mirrors how /public/data/companies/<slug>.json files are named.
export function slugify(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")           // strip accents
    // Strip common corporate suffixes that vary between filings
    // ("Walmart Inc." vs "Walmart Stores Inc." vs "Walmart")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|nv|ag|holdings|holding|group|stores|n\.a|na|usa|america)\b\.?/g, " ")
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

// Slug variant without stripping corporate suffixes — preserves
// "honda-motor-co", "ford-motor-company", etc. that exist as files.
function rawSlugify(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveSlug(defendantName, maps) {
  const slug = slugify(defendantName);
  const raw  = rawSlugify(defendantName);
  if (!slug && !raw) return { slug: null, routed_via: "no-slug" };
  // Try suffix-stripped first (most common), then raw with suffixes preserved.
  for (const cand of [slug, raw]) {
    if (cand && existsSync(path.join(COMP_DIR, `${cand}.json`))) {
      return { slug: cand, routed_via: cand === slug ? "direct" : "raw" };
    }
  }
  for (const cand of [slug, raw]) {
    const alias = maps.aliases[cand];
    if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return { slug: alias, routed_via: "alias" };
    const parent = maps.parents[cand]?.parent;
    if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return { slug: parent, routed_via: "parent" };
  }
  // First-token fallback: "Walmart Stores Inc" → "walmart-stores" → try "walmart"
  const first = slug.split("-")[0];
  if (first.length >= 3 && first !== slug && existsSync(path.join(COMP_DIR, `${first}.json`))) {
    return { slug: first, routed_via: "first-token" };
  }
  return { slug: null, routed_via: "orphan" };
}

/* ----------------------- news-extract sidecar entry --------------------- */
// CA AG settlements are signed by a state AG — high evidence strength.
// We map our internal `category` to the scoring categories used by
// recent_events: privacy/labor/political/charity/environment all pass
// through; consumer_fraud routes to the generic "consumer_fraud" bucket
// which the rebake job treats as a -2 to -4 impact on Honesty & Ethics.
function evidenceStrength(action) {
  // Signed settlement → 10. Filed lawsuit (not yet adjudicated) → 9.
  if (action.action_type === "settlement" || action.action_type === "judgment") return 10;
  if (action.action_type === "lawsuit" || action.action_type === "charges")     return 9;
  return 8;
}

function toRecentEvent(action, now) {
  return {
    source:            "ca_ag",
    date:              action.date,
    category:          action.category,
    direction:         "negative",     // CA AG only publishes enforcement (always neg)
    severity:          action.settlement_USD > 100_000_000 ? "high"
                     : action.settlement_USD > 1_000_000    ? "medium"
                     : "low",
    evidence_strength: evidenceStrength(action),
    settlement_USD:    action.settlement_USD || null,
    action_type:       action.action_type,
    summary:           action.title,
    url:               action.url,
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

async function mergeOneSlug(slug, actions, now) {
  const file = path.join(COMP_DIR, `${slug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { slug, status: "parse_error", error: e.message }; }

  // --- 1. enriched.legal.ca_ag[] (UI-visible card) ---
  company.enriched = company.enriched || {};
  company.enriched.legal = company.enriched.legal || {};
  const prior = Array.isArray(company.enriched.legal.ca_ag) ? company.enriched.legal.ca_ag : [];
  const newRows = actions.map(a => ({
    date:           a.date,
    action_type:    a.action_type,
    category:       a.category,
    settlement_USD: a.settlement_USD || null,
    summary:        a.title,
    url:            a.url,
  }));
  company.enriched.legal.ca_ag = dedupeByUrl([...newRows, ...prior])
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // --- 2. recent_events[] sidecar (score-rebake pipeline) ---
  const eventEntries = actions.map(a => toRecentEvent(a, now));
  company.recent_events = dedupeByUrl([...eventEntries, ...(company.recent_events || [])]);

  // --- 3. _meta freshness ---
  company._meta = company._meta || {};
  company._meta.lastCAAGFetch = now;
  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.ca_ag = now;

  await fs.writeFile(file, JSON.stringify(company));
  return { slug, status: "merged", actions_added: actions.length };
}

async function main() {
  const now = new Date().toISOString();
  console.log("CA AG merge starting…");

  if (!existsSync(RAW_FILE)) {
    console.error(`Missing raw file: ${RAW_FILE}. Run ca-ag-fetch.mjs first.`);
    process.exit(1);
  }
  const raw = JSON.parse(await fs.readFile(RAW_FILE, "utf-8"));
  const actions = raw.actions || [];
  console.log(`${actions.length} raw actions`);

  const maps = await loadMaps();

  // Group actions by resolved slug
  const bySlug = new Map();
  const orphans = [];
  const noDefendant = [];
  for (const a of actions) {
    if (!a.defendant_company_name) { noDefendant.push(a); continue; }
    const { slug, routed_via } = resolveSlug(a.defendant_company_name, maps);
    if (!slug) { orphans.push({ defendant: a.defendant_company_name, url: a.url }); continue; }
    const cur = bySlug.get(slug) || { actions: [], routed_via };
    cur.actions.push(a);
    bySlug.set(slug, cur);
  }

  const results = [];
  for (const [slug, { actions: as, routed_via }] of bySlug) {
    const r = await mergeOneSlug(slug, as, now);
    results.push({ ...r, routed_via });
  }

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/_raw/ca-ag-actions.json",
    total_actions:    actions.length,
    merged_companies: results.filter(r => r.status === "merged").length,
    no_defendant_extracted: noDefendant.length,
    orphan_defendants:      orphans.length,
    orphans:                orphans.slice(0, 50),
  }, null, 2));

  console.log(`Merged ${results.filter(r => r.status === "merged").length} companies`);
  console.log(`  no-defendant: ${noDefendant.length}`);
  console.log(`  orphan defendants: ${orphans.length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("CA AG merge failed:", err);
    process.exit(1);
  });
}
