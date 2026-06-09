#!/usr/bin/env node
/**
 * Enrich per-company JSON narratives from existing negative-signal data files.
 *
 * Aron's morning Build 56 ask (2026-06-09):
 *   Pre-rebake distribution is 36% A / 4% B / 43% C / 15% D / 3% F because 84%
 *   of brands have 0-1 graded signals. The /public/data/ tree already has
 *   per-brand records for OSHA SIR, CPSC recalls, MSHA, CISA KEV, SEC
 *   litigation, HHS-OIG, OCC, etc. — they were never written into per-category
 *   narrative fields, so rebake-scoring.mjs (which reads detail[cat].s and
 *   sc[cat]) never sees them.
 *
 * What this script does:
 *   1. Walk all curated negative-signal sources (one inventory function each).
 *   2. For each source record, resolve slug → company file (direct →
 *      slug-aliases → brand-parent-map; same pattern as cisa-kev-merge.mjs).
 *   3. For each (company, category) cell, fill detail[cat].s with a one-liner
 *      narrative ONLY when the field is empty or "No public record found." —
 *      this is the "first non-no-record wins" rule.
 *   4. Set sc[cat] to the appropriate enum ("poor"/"mixed") ONLY when not
 *      already a non-neutral value. Never overwrite real signal.
 *   5. Idempotent — re-running produces no further writes.
 *
 * What this script does NOT do:
 *   - Touch sc[cat] or detail[cat].s where substantive content already exists
 *   - Modify scoring math, thresholds, or rebake logic
 *   - Make any network calls — works only from existing JSON files
 *
 * Run order: node scripts/enrich-negative-signals.mjs &&
 *            node scripts/rebake-scoring.mjs &&
 *            node scripts/finalize-bundle.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "public/data");
const COMPS = path.join(DATA, "companies");
const META = path.join(DATA, "_meta");
const LOG_FILE = path.join(META, "enrich-negative-signals-log.json");

const NO_RECORD = /^\s*no public record found\.?\s*$/i;

// ────────────────────────────────────────────────────────────────────────────
// Slug routing — direct → alias → brand-parent-map (mirrors osha-sir-merge.mjs)
// ────────────────────────────────────────────────────────────────────────────

function loadJSONSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fallback; }
}

const ALIASES = loadJSONSafe(path.join(META, "slug-aliases.json"), {});
const PARENTS = loadJSONSafe(path.join(META, "brand-parent-map.json"), {});

// CISA KEV vendor → TruNorth slug. Mirrors VENDOR_OVERRIDES from cisa-kev-merge.mjs
// so we don't have to re-derive them here.
const CISA_OVERRIDES = {
  "google": "google-alphabet", "alphabet": "google-alphabet", "android": "google-alphabet",
  "chrome": "google-alphabet", "fitbit": "google-alphabet", "nest": "google-alphabet",
  "youtube": "google-alphabet",
  "meta": "meta-facebook", "facebook": "meta-facebook", "instagram": "meta-facebook",
  "whatsapp": "meta-facebook",
  "x": "twitter-x", "twitter": "twitter-x",
  "amazon-web-services": "amazon", "aws": "amazon",
};

function fileExists(slug) {
  return fs.existsSync(path.join(COMPS, `${slug}.json`));
}

function resolveSlug(rawSlug) {
  if (!rawSlug) return null;
  if (fileExists(rawSlug)) return rawSlug;
  const alias = ALIASES[rawSlug];
  if (alias && fileExists(alias)) return alias;
  const parent = PARENTS[rawSlug]?.parent;
  if (parent && fileExists(parent)) return parent;
  return null;
}

function slugifyVendor(s) {
  return String(s).toLowerCase().normalize("NFKD")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ────────────────────────────────────────────────────────────────────────────
// Company file state — load once, write at end
// ────────────────────────────────────────────────────────────────────────────

const companies = new Map(); // slug → { d, dirty, sourcesAdded:Set, catsTouched:Set }
const sourceCounts = {};
const catTouches = {}; // src -> {cat: count}

function getCompany(slug) {
  if (companies.has(slug)) return companies.get(slug);
  const p = path.join(COMPS, `${slug}.json`);
  let d;
  try { d = JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
  const rec = { d, dirty: false, sourcesAdded: new Set(), catsTouched: new Set() };
  companies.set(slug, rec);
  return rec;
}

/** Returns true when narrative slot is open (empty or "No public record found.") */
function slotOpen(d, cat) {
  const narrative = ((d[cat] || {}).s || "").trim();
  if (!narrative) return true;
  if (NO_RECORD.test(narrative)) return true;
  return false;
}

