#!/usr/bin/env node
/**
 * Supply-chain ethics — US-government public records → TruNorth slugs.
 *
 * Combines TWO independent, license-clean US federal signals into ONE derived
 * augment keyed by TruNorth company slug:
 *
 *   (1) SEC Form SD — Conflict Minerals disclosures (Dodd-Frank §1502).
 *       Companies that manufacture (or contract to manufacture) products
 *       containing tin, tantalum, tungsten, or gold ("3TG") must file an annual
 *       Form SD describing their conflict-minerals due diligence. A company
 *       *being a filer* is the signal (Apple, Hasbro, Mattel, Intel, etc.).
 *       Pulled from SEC EDGAR full-text search (efts.sec.gov), which exposes
 *       each hit's `ciks` + `display_names`. US-government public-domain data.
 *       The API REQUIRES a descriptive User-Agent that includes a contact
 *       email; requests without one are blocked, so we always send one.
 *
 *   (2) DHS UFLPA Entity List — the Uyghur Forced Labor Prevention Act import
 *       ban list (~150 named entities, overwhelmingly China-based UPSTREAM
 *       suppliers, not consumer brands). Goods from these entities are presumed
 *       made with forced labor and barred from US import. Scraped from the
 *       public dhs.gov page. High signal where it maps to a US brand, but most
 *       entries are raw-material/component suppliers with no consumer-brand slug
 *       — those are recorded as `_unmappedUflpaEntities` metadata, NOT keyed.
 *
 * Output (DERIVED AUGMENT, keyed by slug):
 *   data/derived/supply-chain-augment.json
 *
 *   {
 *     _source, _signals, sourceUrls, generatedAt, lastUpdated,
 *     conflictMineralsFilerCount, uflpaListedCount,
 *     uflpaEntityCount, uflpaMappedCount,
 *     _unmappedUflpaEntities: [ { name, effectiveDate } ... ],
 *     <slug>: {
 *       conflictMineralsFiler: true,   // only present when true
 *       uflpaListed: true,             // only present when true
 *       uflpaEntities: ["..."],        // the matched UFLPA entity name(s)
 *       _sec: { cik, displayName },    // provenance for conflict-minerals hit
 *       lastUpdated: "ISO"
 *     }
 *   }
 *
 * Matching — STRICT, name-only:
 *   The brand index carries NO cik/ticker field (0 of ~12.8k entries), so we
 *   CANNOT CIK-match against the index. We reuse the ITEP normalizer
 *   (normalizeCompanyName) and the index/parent-map, but deliberately use
 *   STRICT name matching: only the FULL normalized name and a suffix-stripped
 *   full name are tried — NO bare 1-3-word prefixes. Bare prefixes over-collapse
 *   distinct companies onto the wrong slug; here MISSING beats WRONG.
 *   Conflict-minerals filer names are close to brand names (high match rate);
 *   UFLPA supplier names almost never are (low match rate, by design).
 *
 * Flags:
 *   --apply          — write data/derived/supply-chain-augment.json (else dry).
 *   --years N        — how many recent calendar-year filing seasons of Form SD
 *                      to sweep for the filer universe (default 1). Form SD for
 *                      fiscal year Y is filed in calendar Y+1, and the SEC FTS
 *                      reports the most recent season as ~1,864 filings — the
 *                      full active filer set — so one season suffices. Bump to
 *                      2-3 to union in entities that skipped the latest season.
 *   --cache          — reuse any raw snapshots already saved under
 *                      data/raw/supply-chain/ instead of re-hitting the network.
 *   --max-pages N    — safety cap on SEC FTS pages per year (default 25;
 *                      100 hits/page → 2,500 filings/year ceiling).
 *
 * NEVER writes public/data/companies/*.json. NEVER commits.
 *
 * Locally:
 *   node scripts/supply-chain-fetch.mjs            # dry-run, prints summary
 *   node scripts/supply-chain-fetch.mjs --apply    # write the augment
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeCompanyName } from "./itep-tax-fetch.mjs";
import { buildIndexLookup, matchViaParentMap } from "./itep-tax-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/supply-chain");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "supply-chain-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const SOURCE = "US federal supply-chain records (SEC Form SD + DHS UFLPA)";
const UA = "TruNorth/1.0 contact@trunorthapp.com";
const SEC_FTS = "https://efts.sec.gov/LATEST/search-index";
const SEC_LANDING = "https://www.sec.gov/cgi-bin/srqsb?text=conflict-minerals"; // doc ref only
const SEC_FORM_LANDING = "https://www.sec.gov/files/form-sd.pdf";
const UFLPA_URL = "https://www.dhs.gov/uflpa-entity-list";

const SEC_PAGE_SIZE = 100; // efts returns 100 hits/page
const SEC_MAX_FROM = 10000; // efts hard cap on the `from` offset

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const USE_CACHE = argv.includes("--cache");
const N_YEARS = (() => {
  const i = argv.indexOf("--years");
  return i >= 0 ? Math.max(1, Number(argv[i + 1]) || 1) : 1;
})();
const MAX_PAGES = (() => {
  const i = argv.indexOf("--max-pages");
  return i >= 0 ? Math.max(1, Number(argv[i + 1]) || 25) : 25;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A small curated bridge from UFLPA-listed upstream suppliers (or their
// parent conglomerates) to TruNorth brand slugs. Most UFLPA entities have NO
// consumer-brand presence in the index; this only lists the handful whose
// parent IS a recognizable brand we grade. Keys are matched case-insensitively
// as substrings of the UFLPA entity name. EMPTY by default is fine — better to
// record an unmapped entity than to invent a wrong brand link.
const UFLPA_BRAND_BRIDGE = [
  // e.g. { match: "cofco", slug: "cofco" }  // only if that slug exists in index
];

// ─────────────────────────── SEC Form SD ────────────────────────────

/**
 * Strip the EDGAR display-name decorations to a clean company name.
 *   "TIFFANY & CO  (CIK 0000098246)"            -> "TIFFANY & CO"
 *   "KOHLS Corp  (KSS)  (CIK 0000885639)"        -> "KOHLS Corp"
 *   "BK Technologies Corp  (BKTI)  (CIK ...)"    -> "BK Technologies Corp"
 *   "MATTEL INC /DE/  (MAT)  (CIK ...)"          -> "MATTEL INC"
 *
 * EDGAR appends the state/country of incorporation as a "/XX/" tag (e.g.
 * "/DE/", "/OH/", "/NEW/"). Left in, it normalizes to a stray token ("mattel
 * de") and breaks the name match, so we drop it. 38/1079 filers carry one.
 */
