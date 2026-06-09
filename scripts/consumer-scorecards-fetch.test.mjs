#!/usr/bin/env node
/**
 * Tests for the round-4 consolidated consumer-scorecards fetcher + merger.
 *
 *   node --test scripts/consumer-scorecards-fetch.test.mjs
 *
 * Covers:
 *   - fetcher corpus integrity (every entry has a known source key,
 *     every source has ≥ 1 entry, priority brands present)
 *   - merger classifier (Goods Unite Us lean, Good On You ladder,
 *     Ethical Consumer + As You Sow, ADL letter grades, buycott
 *     cause-routing, drawdown positive)
 *   - merger severity rollup (concern + leader → mixed)
 *   - merger slug resolution (slugHint, direct, alias, parent)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS, validateEntries } from "./consumer-scorecards-fetch.mjs";
import {
  slugify,
  classify,
  rollupSeverity,
  resolveBrand,
} from "./consumer-scorecards-merge.mjs";

/* ─────────────────── fetcher corpus integrity ──────────────────────── */

test("every entry references a known source key", () => {
  const errs = validateEntries(ENTRIES);
  assert.deepEqual(errs, []);
});

test("corpus covers every declared source family", () => {
  const seen = new Set(ENTRIES.map(e => e.source));
  for (const k of Object.keys(SOURCE_URLS)) {
    assert.ok(seen.has(k), `Missing entries for source: ${k}`);
  }
});

test("priority brands appear in the corpus", () => {
  const PRIORITY = [
    "Patagonia", "Costco", "Walmart", "Amazon", "Home Depot",
    "Hobby Lobby", "Chick-fil-A", "ExxonMobil", "Chevron",
    "Nestlé", "Coca-Cola", "PepsiCo", "Shein", "Boohoo",
    "Lululemon", "Nike", "Allbirds",
    "Lockheed Martin", "Smith & Wesson", "CoreCivic",
    "Tesla", "Beyond Meat",
    "Meta", "X",
  ];
  const brandSet = new Set(ENTRIES.map(e => e.brand));
  for (const b of PRIORITY) {
    assert.ok(brandSet.has(b), `Priority brand missing: ${b}`);
  }
});

test("corpus has ≥ 150 entries spanning ≥ 8 sources", () => {
  assert.ok(ENTRIES.length >= 150, `Expected ≥150 entries, got ${ENTRIES.length}`);
  assert.ok(new Set(ENTRIES.map(e => e.source)).size >= 8);
});

/* ─────────────────── classifier behaviour ──────────────────────────── */

test("classify Goods Unite Us — A grade → left lean", () => {
  const r = classify({ source: "goods-unite-us", tier: "A" });
  assert.equal(r.perCategory.political.sc, "left");
});

test("classify Goods Unite Us — B grade → left-leaning", () => {
  const r = classify({ source: "goods-unite-us", tier: "B" });
  assert.equal(r.perCategory.political.sc, "left-leaning");
});

test("classify Goods Unite Us — C grade → bipartisan", () => {
  const r = classify({ source: "goods-unite-us", tier: "C" });
  assert.equal(r.perCategory.political.sc, "bipartisan");
});

test("classify Goods Unite Us — D grade → right-leaning", () => {
  const r = classify({ source: "goods-unite-us", tier: "D" });
  assert.equal(r.perCategory.political.sc, "right-leaning");
});

test("classify Goods Unite Us — F grade → right", () => {
  const r = classify({ source: "goods-unite-us", tier: "F" });
  assert.equal(r.perCategory.political.sc, "right");
});

test("classify Ethical Consumer ladder", () => {
  assert.equal(classify({ source: "ethical-consumer", tier: "Best Buy" }).perCategory.environment.severity, "leader");
  assert.equal(classify({ source: "ethical-consumer", tier: "Recommended" }).perCategory.environment.severity, "positive");
  assert.equal(classify({ source: "ethical-consumer", tier: "Avoid" }).perCategory.environment.severity, "concern");
});

test("classify DoneGood marketplace → positive env + labor", () => {
  const r = classify({ source: "donegood", tier: "Marketplace" });
  assert.equal(r.perCategory.environment.severity, "positive");
  assert.equal(r.perCategory.labor.severity, "positive");
});

test("classify Good On You ladder", () => {
  assert.equal(classify({ source: "goodonyou", tier: "Great" }).perCategory.environment.severity, "leader");
  assert.equal(classify({ source: "goodonyou", tier: "Good" }).perCategory.environment.severity, "positive");
  assert.equal(classify({ source: "goodonyou", tier: "It's a Start" }).perCategory.environment.severity, "mixed");
  assert.equal(classify({ source: "goodonyou", tier: "Not Good Enough" }).perCategory.environment.severity, "concern");
  assert.equal(classify({ source: "goodonyou", tier: "We Avoid" }).perCategory.environment.severity, "concern");
});

