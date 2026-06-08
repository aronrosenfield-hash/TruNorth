#!/usr/bin/env node
/**
 * Tests for usda-organic-fetch.mjs + usda-organic-merge.mjs
 *
 * Locally:  node --test scripts/usda-organic-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";
import { normalizeRow } from "./usda-organic-fetch.mjs";
import { mergeIntoEntry, finalizeEntry } from "./usda-organic-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/usda-organic/sample.csv");

test("USDA Organic: fixture parses, scopes split", async () => {
  const rows = parseCSVToObjects(await fs.readFile(FIXTURE, "utf-8")).map(normalizeRow).filter(Boolean);
  assert.equal(rows.length, 10);
  const ov = rows.find(r => r.operation_name === "Organic Valley CROPP Cooperative");
  assert.deepEqual(ov.scopes, ["crops", "livestock", "handling"]);
  assert.equal(ov.status, "certified");
});

test("USDA Organic: surrendered/suspended pass through", async () => {
  const rows = parseCSVToObjects(await fs.readFile(FIXTURE, "utf-8")).map(normalizeRow).filter(Boolean);
  assert.equal(rows.find(r => /Horizon/.test(r.operation_name)).status, "surrendered");
  assert.equal(rows.find(r => /Applegate/.test(r.operation_name)).status, "suspended");
});

test("USDA Organic merge: multi-op brand merges scopes + picks best status", () => {
  let entry;
  entry = mergeIntoEntry(entry, {
    operation_name: "Foo Farms", certifier: "OTCO", status: "suspended",
    scopes: ["crops"], certified_products: ["wheat"], country: "US",
    last_inspected: "2024-01-01",
  });
  entry = mergeIntoEntry(entry, {
    operation_name: "Foo Farms", certifier: "QAI", status: "certified",
    scopes: ["livestock"], certified_products: ["beef"], country: "US",
    last_inspected: "2025-08-22",
  });
  const out = finalizeEntry(entry);
  assert.equal(out.status, "certified", "certified beats suspended");
  assert.equal(out.certifier, "QAI", "took certifier from the certified row");
  assert.equal(out.operation_count, 2);
  assert.deepEqual(out.scopes.sort(), ["crops", "livestock"]);
  assert.deepEqual(out.certified_products.sort(), ["beef", "wheat"]);
  assert.equal(out.last_inspected_max, "2025-08-22");
  assert.equal(out.hasUsdaOrganicCertification, true);
});

test("USDA Organic merge: surrendered-only brand → hasUsdaOrganicCertification=false", () => {
  let entry = mergeIntoEntry(undefined, {
    operation_name: "Horizon", certifier: "QAI", status: "surrendered",
    scopes: ["livestock"], certified_products: ["milk"], country: "US",
    last_inspected: "2024-06-15",
  });
  const out = finalizeEntry(entry);
  assert.equal(out.hasUsdaOrganicCertification, false);
  assert.equal(out.status, "surrendered");
});
