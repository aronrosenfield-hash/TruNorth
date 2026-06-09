#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseINR } from "./cci-india-fetch.mjs";
import { buildAugment } from "./cci-india-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/cci-india/sample.csv");

test("parseINR", () => {
  assert.equal(parseINR("₹13,380,000,000"), 13380000000);
  assert.equal(parseINR(""), 0);
});

test("rowsToRecords + jsonToRecords", () => {
  const recs = rowsToRecords(parseCSV("respondent,action_type,penalty_inr,date,url\nFoo,Abuse,100,2024-01-01,https://x\n"));
  assert.equal(recs[0].penalty_inr, 100);
  const j = jsonToRecords([{ name: "X", penalty: "₹250,000", date: "2024-02-02" }]);
  assert.equal(j[0].respondent, "X");
  assert.equal(j[0].penalty_inr, 250000);
});

test("fixture loads + merge wires through", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 11);
  const knownSlugs = new Set(["google-alphabet", "amazon"]);
  const maps = { aliases: {}, parents: { google: { parent: "google-alphabet" } } };
  const { by } = buildAugment(recs, knownSlugs, maps);
  assert.ok(by["google-alphabet"]);
  assert.ok(by["amazon"]);
});