test("classify Good On You writes to environment, labor, animals", () => {
  const r = classify({ source: "goodonyou", tier: "Great" });
  assert.ok(r.perCategory.environment);
  assert.ok(r.perCategory.labor);
  assert.ok(r.perCategory.animals);
});

test("classify buycott always writes political (mixed)", () => {
  const r = classify({ source: "buycott", tier: "Avoid (Generic)", cause: "anything" });
  assert.equal(r.perCategory.political.severity, "mixed");
  assert.equal(r.perCategory.political.sc, "controversial");
});

test("classify buycott climate cause adds environment concern", () => {
  const r = classify({ source: "buycott", tier: "Avoid (Climate)", cause: "climate denial" });
  assert.ok(r.perCategory.environment);
  assert.equal(r.perCategory.environment.severity, "concern");
});

test("classify buycott firearm cause adds guns sells_guns", () => {
  const r = classify({ source: "buycott", tier: "Avoid (Firearms)", cause: "firearm retail" });
  assert.equal(r.perCategory.guns.sc, "sells_guns");
});

test("classify buycott animal-testing cause adds animals mixed", () => {
  const r = classify({ source: "buycott", tier: "Avoid (Animal testing)", cause: "animal testing" });
  assert.equal(r.perCategory.animals.severity, "mixed");
});

test("classify As You Sow Fossil-Free fail → environment concern", () => {
  const r = classify({ source: "as-you-sow-funds", tier: "Fossil-Free fail" });
  assert.equal(r.perCategory.environment.severity, "concern");
});

test("classify As You Sow Tobacco-Free fail → health concern", () => {
  const r = classify({ source: "as-you-sow-funds", tier: "Tobacco-Free fail" });
  assert.equal(r.perCategory.health.severity, "concern");
});

test("classify As You Sow Civilian Firearm fail → guns makes_guns", () => {
  const r = classify({ source: "as-you-sow-funds", tier: "Civilian Firearm fail" });
  assert.equal(r.perCategory.guns.sc, "makes_guns");
});

test("classify As You Sow Weapons-Free fail → guns makes_weapons", () => {
  const r = classify({ source: "as-you-sow-funds", tier: "Weapons-Free fail" });
  assert.equal(r.perCategory.guns.sc, "makes_weapons");
});

test("classify As You Sow Prison-Free fail → labor concern", () => {
  const r = classify({ source: "as-you-sow-funds", tier: "Prison-Free fail" });
  assert.equal(r.perCategory.labor.severity, "concern");
});

test("classify As You Sow Gender Equality leader → dei positive (pro_dei)", () => {
  const r = classify({ source: "as-you-sow-funds", tier: "Gender Equality leader" });
  assert.equal(r.perCategory.dei.severity, "positive");
  assert.equal(r.perCategory.dei.sc, "pro_dei");
});

test("classify Fossil Free Funds CU200 → environment concern", () => {
  const r = classify({ source: "fossil-free-funds", tier: "Carbon Underground 200" });
  assert.equal(r.perCategory.environment.severity, "concern");
});

test("classify ADL tech letter ladder", () => {
  assert.equal(classify({ source: "adl-tech", tier: "ADL F"  }).perCategory.privacy.severity, "concern");
  assert.equal(classify({ source: "adl-tech", tier: "ADL D"  }).perCategory.privacy.severity, "concern");
  assert.equal(classify({ source: "adl-tech", tier: "ADL C"  }).perCategory.privacy.severity, "mixed");
  assert.equal(classify({ source: "adl-tech", tier: "ADL B"  }).perCategory.privacy.severity, "positive");
  assert.equal(classify({ source: "adl-tech", tier: "ADL A"  }).perCategory.privacy.severity, "leader");
});

test("classify Drawdown Solutions → environment positive", () => {
  const r = classify({ source: "drawdown-solutions", tier: "Electric Vehicles" });
  assert.equal(r.perCategory.environment.severity, "positive");
});

/* ─────────────────── severity rollup ──────────────────────────────── */

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

/* ─────────────────── slug resolution ──────────────────────────────── */

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
    { brand: "Patagonia" },
    { knownSlugs: new Set(["patagonia"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "patagonia");
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
    { brand: "Whole Foods" },
    {
      knownSlugs: new Set(["amazon"]),
      aliases: {},
      parents: { "whole-foods": { parent: "amazon" } },
    },
  );
  assert.equal(r.slug, "amazon");
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
  assert.equal(slugify("Ben & Jerry's"), "ben-and-jerrys");
  assert.equal(slugify("Häagen-Dazs"), "haagen-dazs");
  assert.equal(slugify("Nestlé"), "nestle");
});
