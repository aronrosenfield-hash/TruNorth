#!/usr/bin/env node
/**
 * ATF Federal Firearms Licensee fetcher — schema v2.
 *
 * 2026-06-07 (B-37b): rewritten from scratch.
 *
 * The previous version pulled "compliance violations" / "FFL revocations"
 * / "FCR Table 6 inspection results" — a different dataset, with the wrong
 * schema for what the new entity-resolved merger (scripts/atf-merge.mjs,
 * see B-37) actually consumes. The merger expects the FFL LISTING (every
 * currently-active FFL holder, by license type), and matches each license
 * to TruNorth brands through allow-list / strict evidence chain / hard
 * blocklist gates.
 *
 * Source: https://www.atf.gov/firearms/listing-federal-firearms-licensees
 * ATF publishes a monthly per-license-type CSV/TXT bundle. The dataset is
 * split into 9 files, one per FFL type (01, 02, 03, 06, 07, 08, 09, 10,
 * 11), each ~50-500k rows. We consume whichever files the operator has
 * placed in public/data/_raw/atf-ffl/.
 *
 * USAGE
 *   node scripts/atf-fetch.mjs                 # consume local CSVs only
 *   node scripts/atf-fetch.mjs --download      # NOT YET — manual seed for now
 *   node scripts/atf-fetch.mjs --month=2026-04 # tag output with a specific month
 *
 * OUTPUT
 *   public/data/atf-ffl.json — schema consumed by scripts/atf-merge.mjs:
 *     {
 *       generated_at:    "ISO-8601",
 *       source_url:      "https://www.atf.gov/firearms/listing-federal-firearms-licensees",
 *       source_month:    "YYYY-MM",
 *       licensee_count:  N,
 *       licensees: [
 *         { business_name, license_type, state, expiration, sic_code? },
 *         ...
 *       ]
 *     }
 *
 * SAFETY
 *   - This fetcher NEVER writes to per-company JSON files. Only the merger
 *     does, and only after the entity-resolution gates (B-37).
 *   - Until someone reviews a real run end-to-end, .github/workflows/
 *     atf-monthly.yml stays paused (`if: false` guard).
 *   - When no local CSVs and no --download, a tiny synthetic fixture is
 *     emitted instead so the merger can be smoke-tested.
 *
 * SCHEMA NOTES
 *   - license_type is the two-digit ATF code, kept as a string ("01"..."11").
 *     Leading zeros matter — don't coerce to number.
 *   - business_name comes verbatim from ATF (often UPPERCASE). The merger
 *     does its own normalization.
 *   - state is two-letter USPS code.
 *   - expiration is "YYYY-MM-DD" if present; ATF sometimes omits it.
 *   - sic_code is OPTIONAL. ATF rarely includes it; when present it
 *     significantly improves the merger's evidence-chain gate.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "public/data/_raw/atf-ffl");
const OUT_FILE   = path.join(ROOT, "public/data/atf-ffl.json");
const SOURCE_URL = "https://www.atf.gov/firearms/listing-federal-firearms-licensees";

const ARGS      = process.argv.slice(2);
const DOWNLOAD  = ARGS.includes("--download");
const MONTH_ARG = ARGS.find((a) => a.startsWith("--month="))?.slice("--month=".length);

const COLUMN_ALIASES = {
  business_name: ["business_name", "businessname", "license_name", "licensee_name", "trade_name", "business name"],
  license_type:  ["license_type", "lic_type", "type", "license type"],
  state:         ["state", "premise_state", "state code", "st"],
  expiration:    ["expiration", "expire_date", "exp_date", "expiration_date"],
  sic_code:      ["sic_code", "naics_code", "sic", "naics"],
};

function pickField(row, aliases) {
  for (const a of aliases) {
    const want = a.toLowerCase().replace(/[_\s-]/g, "");
    for (const k of Object.keys(row)) {
      const have = k.toLowerCase().replace(/[_\s-]/g, "");
      if (have === want) {
        const v = row[k];
        if (v != null && String(v).trim()) return String(v).trim();
      }
    }
  }
  return null;
}

// ─── Lightweight CSV parser ──────────────────────────────────────────────
// ATF files are sometimes pipe-delimited, sometimes comma. Auto-detect.
function detectDelimiter(headerLine) {
  const counts = {
    "|": (headerLine.match(/\|/g) || []).length,
    ",": (headerLine.match(/,/g)  || []).length,
    "\t": (headerLine.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const delim = detectDelimiter(lines[0]);
  const header = lines[0].split(delim).map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] || "").trim();
    out.push(row);
  }
  return out;
}

// ─── Local CSV ingest ────────────────────────────────────────────────────
async function ingestLocal() {
  if (!existsSync(RAW_DIR)) {
    console.log(`[atf-fetch] no raw dir at ${RAW_DIR} — nothing to ingest`);
    return [];
  }
  const files = (await fs.readdir(RAW_DIR)).filter(
    (f) => f.endsWith(".csv") || f.endsWith(".txt"),
  );
  if (files.length === 0) {
    console.log(`[atf-fetch] raw dir is empty: ${RAW_DIR}`);
    return [];
  }
  const licensees = [];
  for (const file of files) {
    // Infer license type from filename if possible: 0625-type-07-ffl.csv or 07-...
    const m = file.match(/type[-_]?(\d{2})/i) || file.match(/^(\d{2})[-_]/);
    const inferredType = m ? m[1] : null;
    const fp = path.join(RAW_DIR, file);
    const text = await fs.readFile(fp, "utf-8");
    const rows = parseCsv(text);
    let kept = 0;
    for (const r of rows) {
      const business_name = pickField(r, COLUMN_ALIASES.business_name);
      let license_type   = pickField(r, COLUMN_ALIASES.license_type) || inferredType;
      const state        = pickField(r, COLUMN_ALIASES.state);
      const expiration   = pickField(r, COLUMN_ALIASES.expiration);
      const sic_code     = pickField(r, COLUMN_ALIASES.sic_code);
      if (!business_name || !license_type) continue;
      license_type = String(license_type).padStart(2, "0").slice(0, 2);
      licensees.push({
        business_name,
        license_type,
        ...(state      ? { state }      : {}),
        ...(expiration ? { expiration } : {}),
        ...(sic_code   ? { sic_code }   : {}),
      });
      kept++;
    }
    console.log(`[atf-fetch] ${file}: parsed ${rows.length} rows, kept ${kept} licensees`);
  }
  return licensees;
}

// ─── Synthetic fixture — used when no local CSVs and no --download ───────
// Lets us smoke-test the full pipeline (fetch → merger → companies) before
// real ATF data is available. Only well-known legit FFL holders so the
// merger's allow-list correctly attaches them.
function syntheticFixture() {
  console.warn("[atf-fetch] no local CSVs found — emitting tiny synthetic fixture");
  console.warn("[atf-fetch] for real data: download CSVs from " + SOURCE_URL);
  console.warn("[atf-fetch] and drop them into " + RAW_DIR);
  return [
    { business_name: "STURM RUGER & CO INC",          license_type: "07", state: "NC", sic_code: "332994" },
    { business_name: "SMITH & WESSON BRANDS INC",     license_type: "07", state: "MA", sic_code: "332994" },
    { business_name: "BROWNING ARMS COMPANY",         license_type: "07", state: "UT", sic_code: "332994" },
    { business_name: "WALMART INC.",                  license_type: "01", state: "AR", sic_code: "5941"   },
    { business_name: "BASS PRO SHOPS INC",            license_type: "01", state: "MO", sic_code: "5941"   },
    { business_name: "ACADEMY SPORTS + OUTDOORS INC", license_type: "01", state: "TX", sic_code: "5941"   },
  ];
}

// ─── Download mode (not yet implemented end-to-end) ──────────────────────
// ATF's download landing page lists files at non-stable URLs that change
// each month. Robust auto-fetch needs page scraping that we haven't built
// yet. For now operators must download manually. Filed as B-37c.
async function downloadCurrentMonth() {
  console.warn("[atf-fetch] --download not yet implemented end-to-end (filed as B-37c).");
  console.warn("[atf-fetch] Manual procedure:");
  console.warn("[atf-fetch]   1. Visit " + SOURCE_URL);
  console.warn("[atf-fetch]   2. Download each type's CSV/TXT for the current month");
  console.warn("[atf-fetch]   3. Drop them into " + RAW_DIR);
  console.warn("[atf-fetch]   4. Re-run without --download");
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });

  if (DOWNLOAD) await downloadCurrentMonth();

  let licensees = await ingestLocal();
  if (licensees.length === 0) licensees = syntheticFixture();

  const month = MONTH_ARG || new Date().toISOString().slice(0, 7);
  const out = {
    generated_at:   new Date().toISOString(),
    source_url:     SOURCE_URL,
    source_month:   month,
    licensee_count: licensees.length,
    licensees,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`[atf-fetch] wrote ${licensees.length} licensees → ${path.relative(ROOT, OUT_FILE)} (source_month=${month})`);
}

main().catch((e) => {
  console.error("[atf-fetch] fatal:", e);
  process.exit(1);
});
