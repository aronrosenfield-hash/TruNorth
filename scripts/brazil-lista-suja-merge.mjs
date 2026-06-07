#!/usr/bin/env node
/**
 * Brazil Lista Suja — merge into TruNorth slugs.
 *
 * Reads the most recent snapshot in data/raw/brazil-lista-suja/ (produced
 * by brazil-lista-suja-fetch.mjs --apply) and writes an augmentation file
 * keyed by TruNorth company slug:
 *
 *   data/derived/brazil-lista-suja-augment.json
 *
 *   {
 *     _license: "Lei de Acesso à Informação (Brazil LAI 12527/2011), ...",
 *     sourceUrl: "...",
 *     generatedAt: "...",
 *     matchCount: N,
 *     orphanCount: M,
 *     <slug>: {
 *       forcedLaborListings: [
 *         { employerName, cnpj, municipality, addedDate,
 *           infractionDescription, sourceUrl }
 *       ]
 *     }
 *   }
 *
 * Matching strategy (in priority order):
 *   1. Direct normalized-name match against public/data/index.json.
 *   2. Parent-company match against public/data/_meta/brand-parent-map.json
 *      (e.g. JBS, Marfrig, Cargill, BRF, Suzano, Vale subsidiaries roll up
 *      to the parent slug).
 *   3. SUPPLY_CHAIN_HINTS — a tiny hand-curated table of well-known
 *      Brazilian commodity giants whose names appear in many forms on the
 *      list (JBS, Marfrig, Cargill, etc.). These are tagged as v2 follow-up
 *      work — they're listed so the merge log surfaces the magnitude of
 *      potential supply-chain exposure, but they're NOT written into
 *      forcedLaborListings yet. See the PR description for v2 plan.
 *
 * Most listed employers are small rural Brazilian operations that have NO
 * direct mapping to our consumer-brand index. That's expected. The v1
 * value is the small slice that does match.
 *
 * Flags:
 *   --apply        — write the augment file (otherwise print summary only).
 *   --dry          — (default) print what WOULD be written.
 *   --in PATH      — read a specific snapshot instead of the newest one.
 *
 * Locally:
 *   node scripts/brazil-lista-suja-merge.mjs
 *   node scripts/brazil-lista-suja-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizePtName } from "./brazil-lista-suja-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/brazil-lista-suja");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "brazil-lista-suja-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(
  ROOT,
  "public/data/_meta/brand-parent-map.json",
);

const LICENSE_TAG =
  "Lei de Acesso à Informação (Brazil LAI 12527/2011), Ministério do Trabalho e Emprego";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const IN_PATH = (() => {
  const i = argv.indexOf("--in");
  return i >= 0 ? argv[i + 1] : null;
})();

// ─────────────────────────── supply-chain hints ─────────────────────
// Brazilian agribusiness & commodity giants whose names appear (under
// dozens of subsidiary/farm/plant LLC names) on the Lista Suja. We use
// these only to surface the LIKELY-supply-chain count in the merge log;
// they are NOT auto-merged in v1 because farm-level → corporate-parent
// inference requires the JBS supplier-list disclosures + IBAMA cattle
// rastreabilidade data that we don't ingest yet.
//
// Each entry is a list of name fragments (already lower-cased + accent-
// stripped) that, if present in an employer name, suggest the upstream
// brand. Order doesn't matter; first hit wins on tie-break.
export const SUPPLY_CHAIN_HINTS = {
  "jbs-n-v":                  ["jbs", "seara", "swift", "friboi"],
  "marfrig-global-foods-s-a": ["marfrig", "minerva foods", "national beef"],
  "bunge-global-sa":          ["bunge"],
  "cargill":                  ["cargill"],
  "suzano-s-a":               ["suzano", "fibria"],
  "tyson-foods":              ["tyson"],
  "barry-callebaut-ag":       ["barry callebaut"],
  // BRF (Sadia/Perdigão) has no TruNorth company file yet — kept here so
  // the orphan count is honest. Same story for ADM (commodities), Vale
  // (mining), and Louis Dreyfus.
  "_orphan:brf":              ["brf", "sadia", "perdigao", "perdigão"],
  "_orphan:vale":             ["vale s a", "vale s.a", "vale mineracao"],
  "_orphan:adm":              ["archer daniels midland", "adm do brasil"],
  "_orphan:louis-dreyfus":    ["louis dreyfus", "ldc do brasil"],
};

// ─────────────────────────── matching ───────────────────────────────

/**
 * Build an O(1)-lookup map from normalized index name → slug.
 */
function buildIndexLookup(index) {
  const byName = new Map();
  for (const e of index) {
    const k = normalizePtName(e.name);
    if (k && !byName.has(k)) byName.set(k, e.slug);
  }
  return byName;
}

/**
 * Try a few normalized-name variants against the lookup. Returns the
 * matched slug or null.
 */
export function matchEmployerToIndex(employerName, byName) {
  const variants = nameVariants(employerName);
  for (const v of variants) {
    const hit = byName.get(v);
    if (hit) return hit;
  }
  return null;
}

/**
 * Produce a few stripped/shortened forms of an employer name so we can
 * tolerate the "Frigorífico JBS Cuiabá Ltda" → "jbs" simplification.
 */
export function nameVariants(s) {
  const base = normalizePtName(s);
  const out = new Set([base]);
  // Drop leading business-type words ("Frigorífico", "Fazenda", etc.) so
  // "Frigorífico JBS Cuiabá …" reduces to "jbs cuiaba …".
  const stripped = base.replace(
    /^(frigorifico|frigorificos|fazenda|usina|companhia|grupo|cia|empresa)\s+/i,
    "",
  );
  if (stripped !== base) out.add(stripped);
  // Produce a handful of word-window candidates against both forms.
  for (const v of [base, stripped]) {
    const words = v.split(" ").filter(Boolean);
    if (words.length >= 2) out.add(words.slice(0, 2).join(" "));
    if (words.length >= 1) out.add(words[0]);
  }
  return [...out].filter((x) => x.length >= 3);
}

