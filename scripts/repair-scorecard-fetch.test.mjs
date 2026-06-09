#!/usr/bin/env node
/**
 * Tests for the right-to-repair scorecard fetcher + merger.
 *
 *   node --test scripts/repair-scorecard-fetch.test.mjs
 *
 * Covers:
 *   - gradeValue conversion (letter → 4.0 scale)
 *   - pairSeverity (PIRG + iFixit conservative join)
 *   - buildBrands handles both phone + laptop grades, picks the worse
 *   - SLUG_HINTS keeps Motorola routed to lenovo (Motorola Mobility owner)
 *   - merger combines two source brands routing to the same parent slug
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PIRG_2026,
  IFIXIT,
  SOURCE_URLS,
  SLUG_HINTS,
  gradeValue,
  pairSeverity,
  buildBrands,
} from "./repair-scorecard-fetch.mjs";

import { resolveBrand } from "./repair-scorecard-merge.mjs";

/* ─────────────────────────── gradeValue ──────────────────────────────── */

test("gradeValue: base letters", () => {
  assert.equal(gradeValue("A"), 4);
  assert.equal(gradeValue("B"), 3);
  assert.equal(gradeValue("C"), 2);
  assert.equal(gradeValue("D"), 1);
  assert.equal(gradeValue("F"), 0);
});

test("gradeValue: plus / minus", () => {
  assert.equal(gradeValue("B+"), 3.33);
  assert.equal(gradeValue("B-"), 2.67);
  assert.equal(gradeValue("D-"), 0.67);
  assert.equal(gradeValue("C-"), 1.67);
});

test("gradeValue: unknown / nullish", () => {
  assert.equal(gradeValue(""), null);
  assert.equal(gradeValue(null), null);
  assert.equal(gradeValue("Z"), null);
});

/* ─────────────────────────── pairSeverity ─────────────────────────────── */

test("pairSeverity: either side strong → positive", () => {
  // PIRG B- alone is positive (≥2.67).
  assert.equal(pairSeverity({ pirgVal: 2.67, ifixitAvg: null }), "positive");
  // iFixit 8 alone is positive.
  assert.equal(pairSeverity({ pirgVal: null, ifixitAvg: 8 }), "positive");
  // iFixit 10 + PIRG D → still positive (any leader wins).
  assert.equal(pairSeverity({ pirgVal: 1, ifixitAvg: 10 }), "positive");
});

test("pairSeverity: BOTH sides poor → negative", () => {
  // Samsung phones = PIRG D (1.0) + iFixit 4 → negative.
  assert.equal(pairSeverity({ pirgVal: 1.0, ifixitAvg: 4 }), "negative");
  // Apple D- (0.67) + iFixit 7 → mixed (iFixit isn't bad enough)
  assert.equal(pairSeverity({ pirgVal: 0.67, ifixitAvg: 7 }), "mixed");
});

test("pairSeverity: single weak signal → mixed (conservative)", () => {
  assert.equal(pairSeverity({ pirgVal: null, ifixitAvg: 3 }), "mixed");
  assert.equal(pairSeverity({ pirgVal: 1.0, ifixitAvg: null }), "mixed");
});

test("pairSeverity: no data → null", () => {
  assert.equal(pairSeverity({ pirgVal: null, ifixitAvg: null }), null);
});

/* ──────────────────────────── buildBrands ─────────────────────────────── */

test("buildBrands: Apple gets both phone + laptop, worst grade wins", () => {
  const brands = buildBrands({
    pirg: PIRG_2026, ifixit: IFIXIT, sourceUrls: SOURCE_URLS, pirgYear: 2026,
  });
  const apple = brands.find(b => b.name === "Apple");
  assert.ok(apple, "Apple missing");
  assert.equal(apple.category, "both");
  // Apple smartphones D- (0.67) is worse than laptop C- (1.67), so D- wins.
  assert.equal(apple.pirg_grade, "D-");
  assert.equal(apple.ifixit_avg, 7);
});

test("buildBrands: Motorola routes via slugHint to lenovo (phone parent)", () => {
  const brands = buildBrands({
    pirg: PIRG_2026, ifixit: IFIXIT, sourceUrls: SOURCE_URLS, pirgYear: 2026,
  });
  const moto = brands.find(b => b.name === "Motorola");
  assert.equal(moto.slugHint, "lenovo",
    "Motorola Mobility is a Lenovo subsidiary; must NOT route to motorola-solutions");
});

test("buildBrands: severity ladder is conservative", () => {
  const brands = buildBrands({
    pirg: PIRG_2026, ifixit: IFIXIT, sourceUrls: SOURCE_URLS, pirgYear: 2026,
  });
  // Samsung phone D + iFixit 4 → negative
  const samsung = brands.find(b => b.name === "Samsung");
  assert.equal(samsung.severity, "negative");
  // Fairphone has only iFixit 10 → positive
  const fp = brands.find(b => b.name === "Fairphone");
  assert.equal(fp.severity, "positive");
});

test("buildBrands: narrative cites both sources where present", () => {
  const brands = buildBrands({
    pirg: PIRG_2026, ifixit: IFIXIT, sourceUrls: SOURCE_URLS, pirgYear: 2026,
  });
  const samsung = brands.find(b => b.name === "Samsung");
  assert.match(samsung.narrative, /PIRG Failing the Fix 2026/);
  assert.match(samsung.narrative, /iFixit avg/);
});

test("SLUG_HINTS covers every input brand", () => {
  const all = new Set([
    ...PIRG_2026.smartphones.map(r => r.name),
    ...PIRG_2026.laptops.map(r => r.name),
    ...IFIXIT.map(r => r.name),
  ]);
  for (const n of all) {
    assert.ok(SLUG_HINTS[n], `Missing slug hint for "${n}"`);
  }
});

/* ─────────────────────────── merger routing ──────────────────────────── */

test("resolveBrand: Motorola via slugHint → lenovo", () => {
  const r = resolveBrand(
    { name: "Motorola", slugHint: "lenovo" },
    { knownSlugs: new Set(["lenovo"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "lenovo");
  assert.equal(r.routedVia, "slugHint");
});

test("resolveBrand: orphan when nothing matches", () => {
  const r = resolveBrand(
    { name: "Fairphone", slugHint: "fairphone" },
    { knownSlugs: new Set(["apple"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, null);
});
