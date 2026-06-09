#!/usr/bin/env node
/**
 * HRC Corporate Equality Index merger — emits per-slug DEI augment.
 *
 * Reads the latest data/raw/hrc-cei/<date>.json and produces
 * data/derived/hrc-cei-augment.json keyed by TruNorth brand slug.
 *
 * RESOLUTION LADDER
 *   1. Slugify(normalizeCompanyName(name)).
 *   2. Hand-curated HRC_ALIASES (e.g. "alphabet-inc" -> "alphabet").
 *   3. brand-parent-map.json fallback.
 *
 * OUTPUT
 *   {
 *     _license, _generated_at, _source_raw_file, _source_url,
 *     _matched_slugs, _routing_counts, _orphans,
 *     bySlug: { "<slug>": { lgbtq: { score, designation, vintage, sourceUrl } } }
 *   }
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/hrc-cei");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/hrc-cei-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const HRC_ALIASES = {
  "alphabet": "google-alphabet",
  "google": "google-alphabet",
  "meta-platforms": "meta-platforms",
  "facebook": "meta-platforms",
  "amazon-com": "amazon",
  "rtx": "rtx",
  "raytheon": "rtx",
  "the-walt-disney": "disney",
  "walt-disney": "disney",
  "the-coca-cola": "coca-cola",
  "the-hershey": "hershey",
  "kellogg-s": "kellogg-s",
  "kelloggs": "kellogg-s",
  "att": "atandt",
  "at-t": "atandt",
  "atandt": "atandt",
  "at-and-t": "atandt",
  "ups": "ups",
  "united-parcel-service": "ups",
  "sony-of-america": "sony-corporation-of-america",
  "sony": "sony-corporation-of-america",
  "the-cigna": "cigna",
  "verizon-communications": "verizon",
  "walgreens-boots-alliance": "walgreens",
  "capital-one-financial": "capital-one",
  "costco-wholesale": "costco",
  "spotify-technology-s-a": "spotify",
  "spotify-technology": "spotify",
};

/** Return progressively-trimmed slug variants — drops trailing "-and", "-of-x", etc. */
function slugVariants(name) {
  const s = toSlug(name);
  if (!s) return [];
  const out = new Set([s]);
  // strip trailing dangling " and "
  let v = s.replace(/-and$/, "");
  if (v !== s) out.add(v);
  // drop trailing organizational qualifiers
  for (const q of ["financial","communications","wholesale","boots-alliance","technology","technologies","of-america","corporation-of-america","worldwide-holdings","international","group","holdings","plc","sa","s-a","platforms"]) {
    const re = new RegExp(`-${q}$`);
    const next = v.replace(re, "");
    if (next !== v) { out.add(next); v = next; }
  }
  return [...out];
}

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
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}; run hrc-cei-fetch.mjs first.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function resolveSlug(name, indexSlugs, parentMap) {
  for (const v of slugVariants(name)) {
    if (indexSlugs.has(v)) return { slug: v, via: "direct" };
    if (HRC_ALIASES[v] && indexSlugs.has(HRC_ALIASES[v])) {
      return { slug: HRC_ALIASES[v], via: "alias" };
    }
    const pm = parentMap[v];
    if (pm?.parent && indexSlugs.has(pm.parent)) return { slug: pm.parent, via: "brand-parent" };
  }
  return { slug: null, via: "orphan" };
}

async function main() {
  console.log("HRC CEI merger");
  const rawPath = await pickLatestRawFile();
  console.log(`  Reading ${rawPath}`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const companies = raw.companies || [];
  console.log(`  ${companies.length} raw rows`);

  const indexSlugs = await loadIndexSlugs();
  const parentMap = await loadParentMap();

  const bySlug = {};
  const routing = { direct: 0, alias: 0, "brand-parent": 0, orphan: 0 };
  const orphans = [];

  for (const c of companies) {
    if (!c?.name) continue;
    const { slug, via } = resolveSlug(c.name, indexSlugs, parentMap);
    routing[via] = (routing[via] || 0) + 1;
    if (!slug) {
      orphans.push({ name: c.name, score: c.score });
      continue;
    }
    // If two rows hit the same slug (parent + brand), keep the higher score.
    const existing = bySlug[slug];
    if (existing && existing.lgbtq.score >= c.score) continue;
    bySlug[slug] = {
      lgbtq: {
        score: c.score,
        designation: c.designation || null,
        vintage: raw._vintage || null,
        sourceUrl: "https://www.hrc.org/resources/corporate-equality-index",
      },
    };
  }

  const output = {
    _license: raw._license || "Public — HRC Foundation",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: raw._source || "https://www.hrc.org/resources/corporate-equality-index",
    _vintage: raw._vintage,
    _matched_slugs: Object.keys(bySlug).length,
    _routing_counts: routing,
    _orphans: orphans.slice(0, 50),
    bySlug,
  };

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched slugs: ${Object.keys(bySlug).length}`);
  console.log(`  Routing: ${JSON.stringify(routing)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("hrc-cei-merge failed:", err);
    process.exit(1);
  });
}
