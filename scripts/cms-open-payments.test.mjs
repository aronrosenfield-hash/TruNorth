#!/usr/bin/env node
/**
 * Tests for cms-open-payments-fetch + cms-open-payments-merge.
 *
 * No network. Verifies:
 *   - CSV row parsing (handles quoted commas)
 *   - Manufacturer-name resolution for direct/suffix/alias/orphan routes
 *
 * Run via: node --test scripts/cms-open-payments.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCsvLine } from "./cms-open-payments-fetch.mjs";
import { CMS_ALIASES, resolveMfr } from "./cms-open-payments-merge.mjs";

test("parseCsvLine — basic + quoted commas", () => {
  assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(
    parseCsvLine('"PFIZER, INC.","100","42.50"'),
    ["PFIZER, INC.", "100", "42.50"],
  );
});

test("parseCsvLine — escaped quotes", () => {
  // CSV double-quote escape for embedded quote
  assert.deepEqual(parseCsvLine('"a ""b"" c","d"'), ['a "b" c', "d"]);
});

test("resolveMfr — direct slug match", () => {
  const indexSlugs = new Set(["pfizer", "merck-and-co"]);
  const hit = resolveMfr("PFIZER", indexSlugs, {});
  assert.deepEqual(hit, { slug: "pfizer", via: "direct" });
});

test("resolveMfr — suffix stripping", () => {
  const indexSlugs = new Set(["medtronic"]);
  const hit = resolveMfr("MEDTRONIC, INC.", indexSlugs, {});
  assert.ok(hit);
  assert.equal(hit.slug, "medtronic");
});

test("resolveMfr — alias for Janssen → J&J", () => {
  const indexSlugs = new Set(["johnson-and-johnson"]);
  const hit = resolveMfr("JANSSEN BIOTECH, INC.", indexSlugs, {});
  assert.deepEqual(hit, { slug: "johnson-and-johnson", via: "alias" });
});

test("resolveMfr — Genentech aliased to genentech (Roche slug not in index)", () => {
  // Per CMS_ALIASES, all Roche/Genentech/Hoffmann variants point to genentech.
  assert.equal(CMS_ALIASES["GENENTECH, INC."], "genentech");
  assert.equal(CMS_ALIASES["HOFFMANN-LA ROCHE INC."], "genentech");
});

test("resolveMfr — orphan returns null", () => {
  const indexSlugs = new Set(["pfizer"]);
  const hit = resolveMfr("NONEXISTENT BIOTECH LLC", indexSlugs, {});
  assert.equal(hit, null);
});
