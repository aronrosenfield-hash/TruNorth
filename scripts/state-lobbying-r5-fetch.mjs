#!/usr/bin/env node
/**
 * State lobbying (R5) — CA CalAccess + NY COELIG + TX Ethics + NYC eLobbyist.
 *
 * WHY this exists: federal LDA lobbying (already covered by
 * scripts/lobbying-merge.mjs / OpenSecrets) is only half the picture.
 * The four largest state/city lobbying markets — California, New York,
 * Texas, and NYC — each have their own public-records regimes that
 * regularly surface seven-figure annual spend per filer. Surfacing this
 * sub-federal layer is the point of R5 political-money coverage.
 *
 * Sources (per the R5 brief):
 *   1. CA CalAccess — https://calaccess.sos.ca.gov/Lobbying/Employers/
 *   2. NY COELIG via Open NY (Socrata) — https://opendata.ny.gov/ ;
 *      "Lobbying Bi-Monthly Reports".
 *   3. TX Ethics Commission lobby CSV — https://www.ethics.state.tx.us/data/search/lobby/
 *   4. NYC eLobbyist (Socrata) — https://data.cityofnewyork.us/
 *
 * ARCHITECTURE
 * ============
 * The default `node scripts/state-lobbying-r5-fetch.mjs` is SEEDS-ONLY.
 * It hydrates a curated mapping of ~50 known major corporate filers in
 * each jurisdiction (scripts/state-lobbying-r5-seeds.json) into the
 * augment file at data/derived/state-lobbying-r5-augment.json. This is
 * what the monthly cron runs by default — it cannot hang on a third-
 * party API and writes deterministic, source-cited output.
 *
 * The optional `--live` flag layers a Socrata call ON TOP of seeds, but
 * with HARD constraints to prevent the 13-hour hang that killed the
 * previous attempt:
 *
 *   • Per-source records cap:    500 (enforced via Socrata $limit=500)
 *   • Per-source request timeout: 60 seconds (AbortController)
 *   • $order= is ALWAYS supplied so the slice is deterministic
 *   • NEVER attempt a full-table download — no follow-up paging
 *
 * If any single live call fails or times out, the source is documented
 * as parked in the augment _meta block and the seed entries for that
 * jurisdiction are still emitted unchanged.
 *
 * OUTPUT SHAPE
 * ============
 * data/derived/state-lobbying-r5-augment.json:
 *
 *   {
 *     "_meta": { generated_at, version, sources_attempted, sources_parked, ... },
 *     "<slug>": {
 *       "political": {
 *         "state_lobbying_r5": {
 *           "total_usd_annual": number,
 *           "year": number,
 *           "jurisdictions": [
 *             { "code": "ca"|"ny"|"tx"|"nyc",
 *               "label": "CA CalAccess"|"NY COELIG"|"TX Ethics"|"NYC eLobbyist",
 *               "amount_usd": number,
 *               "year": number,
 *               "issues": ["retail","labor",...],
 *               "source_url": "https://..." }
 *           ],
 *           "top_issues": ["...","...","..."],
 *           "source": "state-lobbying-r5",
 *           "source_urls": [ ... ],
 *           "last_updated": ISO
 *         }
 *       }
 *     }
 *   }
 *
 * The writer in scripts/apply-augments-to-companies.mjs consumes this
 * via the standard augment loader (entry.political.state_lobbying_r5).
 *
 * USAGE
 *   node scripts/state-lobbying-r5-fetch.mjs              # seeds-only, default
 *   node scripts/state-lobbying-r5-fetch.mjs --live       # seeds + live Socrata
 *   node scripts/state-lobbying-r5-fetch.mjs --verbose    # log skipped slugs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SEEDS_FILE = path.join(__dirname, "state-lobbying-r5-seeds.json");
const OUT_FILE = path.join(ROOT, "data/derived/state-lobbying-r5-augment.json");

// HARD constraints — see the file header for rationale.
export const HARD_PER_SOURCE_RECORD_CAP = 500;
export const HARD_PER_SOURCE_TIMEOUT_MS = 60_000;

export const JURISDICTION_META = {
  ca:  { label: "CA CalAccess",  source_url: "https://calaccess.sos.ca.gov/Lobbying/Employers/" },
  ny:  { label: "NY COELIG",     source_url: "https://opendata.ny.gov/Government-Finance/Lobbying-Bi-Monthly-Reports/" },
  tx:  { label: "TX Ethics",     source_url: "https://www.ethics.state.tx.us/data/search/lobby/" },
  nyc: { label: "NYC eLobbyist", source_url: "https://data.cityofnewyork.us/City-Government/Lobbyist-Search/2vxx-r373" },
};

/** Pretty-print a USD figure for narratives. */
export function formatUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Collapse per-jurisdiction issue arrays into a top-3 list ordered by
 * cross-jurisdiction frequency (ties broken by dollar weight).
 */
