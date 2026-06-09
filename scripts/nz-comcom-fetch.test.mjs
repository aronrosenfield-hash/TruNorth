#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseNZD } from "./nz-comcom-fetch.mjs";
import { buildAugment } from "./nz-comcom-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/nz-comcom/sample.csv");

test("parseNZD", () => {
  assert.equal(parseNZD("NZ$15,000,000"), 15000000);
  assert.equal(parseNZD("$3,675,000"), 3675000);
  assert.equal(parseNZD(""), 0);
});

test("rowsToRecords + jsonToRecords", () => {
  const recs = rowsToRecords(parseCSV("respondent,action_type,penalty_nzd,date,url\nFoo,Misleading,NZ$100,2024-01-01,https://x\n"));
  assert.equal(recs[0].penalty_nzd, 100);
  const j = jsonToRecords([{ name: "X", fine: "NZ$250,000", date: "2024-02-02" }]);
  assert.equal(j[0].respondent, "X");
  assert.equal(j[0].penalty_nzd, 250000);
});

test("fixture loads + merge wires through", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 10);
  const { by } = buildAugment(recs, new Set(["briscoe"]), { aliases: {}, parents: {} });
  assert.ok(by["briscoe"]);
});
