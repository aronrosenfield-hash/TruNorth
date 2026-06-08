// Bulk reclassification of every company in public/data/companies/<slug>.json
// AND public/data/index.json from the legacy 34-cat taxonomy to the
// consolidated 18-cat taxonomy.
//
// PR rationale:
//   - 34 cats included many <20-company micro-cats (Pet Care=6, Education=4,
//     Utilities=2, Airline=1, Telecommunications=1, etc.) that break the
//     category-applicability flag rollout.
//   - 317-row "Other" + 1 "na" bucket has no per-cat semantics and is unusable
//     for the scoring flag map.
//
// Merge rules (deterministic, 17 mappings):
//   Telecommunications        -> Technology
//   Chemicals & Materials     -> Manufacturing
//   Beverage                  -> Food & Beverage
//   Agriculture               -> Food & Beverage
//   Furniture & Home          -> Consumer Goods
//   Pet Care                  -> Consumer Goods
//   Utilities                 -> Energy & Utilities
//   Utility                   -> Energy & Utilities
//   Energy                    -> Energy & Utilities
//   Education                 -> Professional Services
//   Hospitality & Travel      -> Travel & Transportation
//   Transportation            -> Travel & Transportation
//   Airline                   -> Travel & Transportation
//   Travel                    -> Travel & Transportation
//   Sports & Fitness          -> Sports & Outdoor
//   Outdoor                   -> Sports & Outdoor
//   Aerospace                 -> Defense & Aerospace
//
// Per-company overrides (hand curated):
//   - scripts/_other-cat-reassignments.json: 318 "Other"/"na" -> final cat
//   - scripts/_beauty-pullouts.json: pure-play beauty/personal-care brands
//     moved out of Consumer Goods / Retail / Healthcare / Food & Beverage
//     into Beauty & Personal Care.
//
// Idempotent: second run produces 0 changes (compares old vs new cat).
//
// Writes BOTH:
//   - public/data/index.json (the bundled summary)
//   - public/data/companies/<slug>.json (each detail file)
//
// And logs all changes to data/derived/_meta/cat-changes-<date>.json.
//
// Usage:
//   node scripts/recategorize-companies.mjs           # apply changes
//   node scripts/recategorize-companies.mjs --dry-run # report only

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INDEX_PATH      = path.join(ROOT, "public/data/index.json");
const COMPANIES_DIR   = path.join(ROOT, "public/data/companies");
const OTHER_MAP_PATH  = path.join(__dirname, "_other-cat-reassignments.json");
const BEAUTY_MAP_PATH = path.join(__dirname, "_beauty-pullouts.json");
const LOG_DIR         = path.join(ROOT, "data/derived/_meta");
const LOG_PATH        = path.join(LOG_DIR, "cat-changes-2026-06-08.json");

// 18 final categories (must match category-applicability.json keys + tests).
export const FINAL_CATS = [
  "Apparel & Fashion",
  "Automotive",
  "Beauty & Personal Care",
  "Consumer Goods",
  "Defense & Aerospace",
  "Energy & Utilities",
  "Entertainment & Media",
  "Financial Services",
  "Food & Beverage",
  "Grocery",
  "Healthcare",
  "Hospitality",
  "Manufacturing",
  "Professional Services",
  "Retail",
  "Sports & Outdoor",
  "Technology",
  "Travel & Transportation",
];

// Deterministic merge map (old cat -> new cat).
export const MERGE_MAP = {
  "Telecommunications":     "Technology",
  "Chemicals & Materials":  "Manufacturing",
  "Beverage":               "Food & Beverage",
  "Agriculture":            "Food & Beverage",
  "Furniture & Home":       "Consumer Goods",
  "Pet Care":               "Consumer Goods",
  "Utilities":              "Energy & Utilities",
  "Utility":                "Energy & Utilities",
  "Energy":                 "Energy & Utilities",
  "Education":              "Professional Services",
  "Hospitality & Travel":   "Travel & Transportation",
  "Transportation":         "Travel & Transportation",
  "Airline":                "Travel & Transportation",
  "Travel":                 "Travel & Transportation",
  "Sports & Fitness":       "Sports & Outdoor",
  "Outdoor":                "Sports & Outdoor",
  "Aerospace":              "Defense & Aerospace",
};