export function cleanDisplayName(dn) {
  if (!dn) return "";
  return String(dn)
    .replace(/\s*\(CIK\s*\d+\)\s*$/i, "")
    .replace(/\s*\([A-Z0-9.\-]{1,6}\)\s*$/, "") // trailing ticker, if any
    .replace(/\s*\/[A-Z]{2,4}\/\s*$/, "") // EDGAR state-of-incorporation tag
    .replace(/\s+/g, " ")
    .trim();
}

/** Recent calendar years, newest first. */
function recentYears(n) {
  const y = new Date().getUTCFullYear();
  // Form SD for fiscal year Y is filed by ~May of Y+1, so the most recently
  // *completed* filing season is last year. Start there and walk back.
  const out = [];
  for (let i = 1; i <= n; i++) out.push(y - i);
  return out;
}

// The SEC full-text search backend intermittently returns HTTP 500
// ({"message":"Internal server error"}) under load. Retry transient 5xx /
// 429 with exponential backoff before giving up.
async function fetchSecPage(year, from, attempt = 0) {
  const qs = new URLSearchParams({
    q: '"conflict minerals"',
    forms: "SD",
    startdt: `${year}-01-01`,
    enddt: `${year}-12-31`,
    from: String(from),
  });
  const url = `${SEC_FTS}?${qs.toString()}`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  } catch (e) {
    if (attempt < 4) { await sleep(800 * (attempt + 1)); return fetchSecPage(year, from, attempt + 1); }
    throw new Error(`SEC FTS network error (year=${year}, from=${from}): ${e.message}`);
  }
  if ((res.status >= 500 || res.status === 429) && attempt < 4) {
    await sleep(800 * (attempt + 1));
    return fetchSecPage(year, from, attempt + 1);
  }
  if (!res.ok) throw new Error(`SEC FTS HTTP ${res.status} (year=${year}, from=${from})`);
  const text = await res.text();
  if (!text || text.length < 50) {
    throw new Error(`SEC FTS empty body (year=${year}, from=${from}, ${text.length} bytes)`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`SEC FTS non-JSON (year=${year}, from=${from})`); }
  return json;
}

/**
 * Sweep Form SD filers for one calendar year, paging through efts and
 * collecting one record per CIK ({ cik, displayName }). Caches the merged
 * year result so --cache avoids re-hitting the network.
 */
