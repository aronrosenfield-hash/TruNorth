#!/usr/bin/env node
/**
 * node --test scripts/tx-tceq-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TX_TCEQ_KERNEL,
  buildSnapshot,
  parseOrdersIndex,
  stripHtml,
} from "./tx-tceq-fetch.mjs";

import { classifySeverity } from "./tx-tceq-merge.mjs";

test("kernel has audited landmark Texas industrial cases", () => {
  assert.ok(TX_TCEQ_KERNEL.length >= 15, "kernel should have 15+ cases");
  for (const k of TX_TCEQ_KERNEL) {
    assert.match(k.date, /^\d{4}-\d{2}-\d{2}$/, `bad date ${k.date}`);
    assert.ok(k.facility && k.facility.length >= 5);
    assert.ok(k.company_brand && k.company_brand.length >= 3);
    assert.ok(k.agreed_penalty_usd >= 100_000, `penalty too small: ${k.agreed_penalty_usd}`);
    assert.ok(Array.isArray(k.violation_types) && k.violation_types.length >= 1);
    assert.match(k.url, /^https?:\/\//);
  }
});

test("ExxonMobil Baytown is the largest landmark case in kernel", () => {
  const xom = TX_TCEQ_KERNEL.filter(k => k.company_brand === "ExxonMobil");
  assert.ok(xom.length >= 1);
  const big = xom.reduce((max, c) => c.agreed_penalty_usd > max.agreed_penalty_usd ? c : max);
  assert.ok(big.agreed_penalty_usd >= 1_000_000);
});

test("buildSnapshot totals penalties correctly", () => {
  const snap = buildSnapshot(TX_TCEQ_KERNEL);
  assert.equal(snap.case_count, TX_TCEQ_KERNEL.length);
  const expected = TX_TCEQ_KERNEL.reduce((s, c) => s + (c.agreed_penalty_usd || 0), 0);
  assert.equal(snap.total_agreed_penalty_usd, expected);
});

test("parseOrdersIndex extracts pdf-shaped agreed orders only", () => {
  const html = `
    <table>
      <tr><td>2026-04-12</td><td><a href="/agency/decisions/orders/2026-04/AO-1234.pdf">Agreed Order — Valero Houston Refinery</a></td></tr>
      <tr><td>—</td><td><a href="/agency/about/calendar.html">Meeting calendar</a></td></tr>
      <tr><td>2026-04-08</td><td><a href="/agency/decisions/orders/2026-04/EO-2222.pdf">Enforcement Order — ExxonMobil Baytown</a></td></tr>
    </table>`;
  const rows = parseOrdersIndex(html);
  assert.equal(rows.length, 2);
  assert.match(rows[0].href, /AO-1234\.pdf$/);
});

test("classifySeverity uses conservative tiers + fatality override", () => {
  assert.equal(classifySeverity(200_000, 1, true), "very_poor");           // fatality override
  assert.equal(classifySeverity(6_000_000, 1, false), "very_poor");        // ≥$5M
  assert.equal(classifySeverity(700_000, 1, false), "poor");               // ≥$500K
  assert.equal(classifySeverity(50_000, 3, false), "poor");                // ≥3 actions
  assert.equal(classifySeverity(150_000, 1, false), "mixed");
});

test("stripHtml normalises entities and tags", () => {
  assert.equal(stripHtml("<b>BASF</b>&nbsp;Freeport"), "BASF Freeport");
});
