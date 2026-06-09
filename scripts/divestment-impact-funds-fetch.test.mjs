#!/usr/bin/env node
/**
 * Tests for divestment-impact-funds-fetch.mjs + divestment-impact-funds-merge.mjs.
 *
 * Pure parsers — no network. Uses the small fixture under
 * test/fixtures/divestment-impact-funds/sample.json plus the in-mirror
 * curated table.
 *
 * Locally:  node --test scripts/divestment-impact-funds-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MIRROR, SOURCE_URLS, recordsFromMirror } from "./divestment-impact-funds-fetch.mjs";
import {
  resolveSlug,
  groupByBrand,
  derivePatternSeverity,
} from "./divestment-impact-funds-merge.mjs";

test("fetch: MIRROR is non-trivial and well-formed", () => {
  assert.ok(MIRROR.length >= 100, `expected ≥100 mirror rows, got ${MIRROR.length}`);
  for (const r of MIRROR) {
    assert.ok(r.source, "row missing source");
    assert.ok(r.brand, `row missing brand: ${JSON.stringify(r)}`);
    assert.ok(r.category, `row missing category: ${JSON.stringify(r)}`);
    assert.ok(["negative", "positive", "informational"].includes(r.polarity), `bad polarity: ${r.polarity}`);
    assert.ok(SOURCE_URLS[r.source], `unknown source: ${r.source}`);
  }
});

test("fetch: covers all named source portals", () => {
  const expected = new Set([
    "norway-gpfg", "divestment-commitments", "fossil-free-funds",
    "tobacco-free-funds", "weapons-free-funds", "deforestation-free-funds",
    "prison-free-funds", "gender-equality-funds",
    "trillium", "calvert", "domini", "parnassus", "pax-world",
    "tiaa-social-choice", "vanguard-esg", "ishares-esg",
    "bds-boycott", "methodist-pension", "episcopal-church",
  ]);
  const have = new Set(MIRROR.map(r => r.source));
  for (const s of expected) assert.ok(have.has(s), `missing source coverage: ${s}`);
});

test("fetch: recordsFromMirror hydrates source_url", () => {
  const recs = recordsFromMirror();
  assert.equal(recs.length, MIRROR.length);
  for (const r of recs) {
    assert.ok(r.source_url, `record missing source_url: ${r.source}/${r.brand}`);
    assert.ok(r.source_url.startsWith("http"));
  }
});

test("merge: resolveSlug falls back to direct slug then alias", () => {
  // toSlug("H&M") → "h-and-m" (& expanded to "and"). Match real alias key.
  const aliases = { "h-and-m": "handm", "mcdonald-s": "mcdonald-s-corp" };
  const parentMap = { "100grand": { parent: "nestl", confidence: "high" } };
  assert.equal(resolveSlug("H&M", aliases, parentMap), "handm");
  assert.equal(resolveSlug("McDonald's", aliases, parentMap), "mcdonald-s-corp");
  // brand-parent-map key "100grand" (no dashes) routes through the
  // compactKey path.
  assert.equal(resolveSlug("100Grand", aliases, parentMap), "nestl");
  assert.equal(resolveSlug("ExxonMobil", aliases, parentMap), "exxonmobil");
});

test("merge: resolveSlug ignores underscore-prefixed alias entries", () => {
  // The brand-parent-map.json file has a `_doc` key. We must not treat
  // it as a parent — otherwise every odd brand pointed at "_doc" routes
  // to garbage. Test that the underscore-prefix guard works.
  const parentMap = { "_doc": { parent: "garbage", confidence: "high" } };
  assert.equal(resolveSlug("_doc", {}, parentMap), null);
});

test("merge: derivePatternSeverity rules", () => {
  // Norway alone → poor
  assert.equal(
    derivePatternSeverity({ norway: true, negSources: new Set(["norway-gpfg"]), posSources: new Set() }),
    "poor",
  );
  // Norway + one other negative → very_poor
  assert.equal(
    derivePatternSeverity({ norway: true, negSources: new Set(["norway-gpfg", "fossil-free-funds"]), posSources: new Set() }),
    "very_poor",
  );
  // 3 negative impact funds (no Norway) → poor
  assert.equal(
    derivePatternSeverity({
      norway: false,
      negSources: new Set(["fossil-free-funds", "divestment-commitments", "methodist-pension"]),
      posSources: new Set(),
    }),
    "poor",
  );
  // 1 negative impact fund (no Norway) → mixed
  assert.equal(
    derivePatternSeverity({
      norway: false,
      negSources: new Set(["fossil-free-funds"]),
      posSources: new Set(),
    }),
    "mixed",
  );
  // 5 positive holdings, 0 negative → positive
  assert.equal(
    derivePatternSeverity({
      norway: false,
      negSources: new Set(),
      posSources: new Set(["trillium", "calvert", "domini", "parnassus", "pax-world"]),
    }),
    "positive",
  );
  // 3 positive, 0 negative → mixed (lean positive)
  assert.equal(
    derivePatternSeverity({
      norway: false,
      negSources: new Set(),
      posSources: new Set(["calvert", "domini", "parnassus"]),
    }),
    "mixed",
  );
  // Nothing → neutral
  assert.equal(
    derivePatternSeverity({ norway: false, negSources: new Set(), posSources: new Set() }),
    "neutral",
  );
});

test("merge: groupByBrand collapses multi-source brands and counts funds", () => {
  const recs = recordsFromMirror();
  const { companies } = groupByBrand(recs, {}, {});
  // ExxonMobil appears in: divestment-commitments + fossil-free-funds
  // + methodist-pension + episcopal-church → 4 negative sources, 0 positive
  const exxon = companies["exxonmobil"];
  assert.ok(exxon, "expected exxonmobil bucket");
  assert.ok(exxon.negative_fund_count >= 3, `exxon negative_fund_count ${exxon.negative_fund_count}`);
  assert.equal(exxon.positive_fund_count, 0);
  assert.equal(exxon.pattern_severity, "poor");
  assert.ok(exxon.category_signals.environment, "exxon should have env signals");
  assert.equal(exxon.category_signals.environment.polarity, "negative");

  // Microsoft: 5+ positive ESG holdings → "positive"
  const ms = companies["microsoft"];
  assert.ok(ms);
  assert.ok(ms.positive_fund_count >= 5, `ms positive_fund_count ${ms.positive_fund_count}`);
  assert.equal(ms.pattern_severity, "positive");

  // Lockheed Martin: Norway-GPFG + weapons-free-funds + episcopal → very_poor
  const lm = companies["lockheed-martin"];
  assert.ok(lm);
  assert.ok(lm.norway_gpfg, "Lockheed should be Norway-excluded");
  assert.equal(lm.pattern_severity, "very_poor");
  assert.equal(lm.category_signals.guns.polarity, "negative");
});

test("merge: BDS records stay informational and never bump severity", () => {
  const recs = recordsFromMirror();
  const { companies } = groupByBrand(recs, {}, {});
  // HP Inc. only appears via BDS; should be polarity=informational, severity=neutral.
  const hp = companies["hp"];
  if (hp) {
    assert.equal(hp.category_signals.political.polarity, "informational");
    assert.equal(hp.pattern_severity, "neutral");
  }
});
