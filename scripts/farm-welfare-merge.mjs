#!/usr/bin/env node
/**
 * Farm-welfare + sustainable-agriculture — merge step.
 *
 * Reads latest data/raw/farm-welfare/<date>.json and writes
 * data/derived/farm-welfare-augment.json keyed by TruNorth slug.
 *
 * Routing ladder per entry: slugHint → direct slug → alias → parent → orphan.
 *
 * Aggregation per slug:
 *   - certifications: dedup list of "BBFAW Tier 3", "GAP Step 4", "Cage-free
 *     fulfilled", etc. — the human-readable badges.
 *   - sources: dedup list of source keys present (bbfaw, fairr, msc, …).
 *   - bestStatus: derived rollup. "leader" | "positive" | "mixed" |
 *     "concern" — drives the sc enum in apply-augments. Rules:
 *        any (BBFAW Tier 6, FAIRR High risk, OWA At risk / Broken)
 *          → concern
 *        any (BBFAW Tier 5)            → mixed (unless overridden by positive)
 *        any (BBFAW Tier 4)            → mixed
 *        any (BBFAW Tier 1–2, GAP Step 4+, Real Organic, ROC,
 *             Demeter, MSC Retail partner, ASC, CIWF award)
 *          → leader   (if no concern)
 *        else                          → positive
 *     If both leader-signals AND concern-signals coexist (rare — Aldi
 *     BBFAW Tier 3 + OWA Fulfilled is positive, not concern), concern wins
 *     ONLY when one of the strong negatives is present (BBFAW Tier 6 or
 *     FAIRR High risk). Cage-free "at risk" downgrades a leader to mixed.
 *
 * Categories written:
 *   - animals      (primary — all sources)
 *   - environment  (Bonsucro, MSC, ASC, Real Organic, ROC, Demeter, Non-GMO)
 *   - labor        (Fairwear, FAIRR High risk on worker rights, CIWF dairy)
 *   - health       (Non-GMO Project, Real Organic, ROC — ingredient-level)
 *
 * Output shape (per spec, consumable by apply-augments-to-companies.mjs):
 *   companies: {
 *     "<slug>": {
 *       animals: {
 *         certifications: [...],
 *         sources: ["bbfaw","owa",...],
 *         bestStatus: "leader" | "positive" | "mixed" | "concern",
 *         narrativeParts: [...]              // joined into final narrative
 *       },
 *       environment?: { ... },               // same shape
 *       labor?:       { ... },
 *       health?:      { ... },
 *       _sources: ["farm-welfare"],
 *       _routedVia: "direct" | "alias" | "parent" | "slugHint",
 *       _entries: 3,
 *       _lastUpdated: <iso>
 *     }
 *   }
 *
 * Locally:
 *   node scripts/farm-welfare-merge.mjs
 *   node scripts/farm-welfare-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/farm-welfare");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "farm-welfare-augment.json");

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
  // Highest priority: explicit slugHint (curated). Trust but verify.
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

/**
 * Map a (source, tier, commitment) tuple to:
 *   - badge:        short human label for the certifications list
 *   - severity:     "leader" | "positive" | "mixed" | "concern"
 *   - categories:   ["animals","environment","labor","health"] — which
 *                   TruNorth value categories this entry feeds.
 */
