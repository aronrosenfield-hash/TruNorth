#!/usr/bin/env node
/**
 * Divestment lists + impact-fund holdings — merge step.
 *
 * Reads the most recent data/raw/divestment-impact-funds/<date>.json
 * (produced by divestment-impact-funds-fetch.mjs), slugifies brand names,
 * resolves through brand-parent-map + slug-aliases, and writes augmentation
 * deltas keyed by slug to
 *   data/derived/divestment-impact-funds-augment.json
 *
 * Output shape (per the project convention):
 *   {
 *     generated_at: ISO,
 *     source: "divestment-impact-funds",
 *     source_url: "https://www.nbim.no/en/responsible-investment/exclusion-of-companies/",
 *     company_count: N,
 *     companies: {
 *       "<slug>": {
 *         display_name: "...",
 *         sources: ["norway-gpfg", "fossil-free-funds", ...],
 *         category_signals: {
 *           environment: { polarity: "negative" | "positive" | "informational",
 *                          count: N, reasons: ["..."], source_urls: ["..."] },
 *           guns:        { ... },
 *           health:      { ... },
 *           ...
 *         },
 *         pattern_severity: "very_poor" | "poor" | "mixed" | "neutral" |
 *                            "positive" | "very_positive" | null,
 *         norway_gpfg: {
 *           excluded: true,
 *           reasons: ["..."],
 *           decision_years: [2006, 2010],
 *         } | null,
 *         divestment_targeted: boolean,   // appears on 350.org / gofossilfree
 *         positive_fund_count: N,         // distinct positive-screen funds
 *         negative_fund_count: N,         // distinct negative-screen funds
 *       }
 *     }
 *   }
 *
 * Severity rules (conservative — single-source exclusion is NOT negative):
 *   - Norway-GPFG exclusion alone → "poor" (sovereign-wealth fund signal)
 *   - Norway-GPFG + ≥1 other negative source → "very_poor"
 *   - 3+ negative impact-fund screens (without Norway) → "poor"
 *   - 1-2 negative impact-fund screens (no Norway) → "mixed"
 *   - 5+ positive-fund holdings AND 0 negative → "positive"
 *   - 3-4 positive holdings AND 0 negative → "mixed" (lean positive)
 *   - Otherwise → "neutral"
 *
 * BDS records (polarity=informational) NEVER contribute to severity.
 *
 * Flags:
 *   --in PATH    — read this file instead of the newest in data/raw/...
 *   --out PATH   — override default output path
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const RAW_DIR   = path.join(ROOT, "data/raw/divestment-impact-funds");
const OUT_FILE_DEFAULT = path.join(ROOT, "data/derived/divestment-impact-funds-augment.json");
const ALIASES_PATH     = path.join(ROOT, "public/data/_meta/slug-aliases.json");
const PARENT_MAP_PATH  = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const args = process.argv.slice(2);
const IN_OVERRIDE = (() => {
  const i = args.indexOf("--in");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();
const OUT_OVERRIDE = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) {
    throw new Error(`Missing raw dir ${RAW_DIR}. Run divestment-impact-funds-fetch.mjs first.`);
  }
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No raw files in ${RAW_DIR}. Run divestment-impact-funds-fetch.mjs first.`);
  }
  return path.join(RAW_DIR, files[files.length - 1]);
}

async function loadJsonSafe(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Resolve a brand → company slug. Order:
 *   1. Slug-aliases (slug-aliases.json)
 *   2. Brand-parent-map (brand-parent-map.json — covers sub-brands)
 *   3. Direct slug from name
 * Then drop the `_doc` and any underscore-prefixed map keys.
 */
export function resolveSlug(brand, aliases = {}, parentMap = {}) {
  // Guard against meta-keys that look like brand names (e.g. raw "_doc"
  // strings copied from a parent-map dump).
  if (typeof brand === "string" && brand.startsWith("_")) return null;
  const direct = toSlug(brand);
  if (!direct) return null;
  if (aliases[direct]) return aliases[direct];
  // brand-parent-map keys are alphanumeric-lowercase (no dashes).
  const compactKey = direct.replace(/-/g, "");
  const parentEntry = parentMap[compactKey];
  if (parentEntry && parentEntry.parent && !compactKey.startsWith("_")) {
    return parentEntry.parent;
  }
  return direct;
}

/* ------------------------------ severity --------------------------------- */

const POSITIVE_SOURCES = new Set([
  "trillium", "calvert", "domini", "parnassus", "pax-world",
  "tiaa-social-choice", "vanguard-esg", "ishares-esg", "gender-equality-funds",
]);
const NEGATIVE_SOURCES = new Set([
  "norway-gpfg", "divestment-commitments", "fossil-free-funds",
  "tobacco-free-funds", "weapons-free-funds", "deforestation-free-funds",
  "prison-free-funds", "methodist-pension", "episcopal-church",
]);
const INFORMATIONAL_SOURCES = new Set([
  "bds-boycott",
]);

/**
 * Conservative severity rollup. See header docs for rules.
 */
export function derivePatternSeverity({ norway, negSources, posSources }) {
  const negCount = negSources.size;
  const posCount = posSources.size;

  if (norway && negCount >= 2) return "very_poor";   // Norway + at least one more neg source
  if (norway && negCount >= 1) return "poor";        // Norway alone (norway counted in negSources too)
  if (norway)                  return "poor";

  if (negCount >= 3) return "poor";
  if (negCount >= 1 && posCount === 0) return "mixed";

  if (negCount === 0 && posCount >= 5) return "positive";
  if (negCount === 0 && posCount >= 3) return "mixed";   // lean-positive

  return "neutral";
}

