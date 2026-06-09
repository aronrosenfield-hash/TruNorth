#!/usr/bin/env node
/**
 * Tests for uk-cma fetch + merge. No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./lib/company-name-normalize.mjs";
import { rowsToRecords, jsonToRecords, parseGBP } from "./uk-cma-fetch.mjs";
import { buildAugment } from "./uk-cma-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/uk-cma/sample.csv");

test("parseGBP strips £ and commas", () => {
  assert.equal(parseGBP("£84,200,000"), 84200000);
  assert.equal(parseGBP("0"), 0);
  assert.equal(parseGBP(""), 0);
  assert.equal(parseGBP("-"), 0);
});

test("rowsToRecords yields typed records", () => {
  const csv = "respondent,action_type,outcome,penalty_gbp,date,url\nFoo,Cartel,Fine,£1500000,2024-04-01,https://x\n";
  const recs = rowsToRecords(parseCSV(csv));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].respondent, "Foo");
  assert.equal(recs[0].penalty_gbp, 1500000);
  assert.equal(recs[0].action_type, "Cartel");
});

test("jsonToRecords parses CMA-style JSON", () => {
  const recs = jsonToRecords([
    { respondent: "Acme", action_type: "Merger investigation", date: "2024-05-01T00:00:00Z", penalty: "£2,500,000" },
    { title: "Bar", type: "Cartel", date: "2024-06-01" },
  ]);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].penalty_gbp, 2500000);
  assert.equal(recs[1].respondent, "Bar");
  assert.equal(recs[1].penalty_gbp, 0);
});

test("fixture totals over £200M across 12 actions", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  assert.ok(recs.length >= 12);
  const total = recs.reduce((s, r) => s + (r.penalty_gbp || 0), 0);
  assert.ok(total >= 200_000_000, `expected ≥£200M total, got £${total}`);
});

test("buildAugment routes known brands to canonical slugs", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const recs = rowsToRecords(parseCSV(csv));
  // Stub knownSlugs covering the brands we expect to route
  const knownSlugs = new Set([
    "meta-platforms", "microsoft", "amazon", "google-alphabet", "apple", "pfizer", "sainsbury-s",
  ]);
  const maps = {
    aliases: {},
    parents: { google: { parent: "google-alphabet" } },
  };
  const { by, orphans } = buildAugment(recs, knownSlugs, maps);
  assert.ok(by["meta-platforms"], "Meta routed");
  assert.ok(by["google-alphabet"], "Google routed via parent");
  assert.ok(by["amazon"], "Amazon routed via seed");
  assert.equal(by["pfizer"].total_penalty_gbp, 84200000);
  assert.ok(Array.isArray(orphans));
});
