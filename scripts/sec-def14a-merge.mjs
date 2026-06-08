#!/usr/bin/env node
/**
 * SEC DEF14A — Step 2: Merge the dated raw fetcher output into an
 * augment file keyed by TruNorth slug, then (optionally) into the
 * per-company JSON files under public/data/companies/.
 *
 * Reads the most recent file in data/raw/sec-def14a/ and writes:
 *   data/derived/sec-def14a-augment.json
 *
 * Augment shape:
 *   {
 *     _license, _source, _generated_at, _source_file, _stats,
 *     companies: {
 *       [slug]: {
 *         execPay: {
 *           ceoName, ceoTotal, ceoBaseSalary, ceoBonus, ceoStockAwards,
 *           ceoOptionAwards, ceoNonEquityIncentive, ceoAllOtherComp,
 *           medianEmployeePay, payRatio,
 *           year, ticker, cik,
 *           filingDate, sourceUrl,
 *         }
 *       }
 *     }
 *   }
 *
 * Pay ratio = CEO total ÷ median employee pay. If the proxy disclosed an
 * authoritative ratio that wins; otherwise we compute it.
 *
 * Slug resolution honors slug-aliases.json and brand-parent-map.json
 * (consistent with all other TruNorth augment mergers). Records flagged
 * as error / no_def14a / no_cik / no_comp_table are skipped silently.
 *
 * Flags:
 *   --dry    (default) — only write data/derived/sec-def14a-augment.json
 *                        (does NOT touch per-company files).
 *   --apply  — additionally write enriched.execPay into each matching
 *              company file and a merge log under public/data/_meta/.
 *
 * Locally:
 *   node scripts/sec-def14a-merge.mjs
 *   node scripts/sec-def14a-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/sec-def14a");
const DERIVED    = path.join(ROOT, "data/derived");
const AUGMENT    = path.join(DERIVED, "sec-def14a-augment.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const LOG_FILE   = path.join(META_DIR, "sec-def14a-merge-log.json");

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

export function buildExecPayBlock(r) {
  // Authoritative ratio if disclosed; computed fallback if both pieces present.
  const computed = (r.ceoTotal && r.medianEmployeePay)
    ? Math.round((r.ceoTotal / r.medianEmployeePay) * 10) / 10
    : null;
  const payRatio = (r.payRatio != null && r.payRatio > 0) ? r.payRatio : computed;
  return {
    ceoName:               r.ceoName ?? null,
    ceoTotal:              r.ceoTotal ?? null,
    ceoBaseSalary:         r.ceoBaseSalary ?? null,
    ceoBonus:              r.ceoBonus ?? null,
    ceoStockAwards:        r.ceoStockAwards ?? null,
    ceoOptionAwards:       r.ceoOptionAwards ?? null,
    ceoNonEquityIncentive: r.ceoNonEquityIncentive ?? null,
    ceoAllOtherComp:       r.ceoAllOtherComp ?? null,
    medianEmployeePay:     r.medianEmployeePay ?? null,
    payRatio,
    year:                  r.year ?? null,
    ticker:                r.ticker ?? null,
    cik:                   r.cik ?? null,
    filingDate:            r.filingDate ?? null,
    sourceUrl:             r.sourceUrl ?? null,
  };
}

async function findLatestRaw() {
  const files = (await fs.readdir(RAW_DIR).catch(() => []))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) throw new Error(`No raw files in ${RAW_DIR} — run sec-def14a-fetch.mjs --apply first.`);
  return path.join(RAW_DIR, files.at(-1));
}

async function main() {
  console.log(`SEC DEF14A merger — mode=${APPLY ? "APPLY" : "DRY"}`);
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
      log.entries.push({ src: r.slug, status: "orphan", ticker: r.ticker, ceoTotal: r.ceoTotal });
      continue;
    }
    const block = buildExecPayBlock(r);
    // Skip if the block is entirely empty (defensive).
    if (block.ceoTotal == null && block.payRatio == null && block.medianEmployeePay == null) {
      skipped++; continue;
    }
    companies[target] = { execPay: block };
    matched++;
    log.entries.push({
      src: r.slug, target, routed_via,
      ticker: r.ticker, year: r.year,
      ceoTotal: r.ceoTotal, payRatio: block.payRatio,
    });
  }

  await fs.mkdir(DERIVED, { recursive: true });
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
    },
    companies,
  };
  await fs.writeFile(AUGMENT, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${AUGMENT}: ${matched} matched, ${orphans} orphans, ${skipped} skipped.`);

  // Top 10 CEO totals (sanity log).
  const top10 = Object.entries(companies)
    .map(([slug, v]) => ({ slug, ceoName: v.execPay.ceoName, ceoTotal: v.execPay.ceoTotal }))
    .filter(x => x.ceoTotal != null)
    .sort((a, b) => b.ceoTotal - a.ceoTotal)
    .slice(0, 10);
  console.log("Top 10 CEOs by total comp:");
  for (const t of top10) {
    const m = (t.ceoTotal / 1_000_000).toFixed(1);
    console.log(`  $${m}M  ${t.ceoName || "?"} (${t.slug})`);
  }

  if (!APPLY) {
    console.log("(dry) skipping per-company writes; pass --apply to enrich company files.");
    return;
  }

  // Apply pass: write enriched.execPay into each matching company file.
  await fs.mkdir(META_DIR, { recursive: true });
  let written = 0, missing = 0;
  for (const [slug, payload] of Object.entries(companies)) {
    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) { missing++; continue; }
    let company;
    try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch { missing++; continue; }
    if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};
    company.enriched.execPay = { ...payload.execPay, lastUpdated: now, source: "sec-def14a" };
    if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
      company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
    }
    company.dataLastUpdated.execPay = now;
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
