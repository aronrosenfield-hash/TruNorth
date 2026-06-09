#!/usr/bin/env node
/**
 * FTC Tech Reports / 6(b) studies merge.
 *
 * Reads newest data/raw/ftc-tech-reports/<date>.json
 *   → data/derived/ftc-tech-reports-augment.json keyed by company slug.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ftc-tech-reports");
const DERIVED = path.join(ROOT, "data/derived/ftc-tech-reports-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const NAME_TO_SLUGS = {
  "Meta":                 ["meta-platforms", "meta-facebook"],
  "Amazon":               ["amazon"],
  "Google":               ["google-alphabet", "alphabet", "google"],
  "TikTok (ByteDance)":   ["tiktok", "bytedance"],
  "Snap":                 ["snap", "snap-inc"],
  "X (Twitter)":          ["x-corp", "twitter"],
  "Reddit":               ["reddit"],
  "Discord":              ["discord"],
  "WhatsApp":             ["whatsapp", "meta-platforms"],
  "AT&T":                 ["att", "att-inc", "at-t"],
  "Verizon":              ["verizon", "verizon-communications"],
  "Comcast":              ["comcast"],
  "T-Mobile":             ["t-mobile", "tmobile", "t-mobile-us"],
  "Microsoft":            ["microsoft"],
  "OpenAI":               ["openai"],
  "CVS Health":           ["cvs-health", "cvs-pharmacy"],
  "Cigna":                ["cigna"],
  "UnitedHealth Group":   ["unitedhealth-group", "unitedhealth"],
};

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    const slugs = NAME_TO_SLUGS[r.company];
    if (!slugs) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          mention_count: 0,
          adverse_count: 0,
          studies: [],
          latest_year: null,
          source: "ftc-tech-reports",
          source_url: "https://www.ftc.gov/policy/studies/section-6b-studies",
        };
      }
      by[slug].mention_count += 1;
      if (r.finding_class === "adverse_finding") by[slug].adverse_count += 1;
      if (!by[slug].latest_year || r.study_year > by[slug].latest_year) by[slug].latest_year = r.study_year;
      if (by[slug].studies.length < 4) {
        by[slug].studies.push({
          title: r.study_title,
          year: r.study_year,
          finding_class: r.finding_class,
          note: r.note,
          url: r.url,
        });
      }
    }
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run ftc-tech-reports-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "ftc-tech-reports",
    source_url: "https://www.ftc.gov/policy/studies/section-6b-studies",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("ftc-tech-reports-merge failed:", err); process.exit(1); });
}
