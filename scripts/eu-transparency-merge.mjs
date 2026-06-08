#!/usr/bin/env node
/**
 * EU Transparency Register — merger (B-data-eu1, step 2).
 *
 * Reads the most recent raw dump at /data/raw/eu-transparency/<date>.json
 * (or whatever --in points at), normalises each registrant's name, and
 * matches against /public/data/index.json (11,209 consumer brands). Writes
 *
 *   /data/derived/eu-transparency-augment.json
 *
 * keyed by TruNorth slug. Existing per-company JSON is NOT touched — this
 * file is a flat lookup the app + downstream scoring read.
 *
 * MATCHING STRATEGY
 *   1. Strip legal-entity suffixes (Inc, LLC, GmbH, AG, S.A., BV, SARL,
 *      PLC, Ltd, etc.) plus parenthesised qualifiers ("Europe", "Services",
 *      "International"...).
 *   2. Lowercase, deburr, collapse punctuation to single spaces.
 *   3. Exact match against an index of {normalised name -> slug}, then
 *      first-token + "&" / "and" variant, then a small set of explicit
 *      aliases (Google → google-alphabet, etc.).
 *
 * We deliberately match only entries that are EITHER
 *   (a) declared annual EU lobby spend > €100,000, OR
 *   (b) already present in our 11k index.
 * Per spec — avoids drowning in EU SMEs whose names happen to collide.
 *
 * VALUE WRITTEN (per matched slug):
 *   euLobbying: {
 *     registrationId,
 *     headquartersCountry,
 *     fields: [...],
 *     annualSpendEur: number | null,
 *     accreditedLobbyists: int,
 *     lastUpdated,
 *     sourceUrl
 *   }
 *
 * Flags:
 *   --in PATH    — input raw dump (default: latest in data/raw/eu-transparency)
 *   --apply      — actually write the derived JSON (default: dry-run print)
 *
 * Locally:
 *   node scripts/eu-transparency-merge.mjs              # dry
 *   node scripts/eu-transparency-merge.mjs --apply      # write
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/eu-transparency");
const OUT_FILE = path.join(ROOT, "data/derived/eu-transparency-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const IN_OPT = (() => {
  const i = argv.indexOf("--in");
  return i >= 0 ? argv[i + 1] : null;
})();

const SPEND_THRESHOLD_EUR = 100_000;

// Manual aliases for high-profile EU registrants whose name doesn't share
// a token with the slug in our index. Keep this short — most matches should
// come from normalisation, not hand-mapping.
const NAME_ALIASES = new Map([
  ["google", "google-alphabet"],
  ["alphabet", "google-alphabet"],
  ["meta platforms", "meta-platforms"],
  ["meta", "meta-platforms"],
  ["facebook", "meta-facebook"],
  ["microsoft", "microsoft"],
  ["amazon", "amazon"],
  ["exxonmobil petroleum chemical", "exxon-mobil"],
  ["exxonmobil", "exxon-mobil"],
  ["shell", "shell-usa"],
  ["bp", "bp-usa"],
  ["bp europa", "bp-usa"],
  ["totalenergies", "totalenergies-usa"],
  ["pfizer", "pfizer"],
  ["johnson johnson", "johnson-and-johnson"],
  ["johnson", "johnson-and-johnson"],
  ["novartis pharma", "novartis"],
  ["novartis", "novartis"],
  ["bayer", "bayer"],
  ["volkswagen", "volkswagen-usa"],
  ["siemens", "siemens-energy-ag"],
  ["nestle", "nestle"],
  ["unilever", "unilever-uk"],
  ["the coca cola", "coca-cola"],
  ["coca cola", "coca-cola"],
  ["pepsico europe", "pepsico"],
  ["pepsico", "pepsico"],
  ["pepsi", "pepsi"],
  ["jpmorgan chase bank n a", "jpmorgan-chase"],
  ["jpmorgan chase", "jpmorgan-chase"],
  ["jpmorgan", "jpmorgan-chase"],
  ["goldman sachs", "goldman-sachs"],
  ["tesla motors netherlands", "tesla"],
  ["tesla", "tesla"],
  ["uber", "uber"],
  ["booking", "booking-holdings"],
  ["booking com", "booking-holdings"],
  ["apple", "apple"],
]);

/* ------------------------ normalisation ------------------------ */

