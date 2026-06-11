#!/usr/bin/env node
/**
 * NLRB Voluntary Recognition merger (sprint G — positive labor signal).
 *
 * Reads the latest snapshot from data/raw/nlrb-voluntary-recognition/, slug-
 * matches each employer to a TruNorth company file (direct → alias → parent),
 * and writes data/derived/nlrb-voluntary-recognition-augment.json keyed by
 * slug:
 *
 *   {
 *     <slug>: {
 *       labor: {
 *         voluntaryRecognitions: [
 *           { case_number, union, recognition_date, location, workers,
 *             case_type, disposition, source_url }
 *         ],
 *         voluntaryRecogCount: <int>,
 *         lastRecognitionDate: <iso-8601 or null>,
 *         workersUnionized: <int sum where known>,
 *         sourceUrl: "https://www.nlrb.gov/reports/agency-performance/election-reports",
 *         signal: "positive"        // explicit annotation for the merger pipeline
 *       },
 *       routedVia: "direct" | "alias" | "parent",
 *       lastUpdated: iso-8601
 *     }
 *   }
 *
 * POSITIVE LABOR SIGNAL — voluntary recognition is the GOOD outcome for a
 * union drive (no protracted election, no ULP litigation). The downstream
 * scoring layer should treat this as a credit, complementing the existing
 * NLRB unfair-labor-practice augment (which is a debit). The signal field is
 * set to "positive" explicitly so any future generalized labor-merger never
 * mistakes this for a violation.
 *
 * DOES NOT touch per-company JSON. The augment file is a derived sidecar; the
 * scoring layer will reconcile it during the next nightly composite build.
 *
 * Locally:
 *   node scripts/nlrb-voluntary-recognition-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/nlrb-voluntary-recognition");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "nlrb-voluntary-recognition-augment.json");

const SOURCE_URL = "https://www.nlrb.gov/reports/graphs-data/recent-filings";

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    // Strip common trailing corporate suffixes BEFORE we collapse separators
    // so they don't end up as trailing slug segments that defeat matching.
    // Anchored at end-of-string (optionally with a comma) so "REI Co-op" and
    // "Coca-Cola" are NOT mangled by a generic "\bco\b" sweep.
    .replace(
      /[,\s]+(?:inc|incorporated|llc|l\.l\.c\.|llp|ltd|corp|corporation|company|co)\.?\s*$/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  return {
    aliases: await tryReadJson(path.join(META_DIR, "slug-aliases.json")) || {},
    parents: await tryReadJson(path.join(META_DIR, "brand-parent-map.json")) || {},
  };
}

async function latestRawFile() {
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

/**
 * 3-tier slug resolve: direct → alias → parent. Returns { slug, routed_via }
 * with slug=null + routed_via="orphan" when no company file exists for any
 * candidate. The brand-parent map is the same one used by every other
 * derived-augment pipeline (animal-welfare-union, lawsuits, etc.).
 */
