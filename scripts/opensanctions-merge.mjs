#!/usr/bin/env node
/**
 * OpenSanctions — Merge filtered JSONL snapshot into a per-slug augment file.
 *
 * Input:  data/raw/opensanctions/<date>.jsonl  (produced by opensanctions-fetch.mjs)
 *         public/data/index.json               (canonical TruNorth brand index)
 *
 * Output: data/derived/opensanctions-augment.json
 *   {
 *     _generated_at: "...",
 *     _license: "CC-BY-NC 4.0 — OpenSanctions; ⚠️ TRIGGERED — paid Pro tier LIVE 2026-06-18, NC review open; do not merge into shipped product until resolved",
 *     _source: "https://www.opensanctions.org",
 *     _scanned: N,
 *     _matched_slugs: M,
 *     <slug>: {
 *       sanctions: [
 *         { program, programId, country, listedDate, sourceUrl, dataset, opensanctionsId, match: { kind, evidence } },
 *         ...
 *       ]
 *     }
 *   }
 *
 * MATCH RULES (high-confidence only):
 *   1. exact_normalized_name — brand.name normalized == any of entity.names
 *      normalized.
 *   2. wikidata_qid           — brand has wikidataId & matches entity.wikidataIds
 *   3. lei                    — brand has leiCode & matches entity.leiCodes
 *   4. sec_cik                — brand has secCik & matches entity.secCiks
 *
 * Substring / fuzzy matches are intentionally NOT supported — sanctions
 * false positives are very high cost. If a brand uses a generic word
 * (e.g. "Apple"), we'd hit dozens of unrelated sanctioned Apple-named
 * shell cos. Better to under-match.
 *
 * Locally:
 *   node scripts/opensanctions-merge.mjs                                # auto-pick newest JSONL
 *   node scripts/opensanctions-merge.mjs --jsonl /tmp/test.jsonl
 *   node scripts/opensanctions-merge.mjs --out /tmp/augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { createReadStream } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const RAW_DIR     = path.join(ROOT, "data/raw/opensanctions");
const DEFAULT_OUT = path.join(ROOT, "data/derived/opensanctions-augment.json");

/* --------------------------- name normalization --------------------------- */

const NAME_NOISE_TOKENS = new Set([
  "the","of","and","co","corp","corporation","inc","incorporated",
  "llc","ltd","limited","group","holdings","company","companies","brands",
  "plc","ag","sa","nv","gmbh","kg","kk","bv","spa","srl","pte","pty",
  "usa","us","na","international","intl","worldwide","global",
]);

/**
 * Canonicalize a company name for exact matching. Lowercases, strips
 * punctuation, drops corporate suffix noise. Output is space-separated
 * tokens with all noise tokens removed.
 */
export function normalizeName(s) {
  if (!s) return "";
  const lower = String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip diacritics
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!lower) return "";
  const tokens = lower.split(" ").filter(t => t && !NAME_NOISE_TOKENS.has(t));
  return tokens.join(" ");
}

/* --------------------------- index loading --------------------------- */

/**
 * Load the canonical brand index and build a lookup table keyed by
 * normalized name plus optional crosswalk identifiers. Brands without a
 * normalized name (e.g. emoji-only names) are skipped.
 */
export function buildBrandLookup(indexEntries) {
  const byNorm = new Map();         // norm -> [{slug, name}]
  const byWikidata = new Map();     // QID -> slug
  const byLei = new Map();          // LEI -> slug
  const bySecCik = new Map();       // CIK -> slug

  for (const e of indexEntries) {
    if (!e?.slug) continue;
    const norm = normalizeName(e.name || e.slug);
    if (norm) {
      if (!byNorm.has(norm)) byNorm.set(norm, []);
      byNorm.get(norm).push({ slug: e.slug, name: e.name });
    }
    if (e.wikidataId) byWikidata.set(String(e.wikidataId).toUpperCase(), e.slug);
    if (e.leiCode)    byLei.set(String(e.leiCode).toUpperCase(), e.slug);
    if (e.secCik)     bySecCik.set(String(e.secCik), e.slug);
  }
  return { byNorm, byWikidata, byLei, bySecCik };
}

