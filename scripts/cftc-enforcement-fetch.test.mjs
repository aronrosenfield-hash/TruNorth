#!/usr/bin/env node
/**
 * Tests for DW-14 cftc-enforcement fetch + merge.
 * Uses scripts/fixtures/cftc-enforcement/sample.csv. No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./disability-in-fetch.mjs";
import { rowsToRecords, entitiesToRecords, parseUSD } from "./cftc-enforcement-fetch.mjs";
import { buildAugment } from "./cftc-enforcement-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/cftc-enforcement/sample.csv");

test("parseUSD handles $, commas, decimals", () => {
  assert.equal(parseUSD("$1,200,000.50"), 1200000.5);
  assert.equal(parseUSD("1000"), 1000);
  assert.equal(parseUSD(""), null);
  assert.equal(parseUSD(null), null);
  assert.equal(parseUSD("abc"), null);
});

test("rowsToRecords parses CSV correctly", () => {
  const csv = "respondent,violation,civil_penalty,date,url\nFoo,Spoofing,$100000,2024-01-02,https://x\n";
  const recs = rowsToRecords(parseCsv(csv));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].respondent, "Foo");
  assert.equal(recs[0].civil_penalty, 100000);
  assert.equal(recs[0].date, "2024-01-02");
});

test("entitiesToRecords parses OpenSanctions-style JSON", () => {
  const recs = entitiesToRecords([
    { properties: { name: ["Acme Corp"], description: ["fraud"], amount: ["500000"], date: ["2024-03-01T00:00:00Z"], sourceUrl: ["https://example/y"] } },
    { properties: { name: ["Bar Inc"], fineAmount: ["$2,000,000"], startDate: ["2023-09-15"] } },
  ]);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].respondent, "Acme Corp");
  assert.equal(recs[0].civil_penalty, 500000);
  assert.equal(recs[0].date, "2024-03-01");
  assert.equal(recs[1].civil_penalty, 2000000);
});

test("fixture CSV produces >=7 records with valid penalty totals", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCsv(csv));
  assert.ok(recs.length >= 7);
  const total = recs.reduce((s, r) => s + (r.civil_penalty || 0), 0);
  assert.ok(total > 5_000_000_000, "fixture totals exceed $5B");
});

test("buildAugment aggregates per company", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCsv(csv));
  const aug = buildAugment(recs);
  // JPMorgan Chase Bank N.A. -> "jpmorgan-chase-bank-n-a" via normalize
  const jpmKey = Object.keys(aug).find(k => k.startsWith("jpmorgan"));
  assert.ok(jpmKey, "JPM slug present");
  assert.ok(aug[jpmKey].total_penalty_usd >= 920_000_000);
  assert.equal(aug[jpmKey].source, "cftc-enforcement");
});
