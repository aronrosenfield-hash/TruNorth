#!/usr/bin/env node
/**
 * node --test scripts/eviction-lab-fetch.test.mjs
 *
 * Drives the fetcher's severity rules + the merger's per-landlord block
 * builder against the fixture set.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANDLORDS,
  SOURCE_URLS,
  buildSnapshot,
  severityFor,
} from "./eviction-lab-fetch.mjs";
import { buildLandlordBlock } from "./eviction-lab-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/eviction-lab");

test("SOURCE_URLS point to canonical agency / academic endpoints", () => {
  assert.match(SOURCE_URLS.evictionLab, /evictionlab\.org\/top-evicting-landlords/);
  assert.match(SOURCE_URLS.ftcInvitationHomes, /ftc\.gov\/news-events\/news\/press-releases\/2024\/09\/federal-trade-commission-action-leads-48-million-refunds-renters-harmed-invitation-homes/);
  assert.match(SOURCE_URLS.dojRealPage, /justice\.gov\/opa\/pr\/justice-department-sues-realpage/);
  assert.match(SOURCE_URLS.atlantaFed, /frbatlanta\.org/);
});

test("LANDLORDS covers the curated REITs / PE managers we care about", () => {
  const slugs = new Set(LANDLORDS.map(l => l.slug));
  for (const s of [
    "invitation-homes",
    "american-homes-4-rent",
    "greystar",
    "avalon",
    "mid-america-apartment-communities",
    "sun-communities",
    "starwood",
  ]) {
    assert.ok(slugs.has(s), `missing landlord slug ${s}`);
  }
});

test("every action cites a verifiable source URL with a useful summary", () => {
  for (const l of LANDLORDS) {
    for (const act of (l.actions || [])) {
      assert.match(act.source_url, /^https:\/\/[^\s]+\.[a-z]{2,}/, `${l.slug}: action missing http source URL`);
      assert.ok(act.summary && act.summary.length > 20, `${l.slug}: action summary too short`);
      assert.ok(act.year && act.year >= 2010 && act.year <= 2030, `${l.slug}: action year out of range`);
    }
  }
});

test("severityFor — Invitation Homes (FTC $48M) → very_poor", () => {
  const ih = LANDLORDS.find(l => l.slug === "invitation-homes");
  assert.equal(severityFor(ih), "very_poor");
});

test("severityFor — Greystar (DOJ antitrust + $860M tort) → very_poor", () => {
  const g = LANDLORDS.find(l => l.slug === "greystar");
  assert.equal(severityFor(g), "very_poor");
});

test("severityFor — MAA (DOJ Civil Rights settlement) → poor", () => {
  const maa = LANDLORDS.find(l => l.slug === "mid-america-apartment-communities");
  assert.equal(severityFor(maa), "poor");
});

test("severityFor — landlord with no actions → neutral", () => {
  assert.equal(severityFor({ actions: [] }), "neutral");
});

test("buildSnapshot stamps source, license, methodology", () => {
  const snap = buildSnapshot(LANDLORDS.slice(0, 2));
  assert.equal(snap.source, "eviction-lab");
  assert.equal(snap.landlord_count, 2);
  assert.match(snap.license, /Public-records compilation/i);
  assert.match(snap.methodology, /FTC consent orders/);
});

test("buildLandlordBlock totals penalties and picks the latest action", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "landlords.json"), "utf-8"));
  const ih = fix.find(l => l.slug === "invitation-homes");
  const block = buildLandlordBlock(ih);
  assert.equal(block.landlordType, "single-family REIT");
  assert.equal(block.actionCount, 1);
  assert.equal(block.penaltyUsdTotal, 48_000_000);
  assert.equal(block.latestAction.year, 2024);
  assert.match(block.latestAction.sourceUrl, /ftc\.gov/);
  assert.ok(block.sourceUrls.length >= 3);
  assert.equal(block.severity, "very_poor");
});

test("buildLandlordBlock picks the highest-year action when multiple actions exist", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "landlords.json"), "utf-8"));
  const g = fix.find(l => l.slug === "greystar");
  const block = buildLandlordBlock(g);
  assert.equal(block.actionCount, 2);
  assert.equal(block.penaltyUsdTotal, 860_000_000);
  assert.equal(block.latestAction.year, 2025);
  assert.match(block.latestAction.regulator, /DOJ Antitrust/);
});

test("buildLandlordBlock handles zero actions", () => {
  const block = buildLandlordBlock({ slug: "x", name: "X", landlord_type: "multifamily REIT", actions: [] });
  assert.equal(block.actionCount, 0);
  assert.equal(block.penaltyUsdTotal, 0);
  assert.equal(block.latestAction, null);
  assert.equal(block.severity, "neutral");
});