/**
 * Try to resolve a slug via the brand-parent-map. The parent-map keys
 * are sub-brand slugs (kebab-cased), so we generate slug-candidates
 * from the employer name and check each.
 */
export function matchViaParentMap(employerName, parentMap) {
  const candidates = slugCandidates(employerName);
  for (const c of candidates) {
    const entry = parentMap[c];
    if (entry && entry.parent) return entry.parent;
  }
  return null;
}

function slugCandidates(employerName) {
  const n = normalizePtName(employerName);
  const out = new Set();
  out.add(n.replace(/\s+/g, "-"));
  const words = n.split(" ").filter(Boolean);
  if (words.length >= 1) out.add(words[0]);
  if (words.length >= 2) out.add(words.slice(0, 2).join("-"));
  return [...out].filter((x) => x.length >= 3);
}

/**
 * Identify SUPPLY_CHAIN_HINTS bucket for an employer (or null).
 * Returns the bucket key — which may be "_orphan:..." for hints whose
 * parent slug isn't in our index yet.
 */
export function matchSupplyChainHint(employerName) {
  const n = normalizePtName(employerName);
  for (const [bucket, fragments] of Object.entries(SUPPLY_CHAIN_HINTS)) {
    for (const frag of fragments) {
      if (n.includes(frag)) return bucket;
    }
  }
  return null;
}

// ─────────────────────────── snapshot loader ────────────────────────

async function latestSnapshot() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

async function loadJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

// ─────────────────────────── main ───────────────────────────────────

export function mergeSnapshot(snapshot, { index, parentMap }) {
  const byName = buildIndexLookup(index);
  const augment = {};
  let directMatches = 0;
  let parentMatches = 0;
  let supplyChainMatches = 0;
  let supplyChainBuckets = {};
  let orphans = 0;
  const sourceUrl = snapshot.sourceUrl || "";

  for (const row of snapshot.rows || []) {
    const listing = {
      employerName: row.employerName,
      cnpj: row.cnpj || "",
      municipality: row.municipality || "",
      state: row.state || "",
      addedDate: row.addedDate || "",
      infractionDescription: row.infractionDescription || "",
      workersFreed: row.workersFreed ?? null,
      sourceUrl,
    };

    // 1) direct
    let slug = matchEmployerToIndex(row.employerName, byName);
    let route = "direct";
    // 2) parent map
    if (!slug) {
      slug = matchViaParentMap(row.employerName, parentMap);
      if (slug) route = "parent";
    }
    if (slug) {
      if (route === "direct") directMatches++; else parentMatches++;
      if (!augment[slug]) augment[slug] = { forcedLaborListings: [] };
      augment[slug].forcedLaborListings.push(listing);
      continue;
    }

    // 3) v2 supply-chain hint (counted but not written)
    const bucket = matchSupplyChainHint(row.employerName);
    if (bucket) {
      supplyChainMatches++;
      supplyChainBuckets[bucket] = (supplyChainBuckets[bucket] || 0) + 1;
      continue;
    }

    orphans++;
  }

  return {
    augment,
    stats: { directMatches, parentMatches, supplyChainMatches, supplyChainBuckets, orphans },
  };
}

async function main() {
  console.log(`brazil-lista-suja merge starting... (mode=${DRY ? "DRY" : "APPLY"})`);

  const snapshotPath = IN_PATH ? path.resolve(IN_PATH) : await latestSnapshot();
  if (!snapshotPath || !existsSync(snapshotPath)) {
    console.error(`No snapshot found in ${path.relative(ROOT, RAW_DIR)}. Run brazil-lista-suja-fetch.mjs --apply first.`);
    process.exit(2);
  }
  const snapshot = await loadJson(snapshotPath);
  if (!snapshot) {
    console.error(`Could not parse snapshot at ${snapshotPath}`);
    process.exit(2);
  }
  console.log(`Loaded snapshot: ${path.relative(ROOT, snapshotPath)} (${snapshot.rowCount || (snapshot.rows || []).length} employers)`);

  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  console.log(`Loaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).`);

  const { augment, stats } = mergeSnapshot(snapshot, { index, parentMap });
  const matchedSlugs = Object.keys(augment).length;

  console.log("\nResults:");
  console.log(`  Direct matches:        ${stats.directMatches}`);
  console.log(`  Parent-map matches:    ${stats.parentMatches}`);
  console.log(`  Supply-chain hints:    ${stats.supplyChainMatches}  (v2 follow-up — not auto-merged)`);
  console.log(`  Orphans (no mapping):  ${stats.orphans}`);
  console.log(`  Distinct matched slugs: ${matchedSlugs}`);

  if (stats.supplyChainMatches > 0) {
    console.log("\n  Supply-chain bucket breakdown:");
    for (const [k, n] of Object.entries(stats.supplyChainBuckets).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${k}`);
    }
  }

  const out = {
    _license: LICENSE_TAG,
    sourceUrl: snapshot.sourceUrl || "",
    sourceKind: snapshot.sourceKind || "",
    generatedAt: new Date().toISOString(),
    matchCount: stats.directMatches + stats.parentMatches,
    orphanCount: stats.orphans,
    supplyChainHintCount: stats.supplyChainMatches,
    supplyChainBuckets: stats.supplyChainBuckets,
    ...augment,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)}`);
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("brazil-lista-suja-merge failed:", err);
    process.exit(1);
  });
}
