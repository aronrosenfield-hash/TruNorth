#!/usr/bin/env node
/**
 * Climate-commitment coalitions — merge step.
 *
 * Reads the most recent data/raw/climate-coalitions/<date>.json
 * (produced by scripts/climate-coalitions-fetch.mjs), groups
 * entries by slug, and emits:
 *
 *   data/derived/climate-coalitions-augment.json
 *
 * Shape (one entry per slug; each may have multiple coalition memberships):
 *   {
 *     generated_at, source, source_urls, company_count,
 *     companies: {
 *       "<slug>": {
 *         display_name: string,
 *         memberships: [{
 *           source:       <key>,       // re100 | ev100 | ep100 | fmc | wmbc | leaf
 *           sourceLabel:  string,      // "RE100", "EV100", …
 *           joinedYear?:  number,
 *           targetYear?:  number,
 *           commitment?:  string,
 *           sector?:      string,
 *           sourceUrl:    string,
 *         }, …],
 *         coalition_count: number,    // = memberships.length
 *         has_re100:       boolean,
 *         has_ev100:       boolean,
 *         has_ep100:       boolean,
 *         has_fmc:         boolean,
 *         has_wmbc:        boolean,
 *         has_leaf:        boolean,
 *       }
 *     }
 *   }
 *
 * Apply step (apply-augments-to-companies.mjs) writes a single
 * `environment` narrative summarising every coalition the brand belongs
 * to. Multi-coalition members get a richer combined sentence.
 *
 * Flags:
 *   --in PATH    — read this raw file instead of newest in data/raw/climate-coalitions/
 *   --out PATH   — override default data/derived/climate-coalitions-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/climate-coalitions");
const OUT_FILE_DEFAULT = path.join(ROOT, "data/derived/climate-coalitions-augment.json");
const ALIAS_FILE = path.join(ROOT, "public/data/_meta/slug-aliases.json");

const args = process.argv.slice(2);
const IN_OVERRIDE = (() => {
  const i = args.indexOf("--in");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();
const OUT_OVERRIDE = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) {
    throw new Error(`Missing raw dir ${RAW_DIR}. Run climate-coalitions-fetch.mjs first.`);
  }
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No raw files in ${RAW_DIR}. Run climate-coalitions-fetch.mjs first.`);
  }
  return path.join(RAW_DIR, files[files.length - 1]);
}

/**
 * Pick the best slug for an entry: slugHint (if provided) overrides
 * the auto-computed slug. Then apply slug-aliases for final routing.
 */
export function resolveSlug(entry, aliases = {}) {
  const initial = entry.slugHint || toSlug(entry.brand);
  if (!initial) return null;
  return aliases[initial] || initial;
}

/**
 * Group raw entries into per-slug memberships. Multiple memberships
 * for the same slug+source collapse to the most-recent joinedYear.
 */
export function groupBySlug(entries, aliases = {}) {
  const out = {};
  for (const e of entries) {
    const slug = resolveSlug(e, aliases);
    if (!slug) continue;
    if (!out[slug]) {
      out[slug] = {
        display_name: e.brand,
        memberships: [],
      };
    }
    const existing = out[slug].memberships.find((m) => m.source === e.source);
    if (existing) {
      // Collapse — prefer the entry with the most-recent joinedYear; merge
      // commitment text if they differ.
      if ((e.joinedYear || 0) > (existing.joinedYear || 0)) {
        existing.joinedYear = e.joinedYear ?? existing.joinedYear;
        existing.targetYear = e.targetYear ?? existing.targetYear;
        existing.commitment = e.commitment ?? existing.commitment;
        existing.sector = e.sector ?? existing.sector;
      }
      continue;
    }
    out[slug].memberships.push({
      source: e.source,
      sourceLabel: e.sourceLabel,
      joinedYear: e.joinedYear ?? null,
      targetYear: e.targetYear ?? null,
      commitment: e.commitment ?? null,
      sector: e.sector ?? null,
      sourceUrl: e.sourceUrl,
    });
  }

  // Derive flat booleans + coalition_count for easier consumption.
  for (const slug of Object.keys(out)) {
    const block = out[slug];
    block.coalition_count = block.memberships.length;
    block.has_re100 = block.memberships.some((m) => m.source === "re100");
    block.has_ev100 = block.memberships.some((m) => m.source === "ev100");
    block.has_ep100 = block.memberships.some((m) => m.source === "ep100");
    block.has_fmc   = block.memberships.some((m) => m.source === "fmc");
    block.has_wmbc  = block.memberships.some((m) => m.source === "wmbc");
    block.has_leaf  = block.memberships.some((m) => m.source === "leaf");
  }
  return out;
}

async function loadAliases() {
  if (!existsSync(ALIAS_FILE)) return {};
  try { return JSON.parse(await fs.readFile(ALIAS_FILE, "utf-8")); }
  catch { return {}; }
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_FILE_DEFAULT;
  console.log(`climate-coalitions merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const entries = src.entries || [];
  const aliases = await loadAliases();
  const companies = groupBySlug(entries, aliases);
  const keys = Object.keys(companies);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "climate-coalitions",
    source_urls: src._source_urls,
    upstream_file: path.relative(ROOT, inFile),
    company_count: keys.length,
    companies,
  }, null, 2));

  console.log(`Wrote ${outFile} — ${keys.length} unique slugs`);

  // Coverage breakdown
  const breakdown = { re100: 0, ev100: 0, ep100: 0, fmc: 0, wmbc: 0, leaf: 0 };
  let multiCoalition = 0;
  for (const k of keys) {
    const b = companies[k];
    if (b.has_re100) breakdown.re100++;
    if (b.has_ev100) breakdown.ev100++;
    if (b.has_ep100) breakdown.ep100++;
    if (b.has_fmc)   breakdown.fmc++;
    if (b.has_wmbc)  breakdown.wmbc++;
    if (b.has_leaf)  breakdown.leaf++;
    if (b.coalition_count >= 2) multiCoalition++;
  }
  console.log(`  Per-coalition coverage: ${JSON.stringify(breakdown)}`);
  console.log(`  Brands in 2+ coalitions: ${multiCoalition}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("climate-coalitions-merge failed:", err);
    process.exit(1);
  });
}
