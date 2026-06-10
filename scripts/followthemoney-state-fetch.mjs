#!/usr/bin/env node
/**
 * FollowTheMoney.org — state-level campaign-finance augment
 *
 * National Institute on Money in Politics (NIMP), hosted at
 * followthemoney.org. Covers all 50 states + DC. We already have
 * federal-level political $ via OpenSecrets + FEC; FTM is the
 * single-best public source for the per-STATE picture.
 *
 * License: NIMP free-use for non-commercial purposes; attribution
 * required. We display "FollowTheMoney.org / National Institute on Money
 * in Politics" in the political narrative and link back.
 *
 * ─── Pre-filtering rationale (CRITICAL — full corpus is multi-million rows) ───
 *
 *   FTM's "contributions" endpoint can return one row per contribution
 *   per state per cycle. Naively pulling everything is multi-GB and
 *   blows the GH Action budget. Strategy:
 *
 *   1. Pull AGGREGATE totals (gro=s — group by state) per known
 *      corporate donor entity. The aggregate endpoint returns
 *      donor-rolled totals already grouped by state and cycle, ~1KB
 *      per donor — orders of magnitude smaller than raw rows.
 *   2. Cycle window: last 4 years (2 election cycles) — same rationale
 *      as DIME. Older state donations don't move present-day brand
 *      signal.
 *   3. Seed the donor list from companies that already have political
 *      signal at the federal level. Walmart, Amazon, Apple etc. We do
 *      NOT cold-call FTM with 11,000 brand names — that would be both
 *      rude (rate-limit-wise) and noisy (FTM uses entity IDs, not
 *      company strings, so blind queries miss).
 *   4. Sort by total $ across all states, cap at TOP 1000 brands
 *      (hard cap from brief).
 *
 * ─── Output shape ────────────────────────────────────────────────────
 *
 *   data/derived/followthemoney-state-augment.json:
 *     {
 *       _license: "NIMP / FollowTheMoney.org — free non-commercial use",
 *       _source_url: "https://www.followthemoney.org",
 *       _api_url: "https://api.followthemoney.org",
 *       _generated_at: ISO,
 *       _cycle_window: "2022-2026",
 *       _dry_run: bool,
 *       _stats: { donors_queried, donors_with_data, states_seen, capped_to },
 *       companies: {
 *         "<slug>": {
 *           political: {
 *             totalUsd:        number,       // sum across all states
 *             stateCount:      number,       // # distinct states with $
 *             topStates: [                   // up to 5 by $ desc
 *               { state: "TX", usd: number, pctToDem: number, pctToRep: number },
 *               ...
 *             ],
 *             pctToDem:        number,       // 0..1 aggregate
 *             pctToRep:        number,
 *             lastCycleYear:   number,
 *             entityIds:       [string],     // FTM donor IDs
 *             sources:         [source_url],
 *           }
 *         }
 *       }
 *     }
 *
 * ─── Modes ───────────────────────────────────────────────────────────
 *
 *   --dry            (default) read test/fixtures/followthemoney-state/*.json
 *   --apply / --live call https://api.followthemoney.org/ with FTM_API_KEY
 *   --url <URL>      override API base URL (test or PR override)
 *   --limit N        cap final per-slug rows (after sort)
 *   --out <path>     override output path
 *
 * Cron: monthly via .github/workflows/followthemoney-state-monthly.yml.
 * FTM updates within 24-48h of state filings, and many states file
 * quarterly — monthly refresh keeps the augment near-fresh.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_OUT  = path.join(ROOT, "data/derived/followthemoney-state-augment.json");
const FIXTURE_DIR  = path.join(ROOT, "test/fixtures/followthemoney-state");
const COMP_DIR     = path.join(ROOT, "public/data/companies");
const META_DIR     = path.join(ROOT, "public/data/_meta");
const SEED_FILE    = path.join(__dirname, "followthemoney-state-seeds.json");

const SOURCE_URL = "https://www.followthemoney.org";
const DEFAULT_API_URL = "https://api.followthemoney.org/";
const UA = "TruNorth-FTM/1.0 (+https://www.trunorthapp.com)";

const HARD_CAP = 1000;
const PER_REQ_PAUSE_MS = 1100; // ~0.9 req/sec — well under typical 1/sec courtesy

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply") || argv.includes("--live");
const DRY = !APPLY;
const URL_ARG = (() => {
  const i = argv.indexOf("--url");
  return i >= 0 ? argv[i + 1] : null;
})();
const LIMIT_ARG = (() => {
  const i = argv.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(argv[i + 1]) || 0) || null : null;
})();
const OUT_FILE = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 ? path.resolve(argv[i + 1]) : DEFAULT_OUT;
})();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────── seed list ──────────────────────────────────
//
// A curated set of {slug, ftm_entity_ids, name, aliases} the fetcher
// walks through on --apply. Built once from FTM's donor-search and
// committed alongside the script (so the cron doesn't have to
// re-discover entity IDs every run). When the cron picks up new high-$
// donors, we add them here as a follow-up PR.
//
// Each entry can carry multiple FTM eid values (the same parent company
// often appears under several entity records — corporate PAC, employee
// donations, subsidiary names). We sum across them.

async function loadSeeds() {
  try {
    return JSON.parse(await fs.readFile(SEED_FILE, "utf-8"));
  } catch {
    return { donors: [] };
  }
}

// ─────────────────────── fixture & live loaders ─────────────────────

async function loadFixtureData() {
  // Fixture format is one JSON file per donor with the FTM aggregate response.
  const out = [];
  const files = await fs.readdir(FIXTURE_DIR);
  for (const f of files.filter(x => x.endsWith(".json"))) {
    const data = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, f), "utf-8"));
    out.push(data);
  }
  return out;
}

// FTM aggregate endpoint expected shape (we wrap the raw API response in
// our own envelope so the parser is uniform between fixture and live):
//   {
//     slug: "walmart",
//     name: "Walmart",
//     entity_id: "12345",
//     records: [
//       { state: "TX", cycle: 2024, total: 125000, dem: 30000, rep: 90000, other: 5000 },
//       ...
//     ]
//   }

async function fetchOneDonorLive(seed, apiUrl, apiKey) {
  // FTM aggregate-by-state endpoint:
  //   /?gro=s&y=YYYY&d-eid=<entity_id>&APIKey=<key>&mode=json
  // gro=s    → group by state
  // y=YYYY   → cycle year (we query the last 4)
  // d-eid    → donor entity id
  const minYear = new Date().getFullYear() - 4;
  const records = [];
  const eids = seed.ftm_entity_ids || [];
  for (const eid of eids) {
    for (let y = minYear; y <= new Date().getFullYear(); y++) {
      const url = new URL(apiUrl);
      url.searchParams.set("gro", "s");
      url.searchParams.set("dt", "1");          // contributions
      url.searchParams.set("y", String(y));
      url.searchParams.set("d-eid", String(eid));
      url.searchParams.set("APIKey", apiKey);
      url.searchParams.set("mode", "json");
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (!res.ok) {
          console.warn(`  ! FTM ${eid} y=${y} HTTP ${res.status}`);
          continue;
        }
        const data = await res.json();
        // FTM returns { records: [{ State_Name, Total_$, Dem_$, Rep_$, ... }] }
        // We normalize to our internal shape. Field names vary by endpoint
        // version — we accept several spellings.
        for (const r of data.records || data.results || []) {
          const stateAbbr = r.State_Code || r.state || r.State_Abbr || "";
          const total = parseFloat(r.Total_$ || r.Total_USD || r.total || r.amount || 0);
          const dem = parseFloat(r.Dem_$ || r.dem || r.democratic || 0);
          const rep = parseFloat(r.Rep_$ || r.rep || r.republican || 0);
          const other = Math.max(0, total - dem - rep);
          if (!stateAbbr || !Number.isFinite(total) || total <= 0) continue;
          records.push({ state: stateAbbr, cycle: y, total, dem, rep, other });
        }
      } catch (err) {
        console.warn(`  ! FTM ${eid} y=${y} ERROR ${err.message}`);
      }
      await sleep(PER_REQ_PAUSE_MS);
    }
  }
  return {
    slug: seed.slug,
    name: seed.name,
    entity_ids: eids,
    records,
  };
}

// ─────────────────────── slug resolution ────────────────────────────

async function loadMaps() {
  const tryLoad = async (full) => {
    try { return JSON.parse(await fs.readFile(full, "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad(path.join(META_DIR, "slug-aliases.json")),
    parents: await tryLoad(path.join(META_DIR, "brand-parent-map.json")),
  };
}

async function loadCompanySlugs() {
  const files = await fs.readdir(COMP_DIR);
  return new Set(files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)));
}

export function resolveSlug(rawSlug, { slugSet, aliases, parents }) {
  if (!rawSlug) return null;
  if (slugSet.has(rawSlug)) return { slug: rawSlug, method: "direct" };
  const alias = aliases?.[rawSlug];
  if (alias && slugSet.has(alias)) return { slug: alias, method: "alias" };
  const parent = parents?.[rawSlug]?.parent;
  if (parent && slugSet.has(parent)) return { slug: parent, method: "parent" };
  return null;
}

// ─────────────────────── aggregation ────────────────────────────────

export function aggregateDonor(donor) {
  let totalUsd = 0;
  let demUsd = 0;
  let repUsd = 0;
  let otherUsd = 0;
  let lastCycleYear = 0;
  const byState = new Map();
  for (const r of donor.records || []) {
    totalUsd += r.total;
    demUsd   += r.dem || 0;
    repUsd   += r.rep || 0;
    otherUsd += r.other || 0;
    if (r.cycle > lastCycleYear) lastCycleYear = r.cycle;
    let s = byState.get(r.state);
    if (!s) {
      s = { state: r.state, usd: 0, dem: 0, rep: 0 };
      byState.set(r.state, s);
    }
    s.usd += r.total;
    s.dem += r.dem || 0;
    s.rep += r.rep || 0;
  }
  const topStates = [...byState.values()]
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5)
    .map(s => ({
      state: s.state,
      usd: Math.round(s.usd),
      pctToDem: s.usd ? Math.round((s.dem / s.usd) * 1000) / 1000 : 0,
      pctToRep: s.usd ? Math.round((s.rep / s.usd) * 1000) / 1000 : 0,
    }));
  const denom = totalUsd || 1;
  return {
    totalUsd: Math.round(totalUsd),
    stateCount: byState.size,
    topStates,
    pctToDem: Math.round((demUsd / denom) * 1000) / 1000,
    pctToRep: Math.round((repUsd / denom) * 1000) / 1000,
    pctToOther: Math.round((otherUsd / denom) * 1000) / 1000,
    lastCycleYear,
    entityIds: donor.entity_ids || [],
    sources: [SOURCE_URL],
  };
}

// ─────────────────────── runner ─────────────────────────────────────

async function main() {
  console.log(`FollowTheMoney state augment — ${DRY ? "DRY (fixtures)" : "LIVE"}`);

  let donors;
  if (DRY) {
    donors = await loadFixtureData();
  } else {
    const apiKey = process.env.FTM_API_KEY;
    if (!apiKey) {
      console.error("--apply requires FTM_API_KEY env var.");
      console.error("Register at https://www.followthemoney.org/our-data/apis to request a key.");
      process.exit(1);
    }
    const apiUrl = URL_ARG || DEFAULT_API_URL;
    const seeds = (await loadSeeds()).donors || [];
    console.log(`Walking ${seeds.length} donor seeds against FTM API at ${apiUrl}...`);
    donors = [];
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      console.log(`  [${i + 1}/${seeds.length}] ${seed.slug}`);
      try {
        donors.push(await fetchOneDonorLive(seed, apiUrl, apiKey));
      } catch (err) {
        console.warn(`  ! ${seed.slug} fetch failed: ${err.message}`);
      }
    }
  }
  console.log(`Loaded ${donors.length} donor records`);

  const maps = await loadMaps();
  const slugSet = await loadCompanySlugs();

  // Coalesce by slug — multiple seeds (corporate PAC vs employee donations
  // vs subsidiaries) can map to the same parent slug.
  const bySlug = new Map();
  let withData = 0;
  let unmatched = 0;
  const statesSeen = new Set();

  for (const donor of donors) {
    const m = resolveSlug(donor.slug, {
      slugSet, aliases: maps.aliases, parents: maps.parents,
    });
    if (!m) { unmatched++; continue; }
    if (!(donor.records || []).length) continue;
    withData++;
    for (const r of donor.records || []) statesSeen.add(r.state);
    const existing = bySlug.get(m.slug);
    if (existing) {
      // Concatenate raw records so the aggregateDonor below sums correctly.
      existing.records.push(...donor.records);
      existing.entity_ids.push(...(donor.entity_ids || []));
    } else {
      bySlug.set(m.slug, {
        slug: m.slug,
        records: [...donor.records],
        entity_ids: [...(donor.entity_ids || [])],
      });
    }
  }

  // Sort by total $ across all states, hard-cap at top 1000.
  const aggs = [...bySlug.values()].map(d => ({
    slug: d.slug,
    block: aggregateDonor(d),
  }));
  aggs.sort((a, b) => b.block.totalUsd - a.block.totalUsd);
  const limit = LIMIT_ARG || HARD_CAP;
  const capped = aggs.slice(0, limit);

  const companies = {};
  for (const { slug, block } of capped) {
    companies[slug] = { political: block };
  }

  const now = new Date().toISOString();
  const cycleWindow = `${new Date().getFullYear() - 4}-${new Date().getFullYear()}`;
  const out = {
    _license: "NIMP / FollowTheMoney.org — free non-commercial use (attribution required)",
    _source_url: SOURCE_URL,
    _api_url: DEFAULT_API_URL,
    _generated_at: now,
    _cycle_window: cycleWindow,
    _dry_run: DRY,
    _stats: {
      donors_queried: donors.length,
      donors_with_data: withData,
      unmatched_slugs: unmatched,
      states_seen: statesSeen.size,
      capped_to: capped.length,
    },
    companies,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_FILE} — ${capped.length} slugs (cap ${limit})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("followthemoney-state-fetch failed:", err);
    process.exit(1);
  });
}
