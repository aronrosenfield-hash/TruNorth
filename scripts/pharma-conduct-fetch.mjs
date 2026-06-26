#!/usr/bin/env node
/**
 * Pharma Conduct — two US public-records signals into one DERIVED augment.
 *
 * Surfaces, per TruNorth brand slug, how a pharmaceutical / medical-device /
 * retail-pharmacy company shows up in two clean federal/public datasets:
 *
 *  (1) CMS Open Payments (Physician Payments Sunshine Act) — the total dollars
 *      a drug/device MANUFACTURER paid to physicians & teaching hospitals in a
 *      single program year (general payments: consulting, speaking, meals,
 *      travel, gifts, royalties). Public domain, no auth.
 *      Dataset metastore:
 *        https://openpaymentsdata.cms.gov/api/1/metastore/schemas/dataset/items
 *      Datastore query (per dataset id):
 *        https://openpaymentsdata.cms.gov/api/1/datastore/query/{datasetId}/0
 *      We use the datastore's SERVER-SIDE aggregation (group-by manufacturer
 *      name + SUM of total_amount_of_payment_usdollars) so we pull ~1.7k
 *      aggregated rows instead of the ~15M underlying payment rows.
 *
 *  (2) National Opioid Settlement — the global settlement amounts of the ~12
 *      named distributor/manufacturer/pharmacy defendants, from
 *      https://www.nationalopioidofficialsettlement.com/ . A small CURATED set
 *      (these are fixed, widely-reported, historical totals — not an API).
 *
 * Output (DERIVED AUGMENT, keyed by TruNorth company slug):
 *   data/derived/pharma-conduct-augment.json
 *
 * Per-slug shape (only the fields that apply to that slug):
 *   {
 *     sunshineActPaymentsUsd,   // number — total general payments in the year
 *     sunshineActYear,          // e.g. 2024
 *     opioidSettlementUsd,      // number — global national-settlement amount
 *     lastUpdated               // ISO date
 *   }
 * A slug can carry one or both signals (e.g. J&J, CVS, Walmart appear in both;
 * a pure-device maker like Stryker carries only the Sunshine-Act field).
 *
 * ── MATCHING (STRICT — a MISSING flag beats a WRONG one) ──────────────
 * The reused ITEP `nameVariants` helper emits BARE word-prefixes ("teva",
 * "abbott") that over-collapse on raw legal names — e.g. "Teva
 * Pharmaceuticals" would wrongly collapse to the `teva` parent-map key, which
 * points at Deckers Outdoor (the SANDAL brand), and "abbott" alone is
 * ambiguous. So we DELIBERATELY do NOT use matchCompanyToIndex /
 * matchViaParentMap here. Instead:
 *   1. A small CURATED alias map (manufacturer/defendant legal name → slug),
 *      hand-verified against public/data/index.json. This is the primary path
 *      for the high-value pharma/device/pharmacy names whose legal entity
 *      ("GENZYME CORPORATION", "Lilly USA, LLC") differs from the brand slug.
 *   2. STRICT index match: the FULL normalized name, or the full name with a
 *      trailing US-geo/suffix qualifier stripped — exact key hits only. No
 *      first-word / first-two-word prefixes.
 * Every alias target is asserted to exist in the index at load time; an alias
 * pointing at a missing slug is dropped with a warning rather than emitted.
 *
 * Flags:
 *   --apply        — write data/derived/pharma-conduct-augment.json (else dry).
 *   --year YYYY     — force the Open Payments program year (default: newest
 *                     General-Payment dataset, typically the latest closed year).
 *   --top N         — only aggregate the top-N manufacturers by total $
 *                     (default 700 — every graded brand sits far above this;
 *                     keeps the pull to ~2 pages). Use --all for everything.
 *   --all           — aggregate ALL distinct manufacturers (~1.7k, ~4 pages).
 *   --cache         — reuse data/raw/pharma-conduct/openpayments-CY{year}.json
 *                     instead of re-hitting CMS.
 *   --no-network    — skip the CMS pull entirely (opioid-only augment).
 *
 * NEVER writes public/data/companies/*.json. NEVER commits.
 *
 * Locally:
 *   node scripts/pharma-conduct-fetch.mjs            # dry-run, prints summary
 *   node scripts/pharma-conduct-fetch.mjs --apply    # write the augment
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeCompanyName } from "./itep-tax-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/pharma-conduct");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "pharma-conduct-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

const UA =
  "TruNorth-Pharma/1.0 (+https://www.trunorthapp.com; contact@trunorthapp.com)";
const REQUEST_TIMEOUT_MS = 120_000;

const OPENPAYMENTS_BASE = "https://openpaymentsdata.cms.gov/api/1";
const DATASET_ITEMS = `${OPENPAYMENTS_BASE}/metastore/schemas/dataset/items?show-reference-ids=false`;
const OPENPAYMENTS_LANDING = "https://openpaymentsdata.cms.gov/";
const OPIOID_LANDING = "https://www.nationalopioidofficialsettlement.com/";

const MFR_COL = "applicable_manufacturer_or_applicable_gpo_making_payment_name";
const AMT_COL = "total_amount_of_payment_usdollars";

const PAGE_SIZE = 500;
const DEFAULT_TOP = 700;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const USE_CACHE = argv.includes("--cache");
const NO_NETWORK = argv.includes("--no-network");
const FETCH_ALL = argv.includes("--all");
const FORCE_YEAR = (() => {
  const i = argv.indexOf("--year");
  return i >= 0 ? Number(argv[i + 1]) : null;
})();
const TOP_N = (() => {
  const i = argv.indexOf("--top");
  return i >= 0 ? Number(argv[i + 1]) : DEFAULT_TOP;
})();

// ─────────────────────── (2) opioid settlement — curated ─────────────
//
// Global national-settlement amounts (USD) of the named defendants, from
// nationalopioidofficialsettlement.com (the "executed settlements" + the
// distributor/J&J master settlement). These are fixed historical totals.
// `slug` is the TruNorth brand slug each defendant resolves to (verified to
// exist in public/data/index.json). Purdue Pharma is omitted: it is a
// defunct private company with no consumer-brand slug in the index.
const OPIOID_SETTLEMENTS = [
  // Big-3 distributors + J&J master settlement (≈$26B total; the three
  // distributors share ≈$21B, allocated per company below from the settlement
  // schedule; J&J ≈$5B for its manufacturer role).
  { name: "McKesson", slug: "mckesson", amountUsd: 7_400_000_000 },
  { name: "Cardinal Health", slug: "cardinal-health", amountUsd: 6_000_000_000 },
  { name: "Cencora (AmerisourceBergen)", slug: "cencora", amountUsd: 6_400_000_000 },
  { name: "Johnson & Johnson", slug: "johnson-and-johnson", amountUsd: 5_000_000_000 },
  // Manufacturers.
  { name: "Teva", slug: "teva-pharmaceutical-industries", amountUsd: 4_250_000_000 },
  { name: "Allergan", slug: "allergan-inc", amountUsd: 2_370_000_000 },
  // Pharmacy chains.
  { name: "CVS", slug: "cvs-health", amountUsd: 5_000_000_000 },
  { name: "Walgreens", slug: "walgreens", amountUsd: 5_700_000_000 },
  { name: "Walmart", slug: "walmart", amountUsd: 3_100_000_000 },
  { name: "Kroger", slug: "kroger", amountUsd: 1_200_000_000 },
];

// ─────────────────────── (1) Sunshine Act — curated aliases ──────────
//
// Manufacturer LEGAL/entity name (as it appears in Open Payments) → brand
// slug, for the high-value names whose legal entity differs from the slug or
// whose bare-prefix would be ambiguous. Keys are normalized at load time, so
// the surface form here is just for readability. Every value is asserted to
// exist in the index; misses are dropped with a warning.
//
// We intentionally keep this to well-known, unambiguous mappings. Anything
// not covered here still gets a STRICT exact-name attempt against the index.
const SUNSHINE_ALIASES = {
  // Subsidiary / operating-company names → parent brand slug.
  "Lilly USA, LLC": "eli-lilly",
  "Eli Lilly and Company": "eli-lilly",
  "Genentech, Inc.": "genentech",
  "GENZYME CORPORATION": "sanofi", // Genzyme is a Sanofi company
  "Genzyme Corporation": "sanofi",
  "DePuy Synthes Products, Inc.": "johnson-and-johnson",
  "DePuy Synthes Sales, Inc.": "johnson-and-johnson",
  "Janssen Biotech, Inc.": "johnson-and-johnson",
  "Janssen Pharmaceuticals, Inc.": "johnson-and-johnson",
  "Ethicon US, LLC": "johnson-and-johnson",
  "Ethicon, Inc.": "johnson-and-johnson",
  "AstraZeneca Pharmaceuticals LP": "astrazeneca",
  "Takeda Pharmaceuticals U.S.A., Inc.": "takeda-pharmaceutical",
  "Takeda Pharmaceuticals America, Inc.": "takeda-pharmaceutical",
  "Boehringer Ingelheim Pharmaceuticals, Inc.": "boehringer-ingelheim-united-states",
  "Novartis Pharmaceuticals Corporation": "novartis",
  "Sandoz Inc.": "novartis", // (Sandoz spun off 2023; kept as fallback)
  "Novo Nordisk Inc.": "novo-nordisk",
  "Bayer HealthCare Pharmaceuticals Inc.": "bayer",
  "Bayer HealthCare LLC": "bayer",
  "Gilead Sciences, Inc.": "gilead-sciences",
  "Pfizer Inc.": "pfizer",
  "AbbVie Inc.": "abbvie",
  "Amgen Inc.": "amgen",
  "Merck Sharp & Dohme LLC": "merck",
  "Merck Sharp & Dohme Corp.": "merck",
  "Bristol-Myers Squibb Company": "bristol-myers-squibb",
  "Regeneron Pharmaceuticals, Inc.": "regeneron",
  "Biogen Inc.": "biogen",
  "Moderna US, Inc.": "moderna",
  "ModernaTX, Inc.": "moderna",
  "Teva Pharmaceuticals USA, Inc.": "teva-pharmaceutical-industries",
  "Teva Neuroscience, Inc.": "teva-pharmaceutical-industries",
  "Allergan, Inc.": "allergan-inc",
  "Allergan USA, Inc.": "allergan-inc",
  "Vertex Pharmaceuticals Incorporated": "vertex-pharmaceuticals",
  "Viatris Inc.": "viatris",
  "Mylan Pharmaceuticals Inc.": "viatris", // Mylan → Viatris (2020 merger)
  "Mylan Specialty L.P.": "viatris",
  "Abbott Laboratories": "abbott-laboratories",
  "Abbott Diabetes Care Inc.": "abbott-laboratories",
  "Stryker Corporation": "stryker",
  "Howmedica Osteonics Corp.": "stryker", // Stryker operating co
  "Medtronic, Inc.": "medtronic",
  "Medtronic USA, Inc.": "medtronic",
  "Boston Scientific Corporation": "boston-scientific",
  "Zimmer Biomet Holdings, Inc.": "zimmer-biomet",
  "Zimmer, Inc.": "zimmer-biomet",
  "Zimmer US, Inc.": "zimmer-biomet",
  "Sanofi-Aventis U.S. LLC": "sanofi",
  "Sanofi US Services Inc.": "sanofi",
  "GlaxoSmithKline LLC": "gsk",
  "GlaxoSmithKline": "gsk",
  "GSK Consumer Healthcare": "gsk",
  // Additional operating-company / subsidiary entities seen with material $ in
  // the CY2024 aggregate, each mapping to a graded parent slug.
  "E.R. Squibb & Sons, L.L.C.": "bristol-myers-squibb",
  "Regeneron Healthcare Solutions, Inc.": "regeneron",
  "Medical Device Business Services, Inc.": "johnson-and-johnson", // J&J MedTech
  "AstraZeneca UK Limited": "astrazeneca",
  "Pfizer Pharmaceuticals LLC": "pfizer",
  "Genentech USA, Inc.": "genentech",
  "Bayer Corporation": "bayer",
};

// ─────────────────────── strict matching ────────────────────────────

/** normalized full-name → slug, first-write-wins (mirrors buildIndexLookup). */
function buildStrictLookup(index) {
  const byName = new Map();
  for (const e of index) {
    const k = normalizeCompanyName(e.name);
    if (k && !byName.has(k)) byName.set(k, e.slug);
  }
  return byName;
}

