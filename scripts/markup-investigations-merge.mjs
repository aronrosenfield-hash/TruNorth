#!/usr/bin/env node
/**
 * The Markup investigations merge.
 *
 * Reads newest data/raw/markup-investigations/<date>.json
 *   → data/derived/markup-investigations-augment.json keyed by company slug.
 *
 * Each slug gets an investigation count + 3 most-recent headlines.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/markup-investigations");
const DERIVED = path.join(ROOT, "data/derived/markup-investigations-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const SUBJECT_TO_SLUGS = {
  "Meta":                ["meta-platforms", "meta-facebook"],
  "Google":              ["google-alphabet", "alphabet", "google"],
  "Amazon":              ["amazon"],
  "TikTok":              ["tiktok", "bytedance"],
  "Allstate":            ["allstate"],
  "LexisNexis":          ["lexisnexis", "relx"],
  "Uber":                ["uber", "uber-technologies"],
  "Lyft":                ["lyft"],
  "Roomba (iRobot)":     ["irobot"],
  "Ring (Amazon)":       ["amazon", "ring"],
  "Equifax":             ["equifax"],
  "Walmart":             ["walmart"],
  "Target":              ["target"],
  "Microsoft":           ["microsoft"],
  "OpenAI":              ["openai"],
  "Snap":                ["snap", "snap-inc"],
  "X (Twitter)":         ["x-corp", "twitter"],
  "Tesla":               ["tesla"],
};

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    const slugs = SUBJECT_TO_SLUGS[r.subject];
    if (!slugs) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          investigation_count: 0,
          themes: [],
          sample_investigations: [],
          source: "markup-investigations",
          source_url: "https://themarkup.org/series",
        };
      }
      by[slug].investigation_count += 1;
      if (r.theme && !by[slug].themes.includes(r.theme)) by[slug].themes.push(r.theme);
      if (by[slug].sample_investigations.length < 3) {
        by[slug].sample_investigations.push({
          headline: r.headline,
          date: r.date,
          series: r.series,
          theme: r.theme,
          url: r.url,
        });
      }
    }
  }
  for (const slug of Object.keys(by)) {
    by[slug].sample_investigations.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run markup-investigations-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "markup-investigations",
    source_url: "https://themarkup.org/series",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("markup-investigations-merge failed:", err); process.exit(1); });
}
