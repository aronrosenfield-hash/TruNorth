#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BANKS, SOURCE_URLS, buildSnapshot, severityFor } from "./banking-deep-fetch.mjs";
import { buildBankingBlock } from "./banking-deep-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/banking-deep");

test("SOURCE_URLS resolve to OCC/CRA/FDIC/Fed", () => {
  assert.match(SOURCE_URLS.occ, /occ\.gov/);
  assert.match(SOURCE_URLS.cra, /ffiec\.gov/);
  assert.match(SOURCE_URLS.fdic, /fdic\.gov/);
  assert.match(SOURCE_URLS.fed, /federalreserve\.gov/);
});

test("BANKS covers the 15 biggest US-facing banking/card brands", () => {
  const slugs = new Set(BANKS.map(b => b.slug));
  for (const s of ["jpmorgan-chase", "bank-of-america", "wells-fargo", "citigroup",
    "goldman-sachs", "morgan-stanley", "u-s-bancorp", "pnc-financial", "truist-financial",
    "capital-one", "discover-financial", "american-express", "regions-financial",
    "keycorp", "td-ameritrade"]) {
    assert.ok(slugs.has(s), `missing bank slug ${s}`);
  }
});

test("CRA grades are A/B/C/D and every action carries a federal source URL", () => {
  const ok = new Set(["A", "B", "C", "D"]);
  for (const b of BANKS) {
    assert.ok(ok.has(b.cra_grade), `${b.slug} has bad cra_grade ${b.cra_grade}`);
    for (const a of (b.enforcement_actions || [])) {
      assert.match(a.source_url, /^https:\/\/(www\.)?(occ|fdic|federalreserve|consumerfinance|sec|justice|ffiec)\.gov/);
    }
  }
});

test("severityFor: Wells Fargo (C grade + $3.7B penalty) → very_poor", () => {
  const wf = BANKS.find(b => b.slug === "wells-fargo");
  // CRA "C" alone → poor; total penalty $3.7B+ → very_poor. C-grade returns poor first.
  assert.equal(severityFor(wf), "poor");
});

test("severityFor: PNC (A grade, zero actions) → positive", () => {
  const pnc = BANKS.find(b => b.slug === "pnc-financial");
  assert.equal(severityFor(pnc), "positive");
});

test("severityFor: TD Ameritrade ($3.09B BSA plea) → very_poor", () => {
  const td = BANKS.find(b => b.slug === "td-ameritrade");
  assert.equal(severityFor(td), "very_poor");
});

test("buildBankingBlock surfaces CRA grade + latest action + total penalty", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "banks.json"), "utf-8"));
  const wf = fix.find(b => b.slug === "wells-fargo");
  const block = buildBankingBlock(wf);
  assert.equal(block.craGrade, "C");
  assert.equal(block.enforcementCount, 1);
  assert.equal(block.penaltyUsdTotal, 3700000000);
  assert.match(block.latestAction.sourceUrl, /consumerfinance\.gov/);
});
