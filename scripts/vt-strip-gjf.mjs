#!/usr/bin/env node
/**
 * vt-strip-gjf.mjs — remove Good Jobs First "Violation Tracker" data from the
 * shipped dataset (paid-app license remediation, 2026-06-27).
 *
 * WHY: enriched.violationTracker / laborAPI.violationTracker is scraped/derived
 * from Good Jobs First's Violation Tracker. GJF's ToS grant only a limited
 * internal-use license (bulk data paywalled, © asserted on the compilation) —
 * not cleared for the paid Pro tier. The display was gated off in App.jsx
 * (SHOW_FEDERAL_PENALTIES=false) on 2026-06-27; this script removes the residual
 * GJF *data* that still ships in the per-company JSONs + the companies.js bundle.
 *
 * SCOPE (decision 2026-06-27 — NARRATIVES LEFT UNTOUCHED so scoring is unchanged):
 *   ✔ delete root-level `violationTracker` objects (where populated)
 *   ✔ delete `laborAPI.violationTracker` (and the `laborAPI` wrapper if it then
 *     holds nothing else)
 *   ✔ delete `dataLastUpdated.violationTrackerV2` (none currently present)
 *   ✔ remove "Violation Tracker"[ (verified)] entries from every `sources[]`
 *     array (the now-orphaned source badges)
 *   ✔ delete artifacts: public/data/vt-v2.json, _meta/vt-v2-merge-log.json,
 *     _cache/vt-v2/
 *   ✘ does NOT touch labor.s / environment.s narratives (they keep their
 *     "(Violation Tracker)" text + penalty figures — Aron's call), so the
 *     rebake-scoring inputs (parseDollars over narrative) are byte-identical and
 *     grades do NOT move. Verify with audit-grade-drift after running.
 *   ✘ does NOT touch independent government data: osha/nlrb/epa/labor_dol_whd,
 *     enriched.oshaSevereInjury/msha/phmsa, etc.
 *
 * SEQUENCING (important): a parallel session has an in-flight Build-76 rebake
 * (uncommitted rewrites across public/data/companies/*.json that KEEP
 * violationTracker). Run this ONLY against a clean tree AFTER that rebake has
 * committed, or it will mass-conflict. Do NOT run against a dirty rebake tree.
 *
 * USAGE:
 *   node scripts/vt-strip-gjf.mjs                 # DRY RUN — report only, no writes
 *   node scripts/vt-strip-gjf.mjs --apply         # write the strip
 *   node scripts/vt-strip-gjf.mjs --apply --no-companies-js   # skip the fallback bundle
 *   (test:) node scripts/vt-strip-gjf.mjs --apply --dir <sandbox> --no-companies-js --no-artifacts
 *
 * AFTER --apply, run the normal finalize + verification chain:
 *   node scripts/rebuild-bundle-index.mjs
 *   node --test scripts/scoring-engine.test.mjs        # must stay green
 *   node scripts/audit-grade-drift.mjs                 # MUST report ZERO drift
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const NO_COMPANIES_JS = argv.includes("--no-companies-js");
const NO_ARTIFACTS = argv.includes("--no-artifacts");
const DIR_OVERRIDE = (() => { const i = argv.indexOf("--dir"); return i >= 0 ? argv[i + 1] : null; })();

const COMP_DIR = DIR_OVERRIDE ? path.resolve(DIR_OVERRIDE) : path.join(ROOT, "public/data/companies");
const COMPANIES_JS = path.join(ROOT, "src/companies.js");
const ARTIFACT_FILES = [
  path.join(ROOT, "public/data/vt-v2.json"),
  path.join(ROOT, "public/data/_meta/vt-v2-merge-log.json"),
];
const ARTIFACT_DIRS = [path.join(ROOT, "public/data/_cache/vt-v2")];

const VT_BADGE_RE = /^Violation Tracker\b/i; // matches "Violation Tracker" and "Violation Tracker (verified)"

/* ───────────────────────── transforms ───────────────────────── */

