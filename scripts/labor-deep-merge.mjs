#!/usr/bin/env node
/**
 * Labor-deep merger (round 4).
 *
 * Reads the latest data/raw/labor-deep/<date>.json snapshot, slug-resolves
 * each brand-named record through the 3-tier (direct → alias → parent)
 * lookup that every other merger uses, and writes FIVE per-source augment
 * files under data/derived/:
 *
 *   - fair-labor-association-augment.json   (refreshed from live FLA roster)
 *   - wrc-investigations-augment.json       (NEW)
 *   - ccc-transparency-pledge-augment.json  (NEW)
 *   - hrw-corporate-augment.json            (NEW)
 *   - ilrf-campaigns-augment.json           (NEW)
 *
 * Why split rather than one big augment? The downstream writer in
 * scripts/apply-augments-to-companies.mjs maps ONE writer per source name
 * (so it can label provenance correctly + apply the right sc enum). Keeping
 * one augment per source keeps that mapping straightforward and lets
 * future maintainers swap any sub-source independently.
 *
 * FLA augment shape is preserved-compatible with the existing
 * fair-labor-association-augment.json so the SUPPLY_CHAIN_SOURCES code
 * path that reads `_raw.score` / `affiliateSince` keeps working.
 *
 * Locally:
 *   node scripts/labor-deep-merge.mjs
 *   node scripts/labor-deep-merge.mjs --apply       # alias for default behaviour
 *   node scripts/labor-deep-merge.mjs --dry         # no file writes; logs only
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/labor-deep");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");

const OUT_FLA  = path.join(DERIVED_DIR, "fair-labor-association-augment.json");
const OUT_WRC  = path.join(DERIVED_DIR, "wrc-investigations-augment.json");
const OUT_CCC  = path.join(DERIVED_DIR, "ccc-transparency-pledge-augment.json");
const OUT_HRW  = path.join(DERIVED_DIR, "hrw-corporate-augment.json");
const OUT_ILRF = path.join(DERIVED_DIR, "ilrf-campaigns-augment.json");

const NOW = new Date().toISOString();

/* ------------------------------------------------------------- args */

export function parseArgs(argv) {
  return {
    dry: argv.includes("--dry"),
    apply: argv.includes("--apply") || !argv.includes("--dry"),
  };
}

/* --------------------------------------------------- slug + maps */

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(
      /[,\s]+(?:inc|incorporated|llc|l\.l\.c\.|llp|ltd|corp|corporation|company|co)\.?\s*$/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  return {
    aliases: await tryReadJson(path.join(META_DIR, "slug-aliases.json")) || {},
    parents: await tryReadJson(path.join(META_DIR, "brand-parent-map.json")) || {},
  };
}

/**
 * 3-tier: direct → alias → parent. Returns { slug, routed_via } or
 * { slug: null, routed_via: "orphan" }.
 */
