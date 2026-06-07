#!/usr/bin/env node
/**
 * node --test scripts/bis-entity-list-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBisRow, isEntityListRow, buildSnapshot } from "./bis-entity-list-fetch.mjs";
import { parseCSV } from "./lib/csv-mini.mjs";
import { buildAliasIndex, matchEntity } from "./bis-entity-list-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/bis-entity-list/sample.csv");

test("parseBisRow extracts fields the merger expects", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSV(text);
  assert.equal(rows.length, 5);
  const p = parseBisRow(rows[0]);
  assert.equal(p.entity, "Huawei Technologies Co. Ltd.");
  assert.equal(p.country, "China");
  assert.equal(p.fr_citation, "85 FR 51596");
  assert.equal(p.effective_date, "2020-08-20");
  assert.ok(p.license_requirement.includes("EAR"));
});

test("isEntityListRow filters only Entity List source rows", () => {
  assert.equal(isEntityListRow({ "Source List": "Entity List" }), true);
  assert.equal(isEntityListRow({ source: "Entity List (EL) - Bureau of Industry and Security" }), true);
  assert.equal(isEntityListRow({ "Source List": "Denied Persons List" }), false);
  assert.equal(isEntityListRow({}), false);
});

test("buildSnapshot groups by country", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const parsed = parseCSV(text).filter(isEntityListRow).map(parseBisRow);
  const snap = buildSnapshot(parsed);
  assert.equal(snap.entity_count, 5);
  assert.equal(snap.by_country.China, 3);
  assert.equal(snap.by_country.Russia, 1);
  assert.equal(snap.source, "bis-entity-list");
});

test("matchEntity routes Huawei to its parent slug", () => {
  const idx = buildAliasIndex(["huawei"], {});
  assert.equal(matchEntity("Huawei Technologies Co. Ltd.", idx), "huawei");
  assert.equal(matchEntity("Some Unrelated Co.", idx), null);
});

test("matchEntity uses brand-parent-map aliases", () => {
  const idx = buildAliasIndex(["seagate"], { seagate: { aliases: ["Seagate Singapore International Headquarters"] } });
  assert.equal(matchEntity("Seagate Singapore International Headquarters Pte. Ltd.", idx), "seagate");
});
