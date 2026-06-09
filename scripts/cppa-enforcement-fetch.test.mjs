#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./cppa-enforcement-fetch.mjs";
import { buildAugment } from "./cppa-enforcement-merge.mjs";

test("CPPA fixture has core public enforcement actions", () => {
  assert.ok(FIXTURE.length >= 4);
  assert.ok(FIXTURE.find(r => /honda/i.test(r.company)), "Honda enforcement missing");
  assert.ok(FIXTURE.find(r => /sephora/i.test(r.company)), "Sephora precedent missing");
});

test("buildAugment maps to slugs and totals penalties", () => {
  const aug = buildAugment(FIXTURE);
  assert.ok(aug["honda"], "honda slug not built");
  assert.ok(aug["doordash"]);
  assert.equal(aug["honda"].total_penalty_usd, 632500);
});

test("buildAugment skips unknown companies", () => {
  const aug = buildAugment([{ company: "Unknown Co", date: "2024-01-01" }]);
  assert.equal(Object.keys(aug).length, 0);
});
