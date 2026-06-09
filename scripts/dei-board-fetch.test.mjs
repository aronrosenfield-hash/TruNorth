#!/usr/bin/env node
/**
 * Tests for the consolidated DEI / board / exec-comp pipeline.
 *
 *   node --test scripts/dei-board-fetch.test.mjs
 *
 * Covers:
 *   - fetcher corpus integrity (per-source counts, source-URL coverage,
 *     priority-brand presence, parked-source list)
 *   - merger classifier (pay ratios, NAACP grades, DiversityInc ranks,
 *     supplier-diversity dollar thresholds)
 *   - merger severity rollup (concern + leader → mixed)
 *   - merger slug resolution
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS, PARKED_SOURCES } from "./dei-board-fetch.mjs";
import {
  slugify,
  classify,
  rollupSeverity,
  resolveBrand,
} from "./dei-board-merge.mjs";

/* ───────────────────────── fetcher corpus integrity ──────────────────── */

test("every entry references a known source key", () => {
  for (const e of ENTRIES) {
    assert.ok(SOURCE_URLS[e.source], `Unknown source: ${e.source} (${e.brand})`);
  }
});

test("corpus covers all 12 declared source families", () => {
  const seen = new Set(ENTRIES.map(e => e.source));
  for (const k of Object.keys(SOURCE_URLS)) {
    assert.ok(seen.has(k), `Missing entries for source: ${k}`);
  }
});

test("priority brands appear in the corpus", () => {
  const PRIORITY = [
    "Apple", "Microsoft", "Amazon", "Coca-Cola", "JPMorgan Chase",
    "Walt Disney Company", "Walmart", "Costco Wholesale",
    "Marriott International", "Hilton Worldwide", "Accenture",
  ];
  const brandSet = new Set(ENTRIES.map(e => e.brand));
  for (const b of PRIORITY) {
    assert.ok(brandSet.has(b), `Priority brand missing: ${b}`);
  }
});

test("parked sources are tracked with reasons", () => {
  assert.ok(Array.isArray(PARKED_SOURCES));
  assert.ok(PARKED_SOURCES.length >= 10, `expected ≥10 parked sources, got ${PARKED_SOURCES.length}`);
  for (const p of PARKED_SOURCES) {
    assert.ok(p.key && p.reason, `parked source missing key/reason: ${JSON.stringify(p)}`);
  }
});

test("Patagonia entry is included as pay-ratio counterexample", () => {
  const p = ENTRIES.find(e => e.brand === "Patagonia" && e.source === "sec-payratio");
  assert.ok(p, "Patagonia sec-payratio entry should be present");
});

/* ───────────────────────── classifier behaviour ──────────────────────── */

test("classify Equilar 100 = labor concern", () => {
  const r = classify({ source: "equilar-100", tier: "Rank 1", metric: { rank: 1 } });
  assert.equal(r.length, 1);
  assert.equal(r[0].category, "labor");
  assert.equal(r[0].severity, "concern");
});

test("classify DiversityInc Top 10 = leader, Top 50 = positive", () => {
  const top1 = classify({ source: "diversityinc", tier: "Rank 1", metric: { rank: 1 } });
  assert.equal(top1[0].severity, "leader");
  const top25 = classify({ source: "diversityinc", tier: "Top 50" });
  assert.equal(top25[0].severity, "positive");
});

test("classify NAACP grade ladder", () => {
  assert.equal(classify({ source: "naacp-scorecard", tier: "Grade A" })[0].severity, "leader");
  assert.equal(classify({ source: "naacp-scorecard", tier: "Grade B (Telecom 2024)" })[0].severity, "positive");
  assert.equal(classify({ source: "naacp-scorecard", tier: "Grade C (Media 2024)" })[0].severity, "mixed");
  assert.equal(classify({ source: "naacp-scorecard", tier: "Grade D" })[0].severity, "concern");
  assert.equal(classify({ source: "naacp-scorecard", tier: "Grade F" })[0].severity, "concern");
});

test("classify AFL-CIO Paywatch pay-ratio thresholds", () => {
  // 1000+ = concern
  assert.equal(classify({ source: "paywatch", tier: "Pay ratio 6,474:1", metric: { payRatio: 6474 } })[0].severity, "concern");
  // 250-999 = mixed
  assert.equal(classify({ source: "paywatch", tier: "Pay ratio 538:1", metric: { payRatio: 538 } })[0].severity, "mixed");
  // <250 = positive
  assert.equal(classify({ source: "paywatch", tier: "Pay ratio 200:1", metric: { payRatio: 200 } })[0].severity, "positive");
});

