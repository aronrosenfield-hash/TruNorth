#!/usr/bin/env node
/**
 * WikiRate — Step 1: Fetch aggregated answers for a curated list of
 * high-value ESG / labor / climate metrics across many companies.
 *
 * WikiRate (https://wikirate.org) is a volunteer-run open knowledge graph
 * that aggregates 8M+ datapoints across 150k+ companies from dozens of
 * academic / NGO benchmarks (Fashion Transparency Index, Clean Clothes
 * Campaign Living Wage Gap, KnowTheChain forced-labor scores, CDP climate
 * scores, Corporate Human Rights Benchmark, Break Free From Plastic, etc.)
 * and re-publishes the lot under CC BY 4.0 — the most permissive license
 * of any source we've evaluated. The license terms require attribution
 * back to WikiRate; this script bakes that attribution into the output
 * as the `_license` field so it follows the data through the pipeline.
 *
 * This is a metric-first paginator: rather than walking 11k companies
 * and asking each one what answers it has, we walk a curated handful of
 * high-signal metrics and paginate all answers for each. WikiRate's
 * data is sparse per company but dense per metric, so one full page of
 * "Fashion Transparency Index+Score" yields ~250 fashion brands in one
 * request instead of 250 separate company probes.
 *
 * API endpoint (documented at https://wikirate.org/Wikirate/api_documentation):
 *   GET https://wikirate.org/Wikirate.json
 *       ?metric_name=<Designer+Title>
 *       &view=answer_list
 *       &limit=<n>&offset=<n>
 *
 * Output:
 *   data/raw/wikirate/<YYYY-MM-DD>.json
 *
 * Standalone usage:
 *   node scripts/wikirate-fetch.mjs                                  # full curated list
 *   node scripts/wikirate-fetch.mjs --metric "Transparency Pledge"   # one metric
 *   node scripts/wikirate-fetch.mjs --limit 50 --out /tmp/test.json  # custom paging + path
 *   node scripts/wikirate-fetch.mjs --cache                          # cache raw pages under .cache/wikirate
 *   node scripts/wikirate-fetch.mjs --dry                            # offline: replay from fixture
 *
 * Constraints honored:
 *   - 1 req/sec courtesy throttle (WikiRate is volunteer-run; don't hammer).
 *   - 50k-answer total cap as a sanity guard.
 *   - Node 22 built-ins only (fetch, fs/promises). No deps.
 *   - License attribution baked into the output as `_license`.
 *
 * Runs via .github/workflows/wikirate-quarterly.yml on the 5th of
 * Jan/Apr/Jul/Oct at 05:30 UTC.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wikirate");
const CACHE_DIR = path.join(ROOT, ".cache/wikirate");
const FIXTURE = path.join(ROOT, "scripts/fixtures/wikirate/sample.json");

const API_BASE = "https://wikirate.org/Wikirate.json";
const UA = "TruNorth-WikiRate/1.0 (+https://www.trunorthapp.com; CC BY 4.0 attribution)";
const RATE_LIMIT_MS = 1000;   // 1 req/sec courtesy throttle
const DEFAULT_PAGE_SIZE = 100;
const SAFETY_CAP = 50_000;    // never fetch more than 50k answers per run
export const LICENSE = "CC BY 4.0 — WikiRate, https://wikirate.org";

// ─────────────────────────── curated metrics ────────────────────────────
// Each entry maps a TruNorth scoring "family" to the WikiRate metric_name
// parameter. metric_name uses "Designer+Title" syntax — Designer is the
// publisher card on WikiRate.
//
// The list is intentionally short and high-signal: every metric here is a
// recognized, peer-reviewed benchmark with a CC BY licence on WikiRate.
export const METRICS = [
  {
    family: "transparency",
    metric_name: "Fashion Transparency Index+Score",
    label: "Fashion Transparency Index",
    sourceUrl: "https://www.fashionrevolution.org/about/transparency/",
  },
  {
    family: "transparency",
    metric_name: "Transparency Pledge+Disclosure Score",
    label: "Transparency Pledge",
    sourceUrl: "https://transparencypledge.org/",
  },
  {
    family: "labor",
    metric_name: "Clean Clothes Campaign+Living Wage Gap",
    label: "Clean Clothes Campaign Living Wage Gap",
    sourceUrl: "https://cleanclothes.org/",
  },
  {
    family: "labor",
    metric_name: "KnowTheChain+Apparel Benchmark Score",
    label: "KnowTheChain Apparel",
    sourceUrl: "https://knowthechain.org/",
  },
  {
    family: "labor",
    metric_name: "KnowTheChain+ICT Benchmark Score",
    label: "KnowTheChain ICT",
    sourceUrl: "https://knowthechain.org/",
  },
  {
    family: "labor",
    metric_name: "KnowTheChain+Food and Beverage Benchmark Score",
    label: "KnowTheChain Food & Beverage",
    sourceUrl: "https://knowthechain.org/",
  },
  {
    family: "environment",
    metric_name: "CDP+Climate Change Score",
    label: "CDP Climate Change",
    sourceUrl: "https://www.cdp.net/",
  },
  {
    family: "governance",
    metric_name: "Corporate Human Rights Benchmark+Overall Score",
    label: "Corporate Human Rights Benchmark",
    sourceUrl: "https://www.worldbenchmarkingalliance.org/publication/chrb/",
  },
  {
    family: "environment",
    metric_name: "Break Free From Plastic+Brand Audit Count",
    label: "Break Free From Plastic Brand Audit",
    sourceUrl: "https://www.breakfreefromplastic.org/brandaudit/",
  },
];

// ─────────────────────────── CLI ────────────────────────────────────────
export function parseArgs(argv) {
  const args = { metric: null, limit: DEFAULT_PAGE_SIZE, out: null, cache: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--metric") args.metric = argv[++i];
    else if (a === "--limit") args.limit = Math.max(1, Math.min(200, Number(argv[++i]) || DEFAULT_PAGE_SIZE));
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--cache") args.cache = true;
    else if (a === "--dry") args.dry = true;
  }
  return args;
}

// ─────────────────────────── parsing ────────────────────────────────────
// The WikiRate Answer payload comes back as either { answer: [...] } (the
// answer_list view) or as a top-level array. Normalize both. Each row has
// at minimum metric/company/value; we drop rows missing any of those
// rather than emit null-valued rows downstream.
export function normalizeAnswerPayload(payload) {
  if (!payload) return [];
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.answer)
      ? payload.answer
      : Array.isArray(payload.items)
        ? payload.items
        : [];
  const rows = [];
  for (const r of arr) {
    if (!r) continue;
    const metric = r.metric ?? r.metric_name ?? null;
    const company = r.company ?? r.company_name ?? null;
    const value = r.value ?? r.content ?? r.answer ?? null;
    if (!metric || !company) continue;
    if (value === null || value === "" || value === undefined) continue;
    rows.push({
      id: r.id ?? null,
      metric: String(metric),
      company: String(company),
      year: r.year != null ? Number(r.year) : null,
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
      url: r.url ?? r.html_url ?? null,
    });
  }
  return rows;
}

// ─────────────────────────── network ────────────────────────────────────
export function buildUrl(metricName, limit, offset) {
  const u = new URL(API_BASE);
  u.searchParams.set("metric_name", metricName);
  u.searchParams.set("view", "answer_list");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  return u.toString();
}

async function fetchPage(metricName, limit, offset, { cache }) {
  const url = buildUrl(metricName, limit, offset);
  if (cache) {
    const key = `${metricName.replace(/[^a-z0-9]+/gi, "_")}_${offset}.json`;
    const file = path.join(CACHE_DIR, key);
    if (existsSync(file)) {
      return JSON.parse(await fs.readFile(file, "utf-8"));
    }
    const data = await fetchJson(url);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
    return data;
  }
  return fetchJson(url);
}

async function fetchJson(url) {
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  // Optional auth for CI — anonymous traffic from non-browser UAs may be
  // 403'd by WikiRate's Cloudflare in front of the API.
  if (process.env.WIKIRATE_API_KEY) headers["X-API-KEY"] = process.env.WIKIRATE_API_KEY;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`WikiRate ${res.status} for ${url}`);
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────── fetch one metric ──────────────────────────
export async function fetchMetric(metricEntry, { limit, cache, log = () => {} }) {
  const all = [];
  let offset = 0;
  let pageCount = 0;
  while (true) {
    if (all.length >= SAFETY_CAP) {
      log(`  (safety cap reached at ${SAFETY_CAP} answers)`);
      break;
    }
    pageCount++;
    const payload = await fetchPage(metricEntry.metric_name, limit, offset, { cache });
    const rows = normalizeAnswerPayload(payload);
    if (rows.length === 0) break;
    for (const row of rows) {
      // Tag every row with the family/label so the merger doesn't need to
      // re-derive them from the metric_name.
      all.push({
        ...row,
        family: metricEntry.family,
        label: metricEntry.label,
        sourceUrl: metricEntry.sourceUrl,
      });
      if (all.length >= SAFETY_CAP) break;
    }
    log(`  page ${pageCount}: +${rows.length} (running total: ${all.length})`);
    if (rows.length < limit) break;
    offset += limit;
    await sleep(RATE_LIMIT_MS);
  }
  return all;
}

// ─────────────────────────── dry-run replay ─────────────────────────────
// Replay the checked-in fixture as if it were the live API. Used by
// --dry and by the test suite.
export async function replayFixture(metricFilter, fixturePath = FIXTURE) {
  const payload = JSON.parse(await fs.readFile(fixturePath, "utf-8"));
  const rows = normalizeAnswerPayload(payload);
  const tagged = [];
  for (const r of rows) {
    // Match each row's metric to a curated entry — works whether the
    // metric came back as "Designer+Title" or just "Title".
    const entry = METRICS.find(m => r.metric === m.metric_name)
               ?? METRICS.find(m => r.metric.startsWith(m.metric_name.split("+")[0] + "+"))
               ?? METRICS.find(m => {
                    const title = m.metric_name.split("+")[1];
                    return title && r.metric.includes(title);
                  });
    if (!entry) continue;
    if (metricFilter && !entry.metric_name.toLowerCase().includes(metricFilter.toLowerCase())
                     && !entry.label.toLowerCase().includes(metricFilter.toLowerCase())) continue;
    tagged.push({ ...r, family: entry.family, label: entry.label, sourceUrl: entry.sourceUrl });
  }
  return tagged;
}

// ─────────────────────────── runner ─────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);

  console.log(`WikiRate fetcher starting... (mode=${args.dry ? "DRY (fixture)" : "LIVE"})`);
  console.log(`License: ${LICENSE}`);

  const metrics = args.metric
    ? METRICS.filter(m => m.metric_name.toLowerCase().includes(args.metric.toLowerCase())
                       || m.label.toLowerCase().includes(args.metric.toLowerCase()))
    : METRICS;

  if (metrics.length === 0) {
    console.error(`No metric matching "${args.metric}". Available:`);
    for (const m of METRICS) console.error(`  - ${m.label}  [${m.metric_name}]`);
    process.exit(2);
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });

  const allRows = [];
  if (args.dry) {
    const rows = await replayFixture(args.metric);
    console.log(`  [dry] replayed ${rows.length} rows from fixture`);
    allRows.push(...rows);
  } else {
    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      console.log(`\n[${i + 1}/${metrics.length}] ${m.label}  (${m.metric_name})`);
      try {
        const rows = await fetchMetric(m, { limit: args.limit, cache: args.cache, log: (s) => console.log(s) });
        console.log(`  -> ${rows.length} answers`);
        allRows.push(...rows);
      } catch (e) {
        console.error(`  ! failed: ${e.message}`);
      }
      if (i < metrics.length - 1) await sleep(RATE_LIMIT_MS);
      if (allRows.length >= SAFETY_CAP) {
        console.log(`(global safety cap ${SAFETY_CAP} reached; stopping)`);
        break;
      }
    }
  }

  // Output bundle. The `_license` field rides with the data through the
  // rest of the pipeline so downstream consumers cannot accidentally drop
  // the required CC BY 4.0 attribution.
  const bundle = {
    _license: LICENSE,
    _source: "https://wikirate.org",
    _api: API_BASE,
    generated_at: new Date().toISOString(),
    mode: args.dry ? "dry" : "live",
    metrics_requested: metrics.map(m => m.metric_name),
    answer_count: allRows.length,
    answers: allRows,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nWrote ${outFile}  (${allRows.length} answers)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("wikirate-fetch failed:", err);
    process.exit(1);
  });
}
