#!/usr/bin/env node
/**
 * EU consolidated sanctions list integration (monthly)
 *
 * Downloads the European Union's Financial Sanctions consolidated list
 * (published by DG FISMA via the Financial Sanctions Database / FSD) and
 * checks each top-500 brand against the resulting in-memory index.
 *
 * Mirrors scripts/ofac-fetch.mjs: download once, build an index, then run
 * all 528 brand lookups in-process. The 1-req/sec budget only applies to
 * the (small handful of) source downloads themselves.
 *
 * Output: /public/data/eu-sanctions.json (overwritten monthly)
 *
 * Data sources (all public, no API key):
 *   - EU consolidated (XML):  https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw
 *   - EU consolidated (JSON): https://webgate.ec.europa.eu/fsd/fsf/public/files/jsonFullSanctionsList/content?token=dG9rZW4tMjAxNw
 *
 * The EU list folds together every CFSP regime (Russia, Belarus, Iran,
 * Syria, DPRK, terrorism, etc.) -- ~3-4k entities, mostly individuals,
 * shell companies, and government-linked outfits. US consumer brands
 * essentially never appear. The point is to *catch* a brand if it ever
 * does.
 *
 * Per-brand aggregate (only emitted when at least one match found):
 *   - is_eu_sanctioned:    boolean (any entity-type match)
 *   - eu_sanction_count:   total matches
 *   - eu_sanction_programs: unique CFSP regime / regulation codes
 *   - sample_records:      up to 5 matched records
 *
 * Title-match strategy mirrors ofac-fetch.mjs: require the full brand
 * phrase to appear as a prefix of the EU name, with only known
 * corporate-suffix tokens trailing. Reject individuals (the dominant
 * noise class for the EU list).
 *
 * Runs monthly via .github/workflows/eu-sanctions-monthly.yml
 * Locally: node scripts/eu-sanctions-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/eu-sanctions.json");

const UA = "TruNorth-EU-Sanctions/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;   // 1 req/sec per spec
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

// The EU FSD publishes the consolidated list under a stable public token
// ("dG9rZW4tMjAxNw" = base64 "token-2017"). Both XML and JSON variants are
// the same dataset; we prefer JSON for parsing simplicity but fall back to
// XML if JSON is unavailable in a given month.
const SOURCES = [
  {
    key:  "eu_consolidated_json",
    url:  "https://webgate.ec.europa.eu/fsd/fsf/public/files/jsonFullSanctionsList/content?token=dG9rZW4tMjAxNw",
    kind: "json",
    accept: "application/json, */*",
  },
  {
    key:  "eu_consolidated_xml",
    url:  "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw",
    kind: "xml",
    accept: "application/xml, text/xml, */*",
  },
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

/* --------------------------------- fetch --------------------------------- */

