#!/usr/bin/env node
/**
 * Tests for forest500-fetch.mjs + forest500-merge.mjs
 *
 * Locally:  node --test scripts/forest500-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";
import { normalizeRow, findCsvLink } from "./forest500-fetch.mjs";
import { tierFor, buildAugment } from "./forest500-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/forest500/sample.csv");

test("Forest500: fixture parses, N/A → null", async () => {
  const rows = parseCSVToObjects(await fs.readFile(FIXTURE, "utf-8")).map(normalizeRow).filter(Boolean);
  assert.equal(rows.length, 15);
  const cargill = rows.find(r => r.company === "Cargill Inc");
  assert.equal(cargill.overall_score_2024, 42);
  assert.equal(cargill.timber_score, null, "N/A → null");
  assert.deepEqual(cargill.commodities, ["soy", "palm", "beef"]);
});

test("Forest500: financial institutions get marked", async () => {
  const rows = parseCSVToObjects(await fs.readFile(FIXTURE, "utf-8")).map(normalizeRow).filter(Boolean);
  const blackrock = rows.find(r => r.company === "BlackRock Inc");
  assert.equal(blackrock.entity_type, "financial_institution");
  const cargill = rows.find(r => r.company === "Cargill Inc");
  assert.equal(cargill.entity_type, "company");
});

test("Forest500 merge: tier thresholds", () => {
  assert.equal(tierFor(85), "leader");
  assert.equal(tierFor(70), "leader");
  assert.equal(tierFor(50), "midpack");
  assert.equal(tierFor(25), "laggard");
  assert.equal(tierFor(0), "laggard");
  assert.equal(tierFor(null), null);
});

test("Forest500 merge: buildAugment shape", () => {
  const a = buildAugment({
    company: "X", country: "US", sector: "Manufacturer",
    entity_type: "company", overall_score_2024: 72,
    soy_score: 80, palm_score: 70, beef_score: null,
    timber_score: null, pulp_score: 65,
    commodities: ["soy", "palm", "pulp"],
  });
  assert.equal(a.forest500Tier, "leader");
  assert.equal(a.commodity_scores.beef, null);
  assert.deepEqual(a.commodities_exposed, ["soy", "palm", "pulp"]);
  assert.equal(a.hasDeforestationExposure, true);
});

test("Forest500: findCsvLink prefers score-related CSV", () => {
  const html = `<a href="/2024/Forest500-scorecards.csv">x</a><a href="/junk.csv">y</a>`;
  const url = findCsvLink(html);
  assert.match(url, /Forest500-scorecards\.csv$/);
});
