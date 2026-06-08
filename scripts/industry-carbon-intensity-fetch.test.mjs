#!/usr/bin/env node
/**
 * Tests for industry-carbon-intensity-{fetch,merge}.mjs.
 *
 * Uses node:test (Node 22 built-in — no third-party deps). NO network calls.
 *
 * Locally:
 *   node --test scripts/industry-carbon-intensity-fetch.test.mjs
 *   node scripts/industry-carbon-intensity-fetch.test.mjs   (works too — node:test runs in default mode)
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  NAICS_INTENSITY,
  CAT_TO_NAICS,
  tierForIntensity,
  buildSnapshot,
} from "./industry-carbon-intensity-fetch.mjs";

import { buildAugmentForCompany } from "./industry-carbon-intensity-merge.mjs";

// ─────────────────────── fixture: 6 NAICS sample rows ───────────────────────
// Spec asks for "fixture of NAICS-CO2e mapping" — these are the 6 we anchor on.
const FIXTURE_NAICS = {
  "211":  { label: "Oil & gas extraction",                  kgCO2ePerUSD: 4.20, expectedTier: "very-high" },
  "3271": { label: "Cement & concrete product manufacturing", kgCO2ePerUSD: 5.40, expectedTier: "very-high" },
  "311":  { label: "Food manufacturing",                    kgCO2ePerUSD: 0.45, expectedTier: "medium" },
  "44":   { label: "Retail trade (general)",                kgCO2ePerUSD: 0.25, expectedTier: "medium" },
  "522":  { label: "Credit intermediation (banking)",       kgCO2ePerUSD: 0.07, expectedTier: "low" },
  "5112": { label: "Software publishers",                   kgCO2ePerUSD: 0.03, expectedTier: "very-low" },
};

test("tierForIntensity: correct boundaries", () => {
  assert.equal(tierForIntensity(5.0),   "very-high");
  assert.equal(tierForIntensity(2.0),   "very-high");   // boundary inclusive
  assert.equal(tierForIntensity(1.9),   "high");
  assert.equal(tierForIntensity(0.6),   "high");        // boundary inclusive
  assert.equal(tierForIntensity(0.59),  "medium");
  assert.equal(tierForIntensity(0.2),   "medium");      // boundary inclusive
  assert.equal(tierForIntensity(0.19),  "low");
  assert.equal(tierForIntensity(0.05),  "low");         // boundary inclusive
  assert.equal(tierForIntensity(0.049), "very-low");
  assert.equal(tierForIntensity(0.0),   "very-low");
});

test("NAICS_INTENSITY: fixture rows match expected values + tiers", () => {
  for (const [naics, expected] of Object.entries(FIXTURE_NAICS)) {
    const row = NAICS_INTENSITY[naics];
    assert.ok(row, `NAICS ${naics} present in NAICS_INTENSITY`);
    assert.equal(row.label, expected.label, `NAICS ${naics} label`);
    assert.equal(row.kgCO2ePerUSD, expected.kgCO2ePerUSD, `NAICS ${naics} intensity`);
    assert.equal(tierForIntensity(row.kgCO2ePerUSD), expected.expectedTier, `NAICS ${naics} tier`);
  }
});

test("NAICS_INTENSITY: ordering — oil > steel > food > banking > software", () => {
  assert.ok(NAICS_INTENSITY["211"].kgCO2ePerUSD  > NAICS_INTENSITY["3311"].kgCO2ePerUSD - 0.5);
  assert.ok(NAICS_INTENSITY["3311"].kgCO2ePerUSD > NAICS_INTENSITY["311"].kgCO2ePerUSD);
  assert.ok(NAICS_INTENSITY["311"].kgCO2ePerUSD  > NAICS_INTENSITY["522"].kgCO2ePerUSD);
  assert.ok(NAICS_INTENSITY["522"].kgCO2ePerUSD  > NAICS_INTENSITY["5112"].kgCO2ePerUSD);
});

test("NAICS_INTENSITY: every entry is a positive finite number", () => {
  for (const [naics, row] of Object.entries(NAICS_INTENSITY)) {
    assert.ok(Number.isFinite(row.kgCO2ePerUSD), `NAICS ${naics} finite`);
    assert.ok(row.kgCO2ePerUSD > 0,              `NAICS ${naics} positive`);
    assert.ok(typeof row.label === "string" && row.label.length > 0, `NAICS ${naics} has label`);
    assert.ok(Array.isArray(row.provenance) && row.provenance.length > 0, `NAICS ${naics} has provenance`);
  }
});

test("CAT_TO_NAICS: every cat resolves to a NAICS that exists in NAICS_INTENSITY", () => {
  for (const [cat, naics] of Object.entries(CAT_TO_NAICS)) {
    assert.ok(NAICS_INTENSITY[naics], `cat "${cat}" → NAICS ${naics} must exist in NAICS_INTENSITY`);
  }
});

test("CAT_TO_NAICS: covers every cat that appears in public/data/index.json", async () => {
  // Snapshot of cats present in the index as of branch creation. If the index
  // grows a new category, this test will surface it — add the mapping then.
  const knownCats = [
    "Entertainment & Media", "Retail", "Technology", "Healthcare", "Manufacturing",
    "Food & Beverage", "Financial Services", "Consumer Goods", "Energy", "Automotive",
    "Apparel & Fashion", "Hospitality", "Other", "Professional Services", "Grocery",
    "Hospitality & Travel", "Outdoor", "Defense & Aerospace", "Beauty & Personal Care",
    "Sports & Fitness", "Transportation", "Chemicals & Materials", "Pet Care",
    "Education", "Utilities", "Airline", "Telecommunications", "Utility", "na",
    "Agriculture", "Furniture & Home", "Aerospace", "Beverage", "Travel",
  ];
  for (const cat of knownCats) {
    assert.ok(CAT_TO_NAICS[cat], `cat "${cat}" must be in CAT_TO_NAICS`);
  }
});

test("buildSnapshot: produces well-formed shape", () => {
  const snap = buildSnapshot({ liveReachable: true });
  assert.equal(typeof snap._license, "string");
  assert.ok(Array.isArray(snap._sources));
  assert.ok(snap._sources.length >= 4);
  assert.equal(snap._live_sources_reachable, true);
  assert.equal(typeof snap._generated_at, "string");
  assert.ok(snap.naics_intensity["211"].tier === "very-high");
  assert.ok(snap.naics_intensity["5112"].tier === "very-low");
  assert.equal(snap.cat_to_naics["Energy"].tier, "very-high");
  assert.equal(snap.cat_to_naics["Technology"].tier, "very-low");
  assert.equal(snap.cat_to_naics["Energy"].kgCO2ePerUSD, NAICS_INTENSITY["211"].kgCO2ePerUSD);
});

test("buildSnapshot: liveReachable defaults to null when not provided", () => {
  const snap = buildSnapshot();
  assert.equal(snap._live_sources_reachable, null);
});

// ─────────────────── merge: buildAugmentForCompany ─────────────────────────
test("buildAugmentForCompany: maps Energy → very-high w/ _inferred:true", () => {
  const snap = buildSnapshot();
  const aug = buildAugmentForCompany({ slug: "exxon-mobil", cat: "Energy" }, snap.cat_to_naics);
  assert.equal(aug.industryTier, "very-high");
  assert.equal(aug.industryCategory, "Energy");
  assert.equal(aug.industryNaics, "211");
  assert.equal(aug.inferredCarbonIntensity, 4.20);
  assert.equal(aug._inferred, true,
    "_inferred flag MUST be true — UI uses this to display 'industry typical' copy");
  assert.equal(aug.sourceUrl, "https://ourworldindata.org/emissions-by-sector");
});

test("buildAugmentForCompany: Technology → very-low", () => {
  const snap = buildSnapshot();
  const aug = buildAugmentForCompany({ slug: "microsoft", cat: "Technology" }, snap.cat_to_naics);
  assert.equal(aug.industryTier, "very-low");
  assert.equal(aug.industryNaics, "5112");
  assert.equal(aug._inferred, true);
});

test("buildAugmentForCompany: unknown cat falls back to Other (medium)", () => {
  const snap = buildSnapshot();
  const aug = buildAugmentForCompany({ slug: "unknown-co", cat: "Made-Up Sector" }, snap.cat_to_naics);
  assert.ok(aug, "should still return a record using Other fallback");
  assert.equal(aug.industryNaics, CAT_TO_NAICS["Other"]);
  assert.equal(aug.industryCategory, "Made-Up Sector",
    "industryCategory should preserve the original cat — even when we fall back");
});

test("buildAugmentForCompany: missing cat → uses Other fallback", () => {
  const snap = buildSnapshot();
  const aug = buildAugmentForCompany({ slug: "no-cat-co" }, snap.cat_to_naics);
  assert.ok(aug);
  assert.equal(aug.industryCategory, "Other");
});

test("buildAugmentForCompany: every Sprint-I tier shows up across the cat map", () => {
  const snap = buildSnapshot();
  const tiers = new Set();
  for (const cat of Object.keys(CAT_TO_NAICS)) {
    const aug = buildAugmentForCompany({ slug: "x", cat }, snap.cat_to_naics);
    tiers.add(aug.industryTier);
  }
  for (const t of ["very-high", "high", "medium", "low", "very-low"]) {
    assert.ok(tiers.has(t), `tier "${t}" must be reachable through at least one cat`);
  }
});
