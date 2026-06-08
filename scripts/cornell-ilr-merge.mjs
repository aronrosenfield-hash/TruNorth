#!/usr/bin/env node
/**
 * Cornell ILR Labor Action Tracker — merger.
 *
 * Reads the most-recent file in data/raw/cornell-ilr/ (or --in override),
 * slug-matches each employer against the TruNorth brand index, and writes
 * data/derived/cornell-ilr-augment.json keyed by slug.
 *
 * Match strategy (most-to-least specific):
 *   1. Direct slugify match against public/data/index.json slugs.
 *   2. Strip common US-corporate suffixes ("inc", "corp", "stores",
 *      "company", "co", etc.) and retry.
 *   3. Hand-curated CORNELL_ALIASES for "Amazon.com" → amazon,
 *      "The Walt Disney Company" → disney, etc.
 *   4. brand-parent-map fallback for sub-brands.
 *
 * Each action can attribute to one employer (we already split joint
 * employers in the fetch step). Within a slug we dedupe by actionId.
 *
 * Output shape:
 *   {
 *     _license: "CC-BY — Cornell ILR",
 *     _citation: "...",
 *     _source_url: "https://striketracker.ilr.cornell.edu",
 *     _generated_at: "...",
 *     _source_raw_file: "data/raw/cornell-ilr/<date>.json",
 *     _matched_slugs: N,
 *     _orphan_employers: [{name, actionCount, totalWorkers}],
 *     _routing_counts: {...},
 *     bySlug: {
 *       "<slug>": {
 *         labor: {
 *           laborActions: [
 *             { actionId, actionType, startDate, endDate, durationDays,
 *               numWorkers, numUnions, unions, demands, city, state,
 *               sourceUrl, trackerUrl, notes }
 *           ],
 *           actionCount: <int>,
 *           totalWorkersInvolved: <sum of numWorkers, null-skipped>,
 *           sourceUrl: "https://striketracker.ilr.cornell.edu",
 *           _license: "CC-BY — Cornell ILR"
 *         }
 *       }
 *     }
 *   }
 *
 * Standalone usage:
 *   node scripts/cornell-ilr-merge.mjs
 *   node scripts/cornell-ilr-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/cornell-ilr");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/cornell-ilr-augment.json");

const SOURCE_URL = "https://striketracker.ilr.cornell.edu";
const LICENSE    = "CC-BY — Cornell ILR";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

// ─── helpers ──────────────────────────────────────────────────────────────

/** Aggressive slugifier — lowercases, strips diacritics, collapses to a-z0-9-. */
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
 * Progressive variants of a US employer string. Returns the original
 * plus progressively suffix-stripped versions (most→least specific).
 */
export function nameVariants(rawName) {
  if (!rawName) return [];
  const stripped = String(rawName)
    .replace(/\(.*?\)/g, " ")      // drop parenthetical
    .replace(/\s+dba\s+.*$/i, " ") // drop "dba The New Yorker" tail
    .replace(/\s+/g, " ")
    .trim();

  const variants = new Set();
  variants.add(stripped);

  const SUFFIX_RE = [
    /\s+inc\.?$/i,
    /\s+incorporated$/i,
    /\s+corporation$/i,
    /\s+corp\.?$/i,
    /\s+llc$/i,
    /\s+l\.l\.c\.$/i,
    /\s+l\.p\.$/i,
    /\s+lp$/i,
    /\s+ltd\.?$/i,
    /\s+limited$/i,
    /\s+plc$/i,
    /\s+co\.?$/i,
    /\s+company$/i,
    /\s+holdings$/i,
    /\s+group$/i,
    /\s+stores$/i,
    /\s+brands$/i,
    /\s+enterprises$/i,
    /\s+international$/i,
    /\s+global$/i,
    /\s+usa$/i,
    /\s+north\s+america$/i,
    /\.com$/i,
    /,$/,                           // trailing comma
  ];

  let current = stripped;
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const re of SUFFIX_RE) {
      const next = current.replace(re, "");
      if (next !== current) { current = next.trim(); changed = true; }
    }
    if (changed) variants.add(current);
    else break;
  }

  // Also try a "first two words" heuristic for long names like
  // "Kaiser Permanente Northwest Region Foundation".
  const words = stripped.split(/\s+/);
  if (words.length >= 2) variants.add(words.slice(0, 2).join(" "));
  if (words.length >= 1) variants.add(words[0]);

  return [...variants];
}

