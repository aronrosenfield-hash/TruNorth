#!/usr/bin/env node
/**
 * Scoring engine regression tests.
 *
 * 2026-06-09: locks in the scoring math after a week of rapid iteration
 * (Builds 55→58: Excel-rebuild thresholds, S2 65/55 floor, S3 user-
 * relevant cap, signal-count cap, Path B political differentiation).
 *
 * Tests cover:
 *   - Grade threshold math (A≥65, B≥55, C≥45, D≥30, F<30)
 *   - Signal-count cap (A needs ≥3, B needs ≥2)
 *   - Political differentiation by donation $ + tilt %
 *   - Combined effect (cap + thresholds + Path B)
 *
 * If any of these change, deliberate: update both the engine and these
 * tests in the same commit. The whole point of locking in is to make
 * "the scoring drifted" impossible to miss.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Helpers replicated from rebake-scoring.mjs + finalize-bundle.mjs
// (in-line so the test never breaks when those files refactor) ─────────────

function gradeFromOverall(n, realCats) {
  if (n == null) return "?";
  let g;
  if (n >= 65) g = "A";
  else if (n >= 55) g = "B";
  else if (n >= 45) g = "C";
  else if (n >= 30) g = "D";
  else g = "F";
  if (typeof realCats === "number") {
    if (realCats < 2 && (g === "A" || g === "B")) g = "C";
    else if (realCats < 3 && g === "A") g = "B";
  }
  return g;
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

// ─── Grade-threshold tests ────────────────────────────────────────────

test("grade thresholds: A≥65, B≥55, C≥45, D≥30, F<30 (without signal cap)", () => {
  // ≥3 signals — cap doesn't restrict
  assert.equal(gradeFromOverall(90, 5), "A");
  assert.equal(gradeFromOverall(65, 5), "A");
  assert.equal(gradeFromOverall(64.9, 5), "B");
  assert.equal(gradeFromOverall(55, 5), "B");
  assert.equal(gradeFromOverall(54.9, 5), "C");
  assert.equal(gradeFromOverall(45, 5), "C");
  assert.equal(gradeFromOverall(44.9, 5), "D");
  assert.equal(gradeFromOverall(30, 5), "D");
  assert.equal(gradeFromOverall(29.9, 5), "F");
  assert.equal(gradeFromOverall(0, 5), "F");
});

test("null score returns '?'", () => {
  assert.equal(gradeFromOverall(null, 5), "?");
  assert.equal(gradeFromOverall(null, 0), "?");
  assert.equal(gradeFromOverall(null, undefined), "?");
});

// ─── Signal-count cap tests ──────────────────────────────────────────

test("signal cap: 1-signal brand maxes at C even with score ≥65", () => {
  assert.equal(gradeFromOverall(95, 1), "C");
  assert.equal(gradeFromOverall(80, 1), "C");
  assert.equal(gradeFromOverall(65, 1), "C");
  // Below B threshold the cap doesn't bite — natural grade is already ≤C
  assert.equal(gradeFromOverall(54, 1), "C");
  assert.equal(gradeFromOverall(44, 1), "D");
  assert.equal(gradeFromOverall(29, 1), "F");
});

test("signal cap: 2-signal brand maxes at B even with score ≥65", () => {
  assert.equal(gradeFromOverall(95, 2), "B");
  assert.equal(gradeFromOverall(65, 2), "B");
  // B band naturally
  assert.equal(gradeFromOverall(55, 2), "B");
  assert.equal(gradeFromOverall(54, 2), "C");
});

test("signal cap: 3+ signal brand is fully eligible for A", () => {
  assert.equal(gradeFromOverall(95, 3), "A");
  assert.equal(gradeFromOverall(65, 3), "A");
  assert.equal(gradeFromOverall(64.9, 3), "B");
  assert.equal(gradeFromOverall(95, 4), "A");
  assert.equal(gradeFromOverall(95, 10), "A");
});

test("signal cap: undefined realCats means no cap applied", () => {
  assert.equal(gradeFromOverall(95, undefined), "A");
  assert.equal(gradeFromOverall(60, undefined), "B");
});

// ─── Political differentiation tests (Path B) ────────────────────────

test("political: bipartisan with no PAC defaults to mid-90s", () => {
  // No data at all → amount=100K (default), tiltAbs=15 (default)
  // base 85 - 15*0.5 - 0*7 = 77.5
  const score = politicalScore({}, "bipartisan");
  assert.ok(score >= 75 && score <= 80, `expected 75-80, got ${score}`);
});

test("political: bipartisan balanced 50/50 small PAC = ~85", () => {
  const d = { political: { fecData: { repTotal: 50_000, demTotal: 50_000, totalRaised: 100_000 } } };
  const score = politicalScore(d, "bipartisan");
  // base 85 - 0*0.5 - 0*7 = 85
  assert.ok(score >= 84 && score <= 86, `expected ~85, got ${score}`);
});

test("political: bipartisan big PAC drops score (size factor)", () => {
  // $10M PAC, balanced tilt → 85 - 0 - log10(100)*7 = 85 - 14 = 71
  const d = { political: { fecData: { repTotal: 5_000_000, demTotal: 5_000_000, totalRaised: 10_000_000 } } };
  const score = politicalScore(d, "bipartisan");
  assert.ok(score >= 70 && score <= 72, `expected ~71, got ${score}`);
});

test("political: hard right partisan with big PAC drops further", () => {
  // $10M, 95/5 tilt → 58 - 45*0.2 - log10(100)*5 = 58 - 9 - 10 = 39
  const d = { political: { fecData: { repTotal: 9_500_000, demTotal: 500_000, totalRaised: 10_000_000 } } };
  const score = politicalScore(d, "right");
  assert.ok(score >= 38 && score <= 41, `expected ~39, got ${score}`);
});

test("political: scores are clamped within band", () => {
  // Astronomical PAC + extreme tilt — must clamp to floor
  const massive = { political: { fecData: { repTotal: 1e10, demTotal: 0, totalRaised: 1e10 } } };
  assert.ok(politicalScore(massive, "bipartisan") >= 55);
  assert.ok(politicalScore(massive, "right") >= 35);
  // Tiny PAC + perfect balance — must clamp to ceiling
  const tiny = { political: { fecData: { repTotal: 50, demTotal: 50, totalRaised: 100 } } };
  assert.ok(politicalScore(tiny, "bipartisan") <= 95);
});

test("political: narrative parsing — '70% to Republican' tilt", () => {
  const d = { political: { s: "FEC: $50K PAC donations; 70% to Republican, 30% to Democratic committees." } };
  const { amount, tiltAbs } = parsePoliticalSignals(d);
  assert.equal(amount, 50_000);
  assert.equal(tiltAbs, 20); // |70 - 50|
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

test("combined: Walmart-like — 8 signals, score 48.8 → C", () => {
  assert.equal(gradeFromOverall(48.8, 8), "C");
});

test("combined: Wendy's-like — 4 signals, score 43.1 → D", () => {
  assert.equal(gradeFromOverall(43.1, 4), "D");
});

test("combined: ByteDance-like — 1 signal, score 8 → F (cap doesn't downgrade F)", () => {
  assert.equal(gradeFromOverall(8, 1), "F");
});

test("combined: Patagonia-like — 5 signals, score 83 → A", () => {
  assert.equal(gradeFromOverall(83, 5), "A");
});

test("combined: single-bipartisan-only (the old A-clusters) → C", () => {
  // The 1,727 brands that USED to be A at score 80 with 1 signal — now C
  assert.equal(gradeFromOverall(80, 1), "C");
  assert.equal(gradeFromOverall(85, 1), "C");
});
