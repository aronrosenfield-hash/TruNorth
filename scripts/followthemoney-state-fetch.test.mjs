#!/usr/bin/env node
/**
 * Tests for followthemoney-state-fetch.mjs. node:test, no network, fixture-driven.
 * Run: node --test scripts/followthemoney-state-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveSlug,
  aggregateDonor,
} from "./followthemoney-state-fetch.mjs";

// ─── resolveSlug ─────────────────────────────────────────────────────

test("resolveSlug: direct, alias, parent in priority order", () => {
  const slugSet = new Set(["walmart", "atandt"]);
  const aliases = { "att": "atandt" };
  const parents = { "instagram": { parent: "meta-platforms" } };

  assert.deepEqual(
    resolveSlug("walmart", { slugSet, aliases, parents }),
    { slug: "walmart", method: "direct" },
  );
  assert.deepEqual(
    resolveSlug("att", { slugSet, aliases, parents }),
    { slug: "atandt", method: "alias" },
  );
  assert.equal(resolveSlug("unknown", { slugSet, aliases, parents }), null);
});

// ─── aggregateDonor ──────────────────────────────────────────────────

test("aggregateDonor: sums totals and surfaces top 5 states by $", () => {
  const donor = {
    slug: "walmart",
    entity_ids: ["E1"],
    records: [
      { state: "AR", cycle: 2024, total: 500000, dem: 80000,  rep: 400000, other: 20000 },
      { state: "TX", cycle: 2024, total: 300000, dem: 50000,  rep: 240000, other: 10000 },
      { state: "FL", cycle: 2024, total: 200000, dem: 40000,  rep: 155000, other:  5000 },
      { state: "CA", cycle: 2024, total: 150000, dem: 100000, rep:  45000, other:  5000 },
      { state: "GA", cycle: 2024, total: 100000, dem: 20000,  rep:  78000, other:  2000 },
      { state: "OH", cycle: 2024, total:  50000, dem: 10000,  rep:  38000, other:  2000 },
    ],
  };
  const block = aggregateDonor(donor);
  assert.equal(block.totalUsd, 1300000);
  assert.equal(block.stateCount, 6);
  assert.equal(block.topStates.length, 5);
  assert.equal(block.topStates[0].state, "AR");
  assert.equal(block.topStates[0].usd, 500000);
  assert.equal(block.topStates[4].state, "GA"); // 5th-largest
  // Aggregate party split:
  // dem 300k, rep 956k, other 44k, total 1.3M
  assert.equal(block.pctToDem, 0.231);
  assert.equal(block.pctToRep, 0.735);
  assert.equal(block.pctToOther, 0.034);
  assert.equal(block.lastCycleYear, 2024);
  assert.deepEqual(block.entityIds, ["E1"]);
});

test("aggregateDonor: per-state party shares", () => {
  const donor = {
    slug: "x",
    entity_ids: [],
    records: [
      { state: "CA", cycle: 2024, total: 100, dem: 80, rep: 20, other: 0 },
    ],
  };
  const block = aggregateDonor(donor);
  assert.equal(block.topStates[0].pctToDem, 0.8);
  assert.equal(block.topStates[0].pctToRep, 0.2);
});

test("aggregateDonor: empty record list", () => {
  const block = aggregateDonor({ slug: "x", entity_ids: [], records: [] });
  assert.equal(block.totalUsd, 0);
  assert.equal(block.stateCount, 0);
  assert.deepEqual(block.topStates, []);
});

// ─── augment block round-trip ────────────────────────────────────────

test("source URLs are stable + present", () => {
  const block = aggregateDonor({ slug: "x", entity_ids: ["E1"], records: [
    { state: "CA", cycle: 2024, total: 100, dem: 50, rep: 50, other: 0 },
  ]});
  assert.deepEqual(block.sources, ["https://www.followthemoney.org"]);
});
