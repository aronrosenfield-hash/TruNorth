#!/usr/bin/env node
/**
 * Unit tests for state-lobbying-r5-fetch helpers.
 *
 * Pure-function coverage of:
 *   • formatUsd()       — narrative dollar formatting
 *   • topIssues()       — cross-jurisdiction issue ranking
 *   • buildAugmentBlock() — seed-row → augment block, incl. multi-state aggregation
 *   • Socrata caps       — $limit=500 and $order are always set
 *   • HARD constants     — must not be silently raised
 */

import { strict as assert } from "node:assert";
import {
  formatUsd,
  topIssues,
  buildAugmentBlock,
  fetchSocrataLive,
  HARD_PER_SOURCE_RECORD_CAP,
  HARD_PER_SOURCE_TIMEOUT_MS,
  JURISDICTION_META,
} from "./state-lobbying-r5-fetch.mjs";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

console.log("state-lobbying-r5-fetch.test.mjs");

test("HARD caps are at their documented values", () => {
  assert.equal(HARD_PER_SOURCE_RECORD_CAP, 500, "record cap must remain 500");
  assert.equal(HARD_PER_SOURCE_TIMEOUT_MS, 60_000, "timeout must remain 60s");
});

test("JURISDICTION_META covers all four sources with source_url", () => {
  for (const code of ["ca", "ny", "tx", "nyc"]) {
    assert.ok(JURISDICTION_META[code], `missing ${code}`);
    assert.ok(/^https:\/\//.test(JURISDICTION_META[code].source_url), `${code} url not https`);
  }
});

test("formatUsd handles M / K / raw", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(-5), "$0");
  assert.equal(formatUsd(123), "$123");
  assert.equal(formatUsd(5_400), "$5K");
  assert.equal(formatUsd(2_400_000), "$2.4M");
  assert.equal(formatUsd(NaN), "$0");
});

test("topIssues ranks by cross-jurisdiction count, then dollar weight", () => {
  const j = [
    { code: "ca", amount_usd: 100, issues: ["tech", "privacy"] },
    { code: "ny", amount_usd: 200, issues: ["tech", "labor"] },
    { code: "tx", amount_usd: 50,  issues: ["tech"] },
  ];
  const top = topIssues(j, 3);
  assert.equal(top[0], "tech", "tech (3 jurisdictions) must lead");
  // Tied at 1 each: labor ($200) vs privacy ($100) → labor wins by weight
  assert.equal(top[1], "labor");
  assert.equal(top[2], "privacy");
});

test("topIssues returns [] when no issues anywhere", () => {
  const j = [{ code: "ca", amount_usd: 100, issues: [] }];
  assert.deepEqual(topIssues(j, 3), []);
});

test("buildAugmentBlock aggregates a 3-state filer correctly", () => {
  const block = buildAugmentBlock({
    slug: "uber",
    raw_name: "Uber Technologies Inc.",
    ca: { year: 2024, amount_usd: 1_000_000, issues: ["gig-economy", "labor"] },
    ny: { year: 2024, amount_usd: 500_000, issues: ["gig-economy", "transportation"] },
    tx: { year: 2023, amount_usd: 250_000, issues: ["gig-economy"] },
  }, "2026-06-10T12:00:00.000Z");

  const s = block.political.state_lobbying_r5;
  assert.equal(s.total_usd_annual, 1_750_000);
  assert.equal(s.year, 2024, "most-recent year wins");
  assert.equal(s.jurisdictions.length, 3);
  assert.equal(s.top_issues[0], "gig-economy");
  assert.equal(s.source, "state-lobbying-r5");
  assert.ok(s.source_urls.length >= 3, "at least 3 distinct source_urls");
  assert.equal(s.raw_name_matched, "Uber Technologies Inc.");
});

test("buildAugmentBlock returns null when no jurisdictions have spend", () => {
  const block = buildAugmentBlock({ slug: "empty", raw_name: "Empty" }, "2026-06-10T12:00:00.000Z");
  assert.equal(block, null);
});

test("buildAugmentBlock skips zero-amount jurisdictions", () => {
  const block = buildAugmentBlock({
    slug: "test",
    raw_name: "Test",
    ca: { year: 2024, amount_usd: 0, issues: [] },
    ny: { year: 2024, amount_usd: 100, issues: ["x"] },
  }, "2026-06-10T12:00:00.000Z");
  assert.equal(block.political.state_lobbying_r5.jurisdictions.length, 1);
  assert.equal(block.political.state_lobbying_r5.total_usd_annual, 100);
});

await (async () => {
  // Stub global fetch — we never want a real network call in unit tests.
  const captured = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    captured.push(url.toString());
    return { ok: true, json: async () => [{ a: 1 }, { a: 2 }] };
  };
  try {
    test("fetchSocrataLive always sets $limit=500 and $order", async () => {
      const r = await fetchSocrataLive({ host: "data.ny.gov", dataset: "abcd-1234" });
      assert.ok(r.ok, "expected ok");
      const url = captured[captured.length - 1];
      assert.ok(url.includes("%24limit=500") || url.includes("$limit=500"), `missing $limit=500: ${url}`);
      assert.ok(url.includes("%24order=") || url.includes("$order="), `missing $order: ${url}`);
    });
  } finally {
    globalThis.fetch = origFetch;
  }

  // Verify aborts on non-2xx + caller surfaces error code
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    test("fetchSocrataLive surfaces non-2xx as { ok:false, status }", async () => {
      const r = await fetchSocrataLive({ host: "x", dataset: "y" });
      assert.equal(r.ok, false);
      assert.equal(r.status, 503);
      assert.deepEqual(r.rows, []);
    });
  } finally {
    globalThis.fetch = origFetch;
  }
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
