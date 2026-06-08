#!/usr/bin/env node
/**
 * node --test scripts/dol-whd-violations-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWhdRow, buildSnapshot } from "./dol-whd-violations-fetch.mjs";
import { parseCSV } from "./lib/csv-mini.mjs";
import { buildAliasIndex, matchCase, aggregateForSlug } from "./dol-whd-violations-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/dol-whd-violations/sample.csv");

test("parseWhdRow coerces numeric strings", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSV(text);
  const p = parseWhdRow(rows[0]);
  assert.equal(p.trade_name, "Walmart Supercenter #1234");
  assert.equal(p.case_violation_count, 12);
  assert.equal(p.back_wages_usd, 85420.5);
  assert.equal(p.employees_affected, 42);
  assert.equal(p.civil_penalty_usd, 0);
  assert.equal(p.flsa, true);
});

test("parseWhdRow tolerates missing values", () => {
  const p = parseWhdRow({});
  assert.equal(p.case_violation_count, 0);
  assert.equal(p.back_wages_usd, 0);
  assert.equal(p.flsa, false);
  assert.equal(p.naics_code, null);
});

test("buildSnapshot totals back wages + employees", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSV(text).map(parseWhdRow);
  const snap = buildSnapshot(rows);
  assert.equal(snap.case_count, 5);
  // 85420.50 + 412300 + 1820000 + 12380 + 91200
  assert.equal(snap.total_back_wages_usd, 2421300.5);
  assert.equal(snap.total_employees_affected, 42 + 210 + 185 + 8 + 53);
});

test("matchCase routes Tyson via legal name", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSV(text).map(parseWhdRow);
  const idx = buildAliasIndex(["tyson-foods", "walmart"], {});
  const tyson = rows.find(r => r.trade_name.includes("Tyson"));
  assert.equal(matchCase(tyson, idx), "tyson-foods");
});

test("matchCase routes 'Walmart Supercenter #1234' to walmart slug", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSV(text).map(parseWhdRow);
  const idx = buildAliasIndex(["walmart"], {});
  const walmart = rows.find(r => r.trade_name.includes("Walmart"));
  assert.equal(matchCase(walmart, idx), "walmart");
});

test("aggregateForSlug sorts sample_cases by back wages desc", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSV(text).map(parseWhdRow);
  const agg = aggregateForSlug("any", rows, "https://x");
  assert.equal(agg.case_count, 5);
  assert.equal(agg.sample_cases[0].trade_name, "Tyson Foods Plant 38");
  assert.equal(agg.sample_cases[0].back_wages_usd, 1820000);
});
