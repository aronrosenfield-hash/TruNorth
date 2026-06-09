#!/usr/bin/env node
/**
 * Wikidata mass-fetcher — resolve TruNorth brand names to Wikidata Q-IDs
 * via the Wikipedia API, then bulk-query structured properties via SPARQL.
 *
 * 56% of TruNorth's 11k brands have zero signals because the curated
 * regulators we ingest cover mostly public US filers + headline EU/UK
 * companies. Wikidata is the broadest open knowledge graph in existence,
 * with structured properties for every notable company on Earth — and a
 * permissive CC0 license. By probing the same name dictionary we already
 * use against Wikidata, we light up:
 *
 *   - P793  significant event   → controversies, recalls, scandals
 *   - P127  owned by            → parent / conglomerate exposure
 *   - P361  part of             → conglomerate exposure (alt encoding)
 *   - P1830 owner of            → subsidiaries (reverse-walk parent maps)
 *   - P463  member of           → industry coalitions, RTRS, RSPO, etc.
 *   - P166  award received      → honors, ESG certifications
 *   - P159  headquarters loc.   → country/state (HQ disclosure)
 *   - P3938 named after         → eponymous founders (privacy/disclosure)
 *   - P2002 Twitter handle      → entity verification
 *
 * Pipeline:
 *   1. Read public/data/index.json (11,261 brands).
 *   2. For each brand, hit Wikipedia's MediaWiki API to get its
 *      `wikibase_item` (Q-ID), redirect-resolved, with disambiguation
 *      detection. Cache title → Q-ID locally so re-runs are free.
 *   3. Group QIDs into batches of 50 and run a single SPARQL query
 *      per batch that fans out across all desired properties.
 *   4. Stream all answers into data/raw/wikidata/<YYYY-MM-DD>.json.
 *
 * Output is a flat list:
 *   {
 *     _license: "CC0 — Wikidata, https://www.wikidata.org",
 *     _generated_at: ISO,
 *     resolved_count, qid_count, claim_count,
 *     resolved: [{ slug, name, title, qid }],
 *     claims:   [{ qid, prop, label, value, valueLabel, negative }]
 *   }
 *
 * CLI:
 *   node scripts/wikidata-mass-fetch.mjs --limit 100         # first 100 brands
 *   node scripts/wikidata-mass-fetch.mjs --dry               # replay fixture
 *   node scripts/wikidata-mass-fetch.mjs --cache             # persist title→QID + SPARQL pages
 *   node scripts/wikidata-mass-fetch.mjs --out /tmp/x.json   # custom output
 *   node scripts/wikidata-mass-fetch.mjs --apply             # full live run (ALL brands)
 *
 * Rate limits:
 *   - Wikipedia API: 2 req/sec, 50 titles per batch (MW limit).
 *   - Wikidata SPARQL: 1 req/sec, 50 QIDs per query (well below the
 *     60s WDQS query timeout).
 *
 * License: Wikidata is CC0; we still tag the bundle for downstream clarity.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wikidata");
const CACHE_DIR = path.join(ROOT, ".cache/wikidata");
const FIXTURE = path.join(ROOT, "scripts/fixtures/wikidata/sample.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const SPARQL_API = "https://query.wikidata.org/sparql";
const UA = "TruNorth-Wikidata/1.0 (https://www.trunorthapp.com; aron@trunorthapp.com)";
const WIKIPEDIA_BATCH = 50;     // MW API max titles per request
const SPARQL_BATCH = 50;        // QIDs per SPARQL query
const WIKIPEDIA_RATE_MS = 500;  // 2 req/sec
const SPARQL_RATE_MS = 1000;    // 1 req/sec — well within WDQS budget
export const LICENSE = "CC0 — Wikidata, https://www.wikidata.org";

// Properties we extract. The `negative` flag pre-tags properties whose
// presence is generally an unfavorable signal (e.g. P793 = scandal, fine,
// breach). The merger uses this to set severity defaults.
export const PROPERTIES = [
  { prop: "P793",  label: "significant_event",   negative: true  },
  { prop: "P127",  label: "owned_by",            negative: false },
  { prop: "P361",  label: "part_of",             negative: false },
  { prop: "P1830", label: "owner_of",            negative: false },
  { prop: "P463",  label: "member_of",           negative: false },
  { prop: "P166",  label: "award_received",      negative: false },
  { prop: "P159",  label: "headquarters",        negative: false },
  { prop: "P3938", label: "named_after",         negative: false },
  { prop: "P2002", label: "twitter_handle",      negative: false },
];

// ─────────────────────────── CLI ────────────────────────────────────────
export function parseArgs(argv) {
  const args = { limit: null, out: null, cache: false, dry: false, apply: false, skip: 0, sort: "low-first" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 100);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--cache") args.cache = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--skip") args.skip = Math.max(0, Number(argv[++i]) || 0);
    // --sort=high-first means well-known brands (more signals) first; useful
    // for catching companies with P166 awards / P793 events that are
    // unlikely on the bottom-of-the-pile long-tail brands.
    else if (a === "--sort") args.sort = argv[++i];
  }
  return args;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────── name → query title ─────────────────────────
// The Wikipedia title-search heuristic. We don't pull from opensearch
// because that's expensive (5 hits / brand); we let MW redirect-resolve
// the brand name as a title directly and trust it. This works because
// most consumer brands ARE the canonical Wikipedia title (Nike → Nike,
// Patagonia → Patagonia, etc.) once we strip noise.
//
// Returns up to two candidates per brand (raw + disambig-suffixed),
// matching the API's title= parameter convention.
export function brandCandidates(name) {
  if (!name) return [];
  const clean = String(name)
    .replace(/^The\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const out = [clean];
  // Many consumer brands disambiguate with " (company)" or " (brand)" in WP.
  if (!/\(company\)|\(brand\)|\(retailer\)/i.test(clean)) {
    out.push(`${clean} (company)`);
  }
  return out;
}

// ─────────────────────────── Wikipedia API: title → QID ─────────────────
// One call resolves up to 50 titles. We send a pipe-joined batch with
// redirects=1 + ppprop=wikibase_item|disambiguation so the response is
// self-sufficient for our routing decision.
export function buildWikipediaUrl(titles) {
  const u = new URL(WIKIPEDIA_API);
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("prop", "pageprops");
  u.searchParams.set("titles", titles.join("|"));
  u.searchParams.set("redirects", "1");
  u.searchParams.set("ppprop", "wikibase_item|disambiguation");
  u.searchParams.set("formatversion", "2");
  return u.toString();
}

// Parse the MW response into a per-input map.
// One quirk: redirected titles arrive under different keys, so we follow
// the redirects array (capped at 1 hop per the project's hard rule) to
// find the source title.
export function parseWikipediaResponse(payload, inputTitles) {
  if (!payload?.query) return new Map();
  const redirects = new Map(
    (payload.query.redirects || []).map(r => [r.from, r.to])
  );
  const byTitle = new Map();
  for (const page of (payload.query.pages || [])) {
    if (page.missing) continue;
    const qid = page.pageprops?.wikibase_item || null;
    const disambig = page.pageprops?.disambiguation != null;
    byTitle.set(page.title, { title: page.title, qid, disambig });
  }
  // Resolve back: for each input title, follow at most 1 redirect.
  const result = new Map();
  for (const t of inputTitles) {
    let canon = t;
    if (redirects.has(canon)) canon = redirects.get(canon);
    const hit = byTitle.get(canon);
    if (hit) result.set(t, hit);
  }
  return result;
}

async function fetchJson(url, label) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return res.json();
}

// Chunked title resolution. Returns a Map<title, { title, qid, disambig }>.
export async function resolveBatch(titles, { cache } = {}) {
  if (!titles.length) return new Map();
  const cacheKey = path.join(CACHE_DIR, `wp_${titles.length}_${hashStr(titles.join("|"))}.json`);
  let payload;
  if (cache && existsSync(cacheKey)) {
    payload = JSON.parse(await fs.readFile(cacheKey, "utf-8"));
  } else {
    const url = buildWikipediaUrl(titles);
    payload = await fetchJson(url, "Wikipedia");
    if (cache) {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cacheKey, JSON.stringify(payload));
    }
  }
  return parseWikipediaResponse(payload, titles);
}

// Tiny non-crypto hash for stable cache keys.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ─────────────────────────── Wikidata SPARQL ────────────────────────────
// Build one query that fans out across every property in PROPERTIES.
// We let WDQS produce the Cartesian product across all OPTIONALs and then
// dedup post-hoc on (qid, prop, value).
export function buildSparql(qids) {
  const values = qids.map(q => `wd:${q}`).join(" ");
  const opts = PROPERTIES.map(p => `OPTIONAL { ?item wdt:${p.prop} ?${p.prop.toLowerCase()}. }`).join("\n  ");
  const selects = PROPERTIES.map(p => `?${p.prop.toLowerCase()} ?${p.prop.toLowerCase()}Label`).join(" ");
  return `
SELECT ?item ?itemLabel ${selects} WHERE {
  VALUES ?item { ${values} }
  ${opts}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5000
`.trim();
}

export function buildSparqlUrl(qids) {
  const u = new URL(SPARQL_API);
  u.searchParams.set("query", buildSparql(qids));
  u.searchParams.set("format", "json");
  return u.toString();
}

// Turn a SPARQL result-binding row into a flat list of claim records.
// Dedup by (qid, prop, value) since OPTIONALs produce duplicates.
export function flattenBindings(bindings) {
  const seen = new Set();
  const claims = [];
  for (const row of bindings) {
    const item = row.item?.value || "";
    const qid = item.replace("http://www.wikidata.org/entity/", "");
    if (!qid) continue;
    for (const p of PROPERTIES) {
      const key = p.prop.toLowerCase();
      const v = row[key]?.value;
      if (!v) continue;
      const valueLabel = row[`${key}Label`]?.value || null;
      const value = v.startsWith("http://www.wikidata.org/entity/")
        ? v.replace("http://www.wikidata.org/entity/", "")
        : v;
      const dedup = `${qid}|${p.prop}|${value}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      claims.push({
        qid, prop: p.prop, label: p.label, value, valueLabel,
        negative: p.negative,
      });
    }
  }
  return claims;
}

async function fetchSparql(qids, { cache }) {
  const url = buildSparqlUrl(qids);
  const cacheKey = path.join(CACHE_DIR, `sparql_${hashStr(qids.join(","))}.json`);
  let payload;
  if (cache && existsSync(cacheKey)) {
    payload = JSON.parse(await fs.readFile(cacheKey, "utf-8"));
  } else {
    payload = await fetchJson(url, "Wikidata SPARQL");
    if (cache) {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cacheKey, JSON.stringify(payload));
    }
  }
  return flattenBindings(payload?.results?.bindings || []);
}

// ─────────────────────────── chunker ────────────────────────────────────
export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ─────────────────────────── dry-run replay ─────────────────────────────
export async function replayFixture(fixturePath = FIXTURE) {
  return JSON.parse(await fs.readFile(fixturePath, "utf-8"));
}

// ─────────────────────────── runner ─────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);

  console.log(`Wikidata mass-fetcher starting...   (mode=${args.dry ? "DRY" : "LIVE"})`);
  console.log(`License: ${LICENSE}`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  if (args.dry) {
    const bundle = await replayFixture();
    await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
    console.log(`[dry] wrote ${outFile} with ${bundle.claims?.length || 0} fixture claims`);
    return;
  }

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  // Two sort strategies:
  //   "low-first"  (default) — brands with NO signals first (the whole
  //                            point: enrich the 6.3k zero-signal pool).
  //   "high-first"           — well-known brands first; catches the
  //                            rich Wikidata P166/P793 hits.
  const sorted = [...index].sort((a, b) =>
    args.sort === "high-first"
      ? (b.realCats || 0) - (a.realCats || 0)
      : (a.realCats || 0) - (b.realCats || 0)
  );
  const offset = args.skip;
  const cap = args.apply ? sorted.length : (args.limit ?? 100);
  const brands = sorted.slice(offset, offset + cap);
  console.log(`Resolving ${brands.length} brands → Wikidata Q-IDs (Wikipedia API)`);

  const resolved = [];
  let processed = 0;
  // Pack up to (WIKIPEDIA_BATCH/2) brands per request so we stay under 50
  // titles even when both " (company)" candidates fire.
  for (const batchBrands of chunk(brands, Math.floor(WIKIPEDIA_BATCH / 2))) {
    const titles = [];
    const seenT = new Set();
    for (const b of batchBrands) {
      for (const t of brandCandidates(b.name)) {
        if (!seenT.has(t)) { seenT.add(t); titles.push(t); }
      }
    }
    try {
      const hits = await resolveBatch(titles, { cache: args.cache });
      for (const b of batchBrands) {
        for (const t of brandCandidates(b.name)) {
          const hit = hits.get(t);
          if (hit && hit.qid && !hit.disambig) {
            resolved.push({ slug: b.slug, name: b.name, title: hit.title, qid: hit.qid });
            break;
          }
        }
      }
    } catch (e) {
      console.error(`  ! WP batch failed: ${e.message}`);
    }
    processed += batchBrands.length;
    if (processed % 500 === 0 || processed === brands.length) {
      console.log(`  Resolved ${processed}/${brands.length}  (${resolved.length} matched)`);
    }
    await sleep(WIKIPEDIA_RATE_MS);
  }
  console.log(`-> ${resolved.length} brands resolved to Q-IDs`);

  // ─── 2. SPARQL: pull claims in 50-QID chunks ─────────────────────────
  const qids = [...new Set(resolved.map(r => r.qid))];
  console.log(`\nQuerying ${qids.length} unique Q-IDs across ${PROPERTIES.length} properties (SPARQL)`);
  const allClaims = [];
  const sparqlChunks = chunk(qids, SPARQL_BATCH);
  let chunkIdx = 0;
  for (const c of sparqlChunks) {
    chunkIdx++;
    try {
      const claims = await fetchSparql(c, { cache: args.cache });
      allClaims.push(...claims);
      if (chunkIdx % 20 === 0 || chunkIdx === sparqlChunks.length) {
        console.log(`  SPARQL ${chunkIdx}/${sparqlChunks.length}: +${claims.length} (running: ${allClaims.length})`);
      }
    } catch (e) {
      console.error(`  ! SPARQL batch ${chunkIdx} failed: ${e.message}`);
    }
    await sleep(SPARQL_RATE_MS);
  }
  console.log(`-> ${allClaims.length} claims collected`);

  const bundle = {
    _license: LICENSE,
    _source: "https://www.wikidata.org",
    _generated_at: new Date().toISOString(),
    properties_queried: PROPERTIES,
    resolved_count: resolved.length,
    qid_count: qids.length,
    claim_count: allClaims.length,
    resolved,
    claims: allClaims,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nWrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("wikidata-mass-fetch failed:", e); process.exit(1); });
}
