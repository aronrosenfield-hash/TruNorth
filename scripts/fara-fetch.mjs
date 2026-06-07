#!/usr/bin/env node
/**
 * B-data4 (2/3) — FARA (Foreign Agents Registration Act) fetcher
 *
 * DOJ publishes the FARA database as an ORDS app at efile.fara.gov. The
 * older ORDS REST endpoint (/ords/fara/active_foreign_principals/) was
 * retired sometime before 2026-06; it now returns an Oracle "NotFound"
 * JSON body. The current bulk-data exports are published as zipped CSV
 * downloads, linked from the FARA Bulk Data page at:
 *
 *   https://efile.fara.gov/ords/fara/f?p=107:21
 *
 * We pull the FARA_All_ForeignPrincipals.csv.zip — a single denormalized
 * table joining each foreign-principal registration to its registrant.
 * Termination Date is empty for currently-active registrations, so we
 * derive is_active from that field.
 *
 * For each *active* registration we keep:
 *   - registration_number    — DOJ FARA ID
 *   - registrant_name        — the US firm doing the lobbying/PR/legal work
 *   - foreign_principal_name — the foreign entity being represented
 *   - foreign_principal_country
 *   - foreign_principal_type — derived (CSV lacks an explicit type column;
 *                              we leave null and let downstream heuristics
 *                              infer "government" vs. "private" from the name)
 *   - us_party_name_hint     — null in the public bulk CSV
 *   - us_affiliates[]        — empty in the public bulk CSV
 *
 * Output: /public/data/fara.json
 *
 * Modes:
 *   --dry  (default)  → read test/fixtures/lobbying/fara-sample.json
 *   --live            → download the FARA bulk CSV zip
 *
 * Locally:
 *   node scripts/fara-fetch.mjs        # dry
 *   node scripts/fara-fetch.mjs --live
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/fara.json");
const FIXTURE_FILE = path.join(ROOT, "test/fixtures/lobbying/fara-sample.json");

// FARA Bulk Data — Foreign Principals (denormalized: one row per
// registrant↔foreign-principal pair). Listed on the public Bulk Data page
// alongside Registrants / RegistrantDocs / ShortForms.
const FARA_BULK_URL =
  "https://efile.fara.gov/bulk/zip/FARA_All_ForeignPrincipals.csv.zip";

const DRY = !process.argv.includes("--live");

/* ------------------------------ live ------------------------------------- */

