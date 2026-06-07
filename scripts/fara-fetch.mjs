#!/usr/bin/env node
/**
 * B-data4 (2/3) — FARA (Foreign Agents Registration Act) fetcher
 *
 * DOJ publishes the FARA database as an ORDS app at efile.fara.gov. The
 * public "Active Registrants" + "Active Foreign Principals" tables are
 * downloadable as CSV/JSON (URLs encoded in the ORDS endpoints).
 *
 *   Portal:   https://efile.fara.gov/ords/f?p=1381:1
 *   Data:     Active registrant ↔ foreign principal pairs
 *
 * For each *active* registration we keep:
 *   - registration_number    — DOJ FARA ID
 *   - registrant_name        — the US firm doing the lobbying/PR/legal work
 *   - foreign_principal_name — the foreign entity being represented
 *   - foreign_principal_country
 *   - foreign_principal_type — Foreign Government / Government Corp / Private Corp
 *   - us_party_name_hint     — known US subsidiary, where surfaced (used for slug match)
 *   - us_affiliates[]        — additional US-side affiliates the merger can match against
 *
 * Output: /public/data/fara.json
 *
 * Modes:
 *   --dry  (default)  → read test/fixtures/lobbying/fara-sample.json
 *   --live            → hit the real efile.fara.gov ORDS endpoint
 *
 * Locally:
 *   node scripts/fara-fetch.mjs        # dry
 *   node scripts/fara-fetch.mjs --live
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/fara.json");
const FIXTURE_FILE = path.join(ROOT, "test/fixtures/lobbying/fara-sample.json");

// The ORDS app exposes JSON via /ords/<schema>/<module>/<endpoint>.
// The active-registrant + foreign-principal join is published at:
//   https://efile.fara.gov/ords/fara/active_foreign_principals/
// (subject to DOJ-side changes — when LIVE mode breaks, update here).
const FARA_BASE = "https://efile.fara.gov/ords/fara/active_foreign_principals/";

const DRY = !process.argv.includes("--live");

/* ------------------------------- live ------------------------------------- */

async function fetchLive() {
  const items = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const url = `${FARA_BASE}?offset=${offset}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TruNorth-FARA/1.0 (+https://www.trunorthapp.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`FARA ${res.status} at ${url}`);
    const data = await res.json();
    const batch = data.items || data.results || [];
    items.push(...batch);
    if (batch.length < limit || data.hasMore === false) break;
    offset += limit;
    await new Promise(r => setTimeout(r, 500));
  }
  return items.map(minimize);
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
