#!/usr/bin/env node
/**
 * NSF Sport + NSF 173 + USP Verified — merge raw entries into per-slug
 * augment for TruNorth's Healthcare + Food & Beverage signals.
 *
 * Reads the most-recent file in data/raw/supplements-verified/ (or
 * --in override). Produces data/derived/supplements-verified-augment.json
 * keyed by TruNorth brand slug.
 *
 * For each entry we slug-normalise the BRAND name and:
 *   1. Direct match against public/data/index.json slugs.
 *   2. Strip corporate/legal suffixes ("LLC", "Inc.", "International",
 *      "USA") and retry direct match.
 *   3. Apply hand-curated SUPPLEMENT_ALIASES (e.g. "Pure Encapsulations"
 *      → "atrium-innovations" or "nestle"; "Optimum Nutrition" →
 *      "glanbia"; "Garden of Life" → "nestle").
 *   4. Fall back to public/data/_meta/brand-parent-map.json.
 *
 * Each brand can carry counts from multiple cert types. We aggregate:
 *   - nsfSportCount, nsf173Count, uspVerifiedCount
 *   - latestYear (best-known year — falls back to raw _generated_at year)
 *   - sourceUrls[] (deduped citation URLs)
 *
 * Output shape:
 *   {
 *     _license: "...",
 *     _generated_at: "...",
 *     _source_raw_file: "...",
 *     _matched_slugs: N,
 *     _orphan_brands: [{name, totalProducts, certTypes}],
 *     bySlug: {
 *       "<slug>": {
 *         health: {
 *           nsfSportCount: 0,
 *           nsf173Count: 0,
 *           uspVerifiedCount: 0,
 *           latestYear: 2026,
 *           sourceUrls: [...]
 *         }
 *       }
 *     }
 *   }
 *
 * USAGE
 *   node scripts/supplements-verified-merge.mjs
 *   node scripts/supplements-verified-merge.mjs --in /tmp/test.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/supplements-verified");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/supplements-verified-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

// ─── helpers ──────────────────────────────────────────────────────────────

/** Aggressive slugifier — matches TruNorth's index.json convention. */
export function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Return ordered name variants for matching. We progressively strip
 * trailing legal-entity boilerplate ("LLC", "Inc.", "International")
 * and trailing geo qualifiers ("USA", "(USA)", "North America"),
 * exposing the brand core ("Pure Encapsulations LLC" → "Pure
 * Encapsulations" → "Pure").
 */
export function nameVariants(rawName) {
  if (!rawName) return [];
  // Drop registered/trademark glyphs early.
  const cleaned = String(rawName)
    .replace(/[®™©]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const variants = new Set();
  if (cleaned) variants.add(cleaned);

  const SUFFIX_RE = [
    /\s+l\.?l\.?c\.?$/i,
    /\s+inc\.?$/i,
    /\s+incorporated$/i,
    /\s+ltd\.?$/i,
    /\s+limited$/i,
    /\s+co\.?$/i,
    /\s+corp\.?$/i,
    /\s+corporation$/i,
    /\s+company$/i,
    /\s+gmbh$/i,
    /\s+ag$/i,
    /\s+holdings?$/i,
    /\s+international$/i,
    /\s+global$/i,
    /\s+enterprises$/i,
    /\s+industries$/i,
    /\s+group$/i,
    /\s+brands?$/i,
    /\s+products?$/i,
    /\s+labs?$/i,
    /\s+laboratories$/i,
    /\s+nutrition$/i,
    /\s+nutraceuticals?$/i,
    /\s+supplements?$/i,
    /\s+health(?:care)?$/i,
    /\s+usa$/i,
    /\s+u\.s\.a\.?$/i,
    /\s+north\s+america$/i,
    /\s+services$/i,
    /\s+systems?$/i,
  ];

  let current = cleaned;
  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const re of SUFFIX_RE) {
      const next = current.replace(re, "");
      if (next !== current) { current = next.trim(); changed = true; }
    }
    if (changed && current) variants.add(current);
    else break;
  }
  return [...variants];
}

/**
 * Hand-curated supplement-brand → TruNorth-slug aliases. Sources:
 *   - Acquisitions of supplement brands by CPG conglomerates
 *     (Nestle Health Sciences buying Atrium, Pure Encapsulations,
 *     Garden of Life, Solgar etc.)
 *   - Private-label brands owned by retailers (Kirkland → Costco,
 *     Equate → Walmart, Spring Valley → Walmart, Member's Mark →
 *     Sam's Club/Walmart, Berkley Jensen → BJ's Wholesale, Up & Up →
 *     Target).
 *
 * Key is slug(cleaned-name); value is the TruNorth slug it routes to.
 * Only entries whose right-hand slug actually appears in index.json
 * will be applied at runtime.
 */
