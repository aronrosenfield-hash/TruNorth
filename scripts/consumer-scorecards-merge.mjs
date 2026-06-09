#!/usr/bin/env node
/**
 * Consumer-facing scorecards + boycott databases — Round 4 merge step.
 *
 * Reads latest data/raw/consumer-scorecards/<date>.json and writes
 * data/derived/consumer-scorecards-augment.json keyed by TruNorth slug.
 *
 * Routing ladder per entry: slugHint → direct → alias → parent → orphan.
 *
 * Aggregation per slug:
 *   - per-category narratives + bestStatus
 *   - dedup list of badges (e.g. "Goods Unite Us A", "Good On You Great")
 *   - dedup list of inner sources
 *
 * Severity rules (per source):
 *
 *   goods-unite-us       — political signal, NOT severity-positive/negative.
 *                          A / A-  → "left"
 *                          B+ / B  → "left-leaning"
 *                          B-      → "left-leaning"  (donor lean still Dem
 *                                                     but smaller margin)
 *                          C       → "bipartisan"
 *                          C- / D+ → "right-leaning"
 *                          D / D-  → "right-leaning"
 *                          F       → "right"
 *
 *   ethical-consumer     — Best Buy        → leader
 *                          Recommended     → positive
 *                          Avoid           → concern
 *
 *   donegood             — Marketplace     → positive (binary inclusion)
 *
 *   goodonyou            — Great           → leader
 *                          Good            → positive
 *                          It's a Start    → mixed
 *                          Not Good Enough → concern
 *                          We Avoid        → concern
 *
 *   buycott              — All listings    → mixed  (activist editorial,
 *                                                    not enforcement)
 *
 *   as-you-sow-funds     — Fossil-Free fail            → concern (env)
 *                          Tobacco-Free fail            → concern (health)
 *                          Weapons-Free fail            → concern (guns/labor)
 *                          Civilian Firearm fail        → makes_guns (guns)
 *                          Prison-Free fail             → concern (labor)
 *                          Deforestation-Free fail      → concern (env)
 *                          Gender Equality leader       → positive (dei)
 *
 *   fossil-free-funds    — Carbon Underground 200      → concern (env)
 *
 *   adl-tech             — F / D-/ D / D+ → concern (privacy)
 *                          C-/C/C+         → mixed
 *                          B-/B/B+         → positive
 *                          A-/A/A+         → leader
 *
 *   drawdown-solutions   — All listings    → positive (env)
 *
 * Categories written per source (env = environment):
 *   goods-unite-us       → political
 *   ethical-consumer     → environment, labor, animals  (multi-issue)
 *   donegood             → environment, labor           (curated ethical)
 *   goodonyou            → environment, labor, animals  (fashion multi)
 *   buycott              → political                    (cause-driven boycott)
 *                        + animals (if "Animal testing" cause)
 *                        + environment (if "Climate" cause)
 *                        + guns (if "Firearm" cause)
 *   as-you-sow-funds     → environment (Fossil/Deforestation/Carbon)
 *                        + health (Tobacco)
 *                        + guns (Weapons / Civilian Firearm)
 *                        + labor (Prison)
 *                        + dei (Gender Equality)
 *   fossil-free-funds    → environment
 *   adl-tech             → privacy
 *   drawdown-solutions   → environment
 *
 * Output (compatible with apply-augments-to-companies.mjs):
 *   companies: {
 *     "<slug>": {
 *       political?:    { badges, sources, bestStatus, narrative },
 *       environment?:  { ... },
 *       labor?:        { ... },
 *       animals?:      { ... },
 *       guns?:         { ... },
 *       privacy?:      { ... },
 *       health?:       { ... },
 *       dei?:          { ... },
 *       _sources:      ["consumer-scorecards"],
 *       _innerSources: [...],
 *       _routedVia:    "slugHint" | "direct" | "alias" | "parent",
 *       _entries:      n,
 *       _lastUpdated:  <iso>
 *     }
 *   }
 *
 * Locally:
 *   node scripts/consumer-scorecards-merge.mjs
 *   node scripts/consumer-scorecards-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/consumer-scorecards");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "consumer-scorecards-augment.json");

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

/* ------------------------- per-source classifier ----------------------- */

