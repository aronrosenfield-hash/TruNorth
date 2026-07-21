// PR-3 — tests for the pure scoringFlags helpers used by App.jsx's
// CategoryRow and computeScore.
//
// The repo has no Vitest/jsdom setup, so we test the helpers directly
// (they're pure functions) and assert the render decisions for the 5
// canonical brands (apple, walmart, patagonia, shein, starbucks) using
// the actual `flags` block written by scripts/reflag-categories.mjs into
// public/data/companies/<slug>.json. This is the closest thing to a
// "snapshot test" we can do without React in the loop.
//
// Run: node --test src/lib/scoringFlags.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getCategoryFlagRender,
  isCategoryExcludedByFlags,
  NOT_APPLICABLE_LABEL,
  NOT_DISCLOSED_LABELS,
} from "./scoringFlags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const COMPANIES_DIR = path.join(ROOT, "public/data/companies");

const CATEGORIES = [
  "political","charity","environment","labor","dei",
  "animals","guns","privacy","execPay",
  "transparency","health",
];

function loadCo(slug) {
  return JSON.parse(fs.readFileSync(path.join(COMPANIES_DIR, `${slug}.json`), "utf-8"));
}

// Build the render snapshot for one company across all categories, so we can
// eyeball-diff the matrix in CI if it ever changes.
function renderSnapshot(co, enabled) {
  const out = {};
  for (const k of CATEGORIES) {
    out[k] = getCategoryFlagRender(co.flags, k, enabled);
  }
  return out;
}

// ─── Feature flag OFF — must be a no-op (default for every category) ────────

test("flag OFF: every category renders default for every brand", () => {
  for (const slug of ["apple", "walmart", "patagonia", "shein", "starbucks"]) {
    const co = loadCo(slug);
    const snap = renderSnapshot(co, false);
    for (const k of CATEGORIES) {
      assert.deepEqual(snap[k], { kind: "default" },
        `${slug}.${k} should be default when flag OFF (got ${JSON.stringify(snap[k])})`);
    }
  }
});

test("flag OFF: no category is ever excluded by flags", () => {
  for (const slug of ["apple", "walmart", "patagonia", "shein", "starbucks"]) {
    const co = loadCo(slug);
    for (const k of CATEGORIES) {
      assert.equal(isCategoryExcludedByFlags(co.flags, k, false), false,
        `${slug}.${k} should not be excluded when flag OFF`);
    }
  }
});

test("flag OFF: works even when co.flags is undefined", () => {
  assert.deepEqual(getCategoryFlagRender(undefined, "guns", false), { kind: "default" });
  assert.equal(isCategoryExcludedByFlags(undefined, "guns", false), false);
});

// ─── Feature flag ON — snapshot per brand × category ────────────────────────

test("snapshot: apple (Technology) — guns/animals/health na", () => {
  const co = loadCo("apple");
  const snap = renderSnapshot(co, true);
  // Industry-level NAs for Technology per category-applicability.json
  assert.deepEqual(snap.guns,    { kind: "na", label: NOT_APPLICABLE_LABEL });
  assert.deepEqual(snap.animals, { kind: "na", label: NOT_APPLICABLE_LABEL });
  assert.deepEqual(snap.health,  { kind: "na", label: NOT_APPLICABLE_LABEL });
  // B-96 (2026-07-20): environment used to carry `_inferred` with
  // basis "Technology". Apple now has REAL environmental records, so the
  // inferred flag was correctly dropped and this renders as a normal scored
  // category. Do not "restore" the inferred expectation — a real record
  // outranks an industry inference.
  assert.equal(snap.environment.kind, "default");
  // Public company → execPay NOT notDisclosed (Apple has ticker AAPL)
  assert.notEqual(snap.execPay.kind, "notDisclosed");
});

test("snapshot: walmart (Retail) — health na, guns APPLIES (they sell firearms)", () => {
  const co = loadCo("walmart");
  const snap = renderSnapshot(co, true);
  // B-96: guns was flagged `na` for Walmart, which was simply wrong — Walmart
  // is one of the largest US firearms retailers, so the category very much
  // applies. The flag was correctly removed; it now scores normally.
  assert.deepEqual(snap.guns,   { kind: "default" });
  assert.deepEqual(snap.health, { kind: "na", label: NOT_APPLICABLE_LABEL });
  // Walmart is public — execPay should NOT be notDisclosed
  assert.notEqual(snap.execPay.kind, "notDisclosed");
});

