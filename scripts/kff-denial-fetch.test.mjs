#!/usr/bin/env node
/**
 * node --test scripts/kff-denial-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOURCE_URLS,
  PARENT_TO_SLUG,
  buildSnapshot,
  severityFor,
} from "./kff-denial-fetch.mjs";
import { buildDenialBlock } from "./kff-denial-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/kff-denial");

test("SOURCE_URLS point to canonical CMS / KFF endpoints", () => {
  assert.match(SOURCE_URLS.cmsPuf, /cms\.gov\/marketplace\/resources\/data/);
  assert.match(SOURCE_URLS.kffBrief, /kff\.org\/affordable-care-act\/issue-brief\/claims-denials-and-appeals-in-aca-marketplace-plans-in-2023/);
  assert.match(SOURCE_URLS.kffWorkingFile, /files\.kff\.org/);
});

test("PARENT_TO_SLUG covers the major brand families", () => {
  for (const k of [
    "UNITEDHEALTH GRP",
    "CVS GRP",
    "CENTENE CORP GRP",
    "ELEVANCE HLTH INC GRP",
    "CIGNA HLTH GRP",
    "OSCAR HEALTH INC GRP",
    "MOLINA HEALTHCARE INC GRP",
  ]) {
    assert.ok(PARENT_TO_SLUG[k], `missing parent map for ${k}`);
  }
});

test("severityFor follows the KFF 2023 marketplace tier table", () => {
  // UnitedHealth at 33.3% → very_poor (KFF 'high denier' band)
  assert.equal(severityFor({ in_network_denial_rate: 0.333 }), "very_poor");
  // GuideWell (Florida Blue) at 22.4% → poor
  assert.equal(severityFor({ in_network_denial_rate: 0.224 }), "poor");
  // Centene at 13.8% → mixed (around marketplace average)
  assert.equal(severityFor({ in_network_denial_rate: 0.138 }), "mixed");
  // Corewell at 6.7% → positive (well-below average)
  assert.equal(severityFor({ in_network_denial_rate: 0.067 }), "positive");
  // Empty → neutral
  assert.equal(severityFor({ in_network_denial_rate: 0 }), "neutral");
});

test("buildSnapshot tags every entry with a slug when the parent is mapped", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "parents.json"), "utf-8"));
  const snap = buildSnapshot(fix, 2023);
  assert.equal(snap.source, "kff-denial");
  assert.equal(snap.plan_year, 2023);
  assert.equal(snap.parent_count, fix.length);
  for (const p of snap.parents) {
    assert.ok(p.slug, `missing slug for parent ${p.parent}`);
    assert.ok(p.severity, `missing severity for ${p.parent}`);
  }
  const united = snap.parents.find(p => p.parent === "UNITEDHEALTH GRP");
  assert.equal(united.slug, "unitedhealth-group");
  assert.equal(united.severity, "very_poor");
});

test("buildSnapshot stamps license + methodology", () => {
  const snap = buildSnapshot([], 2023);
  assert.match(snap.license, /US-Federal public domain/);
  assert.match(snap.methodology, /Marketplace Open Enrollment Period/);
});

test("buildDenialBlock packs the fields the writer needs", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "parents.json"), "utf-8"));
  const united = fix.find(p => p.parent === "UNITEDHEALTH GRP");
  // The merge stage expects plan_year on each row — the snapshot adds it.
  const snap = buildSnapshot([united], 2023);
  const block = buildDenialBlock(snap.parents[0]);
  assert.equal(block.parent, "UNITEDHEALTH GRP");
  assert.equal(block.planYear, 2023);
  assert.equal(block.inNetworkClaims, 14022287);
  assert.equal(block.inNetworkDenials, 4670649);
  assert.ok(block.inNetworkDenialRate > 0.30 && block.inNetworkDenialRate < 0.40);
  assert.equal(block.stateCount, 14);
  assert.equal(block.severity, "very_poor");
  assert.ok(block.sourceUrls.length >= 2);
});
