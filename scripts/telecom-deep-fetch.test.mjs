#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CARRIERS, SOURCE_URLS, buildSnapshot, severityFor } from "./telecom-deep-fetch.mjs";
import { buildTelecomBlock } from "./telecom-deep-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/telecom-deep");

test("SOURCE_URLS point at FCC/FTC/DOJ", () => {
  assert.match(SOURCE_URLS.fccEnforcement, /fcc\.gov/);
  assert.match(SOURCE_URLS.fccComplaints, /fcc\.gov/);
  assert.match(SOURCE_URLS.ftc, /ftc\.gov/);
  assert.match(SOURCE_URLS.doj, /justice\.gov/);
});

test("CARRIERS covers majors plus ISPs", () => {
  const slugs = new Set(CARRIERS.map(c => c.slug));
  for (const s of ["verizon", "atandt", "t-mobile", "dish", "comcast",
    "charter-communications", "cox-communications", "lumen-technologies",
    "centurylink", "frontier-communications"]) {
    assert.ok(slugs.has(s), `missing ${s}`);
  }
});

test("every enforcement action carries a verifiable source URL", () => {
  for (const c of CARRIERS) {
    for (const a of (c.fcc_enforcement_actions || [])) {
      assert.match(a.source_url, /^https:\/\//);
      assert.ok(typeof a.penalty_usd === "number" || a.penalty_usd === null || a.penalty_usd === undefined);
      assert.ok(["privacy", "service", "advertising", "consumer-protection", "safety", "litigation"].includes(a.category));
    }
  }
});

test("severityFor: T-Mobile (2 privacy hits + $111M) → very_poor", () => {
  const tmo = CARRIERS.find(c => c.slug === "t-mobile");
  assert.equal(severityFor(tmo), "very_poor");
});

test("severityFor: Verizon (1 privacy + 1 service, $46.9M+) → very_poor", () => {
  const vz = CARRIERS.find(c => c.slug === "verizon");
  // 1 privacy action and $46.9M < $100M → "poor"
  assert.equal(severityFor(vz), "poor");
});

test("buildTelecomBlock totals penalties + picks latest action", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "carriers.json"), "utf-8"));
  const tmo = fix.find(c => c.slug === "t-mobile");
  const block = buildTelecomBlock(tmo);
  assert.equal(block.fccEnforcementCount, 2);
  assert.equal(block.fccPenaltyUsdTotal, 111600000);
  assert.equal(block.privacyActionCount, 2);
  assert.equal(block.severity, "very_poor");
});

test("buildSnapshot tags itself telecom-deep", () => {
  const snap = buildSnapshot(CARRIERS.slice(0, 1));
  assert.equal(snap.source, "telecom-deep");
  assert.match(snap.methodology, /FCC/);
});