// Remove GJF source badges from every array nested under a "sources" key.
function stripSourcesBadges(node) {
  let removed = 0;
  const walk = (n, parentKey) => {
    if (Array.isArray(n)) {
      if (parentKey === "sources") {
        for (let i = n.length - 1; i >= 0; i--) {
          if (typeof n[i] === "string" && VT_BADGE_RE.test(n[i])) { n.splice(i, 1); removed++; }
        }
      }
      for (const v of n) walk(v, null);
    } else if (n && typeof n === "object") {
      for (const [k, v] of Object.entries(n)) walk(v, k);
    }
  };
  walk(node, null);
  return removed;
}

// Strip GJF data from one parsed company object IN PLACE. Never touches `.s`
// narratives or independent-gov keys. Returns per-target counts.
function stripCompany(d) {
  const c = { root: 0, laborApi: 0, dluV2: 0, badges: 0, nullLeft: 0 };
  if (!d || typeof d !== "object") return c;

  if (d.violationTracker != null) { delete d.violationTracker; c.root = 1; }
  else if ("violationTracker" in d) { c.nullLeft = 1; } // harmless null placeholder — left as-is

  if (d.laborAPI && typeof d.laborAPI === "object" && d.laborAPI.violationTracker != null) {
    delete d.laborAPI.violationTracker; c.laborApi = 1;
    if (Object.keys(d.laborAPI).length === 0) delete d.laborAPI;
  }

  if (d.dataLastUpdated && typeof d.dataLastUpdated === "object" && "violationTrackerV2" in d.dataLastUpdated) {
    delete d.dataLastUpdated.violationTrackerV2; c.dluV2 = 1;
  }

  c.badges = stripSourcesBadges(d);
  return c;
}

// Re-serialize to match the file's ORIGINAL style (minified vs 2-space pretty,
// trailing newline or not) so diffs show ONLY the removed VT content.
function detectStyle(raw, parsed) {
  const hasNl = raw.endsWith("\n");
  const body = hasNl ? raw.slice(0, -1) : raw;
  if (body === JSON.stringify(parsed)) return { indent: undefined, nl: hasNl, reformatted: false };
  if (body === JSON.stringify(parsed, null, 2)) return { indent: 2, nl: hasNl, reformatted: false };
  return { indent: 2, nl: hasNl || true, reformatted: true }; // unknown → 2-space, flagged
}

/* ───────────────────────── runners ───────────────────────── */

