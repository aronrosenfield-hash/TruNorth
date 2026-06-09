/**
 * Tests for scripts/insure-our-future-fetch.mjs + merge.
 *   node --test scripts/insure-our-future-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS, build } from "./insure-our-future-fetch.mjs";
import { tierToSeverity, resolveBrand } from "./insure-our-future-merge.mjs";

test("ENTRIES: has at least 25 named insurers", () => {
  assert.ok(ENTRIES.length >= 25, `expected ≥25 insurers, got ${ENTRIES.length}`);
});

test("ENTRIES: every row has valid score + tier + summary", () => {
  for (const e of ENTRIES) {
    assert.ok(e.brand);
    assert.ok(typeof e.score === "number" && e.score >= 0 && e.score <= 10);
    assert.ok(["leading","progressing","weak","very-weak"].includes(e.tier));
    assert.ok(e.year === 2024);
    assert.ok(e.summary && e.summary.length <= 400);
  }
});

test("ENTRIES: tier monotonic w/ score thresholds", () => {
  for (const e of ENTRIES) {
    if (e.tier === "leading")     assert.ok(e.score >= 5.0, `${e.brand} leading but ${e.score}`);
    if (e.tier === "very-weak")   assert.ok(e.score < 1.0, `${e.brand} very-weak but ${e.score}`);
  }
});

test("SOURCE_URLS: all https", () => {
  for (const v of Object.values(SOURCE_URLS)) assert.ok(/^https:/.test(v));
});

test("tierToSeverity: thresholds", () => {
  assert.equal(tierToSeverity("leading", 6), "positive");
  assert.equal(tierToSeverity("progressing", 4), "mixed");
  assert.equal(tierToSeverity("weak", 2), "concern");
  assert.equal(tierToSeverity("very-weak", 0.4), "landmark");
});

test("build() with limit shape", async () => {
  const out = await build({ limit: 3 });
  assert.equal(out.entries.length, 3);
  assert.ok(out._stats.tier_counts);
  assert.ok(out._license);
});

test("resolveBrand: slugHint wins", () => {
  const known = new Set(["chubb"]);
  const res = resolveBrand({ brand: "Chubb Limited", slugHint: "chubb" }, { knownSlugs: known, aliases: {}, parents: {} });
  assert.equal(res.slug, "chubb");
});

test("resolveBrand: null slugHint → orphan if no other match", () => {
  const res = resolveBrand({ brand: "Aviva", slugHint: null }, { knownSlugs: new Set(), aliases: {}, parents: {} });
  assert.equal(res.slug, null);
});
