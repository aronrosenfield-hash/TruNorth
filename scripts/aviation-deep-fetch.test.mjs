#!/usr/bin/env node
/**
 * node --test scripts/aviation-deep-fetch.test.mjs
 *
 * Drives the fetcher's severity rules + the merger's per-airline block
 * builder against the fixture set.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AIRLINES,
  SOURCE_URLS,
  buildSnapshot,
  severityFor,
} from "./aviation-deep-fetch.mjs";
import { buildAviationBlock } from "./aviation-deep-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/aviation-deep");

test("SOURCE_URLS point to canonical federal endpoints", () => {
  assert.match(SOURCE_URLS.atcr, /transportation\.gov\/airconsumer/);
  assert.match(SOURCE_URLS.bts, /transtats\.bts\.gov/);
  assert.match(SOURCE_URLS.ntsb, /ntsb\.gov/);
  assert.match(SOURCE_URLS.enforcement, /transportation\.gov/);
});

test("AIRLINES covers the 11 major US-facing carriers we care about", () => {
  const slugs = new Set(AIRLINES.map(a => a.slug));
  for (const s of [
    "delta-air-lines", "united-airlines", "american-airlines",
    "southwest-airlines", "jetblue", "spirit-airlines",
    "frontier-airlines", "alaska-airlines", "hawaiian-airlines",
    "allegiant-air", "sun-country-airlines",
  ]) {
    assert.ok(slugs.has(s), `missing airline slug ${s}`);
  }
});

test("every airline cites a verifiable source URL on each enforcement action", () => {
  for (const a of AIRLINES) {
    for (const act of (a.dot_enforcement_actions || [])) {
      assert.match(act.source_url, /^https:\/\/(www\.)?(transportation|dot|ntsb)\.gov\//,
        `${a.slug}: enforcement action missing federal source URL`);
      assert.ok(act.summary && act.summary.length > 10, `${a.slug}: enforcement summary too short`);
    }
  }
});

test("severityFor maps Hawaiian (best) to positive and Spirit (worst) to very_poor", () => {
  const hawaiian = AIRLINES.find(a => a.slug === "hawaiian-airlines");
  const spirit = AIRLINES.find(a => a.slug === "spirit-airlines");
  assert.equal(severityFor(hawaiian), "positive");
  assert.equal(severityFor(spirit), "very_poor");
});

test("severityFor uses both complaint rate AND on-time pct", () => {
  // Synthetic: low complaints but terrible on-time → still very_poor
  assert.equal(severityFor({ complaints_per_100k_passengers: 0.5, on_time_pct: 65, mishandled_bag_rate: 3 }), "very_poor");
  // Synthetic: clean by every metric → positive
  assert.equal(severityFor({ complaints_per_100k_passengers: 0.5, on_time_pct: 88, mishandled_bag_rate: 3 }), "positive");
});

test("buildSnapshot stamps source, license, methodology", () => {
  const snap = buildSnapshot(AIRLINES.slice(0, 2));
  assert.equal(snap.source, "aviation-deep");
  assert.equal(snap.airline_count, 2);
  assert.match(snap.license, /public domain/i);
  assert.match(snap.methodology, /DOT Air Travel Consumer Report/);
});

test("buildAviationBlock totals penalties and picks the latest action", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "airlines.json"), "utf-8"));
  const delta = fix.find(a => a.slug === "delta-air-lines");
  const block = buildAviationBlock(delta);
  assert.equal(block.iata, "DL");
  assert.equal(block.dotEnforcementCount, 1);
  assert.equal(block.dotPenaltyUsdTotal, 100000);
  assert.equal(block.dotLatestAction.year, 2024);
  assert.match(block.dotLatestAction.sourceUrl, /transportation\.gov/);
  assert.ok(block.sourceUrls.length >= 3);
  assert.equal(block.severity, "mixed");  // complaints 1.84 → mixed tier
});

test("buildAviationBlock handles zero enforcement actions", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "airlines.json"), "utf-8"));
  const hawaiian = fix.find(a => a.slug === "hawaiian-airlines");
  const block = buildAviationBlock(hawaiian);
  assert.equal(block.dotEnforcementCount, 0);
  assert.equal(block.dotPenaltyUsdTotal, 0);
  assert.equal(block.dotLatestAction, null);
  assert.equal(block.severity, "positive");
});