export const SUPPLEMENT_ALIASES = {
  // Retailer private labels
  "kirkland-signature":   "costco-wholesale",
  "kirkland":             "costco-wholesale",
  "equate":               "walmart",
  "spring-valley":        "walmart",
  "members-mark":         "walmart",  // Sam's Club is a Walmart subsidiary
  "up-and-up":            "target",
  "berkley-jensen":       "bj-s-wholesale-club",
  "trunature":            "costco-wholesale",
  "cvs-health":           "cvs-health",
  "cvs-pharmacy":         "cvs-health",
  // Pharma / health conglomerates
  "abbott":               "abbott-laboratories",
  "centrum":              "haleon",
  "one-a-day":            "bayer",
  "emergen-c":            "haleon",
  "pfizer-consumer":      "pfizer",
  // Nestle Health Sciences supplement portfolio
  "garden-of-life":       "nestle",
  "pure-encapsulations":  "nestle",
  "douglas-laboratories": "nestle",
  "solgar":               "nestle",
  "natures-bounty":       "nestle",
  "natures-bounty-co":    "nestle",
  "sundown-naturals":     "nestle",
  "new-chapter":          "procter-and-gamble",
  // Sports nutrition
  "optimum-nutrition":    "glanbia",
  "bsn":                  "glanbia",
  "isopure":              "glanbia",
  "thinkthin":            "glanbia",
  "muscletech":           "iovate-health-sciences",
  "musclepharm":          "musclepharm",
  // Direct sales / standalone
  "herbalife":            "herbalife",
  "usana":                "usana-health-sciences",
  "amway":                "amway",
  "nutrilite":            "amway",
  "nordic-naturals":      "nordic-naturals",
  "thorne":               "thorne-healthtech",
  "thorne-research":      "thorne-healthtech",
  // Mead Johnson (Reckitt) infant nutrition
  "mead-johnson":         "mead-johnson",
  "enfamil":              "mead-johnson",
  // Other commonly-encountered NSF/USP supplement registrants
  "thorne":               "thorne-healthtech",
  "access-business-group": "amway",  // Amway's contract-manufacturing arm
  "olly-public-benefit-corporation": "unilever",  // OLLY acquired by Unilever 2019
  "olly":                 "unilever",
  "haleon-us-holdings":   "haleon",
  "garden-of-life-llc":   "nestle",
  "hvl-dba-nestle-health-science": "nestle",
  "nestle-health-science": "nestle",
  "nutrabolt":            "nutrabolt",
  "woodbolt-distribution-dba-nutrabolt": "nutrabolt",
  "cellucor":             "nutrabolt",  // Cellucor is a Nutrabolt brand
  // BioSteel: ownership in flux (CG divested 2023). Leave as orphan.
  "smartypants":          "unilever",   // SmartyPants acquired by Unilever 2021
  "designs-for-health":   "designs-for-health",
  "klean-athlete":        "douglas-laboratories",  // Klean is Douglas Labs (Nestle)
  "klean":                "nestle",
  "herbalife24":          "herbalife",
  "herbalife-international-of-america": "herbalife",
  "1st-phorm":            "1st-phorm",
  "1st-phorm-international": "1st-phorm",
  "transparent-labs":     "transparent-labs",
  "international-vitamin": "international-vitamin",
  "international-vitamin-corporation": "international-vitamin",
  "bulksupplements-com":  "bulksupplements",
  "hard-eight-nutrition-dba-bulksupplements-com": "bulksupplements",
  "10x-health":           "10x-health",
  "10x-health-system":    "10x-health",
  "ag1-usa":              "ag1",
  "athletic-greens":      "ag1",
  "momentous":            "momentous",
  "bare-performance-nutrition": "bare-performance-nutrition",
  "designs-for-sport":    "designs-for-health",
  "21st-century-healthcare": "21st-century",
};

/**
 * Resolve a brand name to a TruNorth slug.
 *   1. Direct slug match against index.
 *   2. SUPPLEMENT_ALIASES.
 *   3. brand-parent-map.json.
 * Returns { slug, routedVia } or { slug: null, routedVia: "orphan" }.
 */
export function resolveBrand(rawName, indexSlugs, parentMap) {
  const variants = nameVariants(rawName);
  for (const v of variants) {
    const slug = slugify(v);
    if (!slug) continue;
    if (indexSlugs.has(slug)) return { slug, routedVia: "direct" };
    if (SUPPLEMENT_ALIASES[slug] && indexSlugs.has(SUPPLEMENT_ALIASES[slug])) {
      return { slug: SUPPLEMENT_ALIASES[slug], routedVia: "supplement-alias" };
    }
    const pm = parentMap[slug];
    if (pm?.parent && indexSlugs.has(pm.parent)) {
      return { slug: pm.parent, routedVia: "brand-parent" };
    }
  }
  return { slug: null, routedVia: "orphan" };
}