export function classify(entry) {
  const { source, tier = "" } = entry;
  const t = String(tier).toLowerCase();

  switch (source) {
    case "bbfaw": {
      // Tier 6 = no evidence (concern), Tier 5 / 4 = mixed, Tier 1-3 = positive/leader
      if (/tier\s*6/.test(t)) return { badge: `BBFAW ${tier}`, severity: "concern", categories: ["animals"] };
      if (/tier\s*5/.test(t)) return { badge: `BBFAW ${tier}`, severity: "mixed",   categories: ["animals"] };
      if (/tier\s*4/.test(t)) return { badge: `BBFAW ${tier}`, severity: "mixed",   categories: ["animals"] };
      if (/tier\s*3/.test(t)) return { badge: `BBFAW ${tier}`, severity: "positive",categories: ["animals"] };
      if (/tier\s*2/.test(t)) return { badge: `BBFAW ${tier}`, severity: "leader",  categories: ["animals"] };
      if (/tier\s*1/.test(t)) return { badge: `BBFAW ${tier}`, severity: "leader",  categories: ["animals"] };
      return { badge: `BBFAW`, severity: "mixed", categories: ["animals"] };
    }
    case "fairr": {
      if (/high\s*risk/.test(t))   return { badge: `FAIRR High risk`,   severity: "concern",  categories: ["animals","labor","environment"] };
      if (/medium\s*risk/.test(t)) return { badge: `FAIRR Medium risk`, severity: "mixed",    categories: ["animals"] };
      if (/low\s*risk/.test(t))    return { badge: `FAIRR Low risk`,    severity: "leader",   categories: ["animals"] };
      return { badge: `FAIRR scored`, severity: "mixed", categories: ["animals"] };
    }
    case "gap": {
      // Step 4+ is the pasture / range threshold = leader
      if (/step\s*5/.test(t)) return { badge: `GAP Step 5+`, severity: "leader", categories: ["animals"] };
      if (/step\s*4/.test(t)) return { badge: `GAP Step 4`,  severity: "leader", categories: ["animals"] };
      if (/step\s*3/.test(t)) return { badge: `GAP Step 3`,  severity: "positive", categories: ["animals"] };
      if (/step\s*2/.test(t)) return { badge: `GAP Step 2`,  severity: "positive", categories: ["animals"] };
      if (/step\s*1/.test(t)) return { badge: `GAP Step 1+ (in-store)`, severity: "positive", categories: ["animals"] };
      return { badge: `GAP certified`, severity: "positive", categories: ["animals"] };
    }
    case "ciwf": {
      // Awarded = leader
      return { badge: `CIWF Award`, severity: "leader", categories: ["animals"] };
    }
    case "owa": {
      if (/fulfilled|100%/.test(t)) return { badge: `Cage-free fulfilled`, severity: "leader", categories: ["animals"] };
      if (/on\s*track/.test(t))     return { badge: `Cage-free on track`,  severity: "positive", categories: ["animals"] };
      if (/at\s*risk/.test(t))      return { badge: `Cage-free at risk`,   severity: "concern",  categories: ["animals"] };
      if (/broken/.test(t))         return { badge: `Cage-free broken pledge`, severity: "concern", categories: ["animals"] };
      return { badge: `Cage-free pledged`, severity: "positive", categories: ["animals"] };
    }
    case "real-organic":
      return { badge: `Real Organic Project certified`, severity: "leader", categories: ["animals","environment","health"] };
    case "regen-organic":
      return { badge: tier ? `Regenerative Organic Certified (${tier})` : `Regenerative Organic Certified`, severity: "leader", categories: ["animals","environment","health"] };
    case "demeter":
      return { badge: `Demeter Biodynamic`, severity: "leader", categories: ["animals","environment","health"] };
    case "non-gmo":
      return { badge: `Non-GMO Project Verified`, severity: "positive", categories: ["animals","health"] };
    case "msc":
      return { badge: `MSC certified`, severity: "leader", categories: ["animals","environment"] };
    case "asc":
      return { badge: `ASC certified`, severity: "leader", categories: ["animals","environment"] };
    case "bonsucro":
      return { badge: `Bonsucro member`, severity: "positive", categories: ["environment"] };
    case "fairwear":
      return { badge: `Fair Wear Foundation`, severity: "leader", categories: ["labor"] };
    default:
      return { badge: source, severity: "neutral", categories: [] };
  }
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
  console.log("farm-welfare merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run farm-welfare-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  // companies[slug] = { categories: { animals: {...}, ... }, _routedVia, _entries, _sources }
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
      _sources: ["farm-welfare"],
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
        // Cap narrative at the 2 most informative parts to keep card readable.
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
    console.error("farm-welfare-merge failed:", err);
    process.exit(1);
  });
}
