#!/usr/bin/env node
/**
 * OECD NCP — merge step.
 *
 * Reads latest data/raw/oecd-ncp/<date>.json and writes
 * data/derived/oecd-ncp-augment.json keyed by TruNorth slug.
 *
 * Routing ladder per entry: slugHint → direct slug → alias → parent → orphan.
 *
 * Per-slug rollup writes ONE bucket per affected category (labor / political /
 * environment / human-rights → labor + political). Severity ladder:
 *   - 1 closed-w/-no-agreement   → mixed
 *   - 1 ongoing                   → mixed
 *   - 1 closed-w/-concern         → mixed (still single instance)
 *   - 2+ concern-level instances  → concern (poor)
 *   - 3+ instances (any outcome)  → concern (poor)
 *   - any landmark + concern hits → landmark (very_poor)
 *   - all agreement-outcomes      → positive (engaged but did remediate)
 *
 * Output (consumable by apply-augments-to-companies.mjs):
 *   {
 *     _license, _source_file, _source_urls, _generated_at, _stats,
 *     companies: {
 *       "<slug>": {
 *         _sources:      ["oecd-ncp"],
 *         _routedVia:    "direct" | "alias" | "parent" | "slugHint",
 *         _entries:      n,
 *         _lastUpdated:  iso,
 *         labor?:       { bestStatus, narrative, caseCount, cases: [...] },
 *         political?:   { ... same shape ... },
 *         environment?: { ... },
 *         humanRights?: { ... },
 *       }
 *     }
 *   }
 *
 * NOTE on category mapping: TruNorth has no "human-rights" category, so cases
 *  themed "human-rights" are routed to "labor" (worker rights / community
 *  rights). Cases themed "environment" → environment. Cases themed "political"
 *  (disclosure, bribery, taxation, consumer-interests) → political.
 *
 * Locally:
 *   node scripts/oecd-ncp-merge.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/oecd-ncp");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "oecd-ncp-augment.json");
const ORPHAN_FILE = path.join(DERIVED_DIR, "oecd-ncp-unmatched.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

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
  try { return JSON.parse(await fs.readFile(file, "utf-8")); } catch { return null; }
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

/**
 * Map case theme → TruNorth category key consumed by apply-augments.
 *  human-rights → labor (worker + community rights),
 *  political    → political (governance / disclosure),
 *  environment  → environment, labor → labor.
 */
export function themeToCategory(theme) {
  switch (theme) {
    case "labor":         return "labor";
    case "human-rights":  return "labor";
    case "political":     return "political";
    case "environment":   return "environment";
    default:              return "labor";
  }
}

const SEVERITY_RANK = { positive: 0, mixed: 1, concern: 2, landmark: 3 };

/** Roll up a list of severity tags → bestStatus. */
export function rollupSeverity(tags) {
  if (!tags || tags.length === 0) return null;
  const hasLandmark = tags.includes("landmark");
  if (hasLandmark) return "landmark";
  const concernN = tags.filter(t => t === "concern").length;
  const total = tags.length;
  if (concernN >= 2 || total >= 3) return "concern";
  if (concernN === 1) return "mixed";
  // All positive/mixed
  const hasPositive = tags.includes("positive");
  const hasMixed = tags.includes("mixed");
  if (hasPositive && !hasMixed) return "positive";
  return "mixed";
}

