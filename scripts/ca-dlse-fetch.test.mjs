#!/usr/bin/env node
/**
 * node --test scripts/ca-dlse-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseUsd,
  extractEmployer,
  parseNewsIndex,
  buildSnapshot,
  kernelToSnapshot,
  CA_DLSE_KERNEL,
  stripHtml,
} from "./ca-dlse-fetch.mjs";

import { classifySeverity } from "./ca-dlse-merge.mjs";

test("parseUsd handles bare dollars and units", () => {
  assert.equal(parseUsd("$1.2 million in unpaid wages"), 1_200_000);
  assert.equal(parseUsd("$985,000 citation"), 985_000);
  assert.equal(parseUsd("$2 billion settlement"), 2_000_000_000);
  assert.equal(parseUsd("nothing here"), 0);
  // largest figure wins
  assert.equal(parseUsd("cited for $1.5M back wages and $4.2M total citation"), 4_200_000);
});

test("extractEmployer pulls brand from common DIR title patterns", () => {
  assert.match(
    extractEmployer("Labor Commissioner cites Foster Farms for wage theft"),
    /Foster Farms/
  );
  assert.match(
    extractEmployer("Labor Commissioner Files Wage Claim Against ABC Corp. for overtime"),
    /ABC Corp\./
  );
  assert.equal(extractEmployer(""), null);
});

test("parseNewsIndex skips junk anchors and pulls dlse-shaped rows", () => {
  const html = `
    <ul>
      <li>05/22/2025 — <a href="/DIRNews/2025/2025-44.html">Labor Commissioner cites Hilton housekeeping contractor $1.34 million</a></li>
      <li>03/04/2025 — <a href="/DIRNews/2025/2025-19.html">Labor Commissioner cites Starbucks for failure-to-pay-final-wages</a></li>
      <li><a href="https://example.com/unrelated">irrelevant page about flowers</a></li>
    </ul>`;
  const rows = parseNewsIndex(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].href.endsWith("/DIRNews/2025/2025-44.html"), true);
  assert.equal(rows[0].date, "2025-05-22");
});

test("kernel has audited entries with required fields + valid URLs", () => {
  assert.ok(CA_DLSE_KERNEL.length >= 10, "kernel should have 10+ landmark cases");
  for (const k of CA_DLSE_KERNEL) {
    assert.ok(k.date && /^\d{4}-\d{2}-\d{2}$/.test(k.date), `bad date ${k.date}`);
    assert.ok(k.employer && k.employer.length >= 3, `bad employer ${k.employer}`);
    assert.ok(k.citation_usd >= 100_000, `citation too small: ${k.citation_usd}`);
    assert.match(k.url, /^https?:\/\//, `bad url ${k.url}`);
    assert.ok(k.summary && k.summary.length >= 40, `bad summary ${k.summary}`);
  }
});

test("buildSnapshot totals citation/wages/workers across kernel", () => {
  const cases = kernelToSnapshot(CA_DLSE_KERNEL);
  const snap = buildSnapshot(cases);
  assert.equal(snap.case_count, CA_DLSE_KERNEL.length);
  assert.ok(snap.total_citation_usd > 1_000_000);
  assert.ok(snap.total_wages_usd > 100_000);
});

test("classifySeverity applies conservative tiers", () => {
  // Landmark — ≥$1M wages
  assert.equal(classifySeverity(1_500_000, 200_000, 1), "very_poor");
  // Landmark — ≥$10M citation
  assert.equal(classifySeverity(0, 15_000_000, 1), "very_poor");
  // Pattern (≥3 actions)
  assert.equal(classifySeverity(50_000, 100_000, 3), "poor");
  // Pattern (≥$500K wages)
  assert.equal(classifySeverity(600_000, 800_000, 1), "poor");
  // Mixed single small
  assert.equal(classifySeverity(100_000, 150_000, 1), "mixed");
});

test("stripHtml normalises entities and tags", () => {
  assert.equal(
    stripHtml("<p>Labor &amp; Commissioner&nbsp;cites <b>Foster Farms</b></p>"),
    "Labor & Commissioner cites Foster Farms"
  );
});
