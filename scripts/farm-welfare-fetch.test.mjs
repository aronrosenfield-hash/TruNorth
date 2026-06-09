#!/usr/bin/env node
/**
 * Tests for the consolidated farm-animal welfare + sustainable agriculture
 * pipeline.
 *
 *   node --test scripts/farm-welfare-fetch.test.mjs
 *
 * Covers:
 *   - fetcher corpus integrity (per-source counts, source-URL coverage,
 *     priority-brand presence)
 *   - merger classifier (BBFAW tiers, FAIRR risk levels, GAP steps, etc.)
 *   - merger severity rollup (concern + leader → mixed)
 *   - merger slug resolution (slugHint, direct, alias, parent)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS } from "./farm-welfare-fetch.mjs";
import {
  slugify,
  classify,
  rollupSeverity,
  resolveBrand,
} from "./farm-welfare-merge.mjs";

/* ───────────────────────── fetcher corpus integrity ──────────────────── */

test("every entry references a known source key", () => {
  for (const e of ENTRIES) {
    assert.ok(SOURCE_URLS[e.source], `Unknown source: ${e.source} (${e.brand})`);
  }
});

test("corpus covers all 13 source families", () => {
  const seen = new Set(ENTRIES.map(e => e.source));
  for (const k of Object.keys(SOURCE_URLS)) {
    assert.ok(seen.has(k), `Missing entries for source: ${k}`);
  }
});

test("priority brands appear in the corpus", () => {
  const PRIORITY = [
    "Tyson Foods", "JBS S.A.", "Cargill", "Cal-Maine Foods", "Hormel Foods",
    "Kraft Heinz", "McDonald's", "Burger King", "Chipotle", "Starbucks",
    "Whole Foods Market", "Trader Joe's", "Costco",
  ];
  const brandSet = new Set(ENTRIES.map(e => e.brand));
  for (const b of PRIORITY) {
    assert.ok(brandSet.has(b), `Priority brand missing: ${b}`);
  }
});

test("Aldi appears via either 'Aldi' or 'Aldi Süd' or 'Aldi US'", () => {
  // Aldi is split across Aldi Nord / Süd / US; corpus uses multiple display
  // names but all should slugHint to 'aldi'.
  const aldiEntries = ENTRIES.filter(e =>
    /^Aldi/.test(e.brand) && e.slugHint === "aldi");
  assert.ok(aldiEntries.length >= 2, "Expected ≥2 Aldi entries");
});

/* ───────────────────────── classifier behaviour ──────────────────────── */

test("classify BBFAW tier → severity ladder", () => {
  assert.equal(classify({ source: "bbfaw", tier: "Tier 6" }).severity, "concern");
  assert.equal(classify({ source: "bbfaw", tier: "Tier 5" }).severity, "mixed");
  assert.equal(classify({ source: "bbfaw", tier: "Tier 4" }).severity, "mixed");
  assert.equal(classify({ source: "bbfaw", tier: "Tier 3" }).severity, "positive");
  assert.equal(classify({ source: "bbfaw", tier: "Tier 2" }).severity, "leader");
  assert.equal(classify({ source: "bbfaw", tier: "Tier 1" }).severity, "leader");
});

test("classify FAIRR risk → severity ladder", () => {
  assert.equal(classify({ source: "fairr", tier: "High risk" }).severity, "concern");
  assert.equal(classify({ source: "fairr", tier: "Medium risk" }).severity, "mixed");
  assert.equal(classify({ source: "fairr", tier: "Low risk" }).severity, "leader");
});

test("classify GAP Step 4+ = leader; Step 3 = positive", () => {
  assert.equal(classify({ source: "gap", tier: "Step 5+" }).severity, "leader");
  assert.equal(classify({ source: "gap", tier: "Step 4" }).severity, "leader");
  assert.equal(classify({ source: "gap", tier: "Step 3" }).severity, "positive");
});

