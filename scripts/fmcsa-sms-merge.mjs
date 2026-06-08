#!/usr/bin/env node
/**
 * FMCSA SMS — merge into TruNorth slugs.
 *
 * Reads the most recent snapshot in data/raw/fmcsa-sms/ (produced by
 * fmcsa-sms-fetch.mjs --apply) and writes an augmentation file keyed
 * by TruNorth company slug:
 *
 *   data/derived/fmcsa-sms-augment.json
 *
 *   {
 *     _license:    "US Federal public-domain (49 USC 504, …)",
 *     sourceUrl:   "…",
 *     snapshotDate:"YYYY-MM",
 *     generatedAt: "…",
 *     matchCount:  N,
 *     orphanCount: M,
 *     <slug>: {
 *       labor: {
 *         fmcsaSafetyScores: {
 *           unsafeDriving, hoursOfService, vehicleMaintenance,
 *           controlledSubstances, hazmat, crashIndicator
 *         },
 *         outOfServiceRate: <number>,
 *         fleetSize: <number>,
 *         driverCount: <number>,
 *         alertCount: <number>,
 *         carrierCount: <number>,   // # USDOT carriers rolled up to this slug
 *         carriers: [               // sample of up to 5 underlying carriers
 *           { dotNumber, name, parent, city, state }
 *         ],
 *         worstCarrier: { dotNumber, name, basicMax },
 *         sourceUrl: "https://ai.fmcsa.dot.gov/SMS/CarrierMgmt/…?DOT=…"
 *       }
 *     }
 *   }
 *
 * Matching strategy (in priority order):
 *   1. Direct normalized-name match of the carrier OR parentName against
 *      public/data/index.json (e.g. "WALMART TRANSPORTATION LLC" → walmart).
 *   2. Name-fragment match against TruNorth slugs using a curated alias
 *      table for the largest fleets (FleetParentAliases). USDOT carrier
 *      names diverge from consumer-brand names in predictable ways
 *      (FEDERAL EXPRESS CORPORATION → fedex, J B HUNT → j-b-hunt).
 *   3. Brand-parent-map fallback for sub-brand → parent slug routing.
 *
 * Multi-carrier rollup: a single consumer brand often operates dozens of
 * USDOT-registered subsidiaries (FedEx Express, FedEx Ground, FedEx
 * Freight, etc.). We aggregate per parent slug by:
 *   - averaging BASIC percentiles weighted by fleetSize (a 50k-truck
 *     carrier should weight more than a 10-truck one)
 *   - taking the fleet-weighted average outOfServiceRate
 *   - summing fleetSize / driverCount / alertCount
 *   - keeping the worst-BASIC carrier as `worstCarrier` for the UI
 *
 * Flags:
 *   --apply        — write the augment file (otherwise print summary only).
 *   --dry          — (default) print what WOULD be written.
 *   --in PATH      — read a specific snapshot instead of the newest.
 *
 * Locally:
 *   node scripts/fmcsa-sms-merge.mjs
 *   node scripts/fmcsa-sms-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeName } from "./fmcsa-sms-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/fmcsa-sms");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "fmcsa-sms-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const LICENSE_TAG =
  "US Federal public-domain (49 USC 504, FMCSA Data Dissemination Program)";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const IN_PATH = (() => {
  const i = argv.indexOf("--in");
  return i >= 0 ? argv[i + 1] : null;
})();

// ─────────────────────────── fleet alias table ──────────────────────
// USDOT carrier-legal-names diverge from TruNorth slugs in a handful of
// well-known cases. Map [normalized fragment] → [slug] so the merger
// hits FedEx, JB Hunt, etc. The fragment is matched against the
// `normalizeName()` output of either the carrier OR parent name.
export const FLEET_PARENT_ALIASES = {
  // Parcel & last-mile
  "AMAZON":                 "amazon",
  "AMAZON LOGISTICS":       "amazon-logistics",
  "FEDERAL EXPRESS":        "fedex",
  "FEDEX":                  "fedex",
  "FEDEX GROUND":           "fedex",
  "FEDEX FREIGHT":          "fedex",
  "UNITED PARCEL":          "ups",
  "UPS":                    "ups",
  // Retail private fleets
  "WALMART":                "walmart",
  "TARGET":                 "target",
  "HOME DEPOT":             "home-depot",
  // Truckload / LTL public-co fleets
  "J B HUNT":               "j-b-hunt",
  "JB HUNT":                "j-b-hunt",
  "SCHNEIDER NATIONAL":     "schneider-national",
  "KNIGHT SWIFT":           "knight-swift-transportation-holdings",
  "KNIGHT":                 "knight-swift-transportation-holdings",
  "SWIFT":                  "knight-swift-transportation-holdings",
  "WERNER":                 "werner-enterprises",
  "OLD DOMINION":           "old-dominion-freight-line",
  "XPO":                    "xpo-logistics",
  "RYDER":                  "ryder-system",
  "LANDSTAR":               "landstar-system",
  "ESTES EXPRESS":          "estes-express-lines",
  "YELLOW":                 "yellow-corporation",
  "ARCBEST":                "arcbest-corporation",
  "ABF FREIGHT":            "arcbest-corporation",
  "SAIA":                   "saia-inc",
  // CPG / food distributors
  "SYSCO":                  "sysco",
  "US FOODS":               "us-foods",
  "MCLANE":                 "mclane",
  "PERFORMANCE FOOD":       "performance-food-group",
  "CR ENGLAND":             "cr-england",
};

// ─────────────────────────── matching ───────────────────────────────

function buildIndexLookup(index) {
  const byName = new Map();
  const slugs = new Set();
  for (const e of index) {
    const k = normalizeName(e.name);
    if (k && !byName.has(k)) byName.set(k, e.slug);
    slugs.add(e.slug);
  }
  return { byName, slugs };
}

/**
 * Resolve a carrier row to a TruNorth slug using direct match, alias
 * table, then brand-parent-map. Returns { slug, route } or null.
 */
