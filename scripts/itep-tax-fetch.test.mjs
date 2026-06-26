#!/usr/bin/env node
/**
 * Tests for itep-tax-fetch.mjs (and the merger helpers).
 *
 * Uses node:test (built into Node 18+) — no extra deps. Runs against the
 * checked-in fixture at scripts/fixtures/itep-tax/sample.json.
 * NO network calls.
 *
 * Locally:
 *   node --test scripts/itep-tax-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeCompanyName,
  parseMoneyMillions,
  parseRate,
  parseCsv,
  shapeRow,
  LICENSE_TAG,
} from "./itep-tax-fetch.mjs";

import {
  mergeSnapshot,
  matchCompanyToIndex,
  buildIndexLookup,
  nameVariants,
} from "./itep-tax-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/itep-tax/sample.json");

// ─────────────────────────── normalizers ────────────────────────────

test("normalizeCompanyName strips legal suffixes", () => {
  assert.equal(normalizeCompanyName("Amazon.com, Inc."), "amazon com");
  assert.equal(normalizeCompanyName("Tesla, Inc."), "tesla");
  assert.equal(normalizeCompanyName("Dow Inc."), "dow");
  assert.equal(normalizeCompanyName("FedEx Corporation"), "fedex");
  assert.equal(normalizeCompanyName("AT&T Inc."), "at t");
});

test("parseMoneyMillions handles $, commas, parentheses (negatives), and dashes", () => {
  assert.equal(parseMoneyMillions("$1,234"), 1234);
  assert.equal(parseMoneyMillions("1234.5"), 1234.5);
  assert.equal(parseMoneyMillions("(129)"), -129);
  assert.equal(parseMoneyMillions("$-129"), -129);
  assert.equal(parseMoneyMillions("—"), null);
  assert.equal(parseMoneyMillions(""), null);
  assert.equal(parseMoneyMillions(null), null);
});

test("parseRate handles percent strings + bare decimals + negatives", () => {
  assert.equal(parseRate("21%"), 0.21);
  assert.equal(parseRate("0%"), 0);
  assert.equal(parseRate("-5%"), -0.05);
  assert.equal(parseRate("0.21"), 0.21);
  assert.equal(parseRate("21"), 0.21);   // bare number = percent
  assert.equal(parseRate("—"), null);
  assert.equal(parseRate(null), null);
});

// ─────────────────────────── CSV / shapeRow ─────────────────────────

test("parseCsv handles ITEP-style header + quoted commas", () => {
  const csv = [
    "Company,Total Profits,Federal Taxes,Effective Rate,# Zero-Tax Years,Study Years",
    'Tesla, Inc.,4400,0,0.0%,5,5',
    '"Amazon.com, Inc.",78420,4346,5.5%,2,5',
  ].join("\n");
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["company"], "Tesla");
  assert.equal(rows[1]["company"], "Amazon.com, Inc.");
  assert.equal(rows[1]["total profits"], "78420");
});

test("shapeRow maps ITEP headers to canonical shape", () => {
  const row = {
    "company": "Amazon.com, Inc.",
    "total profits": "78,420",
    "federal taxes": "4346",
    "effective rate": "5.5%",
    "# zero-tax years": "2",
    "study years": "5",
  };
  const shaped = shapeRow(row, { edition: "2024", sourceUrl: "https://itep.org/x" });
  assert.equal(shaped.company, "Amazon.com, Inc.");
  assert.equal(shaped.totalProfitsUsdMillions, 78420);
  assert.equal(shaped.federalTaxesPaidUsdMillions, 4346);
  assert.equal(shaped.effectiveFederalTaxRate, 0.055);
  assert.equal(shaped.zeroTaxYears, 2);
  assert.equal(shaped.studyYears, 5);
  assert.equal(shaped.reportEdition, "2024");
});

test("shapeRow tolerates accounting-parens negatives (refunds)", () => {
  const row = {
    "company": "FedEx Corporation",
    "total profits": "14400",
    "federal taxes": "(129)",
    "effective rate": "-0.9%",
    "# zero-tax years": "3",
  };
  const shaped = shapeRow(row);
  assert.equal(shaped.federalTaxesPaidUsdMillions, -129);
  // Allow tiny float-precision wobble (-0.9% / 100 → -0.009000000…0001).
  assert.ok(Math.abs(shaped.effectiveFederalTaxRate - -0.009) < 1e-9);
});

test("shapeRow returns null when company is missing", () => {
  assert.equal(shapeRow({ "federal taxes": "0" }), null);
});

// ─────────────────────────── fixture round-trip ─────────────────────

test("fixture is parseable + ITEP-attributed + active (license approved)", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  assert.equal(snap._license, LICENSE_TAG);
  assert.equal(snap._dormant, false);
  assert.equal(snap._fixture, true);
  assert.ok(snap.rows.length >= 10, "fixture should have ≥10 rows");
  assert.equal(snap.rowCount, snap.rows.length);
  for (const r of snap.rows) {
    assert.ok(r.company);
    assert.equal(typeof r.effectiveFederalTaxRate, "number");
    assert.equal(typeof r.zeroTaxYears, "number");
  }
});

// ─────────────────────────── merger ─────────────────────────────────

test("nameVariants yields shortest brand-form candidates", () => {
  const v = nameVariants("Amazon.com, Inc.");
  assert.ok(v.includes("amazon"), `expected 'amazon' in ${JSON.stringify(v)}`);
  const v2 = nameVariants("T-Mobile US, Inc.");
  assert.ok(v2.includes("t mobile"), `expected 't mobile' in ${JSON.stringify(v2)}`);
});

test("matchCompanyToIndex finds Tesla via short-form alias", () => {
  const byName = buildIndexLookup([
    { slug: "tesla", name: "Tesla" },
    { slug: "amazon", name: "Amazon" },
  ]);
  assert.equal(matchCompanyToIndex("Tesla, Inc.", byName), "tesla");
  assert.equal(matchCompanyToIndex("Amazon.com, Inc.", byName), "amazon");
});

test("mergeSnapshot routes well-known fixture rows to brand slugs", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  // Synthetic minimal index covering the obvious headline names.
  const index = [
    { slug: "tesla", name: "Tesla" },
    { slug: "amazon", name: "Amazon" },
    { slug: "nike", name: "Nike" },
    { slug: "fedex", name: "FedEx" },
    { slug: "t-mobile", name: "T-Mobile" },
    { slug: "duke-energy", name: "Duke Energy" },
    { slug: "salesforce", name: "Salesforce" },
  ];
  const { augment, stats } = mergeSnapshot(snap, { index, parentMap: {} });
  for (const want of ["tesla", "amazon", "nike", "fedex", "duke-energy", "salesforce"]) {
    assert.ok(augment[want], `expected augment[${want}] to be present`);
    assert.ok(augment[want].political);
    assert.equal(augment[want].political._license, LICENSE_TAG);
  }
  assert.ok(stats.directMatches >= 6, `expected ≥6 direct matches, got ${stats.directMatches}`);
});

test("mergeSnapshot output carries effective-rate + zero-tax-years for Amazon", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const index = [{ slug: "amazon", name: "Amazon" }];
  const { augment } = mergeSnapshot(snap, { index, parentMap: {} });
  const p = augment["amazon"].political;
  assert.equal(p.zeroTaxYears, 2);
  assert.equal(p.studyYears, 5);
  assert.equal(p.totalProfits, 78420);
  assert.equal(p.federalTaxesPaid, 4346);
  assert.equal(typeof p.effectiveFederalTaxRate, "number");
  assert.ok(p.sourceUrl.includes("itep.org"));
});

test("mergeSnapshot orphans unmatched companies", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const { stats } = mergeSnapshot(snap, { index: [], parentMap: {} });
  assert.equal(stats.directMatches, 0);
  assert.equal(stats.parentMatches, 0);
  assert.equal(stats.orphans, snap.rows.length);
});