/**
 * Try to resolve an OpenSanctions entity to a TruNorth brand slug. Returns
 * the highest-confidence match found, or null. Crosswalk identifiers beat
 * name matches because they're guaranteed unique.
 */
export function matchEntity(entity, lookup) {
  // 1. Wikidata QID (strongest signal)
  for (const qid of entity.wikidataIds || []) {
    const slug = lookup.byWikidata.get(String(qid).toUpperCase());
    if (slug) return { slug, kind: "wikidata_qid", evidence: qid };
  }
  // 2. LEI
  for (const lei of entity.leiCodes || []) {
    const slug = lookup.byLei.get(String(lei).toUpperCase());
    if (slug) return { slug, kind: "lei", evidence: lei };
  }
  // 3. SEC CIK
  for (const cik of entity.secCiks || []) {
    const slug = lookup.bySecCik.get(String(cik));
    if (slug) return { slug, kind: "sec_cik", evidence: cik };
  }
  // 4. Exact normalized name — REQUIRE >=2 tokens.
  //    Single-token brand names ("AMD", "SEA", "ABC", "Opera", "Interface",
  //    "Mercury", "Lithium", "Spectrum") collide with thousands of generic
  //    sanctioned-shell-co names worldwide. The cost of a false positive
  //    on a sanctions flag is enormous (we'd be telling users a household
  //    brand is sanctioned when only a same-named Iranian shell co is). So
  //    we drop multi-token matches as well unless 2+ name tokens align.
  for (const nm of entity.names || []) {
    const norm = normalizeName(nm);
    if (!norm) continue;
    if (norm.split(" ").length < 2) continue;   // single-token guard
    const hits = lookup.byNorm.get(norm);
    if (hits && hits.length === 1) {
      return { slug: hits[0].slug, kind: "exact_normalized_name", evidence: nm };
    }
    // Ambiguous (>1 brand normalizes the same way) — DO NOT guess. False
    // positives on sanctions are too damaging to take a coin flip on. Log
    // for human review in the merge metadata.
    if (hits && hits.length > 1) {
      return { slug: null, kind: "ambiguous_name", evidence: nm,
               candidates: hits.map(h => h.slug) };
    }
  }
  return null;
}

/* --------------------------- jsonl streaming --------------------------- */

async function* readJsonl(file) {
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    try { yield JSON.parse(line); }
    catch { /* skip malformed */ }
  }
}

async function newestJsonl(dir) {
  if (!existsSync(dir)) return null;
  const files = (await fs.readdir(dir))
    .filter(f => f.endsWith(".jsonl"))
    .sort();
  return files.length ? path.join(dir, files.at(-1)) : null;
}

/* --------------------------- args + main --------------------------- */

function parseArgs(argv) {
  const out = { jsonl: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--jsonl") out.jsonl = argv[++i];
    else if (a === "--out") out.outPath = argv[++i];
  }
  return out;
}

/**
 * Convert a matched entity into the per-slug record shape we ship in the
 * augment file. One OpenSanctions entity can be on multiple lists (EU
 * + UK + UN) — we emit one sanctions[] entry per dataset so the UI can
 * show which authorities have designated this brand.
 */
function buildSanctionRecords(entity, match, datasetCountryHint) {
  const country = (entity.countries && entity.countries[0]) || null;
  const programLabel =
    (entity.programs && entity.programs[0]) ||
    (entity.programIds && entity.programIds[0]) ||
    null;
  const programId = (entity.programIds && entity.programIds[0]) || null;
  const sourceUrl = (entity.sourceUrls && entity.sourceUrls[0]) || null;
  const listedDate = entity.first_seen || null;

  // De-duplicate by (dataset). One row per source list the entity is on.
  const datasets = entity.datasets && entity.datasets.length
    ? entity.datasets
    : ["sanctions"];
  return datasets.map(dataset => ({
    program: programLabel,
    programId,
    country,
    countryHint: datasetCountryHint(dataset),
    listedDate,
    sourceUrl,
    dataset,
    opensanctionsId: entity.id,
    match: { kind: match.kind, evidence: match.evidence },
  }));
}