export function resolveSlug(row, { byName, slugs, parentMap }) {
  const carrierN = normalizeName(row.carrierName);
  const parentN = normalizeName(row.parentName);

  // 1) Direct: try the index by full normalized name.
  for (const k of [parentN, carrierN]) {
    if (k && byName.has(k)) return { slug: byName.get(k), route: "direct" };
  }

  // 2) Alias fragments — sorted longest-first so "AMAZON LOGISTICS" wins over "AMAZON".
  const aliasKeys = Object.keys(FLEET_PARENT_ALIASES).sort((a, b) => b.length - a.length);
  for (const frag of aliasKeys) {
    if (!frag) continue;
    if (parentN.includes(frag) || carrierN.includes(frag)) {
      const slug = FLEET_PARENT_ALIASES[frag];
      if (slugs.has(slug)) return { slug, route: "alias" };
      // If alias points to a slug not in the index, treat as orphan.
    }
  }

  // 3) brand-parent-map fallback.
  const candidates = new Set();
  for (const n of [carrierN, parentN]) {
    if (!n) continue;
    const slug = n.toLowerCase().replace(/\s+/g, "-");
    candidates.add(slug);
    const first = n.toLowerCase().split(" ")[0];
    if (first) candidates.add(first);
  }
  for (const c of candidates) {
    const entry = parentMap[c];
    if (entry && entry.parent && slugs.has(entry.parent)) {
      return { slug: entry.parent, route: "parent-map" };
    }
  }

  return null;
}

// ─────────────────────────── rollup ─────────────────────────────────

const BASIC_KEYS = [
  "unsafeDriving",
  "hoursOfService",
  "vehicleMaintenance",
  "controlledSubstances",
  "hazmat",
  "crashIndicator",
];

/**
 * Roll up an array of carrier rows into a single labor.fmcsaSafetyScores
 * object. Percentile aggregation is fleet-size weighted; nulls are
 * ignored. Returns null if the bucket has no signal whatsoever.
 */
export function rollupBucket(rows, snapshotSourceUrl) {
  if (!rows.length) return null;

  const weighted = (vals) => {
    let num = 0, den = 0;
    for (const { v, w } of vals) {
      if (v == null) continue;
      const weight = (w == null || w <= 0) ? 1 : w;
      num += v * weight;
      den += weight;
    }
    return den > 0 ? Math.round((num / den) * 10) / 10 : null;
  };

  const basics = {};
  for (const k of BASIC_KEYS) {
    basics[k] = weighted(rows.map((r) => ({ v: r.basics?.[k] ?? null, w: r.fleetSize })));
  }
  const oosRate = weighted(rows.map((r) => ({ v: r.outOfServiceRate, w: r.fleetSize })));
  const fleetSize = rows.reduce((s, r) => s + (r.fleetSize || 0), 0) || null;
  const driverCount = rows.reduce((s, r) => s + (r.driverCount || 0), 0) || null;
  const alertCount = rows.reduce((s, r) => s + (r.alertCount || 0), 0);

  // Worst carrier in the bucket — max of the non-null BASIC percentiles.
  let worst = null;
  let worstMax = -1;
  for (const r of rows) {
    const max = BASIC_KEYS.reduce((m, k) => {
      const v = r.basics?.[k];
      return v != null && v > m ? v : m;
    }, -1);
    if (max > worstMax) { worstMax = max; worst = r; }
  }

  // Up to 5 sample carriers — biggest fleets first.
  const sampleCarriers = [...rows]
    .sort((a, b) => (b.fleetSize || 0) - (a.fleetSize || 0))
    .slice(0, 5)
    .map((r) => ({
      dotNumber: r.dotNumber,
      name: r.carrierName,
      parent: r.parentName,
      city: r.city,
      state: r.state,
    }));

  // Per-DOT detail page is the canonical UI link.
  const sourceUrl = worst?.dotNumber
    ? `https://ai.fmcsa.dot.gov/SMS/Carrier/${worst.dotNumber}/Overview.aspx`
    : snapshotSourceUrl;

  return {
    fmcsaSafetyScores: basics,
    outOfServiceRate: oosRate,
    fleetSize,
    driverCount,
    alertCount,
    carrierCount: rows.length,
    carriers: sampleCarriers,
    worstCarrier: worst
      ? { dotNumber: worst.dotNumber, name: worst.carrierName, basicMax: worstMax >= 0 ? worstMax : null }
      : null,
    sourceUrl,
  };
}

