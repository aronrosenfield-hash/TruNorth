#!/usr/bin/env node
/**
 * Test harness for cr-auto-reliability-{fetch,merge}.mjs.
 * Run: node --test scripts/cr-auto-reliability-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEED_RANKING,
  SEED_RELIABILITY,
  verifyBrand,
} from "./cr-auto-reliability-fetch.mjs";
import {
  tierFor,
  resolveSlug,
} from "./cr-auto-reliability-merge.mjs";

test("SEED_RANKING — entries have rank + brand + slugKey", () => {
  for (const e of SEED_RANKING) {
    assert.ok(Number.isInteger(e.rank) && e.rank >= 1);
    assert.ok(e.brand);
    assert.ok(e.slugKey);
    assert.match(e.slugKey, /^[a-z0-9-]+$/);
  }
});

test("SEED_RANKING — ranks are monotonically increasing", () => {
  for (let i = 1; i < SEED_RANKING.length; i++) {
    assert.ok(SEED_RANKING[i].rank > SEED_RANKING[i - 1].rank,
      `rank ${SEED_RANKING[i].rank} after ${SEED_RANKING[i - 1].rank}`);
  }
});

test("SEED_RELIABILITY — top-10 only", () => {
  assert.equal(SEED_RELIABILITY.length, 10);
  for (const e of SEED_RELIABILITY) {
    assert.ok(e.rank >= 1 && e.rank <= 10);
  }
});

test("SEED_RANKING + SEED_RELIABILITY — no duplicate slugKey within each list", () => {
  for (const list of [SEED_RANKING, SEED_RELIABILITY]) {
    const seen = new Set();
    for (const e of list) {
      assert.ok(!seen.has(e.slugKey), `duplicate ${e.slugKey}`);
      seen.add(e.slugKey);
    }
  }
});

test("tierFor — boundaries", () => {
  assert.equal(tierFor(1), "top10");
  assert.equal(tierFor(10), "top10");
  assert.equal(tierFor(11), "midpack");
  assert.equal(tierFor(21), "midpack");
  assert.equal(tierFor(22), "bottom5");
  assert.equal(tierFor(26), "bottom5");
  assert.equal(tierFor(null), "midpack");
  assert.equal(tierFor(0), "midpack");
});

test("verifyBrand — word-boundary case-insensitive", () => {
  const text = "Toyota, Subaru, and Lexus lead Consumer Reports' rankings.";
  assert.equal(verifyBrand(text, "Toyota"), true);
  assert.equal(verifyBrand(text, "toyota"), true);
  assert.equal(verifyBrand(text, "Subaru"), true);
  assert.equal(verifyBrand(text, "Ford"), false);
});

test("verifyBrand — Mercedes-Benz hyphen handled", () => {
  const text = "Mercedes-Benz also ranked.";
  assert.equal(verifyBrand(text, "Mercedes-Benz"), true);
});

test("verifyBrand — empty/missing text returns false", () => {
  assert.equal(verifyBrand("", "Toyota"), false);
  assert.equal(verifyBrand(null, "Toyota"), false);
});

test("resolveSlug — direct + parent fallback", () => {
  const knownSlugs = new Set(["toyota", "stellantis"]);
  assert.deepEqual(
    resolveSlug("toyota", { knownSlugs, aliases: {}, parents: {} }),
    { slug: "toyota", routedVia: "direct" },
  );
  assert.deepEqual(
    resolveSlug("dodge", { knownSlugs, aliases: {}, parents: { dodge: "stellantis" } }),
    { slug: "stellantis", routedVia: "parent" },
  );
  assert.equal(
    resolveSlug("phantom-brand", { knownSlugs, aliases: {}, parents: {} }),
    null,
  );
});
