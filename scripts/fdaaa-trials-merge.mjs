#!/usr/bin/env node
/**
 * FDAAA TrialsTracker — merge raw sponsors into per-slug augment.
 *
 * Reads the most-recent file in data/raw/fdaaa-trials/ (or --in override)
 * and produces data/derived/fdaaa-trials-augment.json keyed by TruNorth
 * brand slug.
 *
 * Match strategy:
 *   1. Direct slug match (TrialsTracker slug → index.json slug).
 *   2. Suffix-stripping (drop "-inc", "-corporation", "-pharmaceuticals",
 *      "-pharma", "-as", "-llc", "-co-ltd", "-ag", "-se", "-bv", "-ltd",
 *      "-plc", "-holdings", " etc.") then retry.
 *   3. Hand-curated FDAAA_ALIASES table for subsidiaries (e.g.
 *      "merck-sharp-dohme-llc" → "merck-and-co", "hoffmann-la-roche" →
 *      "roche-holding", "novartis-pharmaceuticals" → "novartis",
 *      "janssen-research-development-llc" → "johnson-and-johnson", and the
 *      many "X — a subsidiary of Y" patterns).
 *   4. Fall back to public/data/_meta/brand-parent-map.json.
 *
 * When multiple TrialsTracker sponsors resolve to the same TruNorth slug
 * (e.g. all Janssen subsidiaries → johnson-and-johnson), we AGGREGATE:
 *   totalTrials         = sum across sponsors
 *   trialsDue           = sum across sponsors
 *   trialsReported      = sum across sponsors
 *   trialsLateOrMissing = sum (= sum_due − sum_reported, clipped to ≥ 0)
 *   compliancePct       = floor(100 × sum_reported / sum_due)  (recomputed)
 *   year                = max(years)   (most-recent snapshot)
 *   sourceUrl           = ranking page when there's >1 sub; else sponsor page
 *
 * Output shape (matches DELIVERABLE 2 spec):
 *   {
 *     _license: "Apache-2.0",
 *     _generated_at: "...",
 *     _source: "https://fdaaa.trialstracker.net",
 *     _matched_slugs: N,
 *     _orphan_sponsors_top: [{name, slug, due, lateOrMissing}],
 *     _routing_counts: { direct, suffix, alias, brand-parent, orphan },
 *     bySlug: {
 *       "<truNorth-slug>": {
 *         health: {
 *           totalTrials, trialsLateOrMissing, compliancePct, year,
 *           sourceUrl, _license: "Apache-2.0"
 *         }
 *       }
 *     }
 *   }
 *
 * Usage:
 *   node scripts/fdaaa-trials-merge.mjs
 *   node scripts/fdaaa-trials-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/fdaaa-trials");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/fdaaa-trials-augment.json");

const SOURCE_URL = "https://fdaaa.trialstracker.net";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

// ─── alias table ──────────────────────────────────────────────────────────
/**
 * TrialsTracker slugs → TruNorth index.json slugs.
 *
 * Covers the major Big Pharma subsidiary patterns that the slug-suffix
 * stripping ladder can't catch on its own. Values must exist in
 * public/data/index.json (caller checks before applying).
 *
 * Sources: hand-verified against fdaaa.trialstracker.net top-100 sponsors
 * (June 2026 snapshot) and matched to TruNorth pharma parent brands.
 */
