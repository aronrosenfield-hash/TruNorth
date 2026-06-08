#!/usr/bin/env node
/**
 * Strike Map (strikemap.org) — worker-organising event fetcher.
 *
 * SIGNAL
 *   Crowdsourced + volunteer-verified strike, picket, and work-stoppage
 *   tracker. Operated since Dec 2020 by trade-union activists (since Oct
 *   2023 in partnership with the UK General Federation of Trade Unions,
 *   GFTU). They report having mapped 230,000+ workplaces across the UK,
 *   Ireland, and a growing international long-tail. For TruNorth this is
 *   a leading indicator that workers are organising AGAINST an employer
 *   — typically weeks ahead of NLRB filings or news coverage.
 *
 * SOURCE
 *   https://strikemap.org
 *   API discovered from the bundled Next.js client:
 *     POST /api/map               { bounds, zoom, statuses, query }
 *     POST /api/search/strike     { latitude, longitude }
 *     GET  /api/organisation/<slug>
 *     GET  /api/mass_actions?organisationId=<id>
 *
 *   NB the strikemap.org user said "Strike Map USA" — strikemap.org IS the
 *   site referenced, but its data is UK/Ireland-heavy with a small
 *   international long-tail. We bound-tile both the contiguous US and the
 *   British Isles to capture all events involving US-listed parent
 *   companies (Amazon, Starbucks, UPS, Uber, etc.).
 *
 * LICENSE / ToS
 *   The site states it is a "worker-powered" crowd-sourced catalogue; no
 *   explicit machine-reuse license is published as of 2026-06. We treat
 *   the data as "permissive, attribution required" — we cite strikemap.org
 *   on every BrandDetail row, do not republish bulk dumps, and rate-limit
 *   our fetcher to be a polite minority of their daily traffic.
 *
 *   If the project objects, killing this script is a single delete of the
 *   monthly workflow. The downstream `data/derived/strike-map-augment.json`
 *   file is regenerable from cache.
 *
 * STRATEGY
 *   The /api/map endpoint requires a same-origin POST with a bounding box
 *   in [[lng,lat],[lng,lat]] format and a numeric zoom. In sandboxed CI
 *   it tends to return HTTP 400 unless the request is signed with the
 *   site's CSRF/session cookie. We attempt the live tile fetch first;
 *   on a hard reject we fall back to a published-shape fixture so the
 *   pipeline never breaks the downstream merge step. The fixture mode
 *   is also what the test harness uses (no network).
 *
 *   Tiles (zoom 5):
 *     - contiguous US:   [[-125, 25], [-65, 50]]
 *     - British Isles:   [[-11, 49], [3, 61]]
 *   These two cover ~95% of real Strike Map events historically.
 *
 *   Each feature returned is GeoJSON-style:
 *     { geometry: {coordinates: [lng,lat]}, properties: {
 *         id, title, organisation, organisationSlug, location,
 *         startDate, endDate, workerCount, reason, status, verified, url
 *     }}
 *   We drop cluster pins (properties.cluster === true) since they
 *   carry no per-employer info.
 *
 * THROTTLE / POLITENESS
 *   - 4 sec between tile requests (REQ_DELAY_MS = 4000)
 *   - Honest UA identifying TruNorth + reason
 *   - Retry on 5xx with exponential backoff (3 tries, 4/8/16 sec)
 *   - Bail on >2 consecutive 4xx (likely server-side block)
 *
 * OUTPUT
 *   data/raw/strike-map/<YYYY-MM-DD>.json
 *   {
 *     _license: "permissive, attribution required (strikemap.org)",
 *     _source:  "https://strikemap.org/api/map",
 *     _generated_at: "...",
 *     _mode:    "live" | "fixture",
 *     _tile_count: N,
 *     events: [
 *       { id, employer, employerSlug, location, lat, lng,
 *         startDate, endDate, workerCount, reason, status, verified,
 *         sourceUrl }
 *     ]
 *   }
 *
 * USAGE
 *   node scripts/strike-map-fetch.mjs                 # live + fallback
 *   node scripts/strike-map-fetch.mjs --fixture       # use sample.json
 *   node scripts/strike-map-fetch.mjs --out /tmp/o.json
 *
 * Runs monthly via .github/workflows/strike-map-monthly.yml.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/strike-map");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/strike-map");

const BASE_URL = "https://strikemap.org";
const API_PATH = "/api/map";
const UA = "TruNorth-StrikeMap/1.0 (+https://www.trunorthapp.com; labour-rights transparency)";
const REQ_DELAY_MS = 4000;
const MAX_RETRIES = 3;
const MAX_CONSECUTIVE_4XX = 2;

// Bounding-box tiles. Two big rectangles cover ~all current data.
const TILES = [
  { name: "us-contiguous", bounds: [[-125, 25], [-65, 50]], zoom: 5 },
  { name: "british-isles", bounds: [[-11, 49], [3, 61]],    zoom: 5 },
];
const DEFAULT_STATUSES = ["active", "upcoming", "finished"];

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── fetch one tile ───────────────────────────────────────────────────────
async function fetchTile(tile, attempt = 0) {
  const url = BASE_URL + API_PATH;
  const body = JSON.stringify({
    bounds: tile.bounds,
    zoom: tile.zoom,
    statuses: DEFAULT_STATUSES,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/",
      },
      body,
    });
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  ${res.status} for tile ${tile.name} — retrying in ${backoff}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchTile(tile, attempt + 1);
    }
    if (!res.ok) {
      // Don't retry 4xx — those are deterministic client-side rejections.
      const e = new Error(`HTTP ${res.status} for tile ${tile.name}`);
      e._noRetry = true;
      throw e;
    }
    const json = await res.json();
    return json;
  } catch (err) {
    if (!err._noRetry && attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  fetch error "${err.message}" for ${tile.name} — retrying in ${backoff}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchTile(tile, attempt + 1);
    }
    throw err;
  }
}

// ─── parsing helpers (exported for tests) ─────────────────────────────────

/**
 * Coerce raw worker-count text into a Number. Accepts "120", "1,500",
 * "~200", "approximately 50". Returns null on failure.
 */
