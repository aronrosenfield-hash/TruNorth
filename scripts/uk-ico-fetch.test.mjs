#!/usr/bin/env node
/**
 * Tests for DW-15 uk-ico fetch + merge. Uses fixture; no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseGBP } from "./uk-ico-fetch.mjs";
import { buildAugment } from "./uk-ico-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/uk-ico/sample.csv");

test("parseGBP handles £, commas, empty", () => {
  assert.equal(parseGBP("£20,000,000"), 20000000);
  assert.equal(parseGBP("0"), 0);
  assert.equal(parseGBP(""), 0);
  assert.equal(parseGBP(null), null);
});

test("rowsToRecords reads header-indexed CSV", () => {
  const csv = "organisation,action_type,sector,date_issued,fine_amount_gbp,url\nFoo Ltd,Monetary Penalty Notice,Tech,2024-01-02,£500000,https://x\n";
  const recs = rowsToRecords(parseCSV(csv));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].organisation, "Foo Ltd");
  assert.equal(recs[0].fine_amount_gbp, 500000);
  assert.equal(recs[0].action_type, "Monetary Penalty Notice");
});

test("jsonToRecords reads ICO JSON shape", () => {
  const recs = jsonToRecords([
    { organisation: "Acme", action_type: "Reprimand", date_issued: "2024-03-01T00:00:00Z", fine_amount_gbp: 0 },
    { title: "Bar Ltd", type: "Monetary Penalty Notice", date: "2023-09-15", amount: "£1,000,000" },
  ]);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].organisation, "Bar Ltd");
  assert.equal(recs[1].fine_amount_gbp, 1000000);
  assert.equal(recs[1].date_issued, "2023-09-15");
});

test("fixture CSV parses to >=8 records totaling £40M+", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 8);
  const total = recs.reduce((s, r) => s + (r.fine_amount_gbp || 0), 0);
  assert.ok(total >= 40_000_000, `total ${total} should be >= 40M`);
});

test("buildAugment aggregates fines + sectors", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  const aug = buildAugment(recs);
  const baKey = Object.keys(aug).find(k => k.startsWith("british-airways"));
  assert.ok(baKey, "british-airways slug present");
  assert.equal(aug[baKey].total_fines_gbp, 20000000);
  assert.equal(aug[baKey].source, "uk-ico");
});
