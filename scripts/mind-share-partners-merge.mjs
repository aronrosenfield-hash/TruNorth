#!/usr/bin/env node
/**
 * Mind Share Partners merger — per-slug workplace-mental-health augment.
 *
 * Reads data/raw/mind-share-partners/<date>.json and emits
 * data/derived/mind-share-partners-augment.json:
 *   bySlug: { "<slug>": { mentalHealth: { program, since, sourceUrl } } }
 *
 * Maps signatory legal names to the consumer-facing TruNorth slug via the
 * shared name-normalize helpers + small alias table.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/mind-share-partners");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE   = path.join(ROOT, "data/derived/mind-share-partners-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const MSP_ALIASES = {
  "alphabet": "google-alphabet",
  "amazon-com": "amazon",
  "the-walt-disney": "disney",
  "walt-disney": "disney",
  "the-coca-cola": "coca-cola",
  "the-hershey": "hershey",
  "kellogg": "kellogg-s",
  "kelloggs": "kellogg-s",
  "atandt": "atandt",
  "at-and-t": "atandt",
  "ups": "ups",
  "united-parcel-service": "ups",
  "verizon-communications": "verizon",
  "walgreens-boots-alliance": "walgreens",
  "capital-one-financial": "capital-one",
  "delta-air-lines": "delta-air-lines",
  "spotify-technology-s-a": "spotify",
  "spotify-technology": "spotify",
  "ey-ernst-and-young": "ey",
  "ernst-and-young": "ey",
  "pwc-pricewaterhousecoopers": "pwc",
  "pricewaterhousecoopers": "pwc",
  "deloitte-llp": "deloitte",
  "kpmg-llp": "kpmg",
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
  for (const v of slugVariants(name)) {
    if (indexSlugs.has(v)) return { slug: v, via: "direct" };
    if (MSP_ALIASES[v] && indexSlugs.has(MSP_ALIASES[v])) {
      return { slug: MSP_ALIASES[v], via: "alias" };
    }
  }
  return { slug: null, via: "orphan", attempted: slugVariants(name)[0] };
}

/** Prefer One Mind CEO Pledge over MHaW Pledge in collisions — it's the
 *  earlier and more rigorous commitment. */
const PROG_RANK = {
  "One Mind at Work CEO Pledge": 2,
  "Mental Health at Work Pledge": 1,
};

async function main() {
  console.log("Mind Share Partners merger");
  const rawPath = await pickLatestRawFile();
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const sigs = raw.signatories || [];

  const indexSlugs = await loadIndexSlugs();
  const bySlug = {};
  const routing = { direct: 0, alias: 0, orphan: 0 };
  const orphans = [];

  for (const s of sigs) {
    if (!s?.name) continue;
    const { slug, via, attempted } = resolveSlug(s.name, indexSlugs);
    routing[via]++;
    if (!slug) { orphans.push({ name: s.name, attempted, program: s.program }); continue; }
    const cur = bySlug[slug]?.mentalHealth;
    const curRank = cur ? (PROG_RANK[cur.program] ?? 0) : -1;
    const newRank = PROG_RANK[s.program] ?? 0;
    if (cur && curRank >= newRank) continue;
    bySlug[slug] = {
      mentalHealth: {
        program: s.program,
        since: s.since || null,
        entityName: s.name,
        sourceUrl: s.program === "One Mind at Work CEO Pledge"
          ? "https://onemind.org/onemindatwork/"
          : "https://www.mindsharepartners.org/mental-health-at-work-pledge",
      },
    };
  }

  const output = {
    _license: raw._license || "Public coalition list",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: raw._source || "https://www.mindsharepartners.org/mental-health-at-work-pledge",
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
    console.error("mind-share-partners-merge failed:", err);
    process.exit(1);
  });
}
