#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./citizen-lab-fetch.mjs";
import { buildAugment } from "./citizen-lab-merge.mjs";

test("Citizen Lab fixture covers major surveillance vendors", () => {
  assert.ok(FIXTURE.length >= 10);
  assert.ok(FIXTURE.find(r => /nso/i.test(r.vendor)), "NSO/Pegasus missing");
  assert.ok(FIXTURE.find(r => /paragon/i.test(r.vendor)), "Paragon 2025 missing");
});

test("buildAugment severity_max promoted from moderate→severe correctly", () => {
  const aug = buildAugment(FIXTURE);
  assert.equal(aug["nso-group"].severity_max, "severe");
  // Zoom is moderate only
  if (aug["zoom"]) assert.equal(aug["zoom"].severity_max, "moderate");
});

test("buildAugment skips unknown vendors", () => {
  const aug = buildAugment([{ vendor: "Unknown Vendor", product: "x", first_reported: "2024-01-01" }]);
  assert.equal(Object.keys(aug).length, 0);
});
