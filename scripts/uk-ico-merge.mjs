#!/usr/bin/env node
/**
 * DW-15 — UK ICO merge.
 *
 * Reads newest data/raw/uk-ico/<date>.json -> data/derived/uk-ico-augment.json,
 * keyed by company slug. Aggregates total fines, action counts, and the 5
 * most recent sample actions per organisation.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/uk-ico");
const DERIVED = path.join(ROOT, "data/derived/uk-ico-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    if (!r.organisation) continue;
    const slug = toSlug(r.organisation);
    if (!slug) continue;
    if (!by[slug]) {
      by[slug] = {
        normalized_name: normalizeCompanyName(r.organisation),
        raw_name:        r.organisation,
        total_fines_gbp: 0,
        action_count:    0,
        latest_action:   null,
        sectors:         [],
        sample_actions:  [],
        source:          "uk-ico",
        source_url:      "https://ico.org.uk/action-weve-taken/enforcement/",
      };
    }
    const agg = by[slug];
    agg.total_fines_gbp += r.fine_amount_gbp || 0;
    agg.action_count    += 1;
    if (!agg.latest_action || (r.date_issued && r.date_issued > agg.latest_action)) {
      agg.latest_action = r.date_issued || agg.latest_action;
    }
    if (r.sector && !agg.sectors.includes(r.sector)) agg.sectors.push(r.sector);
    if (agg.sample_actions.length < 5) {
      agg.sample_actions.push({
        action_type:     r.action_type,
        date_issued:     r.date_issued,
        fine_amount_gbp: r.fine_amount_gbp,
        sector:          r.sector,
        url:             r.url,
      });
    }
  }
  for (const slug of Object.keys(by)) {
    by[slug].sample_actions.sort((a, b) => (b.date_issued || "").localeCompare(a.date_issued || ""));
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run uk-ico-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:   new Date().toISOString(),
    source:         "uk-ico",
    source_url:     "https://ico.org.uk/action-weve-taken/enforcement/",
    input:          path.relative(ROOT, inPath),
    company_count:  Object.keys(augment).length,
    companies:      augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("uk-ico-merge failed:", err); process.exit(1); });
}
