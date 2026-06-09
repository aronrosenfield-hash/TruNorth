#!/usr/bin/env node
/**
 * The Climate Pledge merger — reads the latest raw snapshot, validates
 * slugs exist in TruNorth's index, and writes the augment file.
 *
 * Output: data/derived/the-climate-pledge-augment.json
 *   keyed by slug with { isSignatory: true, joinedYearMonth, brand, source_url }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/climate-pledge");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const OUT_FILE = path.join(ROOT, "data/derived/the-climate-pledge-augment.json");
const SOURCE_URL = "https://www.theclimatepledge.com/us/en/Signatories";

async function loadLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return null;
  return JSON.parse(await fs.readFile(path.join(RAW_DIR, files[files.length - 1]), "utf8"));
}

async function main() {
  const raw = await loadLatestRaw();
  if (!raw) { console.error("[climate-pledge-merge] no raw input"); process.exit(1); }

  const sigList = raw.signatories || [];
  const aug = { bySlug: {}, generated_at: raw.generated_at, source_url: SOURCE_URL };
  let matched = 0, missing = 0;

  for (const s of sigList) {
    const compPath = path.join(COMP_DIR, `${s.slug}.json`);
    if (!existsSync(compPath)) { missing++; continue; }
    aug.bySlug[s.slug] = {
      slug: s.slug,
      isSignatory: true,
      brand: s.brand,
      joined: s.joined,
      source: "the-climate-pledge",
      source_url: SOURCE_URL,
    };
    matched++;
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(aug, null, 2));
  console.log(`[climate-pledge-merge] wrote ${OUT_FILE}: ${matched} matched, ${missing} unmapped`);
}

main().catch((err) => { console.error("climate-pledge-merge failed:", err); process.exit(1); });
