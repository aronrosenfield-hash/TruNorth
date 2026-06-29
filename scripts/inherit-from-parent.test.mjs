#!/usr/bin/env node
/**
 * inherit-from-parent collision-guard regression tests.
 *
 * 2026-06-29: locks in the guard that stops parent→sub-brand data inheritance
 * from copying a parent's category RECORDS onto a child that is a DISTINCT
 * real-world entity merely sharing the brand-parent-map key. Same false-positive
 * class as industry-flags.mjs (B-15), but more damaging here — it copies real
 * "Via parent company X" records, not just a boolean flag.
 *
 * Two confirmed failure modes:
 *   (a) own EDGAR identity — the child carries a cik/ticker/sic the parent does
 *       not share, so it is a separate SEC filer, not a marketing sub-brand:
 *         on   → altria-group  (On Holding, ONON, cik 1858985, footwear)
 *         star → heineken-usa  (Star Holdings, STHO, cik 1953366, real estate)
 *         stride → mondelez    (Stride Inc / K12, LRN, cik 1157408, education)
 *         monster-energy → coca-cola (Monster Beverage, MNST, independent)
 *         evgo → nrg-energy    (EVgo Inc, cik 1821159, independent)
 *         victoria-s-secret → bath-and-body-works (VSCO, split into its own co)
 *   (b) ambiguous slug — a generic-word collider with NO own EDGAR identity,
 *       caught by the shared AMBIGUOUS_SLUGS denylist:
 *         patagonia → anheuser-busch  (Patagonia apparel vs "Cerveza Patagonia")
 *         next      → philip-morris   (Next retailer vs "Next" cigarettes)
 *         jet       → phillips-66     (Jet retail vs Phillips 66 "Jet" petrol)
 *
 * The guard must NOT suppress legitimate sub-brand inheritance — a real
 * marketing sub-brand with no own EDGAR identity and not on the denylist (e.g.
 * Old Navy ← Gap) must still inherit.
 *
 * Run: node --test scripts/inherit-from-parent.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  inheritanceBlocked,
  hasOwnCorporateIdentity,
} from "./inherit-from-parent.mjs";
import { AMBIGUOUS_SLUGS } from "./industry-flags.mjs";

// Parents with no own identity fields, as they appear in the data (these brand
// roots carry no cik/sic and a ticker that differs from the colliding child).
const ALTRIA = { name: "ALTRIA GROUP" };
const HEINEKEN = { name: "Heineken USA" };
const MONDELEZ = { name: "Mondelez International", ticker: "MDLZ" };
const COCA_COLA = { name: "Coca-Cola", ticker: "KO" };
const NRG = { name: "NRG Energy" };
const BBW = { name: "Bath & Body Works", ticker: "BBWI" };
const AB_INBEV = { name: "Anheuser-Busch" };
const GAP = { name: "Gap Inc.", ticker: "GPS" };

// ─── (a) Own EDGAR identity → blocked ────────────────────────────────────────

test("On Holding (own cik/ticker/sic) does NOT inherit from altria-group", () => {
  const child = { slug: "on", name: "On Holding", cik: 1858985, ticker: "ONON", sic: 3021 };
  assert.equal(inheritanceBlocked(child, ALTRIA, "on"), "own-edgar-identity");
});

test("Star Holdings (own cik/ticker/sic) does NOT inherit from heineken-usa", () => {
  const child = { slug: "star", name: "Star Holdings", cik: 1953366, ticker: "STHO", sic: 6519 };
  assert.equal(inheritanceBlocked(child, HEINEKEN, "star"), "own-edgar-identity");
});

test("Stride Inc (education, ticker LRN) does NOT inherit from mondelez (Stride gum)", () => {
  const child = { slug: "stride", name: "Stride", cik: 1157408, ticker: "LRN", sic: 8200 };
  assert.equal(inheritanceBlocked(child, MONDELEZ, "stride"), "own-edgar-identity");
});

test("Monster Beverage (ticker only, no cik) does NOT inherit from coca-cola", () => {
  const child = { slug: "monster-energy", name: "Monster Energy", ticker: "MNST" };
  assert.equal(inheritanceBlocked(child, COCA_COLA, "monster-energy"), "own-edgar-identity");
});

test("EVgo (own cik) does NOT inherit from nrg-energy", () => {
  const child = { slug: "evgo", name: "EVgo", cik: 1821159, ticker: "EVGO", sic: 7500 };
  assert.equal(inheritanceBlocked(child, NRG, "evgo"), "own-edgar-identity");
});

test("Victoria's Secret (own ticker, post-split) does NOT inherit from bath-and-body-works", () => {
  const child = { slug: "victoria-s-secret", name: "Victoria's Secret", ticker: "VSCO" };
  assert.equal(inheritanceBlocked(child, BBW, "victoria-s-secret"), "own-edgar-identity");
});

// ─── (b) Ambiguous slug, no own identity → blocked by the denylist ───────────

test("patagonia (apparel, no EDGAR identity) does NOT inherit from anheuser-busch", () => {
  const child = { slug: "patagonia", name: "Patagonia", cat: "Apparel & Fashion" };
  assert.equal(inheritanceBlocked(child, AB_INBEV, "patagonia"), "ambiguous-slug");
});

test("next and jet are on the denylist (blocked even with no own identity)", () => {
  assert.equal(inheritanceBlocked({ slug: "next", name: "Next" }, {}, "next"), "ambiguous-slug");
  assert.equal(inheritanceBlocked({ slug: "jet", name: "Jet" }, {}, "jet"), "ambiguous-slug");
});

// ─── Legitimate inheritance must still fire (no over-suppression) ────────────

test("a real marketing sub-brand (no own identity, not denylisted) is NOT blocked", () => {
  const child = { slug: "old-navy", name: "Old Navy", cat: "Apparel & Fashion" };
  assert.equal(inheritanceBlocked(child, GAP, "old-navy"), null);
});

test("same company under two slugs (child shares the parent's identity) is NOT blocked", () => {
  // If a parent file DID carry its cik/ticker and a variant slug shared them,
  // they are the same entity — inheritance is allowed.
  const parent = { name: "The Clorox Company", cik: 21076, ticker: "CLX", sic: 2842 };
  const child = { slug: "clorox-de", name: "Clorox", cik: 21076, ticker: "CLX", sic: 2842 };
  assert.equal(inheritanceBlocked(child, parent, "clorox-de"), null);
});

// ─── hasOwnCorporateIdentity unit tests ──────────────────────────────────────

test("hasOwnCorporateIdentity: any unshared cik/ticker/sic counts", () => {
  assert.equal(hasOwnCorporateIdentity({ cik: 1858985 }, { name: "Altria" }), true);
  assert.equal(hasOwnCorporateIdentity({ ticker: "MNST" }, { ticker: "KO" }), true);
  assert.equal(hasOwnCorporateIdentity({ sic: 3021 }, {}), true);
});

test("hasOwnCorporateIdentity: empty/undefined fields are ignored", () => {
  assert.equal(hasOwnCorporateIdentity({ name: "Old Navy" }, { name: "Gap" }), false);
  assert.equal(hasOwnCorporateIdentity({ cik: null, ticker: "", sic: undefined }, {}), false);
});

test("hasOwnCorporateIdentity: a field equal to the parent's does not count (same entity)", () => {
  assert.equal(hasOwnCorporateIdentity({ cik: 21076, ticker: "CLX" }, { cik: 21076, ticker: "CLX" }), false);
});

// ─── The confirmed colliders are on the shared denylist ──────────────────────

test("the no-identity colliders are on the AMBIGUOUS_SLUGS denylist", () => {
  for (const slug of ["patagonia", "next", "jet"]) {
    assert.ok(AMBIGUOUS_SLUGS.has(slug), `${slug} should be denylisted in industry-flags.mjs`);
  }
});
