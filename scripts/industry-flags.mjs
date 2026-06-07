#!/usr/bin/env node
/**
 * B-15 — Industry-membership flags merger.
 *
 * Walks every per-company JSON in public/data/companies/ and stamps a
 * `co.industry_flags` object based on curated allow-lists per industry:
 *
 *   tobacco            — scripts/industry-allowlists/tobacco.json
 *   fossil_fuel        — scripts/industry-allowlists/fossil-fuel.json
 *   firearms_industry  — scripts/industry-allowlists/firearms-industry.json
 *   alcohol            — scripts/industry-allowlists/alcohol.json
 *
 * MATCH BASIS (deliberately narrow — we'd rather miss a tag than mistag):
 *   1. Direct slug match against the allow-list keys.
 *   2. Slug-alias resolution via public/data/_meta/slug-aliases.json
 *      (e.g. the alias map sends "exxon" -> "exxon-mobil").
 *   3. Sub-brand resolution via public/data/_meta/brand-parent-map.json:
 *      if a company's slug appears as a SUB-BRAND whose parent is on the
 *      list, the sub-brand also gets tagged. (e.g. "budweiser" -> "anheuser-busch"
 *      -> alcohol=true).
 *
 * NO fuzzy name matching. NO substring matching. NO Wikipedia-industry-string
 * scraping (Altria's Wikipedia industry field literally says "tobacco industry"
 * but we deliberately do not use that as a basis — too fragile, too many
 * brand-name collisions). If something's missing, add it to the JSON file.
 *
 * SCHEMA WRITTEN
 *   co.industry_flags = {
 *     tobacco: boolean,
 *     fossil_fuel: boolean,
 *     firearms_industry: boolean,
 *     alcohol: boolean,
 *     sources: {
 *       tobacco?: { matchBasis: "slug" | "parent_map" | "alias", role?: string },
 *       ...
 *     },
 *     lastUpdated: ISO timestamp
 *   }
 *
 * Independent of co.firearms_atf_ffl (B-37) — that field captures
 * federal license disclosure; this captures industry membership. A brand
 * can have FFL=true but firearms_industry=false (e.g. Walmart) and vice
 * versa (a manufacturer with no current FFL on file).
 *
 * USAGE
 *   node scripts/industry-flags.mjs            # write changes to disk
 *   node scripts/industry-flags.mjs --dry      # dry-run, report only
 *
 * EXIT CODES
 *   0 — success
 *   1 — IO or parse error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const COMPANIES_DIR = path.join(REPO_ROOT, "public", "data", "companies");
const ALLOWLISTS_DIR = path.join(__dirname, "industry-allowlists");
const ALIASES_PATH = path.join(REPO_ROOT, "public", "data", "_meta", "slug-aliases.json");
const PARENT_MAP_PATH = path.join(REPO_ROOT, "public", "data", "_meta", "brand-parent-map.json");

const FLAG_FILES = [
  { flag: "tobacco",           file: "tobacco.json" },
  { flag: "fossil_fuel",       file: "fossil-fuel.json" },
  { flag: "firearms_industry", file: "firearms-industry.json" },
  { flag: "alcohol",           file: "alcohol.json" },
];

const DRY = process.argv.includes("--dry") || process.argv.includes("--dry-run");

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadAllowlist(filePath) {
  const raw = loadJSON(filePath);
  // Strip _comment, _format keys.
  const out = {};
  for (const [slug, entry] of Object.entries(raw)) {
    if (slug.startsWith("_")) continue;
    out[slug] = entry;
  }
  return out;
}

function main() {
  if (DRY) console.log("[industry-flags] DRY-RUN — no files will be modified.\n");

  // --- load allow-lists ---
  const allowlists = {};
  for (const { flag, file } of FLAG_FILES) {
    const p = path.join(ALLOWLISTS_DIR, file);
    if (!fs.existsSync(p)) {
      console.error(`[industry-flags] missing allow-list: ${p}`);
      process.exit(1);
    }
    allowlists[flag] = loadAllowlist(p);
  }

  console.log("[industry-flags] allow-list sizes:");
  for (const { flag } of FLAG_FILES) {
    console.log(`  ${flag.padEnd(20)} ${Object.keys(allowlists[flag]).length}`);
  }
  console.log("");

  // --- load alias + parent-map for sub-brand resolution ---
  const aliases = fs.existsSync(ALIASES_PATH) ? loadJSON(ALIASES_PATH) : {};
  const parentMap = fs.existsSync(PARENT_MAP_PATH) ? loadJSON(PARENT_MAP_PATH) : {};

  // Build a quick reverse lookup: alias -> canonical slug.
  // The slug-aliases.json maps alias -> canonical (e.g. "exxon" -> "exxon-mobil").
  // For our purposes we need the OPPOSITE: given a company's own slug, does
  // any alias point to it that's in the allow-list? Easier to also build:
  // canonicalForAlias(slug) returns the alias target if present.
  function aliasTarget(slug) {
    return aliases[slug] || null;
  }

  // brand-parent-map: keys are sub-brand slugs, values { parent, confidence }.
  function parentOf(slug) {
    const entry = parentMap[slug];
    return entry && typeof entry === "object" ? entry.parent : null;
  }

  // --- match function: given a company, decide each flag ---
  function evaluate(co) {
    const slug = (co.slug || "").toLowerCase();
    if (!slug) return { flags: {}, sources: {} };

    const flags = {};
    const sources = {};

    for (const { flag } of FLAG_FILES) {
      const list = allowlists[flag];

      // 1. Direct slug match
      if (list[slug]) {
        flags[flag] = true;
        sources[flag] = { matchBasis: "slug", role: list[slug].role || list[slug].subsector || null };
        continue;
      }

      // 2. Alias resolution — does the alias target appear in the list?
      const alias = aliasTarget(slug);
      if (alias && list[alias]) {
        flags[flag] = true;
        sources[flag] = { matchBasis: "alias", role: list[alias].role || list[alias].subsector || null, aliasOf: alias };
        continue;
      }

      // 3. Parent-map: is this a sub-brand whose parent is on the list?
      const parent = parentOf(slug);
      if (parent && list[parent]) {
        flags[flag] = true;
        sources[flag] = { matchBasis: "parent_map", role: list[parent].role || list[parent].subsector || null, parent };
        continue;
      }

      flags[flag] = false;
    }

    return { flags, sources };
  }

  // --- walk companies ---
  const files = fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json"));
  console.log(`[industry-flags] scanning ${files.length.toLocaleString()} company files...`);

  const matches = { tobacco: [], fossil_fuel: [], firearms_industry: [], alcohol: [] };
  let touched = 0;
  let errors = 0;

  for (const file of files) {
    const full = path.join(COMPANIES_DIR, file);
    let co;
    try {
      co = loadJSON(full);
    } catch (e) {
      console.warn(`  parse error: ${file} — ${e.message}`);
      errors++;
      continue;
    }

    // Skip files that don't look like company entries (no name/slug).
    if (!co || typeof co !== "object" || (!co.name && !co.slug)) continue;

    // Make sure slug is populated — most files have it, but fall back to filename.
    if (!co.slug) co.slug = file.replace(/\.json$/, "");

    const { flags, sources } = evaluate(co);
    const anyTrue = Object.values(flags).some(v => v === true);

    if (anyTrue) {
      for (const [flag, on] of Object.entries(flags)) {
        if (on) matches[flag].push({ slug: co.slug, name: co.name, basis: sources[flag] });
      }
    }

    // Decide whether the current file's industry_flags differs from new.
    const existing = co.industry_flags || null;
    const next = {
      tobacco: !!flags.tobacco,
      fossil_fuel: !!flags.fossil_fuel,
      firearms_industry: !!flags.firearms_industry,
      alcohol: !!flags.alcohol,
      sources,
      lastUpdated: new Date().toISOString(),
    };

    const sameFlags =
      existing &&
      existing.tobacco === next.tobacco &&
      existing.fossil_fuel === next.fossil_fuel &&
      existing.firearms_industry === next.firearms_industry &&
      existing.alcohol === next.alcohol;

    if (!anyTrue && !existing) continue; // nothing to write
    if (sameFlags) continue;             // no functional change

    touched++;
    if (!DRY) {
      co.industry_flags = next;
      fs.writeFileSync(full, JSON.stringify(co));
    }
  }

  // --- report ---
  console.log("");
  console.log("[industry-flags] match counts per flag:");
  for (const { flag } of FLAG_FILES) {
    console.log(`  ${flag.padEnd(20)} ${matches[flag].length}`);
  }
  console.log("");

  for (const { flag } of FLAG_FILES) {
    const top = matches[flag].slice(0, 10);
    if (top.length === 0) continue;
    console.log(`[industry-flags] top ${top.length} matches for ${flag}:`);
    for (const m of top) {
      const basis = m.basis?.matchBasis || "?";
      const extra = m.basis?.parent ? ` (via parent ${m.basis.parent})` :
                    m.basis?.aliasOf ? ` (via alias ${m.basis.aliasOf})` : "";
      console.log(`  - ${m.slug.padEnd(40)} ${m.name || "?"}  [${basis}]${extra}`);
    }
    console.log("");
  }

  console.log(`[industry-flags] touched ${touched} file(s).${DRY ? " (dry-run — no writes)" : ""}`);
  if (errors > 0) console.log(`[industry-flags] ${errors} parse error(s).`);
}

main();
