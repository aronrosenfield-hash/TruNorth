#!/usr/bin/env node
/**
 * CDP Climate merger — per-slug environment augment.
 *
 * Reads data/raw/cdp-climate/<date>.json and emits
 * data/derived/cdp-climate-augment.json:
 *   bySlug: { "<slug>": { climateDisclosure: { score, band, vintage, sourceUrl } } }
 *
 * Score → band mapping:
 *   A / A-     → "leadership"
 *   B / B-     → "management"
 *   C / C-     → "awareness"
 *   D / D-     → "disclosure"
 *   F          → "failure"
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/cdp-climate");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const OUT_FILE   = path.join(ROOT, "data/derived/cdp-climate-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const CDP_ALIASES = {
  "alphabet": "google-alphabet",
  "google": "google-alphabet",
  "meta-platforms": "meta-platforms",
  "amazon-com": "amazon",
  "rtx": "rtx",
  "raytheon": "rtx",
  "the-walt-disney": "disney",
  "walt-disney": "disney",
  "the-coca-cola": "coca-cola",
  "the-hershey": "hershey",
  "kraft-heinz": "kraft-heinz",
  "sony": "sony-group",
  "sony-group": "sony-group",
  "atandt": "atandt",
  "at-and-t": "atandt",
  "ups": "ups",
  "united-parcel-service": "ups",
  "deere-and-company": "deere-and-company",
  "deere": "deere-and-company",
  "mcdonald-s": "mcdonald-s",
  "kellogg-s": "kellogg-s",
  "kroger": "kroger",
  "mondelez-international": "mondelez-international",
  "mondelez": "mondelez-international",
  "nestl-s-a": "nestle-s-a",
  "nestle-s-a": "nestle-s-a",
  "nestl": "nestle-s-a",
  "nestle": "nestle-s-a",
  "delta-air-lines": "delta-air-lines",
  "spotify-technology": "spotify",
  "spotify-technology-s-a": "spotify",
};

function slugVariants(name) {
  const s = toSlug(name);
  if (!s) return [];
  const out = new Set([s]);
  let v = s.replace(/-and$/, "");
  if (v !== s) out.add(v);
  for (const q of ["financial","communications","wholesale","boots-alliance","technology","technologies","of-america","group","global","corporation-of-america","worldwide-holdings","international","holdings","plc","sa","s-a","platforms","air-lines","hotels"]) {
    const re = new RegExp(`-${q}$`);
    const next = v.replace(re, "");
    if (next !== v) { out.add(next); v = next; }
  }
  return [...out];
}

function bandOf(score) {
  if (!score) return "unknown";
  const s = String(score).trim();
  if (s === "A" || s === "A-") return "leadership";
  if (s === "B" || s === "B-") return "management";
  if (s === "C" || s === "C-") return "awareness";
  if (s === "D" || s === "D-") return "disclosure";
  if (s === "F") return "failure";
  return "unknown";
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
  } catch { return {}; }
}
async function pickLatestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function resolveSlug(name, indexSlugs, parentMap) {
  for (const v of slugVariants(name)) {
    if (indexSlugs.has(v)) return { slug: v, via: "direct" };
    if (CDP_ALIASES[v] && indexSlugs.has(CDP_ALIASES[v])) {
      return { slug: CDP_ALIASES[v], via: "alias" };
    }
    const pm = parentMap[v];
    if (pm?.parent && indexSlugs.has(pm.parent)) return { slug: pm.parent, via: "brand-parent" };
  }
  return { slug: null, via: "orphan" };
}

async function main() {
  console.log("CDP Climate merger");
  const rawPath = await pickLatestRawFile();
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const companies = raw.companies || [];

  const indexSlugs = await loadIndexSlugs();
  const parentMap = await loadParentMap();

  const bySlug = {};
  const routing = { direct: 0, alias: 0, "brand-parent": 0, orphan: 0 };
  const orphans = [];

  // Rank score for "higher wins" merging on duplicate slugs.
  const rank = { A: 8, "A-": 7, B: 6, "B-": 5, C: 4, "C-": 3, D: 2, "D-": 1, F: 0 };

  for (const c of companies) {
    if (!c?.name) continue;
    const { slug, via } = resolveSlug(c.name, indexSlugs, parentMap);
    routing[via]++;
    if (!slug) { orphans.push({ name: c.name, score: c.score }); continue; }
    const cur = bySlug[slug]?.climateDisclosure;
    const curRank = cur ? (rank[cur.score] ?? -1) : -1;
    const newRank = rank[c.score] ?? -1;
    if (cur && curRank >= newRank) continue;
    bySlug[slug] = {
      climateDisclosure: {
        score: c.score,
        band: bandOf(c.score),
        vintage: raw._vintage || null,
        note: c.note || null,
        sourceUrl: "https://www.cdp.net/en/companies/companies-scores",
      },
    };
  }

  const output = {
    _license: raw._license || "Public — CDP scores",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: raw._source || "https://www.cdp.net",
    _vintage: raw._vintage,
    _matched_slugs: Object.keys(bySlug).length,
    _routing_counts: routing,
    _orphans: orphans.slice(0, 50),
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
    console.error("cdp-climate-merge failed:", err);
    process.exit(1);
  });
}