/* ----------------------------- groupByBrand ------------------------------ */

export function groupByBrand(records, aliases, parentMap) {
  // First: collapse records by slug into one bucket.
  const buckets = new Map();   // slug -> bucket
  const unmatched = [];

  for (const r of records) {
    const slug = resolveSlug(r.brand, aliases, parentMap);
    if (!slug || slug.startsWith("_")) {
      unmatched.push(r);
      continue;
    }
    let bucket = buckets.get(slug);
    if (!bucket) {
      bucket = {
        slug,
        display_name: r.brand,
        records: [],
        sources: new Set(),
        norway_reasons: [],
        norway_years: [],
        category_signals: {},   // cat -> { polarity, count, reasons, urls, sources }
        positive_funds: new Set(),
        negative_funds: new Set(),
        informational_funds: new Set(),
      };
      buckets.set(slug, bucket);
    }
    bucket.records.push(r);
    bucket.sources.add(r.source);
    if (r.source === "norway-gpfg") {
      bucket.norway_reasons.push(r.reason);
      if (r.decision_year) bucket.norway_years.push(r.decision_year);
    }
    if (POSITIVE_SOURCES.has(r.source))      bucket.positive_funds.add(r.source);
    if (NEGATIVE_SOURCES.has(r.source))      bucket.negative_funds.add(r.source);
    if (INFORMATIONAL_SOURCES.has(r.source)) bucket.informational_funds.add(r.source);

    // Per-category roll-up.
    const cat = r.category || "general";
    let sig = bucket.category_signals[cat];
    if (!sig) {
      sig = { polarities: new Set(), count: 0, reasons: [], source_urls: new Set(), sources: new Set() };
      bucket.category_signals[cat] = sig;
    }
    sig.polarities.add(r.polarity);
    sig.count += 1;
    if (r.reason && !sig.reasons.includes(r.reason)) sig.reasons.push(r.reason);
    if (r.source_url) sig.source_urls.add(r.source_url);
    sig.sources.add(r.source);
  }

  // Now materialize each bucket.
  const out = {};
  for (const [slug, b] of buckets) {
    const cat_out = {};
    for (const [cat, sig] of Object.entries(b.category_signals)) {
      // Resolve polarity: negative wins, then positive, else informational.
      const ps = sig.polarities;
      const polarity = ps.has("negative")
        ? "negative"
        : ps.has("positive")
          ? "positive"
          : ps.has("informational")
            ? "informational"
            : "neutral";
      cat_out[cat] = {
        polarity,
        count: sig.count,
        reasons: sig.reasons.slice(0, 5),    // cap at 5 reasons for narrative width
        source_urls: [...sig.source_urls].slice(0, 5),
        sources: [...sig.sources].sort(),
      };
    }

    const severity = derivePatternSeverity({
      norway: b.norway_reasons.length > 0,
      negSources: b.negative_funds,
      posSources: b.positive_funds,
    });

    out[slug] = {
      display_name: b.display_name,
      sources: [...b.sources].sort(),
      category_signals: cat_out,
      pattern_severity: severity,
      norway_gpfg: b.norway_reasons.length > 0
        ? {
            excluded: true,
            reasons: b.norway_reasons,
            decision_years: b.norway_years.sort(),
          }
        : null,
      divestment_targeted: b.sources.has("divestment-commitments"),
      positive_fund_count: b.positive_funds.size,
      negative_fund_count: b.negative_funds.size,
      informational_fund_count: b.informational_funds.size,
    };
  }

  return { companies: out, unmatched };
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  const inFile  = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_FILE_DEFAULT;
  console.log(`divestment-impact-funds merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const records = src.records || [];

  const aliases   = await loadJsonSafe(ALIASES_PATH);
  const parentMap = await loadJsonSafe(PARENT_MAP_PATH);

  const { companies, unmatched } = groupByBrand(records, aliases, parentMap);
  const keys = Object.keys(companies);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "divestment-impact-funds",
    source_url: src.source_urls?.["norway-gpfg"] || "https://www.nbim.no/en/responsible-investment/exclusion-of-companies/",
    source_urls: src.source_urls || {},
    license: "Public/open institutional disclosures (sovereign wealth fund exclusion lists, mutual-fund top-holding filings, divestment commitment registries). Each record cites a per-source URL.",
    upstream_file: path.relative(ROOT, inFile),
    company_count: keys.length,
    unmatched_count: unmatched.length,
    companies,
  }, null, 2));

  console.log(`✅ Wrote ${outFile} — ${keys.length} unique companies`);

  // Quick stats so CI logs are useful at a glance.
  const bySeverity = {};
  let withNorway = 0, withDivest = 0;
  for (const k of keys) {
    const c = companies[k];
    bySeverity[c.pattern_severity] = (bySeverity[c.pattern_severity] || 0) + 1;
    if (c.norway_gpfg) withNorway++;
    if (c.divestment_targeted) withDivest++;
  }
  console.log(`   By pattern severity: ${JSON.stringify(bySeverity)}`);
  console.log(`   Norway-GPFG excluded brands: ${withNorway}`);
  console.log(`   Fossil-divestment targeted brands: ${withDivest}`);
  console.log(`   Unmatched (no slug resolved): ${unmatched.length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("divestment-impact-funds-merge failed:", err);
    process.exit(1);
  });
}