export function resolveSlug(name, maps) {
  const direct = slugify(name);
  if (!direct) return { slug: null, routed_via: "orphan" };
  if (existsSync(path.join(COMP_DIR, `${direct}.json`))) {
    return { slug: direct, routed_via: "direct" };
  }
  const alias = maps.aliases[direct];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[direct]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

async function latestRawFile() {
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

/* ---------------------------------------------- FLA augment build */

/**
 * Build the FLA augment from the (live or bundled) member roster. Output
 * shape preserved-compatible with the prior augment so existing readers
 * keep working — { source_url, citation, company_count, companies: { slug:
 * { affiliateSince?, status, raw_type, source_url } } }.
 */
export function buildFlaAugment(flaRows, maps, opts = {}) {
  const companies = {};
  const orphans = [];
  let routing = { direct: 0, alias: 0, parent: 0, orphan: 0 };
  // Precedence so a higher-tier status wins over a weaker one when the same
  // slug receives multiple hits (e.g. a parent-routed "accredited" beats a
  // direct "participating" sub-brand — keep the most informative entry).
  const RANK = {
    "accredited": 0, "participating": 1, "single-factory-supplier": 2,
    "affiliate": 3, "collegiate-licensee": 4, "member": 5,
  };
  for (const r of flaRows) {
    if (r.category !== "company") continue; // skip universities + CSOs
    const { slug, routed_via } = resolveSlug(r.name, maps);
    if (!slug) {
      orphans.push({ name: r.name, status: r.status });
      routing.orphan++;
      continue;
    }
    routing[routed_via]++;
    const incoming = {
      status: r.status,
      raw_type: r.raw_type,
      source_url: r.source_url,
      routedVia: routed_via,
      memberName: r.name,
    };
    if (!companies[slug]) {
      companies[slug] = incoming;
    } else {
      const existing = companies[slug];
      if ((RANK[incoming.status] ?? 9) < (RANK[existing.status] ?? 9)) {
        companies[slug] = incoming;
      }
    }
  }
  return {
    generated_at: NOW,
    source: "fair-labor-association",
    source_url: "https://www.fairlabor.org/members/",
    citation: "Fair Labor Association — affiliated company roster.",
    company_count: Object.keys(companies).length,
    fla_signal: "positive",
    routing_counts: routing,
    orphan_count: orphans.length,
    orphans: orphans.slice(0, 500),
    fetch_mode: opts.fetched ? "live-rest-api" : "bundled-fallback",
    companies,
  };
}

/* -------------------- per-source augment builders (WRC/CCC/HRW/ILRF) */

/**
 * Generic builder for the negative / positive callout sources. Records are
 * grouped per slug as { findings: [...], count, sourceUrl, signal }.
 */
function buildCalloutAugment({ rows, maps, sourceName, sourceUrl, signal, keys }) {
  const companies = {};
  const orphans = [];
  let routing = { direct: 0, alias: 0, parent: 0, orphan: 0 };
  for (const r of rows) {
    const name = r.brand || r.name || r.company;
    const { slug, routed_via } = resolveSlug(name, maps);
    if (!slug) { orphans.push({ name, ...keys.orphanFields?.(r) }); routing.orphan++; continue; }
    routing[routed_via]++;
    if (!companies[slug]) {
      companies[slug] = {
        labor: {
          [keys.bucketName]: [],
          count: 0,
          sourceUrl,
          signal,
        },
        routedVia: routed_via,
        contributingBrands: new Set(),
        lastUpdated: NOW,
      };
    }
    const c = companies[slug];
    c.labor[keys.bucketName].push(keys.payload(r));
    c.labor.count = c.labor[keys.bucketName].length;
    c.contributingBrands.add(name);
    const RANK = { direct: 0, alias: 1, parent: 2 };
    if (RANK[routed_via] < RANK[c.routedVia]) c.routedVia = routed_via;
  }
  // Serialize sets.
  for (const s of Object.keys(companies)) {
    companies[s].contributingBrands = [...companies[s].contributingBrands];
  }
  return {
    _license: keys.license || "Aggregated under fair-use — record cites the primary public source URL.",
    _source: sourceName,
    _source_url: sourceUrl,
    _signal: signal,
    _generated_at: NOW,
    _routing_counts: routing,
    _orphan_count: orphans.length,
    _stats: {
      matched_companies: Object.keys(companies).length,
      total_records: Object.values(companies).reduce((a, c) => a + c.labor.count, 0),
    },
    companies,
    orphans: orphans.slice(0, 500),
  };
}

export function buildWrcAugment(rows, maps) {
  return buildCalloutAugment({
    rows, maps,
    sourceName: "wrc-investigations",
    sourceUrl: "https://www.workersrights.org/factory-investigations/",
    signal: "negative",
    keys: {
      bucketName: "wrcInvestigations",
      license: "WRC content — cite Worker Rights Consortium investigation URL on display.",
      payload: (r) => ({
        factory: r.factory || null,
        country: r.country || null,
        year: r.year || null,
        finding: r.finding || null,
        source_url: r.source_url || null,
        severity: r.severity || "negative",
      }),
    },
  });
}

export function buildCccAugment(rows, maps) {
  return buildCalloutAugment({
    rows, maps,
    sourceName: "ccc-transparency-pledge",
    sourceUrl: "https://cleanclothes.org/transparency",
    signal: "positive",
    keys: {
      bucketName: "transparencyPledge",
      license: "Clean Clothes Campaign — Transparency Pledge signatory roster, public.",
      payload: (r) => ({
        signed_year: r.pledge_signed_year || r.year || null,
        source_url: r.source_url || null,
      }),
    },
  });
}

export function buildHrwAugment(rows, maps) {
  return buildCalloutAugment({
    rows, maps,
    sourceName: "hrw-corporate",
    sourceUrl: "https://www.hrw.org/business",
    signal: "negative",
    keys: {
      bucketName: "hrwReports",
      license: "Human Rights Watch content — cite specific HRW report URL on display.",
      payload: (r) => ({
        year: r.year || null,
        title: r.title || null,
        source_url: r.source_url || null,
        severity: r.severity || "negative",
      }),
    },
  });
}

export function buildIlrfAugment(rows, maps) {
  return buildCalloutAugment({
    rows, maps,
    sourceName: "ilrf-campaigns",
    sourceUrl: "https://laborrights.org/",
    signal: "negative",
    keys: {
      bucketName: "ilrfCampaigns",
      license: "ILRF (International Labor Rights Forum) — public campaign reporting.",
      payload: (r) => ({
        year: r.year || null,
        campaign: r.campaign || null,
        source_url: r.source_url || null,
        severity: r.severity || "negative",
      }),
    },
  });
}

/* -------------------------------------------------------- main */

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  console.log(`labor-deep merge starting (dry=${opt.dry})`);

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run scripts/labor-deep-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Malformed snapshot: ${rawFile}`); process.exit(2); }
  console.log(`Loaded ${path.relative(ROOT, rawFile)}`);

  const maps = await loadMaps();

  const fla  = buildFlaAugment(raw.fla_members || [], maps, { fetched: raw._sources?.fla?.fetched });
  const wrc  = buildWrcAugment(raw.wrc_findings || [], maps);
  const ccc  = buildCccAugment(raw.ccc_signatories || [], maps);
  const hrw  = buildHrwAugment(raw.hrw_reports || [], maps);
  const ilrf = buildIlrfAugment(raw.ilrf_campaigns || [], maps);

  console.log(`\nFair Labor Assoc:     ${fla.company_count} brands matched (orphans=${fla.orphan_count}, routing=${JSON.stringify(fla.routing_counts)})`);
  console.log(`WRC investigations:   ${wrc._stats.matched_companies} brands (orphans=${wrc._orphan_count})`);
  console.log(`CCC Transparency:     ${ccc._stats.matched_companies} brands (orphans=${ccc._orphan_count})`);
  console.log(`HRW corporate:        ${hrw._stats.matched_companies} brands (orphans=${hrw._orphan_count})`);
  console.log(`ILRF campaigns:       ${ilrf._stats.matched_companies} brands (orphans=${ilrf._orphan_count})`);

  if (opt.dry) {
    console.log("\n(--dry — no files written)");
    return;
  }

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  await fs.writeFile(OUT_FLA,  JSON.stringify(fla,  null, 2));
  await fs.writeFile(OUT_WRC,  JSON.stringify(wrc,  null, 2));
  await fs.writeFile(OUT_CCC,  JSON.stringify(ccc,  null, 2));
  await fs.writeFile(OUT_HRW,  JSON.stringify(hrw,  null, 2));
  await fs.writeFile(OUT_ILRF, JSON.stringify(ilrf, null, 2));

  console.log(`\nWrote:`);
  console.log(`  ${path.relative(ROOT, OUT_FLA)}`);
  console.log(`  ${path.relative(ROOT, OUT_WRC)}`);
  console.log(`  ${path.relative(ROOT, OUT_CCC)}`);
  console.log(`  ${path.relative(ROOT, OUT_HRW)}`);
  console.log(`  ${path.relative(ROOT, OUT_ILRF)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error("labor-deep-merge failed:", err); process.exit(1); });
}
