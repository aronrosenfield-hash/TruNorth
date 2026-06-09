#!/usr/bin/env node
/**
 * Carbon Majors — Merge step. Reads most recent
 * data/raw/carbon-majors/<date>.json and produces
 * data/derived/carbon-majors-augment.json keyed by TruNorth slug.
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/carbon-majors");
const OUT_FILE = path.join(ROOT, "data/derived/carbon-majors-augment.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");

async function latestRaw() {
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error("No raw carbon-majors files");
  return path.join(RAW_DIR, files[files.length - 1]);
}

async function run() {
  const inPath = await latestRaw();
  const raw = JSON.parse(await fs.readFile(inPath, "utf8"));
  const companies = {};
  let kept = 0, skipped = 0;
  for (const r of raw.rows || []) {
    const slug = r.slug;
    if (!slug) { skipped++; continue; }
    // Confirm the slug exists as a brand file (best-effort match).
    const slugFile = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(slugFile)) { skipped++; continue; }
    companies[slug] = {
      display_name: r.name,
      ownership: r.ownership,
      share_total_pct: r.share_total_pct,
      share_since_1988_pct: r.share_since_1988_pct,
      primary_commodities: r.primary_commodities,
    };
    kept++;
  }
  const out = {
    generated_at: new Date().toISOString(),
    source: "carbon-majors",
    source_url: "https://carbonmajors.org",
    license: "CC BY 4.0 — Climate Accountability Institute (Heede 2024).",
    upstream_file: path.relative(ROOT, inPath),
    company_count: kept,
    companies,
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`carbon-majors-augment: kept=${kept} skipped=${skipped} → ${OUT_FILE}`);
}
run().catch(e => { console.error(e); process.exit(1); });