test("snapshot: patagonia (Apparel & Fashion) — private company exec-pay na", () => {
  const co = loadCo("patagonia");
  const snap = renderSnapshot(co, true);
  // Apparel & Fashion: guns + health na
  assert.deepEqual(snap.guns,   { kind: "na", label: NOT_APPLICABLE_LABEL });
  assert.deepEqual(snap.health, { kind: "na", label: NOT_APPLICABLE_LABEL });
  // B-96 (2026-07-20): this expected `notDisclosed`, and that is WRONG.
  // The metric is the SEC Item 402(u) CEO-to-worker pay ratio, which applies
  // to PUBLIC REGISTRANTS ONLY. A private company isn't withholding it — the
  // requirement genuinely does not apply, which is exactly what `na` means.
  // `notDisclosed` would falsely imply they chose to hide something they owed.
  // See the "Lever 2" rationale in scripts/reflag-categories.mjs.
  // (Both kinds exclude the category from scoring, so this is display-only.)
  assert.deepEqual(snap.execPay, { kind: "na", label: NOT_APPLICABLE_LABEL });
});

test("snapshot: shein (Apparel & Fashion) — guns/health na", () => {
  const co = loadCo("shein");
  const snap = renderSnapshot(co, true);
  assert.deepEqual(snap.guns,   { kind: "na", label: NOT_APPLICABLE_LABEL });
  assert.deepEqual(snap.health, { kind: "na", label: NOT_APPLICABLE_LABEL });
});

test("snapshot: starbucks (Food & Beverage) — guns na, health applicable", () => {
  const co = loadCo("starbucks");
  const snap = renderSnapshot(co, true);
  assert.deepEqual(snap.guns, { kind: "na", label: NOT_APPLICABLE_LABEL });
  // health is applicable for Food & Beverage — should not be na
  assert.notEqual(snap.health.kind, "na");
});

// ─── Grade-math exclusion semantics ─────────────────────────────────────────

test("flag ON: na and notDisclosed both excluded from grade math", () => {
  const co = loadCo("apple");
  // Apple has guns.na and (likely) charity.notDisclosed
  assert.equal(isCategoryExcludedByFlags(co.flags, "guns", true), true);
  // Verify the helper is symmetric with the render result
  for (const k of CATEGORIES) {
    const r = getCategoryFlagRender(co.flags, k, true);
    const excluded = isCategoryExcludedByFlags(co.flags, k, true);
    if (r.kind === "na" || r.kind === "notDisclosed") {
      assert.equal(excluded, true, `${k}: render says ${r.kind} but not excluded`);
    } else {
      assert.equal(excluded, false, `${k}: render says ${r.kind} but excluded`);
    }
  }
});

test("flag ON: _inferred is INCLUDED in grade math (still counted)", () => {
  const co = loadCo("apple");
  // Apple has environment._inferred — must NOT be excluded
  if (co.flags?.environment?._inferred) {
    assert.equal(isCategoryExcludedByFlags(co.flags, "environment", true), false);
  }
});

// ─── Grade-drift report assertion (the launch-readiness bar) ────────────────

test("grade-drift report exists and is within acceptance threshold", () => {
  const reportPath = path.join(ROOT, "data/derived/_meta/grade-drift-report.json");
  if (!fs.existsSync(reportPath)) {
    // Skip in environments where the audit hasn't been run yet (e.g. fresh
    // checkout). CI / pre-merge gating should run `node scripts/audit-grade-drift.mjs`
    // before this test.
    console.warn("[scoringFlags.test] grade-drift report not found — skipping threshold check. Run `node scripts/audit-grade-drift.mjs` first.");
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  assert.equal(report.withinThreshold, true,
    `grade drift (${report.drifted}) exceeds acceptance threshold (${report.acceptanceThreshold})`);
  // Every drifted company must have a non-empty reason list (explainable).
  for (const d of report.drifts) {
    assert.ok(Array.isArray(d.reason) && d.reason.length > 0,
      `drift for ${d.slug} has no reason — unexplainable change`);
    for (const r of d.reason) {
      assert.ok(["na", "notDisclosed"].includes(r.by),
        `drift for ${d.slug}.${r.k} attributed to unknown cause '${r.by}'`);
    }
  }
});

// ─── Default-OFF invariant: helpers without an explicit `enabled` arg ───────

test("default-OFF invariant: passing `false` is a true no-op", () => {
  // Construct a synthetic company with EVERY possible flag set, then verify
  // every getter/exclusion is the no-flag path when enabled=false.
  const co = {
    flags: {
      political:   { na: true },
      charity:     { notDisclosed: true },
      environment: { _inferred: true, basis: "Technology" },
      labor:       { na: true },
      dei:         { notDisclosed: true },
      animals:     { na: true },
      guns:        { na: true },
      privacy:     { notDisclosed: true },
      execPay:     { notDisclosed: true },
    },
  };
  for (const k of CATEGORIES) {
    assert.deepEqual(getCategoryFlagRender(co.flags, k, false), { kind: "default" });
    assert.equal(isCategoryExcludedByFlags(co.flags, k, false), false);
  }
});
