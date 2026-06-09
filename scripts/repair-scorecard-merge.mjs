#!/usr/bin/env node
/**
 * Repair-scorecard — merge step.
 *
 * Reads latest data/raw/repair-scorecard/<date>.json and writes
 * data/derived/repair-scorecard-augment.json keyed by TruNorth slug.
 *
 * Routing ladder: slugHint → direct slug → alias → parent → orphan.
 *
 * Consumed by scripts/apply-augments-to-companies.mjs via the
 * `repair-scorecard` writer registered there. Writer category: `environment`
 * (electronics longevity = e-waste reduction).
 *
 * Locally:
 *   node scripts/repair-scorecard-merge.mjs
 *   node scripts/repair-scorecard-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/repair-scorecard");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "repair-scorecard-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

/* -------------------------------- helpers ------------------------------- */

export function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  const [aliases, parents] = await Promise.all([
    tryReadJson(path.join(META_DIR, "slug-aliases.json")),
    tryReadJson(path.join(META_DIR, "brand-parent-map.json")),
  ]);
  return { aliases: aliases || {}, parents: parents || {} };
}

async function loadKnownSlugs() {
  const idx = await tryReadJson(INDEX_FILE);
  if (!Array.isArray(idx)) return new Set();
  return new Set(idx.map(r => r.slug));
}

async function latestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

export function resolveBrand(entry, { knownSlugs, aliases, parents }) {
  if (entry.slugHint && knownSlugs.has(entry.slugHint)) {
    return { slug: entry.slugHint, routedVia: "slugHint" };
  }
  const raw = slugify(entry.name);
  if (raw && knownSlugs.has(raw)) return { slug: raw, routedVia: "direct" };
  if (raw && aliases[raw] && knownSlugs.has(aliases[raw])) {
    return { slug: aliases[raw], routedVia: "alias" };
  }
  if (raw && parents[raw]?.parent && knownSlugs.has(parents[raw].parent)) {
    return { slug: parents[raw].parent, routedVia: "parent" };
  }
  if (entry.slugHint) {
    const h = entry.slugHint;
    if (aliases[h] && knownSlugs.has(aliases[h])) {
      return { slug: aliases[h], routedVia: "slugHint-alias" };
    }
    if (parents[h]?.parent && knownSlugs.has(parents[h].parent)) {
      return { slug: parents[h].parent, routedVia: "slugHint-parent" };
    }
  }
  return { slug: null, routedVia: "orphan" };
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log("repair-scorecard merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run repair-scorecard-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = {
    slugHint: 0, direct: 0, alias: 0, parent: 0,
    "slugHint-alias": 0, "slugHint-parent": 0, orphan: 0,
  };

  for (const b of raw.brands || []) {
    const { slug, routedVia } = resolveBrand(b, { knownSlugs, ...maps });
    routeCounts[routedVia] = (routeCounts[routedVia] || 0) + 1;
    if (!slug) {
      orphans.push({ name: b.name, slugHint: b.slugHint, pirg: b.pirg_grade, ifixit: b.ifixit_avg });
      continue;
    }
    // Two PIRG brands can route to the same slug (Motorola + Lenovo both →
    // lenovo). Combine narratives + keep the worst severity.
    const existing = companies[slug];
    if (existing) {
      // Merge narratives, keep worst severity. Order: negative > mixed > positive.
      const sevOrder = { negative: 0, mixed: 1, positive: 2 };
      const keepWorst = sevOrder[existing.severity] <= sevOrder[b.severity] ? existing.severity : b.severity;
      companies[slug] = {
        ...existing,
        severity: keepWorst,
        narrative: `${existing.narrative} ${b.narrative}`.replace(/\.\s+/g, ". ").trim(),
        contributing_brands: Array.from(new Set([...(existing.contributing_brands || [existing.name]), b.name])),
        // Keep the worst PIRG grade across contributing brands.
        pirg_grade: (
          (existing.pirg_grade_value == null) ? b.pirg_grade :
          (b.pirg_grade_value == null) ? existing.pirg_grade :
          (b.pirg_grade_value < existing.pirg_grade_value ? b.pirg_grade : existing.pirg_grade)
        ),
        pirg_grade_value: Math.min(
          existing.pirg_grade_value ?? 4,
          b.pirg_grade_value ?? 4,
        ),
        ifixit_avg: existing.ifixit_avg ?? b.ifixit_avg,
      };
      continue;
    }
    companies[slug] = {
      _sources: ["repair-scorecard"],
      _routedVia: routedVia,
      _lastUpdated: now.toISOString(),
      name: b.name,
      category: b.category,
      pirg_grade: b.pirg_grade,
      pirg_grade_value: b.pirg_grade_value,
      pirg_year: b.pirg_year,
      ifixit_avg: b.ifixit_avg,
      ifixit_recent: b.ifixit_recent,
      severity: b.severity,
      narrative: b.narrative,
      sources: b.sources,
    };
  }

  const payload = {
    _license: raw._license,
    _source_file: path.relative(ROOT, rawFile),
    _source_urls: raw._source_urls,
    _generated_at: now.toISOString(),
    _stats: {
      brands: (raw.brands || []).length,
      matched_companies: Object.keys(companies).length,
      orphans: routeCounts.orphan,
      route_counts: routeCounts,
    },
    companies,
    orphans,
  };

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  console.log(`\nBrands:             ${payload._stats.brands}`);
  console.log(`Matched companies:  ${payload._stats.matched_companies}`);
  for (const k of Object.keys(routeCounts)) {
    if (routeCounts[k]) console.log(`  ${k.padEnd(18)} ${routeCounts[k]}`);
  }
  console.log(`Orphans:            ${routeCounts.orphan}`);
  if (orphans.length) {
    console.log("Orphan list:");
    for (const o of orphans) console.log(`  - ${o.name} (hint=${o.slugHint || "-"}, pirg=${o.pirg || "-"}, ifixit=${o.ifixit ?? "-"})`);
  }
  console.log(`\nWrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("repair-scorecard-merge failed:", err);
    process.exit(1);
  });
}
