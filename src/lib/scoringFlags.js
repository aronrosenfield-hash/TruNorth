// PR-3: pure helpers that turn the `flags` block on each company
// (written by scripts/reflag-categories.mjs in PR-2) into:
//   1. A render hint for App.jsx's CategoryRow chip.
//   2. An "exclude from grade math" decision for computeScore.
//
// Centralised here so:
//   - App.jsx imports one helper instead of 3 inline branches.
//   - node:test can exercise the render-decision matrix without React/jsdom.
//   - Future cleanup (PR-4) can deprecate `excl` and the legacy `na`/`neutral`
//     skip gates in one place.
//
// All exports are PURE FUNCTIONS — no module-level state, no React.
//
// Feature-flag semantics live in src/lib/dataSource.js#featureFlagsEnabled.
// This module is intentionally agnostic — it accepts an `enabled` boolean so
// callers (App.jsx and tests) decide which world they're in.

// Per-category copy when notDisclosed is the reason a chip is greyed.
// Falls back to a generic "Not publicly disclosed" string for unknown keys.
export const NOT_DISCLOSED_LABELS = {
  execPay:      "Private company — exec comp not publicly disclosed",
  dei:          "Company doesn't publicly disclose workforce composition",
  charity:      "No public giving disclosed",
  transparency: "Transparency benchmarks not yet evaluated",
  // The 9 grade-affecting categories also accept notDisclosed even though we
  // don't write it for them today — fall back to generic copy if they show up.
  political:    "Not publicly disclosed",
  environment:  "Not publicly disclosed",
  labor:        "Not publicly disclosed",
  animals:      "Not publicly disclosed",
  guns:         "Not publicly disclosed",
  privacy:      "Not publicly disclosed",
  health:       "Not publicly disclosed",
};

export const NOT_APPLICABLE_LABEL = "Not Applicable for this Industry";

/**
 * Decide how to render a category chip, given the company's `flags` block.
 *
 * Returns one of:
 *   { kind: "default" }                                   — no flag, render normally
 *   { kind: "na",            label }                      — greyed, no score circle
 *   { kind: "notDisclosed",  label }                      — greyed, no score circle
 *   { kind: "inferred",      basis }                      — normal score + info tooltip
 *
 * When the feature flag is disabled, always returns { kind: "default" } so
 * App.jsx renders exactly today's UI.
 */
export function getCategoryFlagRender(flags, cat, enabled) {
  if (!enabled) return { kind: "default" };
  const f = flags?.[cat];
  if (!f || typeof f !== "object") return { kind: "default" };

  if (f.na === true) {
    return { kind: "na", label: NOT_APPLICABLE_LABEL };
  }
  if (f.notDisclosed === true) {
    return {
      kind: "notDisclosed",
      label: NOT_DISCLOSED_LABELS[cat] || "Not publicly disclosed",
    };
  }
  if (f._inferred === true) {
    return { kind: "inferred", basis: f.basis || null };
  }
  return { kind: "default" };
}

/**
 * Should computeScore() skip this category for grade math purposes?
 *
 * When the feature flag is disabled, ALWAYS returns false — i.e. the existing
 * exclusion gates (unknown / neutral / na enum / excl[] / "no public record")
 * are the only thing that matters. This guarantees byte-identical math when
 * the flag is off.
 *
 * When the feature flag is enabled, returns true for `na` and `notDisclosed`.
 * `_inferred` is NOT skipped — inferred scores still count toward the grade.
 *
 * Both `na` and `notDisclosed` were already implicitly excluded today via the
 * legacy gates in most cases; making them explicit means PR-3 can render the
 * proper label without depending on which gate fired.
 */
export function isCategoryExcludedByFlags(flags, cat, enabled) {
  if (!enabled) return false;
  const f = flags?.[cat];
  if (!f || typeof f !== "object") return false;
  return f.na === true || f.notDisclosed === true;
}
