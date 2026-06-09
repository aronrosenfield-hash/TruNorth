#!/usr/bin/env node
/**
 * EFF Who Has Your Back? merge.
 *
 * Reads newest data/raw/eff-whyb/<date>.json
 *   → data/derived/eff-whyb-augment.json keyed by company slug.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/eff-whyb");
const DERIVED = path.join(ROOT, "data/derived/eff-whyb-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const NAME_TO_SLUGS = {
  "Apple":                  ["apple"],
  "Adobe":                  ["adobe"],
  "Dropbox":                ["dropbox"],
  "Reddit":                 ["reddit"],
  "Pinterest":              ["pinterest"],
  "Wikimedia":              ["wikimedia", "wikipedia"],
  "WordPress / Automattic": ["automattic", "wordpress"],
  "Lyft":                   ["lyft"],
  "Uber":                   ["uber", "uber-technologies"],
  "Microsoft":              ["microsoft"],
  "Slack":                  ["slack", "salesforce"],
  "Facebook (Meta)":        ["meta-platforms", "meta-facebook", "facebook"],
  "Google":                 ["google-alphabet", "alphabet", "google"],
  "Twitter":                ["twitter", "x-corp"],
  "Amazon":                 ["amazon"],
  "AT&T":                   ["att", "att-inc", "at-t"],
  "Comcast":                ["comcast"],
  "Verizon":                ["verizon", "verizon-communications"],
  "T-Mobile":               ["t-mobile", "tmobile", "t-mobile-us"],
  "WhatsApp":               ["whatsapp", "meta-platforms"],
  "Snap (Snapchat)":        ["snap", "snap-inc", "snapchat"],
  "LinkedIn":               ["linkedin", "microsoft"],
  "Tumblr (Automattic)":    ["tumblr", "automattic"],
  "Yahoo (Verizon Media)":  ["yahoo", "verizon"],
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
      // Highest score wins per slug (if a slug aliases multiple records, pick best).
      const prev = by[slug];
      if (prev && prev.stars >= r.stars) continue;
      by[slug] = {
        stars: r.stars,
        max_stars: 5,
        tier: r.tier,
        year: r.year,
        criteria: r.criteria,
        source: "eff-whyb",
        source_url: "https://www.eff.org/who-has-your-back-2019",
      };
    }
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run eff-whyb-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "eff-whyb",
    source_url: "https://www.eff.org/who-has-your-back-2019",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("eff-whyb-merge failed:", err); process.exit(1); });
}
