#!/usr/bin/env node
/**
 * DW-8 — BIS Entity List merge.
 *
 * Reads latest /data/raw/bis-entity-list/<date>.json, matches entity names
 * against TruNorth company slugs + parent-map aliases, writes a single:
 *
 *   data/derived/bis-entity-list-augment.json
 *
 * Key shape per matched slug:
 *   {
 *     slug, is_export_restricted: true,
 *     entities: [{ entity, country, license_requirement, fr_citation, effective_date }],
 *     countries: [...],
 *     earliest_listing,
 *     source, source_url
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/bis-entity-list");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/bis-entity-list-augment.json");

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
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadCompanySlugs() {
  if (!existsSync(COMP_DIR)) return [];
  return (await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
}

async function loadParentMap() {
  try { return JSON.parse(await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8")); }
  catch { return {}; }
}

export function buildAliasIndex(slugs, parentMap) {
  const idx = new Map();
  for (const slug of slugs) {
    const n = normalizeCompanyName(slug.replace(/-/g, " "));
    if (n) idx.set(n, slug);
    for (const a of parentMap[slug]?.aliases || []) {
      const nn = normalizeCompanyName(a);
      if (nn) idx.set(nn, slug);
    }
  }
  return idx;
}

export function matchEntity(entity, aliasIdx) {
  const en = normalizeCompanyName(entity);
  if (!en) return null;
  if (aliasIdx.has(en)) return aliasIdx.get(en);
  for (const [alias, slug] of aliasIdx) {
    if (alias.length < 4) continue;
    if (en.includes(alias)) return slug;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const slugs = await loadCompanySlugs();
  const idx = buildAliasIndex(slugs, await loadParentMap());

  const matches = {};
  for (const ent of snap.entities || []) {
    const slug = matchEntity(ent.entity, idx);
    if (!slug) continue;
    if (!matches[slug]) {
      matches[slug] = {
        slug,
        is_export_restricted: true,
        entities: [],
        countries: new Set(),
        earliest_listing: null,
        source: "bis-entity-list",
        source_url: snap.source_url,
      };
    }
    matches[slug].entities.push({
      entity: ent.entity,
      country: ent.country,
      license_requirement: ent.license_requirement,
      fr_citation: ent.fr_citation,
      effective_date: ent.effective_date,
    });
    if (ent.country) matches[slug].countries.add(ent.country);
    if (ent.effective_date) {
      const cur = matches[slug].earliest_listing;
      if (!cur || ent.effective_date < cur) matches[slug].earliest_listing = ent.effective_date;
    }
  }
  for (const k of Object.keys(matches)) matches[k].countries = [...matches[k].countries];

  const augment = {
    source: "bis-entity-list",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    matched_slug_count: Object.keys(matches).length,
    companies: matches,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath} (${augment.matched_slug_count} slugs / ${snap.entity_count} entries)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("bis-entity-list-merge failed:", err);
    process.exit(1);
  });
}
