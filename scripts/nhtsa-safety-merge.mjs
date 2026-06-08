#!/usr/bin/env node
/**
 * NHTSA 5-Star Safety — Merge raw snapshot into a per-slug augment file
 * that feeds the Automotive category. Reads the latest snapshot under
 * data/raw/nhtsa-safety/, routes each NHTSA `Make` (e.g. "TOYOTA",
 * "MERCEDES-BENZ") to the canonical TruNorth automaker parent slug
 * (e.g. "toyota-usa", "mercedes-benz-usa"), and writes:
 *
 *   data/derived/nhtsa-safety-augment.json
 *
 * Output shape (keyed by slug):
 *   {
 *     source: "nhtsa-safety",
 *     source_url, generated_at, snapshot_date,
 *     matched_slug_count, total_makes,
 *     companies: {
 *       "toyota-usa": {
 *         safety: {
 *           avgOverallStars: 4.78,
 *           vehicleCount: 142,
 *           top5StarModels:   [{ year, model, overallStars }],
 *           bottom2StarModels:[{ year, model, overallStars, rolloverStars }],
 *           year: { start: 2018, end: 2026 },
 *           sourceUrls: ["https://www.nhtsa.gov/ratings"]
 *         }
 *       },
 *       ...
 *     }
 *   }
 *
 * Routing strategy:
 *   1. Hand-curated NHTSA_MAKE_TO_SLUG below (the source of truth for
 *      automaker routing — same pattern as the firearms-industry merger).
 *   2. Verified at runtime against an alias index built from every
 *      slug in public/data/index.json so a typo here surfaces loudly.
 *   3. Anything still unmatched is logged as an orphan with its vehicle
 *      count — useful for adding new pipelines (Polestar, Lucid, etc.).
 *
 * Flags:
 *   --raw PATH   override input snapshot
 *   --out PATH   override output augment path
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/nhtsa-safety");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE = path.join(ROOT, "data/derived/nhtsa-safety-augment.json");

export const SOURCE_URL = "https://www.nhtsa.gov/ratings";

/**
 * NHTSA Make (UPPERCASE, as returned by the API) -> TruNorth canonical slug.
 *
 * Where multiple US-facing subsidiaries exist in index.json (e.g.
 * "toyota-usa" for the US sales arm, "toyota-motor-manufacturing-kentucky"
 * for a plant), we route to the US sales/parent arm because that's what
 * a US consumer is buying.
 *
 * Slugs are validated at runtime — adding an entry here that doesn't
 * exist in index.json prints a loud WARN but the merge still completes.
 */
export const NHTSA_MAKE_TO_SLUG = {
  "ACURA":            "acura-usa",
  "ALFA":             "stellantis",       // Alfa Romeo — no own slug; rolls to Stellantis
  "ALFA ROMEO":       "stellantis",
  "AUDI":             "audi-usa",
  "BENTLEY":          "bentley",
  "BMW":              "bmw-usa",
  "BRIGHTDROP":       "brightdrop",       // GM commercial EV brand
  "BUICK":            "buick",
  "CADILLAC":         "cadillac",
  "CHEVROLET":        "chevrolet",
  "CHRYSLER":         "chrysler",
  "DODGE":            "dodge",
  "FIAT":             "stellantis",       // Fiat — no own slug; rolls to Stellantis
  "FORD":             "ford-motor",
  "GENESIS":          "hyundai-usa",      // Genesis is Hyundai's premium brand
  "GMC":              "gmc",
  "HONDA":            "honda-motor-co",
  "HYUNDAI":          "hyundai-usa",
  "INFINITI":         "infiniti-usa",
  // JAGUAR / LAND ROVER / MAZDA / VOLVO / POLESTAR — no TruNorth parent
  // slug yet; they fall through to the orphan log so they're visible
  // for whoever adds these companies to the index next.
  "JEEP":             "jeep",
  "KIA":              "kia-usa",
  "LEXUS":            "lexus-usa",
  "LINCOLN":          "lincoln-motor-company",
  "LUCID":            "lucid-motors",
  "MASERATI":         "stellantis",       // Maserati — Stellantis subsidiary
  "MERCEDES-BENZ":    "mercedes-benz-usa",
  "MERCURY":          "ford-motor",       // discontinued Ford brand
  "MINI":             "bmw-usa",          // MINI is BMW Group
  "MITSUBISHI":       "mitsubishi-motors-north-america",
  "NISSAN":           "nissan-technical-center-north-america",
  "PORSCHE":          "porsche",
  "RAM":              "ram-stellantis",
  "RIVIAN":           "rivian-automotive",
  "ROLLS-ROYCE":      "rolls-royce",
  "SCION":            "toyota-usa",       // discontinued Toyota brand
  "SMART":            "mercedes-benz-usa",
  "SUBARU":           "subaru-usa",
  "TESLA":            "tesla",
  "TOYOTA":           "toyota-usa",
  "VOLKSWAGEN":       "volkswagen-usa",
};

