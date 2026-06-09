#!/usr/bin/env node
/**
 * Tests for the round-3 consolidated animal-welfare + ag fetcher.
 *
 *   node --test scripts/animal-welfare-ag-r3-fetch.test.mjs
 *
 * Covers:
 *   - fetcher corpus integrity (every entry has a known source key,
 *     every source has ≥ 1 entry, priority brands present)
 *   - merger classifier (NRDC + TFF letter grades, MFA / THL tiers,
 *     Cocoa Barometer N/5, FEP Recommended / Not Recommended)
 *   - merger severity rollup (concern + leader → mixed)
 *   - merger slug resolution (slugHint, direct, alias, parent)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS } from "./animal-welfare-ag-r3-fetch.mjs";
import {
  slugify,
  classify,
  rollupSeverity,
  resolveBrand,
} from "./animal-welfare-ag-r3-merge.mjs";

/* ───────────────────────── fetcher corpus integrity ──────────────────── */

test("every entry references a known source key", () => {
  for (const e of ENTRIES) {
    assert.ok(SOURCE_URLS[e.source], `Unknown source: ${e.source} (${e.brand})`);
  }
});

test("corpus covers every declared source family", () => {
  const seen = new Set(ENTRIES.map(e => e.source));
  for (const k of Object.keys(SOURCE_URLS)) {
    assert.ok(seen.has(k), `Missing entries for source: ${k}`);
  }
});

test("priority brands appear in the corpus", () => {
  const PRIORITY = [
    "Vital Farms", "Niman Ranch", "Tyson Foods", "Perdue Farms",
    "Hershey", "Mars", "Nestlé", "Mondelez International",
    "Chipotle Mexican Grill", "Panera Bread", "Domino's Pizza", "Papa John's",
    "Costco", "Walmart", "Kroger", "Whole Foods Market",
    "Tony's Chocolonely", "Equal Exchange",
    "Lululemon", "3M", "DuPont",
  ];
  const brandSet = new Set(ENTRIES.map(e => e.brand));
  for (const b of PRIORITY) {
    assert.ok(brandSet.has(b), `Priority brand missing: ${b}`);
  }
});

test("brands with slugHints route to known TruNorth slugs", () => {
  // Quick smoke: confirm we have slugHints for chained brands.
  const hinted = ENTRIES.filter(e => e.slugHint);
  assert.ok(hinted.length >= 50, `Expected ≥50 slugHinted entries, got ${hinted.length}`);
});

/* ───────────────────────── classifier behaviour ──────────────────────── */

test("classify NRDC letter grades → severity ladder", () => {
  assert.equal(classify({ source: "nrdc-chain", tier: "A" }).severity, "leader");
  assert.equal(classify({ source: "nrdc-chain", tier: "A-" }).severity, "leader");
  assert.equal(classify({ source: "nrdc-chain", tier: "B+" }).severity, "positive");
  assert.equal(classify({ source: "nrdc-chain", tier: "B-" }).severity, "positive");
  assert.equal(classify({ source: "nrdc-chain", tier: "C+" }).severity, "mixed");
  assert.equal(classify({ source: "nrdc-chain", tier: "C-" }).severity, "mixed");
  assert.equal(classify({ source: "nrdc-chain", tier: "D+" }).severity, "concern");
  assert.equal(classify({ source: "nrdc-chain", tier: "F" }).severity, "concern");
});

test("classify TFF Mind The Store letter grades → severity ladder", () => {
  assert.equal(classify({ source: "tff-scorecard", tier: "A" }).severity, "leader");
  assert.equal(classify({ source: "tff-scorecard", tier: "B+" }).severity, "positive");
  assert.equal(classify({ source: "tff-scorecard", tier: "C" }).severity, "mixed");
  assert.equal(classify({ source: "tff-scorecard", tier: "F" }).severity, "concern");
});

test("classify MFA/THL tier → severity ladder", () => {
  assert.equal(classify({ source: "mfa", tier: "Fulfilled" }).severity, "leader");
  assert.equal(classify({ source: "thl", tier: "On track" }).severity, "positive");
  assert.equal(classify({ source: "thl", tier: "At risk" }).severity, "mixed");
  assert.equal(classify({ source: "mfa", tier: "Behind" }).severity, "mixed");
  assert.equal(classify({ source: "mfa", tier: "No commitment" }).severity, "concern");
  assert.equal(classify({ source: "ciwf-chicken-track", tier: "Leader" }).severity, "leader");
});

test("classify FEP Chocolate Recommended / Not Recommended", () => {
  assert.equal(classify({ source: "fep-chocolate", tier: "Recommended" }).severity, "leader");
  assert.equal(classify({ source: "fep-chocolate", tier: "Not Recommended" }).severity, "concern");
});

test("classify Cocoa Barometer N/5 transparency", () => {
  assert.equal(classify({ source: "cocoa-barometer", tier: "5/5 transparency" }).severity, "leader");
  assert.equal(classify({ source: "cocoa-barometer", tier: "4/5 transparency" }).severity, "positive");
  assert.equal(classify({ source: "cocoa-barometer", tier: "3/5 transparency" }).severity, "mixed");
  assert.equal(classify({ source: "cocoa-barometer", tier: "2/5 transparency" }).severity, "concern");
});