async function fetchSecYear(year) {
  const cacheFile = path.join(RAW_DIR, `sec-form-sd.${year}.json`);
  if (USE_CACHE && existsSync(cacheFile)) {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
    console.log(`  [cache] Form SD ${year}: ${cached.filers.length} distinct CIKs`);
    return cached.filers;
  }

  const byCik = new Map(); // cik -> displayName (clean)
  let total = null;
  let from = 0;
  let page = 0;
  while (page < MAX_PAGES && from < SEC_MAX_FROM) {
    const json = await fetchSecPage(year, from);
    if (total == null) {
      total = json?.hits?.total?.value ?? 0;
      console.log(`  Form SD ${year}: total=${total} filings (${json?.hits?.total?.relation})`);
    }
    const hits = json?.hits?.hits || [];
    if (hits.length === 0) break;
    for (const h of hits) {
      const ciks = h?._source?.ciks || [];
      const names = h?._source?.display_names || [];
      for (let i = 0; i < ciks.length; i++) {
        const cik = String(ciks[i]).replace(/^0+/, "") || "0";
        const display = cleanDisplayName(names[i] || names[0] || "");
        if (!display) continue;
        if (!byCik.has(cik)) byCik.set(cik, display);
      }
    }
    page++;
    from += SEC_PAGE_SIZE;
    if (from >= (total ?? 0)) break;
    await sleep(180); // polite ~5 req/sec
  }

  const filers = [...byCik.entries()].map(([cik, displayName]) => ({ cik, displayName }));
  console.log(`  Form SD ${year}: collected ${filers.length} distinct CIKs over ${page} page(s)`);

  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify({ year, total, filers }, null, 2));
  return filers;
}

/** Build the de-duplicated conflict-minerals filer universe across N years. */
async function fetchConflictMineralsFilers() {
  console.log(`\nSEC Form SD conflict-minerals filers (last ${N_YEARS} year(s)) ...`);
  const byCik = new Map();
  for (const year of recentYears(N_YEARS)) {
    const filers = await fetchSecYear(year);
    for (const f of filers) {
      // Prefer the most-recent year's display name (first seen, newest-first).
      if (!byCik.has(f.cik)) byCik.set(f.cik, f.displayName);
    }
  }
  const universe = [...byCik.entries()].map(([cik, displayName]) => ({ cik, displayName }));
  console.log(`  → ${universe.length} distinct conflict-minerals filers (CIK-deduped).`);
  if (universe.length === 0) throw new Error("SEC Form SD sweep produced ZERO filers — refusing to write empty augment.");
  return universe;
}

// ─────────────────────────── DHS UFLPA ──────────────────────────────

async function fetchUflpaHtml() {
  const cacheFile = path.join(RAW_DIR, "uflpa-entity-list.html");
  if (USE_CACHE && existsSync(cacheFile)) {
    console.log("  [cache] UFLPA page");
    return fs.readFile(cacheFile, "utf-8");
  }
  const res = await fetch(UFLPA_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`UFLPA fetch HTTP ${res.status}`);
  const html = await res.text();
  if (!html || html.length < 5000) throw new Error(`UFLPA page suspiciously small (${html?.length} bytes)`);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(cacheFile, html);
  return html;
}

/**
 * Parse the UFLPA entity tables. The page renders the list as <table>s with
 * "Name of Entity" / "Effective Date" column pairs. We pull every <td>, treat
 * even cells as names and the following odd cell as the date, and keep rows
 * whose date column looks like a real date.
 */
export function parseUflpaEntities(html) {
  const tds = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const entities = [];
  for (let i = 0; i + 1 < tds.length; i += 2) {
    const name = tds[i];
    const date = tds[i + 1];
    if (!name) continue;
    if (!/\b(19|20)\d{2}\b/.test(date)) continue; // date column must carry a year
    entities.push({ name, effectiveDate: date });
  }
  return entities;
}

async function fetchUflpa() {
  console.log("\nDHS UFLPA Entity List ...");
  const html = await fetchUflpaHtml();
  const entities = parseUflpaEntities(html);
  console.log(`  Parsed ${entities.length} named UFLPA entities.`);
  if (entities.length === 0) throw new Error("UFLPA parse produced ZERO entities — refusing to write empty augment.");
  return entities;
}

// ─────────────────────────── matching ───────────────────────────────

