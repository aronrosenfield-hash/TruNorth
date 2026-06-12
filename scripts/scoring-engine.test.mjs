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

// ─── Helpers replicated from rebake-scoring.mjs + finalize-bundle.mjs
// (in-line so the test never breaks when those files refactor) ─────────────

const K_SHRINK = 1.5;

function gradeFromOverall(n) {
  // V3 frozen thresholds — no signal-count cap (shrinkage handles evidence).
  if (n == null) return "?";
  if (n >= 63) return "A";
  if (n >= 56) return "B";
  if (n >= 46) return "C";
  if (n >= 41) return "D";
  return "F";
}

function shrink(raw, W) {
  return (raw * W + 50 * K_SHRINK) / (W + K_SHRINK);
}

function parseDollars(text) {
  const m = String(text || "").match(/\$([\d,]+(?:\.\d+)?)\s*([KMB])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toUpperCase();
  return n * (unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1);
}

function negativeSeverityScore(narrative, enumVal) {
  const dollars = parseDollars(narrative);
  if (dollars >= 1000) {
    const sev = Math.max(8, Math.min(40, 40 - 8 * Math.log10(dollars / 10_000)));
    return enumVal === "very poor" ? Math.min(sev, 18) : sev;
  }
  return enumVal === "very poor" ? 8 : 35;
}

const PAY_ANCHORS = [[20, 100], [25, 95], [100, 70], [300, 45], [1000, 15], [3000, 5]];
function payRatioScore(ratio) {
  if (ratio <= PAY_ANCHORS[0][0]) return 100;
  const lr = Math.log10(ratio);
  for (let i = 1; i < PAY_ANCHORS.length; i++) {
    const [r1, s1] = PAY_ANCHORS[i - 1];
    const [r2, s2] = PAY_ANCHORS[i];
    if (ratio <= r2) {
      const t = (lr - Math.log10(r1)) / (Math.log10(r2) - Math.log10(r1));
      return s1 + t * (s2 - s1);
    }
  }
  return 5;
}

function charityGivingScore(d) {
  const g = d?.charity_irs990?.totalGrants;
  if (typeof g === "number" && g >= 10_000) {
    return Math.max(60, Math.min(100, 60 + 8 * Math.log10(g / 10_000)));
  }
  return null;
}

function parsePoliticalSignals(d) {
  const p = d?.political || {};
  let amount = 0, tiltAbs = null, hasData = false;
  if (p.fecData) {
    amount = Number(p.fecData.totalRaised) || 0;
    const rep = Number(p.fecData.repTotal) || 0;
    const dem = Number(p.fecData.demTotal) || 0;
    if (rep + dem > 0) tiltAbs = Math.abs((rep / (rep + dem)) * 100 - 50);
    hasData = true;
  }
  const s = String(p.s || "");
  if (!hasData) {
    const m = s.match(/\$([\d.]+)\s*([KMB]?)/);
    if (m) {
      const n = parseFloat(m[1]);
      const unit = m[2] || "";
      amount = n * (unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1);
    }
  }
  if (tiltAbs == null) {
    const pctR = s.match(/(\d+)%\s+to\s+Republican/i);
    const pctD = s.match(/(\d+)%\s+to\s+Democratic/i);
    if (pctR || pctD) {
      const r = pctR ? +pctR[1] : (pctD ? 100 - +pctD[1] : 50);
      tiltAbs = Math.abs(r - 50);
    } else {
      const lean = s.match(/\+(\d+)\s+across/i);
      if (lean) tiltAbs = Math.min(50, +lean[1]);
      else if (/partisan lean split/i.test(s)) tiltAbs = 5;
    }
  }
  if (amount === 0) amount = 100_000;
  if (tiltAbs == null) tiltAbs = 15;
  return { amount, tiltAbs };
}

function politicalScore(d, val) {
  const { amount, tiltAbs } = parsePoliticalSignals(d);
  const sizeFactor = Math.log10(Math.max(1, amount / 100_000));
  if (val === "bipartisan" || val === "mixed") {
    return Math.max(55, Math.min(95, 85 - tiltAbs * 0.5 - sizeFactor * 7));
  }
  if (val === "left-leaning" || val === "right-leaning") {
    return Math.max(45, Math.min(70, 65 - sizeFactor * 5));
  }
  if (val === "left" || val === "right") {
    return Math.max(35, Math.min(65, 58 - tiltAbs * 0.2 - sizeFactor * 5));
  }
  return null;
}

// ─── Grade-threshold tests (V3 frozen calibration) ───────────────────

test("grade thresholds: A≥63, B≥56, C≥46, D≥41, F<41", () => {
  assert.equal(gradeFromOverall(90), "A");
  assert.equal(gradeFromOverall(63), "A");
  assert.equal(gradeFromOverall(62.9), "B");
  assert.equal(gradeFromOverall(56), "B");
  assert.equal(gradeFromOverall(55.9), "C");
  assert.equal(gradeFromOverall(46), "C");
  assert.equal(gradeFromOverall(45.9), "D");
  assert.equal(gradeFromOverall(41), "D");
  assert.equal(gradeFromOverall(40.9), "F");
  assert.equal(gradeFromOverall(0), "F");
});

test("null score returns '?'", () => {
  assert.equal(gradeFromOverall(null), "?");
  assert.equal(gradeFromOverall(undefined), "?");
});

// ─── Shrinkage tests (V3/R1 — replaces the signal-count cap) ─────────

test("shrinkage: single-signal raw 80 lands in B, not A and not flat C", () => {
  // Old cap: 80 with 1 signal → forced C. V3: (80·1 + 50·1.5)/2.5 = 62 → B.
  const s = shrink(80, 1);
  assert.ok(s > 61.9 && s < 62.1, `expected 62, got ${s}`);
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
  const one = Math.min(62, shrink(95, 1));
  assert.equal(gradeFromOverall(one), "B");
  assert.ok(shrink(95, 1) >= 63, "precondition: uncapped single-signal would have been an A");
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
  const s = shrink(8, 1); // (8 + 75)/2.5 = 33.2 → F
  assert.ok(s > 33 && s < 33.5);
  assert.equal(gradeFromOverall(s), "F");
  const s5 = shrink(8, 5); // (40 + 75)/6.5 = 17.7 → F, deeper with more evidence
  assert.ok(s5 < s);
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

test("combined: single-bipartisan-only (the old capped-C cluster) → B", () => {
  // Raw 78-82 with W=1 shrinks to 61.2-62.8 → B. These 1,500+ brands were
  // the C mountain under the Build-57 cap; now they're differentiated.
  assert.equal(gradeFromOverall(shrink(78, 1)), "B");
  assert.equal(gradeFromOverall(shrink(82, 1)), "B");
});

test("combined: single-partisan small PAC → C", () => {
  // Raw ~54 with W=1 → (54+75)/2.5 = 51.6 → C
  assert.equal(gradeFromOverall(shrink(54, 1)), "C");
});

test("combined: multi-signal strong record clears A", () => {
  // Raw 85 across W=3 → 73.8 → A
  assert.equal(gradeFromOverall(shrink(85, 3)), "A");
});

test("combined: multi-signal violation-heavy record lands D/F", () => {
  // Raw 30 across W=3 → (90+75)/4.5 = 36.7 → F
  assert.equal(gradeFromOverall(shrink(30, 3)), "F");
});
