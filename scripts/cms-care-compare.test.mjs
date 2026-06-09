#!/usr/bin/env node
/**
 * Tests for cms-care-compare-merge.
 *
 * No network. Verifies SYSTEM_PATTERNS substring matcher returns the
 * expected hospital-system slug.
 *
 * Run via: node --test scripts/cms-care-compare.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SYSTEM_PATTERNS } from "./cms-care-compare-merge.mjs";

function match(name) {
  const upper = name.toUpperCase();
  for (const [pat, slug] of SYSTEM_PATTERNS) {
    if (upper.includes(pat)) return slug;
  }
  return null;
}

test("matches HCA chains", () => {
  assert.equal(match("HCA Florida Aventura Hospital"), "hca-healthcare");
  assert.equal(match("HCA HOUSTON HEALTHCARE WEST"), "hca-healthcare");
});

test("matches Mayo and Cleveland", () => {
  assert.equal(match("MAYO CLINIC HOSPITAL"), "mayo-clinic");
  assert.equal(match("CLEVELAND CLINIC FAIRVIEW HOSPITAL"), "cleveland-clinic");
});

test("matches Kaiser Foundation hospitals", () => {
  assert.equal(
    match("KAISER FOUNDATION HOSPITAL - OAKLAND"),
    "kaiser-permanente",
  );
});

test("returns null for unmatched names", () => {
  assert.equal(match("SOUTHEAST HEALTH MEDICAL CENTER"), null);
});
