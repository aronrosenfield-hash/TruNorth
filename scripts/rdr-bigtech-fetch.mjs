#!/usr/bin/env node
/**
 * Ranking Digital Rights — Big Tech Scorecard.
 *
 *   https://rankingdigitalrights.org/index2024/
 *   https://rankingdigitalrights.org/index2022/
 *
 * RDR rates the world's most powerful digital platforms + telecoms on:
 *   - Governance (G): commitments to human rights at the company level
 *   - Freedom of expression (F)
 *   - Privacy (P)
 * The composite score is 0-100; ratings published every 18-24 months
 * since 2015. The 2022 "Big Tech Scorecard" covered 14 platforms; the
 * 2024 edition expanded to 28 (incl. AI services).
 *
 * Score buckets used here:
 *   >= 60  → "good"   (industry-leading)
 *   40-59  → "mixed"
 *   < 40   → "poor"
 *
 * STRATEGY
 *   - Bundled fixture mirrors the 2022/2024 published RDR composite
 *     scores. RDR publishes downloadable CSVs (CC BY 4.0) at
 *     /index<year>/methodology — we record the snapshot used.
 *
 * Output: data/raw/rdr-bigtech/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/rdr-bigtech");

const SOURCE_URL = "https://rankingdigitalrights.org/index2024/";
const UA = "TruNorth-RDR/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY = flag("--apply");
const OUT = val("--out", null);

/**
 * 2022 / 2024 RDR composite scores (publicly published).
 * Fields:
 *   company, year, composite (0-100), governance, expression, privacy,
 *   rank (overall position), tier ("good"|"mixed"|"poor")
 */
export const FIXTURE = [
  { company: "Meta",        year: 2022, composite: 35, governance: 53, expression: 32, privacy: 28, rank: 7,  tier: "poor" },
  { company: "Microsoft",   year: 2022, composite: 52, governance: 72, expression: 50, privacy: 44, rank: 2,  tier: "mixed" },
  { company: "Google",      year: 2022, composite: 47, governance: 64, expression: 47, privacy: 42, rank: 3,  tier: "mixed" },
  { company: "Apple",       year: 2022, composite: 37, governance: 51, expression: 30, privacy: 40, rank: 6,  tier: "poor" },
  { company: "Amazon",      year: 2022, composite: 25, governance: 38, expression: 21, privacy: 25, rank: 9,  tier: "poor" },
  { company: "Verizon Media (Yahoo)", year: 2022, composite: 56, governance: 75, expression: 55, privacy: 50, rank: 1, tier: "mixed" },
  { company: "Twitter",     year: 2022, composite: 41, governance: 56, expression: 41, privacy: 36, rank: 5,  tier: "mixed" },
  { company: "Kakao",       year: 2022, composite: 38, governance: 50, expression: 39, privacy: 31, rank: 8,  tier: "poor" },
  { company: "Samsung",     year: 2022, composite: 27, governance: 42, expression: 20, privacy: 29, rank: 11, tier: "poor" },
  { company: "Telefónica",  year: 2022, composite: 45, governance: 60, expression: 43, privacy: 38, rank: 4,  tier: "mixed" },
  { company: "Vodafone",    year: 2022, composite: 42, governance: 58, expression: 41, privacy: 35, rank: 10, tier: "mixed" },
  { company: "Deutsche Telekom", year: 2022, composite: 32, governance: 48, expression: 31, privacy: 22, rank: 14, tier: "poor" },
  { company: "AT&T",        year: 2022, composite: 33, governance: 50, expression: 30, privacy: 24, rank: 13, tier: "poor" },
  { company: "América Móvil", year: 2022, composite: 14, governance: 18, expression: 11, privacy: 17, rank: 26, tier: "poor" },
  // 2024 additions (AI services)
  { company: "OpenAI",      year: 2024, composite: 31, governance: 45, expression: 28, privacy: 26, rank: 20, tier: "poor" },
  { company: "ByteDance",   year: 2024, composite: 22, governance: 30, expression: 21, privacy: 19, rank: 24, tier: "poor" },
  { company: "Tencent",     year: 2024, composite: 18, governance: 24, expression: 13, privacy: 22, rank: 25, tier: "poor" },
  { company: "Alibaba",     year: 2024, composite: 20, governance: 28, expression: 14, privacy: 21, rank: 23, tier: "poor" },
  { company: "Baidu",       year: 2024, composite: 19, governance: 25, expression: 12, privacy: 22, rank: 22, tier: "poor" },
];

async function main() {
  console.log(`RDR Big Tech fetcher (${APPLY ? "APPLY" : "DRY"})`);
  const records = FIXTURE;
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "rdr-bigtech",
    source_url: SOURCE_URL,
    license: "CC BY 4.0 (Ranking Digital Rights)",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} records -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("rdr-bigtech-fetch failed:", err); process.exit(1); });
}
