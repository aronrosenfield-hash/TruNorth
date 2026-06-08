#!/usr/bin/env node
/**
 * Tests for wob5050-fetch.mjs + wob5050-merge.mjs
 *
 * Locally:  node --test scripts/wob5050-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";
import { normalizeRow, findCsvLink } from "./wob5050-fetch.mjs";
import { parityScore, buildAugment } from "./wob5050-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/wob5050/sample.csv");

test("5050WOB: fixture parses, ratings validated", async () => {
  const rows = parseCSVToObjects(await fs.readFile(FIXTURE, "utf-8")).map(normalizeRow).filter(Boolean);
  assert.equal(rows.length, 15);
  const apple = rows.find(r => r.ticker === "AAPL");
  assert.equal(apple.rating, "A");
  assert.equal(apple.women_on_board, 4);
  assert.equal(apple.total_board_size, 8);
  assert.equal(apple.pct_women, 50.0);
});

test("5050WOB: invalid rating string → null", () => {
  const r = normalizeRow({ Company: "X", Rating: "Z" });
  assert.equal(r.rating, null);
});

test("5050WOB: derives pct_women if missing", () => {
  const r = normalizeRow({
    Company: "X", Rating: "B",
    "Women on Board": "3", "Total Board Size": "10",
  });
  assert.equal(r.pct_women, 30.0);
});

test("5050WOB merge: parityScore caps at 1.0", () => {
  assert.equal(parityScore(50), 1.0);
  assert.equal(parityScore(60), 1.0);
  assert.equal(parityScore(25), 0.5);
  assert.equal(parityScore(0), 0);
  assert.equal(parityScore(null), null);
});

test("5050WOB merge: buildAugment shape", () => {
  const a = buildAugment({
    company: "X", ticker: "X", sector: "Tech", rating: "A",
    women_on_board: 5, total_board_size: 10, pct_women: 50.0,
    report_quarter: "2026Q1",
  });
  assert.equal(a.boardParityScore, 1.0);
  assert.equal(a.rating, "A");
});

test("5050WOB: findCsvLink picks quarterly report", () => {
  const html = `<a href="/reports/2026Q1-GDI-Russell3000.csv">Q1</a>`;
  assert.match(findCsvLink(html), /Russell3000\.csv$/);
});
