#!/usr/bin/env node
/**
 * Climate TRACE — facility emissions + ultimate-owner mapping (monthly).
 *
 * Climate TRACE (https://climatetrace.org) is the open emissions database
 * backed by Al Gore + a 100-member coalition (WattTime, RMI, TransitionZero,
 * Carbon Plan, Earthrise Media, OceanMind, etc.). It uses satellite +
 * remote-sensing + AI to *estimate* GHG emissions for every major emitter
 * on Earth. The v5.7.0 release (May 2026) ships monthly emissions through
 * March 2026.
 *
 * Why this pipeline matters
 *   The ownership CSVs map ~26,000 facilities to ~14,000 ultimate parents
 *   across 18 emissions-intensive subsectors. For TruNorth this REPLACES the
 *   industry-tier carbon-intensity fallback (PR #15) with facility-attributed
 *   numbers for ~600–900 of our ~3,200 climate-scored corporate parents.
 *
 * Pipeline shape
 *   Stage 1 (this file): download per-sector ZIPs of co2e_100yr emissions,
 *     stream-parse the ownership + emissions CSVs, write a compact JSON
 *     snapshot to data/raw/climate-trace/<YYYY-MM-DD>.json holding:
 *       { ownership: [...], emissions: [...] }
 *     where ownership rows carry (source_id, parent_name, share, subsector,
 *     iso3) and emissions rows carry (source_id, year, kg_co2e, subsector,
 *     iso3, source_name, lat, lon).
 *   Stage 2 (climate-trace-merge.mjs): aggregate per-parent equity-weighted
 *     emissions for the LATEST year present, slug-resolve to TruNorth brands
 *     via index.json + brand-parent-map.json, write data/derived/climate-
 *     trace-augment.json keyed by slug.
 *
 * License (verified 2026-06-07)
 *   CC BY 4.0 International. https://climatetrace.org/terms — "free to copy,
 *   modify and distribute Climate TRACE data in any format for any purpose,
 *   including commercial use." Attribution: "Climate TRACE" + note changes.
 *   Every record we emit carries `_license` and a `sourceUrl`.
 *
 * Bulk URL pattern (verified 2026-06-08 by S3 probe)
 *   https://downloads.climatetrace.org/latest/sector_packages/<gas>/<sector>.zip
 *   gases: co2 | ch4 | n2o | co2e_100yr | co2e_20yr
 *   sectors with ownership data: power, manufacturing (top-level zips)
 *     (other top-level zips — transportation, buildings, agriculture, waste —
 *      mostly contain raster/area data without owner_grouping linkage)
 *
 * Subsectors with ownership rows (v5.7.0 manifest probe)
 *   power/electricity-generation
 *   manufacturing/{aluminum, cement, chemicals, iron-and-steel,
 *                  petrochemical-steam-cracking, pulp-and-paper}
 *   Other manufacturing subsectors (food-beverage-tobacco, glass, lime,
 *   other-chemicals, other-manufacturing, other-metals, textiles-leather-
 *   apparel, wood-and-wood-products) ship emissions but no ownership CSV in
 *   v5.7.0 — we skip them with a warning.
 *
 * Standalone CLI
 *   node scripts/climate-trace-fetch.mjs                       # dry, no network
 *   node scripts/climate-trace-fetch.mjs --apply               # download + parse
 *   node scripts/climate-trace-fetch.mjs --limit 200 --apply   # cap ownership rows per subsector
 *   node scripts/climate-trace-fetch.mjs --subsector electricity-generation --apply
 *   node scripts/climate-trace-fetch.mjs --out /tmp/snap.json --apply
 *   node scripts/climate-trace-fetch.mjs --src-ownership PATH --src-emissions PATH
 *
 * Cron: .github/workflows/climate-trace-monthly.yml (15th of each month UTC).
 */

import fs from "node:fs/promises";
import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/climate-trace");
const TMP_DIR = path.join(os.tmpdir(), "climate-trace");

const BASE_URL = "https://downloads.climatetrace.org/latest/sector_packages";
const DEFAULT_GAS = "co2e_100yr"; // unified GHG → CO2 equivalent (100-yr GWP).
const UA = "TruNorth-ClimateTRACE/1.0 (+https://www.trunorthapp.com)";
const LICENSE_STR =
  "CC BY 4.0 — Climate TRACE (https://climatetrace.org/terms). Commercial use permitted with attribution.";

