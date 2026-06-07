#!/usr/bin/env node
/**
 * USDA FSIS Recall API (Tier-S DW-6).
 *
 * The Food Safety and Inspection Service publishes every meat/poultry/
 * egg recall as a JSON array. This pipeline is the DW-6 ingest — it
 * differs from the existing scripts/fsis-fetch.mjs (which is keyed off
 * top-500 brands and writes to public/data/fsis-recalls.json) in that
 * it:
 *
 *   1. Downloads the same /fsis/api/recall/v/1 endpoint, but
 *   2. Writes a date-stamped raw snapshot under data/raw/fsis-dw/,
 *   3. Lets the matching merger re-key the data by normalized company
 *      name into data/derived/fsis-dw-augment.json — i.e. one row per
 *      brand with aggregate counts, not one row per top-500 entry.
 *
 * Source:
 *   https://www.fsis.usda.gov/fsis/api/recall/v/1
 *   Public JSON, no auth, includes both English + Spanish records.
 *
 * Cadence: weekly. The FSIS dump is small (~10-15 MB).
 *
 * Output: data/raw/fsis-dw/<YYYY-MM-DD>.json
 *
 * Flags: identical to the other DW fetchers.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/fsis-dw");
const FIXTURE = path.join(ROOT, "test/fixtures/fsis-dw/sample.json");

const FSIS_URL = "https://www.fsis.usda.gov/fsis/api/recall/v/1";
const UA = "TruNorth-FSIS-DW/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null; })();
const OUT_OVERRIDE = (() => { const i = args.indexOf("--out"); return i >= 0 && args[i + 1] ? args[i + 1] : null; })();

const VALID_CLASS = /^class\s*(i|ii|iii)\b/i;

export function parsePounds(s) {
  if (!s) return null;
  const m = String(s).match(/([\d,]+(?:\.\d+)?)\s*pound/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function classifyRisk(cls) {
  if (!cls) return null;
  const m = String(cls).toLowerCase().match(/class\s*(i{1,3})\b/);
  if (!m) return null;
  return { i: "Class I", ii: "Class II", iii: "Class III" }[m[1]] ?? null;
}

/**
 * English-preferred dedupe — FSIS publishes mirror Spanish records that
 * share field_recall_number. We keep the English version, falling back
 * to the Spanish one only if it's the only language for that recall.
 */
export function dedupeRecalls(records) {
  const byNum = new Map();
  for (const r of records) {
    const num = r.field_recall_number || `${r.field_title}|${r.field_recall_date}`;
    const existing = byNum.get(num);
    const isEn = (r.langcode || "").toLowerCase() === "english";
    if (!existing) { byNum.set(num, r); continue; }
    const exEn = (existing.langcode || "").toLowerCase() === "english";
    if (isEn && !exEn) byNum.set(num, r);
  }
  return [...byNum.values()];
}

export function normalizeRecall(r) {
  if (!r) return null;
  const cls = classifyRisk(r.field_recall_classification);
  return {
    recall_number: r.field_recall_number || null,
    company: (r.field_establishment || "").trim() || null,
    title: r.field_title || null,
    date: r.field_recall_date || null,
    risk_level: cls,                   // "Class I" | "Class II" | "Class III"
    risk_text: r.field_risk_level || null,
    reason: r.field_recall_reason || null,
    product: r.field_product_items || null,
    pounds_recalled: parsePounds(r.field_qty_recovered),
    qty_raw: r.field_qty_recovered || null,
    states: r.field_states || null,
    url: r.field_recall_url || null,
  };
}

async function fetchLive() {
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(FSIS_URL, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error(`Unexpected shape: ${typeof data}`);
      return data;
    } catch (e) {
      lastErr = e;
      console.warn(`FSIS attempt ${i} failed: ${e.message}`);
      if (i < 3) await new Promise(r => setTimeout(r, 5000 * i));
    }
  }
  throw lastErr;
}

async function main() {
  console.log(`FSIS-DW fetcher (${APPLY ? "LIVE" : "DRY/fixture"})`);
  const raw = APPLY
    ? await fetchLive()
    : JSON.parse(await fs.readFile(FIXTURE, "utf-8"));

  console.log(`Raw records: ${raw.length}`);
  const deduped = dedupeRecalls(raw);
  console.log(`After English-preferred dedupe: ${deduped.length}`);

  let rows = deduped.map(normalizeRecall).filter(Boolean);
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "fsis-dw",
    source_url: FSIS_URL,
    mode: APPLY ? "live" : "fixture",
    raw_record_count: raw.length,
    deduped_count: deduped.length,
    row_count: rows.length,
    rows,
  }, null, 2));
  console.log(`✅ Wrote ${outPath} — ${rows.length} recalls`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("fsis-dw-fetch failed:", err);
    process.exit(1);
  });
}
