#!/usr/bin/env node
/**
 * RDR Big Tech merge.
 *
 * Reads newest data/raw/rdr-bigtech/<date>.json
 *   → data/derived/rdr-bigtech-augment.json keyed by company slug.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/rdr-bigtech");
const DERIVED = path.join(ROOT, "data/derived/rdr-bigtech-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const NAME_TO_SLUGS = {
  "Meta":                       ["meta-platforms", "meta-facebook"],
  "Microsoft":                  ["microsoft"],
  "Google":                     ["google-alphabet", "alphabet", "google"],
  "Apple":                      ["apple"],
  "Amazon":                     ["amazon"],
  "Verizon Media (Yahoo)":      ["yahoo", "verizon", "verizon-communications"],
  "Twitter":                    ["twitter", "x-corp"],
  "Kakao":                      ["kakao"],
  "Samsung":                    ["samsung", "samsung-electronics"],
  "Telefónica":                 ["telefonica"],
  "Vodafone":                   ["vodafone"],
  "Deutsche Telekom":           ["deutsche-telekom"],
  "AT&T":                       ["att", "att-inc", "at-t"],
  "América Móvil":              ["america-movil"],
  "OpenAI":                     ["openai"],
  "ByteDance":                  ["bytedance"],
  "Tencent":                    ["tencent"],
  "Alibaba":                    ["alibaba", "alibaba-group"],
  "Baidu":                      ["baidu"],
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
      // Highest composite wins per slug.
      const prev = by[slug];
      if (prev && prev.composite >= r.composite) continue;
      by[slug] = {
        composite: r.composite,
        governance: r.governance,
        expression: r.expression,
        privacy: r.privacy,
        rank: r.rank,
        year: r.year,
        tier: r.tier,
        source: "rdr-bigtech",
        source_url: "https://rankingdigitalrights.org/index2024/",
      };
    }
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run rdr-bigtech-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "rdr-bigtech",
    source_url: "https://rankingdigitalrights.org/index2024/",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("rdr-bigtech-merge failed:", err); process.exit(1); });
}
