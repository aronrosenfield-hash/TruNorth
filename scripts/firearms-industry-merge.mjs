#!/usr/bin/env node
/**
 * Firearms-industry corporate signals — Step 2: per-slug augment writer.
 *
 * Reads the most-recent snapshot under data/raw/firearms-industry/
 * (or --input=PATH), validates each entry's slug against
 * public/data/companies/<slug>.json (NEVER writes to a company file from
 * here — that's downstream), and emits a single augment:
 *
 *   data/derived/firearms-industry-augment.json
 *     {
 *       _license: "Public records...",
 *       _generated_at: "ISO",
 *       _source_file: "data/raw/firearms-industry/<date>.json",
 *       _stats: { matched, orphans, ... },
 *       companies: {
 *         "<slug>": {
 *           guns: {
 *             industryMember: bool,
 *             organizations: ["NSSF", ...],
 *             pacContributionsUsd: number,
 *             retailsFirearms: bool,
 *             manufacturesFirearms: bool,
 *             sourceUrls: ["https://...", ...],
 *             // notes + historicalOnly carried through for downstream
 *             // narrative authoring; not part of the strict schema.
 *             notes: "...",
 *             historicalOnly: bool
 *           }
 *         }
 *       },
 *       orphans: [{slug, name, reason}, ...]   // seed slugs with no company file
 *     }
 *
 * The augment is consumed by the company-build pipeline (separate PR) and
 * is intentionally NOT merged into per-company JSON by this script — this
 * keeps the data flow audit-friendly and avoids overlapping with
 * atf-merge.mjs which writes the FFL block.
 *
 * Usage
 * -----
 *   node scripts/firearms-industry-merge.mjs                  # latest raw
 *   node scripts/firearms-industry-merge.mjs --input=PATH     # specific raw
 *   node scripts/firearms-industry-merge.mjs --out=PATH       # custom output
 *   node scripts/firearms-industry-merge.mjs --dry            # no file writes
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/firearms-industry");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const OUT_FILE = path.join(DERIVED_DIR, "firearms-industry-augment.json");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const INPUT_OVERRIDE = argv
  .find((a) => a.startsWith("--input="))?.slice("--input=".length);
const OUT_OVERRIDE = argv
  .find((a) => a.startsWith("--out="))?.slice("--out=".length);

/** Resolve the newest YYYY-MM-DD.json under RAW_DIR. */
export async function findLatestRaw(rawDir = RAW_DIR) {
  if (!existsSync(rawDir)) return null;
  const files = (await fs.readdir(rawDir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(rawDir, files[files.length - 1]) : null;
}

/**
 * Build the augment object from a parsed raw snapshot.
 * Pure — no fs. Lets the test exercise it without a fixture file.
 *
 *   raw: parsed contents of data/raw/firearms-industry/<date>.json
 *   companySlugs: Set<string> of valid catalog slugs to gate against.
 *                 Passing null disables gating (every seed entry is
 *                 emitted; used by --dry runs without a catalog).
 */
export function buildAugment(raw, companySlugs, opts = {}) {
  const seed = Array.isArray(raw?.seed_entries) ? raw.seed_entries : [];
  const companies = {};
  const orphans = [];
  let totalSourceUrls = 0;

  for (const e of seed) {
    if (companySlugs && !companySlugs.has(e.slug)) {
      orphans.push({
        slug: e.slug,
        name: e.name,
        reason: "no_company_file",
      });
      continue;
    }
    const block = {
      industryMember: !!e.industryMember,
      organizations: Array.isArray(e.organizations) ? [...e.organizations].sort() : [],
      pacContributionsUsd: Number(e.pacContributionsUsd || 0),
      retailsFirearms: !!e.retailsFirearms,
      manufacturesFirearms: !!e.manufacturesFirearms,
      sourceUrls: Array.isArray(e.sourceUrls)
        ? Array.from(new Set(e.sourceUrls.filter(Boolean)))
        : [],
    };
    if (e.notes) block.notes = String(e.notes);
    if (e.historicalOnly) block.historicalOnly = true;
    totalSourceUrls += block.sourceUrls.length;
    companies[e.slug] = { guns: block };
  }

  const matchedSlugs = Object.keys(companies);
  const matchedManufacturers = matchedSlugs.filter(
    (s) => companies[s].guns.manufacturesFirearms,
  ).length;
  const matchedRetailers = matchedSlugs.filter(
    (s) => companies[s].guns.retailsFirearms,
  ).length;
  const matchedIndustryMembers = matchedSlugs.filter(
    (s) => companies[s].guns.industryMember,
  ).length;

  return {
    _license: raw?._license
      || "Public records: NSSF/NRA membership directories, ATF FFL list, FEC.gov disclosures.",
    _generated_at: new Date().toISOString(),
    _source_file: opts.sourceFile || null,
    _stats: {
      raw_entries:         seed.length,
      matched_companies:   matchedSlugs.length,
      orphan_entries:      orphans.length,
      industry_members:    matchedIndustryMembers,
      manufacturers:       matchedManufacturers,
      retailers:           matchedRetailers,
      avg_source_urls:     matchedSlugs.length
        ? Number((totalSourceUrls / matchedSlugs.length).toFixed(2))
        : 0,
    },
    companies,
    orphans,
  };
}

/**
 * Load the set of valid company slugs from public/data/companies/.
 * Returns null when the directory doesn't exist (smoke / sandbox use).
 */
async function loadCompanySlugs(compDir = COMP_DIR) {
  if (!existsSync(compDir)) return null;
  const files = await fs.readdir(compDir);
  return new Set(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, "")),
  );
}

async function main() {
  console.log(`firearms-industry-merge: ${DRY ? "dry-run (no writes)" : "writing augment"}`);

  const inputPath = INPUT_OVERRIDE
    ? path.resolve(ROOT, INPUT_OVERRIDE)
    : await findLatestRaw();
  if (!inputPath || !existsSync(inputPath)) {
    console.error(
      "No raw snapshot found. Run scripts/firearms-industry-fetch.mjs first, " +
      "or pass --input=PATH.",
    );
    process.exit(2);
  }
  console.log(`  Reading ${path.relative(ROOT, inputPath)}`);
  const raw = JSON.parse(await fs.readFile(inputPath, "utf-8"));

  const slugs = await loadCompanySlugs();
  console.log(
    `  Loaded ${slugs ? slugs.size : "(no)"} TruNorth company slugs from catalog`,
  );

  const augment = buildAugment(raw, slugs, {
    sourceFile: path.relative(ROOT, inputPath),
  });

  console.log(`  Stats: ${JSON.stringify(augment._stats)}`);
  if (augment.orphans.length > 0) {
    console.log(`  ${augment.orphans.length} seed entries have no companion company file:`);
    for (const o of augment.orphans.slice(0, 10)) {
      console.log(`    - ${o.slug} (${o.name})`);
    }
    if (augment.orphans.length > 10) {
      console.log(`    … and ${augment.orphans.length - 10} more`);
    }
  }

  if (DRY) {
    console.log("  (--dry: nothing written)");
    return;
  }

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outPath = OUT_OVERRIDE ? path.resolve(ROOT, OUT_OVERRIDE) : OUT_FILE;
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`  Wrote ${path.relative(ROOT, outPath)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("firearms-industry-merge failed:", err);
    process.exit(1);
  });
}