// ────────────────────────────── CLI ──────────────────────────────
const argv = process.argv.slice(2);
function flag(name)   { return argv.includes(name); }
function arg(name, d = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
}
const APPLY     = flag("--apply") || flag("--live");
const LIMIT     = arg("--limit") ? Number(arg("--limit")) : Infinity;
const OUT_OVER  = arg("--out");
const GAS       = arg("--gas", DEFAULT_GAS);
const KEEP_ZIP  = flag("--keep-zip");
const SRC_OWN   = arg("--src-ownership"); // local CSV bypass (tests)
const SRC_EM    = arg("--src-emissions"); // local CSV bypass (tests)
const SUBSECTOR = arg("--subsector");      // limit to one subsector

// ──────────────── Subsector → top-level sector ZIP map ────────────────
//
// Each entry is the canonical Climate TRACE subsector slug as it appears
// in the `source_subsector` CSV column AND as the filename prefix inside
// the sector ZIP (e.g. "iron-and-steel_emissions_sources_v5_7_0.csv").
//
// Only subsectors that ship a `*_emissions_sources_ownership_*.csv` member
// are listed. Validated against v5.7.0 manufacturing.zip + power.zip.
export const SUBSECTORS = [
  { sector: "power",         subsector: "electricity-generation" },
  { sector: "manufacturing", subsector: "aluminum" },
  { sector: "manufacturing", subsector: "cement" },
  { sector: "manufacturing", subsector: "chemicals" },
  { sector: "manufacturing", subsector: "iron-and-steel" },
  { sector: "manufacturing", subsector: "petrochemical-steam-cracking" },
  { sector: "manufacturing", subsector: "pulp-and-paper" },
];

// ──────────────────────── tiny CSV parser ────────────────────────
// Handles double-quoted cells, embedded commas, escaped "" quotes, and
// trailing CR. Same shape as scripts/usda-fooddata-fetch.mjs:parseCsvLine.
// Does NOT handle embedded newlines (Climate TRACE CSVs verified clean in
// v5.7.0); ragged tails are tolerated by extract* returning null.
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === "\r") { /* swallow */ }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

export async function* streamCsvRows(readable) {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let header = null;
  for await (const raw of rl) {
    if (!raw) continue;
    const fields = parseCsvLine(raw);
    if (!header) { header = fields.map(h => h.trim()); continue; }
    if (fields.length === 1 && fields[0] === "") continue;
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? "";
    yield row;
  }
}

// ──────────────────────── ownership extraction ────────────────────────
//
// Ownership CSV schema (v5.7.0, validated 2026-06-08):
//   parent_name, parent_entity_id, parent_entity_type, parent_lei,
//   parent_permid, parent_registration_country, parent_headquarter_country,
//   overall_share_percent, ownership_path, ownership_path_datasource_ids,
//   immediate_source_owner, immediate_source_owner_entity_id,
//   source_operator, source_operator_id, percentage_of_operation,
//   source_id, source_name, source_sector, source_subsector, iso3_country
//
// `overall_share_percent` is the ultimate-parent equity share through the
// whole chain — already pre-multiplied by Climate TRACE, so we can use it
// directly for equity-weighting without re-multiplying ownership_path.
//
// One source_id can appear many times (one row per ultimate parent + per
// chain branch). We keep every row; the merger collapses by parent.
export function extractOwnershipRow(row) {
  const parent_name = String(row.parent_name ?? "").trim();
  const source_id   = String(row.source_id ?? "").trim();
  if (!parent_name || !source_id) return null;
  const share = Number(row.overall_share_percent);
  if (!Number.isFinite(share) || share <= 0) return null;
  return {
    source_id,
    parent_name,
    parent_entity_type: row.parent_entity_type || null,
    parent_lei:         row.parent_lei && row.parent_lei !== "not found" ? row.parent_lei : null,
    parent_hq_country:  row.parent_headquarter_country || null,
    share_percent:      share,
    source_subsector:   row.source_subsector || null,
    iso3_country:       row.iso3_country || null,
  };
}

