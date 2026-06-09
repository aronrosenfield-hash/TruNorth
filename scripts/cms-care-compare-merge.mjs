#!/usr/bin/env node
/**
 * CMS Hospital Care Compare — merge hospital ratings into TruNorth hospital-system slugs.
 *
 * Reads data/raw/cms-care-compare/<YYYY>.json and produces
 * data/derived/cms-care-compare-augment.json keyed by hospital-system slug.
 *
 * Match strategy:
 *   Hospital facility names embed the parent system name (e.g.
 *   "BANNER GATEWAY MEDICAL CENTER" → banner; "KAISER FOUNDATION HOSPITAL
 *   - OAKLAND" → kaiser-permanente). We use a curated SYSTEM_PATTERNS
 *   list mapping a substring → TruNorth slug. Each pattern is matched
 *   case-insensitively against the facility_name, with longest match first.
 *
 *   Hospitals matching no pattern are dropped — we only emit per-system
 *   aggregates, not per-hospital narratives.
 *
 * Per-system aggregation:
 *   ratings_dist   = { "1": n, "2": n, "3": n, "4": n, "5": n, "NR": n }
 *   avg_rating     = weighted average over rated facilities (1-5 only)
 *   hospitals      = count
 *   safety_worse   = sum across system  (count of facilities w/ worse-than-natl measures)
 *   safety_better  = sum across system
 *   readm_worse    = sum
 *   readm_better   = sum
 *
 * Scoring direction (interpreted by apply-augments writer):
 *   avg_rating ≥ 4    → health "positive"
 *   avg_rating ≤ 2    → health "poor"
 *   safety_worse >> safety_better → health "mixed" or "poor"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cms-care-compare");
const OUT_FILE = path.join(ROOT, "data/derived/cms-care-compare-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

// [substring (case-insensitive), TruNorth slug]. Order matters — longest
// patterns first to avoid e.g. "PROVIDENCE HOSPITAL" matching every
// Catholic facility with "providence" in the name.
export const SYSTEM_PATTERNS = [
  // For-profit chains
  ["HCA ", "hca-healthcare"],
  ["HCA FLORIDA", "hca-healthcare"],
  ["HCA HOUSTON", "hca-healthcare"],
  ["TENET ", "tenet-healthcare"],
  ["UNIVERSAL HEALTH SERVICES", "universal-health-services"],
  ["COMMUNITY HEALTH SYSTEMS", "community-health-systems"],
  ["LIFEPOINT ", "lifepoint-health"],
  ["ACADIA HEALTHCARE", "acadia-healthcare-company"],
  // Major non-profit systems
  ["KAISER FOUNDATION", "kaiser-permanente"],
  ["KAISER PERMANENTE", "kaiser-permanente"],
  ["CLEVELAND CLINIC", "cleveland-clinic"],
  ["MAYO CLINIC", "mayo-clinic"],
  ["MOUNT SINAI", "mount-sinai-health-system"],
  ["JOHNS HOPKINS", "johns-hopkins-medicine"],
  ["NORTHWELL", "northwell-health"],
  ["ASCENSION ", "ascension-health"],
  ["CHRISTUS ", "christus-health"],
  ["TRINITY HEALTH", "trinity-health"],
  ["COMMONSPIRIT", "commonspirit-health"],
  ["SUTTER ", "sutter-health"],
  ["INTERMOUNTAIN ", "intermountain-healthcare"],
  ["PROVIDENCE HEALTH", "providence-health-and-services"],
  ["PROVIDENCE ALASKA", "providence-health-and-services"],
  ["PROVIDENCE SAINT", "providence-health-and-services"],
  ["PROVIDENCE PORTLAND", "providence-health-and-services"],
  ["PROVIDENCE ST ", "providence-health-and-services"],
  ["PROVIDENCE LITTLE COMPANY", "providence-health-and-services"],
  ["PROVIDENCE TARZANA", "providence-health-and-services"],
  ["PROVIDENCE REGIONAL", "providence-health-and-services"],
  ["MEMORIAL HERMANN", "memorial-hermann-health-system"],
  ["BAYLOR SCOTT", "baylor-scott-and-white-health"],
  ["BANNER ", "banner-health"],
  ["BANNER-", "banner-health"],
  ["ADVOCATE ", "advocate-health"],
  ["AURORA ", "advocate-health"],
  ["UPMC ", "upmc"],
  ["GEISINGER ", "geisinger-health-system"],
  ["CEDARS-SINAI", "cedars-sinai-medical-center"],
  ["SCRIPPS ", "scripps-health"],
  ["RUSH UNIVERSITY", "rush-university-medical-center"],
  ["NYU LANGONE", "nyu-langone-health"],
  ["MASS GENERAL", "mass-general-brigham"],
  ["MASSACHUSETTS GENERAL", "mass-general-brigham"],
  ["BRIGHAM AND WOMEN", "mass-general-brigham"],
  ["DUKE UNIVERSITY HOSPITAL", "duke-university-health-system"],
  ["STANFORD HEALTH", "stanford-health-care"],
  ["STANFORD HOSPITAL", "stanford-health-care"],
  ["UCSF ", "ucsf-health"],
  ["UCLA ", "ucla-health"],
  ["UC SAN DIEGO", "uc-san-diego-health"],
  ["NEW YORK PRESBYTERIAN", "newyork-presbyterian-hospital"],
  ["NEWYORK-PRESBYTERIAN", "newyork-presbyterian-hospital"],
  // Veterans Administration — special slug
  ["VA ", "us-department-of-veterans-affairs"],
  ["DVA ", "us-department-of-veterans-affairs"],
];

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
}

function matchSystem(facilityName) {
  if (!facilityName) return null;
  const upper = facilityName.toUpperCase();
  // longest pattern first — sort by descending length once
  for (const [pat, slug] of SYSTEM_PATTERNS) {
    if (upper.includes(pat)) return slug;
  }
  return null;
}

async function main() {
  const inFile = arg("--in", path.join(RAW_DIR, "2024.json"));
  const outFile = arg("--out", OUT_FILE);

  const raw = JSON.parse(fs.readFileSync(inFile, "utf8"));
  const hospitals = raw.hospitals || [];
  console.log(`[load] ${hospitals.length} hospitals`);

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const indexSlugs = new Set(index.map((c) => c.slug));

  const bySystem = new Map();
  let matched = 0;
  for (const h of hospitals) {
    const slug = matchSystem(h.name);
    if (!slug) continue;
    if (!indexSlugs.has(slug)) continue; // only emit for slugs that exist in TruNorth
    matched++;
    let acc = bySystem.get(slug);
    if (!acc) {
      acc = {
        hospitals: 0,
        ratings: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, NR: 0 },
        safetyWorse: 0, safetyBetter: 0,
        readmWorse: 0, readmBetter: 0,
        sample: [],
      };
      bySystem.set(slug, acc);
    }
    acc.hospitals++;
    const r = String(h.rating || "").trim();
    if (/^[1-5]$/.test(r)) acc.ratings[r]++;
    else acc.ratings.NR++;
    acc.safetyWorse += parseInt(h.safetyWorse, 10) || 0;
    acc.safetyBetter += parseInt(h.safetyBetter, 10) || 0;
    acc.readmWorse += parseInt(h.readmWorse, 10) || 0;
    acc.readmBetter += parseInt(h.readmBetter, 10) || 0;
    if (acc.sample.length < 3) acc.sample.push(h.name);
  }

  const bySlug = {};
  for (const [slug, acc] of bySystem) {
    let weighted = 0, ratedCount = 0;
    for (const k of ["1", "2", "3", "4", "5"]) {
      weighted += parseInt(k, 10) * acc.ratings[k];
      ratedCount += acc.ratings[k];
    }
    const avgRating = ratedCount > 0 ? +(weighted / ratedCount).toFixed(2) : null;
    bySlug[slug] = {
      health: {
        hospitals: acc.hospitals,
        avgStarRating: avgRating,
        starRatings: acc.ratings,
        safetyMeasuresWorse: acc.safetyWorse,
        safetyMeasuresBetter: acc.safetyBetter,
        readmissionsWorse: acc.readmWorse,
        readmissionsBetter: acc.readmBetter,
        sampleHospitals: acc.sample,
        sourceUrl: "https://data.cms.gov/provider-data/dataset/xubh-q36u",
        _license: "https://www.usa.gov/government-works",
      },
    };
  }

  const out = {
    _license: "https://www.usa.gov/government-works",
    _generated_at: new Date().toISOString(),
    _source: "https://data.cms.gov/provider-data/dataset/xubh-q36u",
    _hospitals_total: hospitals.length,
    _hospitals_matched: matched,
    _systems_matched: Object.keys(bySlug).length,
    bySlug,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[done] ${out._systems_matched} systems, ${matched} hospitals attributed`);
  console.log("Sample:");
  Object.entries(bySlug).slice(0, 10).forEach(([s, v]) => {
    console.log(`  ${s.padEnd(45)} avg=${v.health.avgStarRating || "—"} hospitals=${v.health.hospitals}  worseSafety=${v.health.safetyMeasuresWorse}  betterSafety=${v.health.safetyMeasuresBetter}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