// Pure decision function — given the old cat, slug, and the curated maps,
// return the new cat. Tested directly.
export function decideCat(oldCat, slug, otherMap, beautyMap) {
  // 1. Beauty pullout takes precedence (we want these out of CG/Retail/etc).
  if (beautyMap[slug]) return beautyMap[slug];
  // 2. "Other" / "na" -> per-company curated map.
  if (oldCat === "Other" || oldCat === "na" || !oldCat) {
    if (otherMap[slug]) return otherMap[slug];
    // safety fallback for unmapped Other (should never hit — test asserts 0)
    return "Professional Services";
  }
  // 3. Deterministic merge.
  if (MERGE_MAP[oldCat]) return MERGE_MAP[oldCat];
  // 4. Already a final cat -> unchanged.
  if (FINAL_CATS.includes(oldCat)) return oldCat;
  // 5. Unknown legacy cat -> fall through (will warn).
  return oldCat;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function main({ dryRun = false } = {}) {
  const t0 = Date.now();

  const otherMap  = readJSON(OTHER_MAP_PATH);
  const beautyMap = readJSON(BEAUTY_MAP_PATH);
  // strip _doc keys before lookups
  delete otherMap._doc;
  delete beautyMap._doc;

  const index = readJSON(INDEX_PATH);
  console.log(`[recat] reading ${index.length} companies from index.json`);

  const changes = []; // {slug, name, oldCat, newCat}
  const unknownCats = new Map();
  const newDist = new Map();
  let detailWrites = 0;
  let indexWrites = 0;

  for (const co of index) {
    const oldCat = co.cat;
    const newCat = decideCat(oldCat, co.slug, otherMap, beautyMap);
    if (!FINAL_CATS.includes(newCat)) {
      unknownCats.set(newCat, (unknownCats.get(newCat) || 0) + 1);
    }
    newDist.set(newCat, (newDist.get(newCat) || 0) + 1);

    if (newCat !== oldCat) {
      changes.push({ slug: co.slug, name: co.name, oldCat, newCat });
      co.cat = newCat;
      indexWrites++;

      // Update the detail JSON too.
      const fp = path.join(COMPANIES_DIR, co.slug + ".json");
      if (fs.existsSync(fp)) {
        try {
          const detail = JSON.parse(fs.readFileSync(fp, "utf-8"));
          if (detail.cat !== newCat) {
            detail.cat = newCat;
            if (!dryRun) {
              // Per-company files are MINIFIED (see reflag-categories.mjs note).
              fs.writeFileSync(fp, JSON.stringify(detail));
            }
            detailWrites++;
          }
        } catch (err) {
          console.warn(`[recat] could not update detail for ${co.slug}: ${err.message}`);
        }
      } else {
        console.warn(`[recat] missing detail file for ${co.slug}`);
      }
    }
  }

  // Write the updated index.json (pretty-printed — it's the human-readable bundle).
  if (!dryRun && indexWrites > 0) {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  }

  // Write change log.
  if (!dryRun) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      totalChanges: changes.length,
      changes,
      finalDistribution: Object.fromEntries(
        [...newDist.entries()].sort((a, b) => b[1] - a[1])
      ),
    }, null, 2));
  }

  const elapsedMs = Date.now() - t0;
  console.log(`[recat] done in ${elapsedMs}ms`);
  console.log(`[recat] changes: ${changes.length}   detailWrites: ${detailWrites}   indexUpdate: ${indexWrites > 0}`);
  console.log(`[recat] final distribution (${newDist.size} cats):`);
  const sorted = [...newDist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, n] of sorted) {
    const flag = FINAL_CATS.includes(cat) ? (n < 20 ? "  ⚠ <20" : "") : "  ⚠ UNKNOWN-CAT";
    console.log(`         ${String(n).padStart(5)}  ${cat}${flag}`);
  }
  if (unknownCats.size) {
    console.warn(`[recat] WARN unknown final cats: ${[...unknownCats.entries()].map(([k,v])=>`${k}=${v}`).join("  ")}`);
  }
  // Sanity: no "Other" / no "na" / no cat < 20.
  const otherCount = newDist.get("Other") || 0;
  const naCount    = newDist.get("na") || 0;
  if (otherCount > 0) console.warn(`[recat] WARN: ${otherCount} 'Other' remain`);
  if (naCount > 0)    console.warn(`[recat] WARN: ${naCount} 'na' remain`);
  const undersize = [...newDist.entries()].filter(([k, v]) => FINAL_CATS.includes(k) && v < 20);
  if (undersize.length) {
    console.warn(`[recat] WARN: ${undersize.length} cats below 20-company floor:`);
    for (const [k, v] of undersize) console.warn(`         ${k}: ${v}`);
  }
}

const invoked = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "");
if (invoked) {
  const dryRun = process.argv.includes("--dry-run");
  main({ dryRun }).catch(err => {
    console.error("[recat] FATAL:", err);
    process.exit(1);
  });
}