/** Returns true if sc[cat] is unset / neutral / unknown — safe to set. */
function scOpen(d, cat) {
  const v = String((d.sc || {})[cat] || "").toLowerCase();
  return !v || v === "neutral" || v === "unknown";
}

/** Returns true if sc[cat] is "na" / "n/a" — category is marked not applicable.
 *  We skip writing narratives for these to avoid the "SEC litigation + sc=na"
 *  contradiction (rebake excludes na from scoring; narrative would just confuse). */
function scIsNA(d, cat) {
  const v = String((d.sc || {})[cat] || "").toLowerCase();
  return v === "na" || v === "n/a";
}

/**
 * Write narrative + sc enum if slot is open. Returns true if applied.
 *
 *   source: short label for the log (e.g. "cpsc-recalls")
 *   enumValue: "poor" | "negative" | "mixed" | etc. — written only if scOpen
 */
function applyNarrative(slug, cat, source, narrative, enumValue) {
  const rec = getCompany(slug);
  if (!rec) return false;
  const { d } = rec;
  if (!slotOpen(d, cat)) return false; // first-write-wins
  if (scIsNA(d, cat)) return false;    // category marked not applicable — skip
  if (!d[cat] || typeof d[cat] !== "object") d[cat] = {};
  d[cat].s = narrative;
  if (enumValue && scOpen(d, cat)) {
    if (!d.sc || typeof d.sc !== "object") d.sc = {};
    d.sc[cat] = enumValue;
  }
  rec.dirty = true;
  rec.sourcesAdded.add(source);
  rec.catsTouched.add(cat);
  sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  if (!catTouches[source]) catTouches[source] = {};
  catTouches[source][cat] = (catTouches[source][cat] || 0) + 1;
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-source enrichers
// ────────────────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return "0";
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

// 1. CPSC recalls → health (poor/mixed)
function enrichCPSC() {
  const src = loadJSONSafe(path.join(DATA, "cpsc-recalls.json"), { recalls: [] });
  for (const r of src.recalls || []) {
    if (r.status !== "ok" || !(r.total_recalls > 0)) continue;
    const slug = resolveSlug(r.slug);
    if (!slug) continue;
    const recent = r.recent_24mo_count || 0;
    const total = r.total_recalls;
    const hazardSamp = (r.top_hazards || [])[0]?.label || "";
    const hazardShort = hazardSamp ? hazardSamp.split(/[.,;]/)[0].slice(0, 80) : "";
    const narrative = recent > 0
      ? `${total} CPSC recall${total === 1 ? "" : "s"} (${recent} in past 24 months)${hazardShort ? `; latest hazard: ${hazardShort.toLowerCase()}` : ""}.`
      : `${total} CPSC recall${total === 1 ? "" : "s"} on record${hazardShort ? `; sample hazard: ${hazardShort.toLowerCase()}` : ""}.`;
    // Treat 2+ recent recalls as "poor"; everything else as "mixed".
    const enumValue = recent >= 2 ? "poor" : "mixed";
    applyNarrative(slug, "health", "cpsc-recalls", narrative, enumValue);
  }
}

// 2. OSHA SIR → labor (poor/mixed)
function enrichOSHA() {
  const src = loadJSONSafe(path.join(DATA, "osha-sir.json"), { brands: [] });
  for (const b of src.brands || []) {
    if (b.status !== "ok" || !(b.total_records_all_time > 0)) continue;
    const slug = resolveSlug(b.slug);
    if (!slug) continue;
    const sev2y = b.total_severe_injuries_2y || 0;
    const amps2y = b.total_amputations_2y || 0;
    const totalAll = b.total_records_all_time;
    const narrative = sev2y > 0
      ? `${sev2y} OSHA severe-injury reports in past 2y (${amps2y} amputations); ${totalAll} since 2015.`
      : `${totalAll} OSHA severe-injury reports since 2015.`;
    const enumValue = sev2y >= 10 ? "poor" : "mixed";
    applyNarrative(slug, "labor", "osha-sir", narrative, enumValue);
  }
}

// 3. MSHA incidents → labor (poor/mixed)
function enrichMSHA() {
  const src = loadJSONSafe(path.join(DATA, "msha-incidents.json"), { brands: [] });
  for (const b of src.brands || []) {
    if (b.status !== "ok") continue;
    const cit = b.total_citations || 0;
    const acc = b.total_accidents || 0;
    const fatal = b.fatalities_5y || 0;
    const pen = b.total_penalties_usd || 0;
    if (cit + acc + fatal === 0) continue;
    const slug = resolveSlug(b.slug);
    if (!slug) continue;
    const parts = [];
    if (cit > 0) parts.push(`${cit} MSHA citation${cit === 1 ? "" : "s"}`);
    if (acc > 0) parts.push(`${acc} accident${acc === 1 ? "" : "s"}`);
    if (fatal > 0) parts.push(`${fatal} fatalit${fatal === 1 ? "y" : "ies"} in past 5y`);
    if (pen > 0) parts.push(`$${fmt(pen)} in penalties`);
    const narrative = `Mine Safety & Health Admin: ${parts.join(", ")}.`;
    const enumValue = fatal > 0 ? "poor" : (cit >= 50 || pen >= 100_000 ? "poor" : "mixed");
    applyNarrative(slug, "labor", "msha-incidents", narrative, enumValue);
  }
}

// 4. CISA KEV → privacy (poor/mixed) — match by vendor name, route via overrides + alias
function enrichCISA() {
  const src = loadJSONSafe(path.join(DATA, "cisa-kev.json"), { vendors: [] });
  // Track per-target so multiple vendors (Google + Android → google-alphabet)
  // don't double-write — first one wins.
  const seenTarget = new Set();
  for (const v of src.vendors || []) {
    const cves = v.total_cve_count || 0;
    if (cves === 0) continue;
    const vSlug = slugifyVendor(v.vendor);
    const override = CISA_OVERRIDES[vSlug];
    const target = (override && fileExists(override)) ? override : resolveSlug(vSlug);
    if (!target) continue;
    if (seenTarget.has(target)) continue;
    seenTarget.add(target);
    const recent = v.recent_12mo_count || 0;
    const ransom = v.ransomware_count || 0;
    // highest_severity is an array of recent CVE objects, not a string.
    // Pull the most-recent product name if available for color.
    const products = (v.product_breakdown || []).slice(0, 2).map((p) => p.label).filter(Boolean);
    const productHint = products.length ? `; affected products include ${products.join(", ")}` : "";
    const narrative = `CISA Known Exploited Vulns: ${cves} CVE${cves === 1 ? "" : "s"} on record (${recent} in past 12mo${ransom > 0 ? `, ${ransom} used in ransomware` : ""})${productHint}.`;
    const enumValue = ransom >= 5 || recent >= 10 ? "poor" : "mixed";
    applyNarrative(target, "privacy", "cisa-kev", narrative, enumValue);
  }
}

// 5. SEC litigation → execPay (poor/mixed) — securities fraud, mgmt actions
function enrichSECLit() {
  const src = loadJSONSafe(path.join(DATA, "sec-litigation.json"), { releases: [] });
  for (const r of src.releases || []) {
    const total = r.total_releases_lifetime || 0;
    if (total === 0) continue;
    const slug = resolveSlug(r.slug);
    if (!slug) continue;
    const narrative = `SEC litigation releases: ${total} on record (insider trading, accounting fraud, or disclosure violations).`;
    const enumValue = total >= 5 ? "poor" : "mixed";
    applyNarrative(slug, "execPay", "sec-litigation", narrative, enumValue);
  }
}

// 6. OCC enforcement → execPay (poor/mixed) — bank governance
function enrichOCC() {
  const src = loadJSONSafe(path.join(DATA, "occ-enforcement.json"), { actions: [] });
  for (const a of src.actions || []) {
    const total = a.total_enforcement_actions || 0;
    if (total === 0) continue;
    const slug = resolveSlug(a.slug);
    if (!slug) continue;
    const narrative = `OCC bank enforcement: ${total} action${total === 1 ? "" : "s"} on record (consent orders, civil money penalties, or cease-and-desist).`;
    const enumValue = total >= 3 ? "poor" : "mixed";
    applyNarrative(slug, "execPay", "occ-enforcement", narrative, enumValue);
  }
}

// 7. HHS-OIG → health (poor/mixed) — healthcare fraud, LEIE exclusions
function enrichHHSOIG() {
  const src = loadJSONSafe(path.join(DATA, "hhs-oig.json"), { results: [] });
  for (const r of src.results || []) {
    const excl = r.exclusion_count || 0;
    const fraud = r.recent_fraud_actions_24mo || 0;
    if (excl + fraud === 0) continue;
    const slug = resolveSlug(r.slug);
    if (!slug) continue;
    const parts = [];
    if (excl > 0) parts.push(`${excl} OIG exclusion${excl === 1 ? "" : "s"} (Medicare/Medicaid debarment)`);
    if (fraud > 0) parts.push(`${fraud} recent OIG enforcement action${fraud === 1 ? "" : "s"} (past 24mo)`);
    const narrative = `HHS Office of Inspector General: ${parts.join("; ")}.`;
    const enumValue = excl >= 1 || fraud >= 2 ? "poor" : "mixed";
    applyNarrative(slug, "health", "hhs-oig", narrative, enumValue);
  }
}

// 8. CDC FoodNet outbreaks → health (poor/mixed)
function enrichCDC() {
  const src = loadJSONSafe(path.join(DATA, "cdc-foodnet-outbreaks.json"), { outbreaks: [] });
  for (const o of src.outbreaks || []) {
    const total = o.total_outbreaks_all_time || 0;
    if (total === 0) continue;
    const slug = resolveSlug(o.slug);
    if (!slug) continue;
    const recent = o.total_outbreaks_5y || 0;
    const ill = o.total_illnesses_5y || 0;
    const hosp = o.total_hospitalizations_5y || 0;
    const narrative = recent > 0
      ? `CDC FoodNet: ${total} foodborne-illness outbreak${total === 1 ? "" : "s"} on record (${recent} in past 5y; ${ill} illnesses, ${hosp} hospitalizations).`
      : `CDC FoodNet: ${total} foodborne-illness outbreak${total === 1 ? "" : "s"} on record.`;
    const enumValue = recent >= 1 || total >= 3 ? "poor" : "mixed";
    applyNarrative(slug, "health", "cdc-foodnet", narrative, enumValue);
  }
}

// 9. CFPB complaints → privacy (poor/mixed) — financial consumer complaints
// Only "ok" status, and only when total_complaints >= 20 to avoid the
// "Ritz/Moritz" sub-string noise floor.
function enrichCFPB() {
  const src = loadJSONSafe(path.join(DATA, "cfpb-complaints.json"), { complaints: [] });
  for (const c of src.complaints || []) {
    if (c.status !== "ok") continue;
    const total = c.total_complaints || 0;
    const recent = c.recent_12mo_count || 0;
    if (total < 20) continue;
    const slug = resolveSlug(c.slug);
    if (!slug) continue;
    const narrative = `CFPB consumer complaints: ${total} on record${recent > 0 ? ` (${recent} in past 12mo)` : ""}; ${c.timely_response_rate || 0}% timely response rate.`;
    const enumValue = recent >= 50 || total >= 500 ? "poor" : "mixed";
    applyNarrative(slug, "privacy", "cfpb-complaints", narrative, enumValue);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

console.log("[enrich] loading sources + applying narratives...");
enrichCPSC();
enrichOSHA();
enrichMSHA();
enrichCISA();
enrichSECLit();
enrichOCC();
enrichHHSOIG();
enrichCDC();
enrichCFPB();

// Write back
let written = 0;
const brandsGainingByCount = {}; // # new cats gained → brand count
const allBrandsTouched = [];
for (const [slug, rec] of companies.entries()) {
  if (!rec.dirty) continue;
  fs.writeFileSync(path.join(COMPS, `${slug}.json`), JSON.stringify(rec.d, null, 2));
  written++;
  const n = rec.catsTouched.size;
  brandsGainingByCount[n] = (brandsGainingByCount[n] || 0) + 1;
  allBrandsTouched.push({ slug, gained: Array.from(rec.catsTouched), sources: Array.from(rec.sourcesAdded) });
}

console.log(`[enrich] wrote ${written} company files.`);
console.log("");
console.log("=== Per-source application counts ===");
for (const [src, n] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
  const byCat = catTouches[src];
  const breakdown = Object.entries(byCat).map(([c, v]) => `${c}=${v}`).join(", ");
  console.log(`  ${src.padEnd(20)} ${String(n).padStart(4)} cells  (${breakdown})`);
}
console.log("");
console.log("=== Brands gaining 1+ new category narrative ===");
for (const k of Object.keys(brandsGainingByCount).sort((a, b) => Number(a) - Number(b))) {
  console.log(`  ${k} new cat${k === "1" ? "" : "s"}: ${brandsGainingByCount[k]} brands`);
}

fs.mkdirSync(META, { recursive: true });
fs.writeFileSync(LOG_FILE, JSON.stringify({
  ran_at: new Date().toISOString(),
  written_files: written,
  source_counts: sourceCounts,
  cat_touches: catTouches,
  brands_gaining: brandsGainingByCount,
  brands: allBrandsTouched.slice(0, 1000),
}, null, 2));
console.log(`\n[enrich] log written to ${path.relative(ROOT, LOG_FILE)}`);
