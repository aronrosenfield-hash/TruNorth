#!/usr/bin/env node
/**
 * IIHS TSP / TSP+ merger.
 *
 * Reads the most-recent file in data/raw/iihs-tsp/ (or --in override) and
 * produces data/derived/iihs-tsp-augment.json keyed by TruNorth brand slug.
 *
 * Each TSP entry's `makeSlug` (e.g. "honda", "mercedes-benz") maps to one
 * automaker. We aggregate per slug:
 *   - iihsTspCount     — # distinct (model, year) entries awarded plain TSP
 *   - iihsTspPlusCount — # distinct (model, year) entries awarded TSP+
 *   - years            — sorted list of award years the make appeared in
 *   - sourceUrl        — IIHS top-safety-picks page (current-year landing)
 *
 * Slug resolution: IIHS makeSlug → TruNorth slug
 *   1. Direct match against public/data/index.json.
 *   2. Try common automotive-brand suffixes (-usa, -motors, -motor) — many
 *      TruNorth automaker entries are the US subsidiary entity, e.g.
 *      "toyota-usa", "honda-usa", "bmw-usa".
 *   3. Hand-curated IIHS_BRAND_ALIASES (Cadillac is in TruNorth under the
 *      brand-only "cadillac" but Ram, Volvo, Mazda, Nissan etc. are not in
 *      the index — those become orphans).
 *   4. brand-parent-map.json fallback.
 *
 * Output shape:
 *   {
 *     _license: "Public IIHS award list — attributed per record",
 *     _generated_at: "...",
 *     _source_raw_file: "data/raw/iihs-tsp/<date>.json",
 *     _source_url: "https://www.iihs.org/ratings/top-safety-picks",
 *     _matched_slugs: N,
 *     _orphan_makes: [{makeSlug, totalAwards, tspPlus, tsp}],
 *     _routing_counts: {...},
 *     bySlug: {
 *       "<slug>": {
 *         safety: {
 *           iihsTspCount: N,
 *           iihsTspPlusCount: N,
 *           years: [2020, 2021, ...],
 *           sourceUrl: "https://www.iihs.org/ratings/top-safety-picks/2026",
 *         }
 *       }
 *     }
 *   }
 *
 * Locally:
 *   node scripts/iihs-tsp-merge.mjs
 *   node scripts/iihs-tsp-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/iihs-tsp");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/iihs-tsp-augment.json");

const BASE_URL = "https://www.iihs.org/ratings/top-safety-picks";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Hand-curated map from IIHS make-slug → TruNorth slug for cases where
 * direct + suffix matching don't reach the right canonical entry.
 * Keep this list intentionally short — anything not here flows through
 * the orphan list so we can audit.
 */
const IIHS_BRAND_ALIASES = {
  // GM brands: indexed by bare make in TruNorth
  "buick":      "buick",
  "cadillac":   "cadillac",
  "chevrolet":  "chevrolet",
  "gmc":        "gmc",
  // Stellantis brands: bare-make entries
  "chrysler":   "chrysler",
  "dodge":      "dodge",
  "jeep":       "jeep",
  // Ford-family
  "ford":       "ford",
  // Tesla
  "tesla":      "tesla",
  // Honda family
  "acura":      "acura-usa",
  "honda":      "honda-usa",
  // Toyota family
  "lexus":      "lexus-usa",
  "toyota":     "toyota-usa",
  // Hyundai/Kia/Genesis
  "hyundai":    "hyundai-usa",
  "kia":        "kia-usa",
  // Nissan family
  "infiniti":   "infiniti-usa",
  // VW / Audi / Porsche
  "audi":       "audi-usa",
  "porsche":    "porsche",
  "volkswagen": "volkswagen-usa",
  // BMW
  "bmw":        "bmw-usa",
  "mini":       "bmw-usa",     // Mini is a BMW Group brand
  // Mercedes-Benz
  "mercedes-benz": "mercedes-benz-usa",
  // Subaru
  "subaru":     "subaru-usa",
  // Lucid / Rivian / Polestar — direct slug if present
  "lucid":      "lucid-motors",
  "rivian":     "rivian-automotive",
};

/**
 * Resolve an IIHS make-slug to a TruNorth brand slug.
 * Returns { slug, routedVia } or { slug: null, routedVia: "orphan" }.
 */
export function resolveMakeSlug(makeSlug, indexSlugs, parentMap) {
  if (!makeSlug) return { slug: null, routedVia: "orphan" };
  const lower = String(makeSlug).toLowerCase();

  // 1. Hand-curated alias (highest priority — fixes the Honda → honda-usa
  //    style cases that would otherwise direct-match the bare slug).
  const aliased = IIHS_BRAND_ALIASES[lower];
  if (aliased && indexSlugs.has(aliased)) {
    return { slug: aliased, routedVia: "alias" };
  }

  // 2. Direct match
  if (indexSlugs.has(lower)) {
    return { slug: lower, routedVia: "direct" };
  }

  // 3. Common automotive suffixes
  for (const suffix of ["-usa", "-motors", "-motor", "-automotive"]) {
    const candidate = `${lower}${suffix}`;
    if (indexSlugs.has(candidate)) return { slug: candidate, routedVia: `suffix:${suffix}` };
  }

  // 4. brand-parent-map fallback
  const pm = parentMap[lower];
  if (pm?.parent && indexSlugs.has(pm.parent)) {
    return { slug: pm.parent, routedVia: "brand-parent" };
  }

  return { slug: null, routedVia: "orphan" };
}

