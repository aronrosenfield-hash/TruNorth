#!/usr/bin/env node
/**
 * CPPA enforcement merge → data/derived/cppa-enforcement-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cppa-enforcement");
const DERIVED = path.join(ROOT, "data/derived/cppa-enforcement-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const COMPANY_TO_SLUGS = [
  [/honda/i,      ["honda", "american-honda-motor", "honda-motor"]],
  [/doordash/i,   ["doordash"]],
  [/tilting point/i, ["tilting-point", "tilting-point-media"]],
  [/sephora/i,    ["sephora", "sephora-usa"]],
  [/sling tv|dish network/i, ["sling-tv", "dish-network", "echostar"]],
];

function slugsForCompany(name) {
  for (const [re, slugs] of COMPANY_TO_SLUGS) if (re.test(name)) return slugs;
  return [];
}

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    const slugs = slugsForCompany(r.company || "");
    if (!slugs.length) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          action_count: 0,
          total_penalty_usd: 0,
          latest_action: null,
          actions: [],
          source: "cppa-enforcement",
          source_url: "https://cppa.ca.gov/enforcement/",
        };
      }
      const agg = by[slug];
      agg.action_count += 1;
      agg.total_penalty_usd += Number(r.penalty_usd || 0);
      if (!agg.latest_action || (r.date || "") > agg.latest_action) agg.latest_action = r.date || agg.latest_action;
      agg.actions.push({
        date: r.date, action_type: r.action_type, penalty_usd: r.penalty_usd,
        summary: r.summary, url: r.url,
      });
    }
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run cppa-enforcement-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "cppa-enforcement",
    source_url: "https://cppa.ca.gov/enforcement/",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("cppa-enforcement-merge failed:", err); process.exit(1); });