/** "B+" → numeric rank. */
function letterGradeRank(tier) {
  const t = String(tier).trim().toUpperCase();
  const m = t.match(/^([A-F])([+\-])?/);
  if (!m) return null;
  const letterMap = { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 };
  let v = letterMap[m[1]];
  if (v == null) return null;
  if (m[2] === "+") v += 0.3;
  if (m[2] === "-") v -= 0.3;
  return v;
}

/** ADL-style A–F: lower = worse. */
function adlSeverity(rank) {
  if (rank == null) return "mixed";
  if (rank >= 3.7) return "leader";
  if (rank >= 2.7) return "positive";
  if (rank >= 1.7) return "mixed";
  return "concern";
}

/** Goods Unite Us political lean from A–F. */
function goodsUniteUsLean(tier) {
  const rank = letterGradeRank(tier);
  if (rank == null) return "bipartisan";
  if (rank >= 3.7) return "left";          // A-, A, A+
  if (rank >= 2.7) return "left-leaning";  // B-, B, B+
  if (rank >= 2.0) return "bipartisan";    // C, C+
  if (rank >= 1.0) return "right-leaning"; // C-, D, D+
  return "right";                          // D-, F
}

/**
 * Classify one entry. Returns { perCategory: { <cat>: {badge,severity,sc?} } }.
 * `sc` is set only when the source maps directly to a TruNorth enum value
 * (political lean, makes_guns/sells_guns). For severity-style fields, the
 * writer in apply-augments-to-companies.mjs converts severity → sc.
 */
export function classify(entry) {
  const { source, tier = "", cause } = entry;
  const t = String(tier).toLowerCase();
  const out = {};

  switch (source) {
    case "goods-unite-us": {
      const lean = goodsUniteUsLean(tier);
      out.political = {
        badge: `Goods Unite Us ${tier}`,
        severity: lean === "left" || lean === "right" ? "mixed" : "neutral",
        sc: lean,
      };
      break;
    }
    case "ethical-consumer": {
      let severity;
      if (/best buy/i.test(t))     severity = "leader";
      else if (/recommended/i.test(t)) severity = "positive";
      else if (/avoid/i.test(t))   severity = "concern";
      else                         severity = "mixed";
      const badge = `Ethical Consumer ${tier}`;
      // Multi-issue: surface in environment + labor + animals when negative
      // (these are the dominant concerns flagged in their guides).
      if (severity === "leader" || severity === "positive") {
        out.environment = { badge, severity };
        out.labor       = { badge, severity };
        out.animals     = { badge, severity };
      } else if (severity === "concern") {
        out.environment = { badge, severity };
        out.labor       = { badge, severity };
        out.animals     = { badge, severity };
      } else {
        out.environment = { badge, severity };
      }
      break;
    }
    case "donegood": {
      const badge = "DoneGood marketplace";
      out.environment = { badge, severity: "positive" };
      out.labor       = { badge, severity: "positive" };
      break;
    }
    case "goodonyou": {
      let severity;
      if (/^great$/i.test(t))                severity = "leader";
      else if (/^good$/i.test(t))            severity = "positive";
      else if (/it.?s a start/i.test(t))     severity = "mixed";
      else if (/not good enough/i.test(t))   severity = "concern";
      else if (/we avoid/i.test(t))          severity = "concern";
      else                                   severity = "mixed";
      const badge = `Good On You ${tier}`;
      out.environment = { badge, severity };
      out.labor       = { badge, severity };
      out.animals     = { badge, severity };
      break;
    }
    case "buycott": {
      // Boycott listings carry mixed severity (activist editorial).
      // Always write to political (because buycott campaigns ARE political
      // signals in TruNorth's taxonomy). Conditionally add:
      //   - animals     if cause mentions "animal"
      //   - environment if cause mentions "climate"
      //   - guns        if cause mentions "firearm"
      const badge = `Buycott ${tier}`;
      out.political = { badge, severity: "mixed", sc: "controversial" };
      const c = String(cause || "").toLowerCase();
      if (/animal/.test(c))   out.animals     = { badge, severity: "mixed" };
      if (/climate/.test(c))  out.environment = { badge, severity: "concern" };
      if (/firearm/.test(c))  out.guns        = { badge, severity: "concern", sc: "sells_guns" };
      break;
    }
    case "as-you-sow-funds": {
      if (/fossil-free fail/i.test(t)) {
        out.environment = { badge: "As You Sow Fossil Free fail", severity: "concern" };
      } else if (/tobacco-free fail/i.test(t)) {
        out.health = { badge: "As You Sow Tobacco Free fail", severity: "concern" };
      } else if (/weapons-free fail/i.test(t)) {
        out.guns = { badge: "As You Sow Weapons Free fail", severity: "concern", sc: "makes_weapons" };
      } else if (/civilian firearm fail/i.test(t)) {
        out.guns = { badge: "As You Sow Civilian Firearm Free fail", severity: "concern", sc: "makes_guns" };
      } else if (/prison-free fail/i.test(t)) {
        out.labor = { badge: "As You Sow Prison Free fail", severity: "concern" };
      } else if (/deforestation-free fail/i.test(t)) {
        out.environment = { badge: "As You Sow Deforestation Free fail", severity: "concern" };
      } else if (/gender equality leader/i.test(t)) {
        out.dei = { badge: "As You Sow Gender Equality leader", severity: "positive", sc: "pro_dei" };
      }
      break;
    }
    case "fossil-free-funds": {
      out.environment = { badge: "Carbon Underground 200", severity: "concern" };
      break;
    }
    case "adl-tech": {
      const tierLetter = String(tier).replace(/^adl\s*/i, "");
      const rank = letterGradeRank(tierLetter);
      out.privacy = { badge: `ADL ${tierLetter}`, severity: adlSeverity(rank) };
      break;
    }
    case "drawdown-solutions": {
      out.environment = { badge: `Project Drawdown: ${tier}`, severity: "positive" };
      break;
    }
    default:
      // Unknown source — emit nothing.
      break;
  }
  return { perCategory: out };
}