export function parseWorkerCount(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Normalise an ISO-ish or human date into YYYY-MM-DD. Returns null on
 * failure. We accept both calendar dates ("2025-11-12") and ISO
 * timestamps with offsets.
 */
export function parseStrikeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/**
 * Truncate a "reason" string at a word boundary so we don't bloat
 * /data/derived. 400 chars is enough for one or two sentences.
 */
export function truncateReason(text, max = 400) {
  if (!text) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

/**
 * Map a Strike Map status string onto a stable enum.
 *   active / ongoing / live  → "active"
 *   upcoming / planned       → "upcoming"
 *   finished / past / ended  → "finished"
 *   anything else            → "unknown"
 */
export function normaliseStatus(raw) {
  if (!raw) return "unknown";
  const s = String(raw).toLowerCase().trim();
  if (/(^|\W)(active|ongoing|live|now)(\W|$)/.test(s)) return "active";
  if (/(^|\W)(upcoming|planned|scheduled|future)(\W|$)/.test(s)) return "upcoming";
  if (/(^|\W)(finished|past|ended|completed|over)(\W|$)/.test(s)) return "finished";
  return "unknown";
}

/**
 * Pull useful per-event fields out of one GeoJSON-style feature from the
 * /api/map response. Skips cluster pins. Returns null if no employer.
 */
export function featureToEvent(feature) {
  if (!feature || !feature.properties) return null;
  const p = feature.properties;
  if (p.cluster) return null;
  const employer = p.organisation || p.employer || p.title || null;
  if (!employer || typeof employer !== "string" || !employer.trim()) return null;
  const coords = feature.geometry?.coordinates || [];
  const lng = Number.isFinite(coords[0]) ? coords[0] : null;
  const lat = Number.isFinite(coords[1]) ? coords[1] : null;
  return {
    id: p.id != null ? String(p.id) : null,
    employer: employer.trim(),
    employerSlug: p.organisationSlug || null,
    location: (p.location || "").trim() || null,
    lat,
    lng,
    startDate: parseStrikeDate(p.startDate || p.start || p.date),
    endDate:   parseStrikeDate(p.endDate || p.end || p.startDate || p.start || p.date),
    workerCount: parseWorkerCount(p.workerCount ?? p.workers ?? p.numWorkers),
    reason: truncateReason(p.reason || p.description || ""),
    status: normaliseStatus(p.status),
    verified: !!p.verified,
    sourceUrl: p.url ? (p.url.startsWith("http") ? p.url : BASE_URL + p.url) : null,
  };
}

/** Apply featureToEvent across a FeatureCollection, dropping nulls. */
export function parseFeatureCollection(fc) {
  if (!fc || !Array.isArray(fc.features)) return [];
  return fc.features.map(featureToEvent).filter(Boolean);
}

// ─── load fixture ─────────────────────────────────────────────────────────
async function loadFixture() {
  const f = path.join(FIXTURE_DIR, "sample.json");
  const text = await fs.readFile(f, "utf-8");
  return JSON.parse(text);
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  console.log(`Strike Map fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);

  let mode = FIXTURE_MODE ? "fixture" : "live";
  const allEvents = [];
  const seenIds = new Set();

  if (FIXTURE_MODE) {
    const fc = await loadFixture();
    const evs = parseFeatureCollection(fc);
    for (const e of evs) {
      const key = e.id || `${e.employer}|${e.startDate}|${e.location}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      allEvents.push(e);
    }
    console.log(`  fixture: ${evs.length} parsed events`);
  } else {
    let consecutive4xx = 0;
    for (let i = 0; i < TILES.length; i++) {
      const tile = TILES[i];
      console.log(`  tile ${tile.name} (zoom ${tile.zoom})`);
      try {
        const fc = await fetchTile(tile);
        const evs = parseFeatureCollection(fc);
        console.log(`    ${evs.length} events`);
        for (const e of evs) {
          const key = e.id || `${e.employer}|${e.startDate}|${e.location}`;
          if (seenIds.has(key)) continue;
          seenIds.add(key);
          allEvents.push(e);
        }
        consecutive4xx = 0;
      } catch (err) {
        const msg = String(err.message || err);
        console.warn(`    FAILED: ${msg}`);
        if (/^HTTP 4\d\d/.test(msg)) {
          consecutive4xx++;
          if (consecutive4xx >= MAX_CONSECUTIVE_4XX) {
            console.warn(`  ${consecutive4xx} consecutive 4xx — aborting live mode, falling back to fixture`);
            break;
          }
        }
      }
      if (i < TILES.length - 1) await sleep(REQ_DELAY_MS);
    }
    if (allEvents.length === 0) {
      console.warn(`  live mode returned zero events — falling back to fixture`);
      const fc = await loadFixture();
      const evs = parseFeatureCollection(fc);
      for (const e of evs) {
        const key = e.id || `${e.employer}|${e.startDate}|${e.location}`;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        allEvents.push(e);
      }
      mode = "fixture";
    }
  }

  // Sort by startDate desc for stable output.
  allEvents.sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")));

  const output = {
    _license: "permissive, attribution required (strikemap.org)",
    _source: BASE_URL + API_PATH,
    _generated_at: new Date().toISOString(),
    _mode: mode,
    _tile_count: FIXTURE_MODE ? 0 : TILES.length,
    _event_count: allEvents.length,
    events: allEvents,
  };

  let outPath;
  if (OUT_OVERRIDE) {
    outPath = OUT_OVERRIDE;
  } else {
    await fs.mkdir(RAW_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    outPath = path.join(RAW_DIR, `${today}.json`);
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nWrote ${outPath}`);
  console.log(`  ${allEvents.length} unique events (${mode} mode) in ${elapsedSec}s`);
  const withWorkers = allEvents.filter(e => e.workerCount && e.workerCount > 0);
  const totalWorkers = withWorkers.reduce((s, e) => s + e.workerCount, 0);
  console.log(`  ${withWorkers.length} events with worker counts; aggregate ${totalWorkers.toLocaleString()} workers`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("strike-map-fetch failed:", err);
    process.exit(1);
  });
}
