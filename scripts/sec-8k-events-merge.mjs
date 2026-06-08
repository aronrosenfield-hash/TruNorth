#!/usr/bin/env node
/**
 * SEC 8-K Material Events — Step 2: merge the dated raw fetcher output
 * into an augment file keyed by TruNorth slug, then (optionally) into
 * the per-company JSON files under public/data/companies/.
 *
 * Reads the most recent file in data/raw/sec-8k-events/ and writes:
 *   data/derived/sec-8k-events-augment.json
 *
 * Augment shape:
 *   {
 *     _license, _source, _generated_at, _source_file, _stats,
 *     companies: {
 *       [slug]: {
 *         execPay: {
 *           recentExecDepartures: [
 *             { filingDate, role, action, personName, severanceDisclosed,
 *               sourceUrl }
 *           ],
 *           severanceDisclosed: boolean    // true if any departure
 *                                          // disclosed severance
 *         },
 *         governance: {
 *           recentRestatements: [
 *             { filingDate, periodsAffected, sourceUrl, excerpt }
 *           ]
 *         }
 *       }
 *     }
 *   }
 *
 * Slug resolution honors slug-aliases.json and brand-parent-map.json
 * (consistent with all other TruNorth augment mergers).
 *
 * Flags:
 *   --dry    (default) — only write data/derived/sec-8k-events-augment.json
 *                        (does NOT touch per-company files).
 *   --apply  — additionally merge into each matching company file and
 *              write a merge log under public/data/_meta/.
 *
 * Locally:
 *   node scripts/sec-8k-events-merge.mjs
 *   node scripts/sec-8k-events-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/sec-8k-events");
const DERIVED  = path.join(ROOT, "data/derived");
const AUGMENT  = path.join(DERIVED, "sec-8k-events-augment.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "sec-8k-events-merge-log.json");

const argv  = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

export function resolveSlug(slug, maps) {
  if (existsSync(path.join(COMP_DIR, `${slug}.json`))) {
    return { slug, routed_via: "direct" };
  }
  const alias = maps.aliases?.[slug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents?.[slug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

/**
 * Build the augment block for one company record. Returns
 *   { execPay: { recentExecDepartures, severanceDisclosed },
 *     governance: { recentRestatements } }
 * or null if the record has no events worth carrying.
 */
export function buildAugmentBlock(r) {
  const departures = Array.isArray(r.execDepartures) ? r.execDepartures : [];
  const restatements = Array.isArray(r.restatements) ? r.restatements : [];

  const recentExecDepartures = departures
    // Carry only departure-like actions; appointments are normal turnover.
    .filter(d => ["Resignation", "Termination", "Retirement", "Death", "Departure"].includes(d.action))
    .map(d => ({
      filingDate:        d.filingDate,
      role:              d.role,
      action:            d.action,
      personName:        d.personName ?? null,
      severanceDisclosed: !!d.severanceDisclosed,
      sourceUrl:         d.sourceUrl,
    }));

  const severanceDisclosed = recentExecDepartures.some(d => d.severanceDisclosed);

  const recentRestatements = restatements.map(x => ({
    filingDate:      x.filingDate,
    periodsAffected: x.periodsAffected || [],
    sourceUrl:       x.sourceUrl,
    excerpt:         x.excerpt,
  }));

  if (!recentExecDepartures.length && !recentRestatements.length) return null;

  return {
    execPay: {
      recentExecDepartures,
      severanceDisclosed,
    },
    governance: {
      recentRestatements,
    },
  };
}

