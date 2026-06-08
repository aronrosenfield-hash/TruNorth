#!/usr/bin/env node
/**
 * Tests for net-zero-tracker-fetch.mjs + net-zero-tracker-merge.mjs
 *
 * Uses test/fixtures/net-zero-tracker/sample.csv. Pure parsers — no network.
 *
 * Locally:  node --test scripts/net-zero-tracker-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";
import {
  normalizeRow,
  normalizeStatus,
  normalizeTrafficLight,
  deriveQualityGrade,
  findDownloadLink,
} from "./net-zero-tracker-fetch.mjs";
import { buildAugmentBlock, pickBetter, groupByCompany } from "./net-zero-tracker-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/net-zero-tracker/sample.csv");

test("NZT: parses fixture CSV", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(text);
  assert.equal(rows.length, 15, "15 sample rows");
  assert.equal(rows[0].name, "Apple Inc.");
});

test("NZT: normalizeStatus collapses free-form text", () => {
  assert.equal(normalizeStatus("Committed"), "committed");
  assert.equal(normalizeStatus("In progress"), "in-progress");
  assert.equal(normalizeStatus("Achieved"), "achieved");
  assert.equal(normalizeStatus("missed target"), "missed");
  assert.equal(normalizeStatus("No target"), "none");
  assert.equal(normalizeStatus(""), "none");
  assert.equal(normalizeStatus("N/A"), "none");
});

test("NZT: normalizeTrafficLight handles four-pillar text", () => {
  assert.equal(normalizeTrafficLight("Complete plan", "plan"), "green");
  assert.equal(normalizeTrafficLight("Incomplete plan", "plan"), "orange");
  assert.equal(normalizeTrafficLight("No plan", "plan"), "red");
  assert.equal(normalizeTrafficLight("Annual", "reporting"), "green");
  assert.equal(normalizeTrafficLight("Less than annual", "reporting"), "orange");
  assert.equal(normalizeTrafficLight("Complete", "scope3"), "green");
  assert.equal(normalizeTrafficLight("Partial", "scope3"), "orange");
  // Credits inverts: "No" is green (no offsets = good).
  assert.equal(normalizeTrafficLight("No", "credits"), "green");
  assert.equal(normalizeTrafficLight("Yes; with conditions applied", "credits"), "orange");
  assert.equal(normalizeTrafficLight("Unspecified", "credits"), "red");
});

test("NZT: deriveQualityGrade maps pillars to A–F", () => {
  // 4 greens, 0 reds → A
  assert.equal(deriveQualityGrade({
    plan: "green", reporting: "green", scope3: "green", credits: "green", status: "committed",
  }), "A");
  // 3 greens, 1 orange → B
  assert.equal(deriveQualityGrade({
    plan: "green", reporting: "green", scope3: "green", credits: "orange", status: "committed",
  }), "B");
  // 3 greens, 1 red → B
  assert.equal(deriveQualityGrade({
    plan: "green", reporting: "green", scope3: "green", credits: "red", status: "committed",
  }), "B");
  // 2 greens, no reds → B
  assert.equal(deriveQualityGrade({
    plan: "green", reporting: "green", scope3: "orange", credits: "orange", status: "committed",
  }), "B");
  // 1 green → D
  assert.equal(deriveQualityGrade({
    plan: "green", reporting: "red", scope3: "red", credits: "red", status: "committed",
  }), "D");
  // 0 greens → F
  assert.equal(deriveQualityGrade({
    plan: "red", reporting: "red", scope3: "red", credits: "red", status: "committed",
  }), "F");
  // status "none" forces F regardless
  assert.equal(deriveQualityGrade({
    plan: "green", reporting: "green", scope3: "green", credits: "green", status: "none",
  }), "F");
  // No pillar info at all → null
  assert.equal(deriveQualityGrade({
    plan: null, reporting: null, scope3: null, credits: null, status: "committed",
  }), null);
});

test("NZT: normalizeRow maps fixture data end-to-end", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(text).map(normalizeRow).filter(Boolean);
  assert.equal(rows.length, 15);

  const apple = rows.find(r => r.company === "Apple Inc.");
  assert.equal(apple.target_year, 2030);
  assert.equal(apple.status, "committed");
  assert.equal(apple.quality_grade, "A", "Apple: all 4 pillars green → A");
  assert.equal(apple.source_url, "https://www.apple.com/environment/");

  const tesla = rows.find(r => r.company === "Tesla Inc.");
  assert.equal(tesla.status, "none");
  assert.equal(tesla.quality_grade, "F", "Tesla: no target → F");

  const exxon = rows.find(r => r.company === "ExxonMobil Corporation");
  assert.equal(exxon.status, "committed");
  // No plan, less-than-annual, no scope3, unspecified credits — but "No" scope3 is red
  assert.ok(["D", "F"].includes(exxon.quality_grade), "Exxon: weak pledge → D/F");

  const patagonia = rows.find(r => r.company === "Patagonia Works");
  assert.equal(patagonia.status, "achieved");
});

test("NZT: findDownloadLink prefers CSV over XLSX", () => {
  const html = `
    <a href="/about.pdf">About</a>
    <a href="/data/companies.csv">Download CSV</a>
    <a href="/data/companies.xlsx">Download Excel</a>
  `;
  const url = findDownloadLink(html, "https://zerotracker.net");
  assert.match(url, /companies\.csv$/);
});

test("NZT: findDownloadLink falls back to XLSX when no CSV", () => {
  const html = `<a href="https://example.org/data.xlsx">x</a>`;
  const url = findDownloadLink(html);
  assert.match(url, /\.xlsx$/);
});

test("NZT: findDownloadLink returns null when none", () => {
  assert.equal(findDownloadLink("<p>hi</p>"), null);
  assert.equal(findDownloadLink(""), null);
});

test("NZT merge: buildAugmentBlock produces the {environment:{netZeroPledge}} shape", () => {
  const block = buildAugmentBlock({
    company: "Foo Inc",
    target_year: 2030,
    quality_grade: "A",
    status: "committed",
    source_url: "https://foo.example/sustainability",
  });
  assert.equal(block.display_name, "Foo Inc");
  assert.ok(block.environment);
  assert.deepEqual(block.environment.netZeroPledge, {
    targetYear: 2030,
    qualityGrade: "A",
    status: "committed",
    sourceUrl: "https://foo.example/sustainability",
  });
});

test("NZT merge: pickBetter favors higher grade, then sooner targetYear", () => {
  const a = buildAugmentBlock({ company: "X", target_year: 2050, quality_grade: "C", status: "committed" });
  const b = buildAugmentBlock({ company: "X", target_year: 2030, quality_grade: "B", status: "committed" });
  assert.equal(pickBetter(a, b), b, "B beats C");
  const c = buildAugmentBlock({ company: "X", target_year: 2050, quality_grade: "B", status: "committed" });
  const d = buildAugmentBlock({ company: "X", target_year: 2030, quality_grade: "B", status: "committed" });
  assert.equal(pickBetter(c, d), d, "tie on grade → sooner year wins");
});

test("NZT merge: groupByCompany collapses dupe slugs", () => {
  const rows = [
    { company: "Foo, Inc.", quality_grade: "C", target_year: 2050, status: "committed" },
    { company: "Foo Inc",   quality_grade: "A", target_year: 2030, status: "committed" },
  ];
  const grouped = groupByCompany(rows);
  const keys = Object.keys(grouped);
  assert.equal(keys.length, 1, "both rows collapse to the same slug");
  assert.equal(grouped[keys[0]].environment.netZeroPledge.qualityGrade, "A");
});

test("NZT merge: end-to-end fixture produces 15 unique slugs", async () => {
  const text = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(text).map(normalizeRow).filter(Boolean);
  const grouped = groupByCompany(rows);
  assert.equal(Object.keys(grouped).length, 15);
});
