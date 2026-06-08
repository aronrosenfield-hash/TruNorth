#!/usr/bin/env node
/**
 * Test harness for sec-def14a-fetch.mjs (node:test).
 *
 * Exercises the pure functions — htmlToText, parseUsd,
 * extractSummaryCompensationTable, extractPayRatio, pickLatestFact,
 * archiveUrl — against a real-ish DEF14A HTML excerpt fixture
 * (test/fixtures/sec-def14a/excerpt.html). No network calls.
 *
 * Locally: node --test scripts/sec-def14a-fetch.test.mjs
 *          node scripts/sec-def14a-fetch.test.mjs
 *
 * Exit 0 on success, non-zero on any failed assertion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  htmlToText,
  parseUsd,
  extractSummaryCompensationTable,
  extractPayRatio,
  pickLatestFact,
  archiveUrl,
  XBRL_TAGS,
} from "./sec-def14a-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test/fixtures/sec-def14a/excerpt.html");

test("parseUsd handles common SCT cell formats", () => {
  assert.equal(parseUsd("$1,250,000"), 1_250_000);
  assert.equal(parseUsd("1250000"),    1_250_000);
  assert.equal(parseUsd("$0"),         0);
  assert.equal(parseUsd("27,775,000"), 27_775_000);
  assert.equal(parseUsd("1.5 million"), 1_500_000);
  assert.equal(parseUsd("(123,456)"),  -123_456);
  assert.equal(parseUsd(""),           null);
  assert.equal(parseUsd("—"),          null);
});

test("htmlToText strips tags and collapses whitespace", () => {
  const html = "<p>Hello&nbsp;<b>world</b></p>\n<script>x</script><style>y</style><p>!</p>";
  const txt = htmlToText(html);
  assert.equal(txt.includes("<"), false);
  assert.equal(txt.includes("script"), false);
  assert.match(txt, /Hello\s+world/);
  assert.match(txt, /!/);
});

test("archiveUrl builds an EDGAR archive URL with no-dash accession", () => {
  const url = archiveUrl("0000320193", "0000320193-25-000005", "aapl-20250125.htm");
  assert.equal(url, "https://www.sec.gov/Archives/edgar/data/320193/000032019325000005/aapl-20250125.htm");
});

test("extractSummaryCompensationTable pulls the CEO row from the fixture", async () => {
  const html = await fs.readFile(FIXTURE, "utf-8");
  const text = htmlToText(html);
  const sct  = extractSummaryCompensationTable(text);
  assert.ok(sct, "expected a parsed SCT");
  assert.equal(sct.year, 2024);
  assert.match(sct.ceoName || "", /Jane/);
  assert.equal(sct.ceoBaseSalary,         1_250_000);
  assert.equal(sct.ceoBonus,              0);
  assert.equal(sct.ceoStockAwards,        18_500_000);
  assert.equal(sct.ceoOptionAwards,       4_000_000);
  assert.equal(sct.ceoNonEquityIncentive, 3_750_000);
  assert.equal(sct.ceoAllOtherComp,       275_000);
  assert.equal(sct.ceoTotal,              27_775_000);
});

test("extractPayRatio parses median pay and N-to-1 ratio", async () => {
  const html = await fs.readFile(FIXTURE, "utf-8");
  const text = htmlToText(html);
  const ratio = extractPayRatio(text);
  assert.ok(ratio, "expected a parsed pay-ratio object");
  assert.equal(ratio.medianEmployeePay, 62_400);
  assert.equal(ratio.payRatio,          445);
});

test("extractSummaryCompensationTable returns null when SCT heading is absent", () => {
  const text = "This is some unrelated proxy text without the magic heading.";
  assert.equal(extractSummaryCompensationTable(text), null);
});

test("extractPayRatio returns null when neither figure is present", () => {
  assert.equal(extractPayRatio("Generic boilerplate proxy language."), null);
});

test("XBRL_TAGS export lists the tags we care about", () => {
  assert.ok(Array.isArray(XBRL_TAGS.ceoTotal));
  assert.ok(XBRL_TAGS.medianEmployeePay.length > 0);
  assert.ok(XBRL_TAGS.payRatio.length > 0);
});

test("pickLatestFact picks the newest end-date USD fact, form-filtered", () => {
  const facts = {
    facts: {
      "us-gaap": {
        MedianEmployeeAnnualCompensation: {
          units: {
            USD: [
              { val: 50000, end: "2022-12-31", form: "DEF 14A", fy: 2022 },
              { val: 62400, end: "2024-12-31", form: "DEF 14A", fy: 2024 },
              { val: 99999, end: "2023-12-31", form: "10-K",    fy: 2023 },
            ],
          },
        },
      },
    },
  };
  const got = pickLatestFact(facts, "MedianEmployeeAnnualCompensation", { form: "DEF" });
  assert.equal(got.value, 62400);
  assert.equal(got.year, 2024);
});

test("pickLatestFact returns null for missing tag", () => {
  const facts = { facts: { "us-gaap": {} } };
  assert.equal(pickLatestFact(facts, "Nope"), null);
});
