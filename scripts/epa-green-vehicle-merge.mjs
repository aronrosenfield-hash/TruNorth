#!/usr/bin/env node
/**
 * EPA Green Vehicle Guide + ZEV — Step 2: per-automaker aggregation.
 *
 * Reads the latest /data/raw/epa-green-vehicle/<date>.json (produced by
 * epa-green-vehicle-fetch.mjs) and rolls up per-automaker:
 *
 *   - avgMpgE         mean combined MPGe across all variants for this brand
 *   - zevEligibleCount  number of CARB-ZEV-eligible variants (battery + FCEV)
 *   - evCount         count of pure-EV/FCEV variants
 *   - phevCount       plug-in hybrid count (TZEV — separate from ZEV)
 *   - hybridCount     conventional non-plug hybrid count
 *   - evPctOfFleet    fraction of variants that are EV+FCEV (0..1, 3 d.p.)
 *   - electrifiedPct  fraction that are EV+FCEV+PHEV+HEV
 *   - year            most-recent model year in the snapshot for this brand
 *   - sourceUrl       fueleconomy.gov landing page (stable, public)
 *
 * Output:
 *   data/derived/epa-green-vehicle-augment.json
 *
 * Per-slug shape (matches the spec):
 *   {
 *     "<slug>": {
 *       environment: {
 *         avgMpgE, zevEligibleCount, evCount, evPctOfFleet,
 *         year, sourceUrl
 *       },
 *       ...extra fields (phevCount, hybridCount, vehicleCount, makeMatched)
 *     }
 *   }
 *
 * The merger uses a curated MAKE → AUTOMAKER-SLUG map (see MAKE_TO_SLUG
 * below) because the EPA `make` field is a brand name (e.g. "Lexus") while
 * TruNorth slugs are at the parent-automaker level (e.g. "toyota-motor").
 * Anything not in the map is grouped under `_unmatched` for visibility.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/epa-green-vehicle");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const OUT_FILE = path.join(ROOT, "data/derived/epa-green-vehicle-augment.json");

const SOURCE_URL_PUBLIC = "https://www.fueleconomy.gov/feg/download.shtml";

/**
 * Map EPA upstream `make` strings (lowercased) to the matching TruNorth
 * company slug. The slugs were resolved by inspecting
 * /public/data/companies — every value below corresponds to a real file
 * that exists in the index. EV-only brands (Tesla, Rivian, Lucid,
 * Polestar) keep their own slug; conventional brands route to the
 * parent automaker where appropriate (Cadillac → general-motors etc).
 *
 * Adjusted in a single place when EPA renames a make or when we add a
 * new automaker. Brands not in this map land in `_unmatched` so the
 * pipeline never silently drops a marque.
 */
