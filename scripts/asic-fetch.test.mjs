#!/usr/bin/env node
/**
 * Tests for asic fetch + merge. No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseAUD } from "./asic-fetch.mjs";
import { buildAugment } from "./asic-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/asic/sample.csv");

test("parseAUD strips A$ and commas", () => {
  assert.equal(parseAUD("A$1,300,000,000"), 1300000000);
  assert.equal(parseAUD("$700,000,000"), 700000000);
  assert.equal(parseAUD(""), 0);
});

test("rowsToRecords yields typed records", () => {
  const csv = "respondent,action_type,penalty_aud,date,url\nFoo,AML/CTF,A$1500000,2024-04-01,https://x\n";
  const recs = rowsToRecords(parseCSV(csv));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].respondent, "Foo");
  assert.equal(recs[0].penalty_aud, 1500000);
});

test("jsonToRecords parses ASIC-style JSON", () => {
  const recs = jsonToRecords([
    { respondent: "Acme", action_type: "Greenwashing", date: "2024-05-01", penalty: "A$11,300,000" },
  ]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].penalty_aud, 11300000);
});

test("fixture totals over A$1B", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 13);
  const total = recs.reduce((s, r) => s + (r.penalty_aud || 0), 0);
  assert.ok(total >= 1_000_000_000, `expected ≥A$1B total, got A$${total}`);
});

test("buildAugment greenwashing categorization", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  const knownSlugs = new Set(["vanguard", "tesla"]);
  const maps = { aliases: {}, parents: {} };
  const { by } = buildAugment(recs, knownSlugs, maps);
  assert.ok(by["vanguard"], "Vanguard routed via seed");
  assert.ok(by["vanguard"].action_types.some(t => t.includes("Greenwash")), "greenwashing action type present");
});
