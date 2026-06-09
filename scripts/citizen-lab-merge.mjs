#!/usr/bin/env node
/**
 * Citizen Lab merge → data/derived/citizen-lab-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/citizen-lab");
const DERIVED = path.join(ROOT, "data/derived/citizen-lab-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const VENDOR_TO_SLUGS = [
  [/nso group/i,         ["nso-group"]],
  [/candiru|saito tech/i,["candiru", "saito-tech"]],
  [/quadream/i,          ["quadream"]],
  [/cytrox|intellexa/i,  ["cytrox", "intellexa"]],
  [/hacking team|memento labs/i, ["hacking-team", "memento-labs"]],
  [/finfisher|gamma group/i, ["gamma-group", "finfisher"]],
  [/paragon solutions/i, ["paragon-solutions"]],
  [/sandvine/i,          ["sandvine"]],
  [/blue coat|symantec|broadcom/i, ["blue-coat", "symantec", "broadcom"]],
  [/tiktok|bytedance/i,  ["tiktok", "bytedance"]],
  [/tencent|wechat/i,    ["tencent", "wechat"]],
  [/zoom/i,              ["zoom"]],
];

function slugsForVendor(name) {
  for (const [re, slugs] of VENDOR_TO_SLUGS) if (re.test(name)) return slugs;
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
    const slugs = slugsForVendor(r.vendor || "");
    if (!slugs.length) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          report_count: 0,
          severity_max: "moderate",
          first_reported: null,
          last_reported: null,
          reports: [],
          source: "citizen-lab",
          source_url: "https://citizenlab.ca/category/research/targeted-threats/",
        };
      }
      const agg = by[slug];
      agg.report_count += 1;
      const sevRank = { moderate: 1, high: 2, severe: 3 };
      if (sevRank[r.severity] > sevRank[agg.severity_max]) agg.severity_max = r.severity;
      const d = r.first_reported || "";
      if (d) {
        if (!agg.first_reported || d < agg.first_reported) agg.first_reported = d;
        if (!agg.last_reported || d > agg.last_reported) agg.last_reported = d;
      }
      agg.reports.push({
        vendor: r.vendor, product: r.product, severity: r.severity,
        first_reported: d, summary: r.summary, url: r.report_url,
      });
    }
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run citizen-lab-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "citizen-lab",
    source_url: "https://citizenlab.ca/category/research/targeted-threats/",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("citizen-lab-merge failed:", err); process.exit(1); });
