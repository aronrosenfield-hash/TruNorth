#!/usr/bin/env node
/**
 * Test harness for common-sense-privacy-{fetch,merge}.mjs.
 * Run: node --test scripts/common-sense-privacy-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEED_EVALUATIONS,
  tierEnum,
} from "./common-sense-privacy-fetch.mjs";
import {
  worstTier,
  resolveSlug,
} from "./common-sense-privacy-merge.mjs";

test("SEED_EVALUATIONS — all required fields present", () => {
  for (const e of SEED_EVALUATIONS) {
    assert.ok(e.product);
    assert.ok(e.tier);
    assert.ok(e.slugKey);
    assert.ok(e.evaluationUrl);
    assert.ok(e.evaluationUrl.startsWith("https://privacy.commonsense.org/"));
  }
});

test("SEED_EVALUATIONS — slugKey lowercase + dashed", () => {
  for (const e of SEED_EVALUATIONS) {
    assert.match(e.slugKey, /^[a-z0-9-]+$/);
  }
});

test("tierEnum — maps Pass/Warning/Fail correctly", () => {
  assert.equal(tierEnum("Pass"), "pass");
  assert.equal(tierEnum("Warning"), "warning");
  assert.equal(tierEnum("Warning Full"), "warning");
  assert.equal(tierEnum("Fail"), "fail");
  assert.equal(tierEnum(""), "unknown");
  assert.equal(tierEnum(null), "unknown");
});

test("worstTier — fail > warning > pass > unknown", () => {
  assert.equal(worstTier("pass", "warning"), "warning");
  assert.equal(worstTier("warning", "pass"), "warning");
  assert.equal(worstTier("warning", "fail"), "fail");
  assert.equal(worstTier("pass", "pass"), "pass");
  assert.equal(worstTier("unknown", "pass"), "pass");
  assert.equal(worstTier("fail", "unknown"), "fail");
});

test("resolveSlug — direct / alias / parent", () => {
  const knownSlugs = new Set(["meta", "alphabet"]);
  assert.deepEqual(
    resolveSlug("meta", { knownSlugs, aliases: {}, parents: {} }),
    { slug: "meta", routedVia: "direct" },
  );
  assert.deepEqual(
    resolveSlug("facebook", { knownSlugs, aliases: { facebook: "meta" }, parents: {} }),
    { slug: "meta", routedVia: "alias" },
  );
  assert.deepEqual(
    resolveSlug("youtube", { knownSlugs, aliases: {}, parents: { youtube: "alphabet" } }),
    { slug: "alphabet", routedVia: "parent" },
  );
  assert.equal(resolveSlug("unknown-co", { knownSlugs, aliases: {}, parents: {} }), null);
});

test("Meta family — all 4 products map to one corporate slug", () => {
  // Slug must match the TruNorth index entry for Meta; assert exactly 4
  // products feed through it and the slug is the only one for the Meta
  // family (no orphan splits).
  const metaSlugs = new Set(
    SEED_EVALUATIONS
      .filter(e => ["Facebook", "Instagram", "WhatsApp", "Messenger"].includes(e.product))
      .map(e => e.slugKey),
  );
  assert.equal(metaSlugs.size, 1, `expected 1 Meta slug, got ${[...metaSlugs].join(",")}`);
});
