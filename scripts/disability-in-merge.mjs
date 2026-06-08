#!/usr/bin/env node
/**
 * DW-13 — Disability:IN merge.
 *
 * Reads the latest raw payload from data/raw/disability-in/<YYYY-MM-DD>.json
 * and produces data/derived/disability-in-augment.json — a slug-keyed
 * map of { dei_score, year, source_url }. Downstream code merges this
 * into per-company JSON under enriched.disabilityEquality.
 *
 * Resolution:
 *   1. Normalize legal name (strip Inc/Corp/Co/Ltd/etc) via
 *      scripts/lib/company-name-normalize.mjs.
 *   2. Slugify -> kebab-case ascii.
 *   3. Emit { <slug>: {...} } map.
 *
 * Flags:
 *   --in path.json   pick a specific raw file (default: newest in data/raw)
 *   --out path.json  override derived path
 *
 * Locally:
 *   node scripts/disability-in-merge.mjs
 *   node scripts/disability-in-merge.mjs --in data/raw/disability-in/2026-06-07.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/disability-in");
const DERIVED = path.join(ROOT, "data/derived/disability-in-augment.json");

const args = process.argv.slice(2);
function val(name, fb = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fb;
}

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const out = {};
  for (const r of records) {
    if (!r.company) continue;
    const slug = toSlug(r.company);
    if (!slug) continue;
    // If two rows hash to the same slug, keep the higher score / newer year.
    const existing = out[slug];
    const cand = {
      dei_score:        r.dei_score,
      year:             r.year,
      normalized_name:  normalizeCompanyName(r.company),
      raw_name:         r.company,
      source:           "disability-in",
      source_url:       "https://disabilityin.org/what-we-do/disability-equality-index/",
    };
    if (!existing) out[slug] = cand;
    else if ((cand.year ?? 0) > (existing.year ?? 0)) out[slug] = cand;
    else if ((cand.year ?? 0) === (existing.year ?? 0) && (cand.dei_score ?? -1) > (existing.dei_score ?? -1)) out[slug] = cand;
  }
  return out;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) {
    console.error(`Missing raw input. Run disability-in-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);

  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source:       "disability-in",
    source_url:   "https://disabilityin.org/what-we-do/disability-equality-index/",
    input:        path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies:    augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("disability-in-merge failed:", err);
    process.exit(1);
  });
}
