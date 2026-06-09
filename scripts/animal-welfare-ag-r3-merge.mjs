#!/usr/bin/env node
/**
 * Animal welfare + agricultural accountability — Round 3 merge step.
 *
 * Reads latest data/raw/animal-welfare-ag-r3/<date>.json and writes
 * data/derived/animal-welfare-ag-r3-augment.json keyed by TruNorth slug.
 *
 * Routing ladder per entry: slugHint → direct → alias → parent → orphan.
 *
 * Aggregation per slug:
 *   - certifications: dedup list of "Certified Humane", "NRDC A", etc.
 *   - sources:        dedup list of inner source keys.
 *   - bestStatus:     "leader" | "positive" | "mixed" | "concern"
 *
 * Severity rules (per source):
 *   certified-humane / awi-cert / ag-grassfed / bap / salmon-safe / bee-better /
 *   audubon-beef / soil-association / naturland / seafood-watch / fishwise /
 *   greenseal / ecologo / c2c / cradle-to-cradle
 *       → leader (positive certification, binary)
 *   mfa/thl/ciwf-chicken-track Fulfilled/Leader → leader
 *   mfa/thl/ciwf-chicken-track On track          → positive
 *   mfa/thl/ciwf-chicken-track Behind/At risk    → mixed
 *   mfa/thl/ciwf-chicken-track No commitment / Public campaign target → concern
 *   nrdc-chain                  A / A-           → leader
 *                               B-range          → positive
 *                               C-range          → mixed
 *                               D / F            → concern
 *   pew-abx Antibiotic-free Leader / chicken     → leader
 *                                  partial       → positive
 *   fep-chocolate Recommended                    → leader
 *                 Not Recommended                → concern
 *   slave-free-choc Scorecard Leader             → leader
 *                   Watch List                   → concern
 *   cocoa-barometer 5/5                          → leader
 *                   4/5                          → positive
 *                   3/5                          → mixed
 *                   2/5 / 1/5                    → concern
 *   tff-scorecard A / A-                         → leader
 *                 B-range                        → positive
 *                 C-range                        → mixed
 *                 D / F                          → concern
 *   ceh-alerts PFAS warning / settlement / BPA   → concern
 *   pfas-project Manufacturer (any) / Product PFAS → concern
 *   ewg-skindeep EWG Verified (and partial)      → leader / positive
 *                Mixed                           → mixed
 *                High-hazard                     → concern
 *
 * Categories written (per source):
 *   animals      — Certified Humane / AWI / AGA / BAP / Salmon-Safe / Bee Better /
 *                  Audubon / MFA / THL / Animal Equality / WAP / CIWF / Seafood
 *                  Watch / FishWise / NRDC / Pew / Cocoa-Barometer / SFCh / FEP
 *                  (wherever animals are involved)
 *   environment  — Salmon-Safe / Bee Better / Audubon / Soil Association /
 *                  Naturland / Greenseal / Ecologo / C2C / Seafood Watch /
 *                  FishWise / BAP / TFF / CEH / PFAS Project / EWG (chemicals)
 *   labor        — FEP Chocolate List / Slave Free Chocolate / Cocoa Barometer
 *   health       — Certified Humane / Naturland / Soil Association / EWG /
 *                  PFAS Project / CEH / NRDC (antibiotic resistance) / Pew /
 *                  TFF (consumer toxics)
 *
 * Output (same shape as farm-welfare-augment.json):
 *   companies: {
 *     "<slug>": {
 *       animals?:     { certifications, sources, bestStatus, narrative },
 *       environment?: { ... },
 *       labor?:       { ... },
 *       health?:      { ... },
 *       _sources:     ["animal-welfare-ag-r3"],
 *       _innerSources: [...],
 *       _routedVia:   "slugHint" | "direct" | "alias" | "parent",
 *       _entries:     n,
 *       _lastUpdated: <iso>
 *     }
 *   }
 *
 * Locally:
 *   node scripts/animal-welfare-ag-r3-merge.mjs
 *   node scripts/animal-welfare-ag-r3-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/animal-welfare-ag-r3");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "animal-welfare-ag-r3-augment.json");

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
  // slugHint wins if it points at a known slug.
  if (entry.slugHint && knownSlugs.has(entry.slugHint)) {
    return { slug: entry.slugHint, routedVia: "slugHint" };
  }
  const raw = slugify(entry.brand);
  if (raw && knownSlugs.has(raw)) return { slug: raw, routedVia: "direct" };
  if (raw && aliases[raw] && knownSlugs.has(aliases[raw])) {
    return { slug: aliases[raw], routedVia: "alias" };
  }
  if (raw && parents[raw]?.parent && knownSlugs.has(parents[raw].parent)) {
    return { slug: parents[raw].parent, routedVia: "parent" };
  }
  return { slug: null, routedVia: "orphan" };
}

/* ------------------------- per-source classifiers ----------------------- */