async function main() {
  console.log("oecd-ncp merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run oecd-ncp-fetch.mjs first.`);
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
      orphans.push({
        brand: e.brand, slugHint: e.slugHint || null, ncp: e.ncp,
        year: e.year, caseTitle: e.caseTitle,
      });
      continue;
    }

    const cat = themeToCategory(e.theme);
    let cur = companies[slug];
    if (!cur) {
      cur = companies[slug] = {
        _routedVia: routedVia,
        _entries: 0,
        _categories: {},
        _lastUpdated: now.toISOString(),
      };
    }
    cur._entries += 1;

    const RANK = { slugHint: 0, direct: 0, alias: 1, parent: 2, orphan: 9 };
    if (RANK[routedVia] < RANK[cur._routedVia]) cur._routedVia = routedVia;

    let bucket = cur._categories[cat];
    if (!bucket) {
      bucket = cur._categories[cat] = {
        cases: [],
        severityTags: [],
      };
    }
    bucket.cases.push({
      caseTitle: e.caseTitle,
      ncp: e.ncp,
      year: e.year,
      outcome: e.outcome,
      issues: e.issues || [],
      summary: e.summary,
      sourceUrl: e.sourceUrl,
    });
    bucket.severityTags.push(e.severity || "mixed");
  }

  // Finalize each company's per-category buckets.
  const companiesOut = {};
  for (const [slug, c] of Object.entries(companies)) {
    const flat = {
      _sources: ["oecd-ncp"],
      _routedVia: c._routedVia,
      _entries: c._entries,
      _lastUpdated: c._lastUpdated,
    };
    for (const [cat, b] of Object.entries(c._categories)) {
      const bestStatus = rollupSeverity(b.severityTags);
      // Build the narrative: caseCount + most-recent outcome + ncp + year.
      const newest = b.cases.slice().sort((a, z) => (z.year || 0) - (a.year || 0))[0];
      const outcomes = b.cases.map(c => c.outcome);
      const ongoingN = outcomes.filter(o => o === "ongoing").length;
      const agreementN = outcomes.filter(o => o === "agreement").length;
      const noAgreeN = outcomes.filter(o => o === "no-agreement" || o === "rejected" || o === "withdrawn" || o === "blocked").length;

      let head;
      if (b.cases.length === 1) {
        head = `OECD NCP specific instance (${newest.ncp} NCP, ${newest.year}): ${newest.outcome === "agreement" ? "agreement reached" : newest.outcome === "ongoing" ? "ongoing" : newest.outcome === "no-agreement" ? "closed without agreement" : newest.outcome}.`;
      } else {
        const breakdown = [];
        if (agreementN) breakdown.push(`${agreementN} reached agreement`);
        if (noAgreeN) breakdown.push(`${noAgreeN} closed without agreement`);
        if (ongoingN) breakdown.push(`${ongoingN} ongoing`);
        head = `${b.cases.length} OECD NCP specific instances (${breakdown.join(", ")}); most recent ${newest.year} (${newest.ncp} NCP).`;
      }
      const tail = newest.summary ? ` ${newest.summary}` : "";
      const narrative = `${head}${tail}`.trim();

      flat[cat] = {
        bestStatus,
        narrative,
        caseCount: b.cases.length,
        cases: b.cases,
      };
    }
    companiesOut[slug] = flat;
  }

  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const payload = {
    _license: raw._license,
    _source_file: path.relative(ROOT, rawFile),
    _source_urls: raw._source_urls,
    _generated_at: now.toISOString(),
    _stats: {
      raw_entries: (raw.entries || []).length,
      matched_companies: Object.keys(companiesOut).length,
      routed_slugHint: routeCounts.slugHint,
      routed_direct:   routeCounts.direct,
      routed_alias:    routeCounts.alias,
      routed_parent:   routeCounts.parent,
      orphans:         routeCounts.orphan,
    },
    companies: companiesOut,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`oecd-ncp merge: wrote ${outFile}`);
  console.log(`  raw entries:        ${payload._stats.raw_entries}`);
  console.log(`  matched companies:  ${payload._stats.matched_companies}`);
  console.log(`  routing: slugHint=${routeCounts.slugHint} direct=${routeCounts.direct} alias=${routeCounts.alias} parent=${routeCounts.parent} orphans=${routeCounts.orphan}`);
  if (orphans.length) {
    await fs.writeFile(ORPHAN_FILE, JSON.stringify(orphans, null, 2));
    console.log(`  orphans logged: ${ORPHAN_FILE}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("oecd-ncp-merge failed:", err);
    process.exit(1);
  });
}