/**
 * STRICT name variants: the full normalized name, plus the full name with a
 * single trailing US-geo qualifier removed. NO leading word-prefix variants —
 * those are exactly what over-collapse (the documented ITEP lesson). The
 * normalizer already strips corporate suffixes (inc/corp/llc/lp/…), so e.g.
 * "PFIZER INC." → "pfizer" and "Boston Scientific Corporation" → "boston
 * scientific" land on their slugs directly.
 */
function strictVariants(name) {
  const base = normalizeCompanyName(name);
  if (!base) return [];
  const out = new Set([base]);
  const stripped = base
    .replace(/\b(us|usa|u s a|north america|americas|international|global)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && stripped !== base) out.add(stripped);
  return [...out];
}

/** Resolve a manufacturer name → slug via curated alias, then STRICT index. */
function resolveManufacturer(name, { aliasByNorm, strictByName }) {
  const norm = normalizeCompanyName(name);
  if (norm && aliasByNorm.has(norm)) return { slug: aliasByNorm.get(norm), route: "alias" };
  for (const v of strictVariants(name)) {
    const hit = strictByName.get(v);
    if (hit) return { slug: hit, route: "strict" };
  }
  return null;
}

// ─────────────────────── CMS Open Payments fetch ────────────────────

async function loadJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) },
      redirect: "follow",
    });
  } finally { clearTimeout(t); }
}

