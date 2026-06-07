#!/usr/bin/env node
/**
 * DW-14 — CFTC enforcement merge.
 *
 * Reads the newest data/raw/cftc-enforcement/<date>.json and emits
 * data/derived/cftc-enforcement-augment.json — a slug-keyed map of
 * { total_penalty_usd, action_count, latest_date, sample_actions[] }.
 *
 * Slug resolution uses scripts/lib/company-name-normalize.mjs.
 *
 * Flags:
 *   --in path     specific raw input
 *   --out path    override derived path
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cftc-enforcement");
const DERIVED = path.join(ROOT, "data/derived/cftc-enforcement-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    if (!r.respondent) continue;
    const slug = toSlug(r.respondent);
    if (!slug) continue;
    if (!by[slug]) {
      by[slug] = {
        normalized_name:    normalizeCompanyName(r.respondent),
        raw_name:           r.respondent,
        total_penalty_usd:  0,
        action_count:       0,
        latest_date:        null,
        sample_actions:     [],
        source:             "cftc-enforcement",
        source_url:         "https://www.cftc.gov/PressRoom/PressReleases",
      };
    }
    const agg = by[slug];
    agg.total_penalty_usd += r.civil_penalty || 0;
    agg.action_count += 1;
    if (!agg.latest_date || (r.date && r.date > agg.latest_date)) agg.latest_date = r.date || agg.latest_date;
    if (agg.sample_actions.length < 5) {
      agg.sample_actions.push({
        date:           r.date,
        violation:      r.violation,
        civil_penalty:  r.civil_penalty,
        url:            r.url,
      });
    }
  }
  // Sort each sample by date desc for stable, friendly output.
  for (const slug of Object.keys(by)) {
    by[slug].sample_actions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) {
    console.error(`Missing raw input. Run cftc-enforcement-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:    new Date().toISOString(),
    source:          "cftc-enforcement",
    source_url:      "https://www.cftc.gov/PressRoom/PressReleases",
    input:           path.relative(ROOT, inPath),
    company_count:   Object.keys(augment).length,
    companies:       augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("cftc-enforcement-merge failed:", err); process.exit(1); });
}
