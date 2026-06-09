#!/usr/bin/env node
/**
 * Tests for uk-hse fetch + merge. No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseGBP } from "./uk-hse-fetch.mjs";
import { buildAugment } from "./uk-hse-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/uk-hse/sample.csv");

test("parseGBP strips £ and commas", () => {
  assert.equal(parseGBP("£1,900,000"), 1900000);
  assert.equal(parseGBP(""), 0);
});

test("rowsToRecords yields typed records", () => {
  const csv = "defendant,offence,fine_gbp,date,url\nFooCo,Asbestos,£500000,2024-01-01,https://x\n";
  const recs = rowsToRecords(parseCSV(csv));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].defendant, "FooCo");
  assert.equal(recs[0].fine_gbp, 500000);
});

test("jsonToRecords parses HSE-style JSON", () => {
  const recs = jsonToRecords([
    { defendant: "Acme Ltd", offence: "Workplace transport fatality", date: "2024-05-01", fine: "£2,500,000" },
  ]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].fine_gbp, 2500000);
});

test("fixture covers Tesco + Rolls-Royce + others", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 12);
  const names = new Set(recs.map(r => r.defendant.toLowerCase()));
  assert.ok([...names].some(n => n.includes("tesco")));
  assert.ok([...names].some(n => n.includes("rolls-royce")));
});

test("buildAugment aggregates per-defendant", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  const knownSlugs = new Set(["tesco", "rolls-royce", "coca-cola"]);
  const maps = { aliases: {}, parents: {} };
  const { by } = buildAugment(recs, knownSlugs, maps);
  assert.ok(by["tesco"], "Tesco routed (direct)");
  assert.ok(by["rolls-royce"], "Rolls-Royce routed (direct)");
  assert.ok(by["coca-cola"], "Coca-Cola routed (seed)");
  assert.equal(by["tesco"].source, "uk-hse");
});