// Best-effort jurisdiction guess from the OpenSanctions dataset slug.
// (Most datasets are named like `us_ofac_sdn`, `eu_fsf`, `uk_hmt`...)
function datasetCountryHint(dataset) {
  if (!dataset) return null;
  const lead = dataset.split("_")[0];
  const map = {
    us: "us", eu: "eu", uk: "gb", gb: "gb", ca: "ca", au: "au",
    jp: "jp", ch: "ch", ua: "ua", ru: "ru", il: "il", sg: "sg",
    nl: "nl", be: "be", fr: "fr", de: "de", it: "it", pl: "pl",
    nz: "nz", kr: "kr", za: "za", in: "in", mx: "mx", br: "br",
    un: "un",
  };
  return map[lead] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jsonlPath = args.jsonl
    ? path.resolve(args.jsonl)
    : await newestJsonl(RAW_DIR);
  if (!jsonlPath || !existsSync(jsonlPath)) {
    console.error(`No OpenSanctions JSONL snapshot found. Run scripts/opensanctions-fetch.mjs first, or pass --jsonl PATH.`);
    process.exit(2);
  }
  const outPath = args.outPath ? path.resolve(args.outPath) : DEFAULT_OUT;

  console.log(`OpenSanctions merge starting...`);
  console.log(`  jsonl: ${jsonlPath}`);
  console.log(`  index: ${INDEX_FILE}`);
  console.log(`  out:   ${outPath}`);

  const indexEntries = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  console.log(`Loaded ${indexEntries.length.toLocaleString()} brands from index.json`);

  const lookup = buildBrandLookup(indexEntries);
  const augment = {};        // slug -> { sanctions: [...] }
  const ambiguous = [];      // entries where normalized name matched 2+ brands
  let scanned = 0;
  let matched = 0;
  const matchKinds = {};

  for await (const entity of readJsonl(jsonlPath)) {
    scanned++;
    const m = matchEntity(entity, lookup);
    if (!m) continue;
    if (!m.slug) {
      ambiguous.push({ opensanctionsId: entity.id, name: m.evidence, candidates: m.candidates });
      continue;
    }
    matched++;
    matchKinds[m.kind] = (matchKinds[m.kind] || 0) + 1;
    if (!augment[m.slug]) augment[m.slug] = { sanctions: [] };
    augment[m.slug].sanctions.push(
      ...buildSanctionRecords(entity, m, datasetCountryHint)
    );
  }

  const matchedSlugs = Object.keys(augment).length;

  const output = {
    _generated_at: new Date().toISOString(),
    _license: "CC-BY-NC 4.0 — OpenSanctions; ⚠️ TRIGGERED — paid Pro tier LIVE 2026-06-18, NC review open; do not merge into shipped product until resolved",
    _source: "https://www.opensanctions.org",
    _source_dataset: "sanctions (consolidated)",
    _snapshot_file: path.relative(ROOT, jsonlPath),
    _scanned: scanned,
    _matched_entities: matched,
    _matched_slugs: matchedSlugs,
    _match_kind_counts: matchKinds,
    _ambiguous_name_count: ambiguous.length,
    ...augment,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nResults:`);
  console.log(`  scanned:        ${scanned.toLocaleString()}`);
  console.log(`  matched ents:   ${matched.toLocaleString()}`);
  console.log(`  matched slugs:  ${matchedSlugs.toLocaleString()}`);
  console.log(`  ambiguous:      ${ambiguous.length.toLocaleString()}`);
  console.log(`  match kinds:    ${JSON.stringify(matchKinds)}`);
  console.log(`\nWrote ${outPath}`);

  // If anyone matched, list them so it's loud in the CI log / PR review.
  if (matchedSlugs > 0) {
    console.log(`\nMatched brands:`);
    for (const [slug, v] of Object.entries(augment)) {
      const programs = [...new Set(v.sanctions.map(s => s.program).filter(Boolean))];
      const datasets = [...new Set(v.sanctions.map(s => s.dataset))];
      console.log(`  - ${slug.padEnd(28)} ${v.sanctions.length} record(s), datasets: [${datasets.join(", ")}], programs: [${programs.slice(0,3).join(", ")}]`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("opensanctions-merge failed:", err);
    process.exit(1);
  });
}