/** "B+" → numeric rank where A+ = 4.3, F = 0. Used for NRDC + TFF letter grades. */
function letterGradeRank(tier) {
  const t = String(tier).trim().toUpperCase();
  // Strip trailing words (e.g. "C+ (chicken only)") and grab the leading grade
  const m = t.match(/^([A-F])([+\-])?/);
  if (!m) return null;
  const letterMap = { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 };
  let v = letterMap[m[1]];
  if (v == null) return null;
  if (m[2] === "+") v += 0.3;
  if (m[2] === "-") v -= 0.3;
  return v;
}

function gradeSeverity(rank) {
  if (rank == null) return "mixed";
  if (rank >= 3.7) return "leader";   // A-, A, A+
  if (rank >= 2.7) return "positive"; // B-, B, B+
  if (rank >= 1.7) return "mixed";    // C-, C, C+
  return "concern";                   // D-/D/D+/F
}

/** Cocoa Barometer "N/5 transparency" → severity. */
function cocoaBarometerSeverity(tier) {
  const m = String(tier).match(/(\d)\s*\/\s*5/);
  if (!m) return "mixed";
  const n = Number(m[1]);
  if (n >= 5) return "leader";
  if (n >= 4) return "positive";
  if (n >= 3) return "mixed";
  return "concern";
}

const LEADER_BINARY_SOURCES = new Set([
  "certified-humane", "awi-cert", "ag-grassfed", "bap", "salmon-safe",
  "bee-better", "audubon-beef", "soil-association", "naturland",
  "seafood-watch", "fishwise", "greenseal", "ecologo", "c2c",
]);

const SOURCE_CATEGORIES = {
  "certified-humane":   ["animals","health"],
  "awi-cert":           ["animals"],
  "ag-grassfed":        ["animals","environment"],
  "bap":                ["animals","environment"],
  "salmon-safe":        ["environment","animals"],
  "bee-better":         ["environment","animals"],
  "audubon-beef":       ["animals","environment"],
  "soil-association":   ["environment","health","animals"],
  "naturland":          ["environment","health","animals"],
  "seafood-watch":      ["animals","environment"],
  "fishwise":           ["animals","environment"],
  "mfa":                ["animals"],
  "thl":                ["animals"],
  "animal-equality":    ["animals"],
  "wap":                ["animals"],
  "ciwf-chicken-track": ["animals"],
  "nrdc-chain":         ["animals","health"],
  "pew-abx":            ["animals","health"],
  "fep-chocolate":      ["labor"],
  "slave-free-choc":    ["labor"],
  "cocoa-barometer":    ["labor"],
  "tff-scorecard":      ["health","environment"],
  "ceh-alerts":         ["health","environment"],
  "pfas-project":       ["health","environment"],
  "greenseal":          ["environment"],
  "ecologo":            ["environment"],
  "c2c":                ["environment"],
  "ewg-skindeep":       ["health"],
};

/**
 * Map a (source, tier, commitment) tuple to:
 *   - badge:        short human label for the certifications list
 *   - severity:     "leader" | "positive" | "mixed" | "concern"
 *   - categories:   ["animals","environment","labor","health"]
 */
