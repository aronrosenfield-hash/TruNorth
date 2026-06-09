#!/usr/bin/env node
/**
 * Mozilla *Privacy Not Included* merge.
 *
 * Reads newest data/raw/mozilla-pni/<date>.json
 *   → data/derived/mozilla-pni-augment.json keyed by company slug.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/mozilla-pni");
const DERIVED = path.join(ROOT, "data/derived/mozilla-pni-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

// Brand display name → slug aliases present in our company corpus.
const BRAND_ALIASES = {
  "Amazon":          ["amazon"],
  "Meta":            ["meta-platforms", "meta-facebook"],
  "Google":          ["google-alphabet", "alphabet", "google"],
  "Apple":           ["apple"],
  "Microsoft":       ["microsoft"],
  "TikTok":          ["tiktok", "bytedance"],
  "ByteDance":       ["bytedance"],
  "Snap":            ["snap", "snap-inc"],
  "Discord":         ["discord"],
  "Zoom":            ["zoom"],
  "Slack":           ["slack", "salesforce"],
  "Pinterest":       ["pinterest"],
  "X (Twitter)":     ["x-corp", "twitter"],
  "Fitbit":          ["fitbit", "google-alphabet"],
  "Garmin":          ["garmin"],
  "Peloton":         ["peloton"],
  "Tesla":           ["tesla"],
  "Roomba (iRobot)": ["irobot"],
  "Samsung":         ["samsung", "samsung-electronics"],
  "LG":              ["lg", "lg-electronics"],
  "Sonos":           ["sonos"],
  "Anker (eufy)":    ["anker", "eufy"],
  "Roku":            ["roku"],
  "OpenAI":          ["openai"],
  "Replika":         ["replika"],
};

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    const aliases = BRAND_ALIASES[r.brand] || [toSlug(r.brand)];
    for (const slug of aliases) {
      if (!slug) continue;
      // Worst rating wins per slug.
      const prev = by[slug];
      const ratingRank = { warning: 0, poor: 1, mixed: 2, good: 3 };
      if (prev && ratingRank[prev.rating] <= ratingRank[r.rating]) continue;
      by[slug] = {
        rating: r.rating,
        meets_min_security: r.meets_min_security,
        product_count: r.product_count,
        sample_product: r.sample_product,
        review_url: r.review_url,
        note: r.note,
        source: "mozilla-pni",
        source_url: "https://foundation.mozilla.org/en/privacynotincluded/",
      };
    }
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run mozilla-pni-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "mozilla-pni",
    source_url: "https://foundation.mozilla.org/en/privacynotincluded/",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("mozilla-pni-merge failed:", err); process.exit(1); });
}
