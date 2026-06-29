#!/usr/bin/env node
/**
 * industry-flags regression tests.
 *
 * 2026-06-28: locks in the collision guard that stops generic / common-word
 * slugs from inheriting an industry flag off the brand-parent-map.
 *
 * Two confirmed false positives motivated this:
 *   - "on"   (On Holding, ONON, footwear, SIC 3021) was getting tobacco=true
 *     because the slug "on" maps to parent altria-group (Altria's "on!" pouches).
 *   - "star" (Star Holdings, STHO, real-estate lessor, SIC 6519) was getting
 *     alcohol=true because "star" maps to heineken-usa (Heineken "Star" lager).
 *
 * Three more of the same kind (no own SIC, caught by the slug denylist):
 *   - "patagonia" (apparel)  vs AB InBev "Cerveza Patagonia".
 *   - "next"      (Next plc) vs Philip Morris "Next" cigarettes.
 *   - "jet"       (retail)   vs Phillips 66 "Jet" petrol.
 *
 * The guard must NOT suppress legitimate sub-brand inheritance (leffe→alcohol,
 * esso→fossil_fuel) or direct allow-list matches (altria-group→tobacco).
 *
 * Run: node --test scripts/industry-flags.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classify,
  buildContext,
  sicInIndustry,
  derivedMatchAllowed,
  AMBIGUOUS_SLUGS,
} from "./industry-flags.mjs";

// Real allow-lists + alias map + parent map — reproduces production exactly.
const ctx = buildContext();

const flagsFor = (co) => classify(co, ctx).flags;

// ─── The two confirmed false positives ──────────────────────────────────────

test("on.json (On Holding, footwear SIC 3021) does NOT get tobacco", () => {
  const f = flagsFor({ slug: "on", sic: 3021, name: "On Holding", cat: "Manufacturing" });
  assert.equal(f.tobacco, false, "footwear SIC must never inherit tobacco from altria-group");
});

test("star.json (Star Holdings, real-estate SIC 6519) does NOT get alcohol", () => {
  const f = flagsFor({ slug: "star", sic: 6519, name: "Star Holdings", cat: "Financial Services" });
  assert.equal(f.alcohol, false, "real-estate SIC must never inherit alcohol from heineken-usa");
});

// ─── The same collision class, no own SIC → caught by the denylist ──────────

test("patagonia (apparel) does NOT get alcohol", () => {
  assert.equal(flagsFor({ slug: "patagonia", name: "Patagonia", cat: "Apparel & Fashion" }).alcohol, false);
});

test("next (retailer) does NOT get tobacco", () => {
  assert.equal(flagsFor({ slug: "next", name: "Next", cat: "Retail" }).tobacco, false);
});

test("jet (retail) does NOT get fossil_fuel", () => {
  assert.equal(flagsFor({ slug: "jet", name: "Jet", cat: "Retail" }).fossil_fuel, false);
});

// ─── Legitimate matches must still fire (no over-suppression) ────────────────

test("altria-group still gets tobacco (direct slug match, authoritative)", () => {
  assert.equal(flagsFor({ slug: "altria-group", name: "Altria Group" }).tobacco, true);
});

test("leffe still gets alcohol (legit parent_map sub-brand, distinctive slug)", () => {
  assert.equal(flagsFor({ slug: "leffe", name: "Leffe", cat: "Food & Beverage" }).alcohol, true);
});

test("esso still gets fossil_fuel (legit parent_map sub-brand, distinctive slug)", () => {
  assert.equal(flagsFor({ slug: "esso", name: "Esso", cat: "Energy & Utilities" }).fossil_fuel, true);
});

test("an ambiguous slug WITH a corroborating in-industry SIC is still tagged", () => {
  // Hypothetical: a company on the denylist whose own SIC is genuinely tobacco
  // (cigarettes, 2111) must keep the parent-derived flag — SIC corroborates.
  assert.equal(flagsFor({ slug: "on", sic: 2111, name: "Hypothetical Tobacco Co" }).tobacco, true);
});

// ─── Guard helper unit tests ────────────────────────────────────────────────

test("sicInIndustry classifies the confirmed SICs correctly", () => {
  assert.equal(sicInIndustry(3021, "tobacco"), false); // footwear ≠ tobacco
  assert.equal(sicInIndustry(2111, "tobacco"), true);  // cigarettes = tobacco
  assert.equal(sicInIndustry(6519, "alcohol"), false); // real estate ≠ alcohol
  assert.equal(sicInIndustry(2082, "alcohol"), true);  // malt beverages = alcohol
  assert.equal(sicInIndustry(undefined, "tobacco"), null); // no SIC → unknown
  assert.equal(sicInIndustry("not-a-number", "tobacco"), null);
});

test("derivedMatchAllowed enforces the guard", () => {
  assert.equal(derivedMatchAllowed("tobacco", 3021, "on"), false);     // SIC vetoes
  assert.equal(derivedMatchAllowed("alcohol", 6519, "star"), false);   // SIC vetoes
  assert.equal(derivedMatchAllowed("alcohol", undefined, "patagonia"), false); // denylist + no SIC
  assert.equal(derivedMatchAllowed("alcohol", undefined, "leffe"), true);      // distinctive slug
  assert.equal(derivedMatchAllowed("tobacco", 2111, "on"), true);      // SIC corroborates despite denylist
});

test("the confirmed colliders are on the denylist", () => {
  for (const slug of ["on", "star", "patagonia", "next", "jet"]) {
    assert.ok(AMBIGUOUS_SLUGS.has(slug), `${slug} should be denylisted`);
  }
});
