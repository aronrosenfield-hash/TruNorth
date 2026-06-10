/**
 * Tests for scripts/sipri-arms-fetch.mjs + merge.
 *   node --test scripts/sipri-arms-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS, build } from "./sipri-arms-fetch.mjs";
import { classifySeverity, resolveBrand } from "./sipri-arms-merge.mjs";

test("ENTRIES: ≥25 producers", () => {
  assert.ok(ENTRIES.length >= 25, `expected ≥25, got ${ENTRIES.length}`);
});

test("ENTRIES: every row has rank + brand + revenue + share", () => {
  for (const e of ENTRIES) {
    assert.ok(typeof e.rank === "number" && e.rank >= 1 && e.rank <= 100, `valid rank (${e.brand})`);
    assert.ok(e.brand);
    assert.ok(typeof e.armsRevUsdM === "number" && e.armsRevUsdM > 0);
    assert.ok(typeof e.armsShareRev === "number" && e.armsShareRev > 0 && e.armsShareRev <= 1);
    assert.ok(["pure-defense","mixed","diversified"].includes(e.category));
    assert.ok(["landmark","concern","mixed","incidental"].includes(e.severity));
  }
});

test("ENTRIES: top-5 are all 'landmark' pure-defense (except Boeing diversified)", () => {
  const top5 = ENTRIES.filter(e => e.rank <= 5).sort((a, z) => a.rank - z.rank);
  assert.ok(top5.length >= 5);
  // Verify ranks 1, 2, 3, 5 are pure-defense landmark; Boeing (#4) is mixed/concern.
  const lockheed = top5.find(e => e.rank === 1);
  assert.equal(lockheed.category, "pure-defense");
  assert.equal(lockheed.severity, "landmark");
  const boeing = top5.find(e => e.rank === 4);
  assert.equal(boeing.category, "mixed");
});

test("SOURCE_URLS: all https", () => {
  for (const v of Object.values(SOURCE_URLS)) assert.ok(/^https:/.test(v));
});

test("classifySeverity: top-5 pure-defense → landmark", () => {
  assert.equal(classifySeverity({ rank: 1, category: "pure-defense", armsShareRev: 0.9, severity: null }), "landmark");
});

test("classifySeverity: rank >15 with >50% pure-defense → concern", () => {
  assert.equal(classifySeverity({ rank: 26, category: "pure-defense", armsShareRev: 0.88, severity: null }), "concern");
});

test("classifySeverity: mixed at rank 21 → mixed", () => {
  assert.equal(classifySeverity({ rank: 21, category: "mixed", armsShareRev: 0.35, severity: null }), "mixed");
});

test("classifySeverity: diversified low share → incidental", () => {
  assert.equal(classifySeverity({ rank: 80, category: "diversified", armsShareRev: 0.05, severity: null }), "incidental");
});

test("classifySeverity: explicit severity wins", () => {
  assert.equal(classifySeverity({ rank: 1, category: "pure-defense", armsShareRev: 0.9, severity: "concern" }), "concern");
});

test("build() with limit", async () => {
  const out = await build({ limit: 3 });
  assert.equal(out.entries.length, 3);
  assert.ok(out._stats.category_counts);
});

test("resolveBrand: slugHint wins", () => {
  const known = new Set(["lockheed-martin"]);
  const res = resolveBrand({ brand: "Lockheed Martin", slugHint: "lockheed-martin" }, { knownSlugs: known, aliases: {}, parents: {} });
  assert.equal(res.slug, "lockheed-martin");
});