const LEGAL_SUFFIXES = [
  "inc", "incorporated", "corp", "corporation", "co", "company", "holdings",
  "group", "llc", "lp", "llp", "plc", "ltd", "limited",
  "gmbh", "ag", "se", "kgaa", "ohg",
  "sa", "s a", "sas", "sarl", "snc", "sca",
  "spa", "srl", "scs",
  "bv", "b v", "nv", "n v",
  "ab", "as", "oy",
  "kk", "kabushiki kaisha",
  "pty", "pte",
  "international", "services", "europe",
  "bvba", "sprl",
];

const SUFFIX_RE = new RegExp(
  "\\b(" + LEGAL_SUFFIXES.join("|") + ")\\b",
  "g",
);

export function normaliseName(s) {
  if (!s) return "";
  let out = String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")           // strip diacritics
    .toLowerCase()
    .replace(/[\(\[][^\)\]]*[\)\]]/g, " ")     // drop (parenthesised) parts
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ");
  // Drop legal suffixes (run twice to catch trailing chains like "ag se").
  out = out.replace(SUFFIX_RE, " ").replace(SUFFIX_RE, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/* ------------------------ index lookup ------------------------ */

export function buildIndex(indexEntries) {
  const byNorm = new Map();
  const bySlug = new Map();
  for (const e of indexEntries) {
    if (!e?.slug || !e?.name) continue;
    bySlug.set(e.slug, e);
    const n = normaliseName(e.name);
    if (n && !byNorm.has(n)) byNorm.set(n, e.slug);
    // Also register normalised slug itself.
    const ns = e.slug.replace(/-/g, " ");
    if (!byNorm.has(ns)) byNorm.set(ns, e.slug);
  }
  return { byNorm, bySlug };
}

export function matchRegistrant(reg, idx) {
  const norm = normaliseName(reg.name);
  if (!norm) return null;

  // 1. Alias table
  if (NAME_ALIASES.has(norm)) {
    const slug = NAME_ALIASES.get(norm);
    if (idx.bySlug.has(slug)) return { slug, via: "alias" };
  }

  // 2. Exact normalised match
  if (idx.byNorm.has(norm)) return { slug: idx.byNorm.get(norm), via: "exact" };

  // 3. Try progressively shorter prefixes (head of multi-word name)
  const parts = norm.split(" ");
  for (let n = parts.length - 1; n >= 1; n--) {
    const prefix = parts.slice(0, n).join(" ");
    if (NAME_ALIASES.has(prefix)) {
      const slug = NAME_ALIASES.get(prefix);
      if (idx.bySlug.has(slug)) return { slug, via: "alias-prefix" };
    }
    if (idx.byNorm.has(prefix)) {
      return { slug: idx.byNorm.get(prefix), via: "prefix" };
    }
  }

  return null;
}

/* ------------------------ I/O ------------------------ */

async function latestRawFile() {
  if (IN_OPT) return IN_OPT;
  if (!existsSync(RAW_DIR)) {
    throw new Error(`No raw dir at ${RAW_DIR}. Run eu-transparency-fetch.mjs first.`);
  }
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) throw new Error(`No dated dumps in ${RAW_DIR}.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

/* ------------------------ main ------------------------ */

function fmtEur(n) {
  if (!n) return "€0";
  if (n >= 1e6) return `€${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `€${(n / 1e3).toFixed(0)}K`;
  return `€${n}`;
}

async function main() {
  console.log(`EU Transparency Register merge — mode: ${APPLY ? "APPLY" : "DRY"}`);

  const inFile = await latestRawFile();
  console.log(`Reading ${inFile}`);
  const raw = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const registrants = raw.registrants || [];
  console.log(`Registrants in dump: ${registrants.length}`);

  const indexEntries = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const idx = buildIndex(indexEntries);
  console.log(`TruNorth index entries: ${idx.bySlug.size}`);

  const augment = {};
  const unmatched = [];
  const via = { alias: 0, exact: 0, prefix: 0, "alias-prefix": 0 };

  // Sort by spend desc so when two registrants collide on the same slug
  // (e.g. "Pfizer" parent + a subsidiary), the higher-spend one wins.
  const sorted = [...registrants].sort(
    (a, b) => (b.annualSpendEur || 0) - (a.annualSpendEur || 0),
  );

  for (const reg of sorted) {
    const spend = reg.annualSpendEur || 0;
    const matched = matchRegistrant(reg, idx);

    // Spec: only keep entries that are either already in our index OR
    // declare spend > €100k. The match itself implies "in our index",
    // so a non-match with low spend is dropped here.
    if (!matched && spend <= SPEND_THRESHOLD_EUR) continue;
    if (!matched) {
      unmatched.push({ name: reg.name, spend, country: reg.headquartersCountry });
      continue;
    }

    // Already have a slot? Skip — first writer (highest spend) wins.
    if (augment[matched.slug]) continue;

    augment[matched.slug] = {
      euLobbying: {
        registrationId: reg.registrationId,
        headquartersCountry: reg.headquartersCountry,
        fields: reg.fields,
        annualSpendEur: reg.annualSpendEur,
        accreditedLobbyists: reg.accreditedLobbyists,
        lastUpdated: reg.lastUpdated,
        sourceUrl: reg.sourceUrl,
      },
    };
    via[matched.via] = (via[matched.via] || 0) + 1;
  }

  const matchedCount = Object.keys(augment).length;
  console.log(`\nMatched: ${matchedCount}`);
  console.log(`  by alias:        ${via.alias}`);
  console.log(`  by exact name:   ${via.exact}`);
  console.log(`  by prefix:       ${via.prefix}`);
  console.log(`  by alias-prefix: ${via["alias-prefix"] || 0}`);
  console.log(`Unmatched (>€100k spend): ${unmatched.length}`);

  // Top spenders we DID match
  const topMatched = Object.entries(augment)
    .map(([slug, v]) => ({
      slug,
      name: idx.bySlug.get(slug)?.name || slug,
      spend: v.euLobbying.annualSpendEur || 0,
    }))
    .sort((a, b) => b.spend - a.spend);
  console.log(`\nTop matched spenders:`);
  for (const m of topMatched.slice(0, 10)) {
    console.log(`  ${fmtEur(m.spend).padStart(10)}  ${m.slug.padEnd(28)} (${m.name})`);
  }
  if (unmatched.length) {
    console.log(`\nTop unmatched (≥€100k, not in TruNorth index):`);
    for (const u of unmatched.slice(0, 10)) {
      console.log(`  ${fmtEur(u.spend).padStart(10)}  ${u.name} (${u.country || "??"})`);
    }
  }

  const payload = {
    _license: "EU PSI Directive — © European Union, 2026",
    _source: "EU Transparency Register",
    _sourceUrl: "https://transparency-register.europa.eu",
    _generatedAt: new Date().toISOString(),
    _rawFile: path.relative(ROOT, inFile),
    _stats: {
      registrantsInDump: registrants.length,
      indexedBrands: idx.bySlug.size,
      matched: matchedCount,
      unmatchedHighSpend: unmatched.length,
      via,
    },
    augment,
  };

  if (APPLY) {
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  } else {
    console.log(`\nDRY — re-run with --apply to write ${OUT_FILE}`);
  }
}

const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) {
  main().catch((err) => {
    console.error("eu-transparency-merge failed:", err);
    process.exit(1);
  });
}
