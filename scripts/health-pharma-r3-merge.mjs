#!/usr/bin/env node
/**
 * Health + pharma + food-safety + medical (round-3) — merge step.
 *
 * Reads latest data/raw/health-pharma-r3/<date>.json and writes
 * data/derived/health-pharma-r3-augment.json keyed by TruNorth slug.
 *
 * Routing ladder per entry: slugHint → direct slug → alias → parent → orphan.
 *
 * Per-slug aggregation:
 *   sources:        dedup list of source keys present
 *   findings:       list of { source, title, year, amountUsd?, severity }
 *   totalPenaltyUsd: summed amountUsd across all entries with $
 *   bestStatus:     severity rollup ("leader"|"positive"|"mixed"|"concern")
 *   narrative:      1-2 most-informative finding sentences joined
 *
 * Categories the merger writes — these mirror the rules in
 * apply-augments-to-companies.mjs:
 *   health   — all sources (this is the primary destination)
 *   privacy  — DOJ FCA + DEA enforcement (consumer-trust signals)
 *
 * Output shape (consumable by apply-augments-to-companies.mjs):
 *   companies: {
 *     "<slug>": {
 *       health: {
 *         certifications:  [],            // empty (concerns, not certs)
 *         findings:        [...],
 *         sources:         ["doj-fca-healthcare", "opioid-settlements", ...],
 *         bestStatus:      "concern" | "mixed" | "positive" | "leader",
 *         totalPenaltyUsd: number | null,
 *         narrative:       "..."
 *       },
 *       _sources: ["health-pharma-r3"],
 *       _innerSources: [...],
 *       _routedVia, _entries, _lastUpdated
 *     }
 *   }
 *
 * Locally:
 *   node scripts/health-pharma-r3-merge.mjs
 *   node scripts/health-pharma-r3-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/health-pharma-r3");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "health-pharma-r3-augment.json");

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

/**
 * Brand-name aliases for FCA/DEA/MAUDE entries where the source-as-published
 * name doesn't slugify to a known TruNorth slug. Curated, keep small.
 */
export const HP_ALIASES = {
  // Pharma — devices + drug-shortage manufacturer name variants
  "abbott-laboratories":              "abbott-laboratories",
  "baxter-healthcare-corp":           "baxter-international",
  "baxter-healthcare-corporation":    "baxter-international",
  "baxter-international-inc":         "baxter-international",
  "medtronic-inc":                    "medtronic",
  "medtronic-plc":                    "medtronic",
  "boston-scientific-corporation":    "boston-scientific",
  "stryker-corporation":              "stryker",
  "johnson-and-johnson-medical":      "johnson-and-johnson",
  "ethicon-inc":                      "johnson-and-johnson",
  "depuy-synthes":                    "johnson-and-johnson",
  "intuitive-surgical-inc":           "intuitive-surgical",
  "edwards-lifesciences-corporation": "edwards-lifesciences",
  "philips-respironics":              "koninklijke-philips-nv",
  "koninklijke-philips-n-v":          "koninklijke-philips-nv",
  "philips":                          "koninklijke-philips-nv",
  "ge-healthcare":                    "ge-healthcare",
  "siemens-healthineers":             "siemens",
  "becton-dickinson-and-company":     "becton-dickinson",
  "b-d":                              "becton-dickinson",
  "abbott":                           "abbott-laboratories",
  "abbott-diabetes-care":             "abbott-laboratories",
  "british-american-tobacco":         "british-american-tobacco-p-l-c",
  "british-american-tobacco-plc":     "british-american-tobacco-p-l-c",
  "r-j-reynolds-tobacco":             "british-american-tobacco-p-l-c",
  "boehringer-ingelheim":             "boehringer-ingelheim-united-states",
  "boehringer-ingelheim-pharmaceuticals": "boehringer-ingelheim-united-states",
  "indivior":                         "indivior-pharmaceuticals",
  "medtronic-puerto-rico-operations-co": "medtronic",
  "medtronic-vascular":               "medtronic",
  "ethicon":                          "johnson-and-johnson",
  "fresenius-medical-care":           "fresenius-kabi-united-states",
  "fresenius-kabi-usa":               "fresenius-kabi-united-states",
  "fresenius-kabi-llc":               "fresenius-kabi-united-states",
  "hospira-inc":                      "pfizer",
  "hospira-inc-a-pfizer-company":     "pfizer",
  "hospira":                          "pfizer",
  "pfizer-inc":                       "pfizer",
  "wyeth-pharmaceuticals-inc":        "pfizer",
  "baxter-healthcare":                "baxter-international",
  "sandoz-inc":                       "novartis",
  "novartis-pharmaceuticals":         "novartis",
  "novartis-pharmaceuticals-corp":    "novartis",
  "genentech-inc":                    "roche",
  "hoffmann-la-roche":                "roche",
  "merck-sharp-and-dohme-llc":        "merck-and-co",
  "merck-sharp-dohme":                "merck-and-co",
  "msd":                              "merck-and-co",
  "eli-lilly-and-company":            "eli-lilly",
  "lilly":                            "eli-lilly",
  "moderna-inc":                      "moderna",
  "modernatx-inc":                    "moderna",
  "astrazeneca-pharmaceuticals":      "astrazeneca",
  "astrazeneca-lp":                   "astrazeneca",
  "sanofi-pasteur":                   "sanofi",
  "sanofi-aventis-u-s-llc":           "sanofi",
  "glaxosmithkline":                  "gsk",
  "glaxosmithkline-llc":              "gsk",
  "bristol-myers-squibb-company":     "bristol-myers-squibb",
  // Pharma chains
  "walgreen-co":                      "walgreens",
  "walgreens-boots-alliance":         "walgreens",
  "cvs-pharmacy":                     "cvs-health",
  "cvs-caremark":                     "cvs-health",
  "rite-aid-corporation":             "rite-aid",
  // Distributors
  "mckesson-corporation":             "mckesson",
  "cardinal-health-inc":              "cardinal-health",
  "amerisourcebergen-corp":           "amerisourcebergen",
  "amerisourcebergen-corporation":    "amerisourcebergen",
  // Insurers
  "humana-inc":                       "humana",
  "anthem-inc":                       "anthem-elevance-health",
  "elevance-health":                  "anthem-elevance-health",
  "centene-corp":                     "centene",
  "centene-corporation":              "centene",
  "cigna-corporation":                "cigna",
  // Food
  "tyson-fresh-meats":                "tyson-foods",
  "tyson-foods-inc":                  "tyson-foods",
  "jbs-usa-food-company":             "jbs-n-v",
  "jbs-usa":                          "jbs-n-v",
  "jbs-foods-usa":                    "jbs-n-v",
  "cargill-meat-solutions":           "cargill",
  "cargill-inc":                      "cargill",
  "conagra-foods":                    "conagra-brands",
  "perdue-foods":                     "perdue-foods",
  "perdue-farms-inc":                 "perdue-foods",
  // Tobacco
  "altria":                           "altria-group",
  "altria-client-services":           "altria-group",
  "philip-morris-usa":                "altria-group",
  "philip-morris":                    "philip-morris-international",
  "philip-morris-international-inc":  "philip-morris-international",
  "juul":                             "juul-labs",
  // Endo / Mallinckrodt / etc
  "endo-international-plc":           "endo-health-solutions",
  "endo-pharmaceuticals":             "endo-health-solutions",
  "mallinckrodt-plc":                 "mallinckrodt",
  "mallinckrodt-pharmaceuticals":     "mallinckrodt",
  // GSK alternative spellings
  "gsk-plc":                          "gsk",
  "glaxo-smith-kline":                "gsk",
};

