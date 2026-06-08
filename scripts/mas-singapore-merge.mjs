#!/usr/bin/env node
/**
 * DW-16 — Singapore MAS merge.
 *
 * data/raw/mas-singapore/<date>.json -> data/derived/mas-singapore-augment.json.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/mas-singapore");
const DERIVED = path.join(ROOT, "data/derived/mas-singapore-augment.json");

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
    if (!r.entity) continue;
    const slug = toSlug(r.entity);
    if (!slug) continue;
    if (!by[slug]) {
      by[slug] = {
        normalized_name:  normalizeCompanyName(r.entity),
        raw_name:         r.entity,
        total_amount_sgd: 0,
        action_count:     0,
        latest_action:    null,
        sample_actions:   [],
        source:           "mas-singapore",
        source_url:       "https://www.mas.gov.sg/regulation/enforcement/enforcement-actions",
      };
    }
    const agg = by[slug];
    agg.total_amount_sgd += r.amount_sgd || 0;
    agg.action_count     += 1;
    if (!agg.latest_action || (r.date && r.date > agg.latest_action)) {
      agg.latest_action = r.date || agg.latest_action;
    }
    if (agg.sample_actions.length < 5) {
      agg.sample_actions.push({
        action_type: r.action_type,
        date:        r.date,
        amount_sgd:  r.amount_sgd,
        url:         r.url,
      });
    }
  }
  for (const slug of Object.keys(by)) {
    by[slug].sample_actions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run mas-singapore-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:   new Date().toISOString(),
    source:         "mas-singapore",
    source_url:     "https://www.mas.gov.sg/regulation/enforcement/enforcement-actions",
    input:          path.relative(ROOT, inPath),
    company_count:  Object.keys(augment).length,
    companies:      augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("mas-singapore-merge failed:", err); process.exit(1); });
}