/**
 * Hand-curated mappings for employers whose slugified name doesn't
 * directly match a TruNorth slug. Resolution is checked against the
 * loaded index — entries that don't exist are silently ignored.
 */
const CORNELL_ALIASES = {
  "amazon-com":                          "amazon",
  "the-walt-disney-company":             "disney",
  "walt-disney-company":                 "disney",
  "walt-disney":                         "disney",
  "alphabet-google":                     "google",
  "google-llc":                          "google",
  "meta-platforms":                      "meta",
  "facebook":                            "meta",
  "the-kroger":                          "kroger",
  "the-home-depot":                      "home-depot",
  "the-coca-cola-company":               "coca-cola",
  "coca-cola":                           "coca-cola",
  "pepsico":                             "pepsi",
  "mcdonalds":                           "mcdonald-s",
  "mcdonald-s-corporation":              "mcdonald-s",
  "dominos":                             "domino-s",
  "dominos-pizza":                       "domino-s",
  "trader-joes":                         "trader-joe-s",
  "wendys":                              "wendy-s",
  "lowes":                               "lowe-s",
  "macys":                               "macy-s",
  "kohls":                               "kohl-s",
  "kelloggs":                            "kellogg-s",
  "ferreros":                            "ferrero",
  "starbucks-corporation":               "starbucks",
  "starbucks-coffee-company":            "starbucks",
  "kaiser-permanente":                   "kaiser-permanente",
  "united-parcel-service":               "ups",
  "united-parcel-service-ups":           "ups",
  "ups":                                 "ups",
  "fedex-corporation":                   "fedex",
  "general-motors":                      "gm",
  "general-motors-company":              "gm",
  "ford-motor-company":                  "ford",
  "stellantis":                          "stellantis",
  "boeing":                              "boeing",
  "the-boeing-company":                  "boeing",
  "uber-technologies":                   "uber",
  "uber":                                "uber",
  "lyft":                                "lyft",
  "instacart":                           "instacart",
  "doordash":                            "doordash",
  "at-and-t":                            "att",
  "att":                                 "att",
  "verizon-communications":              "verizon",
  "comcast-corporation":                 "comcast",
  "warner-bros-discovery":               "warner-bros",
  "netflix":                             "netflix",
};

/**
 * Resolve an employer name to a TruNorth slug.
 * Returns { slug, routedVia } or { slug: null, routedVia: "orphan" }.
 */
export function resolveEmployer(rawName, indexSlugs, parentMap) {
  const variants = nameVariants(rawName);
  for (const v of variants) {
    const slug = slugify(v);
    if (!slug) continue;
    if (indexSlugs.has(slug)) return { slug, routedVia: "direct" };
    if (CORNELL_ALIASES[slug] && indexSlugs.has(CORNELL_ALIASES[slug])) {
      return { slug: CORNELL_ALIASES[slug], routedVia: "alias" };
    }
    const pm = parentMap[slug];
    if (pm?.parent && indexSlugs.has(pm.parent)) {
      return { slug: pm.parent, routedVia: "brand-parent" };
    }
  }
  return { slug: null, routedVia: "orphan" };
}

