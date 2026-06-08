#!/usr/bin/env node
/**
 * EPA SmartWay — merge.
 *
 * Reads the latest /data/raw/epa-smartway/<date>.json snapshot, attributes
 * each carrier partner to a TruNorth parent-company slug, and writes:
 *
 *   data/derived/epa-smartway-augment.json
 *
 * Output is keyed by slug; value (per the environment-cat schema):
 *   {
 *     environment: {
 *       smartwayPartnerSince: number | null,   // earliest partnership year across matched carriers
 *       tier:                string  | null,   // most-frequent partnership tier
 *       fleetSize:           number  | null,   // summed fleet size across matched carriers
 *       sourceUrl:           string
 *     },
 *     // bookkeeping (useful for QA / cron audits):
 *     matched_carriers:      string[],
 *     matched_carrier_count: number
 *   }
 *
 * Matching strategy:
 *   1. Try to match the row's Parent Company against slug aliases first
 *      (parent rolls up the fleet correctly, e.g. FedEx Freight + FedEx
 *      Ground + FedEx Express all attribute to `fedex`).
 *   2. Fall back to the Partner Name itself (covers single-entity carriers
 *      like `werner-enterprises` where there is no separate parent row).
 *
 * Locally: node scripts/epa-smartway-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/epa-smartway");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/epa-smartway-augment.json");

function parseArgs(argv) {
  const out = { rawPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") out.rawPath = argv[++i];
    else if (argv[i] === "--out") out.outPath = argv[++i];
  }
  return out;
}

async function loadLatestRaw() {
  try {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadCompanySlugs() {
  if (!existsSync(COMP_DIR)) return [];
  return (await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
}

async function loadParentMap() {
  try { return JSON.parse(await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8")); }
  catch { return {}; }
}

export function buildAliasIndex(slugs, parentMap) {
  const idx = new Map();
  for (const slug of slugs) {
    const n = normalizeCompanyName(slug.replace(/-/g, " "));
    if (n) idx.set(n, slug);
    for (const a of parentMap[slug]?.aliases || []) {
      const nn = normalizeCompanyName(a);
      if (nn) idx.set(nn, slug);
    }
  }
  return idx;
}

/**
 * Strict-then-loose matching: exact normalized hit first, then prefix /
 * containment fallback that only kicks in for alias keys >= 4 chars.
 * Conservative on purpose — false-positive attribution to a major brand
 * is worse than dropping a small carrier.
 */
export function matchName(name, idx) {
  const n = normalizeCompanyName(name);
  if (!n) return null;
  if (idx.has(n)) return idx.get(n);
  // Try progressively trimming trailing words (e.g. "fedex express fleet" -> "fedex express").
  const parts = n.split(" ");
  for (let take = parts.length - 1; take >= 1; take--) {
    const prefix = parts.slice(0, take).join(" ");
    if (idx.has(prefix)) return idx.get(prefix);
  }
  // Containment: alias substring inside the input name.
  for (const [alias, slug] of idx) {
    if (alias.length < 4) continue;
    if (n === alias || n.startsWith(alias + " ") || n.endsWith(" " + alias) || n.includes(" " + alias + " ")) {
      return slug;
    }
  }
  return null;
}

export function attributeCarrier(carrier, idx) {
  // Parent first — rolls subsidiaries up to the corporate brand.
  if (carrier.parent_company) {
    const slug = matchName(carrier.parent_company, idx);
    if (slug) return { slug, matched_on: "parent_company" };
  }
  if (carrier.carrier_name) {
    const slug = matchName(carrier.carrier_name, idx);
    if (slug) return { slug, matched_on: "carrier_name" };
  }
  return null;
}

function pickModeTier(tiers) {
  if (!tiers.length) return null;
  const counts = new Map();
  for (const t of tiers) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function rollupBySlug(carriers, idx, sourceUrl) {
  const byslug = new Map();
  for (const c of carriers) {
    const m = attributeCarrier(c, idx);
    if (!m) continue;
    let bucket = byslug.get(m.slug);
    if (!bucket) {
      bucket = {
        slug:                  m.slug,
        environment:           {
          smartwayPartnerSince: null,
          tier:                 null,
          fleetSize:            0,
          sourceUrl,
        },
        _tiers:                [],
        matched_carriers:      [],
        matched_carrier_count: 0,
      };
      byslug.set(m.slug, bucket);
    }
    if (typeof c.partnership_year === "number") {
      if (bucket.environment.smartwayPartnerSince == null
        || c.partnership_year < bucket.environment.smartwayPartnerSince) {
        bucket.environment.smartwayPartnerSince = c.partnership_year;
      }
    }
    if (typeof c.fleet_size === "number") bucket.environment.fleetSize += c.fleet_size;
    if (c.partnership_tier) bucket._tiers.push(c.partnership_tier);
    bucket.matched_carriers.push(c.carrier_name);
    bucket.matched_carrier_count++;
  }
  // Finalize tier mode, drop zero fleet to null, strip internals.
  const out = {};
  for (const [slug, b] of byslug) {
    b.environment.tier = pickModeTier(b._tiers);
    if (b.environment.fleetSize === 0) b.environment.fleetSize = null;
    delete b._tiers;
    out[slug] = b;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const slugs = await loadCompanySlugs();
  const idx = buildAliasIndex(slugs, await loadParentMap());
  const companies = rollupBySlug(snap.carriers || [], idx, snap.source_url);

  const augment = {
    source:                "epa-smartway",
    source_url:            snap.source_url,
    license:               snap.license || "US federal public domain (EPA SmartWay)",
    generated_at:          new Date().toISOString(),
    snapshot_date:         snap.snapshot_date,
    carrier_count:         snap.carrier_count,
    matched_slug_count:    Object.keys(companies).length,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath} (${augment.matched_slug_count} slugs / ${snap.carrier_count} carriers)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("epa-smartway-merge failed:", err);
    process.exit(1);
  });
}