function parseArgs(argv) {
  const out = { rawPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") out.rawPath = argv[++i];
    else if (argv[i] === "--out") out.outPath = argv[++i];
  }
  return out;
}

async function loadLatestRaw() {
  try {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadIndexSlugs() {
  if (!existsSync(INDEX_FILE)) return new Set();
  const arr = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  return new Set(arr.map(c => c.slug));
}

/**
 * Aggregate a per-make rollup into the public-facing `safety` block.
 * Picks up to 5 distinct (year, model) entries for top/bottom lists.
 */
export function buildSafetyBlock(rollup, yearRange) {
  // Flatten all (year, model, variant) into a list, then dedupe per
  // (year, model) by best variant for top, worst for bottom.
  const flat = [];
  for (const m of rollup.models) {
    for (const v of m.variants) {
      if (v.overallStars === null) continue;
      flat.push({
        year: m.year,
        model: m.model,
        overallStars: v.overallStars,
        rolloverStars: v.rolloverStars,
        description: v.description,
      });
    }
  }
  const byKey = new Map();
  for (const r of flat) {
    const key = `${r.year}|${r.model}`;
    const prev = byKey.get(key);
    if (!prev || r.overallStars > prev.overallStars) byKey.set(key, r);
  }
  const dedupedTop = [...byKey.values()];
  const top5 = dedupedTop
    .filter(r => r.overallStars === 5)
    .sort((a, b) => (b.year - a.year) || a.model.localeCompare(b.model))
    .slice(0, 5)
    .map(r => ({ year: r.year, model: r.model, overallStars: r.overallStars }));

  // For "bottom 2-star": treat <=3 stars as concerning. Pick the worst
  // 5 by overallStars asc, rollover asc as tiebreak.
  const byKeyWorst = new Map();
  for (const r of flat) {
    const key = `${r.year}|${r.model}`;
    const prev = byKeyWorst.get(key);
    if (!prev || r.overallStars < prev.overallStars) byKeyWorst.set(key, r);
  }
  const bottom = [...byKeyWorst.values()]
    .filter(r => r.overallStars <= 3)
    .sort((a, b) => (a.overallStars - b.overallStars) || ((a.rolloverStars ?? 5) - (b.rolloverStars ?? 5)) || (b.year - a.year))
    .slice(0, 5)
    .map(r => ({ year: r.year, model: r.model, overallStars: r.overallStars, rolloverStars: r.rolloverStars }));

  return {
    avgOverallStars: rollup.avg_overall_stars,
    vehicleCount: rollup.vehicle_count,
    ratedVehicleCount: rollup.rated_vehicle_count,
    modelCount: rollup.model_count,
    top5StarModels: top5,
    bottom2StarModels: bottom,
    year: { start: yearRange.start, end: yearRange.end },
    sourceUrls: [SOURCE_URL],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot under ${RAW_DIR}. Run scripts/nhtsa-safety-fetch.mjs first.`);
    process.exit(2);
  }
  console.log(`NHTSA Safety merge starting... raw=${path.relative(ROOT, rawPath)}`);

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const indexSlugs = await loadIndexSlugs();

  // Sanity-check the routing table against the real index.
  const missingSlugs = Object.entries(NHTSA_MAKE_TO_SLUG)
    .filter(([, slug]) => indexSlugs.size > 0 && !indexSlugs.has(slug));
  if (missingSlugs.length > 0) {
    console.warn(`  WARN: ${missingSlugs.length} mapped slugs not found in index.json:`);
    for (const [make, slug] of missingSlugs) console.warn(`    ${make.padEnd(18)} -> ${slug}  (missing)`);
  }

  const companies = {};
  const orphans = [];
  for (const [make, rollup] of Object.entries(snap.makes || {})) {
    const slug = NHTSA_MAKE_TO_SLUG[make];
    if (!slug) {
      orphans.push({ make, vehicle_count: rollup.vehicle_count, avg: rollup.avg_overall_stars });
      continue;
    }
    // Multiple makes can route to the same slug (rare — e.g. "ALFA" and
    // "ALFA ROMEO" both -> "alfa-romeo"). If so, MERGE rather than overwrite.
    if (companies[slug]) {
      const merged = mergeRollups(companies[slug]._rollup, rollup);
      companies[slug] = {
        safety: buildSafetyBlock(merged, snap.year_range),
        _rollup: merged,
        _makes: [...companies[slug]._makes, make],
      };
    } else {
      companies[slug] = {
        safety: buildSafetyBlock(rollup, snap.year_range),
        _rollup: rollup,
        _makes: [make],
      };
    }
  }
  // Strip internal fields and bake `nhtsaMakes` into the public block.
  for (const slug of Object.keys(companies)) {
    companies[slug].safety.nhtsaMakes = companies[slug]._makes;
    delete companies[slug]._rollup;
    delete companies[slug]._makes;
  }

  const augment = {
    source: "nhtsa-safety",
    source_url: SOURCE_URL,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    year_range: snap.year_range,
    total_makes: Object.keys(snap.makes || {}).length,
    matched_slug_count: Object.keys(companies).length,
    orphan_count: orphans.length,
    orphans,
    companies,
    license: "US Federal Government public domain (NHTSA)",
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  matched=${augment.matched_slug_count} slugs / ${augment.total_makes} makes (${orphans.length} orphans)`);

  if (Object.keys(companies).length > 0) {
    const ranked = Object.entries(companies)
      .filter(([, c]) => c.safety.avgOverallStars !== null && c.safety.vehicleCount >= 3)
      .sort((a, b) => b[1].safety.avgOverallStars - a[1].safety.avgOverallStars);
    console.log(`\n  Top 5 safest automakers by avg overall stars:`);
    for (const [slug, c] of ranked.slice(0, 5)) {
      console.log(`    ${c.safety.avgOverallStars.toFixed(2)}  ${slug.padEnd(22)} (${c.safety.vehicleCount} vehicles)`);
    }
  }
  if (orphans.length > 0) {
    console.log(`\n  Orphans (NHTSA make with no automaker slug — extend NHTSA_MAKE_TO_SLUG):`);
    for (const o of orphans.slice(0, 10)) {
      console.log(`    ${o.make.padEnd(20)} vehicles=${o.vehicle_count} avg=${o.avg ?? "—"}`);
    }
  }
}

/** Combine two per-make rollups into one. Used for the rare alias case. */
function mergeRollups(a, b) {
  const models = [...a.models, ...b.models];
  let starsSum = 0, starsCount = 0, vehicleCount = 0;
  for (const m of models) {
    for (const v of m.variants) {
      vehicleCount++;
      if (v.overallStars !== null) { starsSum += v.overallStars; starsCount++; }
    }
  }
  return {
    make: `${a.make}+${b.make}`,
    model_count: models.length,
    vehicle_count: vehicleCount,
    rated_vehicle_count: starsCount,
    avg_overall_stars: starsCount > 0 ? Number((starsSum / starsCount).toFixed(2)) : null,
    models,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("nhtsa-safety-merge failed:", err);
    process.exit(1);
  });
}
