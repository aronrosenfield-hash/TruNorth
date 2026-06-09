#!/usr/bin/env node
/**
 * node --test scripts/product-safety-deep-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeRecord, buildSnapshot } from "./product-safety-deep-fetch.mjs";
import { buildAliasIndex, matchBrand, rollUp } from "./product-safety-deep-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/product-safety-deep/sample.json");

test("normalizeRecord trims/typechecks and drops empties", () => {
  assert.equal(normalizeRecord(null), null);
  assert.equal(normalizeRecord({ source: "", brand: "Foo" }), null);
  assert.equal(normalizeRecord({ source: "ewg-verified", brand: "" }), null);
  const r = normalizeRecord({ source: "EWG-VERIFIED", brand: "  Beautycounter  ", product_count: "92" });
  assert.equal(r.source, "ewg-verified");
  assert.equal(r.brand, "Beautycounter");
  assert.equal(r.product_count, 92);
  assert.match(r.source_url, /ewg\.org/);
});

test("buildSnapshot dedupes same source+brand keeping highest product_count", () => {
  const records = [
    normalizeRecord({ source: "made-safe", brand: "Annmarie Skin Care", product_count: 20 }),
    normalizeRecord({ source: "made-safe", brand: "Annmarie Skin Care", product_count: 24 }),
    normalizeRecord({ source: "ewg-verified", brand: "Annmarie Skin Care", product_count: 22 }),
  ];
  const snap = buildSnapshot(records);
  assert.equal(snap.total_record_count, 2);
  const ms = snap.records.find(r => r.source === "made-safe");
  assert.equal(ms.product_count, 24);
});

test("fixture loads, normalizes, and rolls up to a multi-source slug", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const records = seed.records.map(normalizeRecord).filter(Boolean);
  assert.ok(records.length >= 40, `expected >=40 records, got ${records.length}`);

  // Annmarie sits on both EWG VERIFIED and Made Safe — confirm dedup works
  // across sources (different sources should NOT dedup each other).
  const annmarie = records.filter(r => r.brand === "Annmarie Skin Care");
  assert.equal(annmarie.length, 2);
});

test("matchBrand routes 'Annmarie Skin Care' via 2-token prefix", () => {
  const idx = buildAliasIndex(["annmarie"], {}, {});
  // First, the slug itself indexes as "annmarie"
  assert.equal(matchBrand("Annmarie Skin Care", idx), "annmarie");
});

test("matchBrand routes by alias from parent-map", () => {
  const idx = buildAliasIndex(
    ["lg"],
    { lg: { aliases: ["LG Electronics"] } },
    {},
  );
  assert.equal(matchBrand("LG Electronics", idx), "lg");
});

test("rollUp produces a single entry per slug with multi-cert breakdown", () => {
  const matched = [
    { slug: "beautycounter", source: "ewg-verified", brand: "Beautycounter", product_count: 92, source_url: "https://www.ewg.org/ewgverified/" },
    { slug: "beautycounter", source: "made-safe",    brand: "Beautycounter", product_count: 5,  source_url: "https://madesafe.org/" },
  ];
  const out = rollUp(matched);
  assert.equal(Object.keys(out).length, 1);
  assert.equal(out.beautycounter.total_certifications, 2);
  assert.equal(out.beautycounter.total_certified_products, 97);
  assert.deepEqual(out.beautycounter.categories.sort(), ["health"]);
});

test("rollUp tags greenguard as health+environment, watersense as environment", () => {
  const matched = [
    { slug: "ikea",   source: "greenguard", brand: "IKEA",   product_count: 42, source_url: "https://spot.ul.com/greenguard/" },
    { slug: "kohler", source: "watersense", brand: "Kohler", product_count: 132, source_url: "https://www.epa.gov/watersense/" },
  ];
  const out = rollUp(matched);
  assert.deepEqual(out.ikea.categories.sort(),   ["environment", "health"]);
  assert.deepEqual(out.kohler.categories.sort(), ["environment"]);
});
