#!/usr/bin/env node
/**
 * Tests for climate-coalitions-fetch.mjs + climate-coalitions-merge.mjs
 *
 * Pure-function tests — no network.
 * Run: node --test scripts/climate-coalitions-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS, SOURCE_LABELS } from "./climate-coalitions-fetch.mjs";
import { resolveSlug, groupBySlug } from "./climate-coalitions-merge.mjs";

test("ENTRIES are non-empty and well-formed", () => {
  assert.ok(ENTRIES.length >= 100, `expected ≥100 entries, got ${ENTRIES.length}`);
  for (const e of ENTRIES) {
    assert.ok(typeof e.brand === "string" && e.brand.length > 0, `bad brand: ${JSON.stringify(e)}`);
    assert.ok(SOURCE_URLS[e.source], `unknown source: ${e.source}`);
    if (e.joinedYear != null) {
      assert.ok(Number.isFinite(e.joinedYear) && e.joinedYear >= 2000 && e.joinedYear <= 2030,
        `bad joinedYear: ${e.joinedYear} on ${e.brand}`);
    }
    if (e.targetYear != null) {
      assert.ok(Number.isFinite(e.targetYear) && e.targetYear >= 2014 && e.targetYear <= 2060,
        `bad targetYear: ${e.targetYear} on ${e.brand}`);
    }
  }
});

test("All six coalitions are covered with ≥10 verified members each (except EP100, ≥10)", () => {
  const tally = {};
  for (const e of ENTRIES) tally[e.source] = (tally[e.source] || 0) + 1;
  for (const key of ["re100", "ev100", "ep100", "fmc", "wmbc", "leaf"]) {
    assert.ok(tally[key] >= 10, `expected ≥10 ${key} entries, got ${tally[key] || 0}`);
  }
});

test("SOURCE_LABELS covers every source key", () => {
  for (const key of Object.keys(SOURCE_URLS)) {
    assert.ok(SOURCE_LABELS[key], `missing label for ${key}`);
  }
});

test("resolveSlug prefers slugHint over auto-slug", () => {
  const e = { brand: "L'Oréal Paris", slugHint: "l-or-al" };
  assert.equal(resolveSlug(e), "l-or-al");
});

test("resolveSlug applies slug-aliases", () => {
  const aliases = { "nestle": "nestl", "apple-inc": "apple" };
  assert.equal(resolveSlug({ brand: "Nestle" }, aliases), "nestl");
  // slugHint also routed through aliases
  assert.equal(resolveSlug({ brand: "X", slugHint: "apple-inc" }, aliases), "apple");
});

test("resolveSlug falls back to auto-slug when no hint", () => {
  assert.equal(resolveSlug({ brand: "General Motors" }), "general-motors");
});

test("groupBySlug collapses multiple memberships per brand", () => {
  const entries = [
    { brand: "Apple", slugHint: "apple", source: "re100", sourceLabel: "RE100", joinedYear: 2016, sourceUrl: "u1" },
    { brand: "Apple", slugHint: "apple", source: "fmc",   sourceLabel: "FMC",   joinedYear: 2022, sourceUrl: "u2" },
    { brand: "Microsoft", slugHint: "microsoft", source: "re100", sourceLabel: "RE100", joinedYear: 2015, sourceUrl: "u1" },
  ];
  const grouped = groupBySlug(entries);
  assert.equal(Object.keys(grouped).length, 2);
  assert.equal(grouped.apple.coalition_count, 2);
  assert.equal(grouped.apple.has_re100, true);
  assert.equal(grouped.apple.has_fmc, true);
  assert.equal(grouped.apple.has_ev100, false);
  assert.equal(grouped.microsoft.coalition_count, 1);
});

test("groupBySlug dedups same source+slug, taking newer joinedYear", () => {
  const entries = [
    { brand: "Foo", slugHint: "foo", source: "re100", sourceLabel: "RE100", joinedYear: 2015, commitment: "old", sourceUrl: "u" },
    { brand: "Foo", slugHint: "foo", source: "re100", sourceLabel: "RE100", joinedYear: 2020, commitment: "new", sourceUrl: "u" },
  ];
  const grouped = groupBySlug(entries);
  assert.equal(grouped.foo.memberships.length, 1);
  assert.equal(grouped.foo.memberships[0].joinedYear, 2020);
  assert.equal(grouped.foo.memberships[0].commitment, "new");
});

test("End-to-end: ENTRIES group cleanly and key brands present", () => {
  // Add the sourceLabel as the fetcher does before merging.
  const enriched = ENTRIES.map((e) => ({ ...e, sourceLabel: SOURCE_LABELS[e.source], sourceUrl: SOURCE_URLS[e.source] }));
  const grouped = groupBySlug(enriched);
  // Apple should appear in RE100 + FMC
  assert.ok(grouped.apple, "Apple should be in the grouped output");
  assert.ok(grouped.apple.has_re100, "Apple should be RE100");
  assert.ok(grouped.apple.has_fmc, "Apple should be First Movers Coalition");
  // Microsoft should appear in RE100, FMC, WMBC
  assert.ok(grouped.microsoft, "Microsoft should be in the grouped output");
  assert.ok(grouped.microsoft.coalition_count >= 3, "Microsoft should be in at least 3 coalitions");
  // IKEA should be in RE100, EV100, WMBC
  assert.ok(grouped.ikea, "IKEA should be in the grouped output");
  assert.ok(grouped.ikea.has_ev100, "IKEA should be EV100");
});

test("No source has zero members", () => {
  const counts = {};
  for (const e of ENTRIES) counts[e.source] = (counts[e.source] || 0) + 1;
  for (const k of Object.keys(SOURCE_URLS)) {
    assert.ok(counts[k] > 0, `source ${k} has no entries`);
  }
});
