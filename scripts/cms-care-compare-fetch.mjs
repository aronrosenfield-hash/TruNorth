#!/usr/bin/env node
/**
 * CMS Hospital Care Compare — overall quality star rating + per-measure
 * counts for every Medicare-certified general acute-care hospital in the US.
 *
 * Source: https://data.cms.gov/provider-data/dataset/xubh-q36u
 *   ("Hospital General Information" — the file that drives Medicare's
 *   Care Compare consumer site).
 * License: U.S. Government Work (https://www.usa.gov/government-works).
 *
 * STRATEGY
 *   - Page through the CMS DKAN datastore API in 1500-row batches.
 *   - Keep only the fields we need: facility id/name/state, ownership,
 *     overall rating, count of "Worse"/"Better" safety/readmission measures.
 *   - Output one row per hospital (~5,400 hospitals nationwide).
 *
 * USAGE
 *   node scripts/cms-care-compare-fetch.mjs
 *   node scripts/cms-care-compare-fetch.mjs --out /tmp/cc.json
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/raw/cms-care-compare");
const UA = "TruNorth-Data/1.0 (+https://www.trunorthapp.com)";
const BASE = "https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0";
const LIMIT = 1500;

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
}

async function main() {
  const outFile = arg("--out", path.join(OUT_DIR, `${new Date().getFullYear()}.json`));
  await fsp.mkdir(OUT_DIR, { recursive: true });

  const hospitals = [];
  let offset = 0;
  while (true) {
    const url = `${BASE}?limit=${LIMIT}&offset=${offset}`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    const d = await r.json();
    const rows = d.results || [];
    console.log(`offset=${offset} got ${rows.length}`);
    for (const h of rows) {
      hospitals.push({
        id: h.facility_id,
        name: h.facility_name,
        city: h.citytown,
        state: h.state,
        owner: h.hospital_ownership,
        rating: h.hospital_overall_rating,
        safetyWorse: h.count_of_safety_measures_worse,
        safetyBetter: h.count_of_safety_measures_better,
        readmWorse: h.count_of_readm_measures_worse,
        readmBetter: h.count_of_readm_measures_better,
      });
    }
    if (rows.length < LIMIT) break;
    offset += LIMIT;
  }

  const payload = {
    _source: "https://data.cms.gov/provider-data/dataset/xubh-q36u",
    _license: "https://www.usa.gov/government-works",
    _fetched: new Date().toISOString().slice(0, 10),
    count: hospitals.length,
    hospitals,
  };
  fs.writeFileSync(outFile, JSON.stringify(payload));
  console.log(`[done] wrote ${outFile} (${hospitals.length} hospitals)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
