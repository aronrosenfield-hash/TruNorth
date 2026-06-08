#!/usr/bin/env node
/**
 * Tests for wwf-palm-oil-fetch.mjs + wwf-palm-oil-merge.mjs
 *
 * Locally:  node --test scripts/wwf-palm-oil-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "./lib/xlsx-minimal.mjs";
import {
  scoreTier,
  normalizeRow,
  findXlsxLink,
  locateHeader,
} from "./wwf-palm-oil-fetch.mjs";
import {
  tierCategory,
  buildAugment,
  makeSlugResolver,
} from "./wwf-palm-oil-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/wwf-palm-oil/sample.xlsx");

test("WWF: scoreTier maps WWF's published 0-24 thresholds", () => {
  assert.equal(scoreTier(22.5), "Leading the way");
  assert.equal(scoreTier(19.5), "Leading the way");
  assert.equal(scoreTier(19.49), "Well on path");
  assert.equal(scoreTier(16.5), "Well on path");
  assert.equal(scoreTier(16.49), "Middle of the pack");
  assert.equal(scoreTier(11), "Middle of the pack");
  assert.equal(scoreTier(10.99), "Lagging behind");
  assert.equal(scoreTier(0), "Lagging behind");
  assert.equal(scoreTier(null), null);
  assert.equal(scoreTier(15, "Non-respondent"), "Non-respondent");
  assert.equal(scoreTier(0, "Non-respondent"), "Non-respondent");
});

test("WWF: real XLSX fixture parses to 285 rows with expected leaders", async () => {
  const buf = await fs.readFile(FIXTURE);
  const { rows, sheetName } = readXlsx(buf);
  assert.equal(sheetName, "Sheet1");
  const { rowIdx, index } = locateHeader(rows);
  const data = rows.slice(rowIdx + 1).map(r => normalizeRow(r, index)).filter(Boolean);
  // The published 2024 scorecard covers ~285 brands.
  assert.ok(data.length >= 280 && data.length <= 290, `expected ~285 rows, got ${data.length}`);

  // Spot-check a known leader.
  const ferrero = data.find(r => /^Ferrero/i.test(r.company));
  assert.ok(ferrero, "Ferrero Group should be present");
  assert.ok(ferrero.total_score >= 19.5, `Ferrero should be Leading the way, got ${ferrero.total_score}`);
  assert.equal(ferrero.tier, "Leading the way");

  // Spot-check a known laggard.
  const muller = data.find(r => /^Müller UK/i.test(r.company));
  assert.ok(muller, "Müller UK should be present");
  assert.equal(muller.tier, "Lagging behind");
});

test("WWF: normalizeRow handles N/A volume + collapsed whitespace", () => {
  const header = ["Company name", "Country of HQ", "Sector", "Response status", "Total score (out of 24)", "Total palm oil volume purchased"];
  const index = Object.fromEntries(header.map((h, i) => [h, i]));
  const r = normalizeRow(["  Acme   Foods  ", "USA", "Food", "Respondent", 12.5, "N/A"], index);
  assert.equal(r.company, "Acme Foods");
  assert.equal(r.total_score, 12.5);
  assert.equal(r.total_palm_oil_volume, null);
  assert.equal(r.tier, "Middle of the pack");
});

test("WWF: normalizeRow returns null for blank rows", () => {
  const index = { "Company name": 0 };
  assert.equal(normalizeRow([], index), null);
  assert.equal(normalizeRow([null, null], index), null);
  assert.equal(normalizeRow(["", "ignored"], index), null);
});

test("WWF: locateHeader finds 'Company name' even when row 1 has merged group headers", () => {
  const rows = [
    ["COMPANY INFORMATION", null, null, null, "COMMITMENTS"],
    ["Company name", "Country of HQ", "Sector", "Response status", "Total score (out of 24)"],
    ["Acme", "USA", "Food", "Respondent", 12],
  ];
  const { rowIdx, index } = locateHeader(rows);
  assert.equal(rowIdx, 1);
  assert.equal(index["Company name"], 0);
  assert.equal(index["Total score (out of 24)"], 4);
});

test("WWF: findXlsxLink prefers full_results / scorecard / pobs URLs", () => {
  const html = `
    <a href="/old/2022/WWF_POBS_2022_summary.xlsx">old</a>
    <a href="/WWF_POBS_2024_full_results.xlsx">DOWNLOAD</a>
    <a href="/random/other.xlsx">other</a>
  `;
  const url = findXlsxLink(html);
  assert.match(url, /WWF_POBS_2024_full_results\.xlsx$/);
});

test("WWF: findXlsxLink falls back to canonical URL when no anchors match", () => {
  const url = findXlsxLink("<p>no links</p>");
  assert.equal(url, "https://palmoilscorecard.panda.org/WWF_POBS_2024_full_results.xlsx");
});

test("WWF merge: tierCategory produces lowercase slug labels", () => {
  assert.equal(tierCategory("Leading the way"), "leading_the_way");
  assert.equal(tierCategory("Non-respondent"), "non_respondent");
  assert.equal(tierCategory(null), null);
});

test("WWF merge: buildAugment shape matches schema", () => {
  const a = buildAugment({
    company: "Unilever PLC",
    country: "United Kingdom",
    region: "Europe and UK",
    sector: "Food",
    response_status: "Respondent",
    total_score: 19.14,
    own_supply_chain_score: 14.5,
    beyond_supply_chain_score: 4.64,
    total_palm_oil_volume: 100000,
    tier: "Well on path",
  }, 2024);
  assert.equal(a.environment.palmOilScore, 19.14);
  assert.equal(a.environment.palmOilTier, "Well on path");
  assert.equal(a.environment.palmOilCategory, "well_on_path");
  assert.equal(a.environment.year, 2024);
  assert.equal(a.environment.sourceUrl, "https://palmoilscorecard.panda.org");
});

test("WWF merge: slug resolver applies direct → alias → parent chain", () => {
  const aliases = { "mcdonalds": "mcdonald-s" };
  const parents = { "kenvue": "johnson-and-johnson" };
  const existing = new Set(["mcdonald-s", "johnson-and-johnson", "unilever"]);
  const resolve = makeSlugResolver({
    aliases, parents, companyExists: (s) => existing.has(s),
  });
  assert.equal(resolve("unilever"), "unilever", "direct hit");
  assert.equal(resolve("mcdonalds"), "mcdonald-s", "alias hit");
  assert.equal(resolve("kenvue"), "johnson-and-johnson", "parent hit");
  assert.equal(resolve("unknown-brand"), null, "orphan");
  assert.equal(resolve(""), null);
  assert.equal(resolve(null), null);
});
