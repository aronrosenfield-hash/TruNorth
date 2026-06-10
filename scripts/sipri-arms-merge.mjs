#!/usr/bin/env node
/**
 * SIPRI Arms Industry Top-100 — merge step.
 *
 * Reads latest data/raw/sipri/<date>.json and writes
 * data/derived/sipri-augment.json keyed by TruNorth slug.
 *
 * Maps to category: guns (the firearms / weapons category).
 *
 * Output uses these severity tags consumed by the apply-augments writer:
 *   landmark   → very_poor  (top-5 pure-defense; revenue weighting drives this)
 *   concern    → poor       (top-25 OR >50% pure)
 *   mixed      → mixed      (significant defense revenue but diversified)
 *   incidental → neutral    (≤10% arms revenue — not a guns-flagged brand)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/sipri");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "sipri-arms-augment.json");
const PARKED_FILE = path.join(DERIVED_DIR, "sipri-arms-parked.json");

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
 * Map (rank, category, armsShareRev) → severity tag.
 *  landmark   – top-5 + pure-defense
 *  concern    – pure-defense at any rank OR top-15 anywhere
 *  mixed      – diversified or mixed (≥10% arms revenue)
 *  incidental – <10% arms revenue (no flagging)
 */
export function classifySeverity(entry) {
  if (entry.severity) return entry.severity;
  const { rank, category, armsShareRev } = entry;
  if (rank <= 5 && category === "pure-defense") return "landmark";
  if (category === "pure-defense") return "concern";
  if (rank <= 15) return "concern";
  if ((armsShareRev || 0) >= 0.10) return "mixed";
  return "incidental";
}

async function main() {
  console.log("sipri-arms merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) { console.error(`No snapshot in ${RAW_DIR}.`); process.exit(2); }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const parked = [];
  const routeCounts = { slugHint: 0, direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const e of raw.entries || []) {
    const { slug, routedVia } = resolveBrand(e, { knownSlugs, ...maps });
    routeCounts[routedVia]++;
    if (!slug) {
      parked.push({
        brand: e.brand,
        rank: e.rank,
        country: e.country,
        category: e.category,
        armsShareRev: e.armsShareRev,
        note: "No matching TruNorth slug; SIPRI Top-100 producer absent from index.",
      });
      continue;
    }

    if (companies[slug]) continue;
    const severity = classifySeverity(e);
    if (severity === "incidental") continue;  // skip if not meaningful arms exposure

    const sharePct = (e.armsShareRev * 100).toFixed(0);
    const armsBn = (e.armsRevUsdM / 1000).toFixed(1);
    const head = `SIPRI Top-100 rank #${e.rank} (${raw._stats.revenue_year} revenue): ~$${armsBn}B in arms sales, ${sharePct}% of total revenue.`;
    const tail = e.summary && !e.summary.startsWith("SIPRI Top-100") ? ` ${e.summary}` : "";
    const narrative = `${head}${tail}`.trim();

    // makes_guns enum: pure-defense → makes_guns; mixed/diversified at rank ≤15 → makes_weapons;
    // mixed at rank >15 → makes_weapons; otherwise mixed.
    const gunsEnum =
      e.category === "pure-defense" ? "makes_weapons" :
      severity === "concern" ? "makes_weapons" :
      severity === "landmark" ? "makes_weapons" :
      "mixed";

    companies[slug] = {
      _sources: ["sipri-arms"],
      _routedVia: routedVia,
      _entries: 1,
      _lastUpdated: now.toISOString(),
      guns: {
        bestStatus: severity,
        narrative,
        rank: e.rank,
        armsRevUsdM: e.armsRevUsdM,
        armsShareRev: e.armsShareRev,
        category: e.category,
        gunsEnum,
        sourceUrl: raw._source_urls?.top100 || "https://www.sipri.org/databases/armsindustry",
      },
    };
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
      matched_companies: Object.keys(companies).length,
      routed_slugHint: routeCounts.slugHint,
      routed_direct:   routeCounts.direct,
      routed_alias:    routeCounts.alias,
      routed_parent:   routeCounts.parent,
      parked:          parked.length,
    },
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`sipri-arms merge: wrote ${outFile}`);
  console.log(`  raw entries:        ${payload._stats.raw_entries}`);
  console.log(`  matched companies:  ${payload._stats.matched_companies}`);
  console.log(`  parked (no slug):   ${payload._stats.parked}`);
  if (parked.length) {
    await fs.writeFile(PARKED_FILE, JSON.stringify(parked, null, 2));
    console.log(`  parked logged:      ${PARKED_FILE}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("sipri-arms-merge failed:", err); process.exit(1); });
}
