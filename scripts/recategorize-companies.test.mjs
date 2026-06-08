// Tests for scripts/recategorize-companies.mjs.
//
// These run AFTER `node scripts/recategorize-companies.mjs` has been applied
// to the working tree — they read the live index.json + detail files and
// assert the new taxonomy is intact (no "Other", no <20 cats, snapshot brands
// in expected cats, idempotence of decideCat).
//
// Run:
//   node --test scripts/recategorize-companies.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FINAL_CATS,
  MERGE_MAP,
  decideCat,
} from "./recategorize-companies.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH    = path.join(ROOT, "public/data/index.json");
const COMPANIES_DIR = path.join(ROOT, "public/data/companies");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }

const INDEX = readJSON(INDEX_PATH);
const BY_SLUG = new Map(INDEX.map(c => [c.slug, c]));

// ─────────────────────── snapshot brand expectations ───────────────────────

test("Walmart → Retail (unchanged)", () => {
  const c = BY_SLUG.get("walmart");
  assert.ok(c, "walmart present in index");
  assert.equal(c.cat, "Retail");
});

test("Apple → Technology (unchanged)", () => {
  const c = BY_SLUG.get("apple");
  assert.ok(c, "apple present in index");
  assert.equal(c.cat, "Technology");
});

test("Patagonia → Apparel & Fashion (unchanged)", () => {
  const c = BY_SLUG.get("patagonia");
  assert.ok(c, "patagonia present in index");
  assert.equal(c.cat, "Apparel & Fashion");
});

test("Coca-Cola → Food & Beverage (Beverage merged in)", () => {
  // try common slugs
  const c = BY_SLUG.get("coca-cola") || BY_SLUG.get("the-coca-cola-company");
  assert.ok(c, "coca-cola present in index");
  assert.equal(c.cat, "Food & Beverage");
});

test("L'Oreal → Beauty & Personal Care (pulled out of Consumer Goods)", () => {
  // slug observed in index: 'l-or-al' (Estée Lauder is separate)
  const c = BY_SLUG.get("l-or-al");
  assert.ok(c, "l-or-al present in index");
  assert.equal(c.cat, "Beauty & Personal Care");
});

// ─────────────────────── taxonomy integrity ───────────────────────

test("no company has cat = 'Other' / 'na' / null", () => {
  const offenders = INDEX.filter(c =>
    !c.cat || c.cat === "Other" || c.cat === "na"
  );
  assert.equal(offenders.length, 0,
    `${offenders.length} companies still in Other/na: ${offenders.slice(0,5).map(c=>c.slug).join(", ")}`);
});

test("every cat in index is one of the 18 final cats", () => {
  const cats = new Set(INDEX.map(c => c.cat));
  const bad = [...cats].filter(c => !FINAL_CATS.includes(c));
  assert.equal(bad.length, 0, `unexpected cats: ${bad.join(", ")}`);
  assert.equal(cats.size, 18, `expected exactly 18 cats, got ${cats.size}`);
});

test("every cat has ≥20 companies", () => {
  const counts = new Map();
  for (const c of INDEX) counts.set(c.cat, (counts.get(c.cat) || 0) + 1);
  const undersize = [...counts.entries()].filter(([, n]) => n < 20);
  assert.equal(undersize.length, 0,
    `cats below 20-floor: ${undersize.map(([k,n]) => `${k}=${n}`).join(", ")}`);
});

test("'Other' count is exactly 0", () => {
  const others = INDEX.filter(c => c.cat === "Other");
  assert.equal(others.length, 0);
});

// ─────────────────────── detail/index parity ───────────────────────

test("sampling of detail JSONs match index cat", () => {
  const sampleSlugs = [
    "walmart", "apple", "patagonia", "l-or-al",
    "abc",       // formerly Other → Entertainment & Media
    "grail",     // formerly Other → Healthcare
    "open-text", // formerly Other → Technology
  ];
  for (const slug of sampleSlugs) {
    const idx = BY_SLUG.get(slug);
    if (!idx) continue;
    const fp = path.join(COMPANIES_DIR, slug + ".json");
    if (!fs.existsSync(fp)) continue;
    const detail = readJSON(fp);
    assert.equal(detail.cat, idx.cat,
      `cat mismatch for ${slug}: index=${idx.cat} detail=${detail.cat}`);
  }
});

// ─────────────────────── decideCat unit tests ───────────────────────

const OTHER_MAP_PATH  = path.join(__dirname, "_other-cat-reassignments.json");
const BEAUTY_MAP_PATH = path.join(__dirname, "_beauty-pullouts.json");
const otherMap  = readJSON(OTHER_MAP_PATH);  delete otherMap._doc;
const beautyMap = readJSON(BEAUTY_MAP_PATH); delete beautyMap._doc;

test("decideCat: deterministic merges (Telecommunications → Technology)", () => {
  assert.equal(decideCat("Telecommunications", "att", otherMap, beautyMap), "Technology");
  assert.equal(decideCat("Beverage", "pepsi", otherMap, beautyMap), "Food & Beverage");
  assert.equal(decideCat("Airline", "delta", otherMap, beautyMap), "Travel & Transportation");
  assert.equal(decideCat("Outdoor", "rei", otherMap, beautyMap), "Sports & Outdoor");
  assert.equal(decideCat("Aerospace", "boeing", otherMap, beautyMap), "Defense & Aerospace");
  assert.equal(decideCat("Pet Care", "petco", otherMap, beautyMap), "Consumer Goods");
});

test("decideCat: beauty pullout wins over previous cat", () => {
  // l-or-al was Consumer Goods → Beauty & Personal Care via beauty map
  assert.equal(decideCat("Consumer Goods", "l-or-al", otherMap, beautyMap), "Beauty & Personal Care");
});

test("decideCat: Other slug uses curated map", () => {
  assert.equal(decideCat("Other", "abc", otherMap, beautyMap), "Entertainment & Media");
  assert.equal(decideCat("Other", "grail", otherMap, beautyMap), "Healthcare");
  assert.equal(decideCat("na", "abc", otherMap, beautyMap), "Entertainment & Media");
});

test("decideCat: every 'Other' company has a curated mapping (no fallback fires)", () => {
  const others = INDEX.filter(c => c.cat === "Other" || c.cat === "na");
  // After running recategorize-companies, this is 0 in the live index. But
  // we want to assert that the CURATED MAP would have covered them all —
  // load the change log.
  const logPath = path.join(ROOT, "data/derived/_meta/cat-changes-2026-06-08.json");
  if (!fs.existsSync(logPath)) {
    console.warn("[test] skipping curated-map coverage — change log not yet generated");
    return;
  }
  const log = readJSON(logPath);
  const formerOthers = log.changes.filter(c => c.oldCat === "Other" || c.oldCat === "na");
  const uncurated = formerOthers.filter(c => !otherMap[c.slug]);
  assert.equal(uncurated.length, 0,
    `${uncurated.length} formerly-Other slugs were not in _other-cat-reassignments.json (would have hit fallback)`);
});
