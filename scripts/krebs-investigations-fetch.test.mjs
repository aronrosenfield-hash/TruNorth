#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./krebs-investigations-fetch.mjs";
import { buildAugment } from "./krebs-investigations-merge.mjs";

test("Krebs fixture covers landmark breach scoops", () => {
  assert.ok(FIXTURE.length >= 12);
  assert.ok(FIXTURE.find(r => /target/i.test(r.company)), "Target 2013 missing");
  assert.ok(FIXTURE.find(r => /snowflake/i.test(r.company)), "Snowflake 2024 missing");
});

test("buildAugment severity_max selects most severe", () => {
  const aug = buildAugment(FIXTURE);
  assert.equal(aug["target"].severity_max, "severe");
  assert.ok(aug["t-mobile"]);
  assert.ok(aug["microsoft"]);
});

test("buildAugment skips unknown companies", () => {
  const aug = buildAugment([{ company: "Unknown Corp", date: "2024-01-01" }]);
  assert.equal(Object.keys(aug).length, 0);
});
