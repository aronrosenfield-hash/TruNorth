#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./cnil-enforcement-fetch.mjs";
import { buildAugment } from "./cnil-enforcement-merge.mjs";

test("CNIL fixture has core French DPA sanctions", () => {
  assert.ok(FIXTURE.length >= 10);
  const google150 = FIXTURE.find(r => r.fine_eur === 150_000_000);
  assert.ok(google150, "€150M Google cookies fine missing");
});

test("buildAugment aggregates per slug + emits parent aliases", () => {
  const aug = buildAugment(FIXTURE);
  assert.ok(aug["google-alphabet"], "Google parent slug missing");
  assert.ok(aug["meta-platforms"], "Meta slug missing");
  // Multiple Google sanctions sum
  assert.ok(aug["google-alphabet"].total_fines_eur >= 200_000_000);
});

test("buildAugment skips unknown companies", () => {
  const aug = buildAugment([{ company: "Random SARL", date: "2024-01-01", fine_eur: 100 }]);
  assert.equal(Object.keys(aug).length, 0);
});
