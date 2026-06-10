#!/usr/bin/env node
/**
 * Tests for dime-augment-fetch.mjs. node:test, no network, fixture-driven.
 * Run: node --test scripts/dime-augment-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEmployer,
  isJunk,
  parseCSV,
  aggregateByEmployer,
  resolveSlug,
  coalesceBySlug,
  buildAugmentBlock,
} from "./dime-augment-fetch.mjs";

// ─── normalizeEmployer ────────────────────────────────────────────────

test("normalizeEmployer strips legal suffixes", () => {
  assert.equal(normalizeEmployer("WALMART INC"),       "walmart");
  assert.equal(normalizeEmployer("Apple Inc."),         "apple");
  assert.equal(normalizeEmployer("Tesla, Inc"),         "tesla");
  assert.equal(normalizeEmployer("Lockheed Martin Corporation"), "lockheed-martin");
});

test("normalizeEmployer normalizes punctuation and case", () => {
  assert.equal(normalizeEmployer("AT&T"),               "at-t");
  assert.equal(normalizeEmployer("Johnson & Johnson"),  "johnson-johnson");
  assert.equal(normalizeEmployer(""),                   "");
});

test("normalizeEmployer is null-safe", () => {
  assert.equal(normalizeEmployer(null),       "");
  assert.equal(normalizeEmployer(undefined),  "");
});

// ─── isJunk ──────────────────────────────────────────────────────────

test("isJunk catches non-employer disclosures", () => {
  for (const j of ["self", "retired", "n/a", "none", "homemaker", "information requested"]) {
    assert.ok(isJunk(j), `${j} should be junk`);
  }
  assert.ok(!isJunk("Walmart"));
  assert.ok(!isJunk("Apple Inc."));
});

// ─── parseCSV ────────────────────────────────────────────────────────

test("parseCSV handles quoted fields with commas", () => {
  const text = `a,b,c
"hello, world",2,3
4,5,"trailing"
`;
  const rows = parseCSV(text);
  assert.deepEqual(rows[0], ["a", "b", "c"]);
  assert.deepEqual(rows[1], ["hello, world", "2", "3"]);
  assert.deepEqual(rows[2], ["4", "5", "trailing"]);
});

// ─── aggregateByEmployer ─────────────────────────────────────────────

test("aggregateByEmployer sums by normalized employer, drops junk + old + zero", () => {
  const rows = [
    // valid
    { contributor_employer: "WALMART",      contribution_amount: "100", cycle: "2024", contributor_name: "A", recipient_party: "R" },
    { contributor_employer: "WALMART INC",  contribution_amount: "200", cycle: "2024", contributor_name: "B", recipient_party: "D" },
    // junk → drop
    { contributor_employer: "SELF",         contribution_amount: "500", cycle: "2024", contributor_name: "C" },
    // old → drop (assuming cutoff 4y)
    { contributor_employer: "WALMART",      contribution_amount: "999", cycle: "2010", contributor_name: "D" },
    // zero → drop
    { contributor_employer: "APPLE",        contribution_amount: "0",   cycle: "2024", contributor_name: "E" },
  ];
  const { byEmployer, kept, dropped } = aggregateByEmployer(rows, { cutoffYear: 2022 });
  assert.equal(kept, 2);
  assert.equal(dropped, 3);
  const walmart = byEmployer.get("walmart");
  assert.ok(walmart, "walmart should be aggregated");
  assert.equal(walmart.total_amount, 300);
  assert.equal(walmart.contribution_count, 2);
  assert.equal(walmart.donor_ids.size, 2);
  assert.equal(walmart.amount_to_dem, 200);
  assert.equal(walmart.amount_to_rep, 100);
});

// ─── resolveSlug ─────────────────────────────────────────────────────

test("resolveSlug: direct, alias, parent — in priority order", () => {
  const slugSet = new Set(["walmart", "google-alphabet", "nike"]);
  const aliases = { "google": "google-alphabet" };
  const parents = { "instagram": { parent: "meta-platforms" } };
  const dimeAliases = { "wal-mart": "walmart" };

  // direct
  assert.deepEqual(
    resolveSlug("walmart", { slugSet, aliases, parents, dimeAliases }),
    { slug: "walmart", method: "direct" },
  );
  // dimeAlias (highest non-direct priority — but only fires if not direct)
  assert.deepEqual(
    resolveSlug("wal-mart", { slugSet, aliases, parents, dimeAliases }),
    { slug: "walmart", method: "alias" },
  );
  // generic alias
  assert.deepEqual(
    resolveSlug("google", { slugSet, aliases, parents, dimeAliases }),
    { slug: "google-alphabet", method: "alias" },
  );
  // no match
  assert.equal(resolveSlug("unknown-co", { slugSet, aliases, parents, dimeAliases }), null);
});

test("resolveSlug: parent map only when parent slug exists", () => {
  const slugSet = new Set(["meta-platforms"]);
  const parents = { "instagram": { parent: "meta-platforms" } };
  assert.equal(
    resolveSlug("instagram", { slugSet, aliases: {}, parents, dimeAliases: {} })?.method,
    "parent",
  );
  // parent missing from slugSet → null
  const slugSet2 = new Set(["nike"]);
  assert.equal(
    resolveSlug("instagram", { slugSet: slugSet2, aliases: {}, parents, dimeAliases: {} }),
    null,
  );
});

// ─── coalesceBySlug ──────────────────────────────────────────────────

test("coalesceBySlug sums per slug across normalized employer variants", () => {
  const byEmployer = new Map([
    ["walmart", { employer_raw: "WALMART", employer_normalized: "walmart",
                  donor_ids: new Set(["a", "b"]), contribution_count: 2,
                  total_amount: 300, weighted_cf_sum: 60,
                  amount_to_dem: 100, amount_to_rep: 200, amount_to_other: 0,
                  last_cycle_year: 2024 }],
    ["wal-mart", { employer_raw: "WAL-MART", employer_normalized: "wal-mart",
                  donor_ids: new Set(["c"]), contribution_count: 1,
                  total_amount: 50, weighted_cf_sum: 10,
                  amount_to_dem: 0, amount_to_rep: 50, amount_to_other: 0,
                  last_cycle_year: 2024 }],
  ]);
  const slugSet = new Set(["walmart"]);
  const maps = { aliases: { "wal-mart": "walmart" }, parents: {}, dimeAliases: {} };
  const { bySlug, matched, unmatched } = coalesceBySlug(byEmployer, maps, slugSet);
  assert.equal(matched, 2);
  assert.equal(unmatched, 0);
  const w = bySlug.get("walmart");
  assert.equal(w.total_amount, 350);
  assert.equal(w.amount_to_dem, 100);
  assert.equal(w.amount_to_rep, 250);
  assert.equal(w.donor_count, 3); // 2 + 1
  assert.equal(w.employers_matched.size, 2);
});

// ─── buildAugmentBlock ───────────────────────────────────────────────

test("buildAugmentBlock produces narrative-ready shape", () => {
  const agg = {
    slug: "walmart",
    total_amount: 1000,
    donor_count: 10,
    contribution_count: 15,
    weighted_cf_sum: 500,        // → avg 0.5
    amount_to_dem: 250,
    amount_to_rep: 700,
    amount_to_other: 50,
    last_cycle_year: 2024,
    employers_matched: new Set(["WALMART", "WAL-MART"]),
    methods: new Set(["direct", "alias"]),
  };
  const block = buildAugmentBlock(agg);
  assert.equal(block.totalUsd, 1000);
  assert.equal(block.donorCount, 10);
  assert.equal(block.pctToDem, 0.25);
  assert.equal(block.pctToRep, 0.7);
  assert.equal(block.pctToOther, 0.05);
  assert.equal(block.avgCfscore, 0.5);
  assert.equal(block.lastCycleYear, 2024);
  assert.deepEqual(block.employersMatched.sort(), ["WAL-MART", "WALMART"]);
  assert.deepEqual(block.sources, ["https://data.stanford.edu/dime"]);
});
