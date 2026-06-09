#!/usr/bin/env node
/**
 * Ireland DPC enforcement merge → data/derived/ireland-dpc-augment.json
 *
 * Aggregates per-slug, with raw_name + parent-company alias resolution
 * (e.g. WhatsApp/Instagram/Facebook → meta-platforms).
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ireland-dpc");
const DERIVED = path.join(ROOT, "data/derived/ireland-dpc-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const COMPANY_TO_SLUGS = [
  [/whatsapp/i,        ["meta-platforms"]],
  [/instagram/i,       ["meta-platforms"]],
  [/facebook|meta /i,  ["meta-platforms"]],
  [/^meta /i,          ["meta-platforms"]],
  [/tiktok|bytedance/i, ["bytedance"]],
  [/linkedin/i,        ["microsoft"]], // LinkedIn is a Microsoft subsidiary
  [/twitter|^x internet|^x /i, ["x-corp", "twitter"]],
  [/^google/i,         ["google-alphabet"]],
  [/openai/i,          ["openai"]],
  [/yahoo|verizon media/i, ["yahoo"]],
  [/airbnb/i,          ["airbnb"]],
  [/bank of ireland/i, ["bank-of-ireland-uk"]], // mapped if available
  [/^apple/i,          ["apple"]],
  [/^microsoft/i,      ["microsoft"]],
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
          source: "ireland-dpc",
          source_url: "https://www.dataprotection.ie/en/news-media/press-releases",
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
  if (!inPath || !existsSync(inPath)) { console.error("Run ireland-dpc-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);

  // Filter out slugs that don't exist in catalog to keep augment lean
  const COMP_DIR = path.join(ROOT, "public/data/companies");
  const exists = new Set((await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));
  const resolved = {};
  const skipped = [];
  for (const [slug, v] of Object.entries(augment)) {
    if (exists.has(slug)) resolved[slug] = v; else skipped.push(slug);
  }

  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "ireland-dpc",
    source_url: "https://www.dataprotection.ie/en/news-media/press-releases",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(resolved).length,
    skipped_unresolved: skipped.length,
    skipped_slugs: skipped,
    companies: resolved,
  }, null, 2));
  console.log(`Wrote ${Object.keys(resolved).length} companies -> ${outPath} (skipped ${skipped.length}: ${skipped.join(",") || "none"})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("ireland-dpc-merge failed:", err); process.exit(1); });