const SEVERITY_RANK = { concern: 0, mixed: 1, neutral: 1, positive: 2, leader: 3 };

/**
 * Rollup severities into a single bestStatus.
 *   - concern + leader|positive → mixed
 *   - all concerns              → concern
 *   - otherwise highest-ranked tag
 */
export function rollupSeverity(tags) {
  if (!tags || tags.length === 0) return null;
  const hasConcern  = tags.includes("concern");
  const hasUpside   = tags.includes("leader") || tags.includes("positive");
  if (hasConcern && hasUpside) return "mixed";
  if (hasConcern) return "concern";
  let best = "mixed";
  for (const t of tags) {
    if ((SEVERITY_RANK[t] ?? 0) > (SEVERITY_RANK[best] ?? 0)) best = t;
  }
  return best;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log("consumer-scorecards merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run consumer-scorecards-fetch.mjs first.`);
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
    const { perCategory } = classify(e);
    if (!Object.keys(perCategory).length) continue;

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

    const RANK = { slugHint: 0, direct: 0, alias: 1, parent: 2, orphan: 9 };
    if (RANK[routedVia] < RANK[cur._routedVia]) cur._routedVia = routedVia;

    for (const [cat, info] of Object.entries(perCategory)) {
      let bucket = cur.categories[cat];
      if (!bucket) {
        bucket = cur.categories[cat] = {
          badges: [],
          sources: [],
          severityTags: [],
          narrativeParts: [],
          scTags: [],
        };
      }
      if (!bucket.badges.includes(info.badge)) bucket.badges.push(info.badge);
      if (!bucket.sources.includes(e.source))  bucket.sources.push(e.source);
      if (info.severity) bucket.severityTags.push(info.severity);
      if (info.sc) bucket.scTags.push(info.sc);
      if (e.commitment && !bucket.narrativeParts.includes(e.commitment)) {
        bucket.narrativeParts.push(e.commitment);
      }
    }
  }

  // Finalize for JSON serialization.
  const companiesOut = {};
  for (const [slug, c] of Object.entries(companies)) {
    const flat = {
      _sources: ["consumer-scorecards"],
      _innerSources: [...c._sources].sort(),
      _routedVia: c._routedVia,
      _entries: c._entries,
      _lastUpdated: c._lastUpdated,
    };
    for (const [cat, b] of Object.entries(c.categories)) {
      // Pick a representative sc enum when applicable (e.g. political lean).
      const sc = b.scTags.length ? mostCommon(b.scTags) : null;
      flat[cat] = {
        badges: b.badges,
        sources: b.sources,
        bestStatus: rollupSeverity(b.severityTags),
        narrative: b.narrativeParts.slice(0, 2).join(" "),
        ...(sc ? { sc } : {}),
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

function mostCommon(arr) {
  const counts = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("consumer-scorecards-merge failed:", err);
    process.exit(1);
  });
}