export function topIssues(jurisdictionBlocks, limit = 3) {
  const freq = new Map(); // issue → { count, weight }
  for (const j of jurisdictionBlocks) {
    if (!Array.isArray(j.issues)) continue;
    for (const issue of j.issues) {
      const cur = freq.get(issue) || { count: 0, weight: 0 };
      cur.count += 1;
      cur.weight += j.amount_usd || 0;
      freq.set(issue, cur);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].weight - a[1].weight)
    .slice(0, limit)
    .map(([issue]) => issue);
}

/**
 * Convert one filer seed entry (1 slug, multiple jurisdictions) into an
 * augment block.
 */
export function buildAugmentBlock(filer, nowIso) {
  const jurisdictionBlocks = [];
  let totalUsd = 0;
  let mostRecentYear = 0;
  const sourceUrls = new Set();

  for (const code of Object.keys(JURISDICTION_META)) {
    const j = filer[code];
    if (!j || !Number.isFinite(j.amount_usd) || j.amount_usd <= 0) continue;
    const meta = JURISDICTION_META[code];
    jurisdictionBlocks.push({
      code,
      label: meta.label,
      amount_usd: j.amount_usd,
      year: j.year,
      issues: Array.isArray(j.issues) ? j.issues.slice(0, 5) : [],
      source_url: meta.source_url,
    });
    sourceUrls.add(meta.source_url);
    totalUsd += j.amount_usd;
    if (j.year && j.year > mostRecentYear) mostRecentYear = j.year;
  }

  if (!jurisdictionBlocks.length) return null;

  return {
    political: {
      state_lobbying_r5: {
        total_usd_annual: totalUsd,
        year: mostRecentYear || null,
        jurisdictions: jurisdictionBlocks,
        top_issues: topIssues(jurisdictionBlocks),
        source: "state-lobbying-r5",
        source_urls: [...sourceUrls],
        last_updated: nowIso,
        raw_name_matched: filer.raw_name,
      },
    },
  };
}

/**
 * Live Socrata helper. Pulls AT MOST `HARD_PER_SOURCE_RECORD_CAP` rows,
 * aborts after `HARD_PER_SOURCE_TIMEOUT_MS`, and ALWAYS includes both
 * $limit and $order for deterministic output. Returns [] on any failure
 * — the caller is responsible for recording the parked-state note.
 */