export function resolveBrand(entry, { knownSlugs, aliases, parents }) {
  if (entry.slugHint && knownSlugs.has(entry.slugHint)) {
    return { slug: entry.slugHint, routedVia: "slugHint" };
  }
  // slugHint set but unknown — also try HP_ALIASES on the hint itself
  if (entry.slugHint && HP_ALIASES[entry.slugHint] && knownSlugs.has(HP_ALIASES[entry.slugHint])) {
    return { slug: HP_ALIASES[entry.slugHint], routedVia: "hpAlias" };
  }
  const raw = slugify(entry.brand);
  if (!raw) return { slug: null, routedVia: "orphan" };
  if (knownSlugs.has(raw)) return { slug: raw, routedVia: "direct" };
  // Curated health-pharma aliases
  if (HP_ALIASES[raw] && knownSlugs.has(HP_ALIASES[raw])) {
    return { slug: HP_ALIASES[raw], routedVia: "hpAlias" };
  }
  // Project slug-aliases.json
  if (aliases[raw] && knownSlugs.has(aliases[raw])) {
    return { slug: aliases[raw], routedVia: "alias" };
  }
  // Brand-parent fallback
  if (parents[raw]?.parent && knownSlugs.has(parents[raw].parent)) {
    return { slug: parents[raw].parent, routedVia: "parent" };
  }
  // Suffix peel: try stripping common corporate suffixes
  const peeled = raw
    .replace(/-(inc|corp|corporation|llc|llp|plc|ltd|company|co|sa|nv|ag|gmbh|kk|lp)$/i, "")
    .replace(/-(pharmaceuticals?|pharma|healthcare|health)$/i, "");
  if (peeled !== raw) {
    if (knownSlugs.has(peeled)) return { slug: peeled, routedVia: "suffix" };
    if (HP_ALIASES[peeled] && knownSlugs.has(HP_ALIASES[peeled])) {
      return { slug: HP_ALIASES[peeled], routedVia: "hpAlias" };
    }
  }
  return { slug: null, routedVia: "orphan" };
}

const SEVERITY_RANK = { concern: 0, mixed: 1, positive: 2, leader: 3 };

