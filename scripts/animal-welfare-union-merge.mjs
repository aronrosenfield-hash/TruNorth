#!/usr/bin/env node
/**
 * Animal Welfare Watchdog Union — Step 2 (Sprint F).
 *
 * Reads:
 *   data/raw/animal-welfare-union/<latest>.json        (6 new sources)
 *   public/data/_raw/leaping-bunny.json                (existing pipeline)
 *   public/data/_raw/peta-bwb.json                     (existing pipeline)
 *
 * For each entry:
 *   1. Slug-resolve via direct → slug-aliases → brand-parent-map (fallback).
 *   2. When routing through brand-parent-map, mark the parent as "mixed-
 *      portfolio" instead of inheriting a cruelty-free=true signal if any
 *      OTHER sub-brand of the same parent is known NOT to be cruelty-free
 *      (PETA do_test list or absence-from-cruelty-free certification while
 *      its sibling brand IS certified). E.g. Aveeno is in PETA's
 *      "dont-test"; J&J has other brands in "do-test" — parent J&J becomes
 *      mixedPortfolio=true rather than crueltyFreeCertified=true.
 *
 * Output:
 *   data/derived/animal-welfare-union-augment.json
 *   {
 *     _license, _source_files, _generated_at,
 *     _stats: { matched_companies, mixed_portfolio_parents, orphan_count, ... },
 *     companies: {
 *       <slug>: {
 *         crueltyFreeCertified?: bool,
 *         veganTrademark?: bool,
 *         farmAnimalWelfareTier?: 1..5,
 *         cageFreeCommitment?: { committed, deadline, progress },
 *         mixedPortfolio?: bool,
 *         sources: [<source-key>...],
 *         sourceUrls: { ... },
 *         routedVia: "direct" | "alias" | "parent",
 *         lastUpdated: iso-8601
 *       }
 *     },
 *     mixed_portfolio_parents: [{ slug, certified_brands, do_test_brands, note }],
 *     orphans: [{ brand, parent_company, sources }]
 *   }
 *
 * DOES NOT touch per-company JSON. The augment file is a DERIVED, append-only
 * sidecar; the merger here is a "library" view, not the canonical writer.
 * (Future B-14 follow-up can teach cruelty-free-merge.mjs to read this file
 * for cross-source reinforcement.)
 *
 * Locally: node scripts/animal-welfare-union-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/animal-welfare-union");
const LB_FILE    = path.join(ROOT, "public/data/_raw/leaping-bunny.json");
const PETA_FILE  = path.join(ROOT, "public/data/_raw/peta-bwb.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE   = path.join(DERIVED_DIR, "animal-welfare-union-augment.json");

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  return {
    aliases: await tryReadJson(path.join(META_DIR, "slug-aliases.json")) || {},
    parents: await tryReadJson(path.join(META_DIR, "brand-parent-map.json")) || {},
  };
}

async function latestRawFile() {
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

// 4-tier resolve: override (none here yet) → direct → alias → parent.
// Returns { slug, routed_via, brandSlug } where brandSlug is the raw slugified
// brand name (used downstream for mixed-portfolio detection).
export function resolveSlug(brandName, maps) {
  const brandSlug = slugify(brandName);
  if (!brandSlug) return { slug: null, routed_via: "orphan", brandSlug };

  if (existsSync(path.join(COMP_DIR, `${brandSlug}.json`))) {
    return { slug: brandSlug, routed_via: "direct", brandSlug };
  }
  const alias = maps.aliases[brandSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias", brandSlug };
  }
  const parent = maps.parents[brandSlug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent", brandSlug };
  }
  return { slug: null, routed_via: "orphan", brandSlug };
}

// Merge a single signal payload into the per-company aggregate map.
function applySignals(map, slug, src, payload, routedVia) {
  if (!map.has(slug)) {
    map.set(slug, {
      sources: [],
      sourceUrls: {},
      signals: {},
      routedVia,
      contributingBrands: [], // for mixed-portfolio detection
    });
  }
  const entry = map.get(slug);
  for (const k of src.sources || []) {
    if (!entry.sources.includes(k)) entry.sources.push(k);
  }
  Object.assign(entry.sourceUrls, src.sourceUrls || {});
  entry.contributingBrands.push({
    brand: src.brand,
    routedVia,
    signals: { ...payload },
  });

  // Routed-via precedence: direct beats alias beats parent.
  const RANK = { direct: 0, alias: 1, parent: 2 };
  if (RANK[routedVia] < RANK[entry.routedVia ?? "parent"]) {
    entry.routedVia = routedVia;
  }

  for (const [k, v] of Object.entries(payload)) {
    if (k === "cageFreeCommitment") {
      const cur = entry.signals.cageFreeCommitment || { committed: false, deadline: null, progress: null };
      entry.signals.cageFreeCommitment = {
        committed: cur.committed || !!v.committed,
        deadline: (cur.deadline && v.deadline) ? Math.min(cur.deadline, v.deadline) : (cur.deadline || v.deadline || null),
        progress: (cur.progress != null && v.progress != null) ? Math.max(cur.progress, v.progress) : (cur.progress ?? v.progress ?? null),
      };
    } else if (k === "farmAnimalWelfareTier") {
      const cur = entry.signals.farmAnimalWelfareTier;
      entry.signals.farmAnimalWelfareTier = (cur && cur < v) ? cur : v;
    } else if (k === "petaDoTest" || k === "_petaDoTest") {
      // negative signal — accumulate
      entry.signals.petaDoTest = entry.signals.petaDoTest || v;
    } else {
      if (v === true) entry.signals[k] = true;
      else if (entry.signals[k] !== true) entry.signals[k] = !!v;
    }
  }
}

async function main() {
  const now = new Date();
  console.log("Animal-welfare union merge starting...");

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run animal-welfare-union-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  const lb  = await tryReadJson(LB_FILE);
  const peta = await tryReadJson(PETA_FILE);

  const maps = await loadMaps();
  const perCompany = new Map();
  const orphans = [];

  // -------- Union sources (6 new) --------
  for (const e of raw?.entries || []) {
    const { slug: target, routed_via, brandSlug } = resolveSlug(e.brand, maps);
    const src = {
      brand: e.brand,
      sources: e.sources,
      sourceUrls: e.source_urls || {},
    };
    if (!target) {
      orphans.push({ brand: e.brand, parent_company: e.parent_company || null, sources: e.sources });
      continue;
    }
    applySignals(perCompany, target, src, e.signals, routed_via);
  }

  // -------- Leaping Bunny (existing pipeline) — positive crueltyFreeCertified --------
  for (const b of lb?.certified_brands || []) {
    const { slug: target, routed_via } = resolveSlug(b.brand, maps);
    if (!target) {
      orphans.push({ brand: b.brand, parent_company: b.parent_company || null, sources: ["leaping-bunny"] });
      continue;
    }
    applySignals(perCompany, target,
      { brand: b.brand, sources: ["leaping-bunny"],
        sourceUrls: { "leaping-bunny": "https://www.leapingbunny.org/shopping-guide" } },
      { crueltyFreeCertified: true },
      routed_via,
    );
  }

  // -------- PETA dont_test (positive) --------
  for (const b of peta?.dont_test || []) {
    const { slug: target, routed_via } = resolveSlug(b.brand, maps);
    if (!target) {
      orphans.push({ brand: b.brand, parent_company: b.parent_company || null, sources: ["peta-bwb-dont-test"] });
      continue;
    }
    applySignals(perCompany, target,
      { brand: b.brand, sources: ["peta-bwb"],
        sourceUrls: { "peta-bwb": "https://crueltyfree.peta.org/companies-dont-test-on-animals/" } },
      { crueltyFreeCertified: true },
      routed_via,
    );
  }

  // -------- PETA do_test (negative) — tracked for mixed-portfolio detection --------
  for (const b of peta?.do_test || []) {
    const { slug: target, routed_via } = resolveSlug(b.brand, maps);
    if (!target) {
      orphans.push({ brand: b.brand, parent_company: b.parent_company || null, sources: ["peta-bwb-do-test"] });
      continue;
    }
    applySignals(perCompany, target,
      { brand: b.brand, sources: ["peta-bwb"],
        sourceUrls: { "peta-bwb": "https://crueltyfree.peta.org/companies-do-test-on-animals/" } },
      { petaDoTest: true },
      routed_via,
    );
  }

  // ─── Mixed-portfolio reconciliation ─────────────────────────────────────
  //
  // Rule: A parent inherits crueltyFreeCertified=true ONLY when every routed-
  // via-parent contributor is positive AND no contributor (whether direct or
  // routed-via-parent) flags petaDoTest=true. If both signals show up under
  // the same parent slug, we strip crueltyFreeCertified and set
  // mixedPortfolio=true with a note listing the conflicting brands.
  //
  // This protects against the J&J-Aveeno problem the spec calls out.
  const mixedPortfolioParents = [];
  for (const [slug, entry] of perCompany.entries()) {
    const certifiedBrands = entry.contributingBrands.filter(c =>
      c.signals.crueltyFreeCertified === true
    );
    const doTestBrands = entry.contributingBrands.filter(c =>
      c.signals.petaDoTest === true
    );
    const hasAnyParentRoute = entry.contributingBrands.some(c => c.routedVia === "parent");

    const conflict =
      entry.signals.crueltyFreeCertified === true &&
      entry.signals.petaDoTest === true;

    // Also: if cruelty-free signal came ONLY via parent-routing (no direct hit
    // on the parent itself) AND any sibling contributor flags do_test, we
    // still consider the parent mixed.
    const onlyInheritedCertification =
      hasAnyParentRoute &&
      !entry.contributingBrands.some(c => c.routedVia === "direct" && c.signals.crueltyFreeCertified === true);

    if (conflict || (onlyInheritedCertification && doTestBrands.length > 0)) {
      mixedPortfolioParents.push({
        slug,
        certified_brands: certifiedBrands.map(c => c.brand),
        do_test_brands: doTestBrands.map(c => c.brand),
        note: "Sub-brands span certified + do-test; parent flagged mixedPortfolio instead of inheriting cruelty-free=true.",
      });
      delete entry.signals.crueltyFreeCertified;
      entry.signals.mixedPortfolio = true;
    }
    // Always drop the internal petaDoTest marker before serializing.
    delete entry.signals.petaDoTest;
  }

  // ─── Serialize companies block ──────────────────────────────────────────
  const companies = {};
  for (const [slug, entry] of perCompany.entries()) {
    // Skip companies whose signals collapsed to nothing useful.
    if (Object.keys(entry.signals).length === 0) continue;
    companies[slug] = {
      ...entry.signals,
      sources: entry.sources,
      sourceUrls: entry.sourceUrls,
      routedVia: entry.routedVia,
      lastUpdated: now.toISOString(),
    };
  }

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const payload = {
    _license: "Public membership/certification lists; cite per-source URLs.",
    _source_files: [
      path.relative(ROOT, rawFile),
      "public/data/_raw/leaping-bunny.json",
      "public/data/_raw/peta-bwb.json",
    ],
    _generated_at: now.toISOString(),
    _stats: {
      matched_companies: Object.keys(companies).length,
      mixed_portfolio_parents: mixedPortfolioParents.length,
      orphan_count: orphans.length,
      cruelty_free_certified: Object.values(companies).filter(c => c.crueltyFreeCertified).length,
      vegan_trademark: Object.values(companies).filter(c => c.veganTrademark).length,
      farm_animal_welfare_tiered: Object.values(companies).filter(c => c.farmAnimalWelfareTier).length,
      cage_free_committed: Object.values(companies).filter(c => c.cageFreeCommitment?.committed).length,
    },
    companies,
    mixed_portfolio_parents: mixedPortfolioParents,
    orphans: orphans.slice(0, 500), // cap orphan list to keep file readable
    orphan_total: orphans.length,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));

  console.log(`\nMatched companies:        ${payload._stats.matched_companies}`);
  console.log(`Cruelty-free certified:   ${payload._stats.cruelty_free_certified}`);
  console.log(`Vegan Trademark:          ${payload._stats.vegan_trademark}`);
  console.log(`Farm-animal-welfare tier: ${payload._stats.farm_animal_welfare_tiered}`);
  console.log(`Cage-free committed:      ${payload._stats.cage_free_committed}`);
  console.log(`Mixed-portfolio parents:  ${payload._stats.mixed_portfolio_parents}`);
  console.log(`Orphans:                  ${payload._stats.orphan_count}`);
  console.log(`\nWrote ${OUT_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("animal-welfare-union-merge failed:", err);
    process.exit(1);
  });
}
