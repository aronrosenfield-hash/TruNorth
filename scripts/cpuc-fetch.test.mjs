#!/usr/bin/env node
/**
 * node --test scripts/cpuc-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CPUC_KERNEL,
  buildSnapshot,
  parseNewsList,
  stripHtml,
} from "./cpuc-fetch.mjs";

import { classifySeverity } from "./cpuc-merge.mjs";

test("kernel has audited landmark utility cases with required fields", () => {
  assert.ok(CPUC_KERNEL.length >= 10, "kernel should have 10+ cases");
  const expectedCats = new Set(["environment", "health", "political"]);
  for (const k of CPUC_KERNEL) {
    assert.match(k.date, /^\d{4}-\d{2}-\d{2}$/, `bad date ${k.date}`);
    assert.ok(k.utility && k.utility.length >= 3);
    assert.ok(k.utility_brand && k.utility_brand.length >= 2);
    assert.ok(k.citation_usd >= 500_000, `citation too small: ${k.citation_usd}`);
    assert.ok(expectedCats.has(k.category), `bad category ${k.category}`);
    assert.match(k.url, /^https?:\/\//);
    assert.ok(k.summary && k.summary.length >= 50);
  }
});

test("PG&E San Bruno + Camp Fire are landmark very-poor cases", () => {
  const pge = CPUC_KERNEL.filter(k => k.utility_brand === "PG&E");
  assert.ok(pge.length >= 4, "PG&E should have multiple cases in kernel");
  const sanBruno = pge.find(k => /San Bruno/i.test(k.summary));
  assert.ok(sanBruno);
  assert.ok(sanBruno.citation_usd >= 1_000_000_000, "San Bruno fine ≥$1B");
});

test("SoCalGas Aliso Canyon is in kernel and tagged environment", () => {
  const aliso = CPUC_KERNEL.find(k => /Aliso Canyon/i.test(k.summary));
  assert.ok(aliso);
  assert.equal(aliso.category, "environment");
});

test("buildSnapshot totals citations correctly", () => {
  const snap = buildSnapshot(CPUC_KERNEL);
  assert.equal(snap.case_count, CPUC_KERNEL.length);
  const expected = CPUC_KERNEL.reduce((s, c) => s + (c.citation_usd || 0), 0);
  assert.equal(snap.total_citation_usd, expected);
});

test("parseNewsList ignores non-enforcement headlines", () => {
  const html = `
    <li><a href="/news/1">CPUC fines AT&amp;T $2.2M for 911 service violations</a></li>
    <li><a href="/news/2">CPUC announces public-meeting calendar</a></li>
    <li><a href="/news/3">CPUC approves $125M PG&amp;E penalty for Kincade Fire</a></li>
  `;
  const rows = parseNewsList(html);
  assert.equal(rows.length, 2);
});

test("classifySeverity flags fatalities + cumulative thresholds", () => {
  assert.equal(classifySeverity(100_000, 1, true), "very_poor");           // fatalities
  assert.equal(classifySeverity(150_000_000, 1, false), "very_poor");       // ≥$100M
  assert.equal(classifySeverity(30_000_000, 1, false), "poor");             // ≥$25M
  assert.equal(classifySeverity(1_000_000, 3, false), "poor");              // ≥3 actions
  assert.equal(classifySeverity(2_000_000, 1, false), "mixed");
});

test("stripHtml normalises entities", () => {
  assert.equal(stripHtml("<b>AT&amp;T</b>&nbsp;California"), "AT&T California");
});
