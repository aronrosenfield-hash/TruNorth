#!/usr/bin/env node
/**
 * Test harness for usda-fooddata-fetch.mjs.
 *
 * Uses node:test (built into Node 22, no deps). Runs against the
 * checked-in 50-row fixture at scripts/fixtures/usda-fooddata/sample.csv.
 * NO network calls — fixtures only.
 *
 * Locally:
 *   node --test scripts/usda-fooddata-fetch.test.mjs
 *   node scripts/usda-fooddata-fetch.test.mjs           # also works
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  normalizeGtin,
  normKey,
  parseCsvLine,
  extractFields,
  streamCsvRows,
  runPipeline,
} from "./usda-fooddata-fetch.mjs";
import { brandOwnerCandidates } from "./usda-fooddata-merge.mjs";
import { createReadStream } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/usda-fooddata/sample.csv");

test("normalizeGtin: UPC-A 12 digits pads to 14", () => {
  // Coca-Cola Classic UPC-A from the fixture: 049000050103
  assert.equal(normalizeGtin("049000050103"), "00049000050103");
});

test("normalizeGtin: EAN-13 13 digits pads to 14", () => {
  // Hot Pockets EAN-13: 0043695001235
  assert.equal(normalizeGtin("0043695001235"), "00043695001235");
});

test("normalizeGtin: already-14 GTIN passes through", () => {
  assert.equal(normalizeGtin("12345678901234"), "12345678901234");
});

test("normalizeGtin: strips non-numeric Excel quote-protection", () => {
  assert.equal(normalizeGtin("'0049000050103"), "00049000050103");
  assert.equal(normalizeGtin('"0049000050103"'), "00049000050103");
});

test("normalizeGtin: returns null for empty or too-short input", () => {
  assert.equal(normalizeGtin(""), null);
  assert.equal(normalizeGtin(null), null);
  assert.equal(normalizeGtin(undefined), null);
  assert.equal(normalizeGtin("1234"), null);          // too short
  assert.equal(normalizeGtin("not-a-barcode"), null); // strips to ""
});

test("normalizeGtin: handles 8-digit UPC-E by padding", () => {
  // UPC-E (compressed) is 8 digits. We pad and keep — caller can expand
  // separately. We don't expand here; we just need a stable key.
  assert.equal(normalizeGtin("01234565"), "00000001234565");
});

test("normKey: matches App.jsx resolveBrand normalization", () => {
  assert.equal(normKey("Coca-Cola"), "cocacola");
  assert.equal(normKey("M&M's"), "mms");
  assert.equal(normKey("Ben & Jerry's"), "benjerrys");
  assert.equal(normKey("OREO"), "oreo");
  assert.equal(normKey("  PepsiCo, Inc.  "), "pepsicoinc");
  assert.equal(normKey(""), "");
  assert.equal(normKey(null), "");
});

test("parseCsvLine: handles quoted fields with embedded commas", () => {
  const fields = parseCsvLine('1000003,"PepsiCo, Inc.","LAY\'S","Classic",028400064057');
  assert.equal(fields.length, 5);
  assert.equal(fields[0], "1000003");
  assert.equal(fields[1], "PepsiCo, Inc.");
  assert.equal(fields[2], "LAY'S");
  assert.equal(fields[3], "Classic");
  assert.equal(fields[4], "028400064057");
});

test("parseCsvLine: handles escaped quotes", () => {
  const fields = parseCsvLine('a,"she said ""hi""",c');
  assert.equal(fields.length, 3);
  assert.equal(fields[1], 'she said "hi"');
});

test("parseCsvLine: handles trailing CR (Windows line ending)", () => {
  const fields = parseCsvLine("a,b,c\r");
  assert.deepEqual(fields, ["a", "b", "c"]);
});

test("parseCsvLine: handles empty trailing fields", () => {
  const fields = parseCsvLine("a,b,,");
  assert.deepEqual(fields, ["a", "b", "", ""]);
});

test("extractFields: keeps a happy-path row", () => {
  const row = {
    fdc_id: "1000001",
    brand_owner: "Mondelez Global LLC",
    brand_name: "OREO",
    gtin_upc: "044000032029",
  };
  assert.deepEqual(extractFields(row), {
    gtin: "00044000032029",
    brandName: "OREO",
    brandOwner: "Mondelez Global LLC",
  });
});

test("extractFields: drops rows with missing brand_owner", () => {
  const row = {
    fdc_id: "1000042",
    brand_owner: "",
    brand_name: "ORPHAN BRAND",
    gtin_upc: "0099999999991",
  };
  assert.equal(extractFields(row), null);
});

test("extractFields: drops rows with missing gtin_upc", () => {
  const row = {
    fdc_id: "1000041",
    brand_owner: "Some Tiny Co.",
    brand_name: "UNKNOWN BRAND",
    gtin_upc: "",
  };
  assert.equal(extractFields(row), null);
});

test("streamCsvRows: parses the 50-row fixture", async () => {
  const rows = [];
  for await (const r of streamCsvRows(createReadStream(FIXTURE))) {
    rows.push(r);
  }
  assert.equal(rows.length, 50, "all 50 rows yielded");
  assert.equal(rows[0].brand_owner, "Mondelez Global LLC");
  assert.equal(rows[0].brand_name, "OREO");
  assert.equal(rows[0].gtin_upc, "044000032029");
  // Verify the PepsiCo row with its embedded comma was correctly quoted.
  const lays = rows.find(r => r.brand_name === "LAY'S");
  assert.ok(lays, "fixture has a LAY'S row");
  assert.equal(lays.brand_owner, "PepsiCo, Inc.", "embedded comma in brand_owner preserved");
});

test("runPipeline: end-to-end on fixture filters + writes valid JSON", async () => {
  const out = path.join(os.tmpdir(), `usda-fixture-${Date.now()}.json`);
  const stats = await runPipeline({ srcCsvPath: FIXTURE, limit: Infinity, outPath: out });
  assert.equal(stats.seen, 50, "scanned 50 rows");
  // 2 of the 50 rows are intentionally invalid (no owner, no gtin).
  assert.equal(stats.skipped, 2, "skipped 2 rows with missing fields");
  assert.equal(stats.kept, 48, "kept 48 rows");
  const written = JSON.parse(await fs.readFile(out, "utf-8"));
  assert.ok(Array.isArray(written), "output is a JSON array");
  assert.equal(written.length, 48);
  assert.equal(written[0].brandName, "OREO");
  assert.equal(written[0].brandOwner, "Mondelez Global LLC");
  assert.equal(written[0].gtin, "00044000032029");
  await fs.unlink(out);
});

test("runPipeline: --limit short-circuits early", async () => {
  const out = path.join(os.tmpdir(), `usda-fixture-limit-${Date.now()}.json`);
  const stats = await runPipeline({ srcCsvPath: FIXTURE, limit: 5, outPath: out });
  assert.equal(stats.kept, 5, "stopped after 5 kept rows");
  const written = JSON.parse(await fs.readFile(out, "utf-8"));
  assert.equal(written.length, 5);
  await fs.unlink(out);
});

test("brandOwnerCandidates: strips common corporate suffixes", () => {
  const cands = brandOwnerCandidates("Mondelez Global LLC");
  assert.ok(cands.includes("mondelezglobal"), "candidates include stripped form");
});

test("brandOwnerCandidates: includes first-word fallback", () => {
  const cands = brandOwnerCandidates("PepsiCo, Inc.");
  // First-word stripped = "pepsico"
  assert.ok(cands.includes("pepsico"), "candidates include first-word slug");
});

test("brandOwnerCandidates: strips 'The ... Company'", () => {
  const cands = brandOwnerCandidates("The Coca-Cola Company");
  assert.ok(cands.includes("cocacola"), "candidates include 'cocacola'");
});

test("brandOwnerCandidates: empty input returns []", () => {
  assert.deepEqual(brandOwnerCandidates(""), []);
  assert.deepEqual(brandOwnerCandidates(null), []);
});
