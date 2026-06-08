#!/usr/bin/env node
/**
 * Strike Map — merge raw events into per-slug labor-signal augment.
 *
 * Reads the most-recent file in data/raw/strike-map/ (or --in override)
 * and produces data/derived/strike-map-augment.json keyed by TruNorth
 * brand slug.
 *
 * RESOLUTION LADDER
 *   For each event we try, in order:
 *     1. The event's pre-supplied `employerSlug` (if it matches an index slug).
 *     2. Slug(employer) → indexSlugs.
 *     3. Stripped name variants (drop "corporation", "inc", "co", "the",
 *        "group", etc.) → indexSlugs.
 *     4. Hand-curated STRIKE_MAP_ALIASES (e.g., "ups" → "united-parcel-service").
 *     5. brand-parent-map.json fallback.
 *   First hit wins. Misses are tallied in `_orphan_employers` for review.
 *
 * OUTPUT
 *   data/derived/strike-map-augment.json
 *   {
 *     _license, _generated_at, _source_raw_file, _source_url,
 *     _matched_slugs, _orphan_employers: [{name, eventCount, workerCountAggregate}],
 *     _routing_counts,
 *     bySlug: {
 *       "<slug>": {
 *         labor: {
 *           strikeEvents: [
 *             { date, endDate, location, workerCount, reason, status,
 *               verified, sourceUrl }
 *           ],
 *           totalStrikeEvents: N,
 *           workerCountAggregate: N,
 *           sourceUrl: "https://strikemap.org/..."
 *         }
 *       }
 *     }
 *   }
 *
 * USAGE
 *   node scripts/strike-map-merge.mjs
 *   node scripts/strike-map-merge.mjs --in /tmp/r.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/strike-map");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/strike-map-augment.json");

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
 * Strip corporate-boilerplate suffixes/prefixes so "The Kroger Co." →
 * "kroger" and "Amazon.com, Inc." → "amazon-com" → "amazon". Returns
 * progressively peeled variants ordered most→least specific.
 */
export function nameVariants(rawName) {
  if (!rawName) return [];
  const stripped = String(rawName)
    .replace(/\(.*?\)/g, " ")    // drop parenthetical
    .replace(/\s+/g, " ")
    .trim();

  const variants = new Set();
  variants.add(stripped);

  // Strip leading "The "
  if (/^the\s+/i.test(stripped)) variants.add(stripped.replace(/^the\s+/i, ""));

  // Suffix-stripping ladder.
  const SUFFIX_RE = [
    /[,.]?\s+inc\.?$/i,
    /[,.]?\s+incorporated$/i,
    /[,.]?\s+co\.?$/i,
    /[,.]?\s+company$/i,
    /[,.]?\s+corp\.?$/i,
    /[,.]?\s+corporation$/i,
    /[,.]?\s+ltd\.?$/i,
    /[,.]?\s+limited$/i,
    /[,.]?\s+llc$/i,
    /[,.]?\s+plc$/i,
    /[,.]?\s+holdings$/i,
    /[,.]?\s+group$/i,
    /[,.]?\s+enterprises$/i,
    /[,.]?\s+technologies$/i,
    /[,.]?\s+the$/i,
    /\.com$/i,
  ];

  let current = stripped.replace(/^the\s+/i, "");
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const re of SUFFIX_RE) {
      const next = current.replace(re, "");
      if (next !== current) { current = next.trim(); changed = true; }
    }
    if (changed) variants.add(current);
    else break;
  }

  return [...variants];
}

/**
 * Hand-curated aliases for common Strike Map employer names that don't
 * map to a TruNorth slug by string-similarity alone. Keys are the
 * cleaned + slugified employer; values are the TruNorth slug.
 */
const STRIKE_MAP_ALIASES = {
  "ups":                       "united-parcel-service",
  "fedex":                     "fedex",
  "amazon-com":                "amazon",
  "amazon":                    "amazon",
  "kroger":                    "kroger",
  "uber":                      "uber",
  "uber-technologies":         "uber",
  "lyft":                      "lyft",
  "starbucks":                 "starbucks",
  "mcdonalds":                 "mcdonald-s",
  "kelloggs":                  "kellogg-s",
  "kellogg":                   "kellogg-s",
  "general-motors":            "general-motors",
  "gm":                        "general-motors",
  "ford-motor":                "ford-motor",
  "stellantis":                "stellantis",
  "boeing":                    "boeing",
  "john-deere":                "deere-and-company",
  "deere":                     "deere-and-company",
  "tesla":                     "tesla",
  "google":                    "alphabet",
  "alphabet":                  "alphabet",
  "meta":                      "meta-platforms",
  "facebook":                  "meta-platforms",
  "microsoft":                 "microsoft",
  "walmart":                   "walmart",
  "target":                    "target",
  "apple":                     "apple",
  "verizon":                   "verizon-communications",
  "att":                       "at-and-t",
  "at-and-t":                  "at-and-t",
  "royal-mail":                "royal-mail",
  "tesco":                     "tesco",
  "sainsburys":                "sainsbury-s",
  "asda":                      "asda",
};