export function classify(entry) {
  const { source, tier = "" } = entry;
  const t = String(tier).toLowerCase();
  const cats = SOURCE_CATEGORIES[source] || [];

  // Binary certification sources — always leader.
  if (LEADER_BINARY_SOURCES.has(source)) {
    const labelMap = {
      "certified-humane":   "Certified Humane",
      "awi-cert":           "AWI recommended",
      "ag-grassfed":        "American Grassfed",
      "bap":                "BAP certified",
      "salmon-safe":        "Salmon-Safe",
      "bee-better":         "Bee Better",
      "audubon-beef":       "Audubon Bird-Friendly Beef",
      "soil-association":   "Soil Association organic",
      "naturland":          "Naturland",
      "seafood-watch":      "Seafood Watch partner",
      "fishwise":           "FishWise partner",
      "greenseal":          "Green Seal",
      "ecologo":            "UL EcoLogo",
      "c2c":                tier ? `C2C ${tier.replace(/^C2C\s*/i, "")}` : "Cradle to Cradle",
    };
    return { badge: labelMap[source] || source, severity: "leader", categories: cats };
  }

  switch (source) {
    case "mfa":
    case "thl":
    case "ciwf-chicken-track": {
      if (/fulfilled|leader/.test(t)) return { badge: `${badgePrefix(source)} fulfilled`, severity: "leader", categories: cats };
      if (/on\s*track/.test(t))       return { badge: `${badgePrefix(source)} on track`,  severity: "positive", categories: cats };
      if (/behind|at\s*risk/.test(t)) return { badge: `${badgePrefix(source)} behind`,    severity: "mixed",    categories: cats };
      if (/no\s*commitment|public\s*campaign\s*target/.test(t))
                                      return { badge: `${badgePrefix(source)} no commitment`, severity: "concern", categories: cats };
      return { badge: badgePrefix(source), severity: "mixed", categories: cats };
    }
    case "animal-equality":
      return { badge: "Animal Equality target", severity: "concern", categories: cats };
    case "wap": {
      if (/leader/.test(t))   return { badge: "WAP Leader", severity: "leader", categories: cats };
      if (/mixed/.test(t))    return { badge: "WAP Mixed",  severity: "mixed",  categories: cats };
      return { badge: "WAP Behind", severity: "concern", categories: cats };
    }
    case "nrdc-chain": {
      const rank = letterGradeRank(tier);
      return { badge: `NRDC Chain Reaction ${tier}`, severity: gradeSeverity(rank), categories: cats };
    }
    case "tff-scorecard": {
      const rank = letterGradeRank(tier);
      return { badge: `Mind The Store ${tier}`, severity: gradeSeverity(rank), categories: cats };
    }
    case "pew-abx": {
      if (/leader/.test(t)) return { badge: "Pew antibiotic-free Leader", severity: "leader", categories: cats };
      if (/partial/.test(t)) return { badge: "Pew antibiotic-free partial", severity: "positive", categories: cats };
      return { badge: "Pew antibiotic-free chicken", severity: "positive", categories: cats };
    }
    case "fep-chocolate": {
      if (/not\s*recommended/.test(t)) return { badge: "FEP Not Recommended", severity: "concern", categories: cats };
      return { badge: "FEP Recommended", severity: "leader", categories: cats };
    }
    case "slave-free-choc": {
      if (/leader/.test(t)) return { badge: "Slave Free Chocolate Leader", severity: "leader", categories: cats };
      return { badge: "Slave Free Chocolate Watch List", severity: "concern", categories: cats };
    }
    case "cocoa-barometer": {
      return { badge: `Cocoa Barometer ${tier}`, severity: cocoaBarometerSeverity(tier), categories: cats };
    }
    case "ceh-alerts": {
      return { badge: `CEH ${tier || "alert"}`, severity: "concern", categories: cats };
    }
    case "pfas-project": {
      return { badge: `PFAS ${tier || "concern"}`, severity: "concern", categories: cats };
    }
    case "ewg-skindeep": {
      if (/verified/.test(t)) {
        const sev = /selected\s*sk/.test(t) ? "positive" : "leader";
        return { badge: "EWG Verified", severity: sev, categories: cats };
      }
      if (/mixed/.test(t)) return { badge: "EWG Skin Deep Mixed", severity: "mixed", categories: cats };
      if (/high\s*hazard/.test(t)) return { badge: "EWG Skin Deep High hazard", severity: "concern", categories: cats };
      return { badge: "EWG Skin Deep", severity: "mixed", categories: cats };
    }
    default:
      return { badge: source, severity: "mixed", categories: cats };
  }
}

function badgePrefix(source) {
  return ({
    "mfa": "MFA",
    "thl": "THL",
    "ciwf-chicken-track": "CIWF ChickenTrack",
  })[source] || source;
}

