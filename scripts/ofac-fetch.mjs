#!/usr/bin/env node
/**
 * Treasury OFAC sanctions integration (monthly)
 *
 * Downloads the full SDN (Specially Designated Nationals) list + the
 * Consolidated Sanctions List (which folds in SSI, FSE, NS-PLC, etc.) as
 * flat CSVs and checks each top-500 brand (and its known aliases) against
 * the resulting in-memory index.
 *
 * Unlike GSA SAM, OFAC publishes the entire list as a single CSV — so we
 * download ONCE, build an index, then do all 528 brand lookups in-process.
 * That removes the per-brand HTTP round-trip; the 1-req/sec budget only
 * applies to the (small handful of) CSV downloads themselves.
 *
 * Output: /public/data/ofac-sanctions.json (overwritten monthly)
 *
 * Data sources (all public, no API key):
 *   - SDN primary names:        https://www.treasury.gov/ofac/downloads/sdn.csv
 *   - SDN alternate names:      https://www.treasury.gov/ofac/downloads/alt.csv
 *   - Consolidated primary:     https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv
 *   - Consolidated alternates:  https://www.treasury.gov/ofac/downloads/consolidated/cons_alt.csv
 *
 * The SDN list has ~19k records; the Consolidated list adds ~3k more
 * (Sectoral Sanctions, Foreign Sanctions Evaders, Non-SDN Palestinian
 * Legislative Council, etc.). Almost all entries are individuals + shell
 * companies + vessels — US consumer brands essentially never appear. The
 * point of this integration is to *catch* a brand if it ever does.
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_sanctioned:        boolean (any entity-type match)
 *   - sanctioned_count:     total matches
 *   - sanctioned_programs:  unique program codes (e.g. CYBER2, NPWMD, UKRAINE-EO13660)
 *   - sample_records:       up to 5 matched records
 *
 * Title-match strategy mirrors gsa-sam-fetch.mjs: require the full brand
 * phrase to appear as a prefix of the OFAC name, with only known
 * corporate-suffix tokens trailing. Reject individuals + vessels (the
 * dominant noise classes for sanctions lists).
 *
 * Runs monthly via .github/workflows/ofac-monthly.yml
 * Locally: node scripts/ofac-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/ofac-sanctions.json");

const UA = "TruNorth-OFAC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;   // 1 req/sec per spec
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const SOURCES = [
  { key: "sdn_prim",  url: "https://www.treasury.gov/ofac/downloads/sdn.csv",                       kind: "primary"   },
  { key: "sdn_alt",   url: "https://www.treasury.gov/ofac/downloads/alt.csv",                       kind: "alternate" },
  { key: "cons_prim", url: "https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv",    kind: "primary"   },
  { key: "cons_alt",  url: "https://www.treasury.gov/ofac/downloads/consolidated/cons_alt.csv",     kind: "alternate" },
];

/* --------------------------------- brands --------------------------------- */

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

/* --------------------------------- CSV ----------------------------------- */
// OFAC CSV uses comma separators with quoted strings; empty cells are the
// literal "-0- " sentinel. Each row is one logical line, no embedded newlines
// in quotes in practice for these files.
function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
  }
  cells.push(cur);
  return cells.map(s => {
    const t = s.trim();
    return (t === "-0-" || t === "") ? null : t;
  });
}

async function fetchCsv(src) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(src.url, {
        headers: { "User-Agent": UA, "Accept": "text/csv, */*" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      await SLEEP(2000 * attempt);
    }
  }
}

/* ------------------------------ name index ------------------------------- */
// We normalize each OFAC name into tokens, then bucket each record by its
// FIRST non-stopword token. Brand lookup hits the matching bucket only —
// keeps the cross-product manageable (~19k records / ~5k first-tokens).

const STOPWORDS = new Set([
  "the","of","and","a","an","co","corp","corporation","inc","incorporated",
  "llc","ltd","limited","group","holdings","company","companies","brands",
]);

const CORP_SUFFIXES = new Set([
  "inc","incorporated","corp","corporation","co","company","companies",
  "llc","ltd","limited","lp","llp","group","holdings","plc","ag","sa",
  "nv","gmbh","kg","kk","bv","spa","srl","pte","pty","usa","us","na",
  "international","intl","worldwide","global","brands","industries",
]);

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function brandTokens(name) {
  return normalize(name).split(" ").filter(t => t && !STOPWORDS.has(t));
}

// Does this OFAC name match the brand phrase? Same rules as gsa-sam-fetch.
function nameMatches(brandName, ofacName) {
  const tokens = brandTokens(brandName);
  if (tokens.length === 0) return false;
  const t = normalize(ofacName);
  const phrase = tokens.join(" ");
  if (t === phrase) return true;
  const titleTokens = t.split(" ");
  const brandLen = tokens.length;
  if (titleTokens.length < brandLen) return false;
  for (let i = 0; i < brandLen; i++) {
    if (titleTokens[i] !== tokens[i]) return false;
  }
  for (let i = brandLen; i < titleTokens.length; i++) {
    if (!CORP_SUFFIXES.has(titleTokens[i])) return false;
  }
  return true;
}

/* ---------------------------- record parsing ----------------------------- */
// Primary list columns:
//   0 ent_num | 1 SDN_Name | 2 SDN_Type | 3 Program | 4 Title | 5 Call_Sign
//   6 Vess_type | 7 Tonnage | 8 GRT | 9 Vess_flag | 10 Vess_owner | 11 Remarks
//
// Alternate list columns:
//   0 ent_num | 1 alt_num | 2 alt_type | 3 alt_name | 4 alt_remarks

