#!/usr/bin/env node
/**
 * DW-12 — 1% for the Planet merge.
 *
 * Reads latest /data/raw/one-percent-planet/<date>.json, attributes each
 * member business to a TruNorth slug, writes:
 *
 *   data/derived/one-percent-planet-augment.json
 *
 * Per-slug shape:
 *   {
 *     slug, is_one_percent_member: true,
 *     business_name, country, member_since, category,
 *     source, source_url
 *   }
 *
 * Members never have multiple entries per slug — first hit wins.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/one-percent-planet");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/one-percent-planet-augment.json");

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

export function matchMember(name, idx) {
  const en = normalizeCompanyName(name);
  if (!en) return null;
  if (idx.has(en)) return idx.get(en);
  for (const [alias, slug] of idx) {
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

  const companies = {};
  for (const m of snap.members || []) {
    const slug = matchMember(m.business_name, idx);
    if (!slug || companies[slug]) continue;
    companies[slug] = {
      slug,
      is_one_percent_member: true,
      business_name: m.business_name,
      country: m.country,
      member_since: m.member_since,
      category: m.category,
      source: "one-percent-planet",
      source_url: snap.source_url,
    };
  }

  const augment = {
    source: "one-percent-planet",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    matched_slug_count: Object.keys(companies).length,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath} (${augment.matched_slug_count} slugs / ${snap.member_count} members)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("one-percent-planet-merge failed:", err);
    process.exit(1);
  });
}