test("classify SEC §953(b) pay-ratio thresholds", () => {
  // ≤10 = leader (Berkshire 5:1)
  assert.equal(classify({ source: "sec-payratio", tier: "Pay ratio 5:1", metric: { payRatio: 5 } })[0].severity, "leader");
  // ≤50 = positive
  assert.equal(classify({ source: "sec-payratio", tier: "Pay ratio 40:1", metric: { payRatio: 40 } })[0].severity, "positive");
  // ≤250 = mixed (Costco 247:1)
  assert.equal(classify({ source: "sec-payratio", tier: "Pay ratio 247:1", metric: { payRatio: 247 } })[0].severity, "mixed");
  // >250 = concern (Apple 672:1)
  assert.equal(classify({ source: "sec-payratio", tier: "Pay ratio 672:1", metric: { payRatio: 672 } })[0].severity, "concern");
});

test("classify supplier-diversity dollar thresholds", () => {
  // ≥$5B = leader (AT&T $16B, Walmart $13B, Verizon $6B)
  assert.equal(classify({ source: "supplier-div", tier: "$16B+ diverse-supplier spend" })[0].severity, "leader");
  assert.equal(classify({ source: "supplier-div", tier: "$6B+ diverse-supplier spend" })[0].severity, "leader");
  // ≥$1B, <$5B = positive
  assert.equal(classify({ source: "supplier-div", tier: "$3B+ diverse-supplier spend" })[0].severity, "positive");
  assert.equal(classify({ source: "supplier-div", tier: "$1B+ diverse-supplier spend" })[0].severity, "positive");
});

test("classify Catalyst champion vs 30%+ Coalition", () => {
  assert.equal(classify({ source: "catalyst-wob", tier: "Champion (50%+)" })[0].severity, "leader");
  assert.equal(classify({ source: "catalyst-wob", tier: "30%+ Coalition member" })[0].severity, "leader");
});

test("classify Paradigm-Parity / Lean-In / Working-Mother = positive", () => {
  for (const src of ["paradigm-parity", "leanin-wiw", "working-mother"]) {
    assert.equal(classify({ source: src })[0].severity, "positive", src);
  }
});

test("classify SpencerStuart highlighted = dei positive", () => {
  const r = classify({ source: "spencerstuart", tier: "Highlighted" });
  assert.equal(r[0].category, "dei");
  assert.equal(r[0].severity, "positive");
});

test("classify As You Sow Overpaid Top 25 = concern", () => {
  assert.equal(classify({ source: "ays-overpaid", tier: "Rank 1", metric: { rank: 1 } })[0].severity, "concern");
  assert.equal(classify({ source: "ays-overpaid", tier: "Top 25" })[0].severity, "concern");
  assert.equal(classify({ source: "ays-overpaid", tier: "Top 50" })[0].severity, "mixed");
});

/* ───────────────────────── severity rollup ───────────────────────────── */

test("rollupSeverity: concern + leader → mixed", () => {
  assert.equal(rollupSeverity(["concern", "leader"]), "mixed");
  assert.equal(rollupSeverity(["leader", "concern"]), "mixed");
});

test("rollupSeverity: leader > positive > mixed", () => {
  assert.equal(rollupSeverity(["leader", "positive"]), "leader");
  assert.equal(rollupSeverity(["positive", "mixed"]), "positive");
});

test("rollupSeverity: empty → null", () => {
  assert.equal(rollupSeverity([]), null);
  assert.equal(rollupSeverity(null), null);
});

/* ───────────────────────── slug resolution ───────────────────────────── */

test("resolveBrand: slugHint wins", () => {
  const r = resolveBrand(
    { brand: "Walt Disney Company", slugHint: "disney" },
    { knownSlugs: new Set(["disney"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "disney");
  assert.equal(r.routedVia, "slugHint");
});

test("resolveBrand: direct slugify match", () => {
  const r = resolveBrand(
    { brand: "Apple" },
    { knownSlugs: new Set(["apple"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "apple");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: orphan when nothing matches", () => {
  const r = resolveBrand(
    { brand: "Unknown Brand Co" },
    { knownSlugs: new Set(["something-else"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

/* ───────────────────────── slugify primitive ─────────────────────────── */

test("slugify: handles ampersand and apostrophe", () => {
  assert.equal(slugify("AT&T"), "at-and-t");
  assert.equal(slugify("McDonald's"), "mcdonalds");
});