export function rollupSeverity(tags) {
  if (!tags || tags.length === 0) return null;
  const hasConcern = tags.includes("concern");
  const hasLeader  = tags.includes("leader") || tags.includes("positive");
  if (hasConcern && hasLeader) return "mixed";
  if (hasConcern) return "concern";
  let best = "mixed";
  for (const t of tags) if (SEVERITY_RANK[t] > SEVERITY_RANK[best]) best = t;
  return best;
}

function fmtUsd(n) {
  if (n == null) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log("health-pharma-r3 merge starting…");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run health-pharma-r3-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = { slugHint: 0, direct: 0, hpAlias: 0, alias: 0, parent: 0, suffix: 0, orphan: 0 };

  for (const e of raw.entries || []) {
    const { slug, routedVia } = resolveBrand(e, { knownSlugs, ...maps });
    routeCounts[routedVia] = (routeCounts[routedVia] || 0) + 1;
    if (!slug) {
      orphans.push({ brand: e.brand, source: e.source, severity: e.severity, year: e.year, title: e.title });
      continue;
    }
    let cur = companies[slug];
    if (!cur) {
      cur = companies[slug] = {
        findings: [],
        severityTags: [],
        sourcesSet: new Set(),
        totalPenaltyUsd: 0,
        hasPenalty: false,
        _routedVia: routedVia,
        _entries: 0,
        _lastUpdated: now.toISOString(),
      };
    }
    cur._entries++;
    cur.sourcesSet.add(e.source);
    cur.findings.push({
      source: e.source,
      severity: e.severity,
      title: e.title || null,
      year: e.year || null,
      amountUsd: e.amountUsd || null,
      sourceUrl: e.sourceUrl,
    });
    cur.severityTags.push(e.severity);
    if (typeof e.amountUsd === "number" && e.amountUsd > 0) {
      cur.totalPenaltyUsd += e.amountUsd;
      cur.hasPenalty = true;
    }
    const RANK = { slugHint: 0, direct: 0, hpAlias: 1, alias: 1, suffix: 2, parent: 3, orphan: 9 };
    if ((RANK[routedVia] ?? 9) < (RANK[cur._routedVia] ?? 9)) cur._routedVia = routedVia;
  }

  // Finalize
  const companiesOut = {};
  for (const [slug, c] of Object.entries(companies)) {
    const bestStatus = rollupSeverity(c.severityTags);
    // Pick the 2 most-informative narratives: prefer biggest-$ concerns, then leaders/positives.
    const sortedFindings = [...c.findings].sort((a, b) => {
      const aS = SEVERITY_RANK[a.severity] ?? 9;
      const bS = SEVERITY_RANK[b.severity] ?? 9;
      if (aS !== bS) return aS - bS;
      const aA = a.amountUsd || 0;
      const bA = b.amountUsd || 0;
      return bA - aA;
    });
    const top = sortedFindings.slice(0, 2);
    const narrativeParts = [];
    for (const f of top) {
      if (!f.title) continue;
      const amt = f.amountUsd ? ` (${fmtUsd(f.amountUsd)})` : "";
      narrativeParts.push(`${f.title}${amt}.`);
    }
    let narrative = narrativeParts.join(" ").trim();
    // If multiple findings spanning sources, append a roll-up line.
    if (c.findings.length > 2) {
      const more = c.findings.length - 2;
      narrative += ` Plus ${more} other public-record finding${more === 1 ? "" : "s"} across ${c.sourcesSet.size} source${c.sourcesSet.size === 1 ? "" : "s"}.`;
    }

    companiesOut[slug] = {
      _sources: ["health-pharma-r3"],
      _innerSources: [...c.sourcesSet].sort(),
      _routedVia: c._routedVia,
      _entries: c._entries,
      _lastUpdated: c._lastUpdated,
      health: {
        certifications: [],
        findings: c.findings,
        sources: [...c.sourcesSet].sort(),
        bestStatus,
        totalPenaltyUsd: c.hasPenalty ? c.totalPenaltyUsd : null,
        narrative,
      },
    };
  }

  const payload = {
    _license: raw._license,
    _source_file: path.relative(ROOT, rawFile),
    _source_urls: raw._source_urls,
    _generated_at: now.toISOString(),
    _stats: {
      raw_entries:        raw.entries?.length || 0,
      matched_companies:  Object.keys(companiesOut).length,
      route_counts:       routeCounts,
      orphans:            orphans.length,
    },
    companies: companiesOut,
    orphans: orphans.slice(0, 500),
    orphan_total: orphans.length,
  };

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  console.log(`\nRaw entries:        ${payload._stats.raw_entries}`);
  console.log(`Matched companies:  ${payload._stats.matched_companies}`);
  console.log(`Route counts:`, routeCounts);
  console.log(`Orphans:            ${orphans.length}`);
  console.log(`\nWrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("health-pharma-r3-merge failed:", err);
    process.exit(1);
  });
}
