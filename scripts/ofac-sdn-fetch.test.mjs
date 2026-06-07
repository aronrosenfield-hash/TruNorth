#!/usr/bin/env node
/**
 * node:test — ofac-sdn-fetch parser tests.
 *   node --test scripts/ofac-sdn-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSdnRow, buildSnapshot, denull, extractListingDate } from "./ofac-sdn-fetch.mjs";
import { parseCSV } from "./lib/csv-mini.mjs";
import { buildAliasIndex, matchEntity } from "./ofac-sdn-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/ofac-sdn/sample.csv");

test("denull replaces Treasury's '-0-' sentinel", () => {
  assert.equal(denull("-0-"), "");
  assert.equal(denull("  -0-  "), "");
  assert.equal(denull("ROSNEFT"), "ROSNEFT");
  assert.equal(denull(null), "");
});

test("extractListingDate pulls 'Listing date 16 Mar 2022'", () => {
  assert.equal(extractListingDate("Listing date 16 Mar 2022; alt name 'Gazprombank JSC'."), "2022-03-16");
  assert.equal(extractListingDate("Listing date 1 Jan 2024."), "2024-01-01");
  assert.equal(extractListingDate("no date here"), null);
});

test("parseSdnRow + buildSnapshot drops individuals", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSV(csv).map(parseSdnRow);
  assert.equal(rows.length, 5, "5 rows in fixture");
  const snap = buildSnapshot(rows);
  assert.equal(snap.total_rows, 5);
  assert.equal(snap.entity_rows, 4);
  assert.equal(snap.individual_rows, 1);
  assert.equal(snap.entities[0].name, "ROSNEFT OIL COMPANY");
  assert.equal(snap.entities[0].type, "entity");
  assert.equal(snap.entities[1].sanction_date, "2022-03-16");
});

test("matchEntity: exact normalised slug name hits", () => {
  const idx = buildAliasIndex(["huawei", "rosneft"], {});
  assert.equal(matchEntity({ name: "HUAWEI TECHNOLOGIES CO. LTD." }, idx), "huawei");
  assert.equal(matchEntity({ name: "ROSNEFT OIL COMPANY" }, idx), "rosneft");
  assert.equal(matchEntity({ name: "DOE, JOHN" }, idx), null);
});

test("matchEntity: parent-map alias routing", () => {
  const idx = buildAliasIndex(["sberbank"], { sberbank: { aliases: ["Sberbank of Russia"] } });
  assert.equal(matchEntity({ name: "SBERBANK OF RUSSIA" }, idx), "sberbank");
});

test("short aliases (<4 chars) cannot trigger substring match", () => {
  const idx = buildAliasIndex(["abc"], {});
  // "abc" is only 3 chars after normalize so substring matching is disabled.
  assert.equal(matchEntity({ name: "abcdefg corp" }, idx), null);
});
