#!/usr/bin/env node
/**
 * Tests for DW-16 mas-singapore fetch + merge. No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseSGD } from "./mas-singapore-fetch.mjs";
import { buildAugment } from "./mas-singapore-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/mas-singapore/sample.csv");

test("parseSGD strips S$, commas", () => {
  assert.equal(parseSGD("S$1,200,000"), 1200000);
  assert.equal(parseSGD("0"), 0);
  assert.equal(parseSGD(""), 0);
});

test("rowsToRecords yields typed records", () => {
  const csv = "entity,action_type,amount_sgd,date,url\nFoo,Composition,S$500000,2024-04-01,https://x\n";
  const recs = rowsToRecords(parseCSV(csv));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].entity, "Foo");
  assert.equal(recs[0].amount_sgd, 500000);
});

test("jsonToRecords parses MAS-style JSON", () => {
  const recs = jsonToRecords([
    { entity: "Acme", action_type: "Civil penalty", date: "2024-05-01T00:00:00Z", amount: "S$2,500,000" },
  ]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].amount_sgd, 2500000);
  assert.equal(recs[0].date, "2024-05-01");
});

test("fixture CSV totals S$120M+ (Goldman 1MDB dominates)", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 7);
  const total = recs.reduce((s, r) => s + (r.amount_sgd || 0), 0);
  assert.ok(total >= 120_000_000);
});

test("buildAugment aggregates and dedupes", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const aug = buildAugment(rowsToRecords(parseCSV(csv)));
  const gsKey = Object.keys(aug).find(k => k.startsWith("goldman-sachs"));
  assert.ok(gsKey, "Goldman slug present");
  assert.equal(aug[gsKey].total_amount_sgd, 122000000);
  assert.equal(aug[gsKey].source, "mas-singapore");
});