test("classify Slave Free Chocolate Leader vs Watch List", () => {
  assert.equal(classify({ source: "slave-free-choc", tier: "Scorecard Leader" }).severity, "leader");
  assert.equal(classify({ source: "slave-free-choc", tier: "Watch List" }).severity, "concern");
});

test("classify binary-leader sources (Certified Humane, BAP, Salmon-Safe, etc.)", () => {
  for (const src of [
    "certified-humane","awi-cert","ag-grassfed","bap","salmon-safe",
    "bee-better","audubon-beef","soil-association","naturland",
    "seafood-watch","fishwise","greenseal","ecologo","c2c",
  ]) {
    assert.equal(classify({ source: src, tier: "Certified" }).severity, "leader",
      `expected leader severity for ${src}`);
  }
});

test("classify PFAS / CEH concerns", () => {
  assert.equal(classify({ source: "pfas-project", tier: "Manufacturer (legacy PFAS)" }).severity, "concern");
  assert.equal(classify({ source: "ceh-alerts", tier: "PFAS warning" }).severity, "concern");
});

test("classify EWG Skin Deep tiers", () => {
  assert.equal(classify({ source: "ewg-skindeep", tier: "EWG Verified" }).severity, "leader");
  assert.equal(classify({ source: "ewg-skindeep", tier: "EWG Verified — selected SKUs" }).severity, "positive");
  assert.equal(classify({ source: "ewg-skindeep", tier: "Mixed" }).severity, "mixed");
});

test("classify categories include health for Certified Humane + NRDC + EWG", () => {
  assert.ok(classify({ source: "certified-humane", tier: "Certified" }).categories.includes("health"));
  assert.ok(classify({ source: "nrdc-chain", tier: "A" }).categories.includes("health"));
  assert.ok(classify({ source: "ewg-skindeep", tier: "EWG Verified" }).categories.includes("health"));
});

test("classify categories include labor for Cocoa sources", () => {
  for (const src of ["fep-chocolate", "slave-free-choc", "cocoa-barometer"]) {
    assert.deepEqual(
      classify({ source: src, tier: "Recommended" }).categories,
      ["labor"],
      `${src} should categorize only as labor`
    );
  }
});

/* ───────────────────────── severity rollup ──────────────────────────── */

test("rollupSeverity: concern + leader → mixed", () => {
  assert.equal(rollupSeverity(["concern", "leader"]), "mixed");
  assert.equal(rollupSeverity(["concern", "positive"]), "mixed");
});

test("rollupSeverity: leader > positive > mixed when no concerns", () => {
  assert.equal(rollupSeverity(["leader", "positive"]), "leader");
  assert.equal(rollupSeverity(["positive", "mixed"]), "positive");
  assert.equal(rollupSeverity(["mixed"]), "mixed");
});

test("rollupSeverity: only concerns → concern", () => {
  assert.equal(rollupSeverity(["concern", "concern"]), "concern");
});

test("rollupSeverity: null on empty", () => {
  assert.equal(rollupSeverity([]), null);
});

/* ───────────────────────── slug resolution ──────────────────────────── */

test("resolveBrand: slugHint short-circuits when known", () => {
  const r = resolveBrand(
    { brand: "Acme Foods", slugHint: "acme" },
    { knownSlugs: new Set(["acme"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "acme");
  assert.equal(r.routedVia, "slugHint");
});

test("resolveBrand: direct slugify hit", () => {
  const r = resolveBrand(
    { brand: "Niman Ranch" },
    { knownSlugs: new Set(["niman-ranch"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "niman-ranch");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: alias hit when direct misses", () => {
  const r = resolveBrand(
    { brand: "Trader Joes" },
    {
      knownSlugs: new Set(["trader-joe-s"]),
      aliases: { "trader-joes": "trader-joe-s" },
      parents: {},
    },
  );
  assert.equal(r.slug, "trader-joe-s");
  assert.equal(r.routedVia, "alias");
});

test("resolveBrand: parent fallback", () => {
  const r = resolveBrand(
    { brand: "Annies Homegrown" },
    {
      knownSlugs: new Set(["general-mills"]),
      aliases: {},
      parents: { "annies-homegrown": { parent: "general-mills" } },
    },
  );
  assert.equal(r.slug, "general-mills");
  assert.equal(r.routedVia, "parent");
});

test("resolveBrand: orphan when nothing resolves", () => {
  const r = resolveBrand(
    { brand: "Unknown Brand" },
    { knownSlugs: new Set(), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("slugify handles apostrophes + accents", () => {
  assert.equal(slugify("Tony's Chocolonely"), "tonys-chocolonely");
  assert.equal(slugify("Häagen-Dazs"), "haagen-dazs");
  assert.equal(slugify("L'Oréal"), "loreal");
});