function buildIndex(sources) {
  // entityById: ent_num -> { ent_num, name, type, program, list_source, remarks, all_names: Set }
  const entityById = new Map();
  let primaryRows = 0;
  let altRows = 0;

  for (const { src, text } of sources) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells = parseCsvLine(line);
      const ent_num = cells[0];
      if (!ent_num) continue;

      if (src.kind === "primary") {
        primaryRows++;
        if (entityById.has(ent_num)) continue;   // first source wins (SDN preferred)
        const name = cells[1];
        const type = (cells[2] || "").toLowerCase();   // individual | -0- (entity) | vessel | aircraft
        const program = cells[3];
        if (!name) continue;
        entityById.set(ent_num, {
          ent_num,
          name,
          type: type || "entity",
          program: program || null,
          remarks: cells[11] || null,
          list_source: src.key,
          all_names: new Set([name]),
        });
      } else {
        altRows++;
        const altName = cells[3];
        if (!altName) continue;
        const ent = entityById.get(ent_num);
        if (!ent) continue;
        ent.all_names.add(altName);
      }
    }
  }

  // Build first-token bucket map: token -> [entity, entity, ...]
  const buckets = new Map();
  for (const ent of entityById.values()) {
    for (const nm of ent.all_names) {
      const toks = brandTokens(nm);
      if (toks.length === 0) continue;
      const key = toks[0];
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ entity: ent, matched_name: nm });
    }
  }

  return { entityById, buckets, stats: { entityCount: entityById.size, primaryRows, altRows } };
}

function lookup(brand, index) {
  const tokens = brandTokens(brand.name);
  if (tokens.length === 0) {
    return { status: "skipped_generic_name" };
  }
  const first = tokens[0];
  const bucket = index.buckets.get(first) || [];

  // De-duplicate: a single OFAC entity may match via primary + alt names.
  // Keep one row per ent_num, recording which name actually matched.
  const seen = new Map();
  for (const { entity, matched_name } of bucket) {
    if (!nameMatches(brand.name, matched_name)) continue;
    // Reject individuals + vessels + aircraft — keep entities only.
    const t = entity.type;
    if (t === "individual" || t === "vessel" || t === "aircraft") continue;
    if (seen.has(entity.ent_num)) continue;
    seen.set(entity.ent_num, { entity, matched_name });
  }

  if (seen.size === 0) return { status: "no_match" };

  const matches = [...seen.values()];
  const programs = new Set();
  for (const { entity } of matches) {
    if (entity.program) {
      for (const p of entity.program.split(/[;,]/).map(s => s.trim()).filter(Boolean)) {
        programs.add(p);
      }
    }
  }
  const sample = matches.slice(0, 5).map(({ entity, matched_name }) => ({
    ent_num:       entity.ent_num,
    name:          entity.name,
    matched_name,                    // which spelling actually matched (could be alias)
    type:          entity.type,
    program:       entity.program,
    list_source:   entity.list_source,
    remarks:       entity.remarks,
  }));

  return {
    status:              "ok",
    is_sanctioned:       true,
    sanctioned_count:    matches.length,
    sanctioned_programs: [...programs].sort(),
    sample_records:      sample,
  };
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  console.log("OFAC sanctions fetcher starting...");

  // Step 1: download all four CSVs (1 req/sec).
  const downloaded = [];
  for (const src of SOURCES) {
    console.log(`  Fetching ${src.key} (${src.url})`);
    const text = await fetchCsv(src);
    downloaded.push({ src, text });
    console.log(`    ${text.length.toLocaleString()} bytes`);
    await SLEEP(REQ_DELAY_MS);
  }

  // Step 2: build the in-memory index.
  console.log("Building index...");
  const index = buildIndex(downloaded);
  console.log(`  Entities indexed: ${index.stats.entityCount.toLocaleString()}`);
  console.log(`  Primary rows:     ${index.stats.primaryRows.toLocaleString()}`);
  console.log(`  Alternate rows:   ${index.stats.altRows.toLocaleString()}`);
  console.log(`  Bucket count:     ${index.buckets.size.toLocaleString()}`);

  // Step 3: check every brand.
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  const results = [];
  for (const brand of brands) {
    const out = lookup(brand, index);
    results.push({ slug: brand.slug, name: brand.name, ...out });
  }

  const matched   = results.filter(r => r.status === "ok");
  const noMatch   = results.filter(r => r.status === "no_match").length;
  const skipped   = results.filter(r => r.status === "skipped_generic_name").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date().toISOString(),
    source:              "Treasury OFAC SDN + Consolidated Sanctions Lists",
    source_urls:         SOURCES.map(s => s.url),
    entity_count:        index.stats.entityCount,
    brand_count:         brands.length,
    matched_count:       matched.length,
    no_match_count:      noMatch,
    skipped_count:       skipped,
    sanctions:           results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with any match:  ${matched.length}`);
  console.log(`   No-match brands:        ${noMatch}`);
  console.log(`   Skipped (generic name): ${skipped}`);
  if (matched.length > 0) {
    console.log("\nSanctioned brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- ${r.sanctioned_count} record(s) -- programs: ${r.sanctioned_programs.join(", ")}`);
    }
  }
}

main().catch(err => {
  console.error("ofac-fetch failed:", err);
  process.exit(1);
});
