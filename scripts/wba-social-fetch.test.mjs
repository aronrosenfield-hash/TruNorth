#!/usr/bin/env node
/**
 * Tests for wba-social-fetch.mjs + wba-social-merge.mjs
 *
 * Locally:  node --test scripts/wba-social-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";
import { normalizeRow, findDataLink } from "./wba-social-fetch.mjs";
import { computeBands, bandFor, buildAugment } from "./wba-social-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/wba-social/sample.csv");

test("WBA: fixture parses to 10 normalized rows", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(text).map(normalizeRow).filter(Boolean);
  assert.equal(rows.length, 10);
  const unilever = rows[0];
  assert.equal(unilever.company, "Unilever PLC");
  assert.equal(unilever.rank, 1);
  assert.equal(unilever.total_score, 16.5);
  assert.equal(unilever.indicators_met, 15);
});

test("WBA: numeric fields coerce to numbers (or null)", () => {
  const r = normalizeRow({
    Company: "X",
    Rank: "42",
    "Total Score": "12.5",
    "Indicators Met": "",
  });
  assert.equal(r.rank, 42);
  assert.equal(r.total_score, 12.5);
  assert.equal(r.indicators_met, null, "blank cells become null, not NaN");
});

test("WBA: findDataLink prefers benchmark-related CSV", () => {
  const html = `
    <a href="/files/spec.pdf">PDF</a>
    <a href="/wba/social-benchmark-2025.csv">CSV</a>
    <a href="/other.csv">other</a>
  `;
  const url = findDataLink(html);
  assert.match(url, /social-benchmark-2025\.csv$/);
});

test("WBA merge: computeBands defaults under low-N", () => {
  const b = computeBands([10, 11, 12]);
  assert.equal(b.leader, 13);
  assert.equal(b.laggard, 4.5);
});

test("WBA merge: bandFor classifies correctly", () => {
  const bands = { leader: 13, laggard: 4.5 };
  assert.equal(bandFor(15, bands), "leader");
  assert.equal(bandFor(8, bands), "mid");
  assert.equal(bandFor(3, bands), "laggard");
  assert.equal(bandFor(null, bands), null);
});

test("WBA merge: buildAugment includes percentile", () => {
  const aug = buildAugment(
    { company: "Foo", total_score: 14, rank: 5, industry: "Tech", headquarters: "US" },
    { leader: 13, laggard: 4.5 },
    100,
  );
  assert.equal(aug.score_band, "leader");
  // rank 5 / 100 → percentile (100 - 5 + 1) / 100 = 0.96
  assert.equal(aug.wbaSocialPercentile, 0.96);
});

test("WBA merge: missing rank → null percentile", () => {
  const aug = buildAugment(
    { company: "Foo", total_score: 14, rank: null },
    { leader: 13, laggard: 4.5 },
    100,
  );
  assert.equal(aug.wbaSocialPercentile, null);
});