// ─── load ─────────────────────────────────────────────────────────────────
async function loadIndexSlugs() {
  const arr = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  return new Set(arr.map(c => c.slug));
}

async function loadParentMap() {
  try {
    const obj = JSON.parse(await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8"));
    const { _doc, ...rest } = obj;
    return rest;
  } catch {
    return {};
  }
}

async function pickLatestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No raw files in ${RAW_DIR}; run supplements-verified-fetch.mjs first.`);
  }
  return path.join(RAW_DIR, files[files.length - 1]);
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("NSF + USP supplements merger");

  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const entries = raw.entries || [];
  console.log(`  ${entries.length} raw entries`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap  = await loadParentMap();
  console.log(`  Loaded ${indexSlugs.size} index slugs + ${Object.keys(parentMap).length} brand-parent entries`);

  const generatedYear = (raw._generated_at || new Date().toISOString()).slice(0, 4);

  const bySlug = new Map();
  const orphanCounts = new Map();
  const routedViaCounts = { direct: 0, "supplement-alias": 0, "brand-parent": 0, orphan: 0 };

  for (const e of entries) {
    const { slug, routedVia } = resolveBrand(e.brand, indexSlugs, parentMap);
    routedViaCounts[routedVia]++;

    if (!slug) {
      const existing = orphanCounts.get(e.brand) || {
        name: e.brand,
        totalProducts: 0,
        certTypes: new Set(),
      };
      existing.totalProducts++;
      existing.certTypes.add(e.certType);
      orphanCounts.set(e.brand, existing);
      continue;
    }

    let acc = bySlug.get(slug);
    if (!acc) {
      acc = {
        nsfSportCount: 0,
        nsf173Count: 0,
        uspVerifiedCount: 0,
        latestYear: Number(generatedYear),
        sourceUrls: new Set(),
      };
      bySlug.set(slug, acc);
    }

    if (e.certType === "NSF Sport")    acc.nsfSportCount++;
    if (e.certType === "NSF 173")      acc.nsf173Count++;
    if (e.certType === "USP Verified") acc.uspVerifiedCount++;

    if (e.certDate) {
      const yr = Number(String(e.certDate).slice(0, 4));
      if (yr && yr > acc.latestYear) acc.latestYear = yr;
    }
    if (e.sourceUrl) acc.sourceUrls.add(e.sourceUrl);
  }

  // Build serialised output
  const output = {
    _license: raw._license || "Public certification registries — NSF + USP",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_urls: raw._sources || {},
    _matched_slugs: bySlug.size,
    _routing_counts: routedViaCounts,
    _orphan_brands: [...orphanCounts.values()]
      .map(o => ({
        name: o.name,
        totalProducts: o.totalProducts,
        certTypes: [...o.certTypes],
      }))
      .sort((a, b) => b.totalProducts - a.totalProducts)
      .slice(0, 100),
    bySlug: {},
  };

  for (const [slug, acc] of bySlug.entries()) {
    output.bySlug[slug] = {
      health: {
        nsfSportCount: acc.nsfSportCount,
        nsf173Count: acc.nsf173Count,
        uspVerifiedCount: acc.uspVerifiedCount,
        latestYear: acc.latestYear,
        sourceUrls: [...acc.sourceUrls],
      },
    };
  }

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs: ${bySlug.size}`);
  console.log(`  Routing: direct=${routedViaCounts.direct} supplement-alias=${routedViaCounts["supplement-alias"]} brand-parent=${routedViaCounts["brand-parent"]} orphan=${routedViaCounts.orphan}`);
  console.log(`  Orphan brand names: ${orphanCounts.size}`);

  // Top 5 by total verified products
  const ranked = [...bySlug.entries()].map(([slug, a]) => ({
    slug,
    total: a.nsfSportCount + a.nsf173Count + a.uspVerifiedCount,
    nsfSport: a.nsfSportCount,
    nsf173: a.nsf173Count,
    usp: a.uspVerifiedCount,
  })).sort((a, b) => b.total - a.total);

  if (ranked.length > 0) {
    console.log(`\nTop 5 matched brands by total verified products:`);
    for (const r of ranked.slice(0, 5)) {
      console.log(`  ${String(r.total).padStart(4)}  ${r.slug.padEnd(30)}  (NSF Sport ${r.nsfSport}, NSF 173 ${r.nsf173}, USP ${r.usp})`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("supplements-verified-merge failed:", err);
    process.exit(1);
  });
}