// ─── loaders ──────────────────────────────────────────────────────────────

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
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}; run cornell-ilr-fetch.mjs first.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("Cornell ILR Labor Action Tracker merger");

  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const actions = raw.actions || [];
  console.log(`  ${actions.length} per-employer action records in raw file`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap  = await loadParentMap();
  console.log(`  Loaded ${indexSlugs.size} index slugs + ${Object.keys(parentMap).length} brand-parent entries`);

  // slug -> { entries: [...], totalWorkersInvolved, _seen: Set(actionId) }
  const bySlug = new Map();
  // employerName -> { name, actionCount, totalWorkers }
  const orphanCounts = new Map();
  const routedViaCounts = { direct: 0, alias: 0, "brand-parent": 0, orphan: 0 };

  for (const a of actions) {
    const { slug, routedVia } = resolveEmployer(a.employer, indexSlugs, parentMap);
    routedViaCounts[routedVia]++;

    if (!slug) {
      const existing = orphanCounts.get(a.employer) || { name: a.employer, actionCount: 0, totalWorkers: 0 };
      existing.actionCount++;
      existing.totalWorkers += (a.numWorkers || 0);
      orphanCounts.set(a.employer, existing);
      continue;
    }

    let entry = bySlug.get(slug);
    if (!entry) {
      entry = { laborActions: [], totalWorkersInvolved: 0, _seen: new Set() };
      bySlug.set(slug, entry);
    }
    // Dedupe by actionId — the same incident shouldn't double-count
    // even if the same employer name spelling appears twice.
    const dedupeKey = a.actionId != null
      ? `id:${a.actionId}`
      : `nk:${a.startDate}|${a.employer}|${a.city}`;
    if (entry._seen.has(dedupeKey)) continue;
    entry._seen.add(dedupeKey);

    entry.laborActions.push({
      actionId:     a.actionId,
      actionType:   a.actionType,
      startDate:    a.startDate,
      endDate:      a.endDate,
      durationDays: a.durationDays,
      authorized:   a.authorized,
      numWorkers:   a.numWorkers,
      bargainingUnitSize: a.bargainingUnitSize,
      numUnions:    a.numUnions,
      unions:       a.unions,
      industry:     a.industry,
      demands:      a.demands,
      city:         a.city,
      state:        a.state,
      sourceUrl:    a.sourceUrl,
      trackerUrl:   a.trackerUrl,
      notes:        a.notes,
    });
    entry.totalWorkersInvolved += (a.numWorkers || 0);
  }

  const output = {
    _license:         LICENSE,
    _citation:        raw._citation || "Kallas, J., Iyer, D. K., & Friedman, E. (2024). \"Labor Action Tracker.\" Cornell University ILR School & University of Illinois LER School. Retrieved from striketracker.ilr.cornell.edu",
    _source_url:      SOURCE_URL,
    _generated_at:    new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _matched_slugs:   bySlug.size,
    _orphan_employers: [...orphanCounts.values()]
      .sort((a, b) => b.actionCount - a.actionCount)
      .slice(0, 50),
    _routing_counts:  routedViaCounts,
    bySlug: {},
  };

  for (const [slug, entry] of bySlug.entries()) {
    entry.laborActions.sort((a, b) =>
      String(b.startDate || "").localeCompare(String(a.startDate || "")));
    output.bySlug[slug] = {
      labor: {
        laborActions: entry.laborActions,
        actionCount:  entry.laborActions.length,
        totalWorkersInvolved: entry.totalWorkersInvolved,
        sourceUrl:    SOURCE_URL,
        _license:     LICENSE,
      },
    };
  }

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs:  ${bySlug.size}`);
  console.log(`  Routing: direct=${routedViaCounts.direct} alias=${routedViaCounts.alias} brand-parent=${routedViaCounts["brand-parent"]} orphan=${routedViaCounts.orphan}`);
  console.log(`  Orphan employers: ${orphanCounts.size}`);

  // Top by # actions
  const ranked = [...bySlug.entries()]
    .map(([slug, e]) => ({ slug, actions: e.laborActions.length, workers: e.totalWorkersInvolved }))
    .sort((a, b) => b.actions - a.actions);
  if (ranked.length > 0) {
    console.log(`\nTop 10 matched employers by # actions:`);
    for (const r of ranked.slice(0, 10)) {
      console.log(`  ${String(r.actions).padStart(4)} actions  ${r.workers.toLocaleString().padStart(10)} workers  ${r.slug}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("cornell-ilr-merge failed:", err);
    process.exit(1);
  });
}