test("classify OWA tiers", () => {
  assert.equal(classify({ source: "owa", tier: "Fulfilled (100%)" }).severity, "leader");
  assert.equal(classify({ source: "owa", tier: "On track" }).severity, "positive");
  assert.equal(classify({ source: "owa", tier: "At risk" }).severity, "concern");
  assert.equal(classify({ source: "owa", tier: "Broken pledge" }).severity, "concern");
});

test("classify MSC / ASC / Real-Organic / ROC / Demeter = leader", () => {
  for (const src of ["msc", "asc", "real-organic", "regen-organic", "demeter"]) {
    assert.equal(classify({ source: src }).severity, "leader", src);
  }
});

test("classify multi-category outputs", () => {
  // FAIRR High risk touches animals + labor + environment
  const c = classify({ source: "fairr", tier: "High risk" });
  assert.ok(c.categories.includes("animals"));
  assert.ok(c.categories.includes("labor"));
  assert.ok(c.categories.includes("environment"));
  // Fairwear → labor only
  assert.deepEqual(classify({ source: "fairwear" }).categories, ["labor"]);
  // Bonsucro → environment only
  assert.deepEqual(classify({ source: "bonsucro" }).categories, ["environment"]);
});

/* ───────────────────────── severity rollup ───────────────────────────── */

test("rollupSeverity: concern alone → concern", () => {
  assert.equal(rollupSeverity(["concern"]), "concern");
  assert.equal(rollupSeverity(["concern", "concern"]), "concern");
});

test("rollupSeverity: concern + leader → mixed", () => {
  assert.equal(rollupSeverity(["concern", "leader"]), "mixed");
  assert.equal(rollupSeverity(["leader", "concern"]), "mixed");
  assert.equal(rollupSeverity(["concern", "leader", "leader"]), "mixed");
});

test("rollupSeverity: leader + positive → leader", () => {
  assert.equal(rollupSeverity(["positive", "leader"]), "leader");
  assert.equal(rollupSeverity(["leader", "positive", "positive"]), "leader");
});

test("rollupSeverity: only positives → positive", () => {
  assert.equal(rollupSeverity(["positive"]), "positive");
  assert.equal(rollupSeverity(["positive", "positive"]), "positive");
});

test("rollupSeverity: empty → null", () => {
  assert.equal(rollupSeverity([]), null);
  assert.equal(rollupSeverity(null), null);
});

/* ───────────────────────── slug resolution ───────────────────────────── */

test("resolveBrand: slugHint wins when present + valid", () => {
  const knownSlugs = new Set(["jbs-n-v"]);
  const r = resolveBrand(
    { brand: "JBS S.A.", slugHint: "jbs-n-v" },
    { knownSlugs, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "jbs-n-v");
  assert.equal(r.routedVia, "slugHint");
});

test("resolveBrand: slugHint ignored if not in knownSlugs (falls back)", () => {
  const knownSlugs = new Set(["tyson-foods"]);
  const r = resolveBrand(
    { brand: "Tyson Foods", slugHint: "tyson" },
    { knownSlugs, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "tyson-foods");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: alias resolution", () => {
  const knownSlugs = new Set(["mcdonald-s"]);
  const aliases = { "mcdonalds": "mcdonald-s" };
  const r = resolveBrand(
    { brand: "McDonald's" }, // slugifies to "mcdonalds"
    { knownSlugs, aliases, parents: {} },
  );
  // "McDonald's" → slugify → "mcdonalds" via apostrophe strip
  assert.ok(r.slug === "mcdonald-s" || r.routedVia === "alias", `got ${JSON.stringify(r)}`);
});

test("resolveBrand: orphan when nothing matches", () => {
  const knownSlugs = new Set(["something-else"]);
  const r = resolveBrand(
    { brand: "Unknown Brand Co" },
    { knownSlugs, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

/* ───────────────────────── slugify primitive ─────────────────────────── */

test("slugify: handles apostrophes + ampersand", () => {
  assert.equal(slugify("Wendy's"), "wendys");
  assert.equal(slugify("Ben & Jerry's"), "ben-and-jerrys");
});
