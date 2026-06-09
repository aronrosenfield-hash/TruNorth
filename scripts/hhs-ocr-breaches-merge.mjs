#!/usr/bin/env node
/**
 * HHS OCR HIPAA breaches merge — group by covered entity → company slug.
 *
 * Reads newest data/raw/hhs-ocr-breaches/<date>.json
 *   → data/derived/hhs-ocr-breaches-augment.json keyed by company slug.
 *
 * Each entry: breach_count, total_individuals, first_breach, last_breach,
 * largest_breach, sample_breaches[3], sources_url.
 *
 * Covered entity → slug mapping is conservative: emit BOTH subsidiary and
 * known parent so apply-augments can pick whichever exists.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/hhs-ocr-breaches");
const DERIVED = path.join(ROOT, "data/derived/hhs-ocr-breaches-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

// Covered-entity substring → list of candidate TruNorth slugs.
// Order doesn't matter — apply-augments picks whichever slug has a file.
const ENTITY_TO_SLUGS = [
  [/anthem/i,                       ["anthem", "anthem-elevance-health", "elevance-health"]],
  [/change healthcare|unitedhealth/i, ["unitedhealth", "unitedhealth-group", "change-healthcare", "optum"]],
  [/premera/i,                      ["premera", "premera-blue-cross"]],
  [/excellus/i,                     ["excellus", "excellus-bcbs"]],
  [/community health systems/i,     ["community-health-systems", "chs"]],
  [/advocate health/i,              ["advocate-health", "advocate-aurora-health", "advocate-health-care"]],
  [/medical informatics engineering|nomoreclipboard/i, ["medical-informatics-engineering"]],
  [/banner health/i,                ["banner-health"]],
  [/newkirk products/i,             ["newkirk-products"]],
  [/21st century oncology/i,        ["21st-century-oncology"]],
  [/ucla health/i,                  ["ucla-health", "ucla"]],
  [/quest diagnostics/i,            ["quest-diagnostics"]],
  [/labcorp/i,                      ["labcorp", "laboratory-corporation-of-america"]],
  [/inmediata/i,                    ["inmediata", "inmediata-health-group"]],
  [/magellan health/i,              ["magellan-health"]],
  [/cvs/i,                          ["cvs", "cvs-health", "cvs-pharmacy", "cvs-caremark"]],
  [/walgreens|walgreen co/i,        ["walgreens", "walgreens-boots-alliance", "walgreen-co"]],
  [/walmart/i,                      ["walmart", "walmart-pharmacy"]],
  [/aetna/i,                        ["aetna", "aetna-inc"]],
  [/multiplan/i,                    ["multiplan"]],
  [/maximus/i,                      ["maximus", "maximus-inc"]],
  [/hca healthcare/i,               ["hca-healthcare", "hca"]],
  [/welltok/i,                      ["welltok"]],
  [/concentra/i,                    ["concentra", "concentra-health-services", "select-medical"]],
  [/kaiser/i,                       ["kaiser", "kaiser-permanente", "kaiser-foundation-health-plan"]],
  [/trinity health/i,               ["trinity-health"]],
  [/pharmerica|brightspring/i,      ["pharmerica", "brightspring-health"]],
  [/independent living systems/i,   ["independent-living-systems"]],
  [/shields health/i,               ["shields-health-care", "shields-health-care-group"]],
  [/eye care leaders|icare holding/i, ["eye-care-leaders", "icare-holding"]],
];

function slugsForEntity(name) {
  for (const [re, slugs] of ENTITY_TO_SLUGS) if (re.test(name)) return slugs;
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
    const slugs = slugsForEntity(r.covered_entity || "");
    if (!slugs.length) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          breach_count: 0,
          total_individuals: 0,
          first_breach: null,
          last_breach: null,
          largest_breach: null,
          sample_breaches: [],
          source: "hhs-ocr-breaches",
          source_url: "https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf",
        };
      }
      const agg = by[slug];
      agg.breach_count += 1;
      const n = Number(r.individuals_affected || 0);
      agg.total_individuals += n;
      const d = r.submission_date || "";
      if (d) {
        if (!agg.first_breach || d < agg.first_breach) agg.first_breach = d;
        if (!agg.last_breach || d > agg.last_breach) agg.last_breach = d;
      }
      if (!agg.largest_breach || n > (agg.largest_breach.individuals || 0)) {
        agg.largest_breach = {
          covered_entity: r.covered_entity,
          individuals: n,
          submission_date: d,
          breach_type: r.breach_type,
          description: r.description,
        };
      }
      if (agg.sample_breaches.length < 3) {
        agg.sample_breaches.push({
          covered_entity: r.covered_entity,
          individuals: n,
          submission_date: d,
          breach_type: r.breach_type,
        });
      }
    }
  }
  for (const slug of Object.keys(by)) {
    by[slug].sample_breaches.sort((a, b) => (b.submission_date || "").localeCompare(a.submission_date || ""));
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run hhs-ocr-breaches-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "hhs-ocr-breaches",
    source_url: "https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("hhs-ocr-breaches-merge failed:", err); process.exit(1); });
}