export const MAKE_TO_SLUG = {
  // ── US Big Three + their sub-brands ──
  "ford":                   "ford-motor",
  "lincoln":                "ford-motor",
  "chevrolet":              "general-motors",
  "gmc":                    "general-motors",
  "buick":                  "general-motors",
  "cadillac":               "general-motors",
  "chrysler":               "chrysler",
  "dodge":                  "dodge",
  "jeep":                   "jeep",
  "ram":                    "chrysler",
  "fiat":                   "chrysler",
  "alfa romeo":             "chrysler",
  // ── EV-natives ──
  "tesla":                  "tesla",
  "rivian":                 "rivian",
  "lucid":                  "lucid-motors",
  "polestar":               "polestar",
  // ── Japanese majors ──
  "toyota":                 "toyota-motor",
  "lexus":                  "toyota-motor",
  "honda":                  "honda-motor-co",
  "acura":                  "honda-motor-co",
  "nissan":                 "nissan",
  "infiniti":               "nissan",
  "mazda":                  "mazda",
  "subaru":                 "subaru",
  "mitsubishi":             "mitsubishi-motors",
  // ── Korean ──
  "hyundai":                "hyundai-motor",
  "kia":                    "kia",
  "genesis":                "hyundai-motor",
  // ── German ──
  "bmw":                    "bmw",
  "mini":                   "bmw",
  "mercedes-benz":          "mercedes-benz",
  "smart":                  "mercedes-benz",
  "volkswagen":             "volkswagen",
  "audi":                   "volkswagen",
  "porsche":                "porsche",
  "bentley":                "volkswagen",
  "lamborghini":            "volkswagen",
  // ── UK / Italian luxury ──
  "land rover":             "jaguar-land-rover",
  "jaguar":                 "jaguar-land-rover",
  "rolls-royce":            "bmw",
  "ferrari":                "ferrari-n-v",
  "maserati":               "chrysler",
  "aston martin":           "aston-martin",
  // ── Swedish ──
  "volvo":                  "volvo-cars",
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

export function resolveMake(makeRaw) {
  const m = String(makeRaw || "").trim().toLowerCase();
  return MAKE_TO_SLUG[m] ?? null;
}

/**
 * Aggregate the per-vehicle records from the raw snapshot into per-slug
 * environment summaries. Pure function — accepts the parsed vehicles
 * array, returns the augment map. Tested directly in the .test.mjs file.
 *
 * `companyExists(slug)` is an optional predicate the caller passes in so
 * we can warn (but not crash) when the curated map points at a slug
 * whose company file no longer exists. In tests it's omitted.
 */
export function aggregateByAutomaker(vehicles, { companyExists } = {}) {
  const buckets = new Map(); // slug -> array of vehicles
  const unmatchedMakes = new Map(); // lowercased make -> count
  for (const v of vehicles) {
    const slug = resolveMake(v.make);
    if (!slug) {
      const k = String(v.make || "").trim().toLowerCase();
      unmatchedMakes.set(k, (unmatchedMakes.get(k) || 0) + 1);
      continue;
    }
    if (!buckets.has(slug)) buckets.set(slug, []);
    buckets.get(slug).push(v);
  }

  const out = {};
  for (const [slug, vs] of buckets) {
    const evCount = vs.filter(v => v.is_ev || v.is_fcev).length;
    const phevCount = vs.filter(v => v.is_phev).length;
    const hybridCount = vs.filter(v => v.is_hybrid).length;
    const zevCount = vs.filter(v => v.zev_eligible).length;
    const mpges = vs.map(v => v.mpge).filter(n => Number.isFinite(n) && n > 0);
    const avgMpgE = mpges.length
      ? Math.round((mpges.reduce((s, n) => s + n, 0) / mpges.length) * 10) / 10
      : null;
    const year = vs.reduce((y, v) => (v.year && v.year > y ? v.year : y), 0) || null;
    const fleet = vs.length;
    out[slug] = {
      environment: {
        avgMpgE,
        zevEligibleCount: zevCount,
        evCount,
        evPctOfFleet: fleet > 0 ? Math.round((evCount / fleet) * 1000) / 1000 : 0,
        year,
        sourceUrl: SOURCE_URL_PUBLIC,
      },
      phevCount,
      hybridCount,
      electrifiedPct: fleet > 0
        ? Math.round(((evCount + phevCount + hybridCount) / fleet) * 1000) / 1000
        : 0,
      vehicleCount: fleet,
      makeMatched: [...new Set(vs.map(v => v.make))].sort(),
    };
    if (companyExists && !companyExists(slug)) {
      out[slug]._orphan = true;
    }
  }

  return {
    augment: out,
    unmatched: [...unmatchedMakes.entries()]
      .map(([make, count]) => ({ make, count }))
      .sort((a, b) => b.count - a.count),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}. Run epa-green-vehicle-fetch.mjs first.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const vehicles = snap.vehicles || [];
  console.log(`Loaded ${vehicles.length} vehicles from ${path.basename(rawPath)} (snapshot ${snap.snapshot_date})`);

  const companyExists = (slug) => existsSync(path.join(COMP_DIR, `${slug}.json`));
  const { augment, unmatched } = aggregateByAutomaker(vehicles, { companyExists });

  const payload = {
    source: "epa-green-vehicle",
    source_url: SOURCE_URL_PUBLIC,
    license: snap.license || "US public domain (EPA / DOE fueleconomy.gov)",
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    automaker_count: Object.keys(augment).length,
    vehicle_count: vehicles.length,
    unmatched_make_count: unmatched.length,
    unmatched_makes: unmatched,
    automakers: augment,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outPath} (${payload.automaker_count} automakers from ${vehicles.length} vehicles)`);

  // Top 5 cleanest by avgMpgE — informational, surfaces the rollup quality.
  const ranked = Object.entries(augment)
    .filter(([, v]) => v.environment.avgMpgE != null)
    .sort((a, b) => b[1].environment.avgMpgE - a[1].environment.avgMpgE)
    .slice(0, 5);
  console.log(`\nTop 5 cleanest automakers by avg MPGe:`);
  for (const [slug, v] of ranked) {
    console.log(
      `  ${String(v.environment.avgMpgE).padStart(6)} MPGe  ${slug.padEnd(28)} ` +
      `(${v.environment.evCount}/${v.vehicleCount} EVs, ${v.environment.zevEligibleCount} ZEV)`
    );
  }
  if (unmatched.length) {
    console.log(`\nUnmatched makes (${unmatched.length}): ${unmatched.slice(0, 10).map(u => `${u.make}(${u.count})`).join(", ")}${unmatched.length > 10 ? "..." : ""}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("epa-green-vehicle-merge failed:", err);
    process.exit(1);
  });
}
