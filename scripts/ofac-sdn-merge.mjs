#!/usr/bin/env node
/**
 * DW-7 — OFAC SDN merge.
 *
 * Reads the most-recent /data/raw/ofac-sdn/<date>.json snapshot, normalises
 * SDN entity names against /public/data/companies/<slug>.json names + the
 * existing brand-parent-map, and emits a single augment file:
 *
 *   data/derived/ofac-sdn-augment.json
 *
 * The augment is keyed by TruNorth slug → match record. The brand merger
 * step (run later by the per-source pipeline) is responsible for actually
 * writing that into per-company JSON. We deliberately stay one level
 * removed so we can re-run, diff, and review before touching company files.
 *
 * Flags:
 *   --raw PATH   override the input snapshot path (default: latest in data/raw)
 *   --out PATH   override the augment output path
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ofac-sdn");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/ofac-sdn-augment.json");

function parseArgs(argv) {
  const out = { rawPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") out.rawPath = argv[++i];
    else if (argv[i] === "--out") out.outPath = argv[++i];
  }
  return out;
}

async function loadLatestRaw() {
  try {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
    if (files.length === 0) return null;
    return path.join(RAW_DIR, files[files.length - 1]);
  } catch { return null; }
}

async function loadCompanySlugs() {
  if (!existsSync(COMP_DIR)) return [];
  const files = await fs.readdir(COMP_DIR);
  return files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
}

async function loadParentMap() {
  const p = path.join(META_DIR, "brand-parent-map.json");
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return {}; }
}

/**
 * Map of TruNorth slug → set of normalized aliases. We index BY ALIAS so
 * the SDN scan can do O(1) hits instead of O(slugs * sdn) string compare.
 */
export function buildAliasIndex(slugs, parentMap) {
  const idx = new Map(); // normalized alias → slug
  for (const slug of slugs) {
    const norm = normalizeCompanyName(slug.replace(/-/g, " "));
    if (norm) idx.set(norm, slug);
    const aliases = parentMap[slug]?.aliases || [];
    for (const a of aliases) {
      const n = normalizeCompanyName(a);
      if (n) idx.set(n, slug);
    }
  }
  return idx;
}

/**
 * For a single OFAC entity, compute the best slug match by:
 *   1. Exact normalised name match against the alias index.
 *   2. Substring match (entity contains alias, length >= 4).
 */
export function matchEntity(entity, aliasIdx) {
  const en = normalizeCompanyName(entity.name);
  if (!en) return null;
  if (aliasIdx.has(en)) return aliasIdx.get(en);
  // Substring match — guard against tiny tokens matching anything.
  for (const [alias, slug] of aliasIdx) {
    if (alias.length < 4) continue;
    if (en.includes(alias)) return slug;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) {
    console.error(`No raw snapshot found under ${RAW_DIR}. Run ofac-sdn-fetch.mjs first.`);
    process.exit(2);
  }
  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));

  const slugs = await loadCompanySlugs();
  const parentMap = await loadParentMap();
  const aliasIdx = buildAliasIndex(slugs, parentMap);

  const matches = {};
  for (const ent of snap.entities || []) {
    const slug = matchEntity(ent, aliasIdx);
    if (!slug) continue;
    if (!matches[slug]) {
      matches[slug] = {
        slug,
        is_sanctioned: true,
        programs: new Set(),
        entities: [],
        earliest_listing: null,
        source: "ofac-sdn",
        source_url: snap.source_url,
      };
    }
    matches[slug].entities.push({
      name: ent.name, program: ent.program, sanction_date: ent.sanction_date,
    });
    if (ent.program) matches[slug].programs.add(ent.program);
    if (ent.sanction_date) {
      const cur = matches[slug].earliest_listing;
      if (!cur || ent.sanction_date < cur) matches[slug].earliest_listing = ent.sanction_date;
    }
  }
  for (const k of Object.keys(matches)) {
    matches[k].programs = [...matches[k].programs];
  }

  const augment = {
    source: "ofac-sdn",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    matched_slug_count: Object.keys(matches).length,
    companies: matches,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath} (${augment.matched_slug_count} slug matches across ${snap.entity_rows} entities)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ofac-sdn-merge failed:", err);
    process.exit(1);
  });
}