// ─── load ─────────────────────────────────────────────────────────────────

async function loadIndexSlugs() {
  const text = await fs.readFile(INDEX_FILE, "utf-8");
  const arr = JSON.parse(text);
  return new Set(arr.map(c => c.slug));
}

async function loadParentMap() {
  try {
    const text = await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8");
    const obj = JSON.parse(text);
    const { _doc, ...rest } = obj;
    return rest;
  } catch {
    return {};
  }
}

async function pickLatestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}; run iihs-tsp-fetch.mjs first.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("IIHS Top Safety Pick / TSP+ merger");

  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const entries = raw.entries || [];
  console.log(`  ${entries.length} raw award entries across years ${(raw._years || []).join(", ")}`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap = await loadParentMap();
  console.log(`  Loaded ${indexSlugs.size} index slugs + ${Object.keys(parentMap).length} brand-parent entries`);

  // Per-slug accumulator. Dedupe entries by (vehicleSlug + award) — the
  // same (model, year) shouldn't be counted twice if IIHS lists it under
  // multiple years (rare but possible at carryover boundaries).
  const bySlug = new Map(); // slug -> { tsp: Set<key>, tspPlus: Set<key>, years: Set<Y> }
  const orphanCounts = new Map(); // makeSlug -> { makeSlug, totalAwards, tsp, tspPlus }
  const routedViaCounts = { alias: 0, direct: 0, "suffix:-usa": 0, "suffix:-motors": 0, "suffix:-motor": 0, "suffix:-automotive": 0, "brand-parent": 0, orphan: 0 };

  // Use the most-recent year in the dataset as the canonical sourceUrl
  // (links to the landing page of the latest awards).
  const latestYear = (raw._years || []).slice().sort().pop() || new Date().getUTCFullYear();
  const canonicalSourceUrl = `${BASE_URL}/${latestYear}`;

  for (const e of entries) {
    const { slug, routedVia } = resolveMakeSlug(e.makeSlug, indexSlugs, parentMap);
    routedViaCounts[routedVia] = (routedViaCounts[routedVia] || 0) + 1;

    if (!slug) {
      const existing = orphanCounts.get(e.makeSlug) || { makeSlug: e.makeSlug, totalAwards: 0, tsp: 0, tspPlus: 0 };
      existing.totalAwards++;
      if (e.award === "TSP+") existing.tspPlus++;
      else existing.tsp++;
      orphanCounts.set(e.makeSlug, existing);
      continue;
    }

    let entry = bySlug.get(slug);
    if (!entry) {
      entry = { tsp: new Set(), tspPlus: new Set(), years: new Set() };
      bySlug.set(slug, entry);
    }
    const key = `${e.vehicleSlug}|${e.awardYear}`;
    if (e.award === "TSP+") entry.tspPlus.add(key);
    else entry.tsp.add(key);
    entry.years.add(e.awardYear);
  }

  // Build output
  const output = {
    _license: "Public IIHS award list — attributed per record",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: BASE_URL,
    _matched_slugs: bySlug.size,
    _orphan_makes: [...orphanCounts.values()].sort((a, b) => b.totalAwards - a.totalAwards),
    _routing_counts: routedViaCounts,
    bySlug: {},
  };
  for (const [slug, entry] of bySlug.entries()) {
    output.bySlug[slug] = {
      safety: {
        iihsTspCount:     entry.tsp.size,
        iihsTspPlusCount: entry.tspPlus.size,
        years:            [...entry.years].sort(),
        sourceUrl:        canonicalSourceUrl,
      },
    };
  }

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs:  ${bySlug.size}`);
  console.log(`  Routing:        ${Object.entries(routedViaCounts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  Orphan makes:   ${orphanCounts.size}${orphanCounts.size > 0 ? " (" + [...orphanCounts.keys()].join(", ") + ")" : ""}`);

  // Top 5 brands by TSP+ count
  const rank = [...bySlug.entries()]
    .map(([slug, e]) => ({ slug, tsp: e.tsp.size, tspPlus: e.tspPlus.size }))
    .sort((a, b) => b.tspPlus - a.tspPlus || b.tsp - a.tsp);
  if (rank.length > 0) {
    console.log(`\nTop 5 brands by TSP+ count:`);
    for (const r of rank.slice(0, 5)) {
      console.log(`  ${String(r.tspPlus).padStart(4)} TSP+  ${String(r.tsp).padStart(3)} TSP   ${r.slug}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("iihs-tsp-merge failed:", err);
    process.exit(1);
  });
}