// Suffix tokens to strip for the second STRICT variant: entity-form words and
// a few jurisdiction/share-class tokens that legal names carry but slugs do not.
// NB: "group"/"the"/"holdings" are intentionally NOT stripped here — stripping
// them collapses distinctive names onto a bare generic token (e.g. "Camel Group
// Co Ltd" → "camel", which would wrongly collide with the Camel cigarette brand
// → R.J. Reynolds). MISSING beats WRONG.
const SUFFIX_RE =
  /\b(inc|incorporated|corp|corporation|co|company|companies|cos|ltd|limited|llc|lp|llp|plc|sa|nv|ag|se|gmbh|kgaa|spa|ab|oyj|asa|class a|class b)\b/g;

/**
 * STRICT name variants: ONLY the full normalized name and a suffix-stripped
 * full name. Deliberately NO bare 1-3-word prefixes (those over-collapse).
 * The suffix-stripped variant is kept ONLY if it remains multi-word — a name
 * that collapses to a single bare token is NOT auto-matched, because a lone
 * generic word collides far too easily across a 12.8k-brand index.
 */
export function strictVariants(name) {
  const base = normalizeCompanyName(name);
  const out = new Set();
  if (base) out.add(base);
  const stripped = base.replace(SUFFIX_RE, " ").replace(/\s+/g, " ").trim();
  if (stripped && stripped !== base && stripped.split(" ").length >= 2) {
    out.add(stripped);
  }
  return [...out];
}

/**
 * Index match: try the STRICT variants against the index name→slug map.
 * Single-token matches here are SAFE — a key exists in `byName` ONLY because a
 * real index entry's own name normalized to exactly that token (e.g. "ALTRIA
 * GROUP, INC."→"altria", "YETI Holdings, Inc."→"yeti"). This is identity, not a
 * coincidental prefix, so no extra single-token guard is needed.
 */
export function strictMatchIndex(name, byName) {
  for (const v of strictVariants(name)) {
    const hit = byName.get(v);
    if (hit) return hit;
  }
  return null;
}

/**
 * Parent-map fallback. CRITICAL: parent-map keys are sub-brand words (e.g.
 * "camel"→R.J. Reynolds, "dove"→Unilever, "axe"→...). A multi-word supplier
 * legal name can collapse via normalizeCompanyName to one such bare token and
 * then wrongly inherit that consumer brand's parent — exactly the "Camel Group
 * Co., Ltd." (battery maker) → "camel" → R.J. Reynolds Tobacco trap. So we
 * REFUSE single-token candidates here; only a multi-word variant may match the
 * parent-map. MISSING beats WRONG.
 */
export function strictMatchParent(name, parentMap) {
  if (!parentMap || typeof parentMap !== "object") return null;
  for (const v of strictVariants(name)) {
    if (!v.includes(" ")) continue; // never parent-map a bare single token
    const key = v.replace(/\s+/g, "-");
    if (key.length < 3) continue;
    const entry = parentMap[key];
    if (entry && entry.parent) return entry.parent;
  }
  return null;
}

function resolveSlug(name, byName, parentMap) {
  let slug = strictMatchIndex(name, byName);
  if (slug) return { slug, route: "direct" };
  slug = strictMatchParent(name, parentMap);
  if (slug) return { slug, route: "parent" };
  return { slug: null, route: "orphan" };
}

// ─────────────────────────── merge ──────────────────────────────────

export function buildAugment({ filers, uflpaEntities, index, parentMap, indexSlugs, now }) {
  const byName = buildIndexLookup(index);
  const augment = {};
  const stats = {
    cmDirect: 0,
    cmParent: 0,
    cmOrphan: 0,
    uflpaMapped: 0,
    uflpaUnmapped: 0,
  };

  // (1) Conflict-minerals filers.
  for (const f of filers) {
    const { slug, route } = resolveSlug(f.displayName, byName, parentMap);
    if (!slug) { stats.cmOrphan++; continue; }
    if (route === "direct") stats.cmDirect++; else stats.cmParent++;
    const cur = augment[slug] || {};
    cur.conflictMineralsFiler = true;
    // Keep provenance from the first filer that mapped to this slug.
    if (!cur._sec) cur._sec = { cik: f.cik, displayName: f.displayName };
    augment[slug] = cur;
  }

  // (2) UFLPA entities. Try the explicit bridge first, then strict name match.
  const unmapped = [];
  for (const e of uflpaEntities) {
    let slug = null;
    const lc = e.name.toLowerCase();
    for (const b of UFLPA_BRAND_BRIDGE) {
      if (lc.includes(b.match) && indexSlugs.has(b.slug)) { slug = b.slug; break; }
    }
    if (!slug) {
      const r = resolveSlug(e.name, byName, parentMap);
      slug = r.slug;
    }
    if (!slug) { stats.uflpaUnmapped++; unmapped.push({ name: e.name, effectiveDate: e.effectiveDate }); continue; }
    stats.uflpaMapped++;
    const cur = augment[slug] || {};
    cur.uflpaListed = true;
    cur.uflpaEntities = cur.uflpaEntities || [];
    if (!cur.uflpaEntities.includes(e.name)) cur.uflpaEntities.push(e.name);
    augment[slug] = cur;
  }

  // Stamp lastUpdated on every keyed slug.
  for (const slug of Object.keys(augment)) augment[slug].lastUpdated = now;

  return { augment, stats, unmapped };
}

