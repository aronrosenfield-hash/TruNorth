#!/usr/bin/env node
/**
 * Violation Tracker v2 merge — reads /public/data/vt-v2.json and writes the
 * expanded fields into each matching company file.
 *
 * Target shape — additive on top of existing v1 (we KEEP totalPenalty etc.):
 *
 *   enriched.laborAPI.violationTracker = {
 *     // ── v1 (preserved) ──
 *     totalPenalty:        number,
 *     totalRecords:        number,
 *     offenseGroups:       [...],
 *     primaryOffenses:     [...],
 *     // ── v2 (new) ──
 *     violations_by_state: { CA: 50_000_000, TX: 30_000_000, ... },
 *     yoy_trend:           { 2021: ..., 2022: ..., 2023: ..., 2024: ..., 2025: ... },
 *     active_last_6mo:     boolean,
 *     recent_top5:         [{ date, agency, penalty, offense }],
 *     v2_fetched_at:       ISO timestamp,
 *   }
 *
 * Two canonical paths exist in the data for VT (historical drift):
 *   - root-level `violationTracker`        (1,721 brands)
 *   - root-level `laborAPI.violationTracker` ( 316 brands)
 *
 * This merge writes to BOTH paths when both exist on a record (so the
 * UI keeps working regardless of which it reads from), and writes
 * only to the path that's already present otherwise.
 *
 * DRY-RUN MODE (--dry-run):  PRINTS the merged shape per brand to stdout
 * but DOES NOT mutate any per-company JSON.  This is what B-30's review
 * uses to confirm UI changes look right before scheduling a real run.
 *
 * Locally:
 *   node scripts/vt-merge-v2.mjs --dry-run --smoke
 *     → reads vt-v2.json, prints what would-be-merged for 10 smoke brands.
 *   node scripts/vt-merge-v2.mjs
 *     → writes to all per-company JSONs found in vt-v2.json.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const VT_FILE   = path.join(ROOT, "public/data/vt-v2.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const LOG_FILE  = path.join(ROOT, "public/data/_meta/vt-v2-merge-log.json");

const argv     = new Set(process.argv.slice(2));
const DRY_RUN  = argv.has("--dry-run") || argv.has("--dryrun");
const SMOKE    = argv.has("--smoke");
const SMOKE_SLUGS = new Set([
  "walmart", "amazon", "mcdonald-s", "wells-fargo", "jpmorgan-chase",
  "fedex", "ups", "target", "kroger", "starbucks",
]);

function applyV2(vt, entry) {
  // Additive — preserves all v1 keys.
  return {
    ...vt,
    violations_by_state: entry.violations_by_state || {},
    yoy_trend:           entry.yoy_trend || {},
    active_last_6mo:     !!entry.active_last_6mo,
    recent_top5:         entry.recent_top5 || [],
    v2_fetched_at:       entry.fetched_at,
    v2_source:           entry.note || "violation-tracker-v2",
  };
}

async function mergeOne(entry, now) {
  // 2026-06-12 review: NEVER merge synthetic/dry-run snapshots into live
  // company files. `ok_synth` rows carry fabricated state-level penalty dollars
  // (e.g. a ~$2.3B synthetic Walmart figure) that would overwrite real
  // Violation Tracker data on the largest brands. Only genuine "ok" rows merge;
  // dry-run snapshots may still be produced for inspection, just never applied.
  if (entry.status !== "ok") {
    return { brand: entry.slug, status: "skipped", reason: entry.status };
  }
  const file = path.join(COMP_DIR, `${entry.slug}.json`);
  if (!existsSync(file)) return { brand: entry.slug, status: "missing_file" };

  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) { return { brand: entry.slug, status: "parse_error", error: e.message }; }

  const hasRoot = !!company.violationTracker;
  const hasLabor = !!company.laborAPI?.violationTracker;
  if (!hasRoot && !hasLabor) return { brand: entry.slug, status: "no_v1_block" };

  if (hasRoot) {
    company.violationTracker = applyV2(company.violationTracker, entry);
  }
  if (hasLabor) {
    company.laborAPI = company.laborAPI || {};
    company.laborAPI.violationTracker = applyV2(company.laborAPI.violationTracker, entry);
  }

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.violationTrackerV2 = now;

  if (DRY_RUN) {
    const vt = company.violationTracker || company.laborAPI.violationTracker;
    return {
      brand: entry.slug,
      status: "dry_run_preview",
      preview: {
        totalPenalty_USD: vt.totalPenalty,
        primaryOffense:   vt.primaryOffenses?.[0]?.category || null,
        offenseGroups_count: vt.offenseGroups?.length || 0,
        violations_by_state: vt.violations_by_state,
        yoy_trend:        vt.yoy_trend,
        active_last_6mo:  vt.active_last_6mo,
        recent_top5:      vt.recent_top5,
      },
    };
  }

  await fs.writeFile(file, JSON.stringify(company));
  return { brand: entry.slug, status: "merged", paths_written: [hasRoot && "root", hasLabor && "laborAPI"].filter(Boolean) };
}

async function main() {
  // ── LICENSE QUARANTINE (2026-06-27) ───────────────────────────────────────
  // Merges Good Jobs First Violation Tracker data into company files. GJF is
  // internal-use-only / bulk-paywalled / copyright-asserted and NOT cleared for
  // TruNorth's paid tier. Disabled alongside the fetcher (vt-fetch-v2.mjs) and
  // the gated-off "Federal penalties" UI (SHOW_FEDERAL_PENALTIES in App.jsx).
  // Remove this guard ONLY with explicit license clearance.
  console.error("⛔ vt-merge-v2 is DISABLED — Good Jobs First Violation Tracker is not licensed for the paid app (license review 2026-06-27). Aborting.");
  process.exit(1);
  const now = new Date().toISOString();
  console.log(`📊 VT v2 merge starting… (${DRY_RUN ? "DRY-RUN — no writes" : "WRITE"})`);

  let vt;
  try { vt = JSON.parse(await fs.readFile(VT_FILE, "utf-8")); }
  catch (e) {
    console.error(`❌ Cannot read ${VT_FILE}: ${e.message}`);
    console.error(`   Run: node scripts/vt-fetch-v2.mjs --dry-run    (to generate it)`);
    process.exit(1);
  }

  let entries = vt.entries || [];
  if (SMOKE) entries = entries.filter(e => SMOKE_SLUGS.has(e.slug));
  console.log(`   ${entries.length} entries to process`);

  const results = [];
  for (const e of entries) results.push(await mergeOne(e, now));

  if (DRY_RUN) {
    console.log("\n──────── DRY-RUN PREVIEWS ────────\n");
    for (const r of results) {
      if (r.status !== "dry_run_preview") continue;
      console.log(`### ${r.brand}`);
      console.log(JSON.stringify(r.preview, null, 2));
      console.log("");
    }
  }

  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log("\nSummary:", counts);

  if (!DRY_RUN) {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify({
      merged_at: now, source_file: "public/data/vt-v2.json",
      counts, results: results.map(r => ({ brand: r.brand, status: r.status })),
    }, null, 2));
  }
}

main().catch(err => {
  console.error("❌ vt-merge-v2 failed:", err);
  process.exit(1);
});
