#!/usr/bin/env node
/**
 * FSIS DW-6 — Merge step.
 *
 * Reads latest data/raw/fsis-dw/<date>.json and writes
 * data/derived/fsis-dw-augment.json. Aggregates one row per
 * normalized brand with rolling counts.
 *
 * Per-company shape:
 *   {
 *     display_name,
 *     total_recalls: N,                   // all-time
 *     recent_24mo_count: N,               // last 24 months
 *     class_I_count, class_II_count, class_III_count,
 *     pounds_recalled_total: number,
 *     last_recall_date: "YYYY-MM-DD",
 *     top_reasons: [{label, count}],
 *     recent_recalls: [...up to 5 most recent...],
 *     hasMeatPoultryRecall24mo: boolean,
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/fsis-dw");
const OUT_DEFAULT = path.join(ROOT, "data/derived/fsis-dw-augment.json");

const args = process.argv.slice(2);
const IN_OVERRIDE = (() => { const i = args.indexOf("--in"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

const TWENTY_FOUR_MONTHS_MS = 730 * 24 * 60 * 60 * 1000;

async function findLatestRaw() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  if (!existsSync(RAW_DIR)) throw new Error(`Missing ${RAW_DIR}`);
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

/**
 * Aggregate an array of (already-normalized) FSIS recalls into a
 * per-company augment block.
 *
 * Exported for unit tests.
 */
export function aggregate(rows, now = Date.now()) {
  const byBrand = new Map();
  for (const r of rows) {
    if (!r.company) continue;
    const key = toSlug(r.company);
    if (!key) continue;
    let entry = byBrand.get(key);
    if (!entry) {
      entry = {
        display_name: r.company,
        recalls: [],
      };
      byBrand.set(key, entry);
    }
    entry.recalls.push(r);
  }

  const cutoff = now - TWENTY_FOUR_MONTHS_MS;
  const out = {};
  for (const [key, entry] of byBrand) {
    const recalls = entry.recalls.slice().sort((a, b) => {
      const ta = Date.parse(a.date || 0);
      const tb = Date.parse(b.date || 0);
      return tb - ta;
    });
    const recent24 = recalls.filter(r => {
      const t = Date.parse(r.date || 0);
      return !Number.isNaN(t) && t > cutoff;
    });
    const classI = recalls.filter(r => r.risk_level === "Class I");
    const classII = recalls.filter(r => r.risk_level === "Class II");
    const classIII = recalls.filter(r => r.risk_level === "Class III");
    const reasons = recalls.flatMap(r => (r.reason || "").split(/\s*,\s*/).filter(Boolean));
    const totalPounds = recalls.reduce((s, r) => s + (r.pounds_recalled || 0), 0);

    out[key] = {
      display_name: entry.display_name,
      total_recalls: recalls.length,
      recent_24mo_count: recent24.length,
      class_I_count: classI.length,
      class_II_count: classII.length,
      class_III_count: classIII.length,
      pounds_recalled_total: Math.round(totalPounds),
      last_recall_date: recalls[0]?.date ?? null,
      top_reasons: topN(reasons, 5),
      recent_recalls: recalls.slice(0, 5).map(r => ({
        recall_number: r.recall_number,
        date: r.date,
        risk_level: r.risk_level,
        reason: r.reason,
        product: r.product,
        pounds_recalled: r.pounds_recalled,
        states: r.states,
        url: r.url,
      })),
      hasMeatPoultryRecall24mo: recent24.length > 0,
    };
  }
  return out;
}

async function main() {
  const inFile = await findLatestRaw();
  const outFile = OUT_OVERRIDE ?? OUT_DEFAULT;
  console.log(`FSIS-DW merge: ${inFile} → ${outFile}`);

  const src = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const rows = src.rows || [];
  const companies = aggregate(rows);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "fsis-dw",
    source_url: "https://www.fsis.usda.gov/recalls",
    upstream_file: path.relative(ROOT, inFile),
    company_count: Object.keys(companies).length,
    companies,
  }, null, 2));

  const recentBrands = Object.values(companies).filter(c => c.hasMeatPoultryRecall24mo).length;
  console.log(`✅ Wrote ${outFile} — ${Object.keys(companies).length} brands (${recentBrands} with recalls in last 24mo)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("fsis-dw-merge failed:", err);
    process.exit(1);
  });
}
