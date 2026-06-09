#!/usr/bin/env node
/**
 * GLAAD SRI merger — per-slug DEI augment.
 *
 * Reads data/raw/glaad-sri/<date>.json and emits
 * data/derived/glaad-sri-augment.json:
 *   bySlug: {
 *     "<slug>": {
 *       lgbtqMedia: {
 *         grade, category, inclusivePct, vintage,
 *         entityName, parent, sourceUrl
 *       }
 *     }
 *   }
 *
 * Each studio/streamer/network is mapped to ITS parent corporation slug
 * when one is supplied (e.g. ABC -> disney). The brand entity itself
 * also gets its own row if it matches an index slug.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/glaad-sri");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE   = path.join(ROOT, "data/derived/glaad-sri-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const GLAAD_ALIASES = {
  "the-walt-disney": "disney",
  "walt-disney": "disney",
  "warner-bros-discovery": "warner-bros-discovery",
  "paramount-global": "paramount",
  "paramount": "paramount",
  "amazon-com": "amazon",
  "amazon-prime-video": "amazon",
  "apple-tv": "apple",
  "comcast": "comcast",
  "universal-pictures": "comcast",
  "peacock": "comcast",
  "nbc": "nbcuniversal",
  "abc": "disney",
  "cbs": "paramount",
  "hulu": "disney",
  "disney": "disney",
  "max-formerly-hbo-max": "warner-bros-discovery",
  "max": "warner-bros-discovery",
  "cartoon-network": "warner-bros-discovery",
  "nickelodeon": "paramount",
  "fox-broadcasting": "fox-corporation",
  "sony-pictures-entertainment": "sony-pictures-entertainment",
  "sony": "sony-pictures-entertainment",
  "sony-group": "sony-pictures-entertainment",
  "the-cw": "the-cw",
  "a24-films": "a24-films",
  "a24": "a24-films",
  "lionsgate-entertainment": "lionsgate",
  "lionsgate": "lionsgate",
};

async function loadIndexSlugs() {
  const text = await fs.readFile(INDEX_FILE, "utf-8");
  const arr = JSON.parse(text);
  return new Set(arr.map(c => c.slug));
}
async function pickLatestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function resolveSlug(name, indexSlugs) {
  const s = toSlug(name);
  if (s && indexSlugs.has(s)) return { slug: s, via: "direct" };
  if (GLAAD_ALIASES[s] && indexSlugs.has(GLAAD_ALIASES[s])) {
    return { slug: GLAAD_ALIASES[s], via: "alias" };
  }
  return { slug: null, via: "orphan", attempted: s };
}

/** Rank: worse grades (lower rank) win in collisions so parent rolls up
 *  the harshest dependent grade, surfacing the worst slate. */
const GRADE_RANK = {
  "Failing": 0, "Poor": 1, "Insufficient": 2, "Fair": 3, "Good": 4, "Excellent": 5,
};

async function main() {
  console.log("GLAAD SRI merger");
  const rawPath = await pickLatestRawFile();
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const studios = raw.studios || [];

  const indexSlugs = await loadIndexSlugs();
  const bySlug = {};
  const routing = { direct: 0, alias: 0, orphan: 0 };
  const orphans = [];

  function pushTarget(targetName, studio, viaTag) {
    const { slug, via, attempted } = resolveSlug(targetName, indexSlugs);
    routing[via]++;
    if (!slug) { orphans.push({ name: targetName, attempted, grade: studio.grade }); return; }
    const cur = bySlug[slug]?.lgbtqMedia;
    if (cur) {
      const curRank = GRADE_RANK[cur.grade] ?? 99;
      const newRank = GRADE_RANK[studio.grade] ?? 99;
      // Keep the worst grade visible.
      if (curRank <= newRank) return;
    }
    bySlug[slug] = {
      lgbtqMedia: {
        grade: studio.grade,
        category: studio.category || null,
        inclusivePct: studio.lgbtq_inclusive_pct ?? null,
        vintage: raw._vintage || null,
        entityName: studio.name,
        parent: studio.parent || null,
        viaTag,
        sourceUrl: "https://glaad.org/sri",
      },
    };
  }

  for (const s of studios) {
    if (!s?.name) continue;
    // Try direct brand entity first (e.g. "Netflix" -> "netflix").
    pushTarget(s.name, s, "entity");
    // Then roll up to its parent corp if known.
    if (s.parent) pushTarget(s.parent, s, "parent");
  }

  const output = {
    _license: raw._license || "Public — GLAAD",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: raw._source || "https://glaad.org/sri",
    _vintage: raw._vintage,
    _matched_slugs: Object.keys(bySlug).length,
    _routing_counts: routing,
    _orphans: orphans,
    bySlug,
  };

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  Matched: ${Object.keys(bySlug).length}; Routing: ${JSON.stringify(routing)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("glaad-sri-merge failed:", err);
    process.exit(1);
  });
}
