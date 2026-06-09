#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseSGD } from "./cccs-fetch.mjs";
import { buildAugment } from "./cccs-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/cccs/sample.csv");

test("parseSGD", () => {
  assert.equal(parseSGD("S$6,420,000"), 6420000);
  assert.equal(parseSGD(""), 0);
});

test("rowsToRecords + jsonToRecords", () => {
  const recs = rowsToRecords(parseCSV("respondent,action_type,penalty_sgd,date,url\nFoo,Cartel,S$100,2024-01-01,https://x\n"));
  assert.equal(recs[0].penalty_sgd, 100);
  const j = jsonToRecords([{ name: "X", fine: "S$250,000", date: "2024-02-02" }]);
  assert.equal(j[0].respondent, "X");
  assert.equal(j[0].penalty_sgd, 250000);
});

test("fixture loads + merge wires through", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 10);
  const { by } = buildAugment(recs, new Set(["uber", "hitachi"]), { aliases: {}, parents: {} });
  assert.ok(by["uber"]);
  assert.ok(by["hitachi"]);
});
