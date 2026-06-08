#!/usr/bin/env node
/**
 * Tests for sbti-fetch.mjs + sbti-merge.mjs
 *
 * Uses test/fixtures/sbti/sample.csv. Runs the pure parsers — no network.
 *
 * Locally:  node --test scripts/sbti-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";
import { normalizeRow, findCsvLink } from "./sbti-fetch.mjs";
import { buildAugmentBlock, groupByCompany } from "./sbti-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/sbti/sample.csv");

test("SBTi: parses fixture CSV", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(text);
  assert.equal(rows.length, 10, "10 sample rows");
  assert.equal(rows[0]["Company Name"], "Apple Inc.");
});

test("SBTi: normalizeRow maps fields and statuses", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(text).map(normalizeRow).filter(Boolean);
  assert.equal(rows.length, 10);

  const apple = rows.find(r => r.company === "Apple Inc.");
  assert.equal(apple.status, "approved", "Apple is approved (Targets set)");
  assert.equal(apple.target_year, 2030);
  assert.equal(apple.target_type, "1.5°C");
  assert.equal(apple.net_zero_committed, true);

  const walmart = rows.find(r => r.company === "Walmart Inc.");
  assert.equal(walmart.status, "committed", "Walmart is committed (not yet approved)");

  const jbs = rows.find(r => r.company === "JBS S.A.");
  assert.equal(jbs.status, "removed", "JBS target was removed");
});

test("SBTi: findCsvLink picks up companies-related CSV", () => {
  const html = `
    <html><body>
      <a href="/foo/bar.pdf">PDF report</a>
      <a href="/downloads/CTAs-Companies-Taking-Action.csv">Download CSV (companies)</a>
      <a href="/downloads/glossary.csv">Glossary CSV</a>
    </body></html>
  `;
  const url = findCsvLink(html, "https://sciencebasedtargets.org");
  assert.ok(url, "found a CSV link");
  assert.match(url, /CTAs-Companies-Taking-Action\.csv/);
});

test("SBTi: findCsvLink returns null when no CSV present", () => {
  assert.equal(findCsvLink("<html><a href='/x.xlsx'>Excel</a></html>"), null);
});

test("SBTi merge: buildAugmentBlock sets booleans correctly", () => {
  const approved = buildAugmentBlock({ company: "X", status: "approved", target_year: 2030 });
  assert.equal(approved.hasScienceBasedTarget, true);
  assert.equal(approved.scienceBasedTargetActive, true);

  const committed = buildAugmentBlock({ company: "X", status: "committed" });
  assert.equal(committed.hasScienceBasedTarget, true);
  assert.equal(committed.scienceBasedTargetActive, false);

  const removed = buildAugmentBlock({ company: "X", status: "removed" });
  assert.equal(removed.hasScienceBasedTarget, false);
  assert.equal(removed.scienceBasedTargetActive, false);
});

test("SBTi merge: groupByCompany prefers approved over committed/removed", () => {
  const rows = [
    { company: "Foo Inc", status: "committed", date_published: "2024-01-01" },
    { company: "Foo Inc.", status: "approved",  date_published: "2025-06-01" },
    { company: "Foo, Inc.", status: "removed", date_published: "2026-01-01" },
  ];
  const grouped = groupByCompany(rows);
  const keys = Object.keys(grouped);
  assert.equal(keys.length, 1, "all three rows collapse to a single normalized key");
  assert.equal(grouped[keys[0]].status, "approved", "approved wins");
});

test("SBTi merge: fixture end-to-end produces expected count", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(text).map(normalizeRow).filter(Boolean);
  const grouped = groupByCompany(rows);
  // 10 distinct companies in fixture → 10 keys
  assert.equal(Object.keys(grouped).length, 10);
});