export function resolveSlug(employerName, maps) {
  const brandSlug = slugify(employerName);
  if (!brandSlug) return { slug: null, routed_via: "orphan" };

  if (existsSync(path.join(COMP_DIR, `${brandSlug}.json`))) {
    return { slug: brandSlug, routed_via: "direct" };
  }
  const alias = maps.aliases[brandSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[brandSlug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

/**
 * Pull the per-entry payload we want surfaced under labor.voluntaryRecognitions[].
 * Keep this tight — the augment file should not bloat with redundant fields
 * already present in the raw snapshot.
 */
export function entryPayload(e) {
  return {
    case_number: e.case_number,
    case_type: e.case_type,
    union: e.union || null,
    recognition_date: e.recognition_date || null,
    location: e.location || null,
    workers: e.workers || null,
    disposition: e.disposition || null,
    source_url: e.source_url || null,
  };
}

export function buildAugment(rawEntries, maps) {
  const bySlug = new Map();
  const orphans = [];

  for (const e of rawEntries) {
    const { slug, routed_via } = resolveSlug(e.employer, maps);
    if (!slug) {
      orphans.push({ employer: e.employer, case_number: e.case_number });
      continue;
    }
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        recognitions: [],
        routedVia: routed_via,
        contributingEmployers: new Set(),
      });
    }
    const bucket = bySlug.get(slug);
    bucket.recognitions.push(entryPayload(e));
    bucket.contributingEmployers.add(e.employer);

    // Precedence: direct beats alias beats parent. Keep the strongest route.
    const RANK = { direct: 0, alias: 1, parent: 2 };
    if (RANK[routed_via] < RANK[bucket.routedVia]) bucket.routedVia = routed_via;
  }

  const now = new Date().toISOString();
  const companies = {};
  for (const [slug, bucket] of bySlug.entries()) {
    // Stable order: most recent recognition first, then by case number.
    bucket.recognitions.sort((a, b) => {
      const da = a.recognition_date || "";
      const db = b.recognition_date || "";
      if (db !== da) return db.localeCompare(da);
      return (a.case_number || "").localeCompare(b.case_number || "");
    });
    const dates = bucket.recognitions.map(r => r.recognition_date).filter(Boolean).sort();
    const workersSum = bucket.recognitions
      .map(r => r.workers || 0)
      .reduce((a, b) => a + b, 0);

    companies[slug] = {
      labor: {
        voluntaryRecognitions: bucket.recognitions,
        voluntaryRecogCount: bucket.recognitions.length,
        lastRecognitionDate: dates.length ? dates[dates.length - 1] : null,
        workersUnionized: workersSum > 0 ? workersSum : null,
        sourceUrl: SOURCE_URL,
        signal: "positive",
      },
      routedVia: bucket.routedVia,
      contributingEmployers: [...bucket.contributingEmployers],
      lastUpdated: now,
    };
  }
  return { companies, orphans };
}

async function main() {
  console.log("NLRB voluntary-recognition merge starting...");

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run nlrb-voluntary-recognition-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw || !Array.isArray(raw.entries)) {
    console.error(`Malformed snapshot: ${rawFile}`);
    process.exit(2);
  }

  const maps = await loadMaps();
  const { companies, orphans } = buildAugment(raw.entries, maps);

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const payload = {
    _license: "US Government work — public domain (17 U.S.C. § 105). Cite the NLRB source URL on display.",
    _source_url: SOURCE_URL,
    _source_files: [path.relative(ROOT, rawFile)],
    _generated_at: new Date().toISOString(),
    _signal: "positive",
    _note: "Voluntary union recognition is a POSITIVE labor signal. Complements the unfair-labor-practice (negative) pipeline.",
    _stats: {
      matched_companies: Object.keys(companies).length,
      total_recognitions: Object.values(companies)
        .reduce((a, c) => a + c.labor.voluntaryRecogCount, 0),
      orphan_count: orphans.length,
      raw_entries: raw.entries.length,
      // Propagate the raw snapshot's health so an empty augment is
      // self-explanatory (fetch failure vs genuinely zero VR records —
      // see the fetcher header: NLRB's public CATS data currently exposes
      // no voluntary-recognition close method at all).
      raw_status: raw._status || null,
      ...(raw._empty_reason ? { raw_empty_reason: raw._empty_reason } : {}),
      ...(raw._note ? { raw_note: raw._note } : {}),
    },
    companies,
    orphans: orphans.slice(0, 500),
    orphan_total: orphans.length,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));

  console.log(`\nMatched companies:      ${payload._stats.matched_companies}`);
  console.log(`Total recognitions:     ${payload._stats.total_recognitions}`);
  console.log(`Orphan employers:       ${payload._stats.orphan_count}`);
  console.log(`\nWrote ${OUT_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("nlrb-voluntary-recognition-merge failed:", err);
    process.exit(1);
  });
}
