#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./child-safety-tech-fetch.mjs";
import { buildAugment } from "./child-safety-tech-merge.mjs";

test("Child-safety fixture covers expected platforms", () => {
  assert.ok(FIXTURE.length >= 10);
  assert.ok(FIXTURE.find(r => /meta/i.test(r.company)));
  assert.ok(FIXTURE.find(r => /roblox/i.test(r.company)));
});

test("buildAugment combines ratings + multiple parent slugs", () => {
  const aug = buildAugment(FIXTURE);
  assert.equal(aug["meta-platforms"].rating, "poor");
  assert.ok(aug["roblox"]);
  // Google receives YouTube findings
  assert.ok(aug["google-alphabet"]);
});

test("buildAugment skips unknown companies", () => {
  const aug = buildAugment([{ company: "Unknown", platforms: ["X"], rating: "poor" }]);
  assert.equal(Object.keys(aug).length, 0);
});