export const FDAAA_ALIASES = {
  // Merck & Co (US Merck / MSD)
  "merck-sharp-dohme-llc":                                                          "merck-and-co",
  "merck-sharp-and-dohme-llc":                                                      "merck-and-co",
  "msd-pharmaceuticals-private-limited":                                            "merck-and-co",
  "msd-italia-srl":                                                                  "merck-and-co",
  "msd-france":                                                                      "merck-and-co",
  "merck-co-inc":                                                                    "merck-and-co",
  "acceleron-pharma-inc-a-wholly-owned-subsidiary-of-merck-co-inc-rahway-nj-usa":   "merck-and-co",
  "imago-biosciences-inc-a-subsidiary-of-merck-co-inc-rahway-new-jersey-usa":       "merck-and-co",
  "verona-pharma-inc-a-subsidiary-of-merck-co-inc-rahway-new-jersey-usa":           "merck-and-co",
  "prometheus-biosciences-inc-a-subsidiary-of-merck-co-inc-rahway-new-jersey-usa":  "merck-and-co",

  // Johnson & Johnson (Janssen)
  "janssen-research-development-llc":          "johnson-and-johnson",
  "janssen-scientific-affairs-llc":            "johnson-and-johnson",
  "janssen-vaccines-prevention-bv":            "johnson-and-johnson",
  "janssen-pharmaceutical-kk":                 "johnson-and-johnson",
  "janssen-cilag-international-nv":            "johnson-and-johnson",
  "janssen-cilag-gmbh":                        "johnson-and-johnson",
  "janssen-biotech-inc":                       "johnson-and-johnson",
  "janssen-pharmaceutica-nv":                  "johnson-and-johnson",
  "janssen-sciences-ireland-uc":               "johnson-and-johnson",
  "johnson-johnson-consumer-inc-jjci":         "johnson-and-johnson",
  "johnson-johnson-surgical-vision-inc":       "johnson-and-johnson",
  "johnson-johnson-vision-care-inc":           "johnson-and-johnson",
  "johnson-johnson-medical-devices":           "johnson-and-johnson",
  "johnson-johnson":                           "johnson-and-johnson",
  "ethicon-inc":                               "johnson-and-johnson",   // J&J surgical subsidiary
  "actelion":                                  "johnson-and-johnson",   // acquired 2017
  "actelion-pharmaceuticals-ltd":              "johnson-and-johnson",

  // Roche — TruNorth index has no parent "roche" slug; subsidiaries are mapped
  // to the closest in-index entry. Genentech is a recognised brand on its own.
  "hoffmann-la-roche":            "roche",   // will only fire if roche ever added
  "f-hoffmann-la-roche-ltd":      "roche",
  "genentech-inc":                "genentech",
  "spark-therapeutics-inc":       "spark-therapeutics",
  "chugai-pharmaceutical-co-ltd": "chugai-pharmaceutical",

  // Novartis
  "novartis-pharmaceuticals":      "novartis",
  "novartis-pharma-ag":            "novartis",
  "sandoz":                        "novartis",   // generics arm (spun off late 2023; still grouped here)

  // Pfizer
  "pfizers-upjohn-has-merged-with-mylan-to-form-viatris-inc": "pfizer",
  "wyeth-is-now-a-wholly-owned-subsidiary-of-pfizer":         "pfizer",
  "seagen-a-wholly-owned-subsidiary-of-pfizer":               "pfizer",
  "seagen-inc":                                               "pfizer",
  "biohaven-pharmaceuticals":                                 "pfizer",   // acquired 2022
  "arena-pharmaceuticals-inc":                                "pfizer",   // acquired 2022

  // Sanofi
  "bioverativ-a-sanofi-company":             "sanofi",
  "genzyme-a-sanofi-company":                "sanofi",
  "ablynx-a-sanofi-company":                 "sanofi",
  "kadmon-a-sanofi-company":                 "sanofi",
  "principia-biopharma-a-sanofi-company":    "sanofi",
  "translate-bio-a-sanofi-company":          "sanofi",
  "kymab-a-sanofi-company":                  "sanofi",
  "sanofi-aventis-recherche-developpement":  "sanofi",
  "sanofi-pasteur":                          "sanofi",

  // GlaxoSmithKline (TruNorth slug: "gsk")
  "glaxosmithkline":  "gsk",
  "viiv-healthcare":  "gsk",   // GSK + Pfizer + Shionogi JV (majority GSK)

  // AstraZeneca
  "medimmune-llc":                              "astrazeneca",
  "alexion-pharmaceuticals-inc":                "astrazeneca",   // acquired 2021
  "alexion-astrazeneca-rare-disease":           "astrazeneca",

  // Bristol-Myers Squibb (TruNorth slug is "bristol-myers-squibb")
  "karuna-therapeutics-inc-a-bristol-myers-squibb-company": "bristol-myers-squibb",
  "celgene":                                                "bristol-myers-squibb",   // acquired 2019
  "celgene-corporation":                                    "bristol-myers-squibb",
  "juno-therapeutics-a-subsidiary-of-celgene-corporation":  "bristol-myers-squibb",
  "mirati-therapeutics-inc":                                "bristol-myers-squibb",   // acquired 2024

  // Eli Lilly
  "eli-lilly-and-company":  "eli-lilly",
  "loxo-oncology-inc":      "eli-lilly",

  // Gilead Sciences
  "kite-a-gilead-company":  "gilead-sciences",
  "kite-pharma":            "gilead-sciences",

  // Bayer
  "bayer-healthcare":          "bayer",
  "bayer-healthcare-ag":       "bayer",
  "bayer-healthcare-pharmaceuticals": "bayer",

  // Takeda
  "takeda-pharmaceuticals-international-ag":  "takeda",
  "shire":                                     "takeda",   // acquired 2019

  // Novo Nordisk
  "novo-nordisk-as":  "novo-nordisk",

  // Boehringer (TruNorth slug: boehringer-ingelheim-united-states)
  "boehringer-ingelheim":                 "boehringer-ingelheim-united-states",
  "boehringer-ingelheim-pharmaceuticals": "boehringer-ingelheim-united-states",

  // Vertex
  "vertex-pharmaceuticals-incorporated": "vertex-pharmaceuticals",

  // Regeneron
  "regeneron-pharmaceuticals": "regeneron",

  // Incyte
  "incyte-corporation":                    "incyte",
  "incyte-biosciences-international-sarl": "incyte",

  // ModernaTX
  "modernatx-inc": "moderna",

  // Daiichi Sankyo
  "daiichi-sankyo":         "daiichi-sankyo",   // direct; alias used by some sub records
  "daiichi-sankyo-co-ltd":  "daiichi-sankyo",
  "daiichi-sankyo-inc":     "daiichi-sankyo",

  // Teva
  "teva-branded-pharmaceutical-products-rd-inc":  "teva-pharmaceutical-industries",
  "teva-pharmaceuticals-usa":                     "teva-pharmaceutical-industries",
  "teva-pharmaceuticals":                         "teva-pharmaceutical-industries",

  // Eisai
  "eisai-inc":         "eisai",
  "eisai-co-ltd":      "eisai",

  // CSL
  "csl-behring":   "csl",
  "csl-limited":   "csl",
  "csl-seqirus":   "csl",
};

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Drop common corporate-suffix tokens from a slug, returning the most-
 * useful variants in order (most→least specific). Tokens are stripped one
 * at a time from the *end*; we yield the candidate after each strip so a
 * direct lookup can find e.g. "pfizer" from "pfizer-inc".
 *
 * Exported for tests.
 */