async function fetchLive() {
  const res = await fetch(FARA_BULK_URL, {
    headers: {
      // FARA's CDN rejects empty / suspect UA strings — use a real browser UA.
      "User-Agent":
        "Mozilla/5.0 (compatible; TruNorth-FARA/1.0; +https://www.trunorthapp.com)",
      Accept: "application/zip,application/octet-stream,*/*",
    },
  });
  if (!res.ok) throw new Error(`FARA bulk download ${res.status} at ${FARA_BULK_URL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const csv = await unzipSingleFile(buf);
  const rows = parseCsv(csv);
  return rows.map(rowToRecord);
}

/* ------------------------------ unzip ------------------------------------ */

// Minimal single-file ZIP extractor. The FARA bulk zips each contain
// exactly one CSV, stored either with no compression (method 0) or
// deflate (method 8). We avoid pulling in a heavyweight zip lib.
async function unzipSingleFile(buf) {
  // Walk local file headers (PK\x03\x04) until we find the first entry.
  // Signature: 0x04034b50 little-endian.
  const SIG = 0x04034b50;
  let i = 0;
  while (i < buf.length - 30) {
    if (buf.readUInt32LE(i) !== SIG) {
      i += 1;
      continue;
    }
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const dataStart = i + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const raw = buf.subarray(dataStart, dataEnd);
    if (method === 0) return raw.toString("utf-8");
    if (method === 8) return zlib.inflateRawSync(raw).toString("utf-8");
    throw new Error(`FARA zip: unsupported compression method ${method}`);
  }
  throw new Error("FARA zip: no local file header found");
}

/* ------------------------------- csv ------------------------------------- */

// Streaming CSV parser that handles quoted fields, embedded commas/newlines,
// and "" escape — sufficient for the FARA export. Returns array of objects
// keyed by the header row.
function parseCsv(text) {
  // Strip UTF-8 BOM and normalize line endings up front.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        // Push current field/row, then collapse \r\n.
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else {
        field += c;
      }
    }
  }
  // Trailing field/row (file may or may not end with newline).
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.length > 1 || (r.length === 1 && r[0] !== ""))
    .map(r => {
      const obj = {};
      for (let j = 0; j < header.length; j++) obj[header[j]] = r[j] ?? "";
      return obj;
    });
}

function rowToRecord(r) {
  // Header keys from the live CSV (verified 2026-06-07):
  //   "Foreign Principal Termination Date","Foreign Principal",
  //   "Foreign Principal Registration Date","Country/Location Represented",
  //   "Registration Number","Registrant Date","Registrant Name", ...
  const term = (r["Foreign Principal Termination Date"] || "").trim();
  return {
    registration_number:       (r["Registration Number"] || "").trim() || null,
    registrant_name:           (r["Registrant Name"] || "").trim() || null,
    registration_date:         (r["Foreign Principal Registration Date"] || "").trim() || null,
    termination_date:          term || null,
    is_active:                 !term,
    foreign_principal_name:    (r["Foreign Principal"] || "").trim() || null,
    foreign_principal_country: (r["Country/Location Represented"] || "").trim() || null,
    foreign_principal_type:    null,
    us_party_name_hint:        null,
    us_affiliates:             [],
  };
}

/* -------------------------------- dry ------------------------------------- */

async function fetchDry() {
  const raw = JSON.parse(await fs.readFile(FIXTURE_FILE, "utf-8"));
  return (raw.items || []).map(minimize);
}

/* ------------------------------ shape ------------------------------------- */

function minimize(r) {
  // Tolerate both the live-ORDS column names and our fixture's snake_case.
  return {
    registration_number: r.registration_number || r.reg_num || r.REGISTRATION_NUMBER || null,
    registrant_name:     r.registrant_name     || r.REGISTRANT_NAME || null,
    registration_date:   r.registration_date   || r.REGISTRATION_DATE || null,
    termination_date:    r.termination_date    || r.TERMINATION_DATE || null,
    is_active:           r.is_active !== undefined
                          ? !!r.is_active
                          : !(r.termination_date || r.TERMINATION_DATE),
    foreign_principal_name:    r.foreign_principal_name    || r.FOREIGN_PRINCIPAL || null,
    foreign_principal_country: r.foreign_principal_country || r.COUNTRY || null,
    foreign_principal_type:    r.foreign_principal_type    || r.FP_TYPE || null,
    us_party_name_hint:        r.us_party_name_hint        || null,
    us_affiliates:             Array.isArray(r.us_affiliates) ? r.us_affiliates : [],
  };
}

/* -------------------------------- main ------------------------------------ */

async function main() {
  const mode = DRY ? "DRY" : "LIVE";
  console.log(`FARA fetcher (${mode}) starting…`);

  const all = DRY ? await fetchDry() : await fetchLive();
  const active = all.filter(r => r.is_active);

  // Stats
  const principals = new Set();
  const byCountry = {};
  for (const r of active) {
    if (r.foreign_principal_name) principals.add(r.foreign_principal_name);
    const c = r.foreign_principal_country || "Unknown";
    byCountry[c] = (byCountry[c] || 0) + 1;
  }

  const payload = {
    generated_at: new Date().toISOString(),
    mode,
    registrations: active,
    stats: {
      total_active: active.length,
      distinct_principals: principals.size,
      by_country: byCountry,
    },
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  active registrations: ${active.length}`);
  console.log(`  distinct principals:  ${principals.size}`);
}

main().catch(err => {
  console.error("fara-fetch failed:", err);
  process.exit(1);
});
