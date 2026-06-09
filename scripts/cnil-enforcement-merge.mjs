#!/usr/bin/env node
/**
 * CNIL enforcement merge → data/derived/cnil-enforcement-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cnil-enforcement");
const DERIVED = path.join(ROOT, "data/derived/cnil-enforcement-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const COMPANY_TO_SLUGS = [
  [/^google/i,      ["google-alphabet", "alphabet", "google"]],
  [/facebook|meta/i,["meta-platforms", "meta-facebook", "facebook"]],
  [/amazon/i,       ["amazon"]],
  [/clearview/i,    ["clearview-ai"]],
  [/microsoft/i,    ["microsoft"]],
  [/^apple/i,       ["apple"]],
  [/spartoo/i,      ["spartoo"]],
  [/carrefour/i,    ["carrefour"]],
  [/criteo/i,       ["criteo"]],
  [/discord/i,      ["discord"]],
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
          total_fines_eur: 0,
          latest_action: null,
          actions: [],
          source: "cnil-enforcement",
          source_url: "https://www.cnil.fr/en/cnils-sanctions",
        };
      }
      const agg = by[slug];
      agg.action_count += 1;
      agg.total_fines_eur += Number(r.fine_eur || 0);
      if (!agg.latest_action || (r.date || "") > agg.latest_action) agg.latest_action = r.date || agg.latest_action;
      agg.actions.push({ date: r.date, fine_eur: r.fine_eur, issue: r.issue, summary: r.summary, url: r.url });
    }
  }
  for (const slug of Object.keys(by)) by[slug].actions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run cnil-enforcement-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "cnil-enforcement",
    source_url: "https://www.cnil.fr/en/cnils-sanctions",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("cnil-enforcement-merge failed:", err); process.exit(1); });