/**
 * Resolve a Strike Map employer name to a TruNorth slug.
 * Returns { slug, routedVia } or { slug: null, routedVia: "orphan" }.
 */
export function resolveEmployer(event, indexSlugs, parentMap) {
  // 1. Pre-supplied slug from the source
  if (event.employerSlug) {
    const s = slugify(event.employerSlug);
    if (s && indexSlugs.has(s)) return { slug: s, routedVia: "source-slug" };
    if (s && STRIKE_MAP_ALIASES[s] && indexSlugs.has(STRIKE_MAP_ALIASES[s])) {
      return { slug: STRIKE_MAP_ALIASES[s], routedVia: "alias" };
    }
  }
  // 2/3. Try every name variant, direct-match + alias + parent-map.
  const variants = nameVariants(event.employer);
  for (const v of variants) {
    const slug = slugify(v);
    if (!slug) continue;
    if (indexSlugs.has(slug)) return { slug, routedVia: "direct" };
    if (STRIKE_MAP_ALIASES[slug] && indexSlugs.has(STRIKE_MAP_ALIASES[slug])) {
      return { slug: STRIKE_MAP_ALIASES[slug], routedVia: "alias" };
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
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}; run strike-map-fetch.mjs first.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("Strike Map merger");

  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const events = raw.events || [];
  console.log(`  ${events.length} raw events`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap = await loadParentMap();
  console.log(`  Loaded ${indexSlugs.size} index slugs + ${Object.keys(parentMap).length} brand-parent entries`);

  // Per-slug accumulator. Dedupe by (id || start|location) within a slug.
  const bySlug = new Map();
  const orphanCounts = new Map();
  const routedViaCounts = { "source-slug": 0, direct: 0, alias: 0, "brand-parent": 0, orphan: 0 };

  for (const ev of events) {
    const { slug, routedVia } = resolveEmployer(ev, indexSlugs, parentMap);
    routedViaCounts[routedVia] = (routedViaCounts[routedVia] || 0) + 1;

    if (!slug) {
      const existing = orphanCounts.get(ev.employer) || {
        name: ev.employer, eventCount: 0, workerCountAggregate: 0,
      };
      existing.eventCount++;
      existing.workerCountAggregate += (ev.workerCount || 0);
      orphanCounts.set(ev.employer, existing);
      continue;
    }

    let entry = bySlug.get(slug);
    if (!entry) {
      entry = { strikeEvents: [], totalStrikeEvents: 0, workerCountAggregate: 0, _seen: new Set() };
      bySlug.set(slug, entry);
    }
    const dedupeKey = ev.id || `${ev.startDate || ""}|${ev.location || ""}`;
    if (entry._seen.has(dedupeKey)) continue;
    entry._seen.add(dedupeKey);

    entry.strikeEvents.push({
      date:        ev.startDate,
      endDate:     ev.endDate,
      location:    ev.location,
      workerCount: ev.workerCount,
      reason:      ev.reason,
      status:      ev.status,
      verified:    ev.verified,
      sourceUrl:   ev.sourceUrl,
    });
    entry.totalStrikeEvents++;
    entry.workerCountAggregate += (ev.workerCount || 0);
  }

  // Build output (drop _seen helper, sort events by date desc).
  const output = {
    _license: raw._license || "permissive, attribution required (strikemap.org)",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: raw._source || "https://strikemap.org",
    _matched_slugs: bySlug.size,
    _orphan_employers: [...orphanCounts.values()]
      .sort((a, b) => b.eventCount - a.eventCount || b.workerCountAggregate - a.workerCountAggregate)
      .slice(0, 100),
    _routing_counts: routedViaCounts,
    bySlug: {},
  };
  for (const [slug, entry] of bySlug.entries()) {
    entry.strikeEvents.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    output.bySlug[slug] = {
      labor: {
        strikeEvents: entry.strikeEvents,
        totalStrikeEvents: entry.totalStrikeEvents,
        workerCountAggregate: entry.workerCountAggregate,
        sourceUrl: "https://strikemap.org",
      },
    };
  }

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs: ${bySlug.size}`);
  console.log(`  Routing: ${JSON.stringify(routedViaCounts)}`);
  console.log(`  Orphan employers: ${orphanCounts.size}`);

  // Top 10 employers by strikeEvents count
  const ranked = [...bySlug.entries()]
    .map(([slug, e]) => ({
      slug,
      events: e.totalStrikeEvents,
      workers: e.workerCountAggregate,
    }))
    .sort((a, b) => b.events - a.events || b.workers - a.workers);
  if (ranked.length > 0) {
    console.log(`\nTop 10 employers by strike-event count:`);
    for (const r of ranked.slice(0, 10)) {
      console.log(`  ${String(r.events).padStart(4)} events, ${String(r.workers.toLocaleString()).padStart(10)} workers  —  ${r.slug}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("strike-map-merge failed:", err);
    process.exit(1);
  });
}
