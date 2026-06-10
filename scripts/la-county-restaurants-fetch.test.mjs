#!/usr/bin/env node
/**
 * Tests for la-county-restaurants-fetch.mjs + -merge.mjs.
 *
 * No network. Replays the bundled fixture.
 * Run: node --test scripts/la-county-restaurants-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LICENSE,
  CHAIN_PATTERNS,
  parseArgs,
  classifyChain,
  normalizeRow,
  rollupByChain,
  replayFixture,
} from "./la-county-restaurants-fetch.mjs";
import {
  severityFor,
  narrativeFor,
  buildAugment,
} from "./la-county-restaurants-merge.mjs";

test("LICENSE is the LA City public-domain attribution", () => {
  assert.ok(LICENSE.includes("public domain"));
});

test("CHAIN_PATTERNS covers headline QSR chains", () => {
  const names = ["MCDONALD'S", "STARBUCKS", "SUBWAY", "CHIPOTLE", "KFC", "TACO BELL", "BURGER KING"];
  for (const n of names) {
    assert.ok(classifyChain(n), `${n} should match a chain pattern`);
  }
});

test("classifyChain returns the right slug + ignores non-chain names", () => {
  assert.equal(classifyChain("STARBUCKS #1234"), "starbucks");
  assert.equal(classifyChain("McDonald's #5678"), "mcdonald-s");
  assert.equal(classifyChain("CHIPOTLE MEXICAN GRILL"), "chipotle");
  assert.equal(classifyChain("SOME RANDOM LOCAL CAFE"), null);
});

test("parseArgs handles --limit, --out, --url, --apply, --dry, --fixture", () => {
  const a = parseArgs(["--limit", "1000", "--out", "/tmp/x.json", "--apply", "--fixture"]);
  assert.equal(a.limit, 1000);
  assert.equal(a.out, "/tmp/x.json");
  assert.equal(a.apply, true);
  assert.equal(a.fixture, true);
});

test("normalizeRow returns null for non-chain rows + null scores", () => {
  assert.equal(normalizeRow({facility_name: "RANDOM CAFE", score: "90", grade: "A"}), null);
  assert.equal(normalizeRow({facility_name: "STARBUCKS", score: null, grade: "A"}), null);
  const r = normalizeRow({facility_name: "STARBUCKS #1", facility_id: "FA1", activity_date: "2018-06-12T00:00:00.000", score: "95", grade: "A", facility_city: "LA", facility_zip: "90028"});
  assert.equal(r.slug, "starbucks");
  assert.equal(r.score, 95);
  assert.equal(r.activity_date, "2018-06-12");
});

test("rollupByChain aggregates inspections per slug", async () => {
  const fix = await replayFixture();
  const rows = fix.rows.map(normalizeRow).filter(Boolean);
  const chains = rollupByChain(rows);
  const starbucks = chains.find(c => c.slug === "starbucks");
  assert.ok(starbucks);
  assert.equal(starbucks.outlet_count, 3);
  assert.equal(starbucks.inspection_count, 3);
  assert.equal(starbucks.grade_a, 3);
  assert.equal(starbucks.grade_b, 0);
  assert.equal(starbucks.grade_c, 0);
  assert.equal(starbucks.b_or_worse_outlets, 0);

  const subway = chains.find(c => c.slug === "subway");
  assert.equal(subway.grade_c, 3);
  assert.equal(subway.b_or_worse_outlets, 3);
  assert.equal(subway.pct_b_or_worse_outlets, 100);

  const mcd = chains.find(c => c.slug === "mcdonald-s");
  assert.equal(mcd.outlet_count, 4);
  assert.equal(mcd.grade_a, 2);
  assert.equal(mcd.grade_b, 1);
  assert.equal(mcd.grade_c, 1);
  assert.equal(mcd.b_or_worse_outlets, 2);
});

test("severityFor: clean chain is positive, dirty chain is poor/very_poor", () => {
  assert.equal(severityFor({pct_b_or_worse_outlets: 0, grade_c: 0}).sc, "positive");
  assert.equal(severityFor({pct_b_or_worse_outlets: 2, grade_c: 0}).sc, "positive");
  assert.equal(severityFor({pct_b_or_worse_outlets: 6, grade_c: 1}).sc, "poor");
  assert.equal(severityFor({pct_b_or_worse_outlets: 10, grade_c: 2}).sc, "poor");
  assert.equal(severityFor({pct_b_or_worse_outlets: 20, grade_c: 5}).sc, "very_poor");
});

test("narrativeFor builds the right human prose", () => {
  const allA = narrativeFor({outlet_count: 3, inspection_count: 3, grade_a: 3, grade_b: 0, grade_c: 0, b_or_worse_outlets: 0, pct_b_or_worse_outlets: 0, avg_score: 96.7, latest_inspection: "2018-06-12"});
  assert.ok(/all 3 LA outlets graded A/.test(allA));
  assert.ok(/2018/.test(allA));

  const bad = narrativeFor({outlet_count: 4, inspection_count: 4, grade_a: 2, grade_b: 1, grade_c: 1, b_or_worse_outlets: 2, pct_b_or_worse_outlets: 50, avg_score: 88, latest_inspection: "2018-06-01"});
  assert.ok(/2 of 4 LA outlets/.test(bad));
  assert.ok(/1 B grade/.test(bad));
  assert.ok(/1 C grade/.test(bad));
});

test("buildAugment filters to slugs in the index", async () => {
  const fix = await replayFixture();
  const rows = fix.rows.map(normalizeRow).filter(Boolean);
  const raw = { chains: rollupByChain(rows) };
  const slugSet = new Set(["starbucks", "mcdonald-s", "subway", "chipotle"]);
  const aug = buildAugment(raw, slugSet);
  assert.ok(aug["starbucks"]);
  assert.ok(aug["mcdonald-s"]);
  assert.ok(aug["subway"]);
  assert.ok(aug["chipotle"]);
  assert.equal(aug["starbucks"].sc, "positive");
  assert.equal(aug["subway"].sc, "very_poor");
});

test("buildAugment honours slug aliases", async () => {
  const raw = { chains: [{ slug: "mcdonalds", outlet_count: 1, inspection_count: 1, grade_a: 1, grade_b: 0, grade_c: 0, b_or_worse_outlets: 0, pct_b_or_worse_outlets: 0, avg_score: 95, source_url: "x" }] };
  const aug = buildAugment(raw, new Set(["mcdonald-s"]), { mcdonalds: "mcdonald-s" });
  assert.ok(aug["mcdonald-s"]);
});