const SEVERITY_RANK = { concern: 0, mixed: 1, positive: 2, leader: 3 };

/**
 * Roll up a list of severity tags into a single bestStatus. Rules:
 *   - If ANY tag is "concern" AND ANY tag is "leader|positive": "mixed"
 *   - If ANY tag is "concern" AND all others are "mixed|concern":  "concern"
 *   - Otherwise pick the highest-ranked tag (leader > positive > mixed).
 */
export function rollupSeverity(tags) {
  if (!tags || tags.length === 0) return null;
  const hasConcern  = tags.includes("concern");
  const hasUpside   = tags.includes("leader") || tags.includes("positive");
  if (hasConcern && hasUpside) return "mixed";
  if (hasConcern) return "concern";
  let best = "mixed";
  for (const t of tags) {
    if (SEVERITY_RANK[t] > SEVERITY_RANK[best]) best = t;
  }
  return best;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log("animal-welfare-ag-r3 merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run animal-welfare-ag-r3-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = { slugHint: 0, direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const e of raw.entries || []) {
    const { slug, routedVia } = resolveBrand(e, { knownSlugs, ...maps });
    routeCounts[routedVia]++;
    if (!slug) {
      orphans.push({ brand: e.brand, source: e.source, tier: e.tier || null });
      continue;
    }
    const classification = classify(e);
    if (!classification.categories.length) continue;

    let cur = companies[slug];
    if (!cur) {
      cur = companies[slug] = {
        categories: {},
        _routedVia: routedVia,
        _entries: 0,
        _sources: new Set(),
        _lastUpdated: now.toISOString(),
      };
    }
    cur._entries += 1;
    cur._sources.add(e.source);

    // Promote routedVia (slugHint and direct are equivalent rank).
    const RANK = { slugHint: 0, direct: 0, alias: 1, parent: 2, orphan: 9 };
    if (RANK[routedVia] < RANK[cur._routedVia]) cur._routedVia = routedVia;

    for (const cat of classification.categories) {
      let bucket = cur.categories[cat];
      if (!bucket) {
        bucket = cur.categories[cat] = {
          certifications: [],
          sources: [],
          severityTags: [],
          narrativeParts: [],
        };
      }
      if (!bucket.certifications.includes(classification.badge)) {
        bucket.certifications.push(classification.badge);
      }
      if (!bucket.sources.includes(e.source)) {
        bucket.sources.push(e.source);
      }
      bucket.severityTags.push(classification.severity);
      if (e.commitment && !bucket.narrativeParts.includes(e.commitment)) {
        bucket.narrativeParts.push(e.commitment);
      }
    }
  }

  // Finalize for JSON serialization (Set → array).
  const companiesOut = {};
  for (const [slug, c] of Object.entries(companies)) {
    const flat = {
      _sources: ["animal-welfare-ag-r3"],
      _innerSources: [...c._sources].sort(),
      _routedVia: c._routedVia,
      _entries: c._entries,
      _lastUpdated: c._lastUpdated,
    };
    for (const [cat, b] of Object.entries(c.categories)) {
      flat[cat] = {
        certifications: b.certifications,
        sources: b.sources,
        bestStatus: rollupSeverity(b.severityTags),
        narrative: b.narrativeParts.slice(0, 2).join(" "),
      };
    }
    companiesOut[slug] = flat;
  }

  const payload = {
    _license: raw._license,
    _source_file: path.relative(ROOT, rawFile),
    _source_urls: raw._source_urls,
    _generated_at: now.toISOString(),
    _stats: {
      raw_entries: raw.entries?.length || 0,
      matched_companies: Object.keys(companiesOut).length,
      routed_slugHint: routeCounts.slugHint,
      routed_direct: routeCounts.direct,
      routed_alias: routeCounts.alias,
      routed_parent: routeCounts.parent,
      orphans: routeCounts.orphan,
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
  console.log(`  slugHint:         ${routeCounts.slugHint}`);
  console.log(`  direct:           ${routeCounts.direct}`);
  console.log(`  alias:            ${routeCounts.alias}`);
  console.log(`  parent:           ${routeCounts.parent}`);
  console.log(`Orphans:            ${routeCounts.orphan}`);
  console.log(`\nWrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("animal-welfare-ag-r3-merge failed:", err);
    process.exit(1);
  });
}