async function loadJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

// ─────────────────────────── main ───────────────────────────────────

async function main() {
  console.log(`supply-chain fetch starting... (mode=${APPLY ? "APPLY" : "DRY"}, years=${N_YEARS}, cache=${USE_CACHE})`);

  const filers = await fetchConflictMineralsFilers();
  const uflpaEntities = await fetchUflpa();

  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  if (!Array.isArray(index) || index.length === 0) {
    throw new Error("index.json missing/empty — cannot match.");
  }
  const indexSlugs = new Set(index.map((e) => e.slug));
  console.log(`\nLoaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).`);

  const now = new Date().toISOString();
  const { augment, stats, unmapped } = buildAugment({
    filers,
    uflpaEntities,
    index,
    parentMap,
    indexSlugs,
    now,
  });

  const cmSlugs = Object.values(augment).filter((v) => v.conflictMineralsFiler).length;
  const uflpaSlugs = Object.values(augment).filter((v) => v.uflpaListed).length;
  const matchCount = Object.keys(augment).length;

  console.log("\nResults:");
  console.log(`  Conflict-minerals filers (universe): ${filers.length}`);
  console.log(`    → matched to slugs (direct):       ${stats.cmDirect}`);
  console.log(`    → matched to slugs (parent-map):   ${stats.cmParent}`);
  console.log(`    → orphans (no slug):               ${stats.cmOrphan}`);
  console.log(`  UFLPA entities (named):              ${uflpaEntities.length}`);
  console.log(`    → mapped to a brand slug:          ${stats.uflpaMapped}`);
  console.log(`    → unmapped (recorded as metadata): ${stats.uflpaUnmapped}`);
  console.log(`  ── augment totals ──`);
  console.log(`  slugs with conflictMineralsFiler:    ${cmSlugs}`);
  console.log(`  slugs with uflpaListed:              ${uflpaSlugs}`);
  console.log(`  DISTINCT matched slugs (matchCount): ${matchCount}`);

  // Examples.
  const examples = Object.entries(augment).slice(0, 8).map(([slug, v]) => {
    const tags = [
      v.conflictMineralsFiler ? "conflictMineralsFiler" : null,
      v.uflpaListed ? "uflpaListed" : null,
    ].filter(Boolean).join("+");
    const prov = v._sec ? ` (${v._sec.displayName}, CIK ${v._sec.cik})` : "";
    return `    ${slug.padEnd(24)} ${tags}${prov}`;
  });
  if (examples.length) {
    console.log("\n  Examples (slug → flags):");
    console.log(examples.join("\n"));
  }
  if (unmapped.length) {
    console.log(`\n  First 5 UNMAPPED UFLPA entities (recorded in _unmappedUflpaEntities):`);
    for (const u of unmapped.slice(0, 5)) console.log(`    - ${u.name}`);
  }

  const out = {
    _source: SOURCE,
    _signals: {
      conflictMineralsFiler:
        "Company files an SEC Form SD conflict-minerals (3TG) disclosure (Dodd-Frank §1502). Named SEC filer.",
      uflpaListed:
        "Entity (or its mapped brand) appears on the DHS UFLPA Entity List — goods presumed made with Uyghur forced labor, barred from US import.",
    },
    sourceUrls: {
      conflictMinerals: SEC_FTS,
      conflictMineralsForm: SEC_FORM_LANDING,
      uflpa: UFLPA_URL,
    },
    generatedAt: now,
    lastUpdated: now,
    conflictMineralsFilerUniverse: filers.length,
    conflictMineralsFilerCount: cmSlugs,
    uflpaEntityCount: uflpaEntities.length,
    uflpaMappedCount: stats.uflpaMapped,
    uflpaListedCount: uflpaSlugs,
    matchCount,
    orphanCount: stats.cmOrphan,
    _unmappedUflpaEntities: unmapped,
    ...augment,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)} (${matchCount} slugs).`);
    console.log("  (Derived augment only — no company-file writes, no commits.)");
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("supply-chain-fetch failed:", err);
    process.exit(1);
  });
}
