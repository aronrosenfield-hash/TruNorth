#!/usr/bin/env node
/**
 * Tests for DW-17 canada-competition-bureau fetch + merge. No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseCAD } from "./canada-competition-bureau-fetch.mjs";
import { buildAugment } from "./canada-competition-bureau-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/canada-competition-bureau/sample.csv");

test("parseCAD strips C$, commas", () => {
  assert.equal(parseCAD("C$38,300,000"), 38300000);
  assert.equal(parseCAD("0"), 0);
  assert.equal(parseCAD(""), 0);
});

test("rowsToRecords yields typed records", () => {
  const csv = "respondent,action_type,penalty_cad,date,url\nFoo,Deceptive marketing,C$1500000,2024-04-01,https://x\n";
  const recs = rowsToRecords(parseCSV(csv));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].respondent, "Foo");
  assert.equal(recs[0].penalty_cad, 1500000);
});

test("jsonToRecords parses CB-style JSON", () => {
  const recs = jsonToRecords([
    { respondent: "Acme", action_type: "Cartel", date: "2024-05-01T00:00:00Z", amount: "C$2,500,000" },
    { title: "Bar", type: "Mergers", date: "2024-06-01" },
  ]);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].penalty_cad, 2500000);
  assert.equal(recs[1].respondent, "Bar");
  assert.equal(recs[1].penalty_cad, 0);
});

test("fixture totals C$100M+ across 8 actions", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 8);
  const total = recs.reduce((s, r) => s + (r.penalty_cad || 0), 0);
  assert.ok(total >= 100_000_000);
});

test("buildAugment includes action_types", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const aug = buildAugment(rowsToRecords(parseCSV(csv)));
  const loblawKey = Object.keys(aug).find(k => k.startsWith("loblaw"));
  assert.ok(loblawKey, "Loblaw slug present");
  assert.equal(aug[loblawKey].total_penalty_cad, 50000000);
  assert.ok(aug[loblawKey].action_types.includes("Cartel"));
  assert.equal(aug[loblawKey].source, "canada-competition-bureau");
});