// ─────────────────────────── main merge ─────────────────────────────

export function mergeSnapshot(snapshot, { index, parentMap }) {
  const { byName, slugs } = buildIndexLookup(index);
  const buckets = new Map(); // slug → row[]
  const routeCounts = { direct: 0, alias: 0, "parent-map": 0 };
  let orphans = 0;
  const orphanSamples = [];

  for (const row of snapshot.rows || []) {
    const res = resolveSlug(row, { byName, slugs, parentMap });
    if (!res) {
      orphans++;
      if (orphanSamples.length < 10) orphanSamples.push(row.carrierName);
      continue;
    }
    routeCounts[res.route] = (routeCounts[res.route] || 0) + 1;
    if (!buckets.has(res.slug)) buckets.set(res.slug, []);
    buckets.get(res.slug).push(row);
  }

  const augment = {};
  const snapshotSourceUrl = snapshot.sourceUrl || "";
  for (const [slug, rows] of buckets) {
    const labor = rollupBucket(rows, snapshotSourceUrl);
    if (labor) augment[slug] = { labor };
  }

  return {
    augment,
    stats: {
      routeCounts,
      orphans,
      orphanSamples,
      matchedSlugs: Object.keys(augment).length,
    },
  };
}

// ─────────────────────────── snapshot loader ────────────────────────

async function latestSnapshot() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

async function loadJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

async function main() {
  console.log(`fmcsa-sms merge starting… (mode=${DRY ? "DRY" : "APPLY"})`);

  const snapshotPath = IN_PATH ? path.resolve(IN_PATH) : await latestSnapshot();
  if (!snapshotPath || !existsSync(snapshotPath)) {
    console.error(
      `No snapshot found in ${path.relative(ROOT, RAW_DIR)}. ` +
      `Run fmcsa-sms-fetch.mjs --apply first (or --dry to materialize the synthetic preview).`,
    );
    process.exit(2);
  }
  const snapshot = await loadJson(snapshotPath);
  if (!snapshot) {
    console.error(`Could not parse snapshot at ${snapshotPath}`);
    process.exit(2);
  }
  console.log(
    `Loaded snapshot: ${path.relative(ROOT, snapshotPath)} ` +
    `(${snapshot.rowCount || (snapshot.rows || []).length} carriers, ${snapshot.snapshotDate || "?"})`,
  );

  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  console.log(
    `Loaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).`,
  );

  const { augment, stats } = mergeSnapshot(snapshot, { index, parentMap });

  console.log("\nResults:");
  console.log(`  Direct matches:        ${stats.routeCounts.direct || 0}`);
  console.log(`  Alias matches:         ${stats.routeCounts.alias || 0}`);
  console.log(`  Parent-map matches:    ${stats.routeCounts["parent-map"] || 0}`);
  console.log(`  Orphans (no mapping):  ${stats.orphans}`);
  console.log(`  Distinct matched slugs:${stats.matchedSlugs}`);

  // Worst 5 by max BASIC percentile (HIGHER = WORSE).
  const ranked = Object.entries(augment)
    .map(([slug, v]) => ({
      slug,
      max: Math.max(
        ...Object.values(v.labor.fmcsaSafetyScores || {})
          .map((x) => (x == null ? -1 : x)),
      ),
      oos: v.labor.outOfServiceRate,
      fleet: v.labor.fleetSize,
    }))
    .filter((r) => r.max >= 0)
    .sort((a, b) => b.max - a.max)
    .slice(0, 5);

  if (ranked.length) {
    console.log("\nWorst 5 (highest BASIC percentile — higher = worse):");
    for (const r of ranked) {
      console.log(
        `  ${String(r.max).padStart(3)}  oos=${r.oos ?? "—"}%  fleet=${r.fleet ?? "—"}  ${r.slug}`,
      );
    }
  }

  if (stats.orphanSamples.length) {
    console.log("\n  Sample orphan carriers (no slug):");
    for (const n of stats.orphanSamples) console.log(`    • ${n}`);
  }

  const out = {
    _license: LICENSE_TAG,
    sourceUrl: snapshot.sourceUrl || "",
    sourceKind: snapshot.sourceKind || "",
    snapshotDate: snapshot.snapshotDate || "",
    generatedAt: new Date().toISOString(),
    matchCount: stats.matchedSlugs,
    orphanCount: stats.orphans,
    routeCounts: stats.routeCounts,
    ...augment,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)}`);
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("fmcsa-sms-merge failed:", err);
    process.exit(1);
  });
}