/** Pick the General-Payment dataset id for `year` (or the newest year). */
async function pickGeneralPaymentDataset(year) {
  const res = await fetchWithTimeout(DATASET_ITEMS);
  if (!res.ok) throw new Error(`Open Payments metastore HTTP ${res.status}`);
  const items = await res.json();
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Open Payments metastore returned no datasets");
  }
  const general = items
    .map((d) => {
      const m = /^(\d{4})\s+General Payment Data$/i.exec(d.title || "");
      return m ? { id: d.identifier, year: Number(m[1]), title: d.title } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.year - a.year);
  if (!general.length) throw new Error("No 'General Payment Data' dataset found in metastore");
  const chosen = year ? general.find((g) => g.year === year) : general[0];
  if (!chosen) {
    throw new Error(
      `No General-Payment dataset for year ${year} (have: ${general.map((g) => g.year).join(", ")})`,
    );
  }
  return chosen;
}

/**
 * Server-side group-by manufacturer + SUM(total payment $). Paginates over the
 * aggregated result (not the raw payment rows). Returns
 * [{ name, totalUsd }, ...] sorted desc. Stops once `maxRows` is reached
 * (unless FETCH_ALL).
 */
async function aggregateManufacturerPayments(datasetId, year, maxRows) {
  const queryUrl = `${OPENPAYMENTS_BASE}/datastore/query/${datasetId}/0`;
  const out = [];
  let offset = 0;
  for (;;) {
    const body = {
      properties: [
        MFR_COL,
        { expression: { operator: "sum", operands: [AMT_COL] }, alias: "total_usd" },
      ],
      groupings: [MFR_COL],
      sorts: [{ property: "total_usd", order: "desc" }],
      limit: PAGE_SIZE,
      offset,
      count: false,
    };
    console.log(`  POST aggregate (offset=${offset}, limit=${PAGE_SIZE}) ...`);
    const res = await fetchWithTimeout(queryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Open Payments query HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json();
    const rows = json.results || [];
    if (!rows.length) break;
    for (const r of rows) {
      const name = r[MFR_COL];
      const totalUsd = Number(r.total_usd);
      if (name && Number.isFinite(totalUsd)) out.push({ name, totalUsd });
    }
    console.log(`    +${rows.length} rows (running total ${out.length})`);
    offset += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;        // last page
    if (!FETCH_ALL && out.length >= maxRows) break;
    await sleep(300);                           // polite spacing
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Load the Open Payments aggregate (cache or live), guarding empties. */
async function getSunshineData() {
  if (NO_NETWORK) {
    console.log("--no-network: skipping CMS Open Payments pull.");
    return { year: null, manufacturers: [] };
  }
  const cacheYear = FORCE_YEAR || "latest";
  const cacheFile = path.join(RAW_DIR, `openpayments-CY${cacheYear}.json`);
  if (USE_CACHE && existsSync(cacheFile)) {
    const cached = await loadJson(cacheFile);
    if (cached && Array.isArray(cached.manufacturers) && cached.manufacturers.length) {
      console.log(`  [cache] ${path.relative(ROOT, cacheFile)}: ${cached.manufacturers.length} manufacturers (CY${cached.year})`);
      return cached;
    }
    console.log("  [cache] miss/empty — fetching live.");
  }

  const ds = await pickGeneralPaymentDataset(FORCE_YEAR);
  console.log(`Open Payments dataset: "${ds.title}" (id ${ds.id})`);
  const manufacturers = await aggregateManufacturerPayments(ds.id, ds.year, TOP_N);
  if (!manufacturers.length) {
    throw new Error("Open Payments aggregation returned 0 manufacturers — refusing to write empty.");
  }
  const snapshot = { year: ds.year, datasetId: ds.id, fetchedAt: new Date().toISOString(), manufacturers };
  // Persist raw snapshot for --cache + auditability.
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(
    path.join(RAW_DIR, `openpayments-CY${ds.year}.json`),
    JSON.stringify(snapshot, null, 2),
  );
  await fs.writeFile(cacheFile, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

// ─────────────────────── merge → augment ────────────────────────────

function buildAugment({ sunshine, index }) {
  const strictByName = buildStrictLookup(index);
  const validSlugs = new Set(index.map((e) => e.slug));

  // Normalize the curated alias map + assert targets exist.
  const aliasByNorm = new Map();
  let droppedAliases = 0;
  for (const [legal, slug] of Object.entries(SUNSHINE_ALIASES)) {
    if (!validSlugs.has(slug)) {
      console.warn(`  ⚠️  alias "${legal}" → "${slug}" — slug NOT in index, dropping.`);
      droppedAliases++;
      continue;
    }
    const k = normalizeCompanyName(legal);
    if (k && !aliasByNorm.has(k)) aliasByNorm.set(k, slug);
  }

  const now = new Date().toISOString().slice(0, 10);
  const augment = {};
  const ensure = (slug) => (augment[slug] ||= { lastUpdated: now });

  // (1) Sunshine Act — fold each manufacturer aggregate into its slug. A slug
  // can receive contributions from several legal entities (J&J ← Janssen +
  // DePuy + Ethicon); SUM them so the slug reflects the whole corporate group.
  const sunStats = { alias: 0, strict: 0, orphan: 0, mfrsMatched: 0 };
  const orphanSample = [];
  for (const m of sunshine.manufacturers || []) {
    const hit = resolveManufacturer(m.name, { aliasByNorm, strictByName });
    if (!hit) {
      sunStats.orphan++;
      if (orphanSample.length < 12 && m.totalUsd > 2_000_000) orphanSample.push(`${m.name} ($${(m.totalUsd / 1e6).toFixed(1)}M)`);
      continue;
    }
    sunStats[hit.route]++;
    sunStats.mfrsMatched++;
    const e = ensure(hit.slug);
    e.sunshineActPaymentsUsd = (e.sunshineActPaymentsUsd || 0) + m.totalUsd;
    e.sunshineActYear = sunshine.year;
  }
  // Round the summed payment totals to whole dollars.
  for (const e of Object.values(augment)) {
    if (typeof e.sunshineActPaymentsUsd === "number") {
      e.sunshineActPaymentsUsd = Math.round(e.sunshineActPaymentsUsd);
    }
  }
  const sunshineSlugs = Object.keys(augment).length;

  // (2) Opioid settlement — curated, slugs pre-verified above.
  let opioidMatched = 0;
  const opioidDropped = [];
  for (const d of OPIOID_SETTLEMENTS) {
    if (!validSlugs.has(d.slug)) { opioidDropped.push(`${d.name}→${d.slug}`); continue; }
    const e = ensure(d.slug);
    e.opioidSettlementUsd = d.amountUsd;
    opioidMatched++;
  }

  return {
    augment,
    stats: {
      sunshine: sunStats,
      sunshineSlugs,
      orphanSample,
      droppedAliases,
      opioidMatched,
      opioidDropped,
      totalSlugs: Object.keys(augment).length,
    },
  };
}

// ─────────────────────── main ───────────────────────────────────────

async function main() {
  console.log(
    `pharma-conduct fetch starting... (mode=${APPLY ? "APPLY" : "DRY"}, ` +
      `${NO_NETWORK ? "no-network" : FETCH_ALL ? "all-mfrs" : `top-${TOP_N}`}${USE_CACHE ? ", cache" : ""})`,
  );

  const sunshine = await getSunshineData();
  if (sunshine.manufacturers.length) {
    console.log(
      `\nOpen Payments CY${sunshine.year}: aggregated ${sunshine.manufacturers.length} manufacturers ` +
        `(top = ${sunshine.manufacturers[0].name}, $${(sunshine.manufacturers[0].totalUsd / 1e6).toFixed(1)}M).`,
    );
  }

  const index = await loadJson(INDEX_FILE, []);
  console.log(`Loaded index (${index.length} brands).`);
  if (!index.length) throw new Error("index.json empty/unreadable — refusing to proceed.");

  const { augment, stats } = buildAugment({ sunshine, index });

  console.log("\nResults:");
  console.log(`  Sunshine-Act — alias matches:  ${stats.sunshine.alias}`);
  console.log(`  Sunshine-Act — strict matches: ${stats.sunshine.strict}`);
  console.log(`  Sunshine-Act — manufacturers matched: ${stats.sunshine.mfrsMatched} → ${stats.sunshineSlugs} slugs`);
  console.log(`  Sunshine-Act — orphan manufacturers:  ${stats.sunshine.orphan}`);
  console.log(`  Opioid settlement — matched: ${stats.opioidMatched}/${OPIOID_SETTLEMENTS.length}`);
  if (stats.opioidDropped.length) console.log(`    dropped (slug missing): ${stats.opioidDropped.join(", ")}`);
  if (stats.droppedAliases) console.log(`  Dropped aliases (slug missing): ${stats.droppedAliases}`);
  console.log(`  DISTINCT matched slugs (matchCount): ${stats.totalSlugs}`);

  // Examples — highest Sunshine-Act payment slugs + any opioid-only slugs.
  const ranked = Object.entries(augment)
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => (b.sunshineActPaymentsUsd || 0) - (a.sunshineActPaymentsUsd || 0));
  console.log("\n  Examples (slug → fields):");
  for (const r of ranked.slice(0, 8)) {
    const parts = [];
    if (r.sunshineActPaymentsUsd != null) parts.push(`sunshine=$${(r.sunshineActPaymentsUsd / 1e6).toFixed(1)}M (CY${r.sunshineActYear})`);
    if (r.opioidSettlementUsd != null) parts.push(`opioid=$${(r.opioidSettlementUsd / 1e9).toFixed(2)}B`);
    console.log(`    ${r.slug.padEnd(34)} ${parts.join("  ")}`);
  }
  if (stats.orphanSample.length) {
    console.log(`\n  Sample unmatched manufacturers (>$2M, not in index — expected, mostly private/B2B device cos):`);
    for (const o of stats.orphanSample) console.log(`    ${o}`);
  }

  const out = {
    _source: "CMS Open Payments (Sunshine Act) + National Opioid Settlement",
    _signals: {
      sunshineActPaymentsUsd: "Total CMS Open Payments general payments (manufacturer→physician) in the program year. Public domain.",
      opioidSettlementUsd: "Global national opioid settlement amount for the named defendant. Curated from nationalopioidofficialsettlement.com.",
    },
    _note: "Pharma/medical-device/retail-pharmacy conduct. STRICT matching (curated alias + exact normalized name) — a missing flag beats a wrong one.",
    sunshineActSourceUrl: OPENPAYMENTS_LANDING,
    opioidSettlementSourceUrl: OPIOID_LANDING,
    sunshineActYear: sunshine.year,
    generatedAt: new Date().toISOString(),
    matchCount: stats.totalSlugs,
    sunshineSlugCount: stats.sunshineSlugs,
    opioidSlugCount: stats.opioidMatched,
    ...augment,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)} (${stats.totalSlugs} slugs).`);
    console.log("  (Derived augment only — no company-file writes, no commits.)");
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("pharma-conduct-fetch failed:", err);
    process.exit(1);
  });
}

export { resolveManufacturer, strictVariants, buildAugment, OPIOID_SETTLEMENTS, SUNSHINE_ALIASES };