export async function fetchSocrataLive({ host, dataset, orderBy = ":id" }) {
  const url = new URL(`https://${host}/resource/${dataset}.json`);
  url.searchParams.set("$limit", String(HARD_PER_SOURCE_RECORD_CAP));
  url.searchParams.set("$order", orderBy);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HARD_PER_SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status, rows: [] };
    const rows = await res.json();
    if (!Array.isArray(rows)) return { ok: false, status: "non-array", rows: [] };
    return { ok: true, rows: rows.slice(0, HARD_PER_SOURCE_RECORD_CAP) };
  } catch (e) {
    return { ok: false, status: e?.name === "AbortError" ? "timeout" : (e?.message || "error"), rows: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const LIVE = args.includes("--live");
  const VERBOSE = args.includes("--verbose");
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();

  console.log(`state-lobbying-r5-fetch — ${LIVE ? "LIVE+seeds" : "seeds-only"}`);

  const seeds = JSON.parse(await fs.readFile(SEEDS_FILE, "utf8"));
  const filers = Array.isArray(seeds.filers) ? seeds.filers : [];
  console.log(`  loaded ${filers.length} seed filers`);

  const augment = {};
  let emitted = 0;
  for (const f of filers) {
    if (!f.slug) continue;
    const block = buildAugmentBlock(f, nowIso);
    if (!block) {
      if (VERBOSE) console.log(`  skip ${f.slug} (no jurisdiction blocks)`);
      continue;
    }
    augment[f.slug] = block;
    emitted++;
  }
  console.log(`  emitted ${emitted} slug blocks from seeds`);

  // Live layer is opt-in only — when --live is passed we attempt the
  // four Socrata endpoints with the hard 500-record / 60-second caps.
  // Any source that fails or times out is documented as parked. CA SOS
  // and TX Ethics are NOT Socrata, so they are flagged as parked-by-
  // design (we'd need a dedicated bulk-ZIP fetcher to hit them safely).
  const liveAttempts = {};
  const sourcesParked = [];
  if (LIVE) {
    console.log("\n--live: attempting Socrata pulls (cap 500 / timeout 60s each)");
    // NY COELIG bi-monthly reports — public dataset on Open NY (Socrata).
    // Dataset id 4ngd-qjyi is the canonical "Lobbying Bi-Monthly Reports"
    // ID at the time of writing; if it 404s we just note it as parked.
    liveAttempts.ny = await fetchSocrataLive({
      host: "data.ny.gov",
      dataset: "4ngd-qjyi",
      orderBy: ":id",
    });
    if (!liveAttempts.ny.ok) {
      sourcesParked.push({ code: "ny", reason: `socrata ${liveAttempts.ny.status}`, source_url: JURISDICTION_META.ny.source_url });
      console.log(`  NY parked: ${liveAttempts.ny.status}`);
    } else {
      console.log(`  NY live: ${liveAttempts.ny.rows.length} rows (capped at 500)`);
    }

    // NYC eLobbyist — Socrata dataset.
    liveAttempts.nyc = await fetchSocrataLive({
      host: "data.cityofnewyork.us",
      dataset: "fmf3-knd8",
      orderBy: ":id",
    });
    if (!liveAttempts.nyc.ok) {
      sourcesParked.push({ code: "nyc", reason: `socrata ${liveAttempts.nyc.status}`, source_url: JURISDICTION_META.nyc.source_url });
      console.log(`  NYC parked: ${liveAttempts.nyc.status}`);
    } else {
      console.log(`  NYC live: ${liveAttempts.nyc.rows.length} rows (capped at 500)`);
    }

    sourcesParked.push({
      code: "ca",
      reason: "CalAccess is not a Socrata endpoint — would need bulk-ZIP fetcher; seeds-only this run",
      source_url: JURISDICTION_META.ca.source_url,
    });
    sourcesParked.push({
      code: "tx",
      reason: "TX Ethics lobby data is published as multi-file CSV ZIPs (>250MB) — seeds-only this run",
      source_url: JURISDICTION_META.tx.source_url,
    });
    console.log("  CA + TX parked (bulk-ZIP endpoints; not Socrata-safe)");
  }

  // Compose the final augment with a _meta envelope. The slugs sit at
  // the top level so the existing augmentsLoaded()/entriesOf() machinery
  // (which filters _-prefixed keys) picks them up unchanged.
  const final = {
    _meta: {
      version: 1,
      generated_at: nowIso,
      runtime_ms: Date.now() - startedAt,
      mode: LIVE ? "live+seeds" : "seeds-only",
      hard_caps: {
        per_source_record_cap: HARD_PER_SOURCE_RECORD_CAP,
        per_source_timeout_ms: HARD_PER_SOURCE_TIMEOUT_MS,
      },
      sources_attempted: LIVE ? Object.keys(JURISDICTION_META) : [],
      sources_parked: sourcesParked,
      seed_filer_count: filers.length,
      emitted_slug_count: emitted,
      notes:
        "Curated-seed mapping of ~50 major corporate filers in CA / NY / TX / NYC. " +
        "Live Socrata layer is opt-in via --live with HARD 500-row / 60-sec caps. " +
        "Seeds-only is the safe default and what the monthly cron runs.",
    },
    ...augment,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(final, null, 2) + "\n");
  console.log(`\nwrote ${OUT_FILE} (${emitted} slugs, runtime ${Date.now() - startedAt}ms)`);
}

// Only run main() when invoked directly (so tests can import helpers).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error("state-lobbying-r5-fetch failed:", err); process.exit(1); });
}
