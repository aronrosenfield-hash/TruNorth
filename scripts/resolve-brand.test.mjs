// B-77 — regression guard for scanner brand resolution.
//
// Runs the REAL resolver (src/lib/resolve-brand.js — the same module App.jsx
// imports, so this cannot drift from shipped behaviour) against the REAL
// catalog and the REAL brand-parent-map.
//
// History: resolution was inline in the BarcodeScanner component and therefore
// untestable. It consulted the curated parent map AFTER a bare prefix loop, so
// the guess beat the curated data: 1,699 of 6,694 resolvable map keys (25.4%)
// returned the wrong company. This is the scanner — the highest-intent moment
// in the product — so a wrong answer is worse than no answer.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveBrand, normalizeBrandKey } from "../src/lib/resolve-brand.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/index.json"), "utf8"));
const parentMap = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf8")
);

const brandIndex = new Map();
for (const c of idx) {
  const k = normalizeBrandKey(c.name);
  if (k) brandIndex.set(k, c);
}
const slugIndex = new Map(idx.map((c) => [c.slug, c]));
const ctx = { brandIndex, parentMap, slugIndex };

// The exact cases that made this a bug report. Each previously resolved to a
// completely unrelated company via the prefix hijack.
test("guard: curated brand-parent-map beats the prefix guess", () => {
  const cases = [
    ["American Spirit", "r-j-reynolds-tobacco-company"],
    ["Ajax", "colgate-palmolive"],
  ];
  for (const [input, wantSlug] of cases) {
    const got = resolveBrand(input, ctx);
    assert.ok(got, `"${input}" resolved to nothing`);
    assert.equal(got.slug, wantSlug, `"${input}" → ${got.slug} (${got.name}), want ${wantSlug}`);
  }
});

// The legitimate use of the prefix pass: a corporate suffix on a known name.
test("guard: corporate-suffix prefix matching still works", () => {
  for (const [input, wantSlug] of [
    ["Coca-Cola Company", "coca-cola"],
    ["Kelloggs Company", "kellogg-s"],
  ]) {
    const got = resolveBrand(input, ctx);
    assert.ok(got, `"${input}" resolved to nothing`);
    assert.equal(got.slug, wantSlug, `"${input}" → ${got && got.slug}, want ${wantSlug}`);
  }
});

// A short/ambiguous fragment must NOT confidently return a wrong brand. The
// scanner's no-match panel (search + "notify me") is a better outcome.
test("guard: ambiguous fragments resolve to nothing, not to a wrong brand", () => {
  for (const frag of ["xyzq", "zzzz"]) {
    assert.equal(resolveBrand(frag, ctx), null, `"${frag}" should not resolve`);
  }
});

// THE invariant behind the roll-up rule (Aron's call): a scan must never come
// back as an ungraded "?" when the curated parent IS graded. That is the whole
// point of rolling up — the user scanned a real product and deserves an answer.
// Precision is preserved in the other direction: a sub-brand WITH its own grade
// still wins over its parent ("76 (gas station)" F stays F, not Phillips 66 D).
test("guard: never returns an ungraded brand when a graded parent exists", () => {
  const offenders = [];
  for (const key of Object.keys(parentMap)) {
    const want = parentMap[key].parent;
    const parent = slugIndex.get(want);
    if (!parent || parent.overall == null) continue; // parent isn't graded — nothing to roll up to
    const got = resolveBrand(key, ctx);
    if (got && got.overall == null) offenders.push(`${key} → ${got.name} (?) but ${want} is graded`);
  }
  assert.equal(
    offenders.length,
    0,
    `${offenders.length} scans return "?" despite a graded parent:\n  ${offenders.slice(0, 8).join("\n  ")}`
  );
});

// Whole-corpus accuracy. Locked below the measured 89.3% so a regression toward
// the old 74.6% fails loudly. The residual is the sub-brand-vs-parent case where
// BOTH are graded and the sub-brand is deliberately preferred as more precise.
test("guard: brand-parent-map resolution accuracy stays above 85%", () => {
  let right = 0;
  let wrong = 0;
  for (const key of Object.keys(parentMap)) {
    const want = parentMap[key].parent;
    if (!slugIndex.has(want)) continue; // parent not in the catalog — not resolvable
    const got = resolveBrand(key, ctx);
    if (!got) continue;
    if (got.slug === want) right++;
    else wrong++;
  }
  const total = right + wrong;
  const pct = (right / total) * 100;
  assert.ok(
    pct >= 85,
    `parent-map accuracy ${pct.toFixed(1)}% (${wrong}/${total} wrong) — was 74.6% before B-77, expected >=85%`
  );
});