async function fetchSource(src) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(src.url, {
        headers: { "User-Agent": UA, "Accept": src.accept },
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

/* ------------------------------ parsing --------------------------------- */
// We accept either JSON or XML. Both formats represent the same data:
//   - Entity: <sanctionEntity> with type ATTR ("P" = person, "E" = entity)
//   - Names:  <nameAlias> children (whole name strings, sometimes split into
//             first/middle/last/wholeName parts)
//   - Regulation/programme: <regulation> attrs (programme, publicationDate,
//                           regulationType, publicationUrl)
//
// For each EU entity we produce { ent_id, name, type, programs, all_names,
// remarks }. `type` is normalised to "individual" | "entity".

function flattenEntitiesFromJson(json) {
  // The EU FSD JSON wraps entries in either { sanctionEntity: [...] } or
  // { exportSanctionsList: { sanctionEntity: [...] } }. Walk defensively.
  const out = [];
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (typeof node !== "object") return;
    if (node.sanctionEntity) {
      const arr = Array.isArray(node.sanctionEntity) ? node.sanctionEntity : [node.sanctionEntity];
      for (const e of arr) out.push(e);
    }
    for (const k of Object.keys(node)) {
      if (k === "sanctionEntity") continue;
      walk(node[k]);
    }
  }
  walk(json);
  return out;
}

function entityFromJson(raw, idx) {
  const ent_id = String(
    raw.logicalId ?? raw["@_logicalId"] ?? raw.id ?? raw["@_id"] ?? `eu-${idx}`,
  );
  const subjectType =
    raw.subjectType?.code ?? raw.subjectType?.["@_code"] ??
    raw["@_subjectType"] ?? "";
  const type = String(subjectType).toUpperCase().startsWith("P") ? "individual" : "entity";

  const aliases = [];
  const aliasNode = raw.nameAlias ?? raw.nameAliases ?? [];
  const aliasArr = Array.isArray(aliasNode) ? aliasNode : [aliasNode];
  for (const a of aliasArr) {
    if (!a) continue;
    const whole = a.wholeName ?? a["@_wholeName"] ??
                  [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ").trim();
    if (whole) aliases.push(String(whole));
  }

  const programs = new Set();
  const regNode = raw.regulation ?? raw.regulations ?? [];
  const regArr = Array.isArray(regNode) ? regNode : [regNode];
  for (const r of regArr) {
    if (!r) continue;
    const prog = r.programme ?? r["@_programme"] ?? r.regulationType ?? r["@_regulationType"];
    if (prog) programs.add(String(prog));
  }

  const remarks = raw.remark ?? raw["@_remark"] ?? null;

  if (aliases.length === 0) return null;
  return {
    ent_id,
    name: aliases[0],
    type,
    programs: [...programs],
    remarks: remarks ? String(remarks) : null,
    all_names: new Set(aliases),
    list_source: "eu_consolidated",
  };
}

// Minimal XML walker -- we only need <sanctionEntity>, <nameAlias>, and
// <regulation>. Not a full XML parser; just regex extraction over the chunks
// we care about. Robust enough for the EU FSD's well-formed output.
function entitiesFromXml(xml) {
  const out = [];
  const entityRe = /<sanctionEntity\b([^>]*)>([\s\S]*?)<\/sanctionEntity>/g;
  let m;
  let idx = 0;
  while ((m = entityRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body  = m[2];
    const logicalId = (attrs.match(/logicalId="([^"]+)"/) || [])[1];
    const subjectTypeCode =
      (body.match(/<subjectType[^>]*\scode="([^"]+)"/) || [])[1] ||
      (attrs.match(/subjectType="([^"]+)"/) || [])[1] || "";
    const type = subjectTypeCode.toUpperCase().startsWith("P") ? "individual" : "entity";

    const aliases = [];
    const nameRe = /<nameAlias\b([^>]*)\/>|<nameAlias\b([^>]*)>([\s\S]*?)<\/nameAlias>/g;
    let nm;
    while ((nm = nameRe.exec(body)) !== null) {
      const a = nm[1] || nm[2] || "";
      const whole = (a.match(/wholeName="([^"]+)"/) || [])[1];
      if (whole) aliases.push(whole);
    }

    const programs = new Set();
    const regRe = /<regulation\b([^>]*)>|<regulation\b([^>]*)\/>/g;
    let rm;
    while ((rm = regRe.exec(body)) !== null) {
      const a = rm[1] || rm[2] || "";
      const prog = (a.match(/programme="([^"]+)"/) || [])[1] ||
                   (a.match(/regulationType="([^"]+)"/) || [])[1];
      if (prog) programs.add(prog);
    }

    if (aliases.length === 0) continue;
    out.push({
      ent_id:      logicalId || `eu-${idx++}`,
      name:        aliases[0],
      type,
      programs:    [...programs],
      remarks:     null,
      all_names:   new Set(aliases),
      list_source: "eu_consolidated",
    });
  }
  return out;
}

/* ------------------------------ name index ------------------------------- */

const STOPWORDS = new Set([
  "the","of","and","a","an","co","corp","corporation","inc","incorporated",
  "llc","ltd","limited","group","holdings","company","companies","brands",
]);

const CORP_SUFFIXES = new Set([
  "inc","incorporated","corp","corporation","co","company","companies",
  "llc","ltd","limited","lp","llp","group","holdings","plc","ag","sa",
  "nv","gmbh","kg","kk","bv","spa","srl","pte","pty","usa","us","na",
  "international","intl","worldwide","global","brands","industries",
  // EU-specific corporate forms commonly appearing in regulation text
  "ooo","oao","pao","zao","ao","jsc","ojsc","pjsc","cjsc","fzco","fze",
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

function nameMatches(brandName, euName) {
  const tokens = brandTokens(brandName);
  if (tokens.length === 0) return false;
  const t = normalize(euName);
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

function buildIndex(entities) {
  const buckets = new Map();
  for (const ent of entities) {
    for (const nm of ent.all_names) {
      const toks = brandTokens(nm);
      if (toks.length === 0) continue;
      const key = toks[0];
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ entity: ent, matched_name: nm });
    }
  }
  return { buckets, stats: { entityCount: entities.length, bucketCount: buckets.size } };
}

function lookup(brand, index) {
  const tokens = brandTokens(brand.name);
  if (tokens.length === 0) return { status: "skipped_generic_name" };
  const first = tokens[0];
  const bucket = index.buckets.get(first) || [];

  const seen = new Map();
  for (const { entity, matched_name } of bucket) {
    if (!nameMatches(brand.name, matched_name)) continue;
    if (entity.type === "individual") continue;   // EU list is mostly individuals
    if (seen.has(entity.ent_id)) continue;
    seen.set(entity.ent_id, { entity, matched_name });
  }

  if (seen.size === 0) return { status: "no_match" };

  const matches = [...seen.values()];
  const programs = new Set();
  for (const { entity } of matches) {
    for (const p of entity.programs) programs.add(p);
  }
  const sample = matches.slice(0, 5).map(({ entity, matched_name }) => ({
    ent_id:       entity.ent_id,
    name:         entity.name,
    matched_name,
    type:         entity.type,
    programs:     entity.programs,
    list_source:  entity.list_source,
    remarks:      entity.remarks,
  }));

  return {
    status:               "ok",
    is_eu_sanctioned:     true,
    eu_sanction_count:    matches.length,
    eu_sanction_programs: [...programs].sort(),
    sample_records:       sample,
  };
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  console.log("EU consolidated sanctions fetcher starting...");

  // Step 1: download. Prefer JSON; fall back to XML if JSON fails.
  let entities = [];
  let usedSource = null;
  for (const src of SOURCES) {
    console.log(`  Fetching ${src.key} (${src.url})`);
    let text;
    try {
      text = await fetchSource(src);
    } catch (err) {
      console.warn(`    Failed: ${err.message}`);
      await SLEEP(REQ_DELAY_MS);
      continue;
    }
    console.log(`    ${text.length.toLocaleString()} bytes`);
    await SLEEP(REQ_DELAY_MS);

    try {
      if (src.kind === "json") {
        const json = JSON.parse(text);
        const raw = flattenEntitiesFromJson(json);
        entities = raw.map((r, i) => entityFromJson(r, i)).filter(Boolean);
      } else {
        entities = entitiesFromXml(text);
      }
    } catch (err) {
      console.warn(`    Parse failed: ${err.message}`);
      continue;
    }

    if (entities.length > 0) {
      usedSource = src;
      break;
    }
  }

  if (!usedSource || entities.length === 0) {
    throw new Error("No EU sanctions data could be fetched / parsed");
  }
  console.log(`Parsed ${entities.length.toLocaleString()} entities from ${usedSource.key}`);

  // Step 2: build the in-memory index.
  console.log("Building index...");
  const index = buildIndex(entities);
  console.log(`  Entities indexed: ${index.stats.entityCount.toLocaleString()}`);
  console.log(`  Bucket count:     ${index.stats.bucketCount.toLocaleString()}`);

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
    generated_at:    new Date().toISOString(),
    source:          "EU Financial Sanctions Database (FSD) -- consolidated list",
    source_urls:     SOURCES.map(s => s.url),
    source_used:     usedSource.key,
    entity_count:    index.stats.entityCount,
    brand_count:     brands.length,
    matched_count:   matched.length,
    no_match_count:  noMatch,
    skipped_count:   skipped,
    sanctions:       results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Brands with any match:  ${matched.length}`);
  console.log(`   No-match brands:        ${noMatch}`);
  console.log(`   Skipped (generic name): ${skipped}`);
  if (matched.length > 0) {
    console.log("\nEU-sanctioned brands:");
    for (const r of matched) {
      console.log(`   - ${r.name} (${r.slug}) -- ${r.eu_sanction_count} record(s) -- programs: ${r.eu_sanction_programs.join(", ")}`);
    }
  }
}

main().catch(err => {
  console.error("eu-sanctions-fetch failed:", err);
  process.exit(1);
});
