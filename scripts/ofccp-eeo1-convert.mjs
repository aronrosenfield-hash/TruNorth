#!/usr/bin/env node
/**
 * OFCCP EEO-1 Type 2 converter (R7 #1, 2026-06-11).
 *
 * One-time conversion of the DOL OFCCP FOIA release (federal-contractor
 * EEO-1 workforce demographics, FY2016-2020) from the 52 MB consolidated
 * XLSX into a compact per-company JSON. The XLSX itself is NOT committed
 * (data/raw/ofccp-eeo1/ is gitignored except the dictionary); the derived
 * JSON is.
 *
 * Source: https://www.dol.gov/agencies/ofccp/foia/library/Employment-Information-Reports
 * Released under FOIA after CIR v. DOL (9th Cir. No. 24-880, July 2025) —
 * US government records, no commercial-use restriction.
 *
 * Per company we keep the LATEST year's report and compute neutral facts:
 *   total employees · % women · % racial/ethnic minorities ·
 *   % women in management (EEO-1 cats 1 + 1.2) · % minorities in management.
 * NO verdict enum is derived — demographics are facts, not values judgments;
 * the data feeds the dei evidence sidecar + narrative only.
 *
 * Run: node scripts/ofccp-eeo1-convert.mjs   (~1-2 min, streams the sheet)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsxRows } from "./lib/xlsx-mini.mjs";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XLSX = path.join(ROOT, "data/raw/ofccp-eeo1/consolidated-eeo1-2016-2020.xlsx");
const OUT = path.join(ROOT, "data/derived/ofccp-eeo1-companies.json");

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const byCompany = new Map(); // normName -> best record (latest year, largest total tiebreak)
let rows = 0, skipped = 0;

const res = await readXlsxRows(XLSX, {
  onRow: (r) => {
    rows++;
    const coname = String(r.CONAME || "").trim();
    const year = num(r.YEAR);
    const total = num(r.TOTAL10);
    if (!coname || !year || total < 25) { skipped++; return; } // tiny units = noise
    const women = num(r.FT10);
    const white = num(r.WHF10) + num(r.WHM10);
    const mgmtTotal = num(r.TOTAL1) + num(r.TOTAL1_2);
    const mgmtWomen = num(r.FT1) + num(r.FT1_2);
    const mgmtWhite = num(r.WHF1) + num(r.WHM1) + num(r.WHF1_2) + num(r.WHM1_2);
    const rec = {
      coname,
      year,
      total,
      pctWomen: Math.round((women / total) * 1000) / 10,
      pctMinority: Math.round(((total - white) / total) * 1000) / 10,
      ...(mgmtTotal >= 5 ? {
        pctWomenMgmt: Math.round((mgmtWomen / mgmtTotal) * 1000) / 10,
        pctMinorityMgmt: Math.round(((mgmtTotal - mgmtWhite) / mgmtTotal) * 1000) / 10,
      } : {}),
      duns: String(r.DUNS || "").replace(/[^0-9]/g, "") || null,
      naics: String(r.NAICS || "").trim() || null,
    };
    const key = normalizeCompanyName(coname);
    if (!key) { skipped++; return; }
    const prev = byCompany.get(key);
    // Latest year wins; same year → larger workforce (consolidated > unit).
    if (!prev || rec.year > prev.year || (rec.year === prev.year && rec.total > prev.total)) {
      byCompany.set(key, rec);
    }
  },
});

// Guard (B-60/61/62 convention): a truncated download must fail loudly.
if (rows < 50_000 || byCompany.size < 5_000) {
  console.error(`[ofccp] FATAL: only ${rows} rows / ${byCompany.size} companies — expected ~56k rows. Refusing to write.`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  source: "DOL OFCCP FOIA library — Type 2 EEO-1 Reports FY2016-2020 (final release 2026-02-25)",
  sourceUrl: "https://www.dol.gov/agencies/ofccp/foia/library/Employment-Information-Reports",
  license: "US government FOIA records — public domain, no commercial restriction",
  convertedAt: new Date().toISOString(),
  rowsRead: rows,
  companies: Object.fromEntries(byCompany),
}, null, 1));
console.log(`[ofccp] ${rows} rows (${skipped} skipped) → ${byCompany.size} companies → ${OUT}`);