async function findLatestRaw() {
  const files = (await fs.readdir(RAW_DIR).catch(() => []))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR} — run sec-8k-events-fetch.mjs --apply first.`);
  return path.join(RAW_DIR, files.at(-1));
}

async function main() {
  console.log(`SEC 8-K events merger — mode=${APPLY ? "APPLY" : "DRY"}`);
  const rawFile = await findLatestRaw();
  console.log(`Source: ${rawFile}`);
  const raw = JSON.parse(await fs.readFile(rawFile, "utf-8"));
  const records = Array.isArray(raw.companies) ? raw.companies : [];

  const maps = await loadMaps();
  const now = new Date().toISOString();
  const companies = {};
  const log = { generated: now, source_file: path.relative(ROOT, rawFile), entries: [] };

  let matched = 0, orphans = 0, skipped = 0;
  for (const r of records) {
    if (!r || r.status !== "ok") { skipped++; continue; }
    const { slug: target, routed_via } = resolveSlug(r.slug, maps);
    if (!target) {
      orphans++;
      log.entries.push({
        src: r.slug, status: "orphan", ticker: r.ticker,
        departures: r.execDepartures?.length ?? 0,
        restatements: r.restatements?.length ?? 0,
      });
      continue;
    }
    const block = buildAugmentBlock(r);
    if (!block) { skipped++; continue; }
    companies[target] = block;
    matched++;
    log.entries.push({
      src: r.slug, target, routed_via,
      ticker: r.ticker,
      departures: block.execPay.recentExecDepartures.length,
      restatements: block.governance.recentRestatements.length,
      severance: block.execPay.severanceDisclosed,
    });
  }

  await fs.mkdir(DERIVED, { recursive: true });

  // Compute top shaken cos = (# distinct severance/departure events) +
  // 3*(# restatements). A weighted heuristic for "shakiness."
  const topShaken = Object.entries(companies)
    .map(([slug, v]) => ({
      slug,
      departures: v.execPay.recentExecDepartures.length,
      restatements: v.governance.recentRestatements.length,
      severance: v.execPay.severanceDisclosed,
      score: v.execPay.recentExecDepartures.length + 3 * v.governance.recentRestatements.length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const totalDepartures = Object.values(companies)
    .reduce((s, v) => s + v.execPay.recentExecDepartures.length, 0);
  const totalRestatements = Object.values(companies)
    .reduce((s, v) => s + v.governance.recentRestatements.length, 0);

  const augment = {
    _license: "US public domain — SEC EDGAR",
    _source: "https://www.sec.gov/edgar",
    _generated_at: now,
    _source_file: path.relative(ROOT, rawFile),
    _stats: {
      raw_records: records.length,
      matched_companies: matched,
      orphan_count: orphans,
      skipped: skipped,
      total_departures: totalDepartures,
      total_restatements: totalRestatements,
      top_shaken: topShaken,
    },
    companies,
  };
  await fs.writeFile(AUGMENT, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${AUGMENT}: ${matched} matched, ${orphans} orphans, ${skipped} skipped.`);
  console.log(`  total exec departures: ${totalDepartures}`);
  console.log(`  total restatements:    ${totalRestatements}`);
  console.log("Top 10 most-shaken companies (departures + 3×restatements):");
  for (const t of topShaken) {
    console.log(`  ${String(t.score).padStart(3)}  ${t.slug}  (dep=${t.departures} rest=${t.restatements}${t.severance ? " sev" : ""})`);
  }

  if (!APPLY) {
    console.log("(dry) skipping per-company writes; pass --apply to enrich company files.");
    return;
  }

  // Apply pass: merge into each matching company file.
  await fs.mkdir(META_DIR, { recursive: true });
  let written = 0, missing = 0;
  for (const [slug, payload] of Object.entries(companies)) {
    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) { missing++; continue; }
    let company;
    try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch { missing++; continue; }
    if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
    // Merge into existing execPay / governance blocks rather than overwriting,
    // so we don't clobber data from sec-def14a-merge.
    if (!company.enriched.execPay || typeof company.enriched.execPay !== "object") {
      company.enriched.execPay = {};
    }
    company.enriched.execPay.recentExecDepartures = payload.execPay.recentExecDepartures;
    company.enriched.execPay.severanceDisclosed   = payload.execPay.severanceDisclosed;
    if (!company.enriched.governance || typeof company.enriched.governance !== "object") {
      company.enriched.governance = {};
    }
    company.enriched.governance.recentRestatements = payload.governance.recentRestatements;
    company.enriched.governance.lastUpdated = now;
    company.enriched.governance.source = "sec-8k-events";

    if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
      company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
    }
    company.dataLastUpdated.sec8kEvents = now;
    await fs.writeFile(file, JSON.stringify(company));
    written++;
  }
  log.applied = { written, missing };
  await fs.writeFile(LOG_FILE, JSON.stringify(log, null, 2));
  console.log(`Apply: wrote ${written} company files (${missing} missing). Log → ${LOG_FILE}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("Fatal:", e); process.exit(1); });
}