export function slugVariants(slug) {
  if (!slug) return [];
  const SUFFIX_TOKENS = [
    "inc", "incorporated", "corp", "corporation", "company", "co", "ltd",
    "limited", "llc", "lp", "llp", "plc", "ag", "as", "se", "sa", "nv",
    "bv", "kg", "kk", "gmbh", "sarl", "srl", "spa", "oy", "ab",
    "holdings", "holding", "group",
    "pharma", "pharmaceuticals", "pharmaceutical", "biotech", "biotechnology",
    "biosciences", "therapeutics", "biopharma", "biopharmaceuticals", "labs",
    "laboratories", "healthcare", "health", "medical", "medicines",
    "international", "global", "worldwide", "usa", "america",
  ];
  const seen = new Set();
  const out = [];
  let s = slug.toLowerCase().replace(/^-+|-+$/g, "");
  if (s) { seen.add(s); out.push(s); }
  // Iterate: trim trailing tokens up to 10 times.
  for (let i = 0; i < 10; i++) {
    let stripped = false;
    for (const tok of SUFFIX_TOKENS) {
      const re = new RegExp(`-${tok}$`);
      if (re.test(s)) { s = s.replace(re, ""); stripped = true; break; }
    }
    if (!stripped) break;
    s = s.replace(/^-+|-+$/g, "");
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * Resolve a TrialsTracker sponsor slug to a TruNorth slug.
 *   1. Direct match on full slug.
 *   2. Each suffix-stripped variant.
 *   3. FDAAA_ALIASES table.
 *   4. brand-parent-map fallback (on each variant).
 *
 * Returns { slug, routedVia } or { slug: null, routedVia: "orphan" }.
 *
 * Exported for tests.
 */
export function resolveSponsor(rawSlug, indexSlugs, parentMap, aliases = FDAAA_ALIASES) {
  if (!rawSlug) return { slug: null, routedVia: "orphan" };
  const lower = rawSlug.toLowerCase();

  // 1. Direct match
  if (indexSlugs.has(lower)) return { slug: lower, routedVia: "direct" };

  // 3. Alias table (try before suffix-strip so curated mappings win)
  if (aliases[lower] && indexSlugs.has(aliases[lower])) {
    return { slug: aliases[lower], routedVia: "alias" };
  }

  // 2. Suffix-stripped variants → direct
  const variants = slugVariants(lower);
  for (const v of variants) {
    if (v === lower) continue;
    if (indexSlugs.has(v)) return { slug: v, routedVia: "suffix" };
    if (aliases[v] && indexSlugs.has(aliases[v])) {
      return { slug: aliases[v], routedVia: "alias" };
    }
  }

  // 4. brand-parent-map
  for (const v of [lower, ...variants]) {
    const pm = parentMap[v];
    if (pm?.parent && indexSlugs.has(pm.parent)) {
      return { slug: pm.parent, routedVia: "brand-parent" };
    }
  }

  return { slug: null, routedVia: "orphan" };
}

// ─── aggregate helper ────────────────────────────────────────────────────
/**
 * Combine N sponsor records into one TruNorth-slug entry.
 * Sums trial counts; recomputes compliancePct from the summed totals;
 * keeps the most-recent year and a representative sourceUrl.
 *
 * Exported for tests.
 */
export function aggregateSponsors(sponsors) {
  let totalTrials = 0, totalTrialsKnown = false;
  let trialsDue = 0,    trialsDueKnown = false;
  let trialsReported = 0, trialsReportedKnown = false;
  let maxYear = null;
  let bestSource = null;

  for (const s of sponsors) {
    if (s.totalTrials != null) { totalTrials += s.totalTrials; totalTrialsKnown = true; }
    if (s.trialsDue != null)   { trialsDue += s.trialsDue;     trialsDueKnown = true; }
    if (s.trialsReported != null) { trialsReported += s.trialsReported; trialsReportedKnown = true; }
    if (s.year != null && (maxYear == null || s.year > maxYear)) maxYear = s.year;
    if (s.sourceUrl) bestSource = bestSource || s.sourceUrl;
  }

  const lateOrMissing = (trialsDueKnown && trialsReportedKnown)
    ? Math.max(0, trialsDue - trialsReported)
    : null;
  const compliancePct = (trialsDueKnown && trialsReportedKnown && trialsDue > 0)
    ? Math.floor(100 * trialsReported / trialsDue)
    : null;

  // When multiple subsidiaries roll up, point to the rankings index page
  // (the per-sponsor page is no longer canonical).
  const sourceUrl = sponsors.length > 1
    ? "https://fdaaa.trialstracker.net/rankings/"
    : (bestSource || "https://fdaaa.trialstracker.net/");

  return {
    totalTrials: totalTrialsKnown ? totalTrials : null,
    trialsLateOrMissing: lateOrMissing,
    compliancePct,
    year: maxYear,
    sourceUrl,
    _license: "Apache-2.0",
  };
}

// ─── I/O ─────────────────────────────────────────────────────────────────
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
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}; run fdaaa-trials-fetch.mjs first.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("FDAAA TrialsTracker merger");

  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const sponsors = raw.sponsors || [];
  console.log(`  ${sponsors.length} raw sponsor records`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap = await loadParentMap();
  console.log(`  Loaded ${indexSlugs.size} index slugs + ${Object.keys(parentMap).length} brand-parent entries`);

  // Group resolved sponsors by TruNorth slug
  const grouped = new Map();
  const orphans = [];
  const routedViaCounts = { direct: 0, suffix: 0, alias: 0, "brand-parent": 0, orphan: 0 };

  for (const s of sponsors) {
    const { slug, routedVia } = resolveSponsor(s.slug, indexSlugs, parentMap);
    routedViaCounts[routedVia]++;

    if (!slug) {
      // Only track industry orphans worth surfacing — i.e. with real
      // late/missing exposure.
      if (s.isIndustry && (s.trialsLateOrMissing || 0) > 0) {
        orphans.push({
          name: s.name,
          slug: s.slug,
          due: s.trialsDue,
          reported: s.trialsReported,
          lateOrMissing: s.trialsLateOrMissing,
          compliancePct: s.compliancePct,
        });
      }
      continue;
    }
    if (!grouped.has(slug)) grouped.set(slug, []);
    grouped.get(slug).push(s);
  }

  const bySlug = {};
  for (const [slug, list] of grouped.entries()) {
    bySlug[slug] = { health: aggregateSponsors(list) };
  }

  const output = {
    _license: "Apache-2.0",
    _generated_at: new Date().toISOString(),
    _source: SOURCE_URL,
    _source_raw_file: path.relative(ROOT, rawPath),
    _matched_slugs: Object.keys(bySlug).length,
    _routing_counts: routedViaCounts,
    _orphan_sponsors_top: orphans
      .sort((a, b) => (b.lateOrMissing || 0) - (a.lateOrMissing || 0))
      .slice(0, 50),
    bySlug,
  };

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs: ${Object.keys(bySlug).length}`);
  console.log(`  Routing: direct=${routedViaCounts.direct} suffix=${routedViaCounts.suffix} alias=${routedViaCounts.alias} brand-parent=${routedViaCounts["brand-parent"]} orphan=${routedViaCounts.orphan}`);

  // Top-5 worst compliance among matched slugs with meaningful exposure
  const worst = Object.entries(bySlug)
    .map(([slug, e]) => ({ slug, ...e.health }))
    .filter(x => x.compliancePct != null && (x.trialsLateOrMissing || 0) >= 2)
    .sort((a, b) => (a.compliancePct - b.compliancePct) || (b.trialsLateOrMissing - a.trialsLateOrMissing))
    .slice(0, 5);
  if (worst.length) {
    console.log("\nTop 5 worst-compliance matched pharma brands (>= 2 late/missing):");
    for (const w of worst) {
      console.log(`  ${String(w.compliancePct).padStart(3)}%  late=${w.trialsLateOrMissing}/${w.trialsLateOrMissing + (w.trialsLateOrMissing >= 0 ? 0 : 0)} totalTrials=${w.totalTrials}  ${w.slug}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("fdaaa-trials-merge failed:", err);
    process.exit(1);
  });
}
