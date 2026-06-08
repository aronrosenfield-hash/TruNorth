#!/usr/bin/env node
/**
 * node --test scripts/energy-star-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeBuilding, normalizeProduct, buildSnapshot } from "./energy-star-fetch.mjs";
import { buildAliasIndex, matchOwner } from "./energy-star-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/energy-star/sample.json");

test("normalizeBuilding preserves the fields the merger needs", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const b = normalizeBuilding(seed.buildings[0]);
  assert.equal(b.kind, "building");
  assert.equal(b.name, "Apple Park Visitor Center");
  assert.equal(b.owner_company, "Apple Inc.");
  assert.equal(b.certification_year, 2024);
  assert.equal(b.score, 96);
});

test("normalizeProduct preserves the fields the merger needs", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const p = normalizeProduct(seed.products[0]);
  assert.equal(p.kind, "product");
  assert.equal(p.name, "MacBook Pro 14-inch (M4)");
  assert.equal(p.brand_name, "Apple");
  assert.equal(p.category, "Computers");
  assert.equal(p.model_number, "MX2H3LL/A");
});

test("buildSnapshot counts both kinds", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const buildings = seed.buildings.map(normalizeBuilding);
  const products = seed.products.map(normalizeProduct);
  const snap = buildSnapshot(buildings, products);
  assert.equal(snap.building_count, 3);
  assert.equal(snap.product_count, 4);
});

test("matchOwner routes 'Apple Inc.' → apple", async () => {
  const idx = buildAliasIndex(["apple", "dell", "samsung"], {});
  assert.equal(matchOwner("Apple Inc.", idx), "apple");
  assert.equal(matchOwner("Dell OptiPlex 7020 Micro", idx), "dell");
  assert.equal(matchOwner("Samsung Electronics", idx), "samsung");
  assert.equal(matchOwner("Some Random Other Corp", idx), null);
});

test("matchOwner uses parent-map alias for LG", () => {
  const idx = buildAliasIndex(["lg"], { lg: { aliases: ["LG Electronics"] } });
  assert.equal(matchOwner("LG Electronics", idx), "lg");
});
