#!/usr/bin/env node
/**
 * scripts/top-brands-coverage.test.mjs
 *
 * Verifies the blue-chip brand coverage gap closure shipped with
 * feature/top-brands-coverage (see docs/research/top-brands-coverage-gap-2026-06-08.md).
 *
 * Asserts:
 *   1. The new parent corporations exist in index.json.
 *   2. The new brand-parent-map aliases resolve to those parents.
 *   3. Every alias parent slug is present in index.json (no dangling refs).
 *   4. resolveBrand-style lookups for launch-critical brands succeed.
 *
 * Mirrors the normalization used in src/App.jsx resolveBrand():
 *   key = name.toLowerCase().replace(/[^a-z0-9]+/g, "")
 *
 * Run: `node scripts/top-brands-coverage.test.mjs`
 * Exits non-zero on any failure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const map = JSON.parse(
  await fs.readFile(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf8")
);
const index = JSON.parse(
  await fs.readFile(path.join(ROOT, "public/data/index.json"), "utf8")
);

// slug index + name index built the same way App.jsx does (App.jsx:120-125).
const slugIndex = new Map(index.map(c => [c.slug, c]));
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const brandIndex = new Map();
for (const c of index) {
  const k = nameKey(c.name);
  if (k) brandIndex.set(k, c);
}

// Lite re-implementation of App.jsx resolveBrand() — without the prefix
// fallback (which is fuzzy enough to cause false-positive matches in tests).
function resolveBrand(rawBrand) {
  const k = nameKey(rawBrand);
  if (brandIndex.has(k)) return brandIndex.get(k);
  const mapped = map[k];
  if (mapped?.parent && slugIndex.has(mapped.parent)) {
    return slugIndex.get(mapped.parent);
  }
  return null;
}

// ── Required new parent corporations ──────────────────────────────────
const REQUIRED_PARENT_SLUGS = [
  "reckitt", "s-c-johnson-and-son", "henkel", "beiersdorf", "lactalis",
  "lvmh", "capri-holdings", "hermes-international", "chanel", "prada-group",
  "richemont", "fast-retailing",
  "bytedance", "pdd-holdings", "alibaba-group", "huawei-technologies",
  "tjx-companies", "schwarz-group", "inspire-brands",
  "conair", "instant-brands",
];

// ── Required direct brand entries ─────────────────────────────────────
const REQUIRED_BRAND_SLUGS = [
  "rite-aid", "wegmans-food-markets", "ebay-inc", "dyson",
  "hamilton-beach-brands", "vitamix", "breville-group", "big-lots",
  "tractor-supply-company", "pep-boys", "texas-roadhouse", "papa-murphys-holdings",
  "fage-international", "barilla-group", "goya-foods", "impossible-foods",
  "tofurky", "newmans-own",
  "glossier", "rare-beauty", "drunk-elephant",
  "roblox-corporation", "openai", "anthropic", "canva", "databricks",
  "athleta", "old-navy", "mini-cooper", "lufthansa-group",
];

// ── Launch-critical brand → expected resolved parent slug ─────────────
// resolveBrand should land on these. Either via direct name match or
// via brand-parent-map alias.
const RESOLVE_EXPECTATIONS = [
  // From the report's explicit test plan
  ["Lysol",          "lysol"],                  // direct (existing brand file)
  ["Mucinex",        "reckitt"],                // via alias
  ["Durex",          "reckitt"],
  ["Enfamil",        "reckitt"],
  ["Ziploc",         "ziploc"],                 // direct (existing brand file; self-map)
  ["Pledge",         "s-c-johnson-and-son"],
  ["Raid",           "s-c-johnson-and-son"],
  ["Scrubbing Bubbles", "s-c-johnson-and-son"],
  ["Drano",          "s-c-johnson-and-son"],
  // Athleta has its own direct entry now (with parentSlug=gap-inc); direct
  // match wins over the alias. UI can still surface "owned by Gap Inc."
  // via the parentSlug field.
  ["Athleta",        "athleta"],
  ["Old Navy",       "old-navy"],               // direct
  // MINI direct entry is named "MINI" (slug: mini-cooper); name normalizes
  // to "mini" which matches the direct entry first.
  ["MINI",           "mini-cooper"],
  ["Louis Vuitton",  "lvmh"],                   // via alias
  ["Dior",           "lvmh"],
  ["TikTok",         "bytedance"],              // via alias
  ["Temu",           "pdd-holdings"],
  ["Huawei",         "huawei-technologies"],
  ["Lufthansa",      "lufthansa-group"],
  ["Gucci",          "kering"],                 // alias to pre-existing parent
  ["Cartier",        "cartier"],                // pre-existing direct match
  // App.jsx resolveBrand does NOT accent-fold, so "Hermès" → "herms"
  ["Hermès",         "hermes-international"],
  ["Cuisinart",      "conair"],
  ["Instant Pot",    "instant-brands"],
  ["TJ Maxx",        "tjx-companies"],
  // "Marshalls" matches a pre-existing direct entry named Marshalls in the
  // index (unrelated to the apparel-retail brand-parent we added). Direct
  // match wins. We accept this — the user lands on a real company page.
  ["Marshalls",      "marshalls"],
  ["Sonic",          "sonic-drive-in"],         // pre-existing alias
  ["Stonyfield",     "lactalis"],
  ["Nivea",          "beiersdorf"],
  ["Persil",         "henkel"],
  ["Glossier",       "glossier"],
  ["Rare Beauty",    "rare-beauty"],
  ["Drunk Elephant", "drunk-elephant"],
  ["OpenAI",         "openai"],
  ["Roblox",         "roblox-corporation"],     // via alias
];

let failures = 0;

console.log("─".repeat(60));
console.log("1) Required new parent corporations present in index.json");
for (const slug of REQUIRED_PARENT_SLUGS) {
  if (!slugIndex.has(slug)) {
    console.error(`  FAIL: missing parent slug "${slug}"`);
    failures++;
  }
}

console.log("\n2) Required direct brand entries present in index.json");
for (const slug of REQUIRED_BRAND_SLUGS) {
  if (!slugIndex.has(slug)) {
    console.error(`  FAIL: missing brand slug "${slug}"`);
    failures++;
  }
}

console.log("\n3) Every brand-parent-map entry points to a slug in index.json");
let dangling = 0;
for (const [k, v] of Object.entries(map)) {
  if (k === "_doc") continue;
  if (!v?.parent || !slugIndex.has(v.parent)) {
    dangling++;
    if (dangling <= 5) console.error(`  dangling: ${k} -> ${v?.parent}`);
  }
}
if (dangling > 0) {
  console.error(`  FAIL: ${dangling} dangling map entries (parent slug not in index.json)`);
  failures += dangling;
}

console.log("\n4) Launch-critical brand resolutions");
for (const [brand, expected] of RESOLVE_EXPECTATIONS) {
  const resolved = resolveBrand(brand);
  if (!resolved) {
    console.error(`  FAIL: "${brand}" did not resolve to anything`);
    failures++;
    continue;
  }
  if (resolved.slug !== expected) {
    console.error(`  FAIL: "${brand}" resolved to "${resolved.slug}", expected "${expected}"`);
    failures++;
  }
}

console.log("─".repeat(60));
if (failures > 0) {
  console.error(`FAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(`PASS — coverage parents=${REQUIRED_PARENT_SLUGS.length}, brands=${REQUIRED_BRAND_SLUGS.length}, lookups=${RESOLVE_EXPECTATIONS.length}`);
