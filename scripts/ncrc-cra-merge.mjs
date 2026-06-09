#!/usr/bin/env node
/**
 * NCRC CRA merger — per-slug community-reinvestment augment.
 *
 * Reads data/raw/ncrc-cra/<date>.json and emits
 * data/derived/ncrc-cra-augment.json:
 *   bySlug: { "<slug>": { cra: { rating, exam_year, note, sourceUrl } } }
 *
 * Maps each bank's legal entity name to its consumer-facing parent slug
 * via NCRC_ALIASES (e.g. "JPMorgan Chase Bank, N.A." -> "jpmorgan-chase").
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/ncrc-cra");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE   = path.join(ROOT, "data/derived/ncrc-cra-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

/** Bank legal-name -> parent consumer brand slug. The bank entity is
 *  usually a subsidiary (e.g. "JPMorgan Chase Bank, N.A." rolls into
 *  the publicly traded "JPMorgan Chase"). */
const NCRC_ALIASES = {
  "bank-of-america-n-a":        "bank-of-america",
  "jpmorgan-chase-bank-n-a":    "jpmorgan-chase",
  "wells-fargo-bank-n-a":       "wells-fargo",
  "citibank-n-a":               "citigroup",
  "u-s-bank-national-association": "first-us-bancshares",
  "pnc-bank-n-a":               "pnc-financial",
  "truist-bank":                "truist-financial",
  "capital-one-n-a":            "capital-one",
  "td-bank-n-a":                null,
  "goldman-sachs-bank-usa":     "goldman-sachs",
  "morgan-stanley-bank-n-a":    "morgan-stanley",
  "charles-schwab-bank-ssb":    "charles-schwab",
  "american-express-national-bank": "american-express",
  "discover-bank":              "discover-financial",
  "synchrony-bank":             "synchrony-financial",
  "ally-bank":                  "ally-financial",
  "citizens-bank-n-a":          "citizens",
  "m-and-t-bank":               null,
  "fifth-third-bank-n-a":       "fifth-third-bank",
  "keybank-n-a":                "keycorp",
  "regions-bank":               "regions-financial",
  "huntington-national-bank":   "huntington-bancshares-inc",
  "first-horizon-bank":         "first-horizon",
  "comerica-bank":              null,
  "zions-bancorporation-n-a":   null,
  "santander-bank-n-a":         "banco-santander-s-a",
  "hsbc-bank-usa-n-a":          null,
  "deutsche-bank-trust-americas": "deutsche-bank-aktiengesellschaft",
  "bmo-bank-n-a":               "bank-of-montreal",
  "bank-of-the-west":           null,
  "silicon-valley-bank":        "silicon-valley-bank",
  "first-republic-bank":        null,
  "signature-bank":             null,
};

async function loadIndexSlugs() {
  const text = await fs.readFile(INDEX_FILE, "utf-8");
  const arr = JSON.parse(text);
  return new Set(arr.map(c => c.slug));
}
async function pickLatestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

/** Score rank — higher = better. Used for dedupe on parent collisions. */
const RANK = {
  "Outstanding": 3,
  "Satisfactory": 2,
  "Needs to Improve": 1,
  "Substantial Noncompliance": 0,
};

export function resolveSlug(name, indexSlugs) {
  const s = toSlug(name);
  if (s && indexSlugs.has(s)) return { slug: s, via: "direct" };
  const alias = NCRC_ALIASES[s];
  if (alias && indexSlugs.has(alias)) return { slug: alias, via: "alias" };
  return { slug: null, via: "orphan", attempted: s };
}

async function main() {
  console.log("NCRC CRA merger");
  const rawPath = await pickLatestRawFile();
  const raw = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const banks = raw.banks || [];

  const indexSlugs = await loadIndexSlugs();
  const bySlug = {};
  const routing = { direct: 0, alias: 0, orphan: 0 };
  const orphans = [];

  for (const b of banks) {
    if (!b?.name) continue;
    const { slug, via, attempted } = resolveSlug(b.name, indexSlugs);
    routing[via]++;
    if (!slug) { orphans.push({ name: b.name, attempted, rating: b.rating }); continue; }
    const cur = bySlug[slug]?.cra;
    const curRank = cur ? (RANK[cur.rating] ?? -1) : -1;
    const newRank = RANK[b.rating] ?? -1;
    // Prefer worst rating (lower rank) so we surface risk; but if equal,
    // prefer most-recent exam.
    if (cur) {
      if (curRank < newRank) continue;
      if (curRank === newRank && (cur.exam_year || 0) >= (b.exam_year || 0)) continue;
    }
    bySlug[slug] = {
      cra: {
        rating: b.rating,
        exam_year: b.exam_year || null,
        bank_entity: b.name,
        note: b.note || null,
        sourceUrl: "https://www.ffiec.gov/craratings/default.aspx",
      },
    };
  }

  const output = {
    _license: raw._license || "Public — FFIEC CRA records",
    _generated_at: new Date().toISOString(),
    _source_raw_file: path.relative(ROOT, rawPath),
    _source_url: raw._source || "https://www.ffiec.gov",
    _vintage: raw._vintage,
    _matched_slugs: Object.keys(bySlug).length,
    _routing_counts: routing,
    _orphans: orphans,
    bySlug,
  };

  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  Matched: ${Object.keys(bySlug).length}; Routing: ${JSON.stringify(routing)}`);
  if (orphans.length) console.log(`  Orphans: ${orphans.map(o=>o.name).join(", ")}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ncrc-cra-merge failed:", err);
    process.exit(1);
  });
}
