#!/usr/bin/env node
/**
 * Employee Ratings — Step 2: Merge the raw fetcher snapshot into a
 * slug-keyed augment file consumed by the labor scoring path.
 *
 * Reads /data/raw/employee-ratings/<latest>.json (produced by
 * employee-ratings-fetch.mjs) and produces:
 *   /data/derived/employee-ratings-augment.json
 *
 * Output shape:
 *   {
 *     generated_at,
 *     source_summary: { glassdoor, indeed, ambitionbox, wikidata_only },
 *     by_slug: {
 *       <slug>: {
 *         labor: {
 *           glassdoorRating,        // 0-5 or null
 *           indeedRating,           // 0-5 or null
 *           ceoApproval,            // 0-100 or null
 *           recommendToFriend,      // 0-100 or null
 *           reviewCountGlassdoor,
 *           reviewCountIndeed,
 *           source,                 // "glassdoor" | "indeed" | "ambitionbox"
 *                                   // | "wikidata-only"
 *           year,
 *           sourceUrls: { glassdoor, indeed, ambitionbox }
 *         }
 *       }
 *     }
 *   }
 *
 * Slug-match policy:
 *   - The fetcher already restricts candidates to slugs whose company
 *     file exists, so the merger trusts those slugs directly.
 *   - Records with primary_signal === "wikidata-only" AND no scraped
 *     rating still ship — they at least confirm "company has a public
 *     Glassdoor/Indeed page, but we don't yet know the rating." That
 *     fills the labor cell with a low-confidence signal which is better
 *     than the current 11.4% coverage rate.
 *
 * Flags:
 *   --dry   (default) — log shape + counts, write to /tmp.
 *   --apply — write data/derived/employee-ratings-augment.json.
 *   --raw <path> — override the input file (default: latest in
 *                  data/raw/employee-ratings/).
 *
 * Locally:
 *   node scripts/employee-ratings-merge.mjs              # dry by default
 *   node scripts/employee-ratings-merge.mjs --apply      # write augment
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/employee-ratings");
const OUT_FILE = path.join(ROOT, "data/derived/employee-ratings-augment.json");

const argv  = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const DRY   = !APPLY;
const RAW_OVERRIDE = (() => {
  const i = process.argv.indexOf("--raw");
  return i >= 0 ? process.argv[i + 1] : null;
})();

async function findLatestRaw() {
  if (RAW_OVERRIDE) return RAW_OVERRIDE;
  if (!existsSync(RAW_DIR)) {
    throw new Error(`No raw dir: ${RAW_DIR}. Run employee-ratings-fetch.mjs first.`);
  }
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No raw snapshots in ${RAW_DIR}.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function buildLaborBlock(rec) {
  // Per-source pulls; nulls everywhere are acceptable.
  const gd  = rec.glassdoor   || {};
  const ind = rec.indeed      || {};
  const ab  = rec.ambitionbox || {};
  // Prefer Glassdoor's review_count for the canonical count; fall back
  // to AmbitionBox if neither GD nor Indeed produced.
  return {
    glassdoorRating:       gd.status === "ok" ? gd.rating : null,
    indeedRating:          ind.status === "ok" ? ind.rating : null,
    ambitionboxRating:     ab.status === "ok" ? ab.rating : null,
    ceoApproval:           gd.status === "ok" ? gd.ceo_approval_pct : null,
    recommendToFriend:     gd.status === "ok" ? gd.recommend_to_friend_pct : null,
    reviewCountGlassdoor:  gd.status === "ok" ? gd.review_count : null,
    reviewCountIndeed:     ind.status === "ok" ? ind.review_count : null,
    source:                rec.primary_signal,
    year:                  gd.year || ind.year || ab.year || new Date().getUTCFullYear(),
    sourceUrls: {
      glassdoor:   gd.url || null,
      indeed:      ind.url || null,
      ambitionbox: ab.url || null,
    },
    // Public-page existence flag — even if the scrape is blocked, this
    // is true whenever Wikidata has a Glassdoor/Indeed property for the
    // company, which is itself a labor-signal positive (companies with
    // 250+ reviews tend to have public landing pages).
    hasPublicPage: !!(rec.wikidata?.glassdoor_id || rec.wikidata?.indeed_id),
    qid: rec.qid || null,
  };
}

export function buildAugment(raw) {
  const byslug = {};
  const records = raw.records || [];
  for (const rec of records) {
    if (!rec.slug) continue;
    byslug[rec.slug] = { labor: buildLaborBlock(rec) };
  }
  return {
    generated_at:   new Date().toISOString(),
    source_raw:     raw.generated_at,
    mode:           raw.mode,
    live_scrape:    raw.live_scrape,
    source_summary: {
      glassdoor:     raw.ok_glassdoor || 0,
      indeed:        raw.ok_indeed || 0,
      ambitionbox:   raw.ok_ambitionbox || 0,
      wikidata_only: raw.wikidata_only || 0,
    },
    by_slug: byslug,
  };
}

async function main() {
  console.log(`Employee ratings merge starting... (mode=${DRY ? "DRY" : "APPLY"})`);
  const rawPath = await findLatestRaw();
  console.log(`  raw input: ${rawPath}`);

  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const augment = buildAugment(raw);
  const slugCount = Object.keys(augment.by_slug).length;
  console.log(`  produced ${slugCount} slug records`);
  console.log(`  source mix: glassdoor=${augment.source_summary.glassdoor} indeed=${augment.source_summary.indeed} ambitionbox=${augment.source_summary.ambitionbox} wikidata_only=${augment.source_summary.wikidata_only}`);

  if (APPLY) {
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(augment, null, 2));
    console.log(`Wrote ${OUT_FILE}`);
  } else {
    const tmp = path.join(ROOT, ".tmp-employee-ratings-augment.json");
    await fs.writeFile(tmp, JSON.stringify(augment, null, 2));
    console.log(`DRY — preview written to ${tmp}. Re-run with --apply to publish.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("employee-ratings-merge failed:", err);
    process.exit(1);
  });
}