// ──────────────────────── emissions extraction ────────────────────────
//
// Emissions CSV schema (v5.7.0): source_id, source_name, source_type,
//   iso3_country, sector, subsector, start_time, end_time, lat, lon,
//   geometry_ref, gas, emissions_quantity, temporal_granularity, activity,
//   activity_units, ...
//
// emissions_quantity is in METRIC TONNES (per detailed_data_schema.csv).
// We multiply by 1000 → kg to match our internal `ghgCo2eKg` units.
//
// We keep only source_ids that have ownership rows. We aggregate by
// (source_id, year, gas) so a 12-row monthly facility becomes a single
// annual total per gas. Year derived from start_time YYYY-.
export function rowYear(start_time) {
  if (!start_time || typeof start_time !== "string") return null;
  const y = parseInt(start_time.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export function extractEmissionsRow(row, sourceIdAllow) {
  const source_id = String(row.source_id ?? "").trim();
  if (!source_id) return null;
  if (sourceIdAllow && !sourceIdAllow.has(source_id)) return null;
  const qty = Number(row.emissions_quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const year = rowYear(row.start_time);
  if (!year) return null;
  return {
    source_id,
    source_name: row.source_name || null,
    source_type: row.source_type || null,
    iso3_country: row.iso3_country || null,
    subsector: row.subsector || null,
    year,
    gas: row.gas || null,
    kg_co2e: qty * 1000, // tonnes → kg
    lat: row.lat ? Number(row.lat) : null,
    lon: row.lon ? Number(row.lon) : null,
  };
}

// ──────────────────────── ZIP download + stream ────────────────────────

export async function downloadTo(url, dest) {
  console.log(`  download ${url}`);
  console.log(`        → ${dest}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const ws = createWriteStream(dest);
  const reader = res.body.getReader();
  let bytes = 0;
  let nextLog = 25 * 1024 * 1024;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    ws.write(Buffer.from(value));
    if (bytes >= nextLog) {
      console.log(`    ${(bytes / 1024 / 1024).toFixed(0)} MB`);
      nextLog += 25 * 1024 * 1024;
    }
  }
  ws.end();
  await new Promise(r => ws.on("close", r));
  console.log(`    done — ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  return dest;
}

/**
 * Spawn `unzip -p ZIP MEMBER` and return a Readable that emits the unpacked
 * CSV bytes. We shell out to system `unzip` (available on macOS + ubuntu-
 * latest GHA runners — precedent set by usda-fooddata-fetch.mjs) to avoid
 * pulling in a Node ZIP library.
 */
export function streamZipMember(zipPath, member) {
  const proc = spawn("unzip", ["-p", zipPath, member], { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", b => process.stderr.write(`unzip: ${b}`));
  proc.on("error", e => { throw e; });
  return proc.stdout;
}

/**
 * List the CSV members of a ZIP by name (no extraction). Used to discover
 * the version-suffixed filenames inside each sector ZIP (e.g.
 * "DATA/iron-and-steel_emissions_sources_v5_7_0.csv" — the v5_7_0 part
 * bumps every release and we don't want to pin it).
 */
export async function listZipMembers(zipPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("unzip", ["-Z1", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    proc.stdout.on("data", b => (out += b.toString()));
    proc.stderr.on("data", b => (err += b.toString()));
    proc.on("error", reject);
    proc.on("close", code => {
      if (code !== 0) reject(new Error(`unzip -Z1 exit=${code}: ${err}`));
      else resolve(out.split("\n").map(s => s.trim()).filter(Boolean));
    });
  });
}

/**
 * Find the ownership + emissions CSV inside a sector ZIP for a given subsector.
 * Returns { ownership, emissions } or null members if the subsector has no
 * such file (e.g. textiles in manufacturing.zip has no ownership in v5.7.0).
 */
export function findCsvMembers(members, subsector) {
  const own = members.find(m =>
    m.startsWith(`DATA/${subsector}_emissions_sources_ownership_`) && m.endsWith(".csv")
  ) || null;
  const em  = members.find(m =>
    m.startsWith(`DATA/${subsector}_emissions_sources_`) &&
    !m.includes("_ownership_") &&
    !m.includes("_confidence_") &&
    m.endsWith(".csv")
  ) || null;
  return { ownership: own, emissions: em };
}

// ──────────────────────────── pipeline ────────────────────────────

/**
 * Stream the ownership CSV (Readable), collect every row that passes
 * extractOwnershipRow. Bounded by --limit so a test fixture can sample
 * a small slice.
 */
export async function readOwnership(readable, { limit = Infinity } = {}) {
  const rows = [];
  for await (const r of streamCsvRows(readable)) {
    const own = extractOwnershipRow(r);
    if (!own) continue;
    rows.push(own);
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * Stream the emissions CSV, keeping only rows whose source_id is in
 * `sourceIdAllow` (a Set built from the ownership pass). Aggregate by
 * (source_id, year, gas) sum-kg so we hand a small array back to the
 * merger even when input was ~hundreds of thousands of monthly rows.
 *
 * Returns { aggregated, scanned, kept, skipped } where kept counts the
 * NUMBER OF UNIQUE (sid, year, gas) aggregates produced, not raw rows.
 */
export async function readEmissionsAggregated(readable, sourceIdAllow, { limit = Infinity } = {}) {
  const byKey = new Map(); // `${sid}|${year}|${gas}` → row
  let scanned = 0, skipped = 0;
  for await (const r of streamCsvRows(readable)) {
    scanned++;
    const em = extractEmissionsRow(r, sourceIdAllow);
    if (!em) { skipped++; continue; }
    const key = `${em.source_id}|${em.year}|${em.gas}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.kg_co2e += em.kg_co2e;
    } else {
      if (byKey.size >= limit) continue; // cap unique aggregates
      byKey.set(key, em);
    }
  }
  return { aggregated: [...byKey.values()], scanned, kept: byKey.size, skipped };
}

/**
 * Run the full per-subsector pipeline (download or local CSVs → parse →
 * aggregate). Returns the snapshot shape: { ownership, emissions, _stats }.
 */
export async function runPipeline({
  zipPath = null,      // override (skip download)
  ownership = null,    // override Readable (tests)
  emissions = null,    // override Readable (tests)
  subsectors = null,   // restrict to one
  limit = Infinity,
  gas = DEFAULT_GAS,
}) {
  // Tests path: bypass ZIP — just stream the provided fixture Readables once.
  if (ownership && emissions) {
    const ownRows = await readOwnership(ownership, { limit });
    const sidSet = new Set(ownRows.map(o => o.source_id));
    const { aggregated, scanned, kept, skipped } =
      await readEmissionsAggregated(emissions, sidSet);
    return {
      ownership: ownRows,
      emissions: aggregated,
      _stats: {
        ownership_rows: ownRows.length,
        em_scanned: scanned, em_kept: kept, em_skipped: skipped,
        subsectors: [],
      },
    };
  }

  // Live path: walk SUBSECTORS, reuse cached sector zips.
  const targets = subsectors
    ? SUBSECTORS.filter(s => subsectors.includes(s.subsector))
    : SUBSECTORS;
  if (!targets.length) {
    throw new Error(`No matching subsectors. Wanted: ${JSON.stringify(subsectors)}`);
  }

  await fs.mkdir(TMP_DIR, { recursive: true });
  const sectorZipCache = new Map();
  const allOwnership = [];
  const allEmissions = [];
  const stats = { subsectors: [], total_ownership_rows: 0, total_emissions_aggregates: 0 };

  for (const t of targets) {
    const sectorKey = `${gas}/${t.sector}`;
    if (!sectorZipCache.has(sectorKey)) {
      const url = `${BASE_URL}/${gas}/${t.sector}.zip`;
      const dest = zipPath ?? path.join(TMP_DIR, `${gas}__${t.sector}.zip`);
      if (!zipPath && !existsSync(dest)) {
        await downloadTo(url, dest);
      }
      const localZip = zipPath ?? dest;
      const members = await listZipMembers(localZip);
      sectorZipCache.set(sectorKey, { zip: localZip, members });
    }
    const { zip, members } = sectorZipCache.get(sectorKey);
    const csvs = findCsvMembers(members, t.subsector);
    if (!csvs.ownership || !csvs.emissions) {
      console.log(`  ! skip ${t.subsector} (ownership=${!!csvs.ownership} emissions=${!!csvs.emissions})`);
      stats.subsectors.push({
        subsector: t.subsector, sector: t.sector,
        ownership_rows: 0, emissions_rows: 0, skipped: true,
      });
      continue;
    }

    console.log(`  parse ownership: ${csvs.ownership}`);
    const ownStream = streamZipMember(zip, csvs.ownership);
    const ownRows = await readOwnership(ownStream, { limit });
    console.log(`    ${ownRows.length.toLocaleString()} ownership rows kept`);
    allOwnership.push(...ownRows);

    const sidSet = new Set(ownRows.map(o => o.source_id));
    console.log(`  parse emissions: ${csvs.emissions} (filtered to ${sidSet.size.toLocaleString()} source_ids)`);
    const emStream = streamZipMember(zip, csvs.emissions);
    const { aggregated, scanned, kept, skipped } =
      await readEmissionsAggregated(emStream, sidSet);
    console.log(`    ${kept.toLocaleString()} aggregates kept / ${scanned.toLocaleString()} scanned / ${skipped.toLocaleString()} skipped`);
    allEmissions.push(...aggregated);

    stats.subsectors.push({
      subsector: t.subsector, sector: t.sector,
      ownership_rows: ownRows.length, emissions_rows: aggregated.length,
    });
  }

  stats.total_ownership_rows = allOwnership.length;
  stats.total_emissions_aggregates = allEmissions.length;

  if (!KEEP_ZIP && !zipPath) {
    for (const { zip } of sectorZipCache.values()) {
      try { await fs.unlink(zip); } catch { /* swallow */ }
    }
  }

  return { ownership: allOwnership, emissions: allEmissions, _stats: stats };
}

// ──────────────────────────── runner ────────────────────────────

async function main() {
  console.log(`Climate TRACE fetcher (mode=${APPLY ? "APPLY (real download)" : SRC_OWN ? "LOCAL (--src-*)" : "DRY"})`);

  let snap;

  if (SRC_OWN || SRC_EM) {
    if (!SRC_OWN || !SRC_EM) {
      console.error("--src-ownership and --src-emissions must both be provided");
      process.exit(2);
    }
    if (!existsSync(SRC_OWN)) { console.error(`Missing ${SRC_OWN}`); process.exit(2); }
    if (!existsSync(SRC_EM))  { console.error(`Missing ${SRC_EM}`);  process.exit(2); }
    snap = await runPipeline({
      ownership: createReadStream(SRC_OWN),
      emissions: createReadStream(SRC_EM),
      limit: LIMIT,
      gas: GAS,
    });
  } else if (APPLY) {
    snap = await runPipeline({
      subsectors: SUBSECTOR ? [SUBSECTOR] : null,
      limit: LIMIT,
      gas: GAS,
    });
  } else {
    // Dry run — emit a synthetic 1-facility preview so the merger has SOMETHING to read.
    console.log("  DRY: emitting a synthetic 1-facility preview. Use --apply for real data.");
    snap = {
      ownership: [{
        source_id: "synthetic-1", parent_name: "Synthetic Energy Corp",
        parent_entity_type: "legal entity", parent_lei: null,
        parent_hq_country: "USA", share_percent: 100,
        source_subsector: "electricity-generation", iso3_country: "USA",
      }],
      emissions: [{
        source_id: "synthetic-1", source_name: "Synthetic Plant",
        source_type: "coal", iso3_country: "USA", subsector: "electricity-generation",
        year: 2024, gas: GAS, kg_co2e: 1e9, lat: null, lon: null,
      }],
      _stats: { synthetic: true },
    };
  }

  const mode = APPLY ? "apply" : (SRC_OWN ? "local" : "dry");
  const stamp = new Date().toISOString().slice(0, 10);
  // Dry-run (synthetic) snapshots must NEVER land in data/raw/ — the merger
  // picks the latest-dated file there, so a stray dry file would shadow a
  // real snapshot and silently empty the augment. Park them in TMP_DIR.
  const outPath = OUT_OVER ?? (mode === "dry"
    ? path.join(TMP_DIR, `${stamp}-dry.json`)
    : path.join(RAW_DIR, `${stamp}.json`));
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const payload = {
    _license: LICENSE_STR,
    _source_url: "https://climatetrace.org/data",
    _version_hint: "Climate TRACE v5.x bulk download (https://downloads.climatetrace.org/latest/)",
    _gas: GAS,
    _generated_at: new Date().toISOString(),
    _mode: mode,
    _stats: snap._stats,
    ownership: snap.ownership,
    emissions: snap.emissions,
  };
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`\nWrote ${outPath}`);
  console.log(`  ownership rows:        ${snap.ownership.length.toLocaleString()}`);
  console.log(`  emissions aggregates:  ${snap.emissions.length.toLocaleString()}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("climate-trace-fetch failed:", err);
    process.exit(1);
  });
}
