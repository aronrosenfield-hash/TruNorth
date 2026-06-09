#!/usr/bin/env node
/**
 * Tests for hibp-breaches fetch + merge. Fixture-only; no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./hibp-breaches-fetch.mjs";
import { buildAugment } from "./hibp-breaches-merge.mjs";

test("HIBP fixture has expected major breaches", () => {
  assert.ok(FIXTURE.length >= 25, `fixture should cover >=25 breaches (was ${FIXTURE.length})`);
  const yahoo = FIXTURE.find(r => r.domain === "yahoo.com");
  assert.ok(yahoo, "yahoo.com breach missing");
  assert.equal(yahoo.pwn_count, 3_000_000_000);
});

test("buildAugment groups by domain → slug + flags sensitive breaches", () => {
  const aug = buildAugment(FIXTURE);
  assert.ok(aug["yahoo"], "yahoo slug not built");
  assert.ok(aug["meta-platforms"], "Facebook → meta-platforms not built");
  assert.ok(aug["x-corp"], "twitter.com → x-corp alias not emitted");
  // Sensitive breach detection
  assert.ok(aug["equifax"].sensitive_count >= 1, "Equifax sensitive flag missing");
  // Aggregation
  assert.ok(aug["yahoo"].total_pwned >= 3e9);
  assert.ok(aug["yahoo"].sample_breaches.length >= 1);
});

test("buildAugment skips unknown domains", () => {
  const aug = buildAugment([{ domain: "not-a-real-domain.example", pwn_count: 1, breach_date: "2020-01-01" }]);
  assert.equal(Object.keys(aug).length, 0);
});
