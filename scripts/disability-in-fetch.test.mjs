#!/usr/bin/env node
/**
 * Tests for DW-13 disability-in fetch + merge.
 * Uses scripts/fixtures/disability-in/sample.csv. No network.
 *
 * Locally: node scripts/disability-in-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, rowsToRecords } from "./disability-in-fetch.mjs";
import { buildAugment } from "./disability-in-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/disability-in/sample.csv");

test("parseCsv parses simple rows", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ["a", "b", "c"]);
  assert.deepEqual(rows[2], ["4", "5", "6"]);
});

test("parseCsv handles quoted commas", () => {
  const rows = parseCsv('name,score\n"Foo, Inc.",100\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], "Foo, Inc.");
  assert.equal(rows[1][1], "100");
});

test("rowsToRecords produces typed records", () => {
  const rows = parseCsv("company,dei_score,year\nFoo Inc,80,2024\n");
  const recs = rowsToRecords(rows);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].company, "Foo Inc");
  assert.equal(recs[0].dei_score, 80);
  assert.equal(recs[0].year, 2024);
});

test("fixture CSV parses to >=10 records with scores 80..100", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const records = rowsToRecords(parseCsv(csv));
  assert.ok(records.length >= 10);
  for (const r of records) {
    assert.equal(typeof r.dei_score, "number");
    assert.ok(r.dei_score >= 80 && r.dei_score <= 100);
    assert.equal(r.year, 2024);
  }
});

test("buildAugment slugifies + dedupes on year/score", () => {
  const augment = buildAugment([
    { company: "The Boeing Company", dei_score: 100, year: 2024 },
    { company: "Boeing",             dei_score:  90, year: 2023 },
    { company: "Apple Inc.",         dei_score:  80, year: 2024 },
  ]);
  // "The Boeing Company" -> "boeing"  via suffix strip
  assert.ok(augment["boeing"], "Boeing slug present");
  assert.equal(augment["boeing"].dei_score, 100, "keeps 2024 (newer) over 2023");
  assert.ok(augment["apple"], "Apple slug present");
  assert.equal(augment["apple"].dei_score, 80);
  assert.equal(augment["apple"].source, "disability-in");
});
