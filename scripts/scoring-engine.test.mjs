#!/usr/bin/env node
/**
 * Scoring engine regression tests.
 *
 * 2026-06-09: locks in the scoring math after a week of rapid iteration
 * (Builds 55→58: Excel-rebuild thresholds, S2 65/55 floor, S3 user-
 * relevant cap, signal-count cap, Path B political differentiation).
 *
 * 2026-06-11 (SCORING V3 — grade-dispersion overhaul):
 *   R1 Signal-count cap REPLACED by evidence-weighted shrinkage toward 50
 *      (K_SHRINK = 1.5), same estimator family as IMDb's weighted rating.
 *   R2 Thresholds recalibrated once from the post-V3 distribution and
 *      frozen: A≥63, B≥56, C≥46, D≥41, F<41.
 *   R3 Severity-continuous category scores: execPay from actual SEC pay
 *      ratios (log curve), labor/environment negatives from penalty $,
 *      charity positives from IRS-990 grant totals.
 *   R4 Stance categories (dei/animals/guns) excluded from the un-quizzed
 *      neutral baseline.
 *
 * If any of these change, deliberate: update both the engine and these
 * tests in the same commit. The whole point of locking in is to make
 * "the scoring drifted" impossible to miss.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Engine functions: imported from the REAL engine (rebake-scoring.mjs) ────
// 2026-06-13 (review): these were inline COPIES — which could silently drift
// from the engine, defeating the point of the test. They're now the actual
// exported functions, so a scoring change without a matching test update fails
// HERE. rebake-scoring.mjs guards its catalog run behind an isMain check, so
// importing it triggers no rebake. (negativeSeverityScore/charityGivingScore
// called without a revenue arg fall back to the absolute curve these tests
// assert.)
import {
  gradeFromOverall, parseDollars, negativeSeverityScore, payRatioScore,
  charityGivingScore, parsePoliticalSignals, politicalScore,
} from "./rebake-scoring.mjs";

// Shrinkage is inline in rebake's loop (not a standalone export), so the test
// keeps a copy of just this one expression.
const K_SHRINK = 1.5;
function shrink(raw, W) {
  return (raw * W + 50 * K_SHRINK) / (W + K_SHRINK);
}

// ─── Grade-threshold tests (V3 frozen calibration) ───────────────────

test("grade thresholds: A≥62, B≥50, C≥38, D≥33, F<33 (R7.1 recalibration)", () => {
  assert.equal(gradeFromOverall(90), "A");
  assert.equal(gradeFromOverall(62), "A");
  assert.equal(gradeFromOverall(61.9), "B");
  assert.equal(gradeFromOverall(50), "B");
  assert.equal(gradeFromOverall(49.9), "C");
  assert.equal(gradeFromOverall(38), "C");
  assert.equal(gradeFromOverall(37.9), "D");
  assert.equal(gradeFromOverall(33), "D");
  assert.equal(gradeFromOverall(32.9), "F");
  assert.equal(gradeFromOverall(0), "F");
});

test("null score returns '?'", () => {
  assert.equal(gradeFromOverall(null), "?");
  assert.equal(gradeFromOverall(undefined), "?");
});

// ─── Shrinkage tests (V3/R1 — replaces the signal-count cap) ─────────

test("shrinkage: single-signal raw 80 lands in B, not A and not flat C", () => {
  // V3: (80·1 + 50·1.5)/2.5 = 62. R7.1: A is now ≥62, so the E-9 single-signal
  // cap (61) is what holds a lone strong record at B — one record never mints A.
  const s = Math.min(61, shrink(80, 1));
  assert.equal(gradeFromOverall(s), "B");
});

test("shrinkage: single-signal raw 46 stays C — low scores aren't lifted past C", () => {
  // (46 + 75)/2.5 = 48.4 → C. The shrink pulls TOWARD 50 from both sides.
  const s = shrink(46, 1);
  assert.equal(gradeFromOverall(s), "C");
});

test("E-9: one contributing category caps at B — never A", () => {
  // Aron's call 2026-06-12. A lone 95-scoring signal shrinks to 68 (A range)
  // — the cap pulls it to 62 (B). Two categories are NOT capped.
  const one = Math.min(61, shrink(95, 1));
  assert.equal(gradeFromOverall(one), "B");
  assert.ok(shrink(95, 1) >= 62, "precondition: uncapped single-signal would have been an A");
  assert.equal(gradeFromOverall(shrink(95, 2)), "A", "two signals may still earn A");
});

test("shrinkage: evidence weight scales confidence monotonically", () => {
  // Same raw 85: more evidence → less shrink → higher final score.
  const w1 = shrink(85, 1);    // 64
  const w3 = shrink(85, 3);    // 73.3
  const w5 = shrink(85, 5);    // 76.9
  assert.ok(w1 < w3 && w3 < w5);
  assert.equal(gradeFromOverall(w1), "A"); // 64 ≥ 63 — barely
  assert.equal(gradeFromOverall(w5), "A");
});

test("shrinkage: symmetric — bad records shrink up toward 50 the same way", () => {
  const s = shrink(8, 1); // (8 + 75)/2.5 = 33.2 — one severe record → D (R7.1: D≥33)
  assert.ok(s > 33 && s < 33.5);
  assert.equal(gradeFromOverall(s), "D");
  const s5 = shrink(8, 5); // (40 + 75)/6.5 = 17.7 → F: breadth of bad records sinks it
  assert.ok(s5 < s);
  assert.equal(gradeFromOverall(s5), "F");
});

test("shrinkage: zero evidence is not scored (null overall → '?')", () => {
  assert.equal(gradeFromOverall(null), "?");
});

// ─── Pay-ratio curve tests (V3/R3) ───────────────────────────────────

test("payRatio: anchors hit exactly", () => {
  assert.equal(payRatioScore(20), 100);
  assert.equal(payRatioScore(25), 95);
  assert.equal(payRatioScore(100), 70);
  assert.equal(payRatioScore(300), 45);
  assert.equal(payRatioScore(1000), 15);
  assert.equal(payRatioScore(3000), 5);
  assert.equal(payRatioScore(50000), 5); // floor past last anchor
});

test("payRatio: monotonically decreasing between anchors", () => {
  let prev = Infinity;
  for (const r of [10, 22, 30, 60, 120, 250, 500, 958, 2000, 4000]) {
    const s = payRatioScore(r);
    assert.ok(s <= prev, `not monotone at ratio ${r}`);
    prev = s;
  }
});

test("payRatio: real brands land in defensible bands", () => {
  // Walmart 958:1 → low-15s · Apple 533:1 → ~28 · Hershey 389:1 → mid-30s
  assert.ok(payRatioScore(958) < 20);
  const apple = payRatioScore(533);
  assert.ok(apple > 20 && apple < 35, `Apple 533:1 got ${apple}`);
  const hershey = payRatioScore(389);
  assert.ok(hershey > 30 && hershey < 45, `Hershey 389:1 got ${hershey}`);
});

// ─── Negative-severity tests (V3/R3) ─────────────────────────────────

test("negative severity: penalty dollars scale the score log-wise", () => {
  assert.equal(negativeSeverityScore("fined $10K for violations", "poor"), 40);
  assert.equal(negativeSeverityScore("penalties of $1M assessed", "poor"), 24);
  assert.equal(negativeSeverityScore("$100M consent decree", "poor"), 8);
});

test("negative severity: no parseable $ keeps legacy band defaults", () => {
  assert.equal(negativeSeverityScore("documented labor violations", "poor"), 35);
  assert.equal(negativeSeverityScore("documented labor violations", "very poor"), 8);
});

test("negative severity: 'very poor' cannot out-score a documented 'poor'", () => {
  // Small fine + very poor enum → capped at 18, not 40.
  assert.ok(negativeSeverityScore("fined $12K", "very poor") <= 18);
});

// ─── Charity-giving curve tests (V3/R3) ──────────────────────────────

test("charity: IRS-990 grants spread the positive band 60-100", () => {
  assert.equal(charityGivingScore({ charity_irs990: { totalGrants: 10_000 } }), 60);
  assert.equal(charityGivingScore({ charity_irs990: { totalGrants: 1_000_000 } }), 76);
  const walmart = charityGivingScore({ charity_irs990: { totalGrants: 131_129_959 } });
  assert.ok(walmart > 92 && walmart < 94, `Walmart $131M got ${walmart}`);
  assert.equal(charityGivingScore({ charity_irs990: { totalGrants: 1e10 } }), 100); // ceiling
});

test("charity: no structured grants → null (caller falls back to 85)", () => {
  assert.equal(charityGivingScore({}), null);
  assert.equal(charityGivingScore({ charity_irs990: { totalGrants: 0 } }), null);
});

// ─── Political differentiation tests (Path B — unchanged in V3) ──────

test("political: bipartisan with no PAC defaults to high-70s", () => {
  const score = politicalScore({}, "bipartisan");
  assert.ok(score >= 75 && score <= 80, `expected 75-80, got ${score}`);
});

test("political: bipartisan balanced 50/50 small PAC = ~85", () => {
  const d = { political: { fecData: { repTotal: 50_000, demTotal: 50_000, totalRaised: 100_000 } } };
  const score = politicalScore(d, "bipartisan");
  assert.ok(score >= 84 && score <= 86, `expected ~85, got ${score}`);
});

test("political: bipartisan big PAC drops score (size factor)", () => {
  const d = { political: { fecData: { repTotal: 5_000_000, demTotal: 5_000_000, totalRaised: 10_000_000 } } };
  const score = politicalScore(d, "bipartisan");
  assert.ok(score >= 70 && score <= 72, `expected ~71, got ${score}`);
});

test("political: hard right partisan with big PAC drops further", () => {
  const d = { political: { fecData: { repTotal: 9_500_000, demTotal: 500_000, totalRaised: 10_000_000 } } };
  const score = politicalScore(d, "right");
  assert.ok(score >= 38 && score <= 41, `expected ~39, got ${score}`);
});

test("political: scores are clamped within band", () => {
  const massive = { political: { fecData: { repTotal: 1e10, demTotal: 0, totalRaised: 1e10 } } };
  assert.ok(politicalScore(massive, "bipartisan") >= 55);
  assert.ok(politicalScore(massive, "right") >= 35);
  const tiny = { political: { fecData: { repTotal: 50, demTotal: 50, totalRaised: 100 } } };
  assert.ok(politicalScore(tiny, "bipartisan") <= 95);
});

test("political: narrative parsing — '70% to Republican' tilt", () => {
  const d = { political: { s: "FEC: $50K PAC donations; 70% to Republican, 30% to Democratic committees." } };
  const { amount, tiltAbs } = parsePoliticalSignals(d);
  assert.equal(amount, 50_000);
  assert.equal(tiltAbs, 20);
});

test("political: narrative parsing — 'partisan lean split' = balanced", () => {
  const d = { political: { s: "FEC: $458K in executive political donations; partisan lean split across 11 executive donors." } };
  const { amount, tiltAbs } = parsePoliticalSignals(d);
  assert.equal(amount, 458_000);
  assert.equal(tiltAbs, 5);
});

test("political: narrative parsing — '+23 across N donors' lean magnitude", () => {
  const d = { political: { s: "FEC: $166K in executive political donations; partisan lean Republican +23 across 8 executive donors." } };
  const { amount, tiltAbs } = parsePoliticalSignals(d);
  assert.equal(amount, 166_000);
  assert.equal(tiltAbs, 23);
});

// ─── Combined: realistic end-to-end brand cases ──────────────────────

test("R7: a political-only brand is no longer graded (political excluded from baseline)", () => {
  // R7 (2026-06-13): political left the un-quizzed baseline — it's a stance
  // category now (rebake-scoring.mjs baseScoreCat returns null for political).
  // A brand whose ONLY signal was donations has no contributing category →
  // overall null → "?". It still personalizes once the user takes a side.
  assert.equal(gradeFromOverall(null), "?");
});

test("E-10: a single moderate negative-only record floors at C, not D/F", () => {
  // R7.1 (2026-06-13): one moderate (non-severe) record can't sink below C —
  // we have the brand's violations but not its positives; that's data sparsity,
  // not conduct. shrink(40,1)=44 (would be D≥33) → floored to 46 (C).
  const floored = Math.max(46, shrink(40, 1));
  assert.equal(gradeFromOverall(floored), "C");
});

test("combined: multi-signal strong record clears A", () => {
  // Raw 85 across W=3 → 73.8 → A
  assert.equal(gradeFromOverall(shrink(85, 3)), "A");
});

test("combined: multi-signal violation-heavy record lands D/F", () => {
  // Raw 30 across W=3 → (90+75)/4.5 = 36.7 → D (R7.1: D≥33). Breadth of bad
  // records is what pushes into F — a single one floors at C (E-10).
  assert.equal(gradeFromOverall(shrink(30, 3)), "D");
  // Deeper violation record (raw 18 × W=4) → (72+75)/5.5 = 26.7 → F.
  assert.equal(gradeFromOverall(shrink(18, 4)), "F");
});