async function stripCompanyFiles() {
  const files = (await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json"));
  const tally = { scanned: 0, changed: 0, root: 0, laborApi: 0, dluV2: 0, badges: 0, nullLeft: 0, reformatted: 0, parseErrors: [] };
  for (const f of files) {
    tally.scanned++;
    const file = path.join(COMP_DIR, f);
    const raw = await fs.readFile(file, "utf-8");
    let d;
    try { d = JSON.parse(raw); } catch (e) { tally.parseErrors.push(f); continue; }
    const style = detectStyle(raw, d);          // detect BEFORE mutating
    const c = stripCompany(d);
    tally.root += c.root; tally.laborApi += c.laborApi; tally.dluV2 += c.dluV2;
    tally.badges += c.badges; tally.nullLeft += c.nullLeft;
    const changed = (c.root + c.laborApi + c.dluV2 + c.badges) > 0;
    if (changed) {
      tally.changed++;
      if (style.reformatted) tally.reformatted++;
      const out = JSON.stringify(d, null, style.indent) + (style.nl ? "\n" : "");
      if (APPLY) await fs.writeFile(file, out);
    }
  }
  return tally;
}

async function stripCompaniesJsBundle() {
  if (!existsSync(COMPANIES_JS)) return { skipped: "missing" };
  const raw = await fs.readFile(COMPANIES_JS, "utf-8");
  const marker = "export const COMPANIES = ";
  const idx = raw.indexOf(marker);
  if (idx < 0) return { skipped: "no COMPANIES export marker" };
  const header = raw.slice(0, idx);

  const mod = await import(pathToFileURL(COMPANIES_JS).href);
  const arr = mod.COMPANIES;
  if (!Array.isArray(arr)) return { skipped: "COMPANIES not an array" };
  const before = arr.length;

  const c = { root: 0, laborApi: 0, dluV2: 0, badges: 0 };
  for (const obj of arr) {
    const r = stripCompany(obj);
    c.root += r.root; c.laborApi += r.laborApi; c.dluV2 += r.dluV2; c.badges += r.badges;
  }
  const out = header + marker + JSON.stringify(arr, null, 2) + ";\n";

  // Safety gate: length unchanged AND no VT object survives in the output.
  const vtRemaining = (out.match(/"violationTracker"\s*:\s*\{/g) || []).length;
  const safe = arr.length === before && vtRemaining === 0;
  if (APPLY && safe) await fs.writeFile(COMPANIES_JS, out);
  return { before, after: arr.length, vtRemaining, safe, wrote: APPLY && safe, ...c };
}

async function stripArtifacts() {
  const removed = [], missing = [];
  for (const f of ARTIFACT_FILES) {
    if (existsSync(f)) { if (APPLY) await fs.rm(f); removed.push(path.relative(ROOT, f)); }
    else missing.push(path.relative(ROOT, f));
  }
  for (const d of ARTIFACT_DIRS) {
    if (existsSync(d)) { if (APPLY) await fs.rm(d, { recursive: true, force: true }); removed.push(path.relative(ROOT, d) + "/"); }
    else missing.push(path.relative(ROOT, d) + "/");
  }
  return { removed, missing };
}

/* ───────────────────────── main ───────────────────────── */

async function main() {
  console.log(`\n🧹 vt-strip-gjf — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);
  console.log(`   companies dir: ${COMP_DIR}${DIR_OVERRIDE ? "  (overridden)" : ""}\n`);

  const jsonTally = await stripCompanyFiles();
  console.log("── per-company JSONs ──");
  console.log(`   scanned:            ${jsonTally.scanned}`);
  console.log(`   files changed:      ${jsonTally.changed}`);
  console.log(`   root VT objects:    ${jsonTally.root}`);
  console.log(`   laborAPI VT:        ${jsonTally.laborApi}`);
  console.log(`   dataLastUpdated v2: ${jsonTally.dluV2}`);
  console.log(`   source badges:      ${jsonTally.badges}`);
  console.log(`   null placeholders left (harmless): ${jsonTally.nullLeft}`);
  if (jsonTally.reformatted) console.log(`   ⚠ reformatted (non-canonical style): ${jsonTally.reformatted}`);
  if (jsonTally.parseErrors.length) console.log(`   ⚠ parse errors: ${jsonTally.parseErrors.length} (${jsonTally.parseErrors.slice(0,5).join(", ")}…)`);

  let jsRes = { skipped: "--no-companies-js" };
  if (!NO_COMPANIES_JS) {
    jsRes = await stripCompaniesJsBundle();
    console.log("\n── src/companies.js (fallback bundle) ──");
    if (jsRes.skipped) console.log(`   skipped: ${jsRes.skipped}`);
    else {
      console.log(`   entries: ${jsRes.before} → ${jsRes.after}  (must match)`);
      console.log(`   root VT: ${jsRes.root}  laborAPI VT: ${jsRes.laborApi}  badges: ${jsRes.badges}`);
      console.log(`   VT objects remaining in output: ${jsRes.vtRemaining}  safe: ${jsRes.safe}  ${jsRes.wrote ? "WROTE" : "(not written)"}`);
      if (!jsRes.safe) console.log(`   ⛔ safety gate FAILED — companies.js NOT written. Investigate before applying.`);
    }
  } else {
    console.log("\n── src/companies.js — skipped (--no-companies-js) ──");
  }

  let artRes = { removed: [], missing: [] };
  if (!NO_ARTIFACTS) {
    artRes = await stripArtifacts();
    console.log("\n── artifacts ──");
    console.log(`   ${APPLY ? "removed" : "would remove"}: ${artRes.removed.join(", ") || "(none present)"}`);
    if (artRes.missing.length) console.log(`   absent (ok): ${artRes.missing.join(", ")}`);
  }

  console.log(`\n${APPLY ? "✅ APPLIED." : "ℹ️  DRY RUN complete — re-run with --apply to write."}`);
  if (APPLY && !DIR_OVERRIDE) {
    console.log("\nNext (finalize + verify — grades MUST NOT move):");
    console.log("   node scripts/rebuild-bundle-index.mjs");
    console.log("   node --test scripts/scoring-engine.test.mjs");
    console.log("   node scripts/audit-grade-drift.mjs   # expect ZERO drift\n");
  }
}

main().catch(err => { console.error("❌ vt-strip-gjf failed:", err); process.exit(1); });
