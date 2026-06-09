#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseJPY } from "./jftc-fetch.mjs";
import { buildAugment } from "./jftc-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/jftc/sample.csv");

test("parseJPY", () => {
  assert.equal(parseJPY("¥7,195,400,000"), 7195400000);
  assert.equal(parseJPY(""), 0);
});

test("rowsToRecords + jsonToRecords", () => {
  const recs = rowsToRecords(parseCSV("respondent,action_type,penalty_jpy,date,url\nFoo,Cartel,¥100,2024-01-01,https://x\n"));
  assert.equal(recs[0].penalty_jpy, 100);
  const j = jsonToRecords([{ name: "X", surcharge: "¥250,000", date: "2024-02-02" }]);
  assert.equal(j[0].respondent, "X");
  assert.equal(j[0].penalty_jpy, 250000);
});

test("fixture loads + merge wires through", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 13);
  const { by } = buildAugment(recs, new Set(["apple", "hitachi"]), { aliases: {}, parents: {} });
  assert.ok(by["apple"]);
  assert.ok(by["hitachi"]);
});
