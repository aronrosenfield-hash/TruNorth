#!/usr/bin/env node
/**
 * Child-safety tech merge → data/derived/child-safety-tech-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/child-safety-tech");
const DERIVED = path.join(ROOT, "data/derived/child-safety-tech-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const COMPANY_TO_SLUGS = [
  [/^meta/i,               ["meta-platforms", "meta-facebook", "facebook"]],
  [/tiktok|bytedance/i,    ["tiktok", "bytedance"]],
  [/^snap/i,               ["snap", "snap-inc", "snapchat"]],
  [/youtube|google|alphabet/i, ["google-alphabet", "alphabet", "google", "youtube"]],
  [/roblox/i,              ["roblox", "roblox-corporation"]],
  [/discord/i,             ["discord"]],
  [/epic games|fortnite/i, ["epic-games"]],
  [/microsoft|xbox/i,      ["microsoft", "xbox"]],
  [/amazon/i,              ["amazon"]],
  [/pinterest/i,           ["pinterest"]],
  [/x corp|^x \(twitter/i, ["x-corp", "twitter"]],
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

const RATING_RANK = { mixed: 1, poor: 2 };

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    const slugs = slugsForCompany(r.company || "");
    if (!slugs.length) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          rating: r.rating,
          issue_count: 0,
          platforms: new Set(),
          source_orgs: new Set(),
          issues: [],
          source: "child-safety-tech",
          source_url: "https://5rightsfoundation.com/our-work/",
        };
      }
      const agg = by[slug];
      agg.issue_count += 1;
      if (RATING_RANK[r.rating] > RATING_RANK[agg.rating]) agg.rating = r.rating;
      for (const p of (r.platforms || [])) agg.platforms.add(p);
      if (r.source_org) agg.source_orgs.add(r.source_org);
      agg.issues.push({ issue: r.issue, summary: r.summary, url: r.url, rating: r.rating });
    }
  }
  // Sets → arrays
  for (const slug of Object.keys(by)) {
    by[slug].platforms   = [...by[slug].platforms];
    by[slug].source_orgs = [...by[slug].source_orgs];
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run child-safety-tech-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "child-safety-tech",
    source_url: "https://5rightsfoundation.com/our-work/",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("child-safety-tech-merge failed:", err); process.exit(1); });
