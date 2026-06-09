#!/usr/bin/env node
/**
 * Tests for health-pharma-r3 fetcher + merger.
 *
 * Run via: node --test scripts/health-pharma-r3-fetch.test.mjs
 *
 * NO network calls — uses fixture inputs in scripts/fixtures/health-pharma-r3/.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURATED_ENTRIES,
  SOURCE_URLS,
  attachSourceUrls,
  aggregateNursingHomesByChain,
} from "./health-pharma-r3-fetch.mjs";

import {
  slugify,
  resolveBrand,
  rollupSeverity,
  HP_ALIASES,
} from "./health-pharma-r3-merge.mjs";

/* ─── curated corpus integrity ───────────────────────────────────────── */

test("CURATED_ENTRIES are well-formed", () => {
  assert.ok(CURATED_ENTRIES.length >= 50,
    `expected >=50 curated entries, got ${CURATED_ENTRIES.length}`);
  const validSeverity = new Set(["concern", "mixed", "positive", "leader"]);
  const validSources = new Set(Object.keys(SOURCE_URLS));
  for (const e of CURATED_ENTRIES) {
    assert.ok(e.brand, "entry missing brand");
    assert.ok(e.source, `entry missing source: ${e.brand}`);
    assert.ok(validSources.has(e.source), `unknown source: ${e.source}`);
    assert.ok(validSeverity.has(e.severity), `invalid severity: ${e.severity} for ${e.brand}`);
    assert.ok(e.title || e.summary, `entry missing title/summary: ${e.brand}`);
    if (e.amountUsd != null) {
      assert.equal(typeof e.amountUsd, "number");
      assert.ok(e.amountUsd > 0, `bad amount: ${e.amountUsd} for ${e.brand}`);
    }
    if (e.year != null) {
      assert.ok(e.year >= 2010 && e.year <= 2027, `year out of range: ${e.year}`);
    }
  }
});

test("attachSourceUrls fills sourceUrl + default category", () => {
  const entries = [
    { source: "doj-fca-healthcare", brand: "Test", severity: "concern" },
    { source: "fda-drug-shortages", brand: "Test2", severity: "mixed" },
  ];
  attachSourceUrls(entries);
  assert.equal(entries[0].sourceUrl, SOURCE_URLS["doj-fca-healthcare"]);
  assert.equal(entries[1].sourceUrl, SOURCE_URLS["fda-drug-shortages"]);
  assert.deepEqual(entries[0].categories, ["health"]);
});

test("attachSourceUrls throws on unknown source", () => {
  assert.throws(() => attachSourceUrls([{ source: "made-up-source", brand: "X" }]));
});

test("SOURCE_URLS covers all twelve documented sources", () => {
  const expected = [
    "doj-fca-healthcare", "dea-enforcement", "opioid-settlements",
    "fda-drug-shortages", "fda-maude-mfr", "cms-nh-compare",
    "leapfrog-hospital-safety", "usda-fsis-recalls", "cdc-ar-meat",
    "csp-iworst-eating", "public-citizen-worst-pills", "truth-initiative-tobacco",
  ];
  for (const k of expected) {
    assert.ok(SOURCE_URLS[k], `missing source URL for ${k}`);
    assert.match(SOURCE_URLS[k], /^https?:\/\//);
  }
});

/* ─── slug utilities ────────────────────────────────────────────────── */

test("slugify — basic normalization", () => {
  assert.equal(slugify("Johnson & Johnson"), "johnson-and-johnson");
  assert.equal(slugify("Boar's Head"), "boars-head");
  assert.equal(slugify("CVS Health"), "cvs-health");
  assert.equal(slugify(""), "");
  assert.equal(slugify(null), "");
});

/* ─── resolveBrand routing ──────────────────────────────────────────── */

const KNOWN = new Set([
  "pfizer", "johnson-and-johnson", "cvs-health", "walgreens",
  "tyson-foods", "mckesson", "merck-and-co", "novartis", "roche",
  "amerisourcebergen", "cardinal-health", "altria-group",
]);

test("resolveBrand — slugHint direct hit", () => {
  const r = resolveBrand(
    { brand: "Pfizer Inc", slugHint: "pfizer" },
    { knownSlugs: KNOWN, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "pfizer");
  assert.equal(r.routedVia, "slugHint");
});

test("resolveBrand — direct slug match", () => {
  const r = resolveBrand(
    { brand: "Johnson & Johnson" },
    { knownSlugs: KNOWN, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "johnson-and-johnson");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand — curated HP_ALIAS hit (Hospira → Pfizer)", () => {
  const r = resolveBrand(
    { brand: "Hospira Inc" },
    { knownSlugs: KNOWN, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "pfizer");
  assert.equal(r.routedVia, "hpAlias");
});

test("resolveBrand — curated HP_ALIAS hit (Sandoz → Novartis)", () => {
  const r = resolveBrand(
    { brand: "Sandoz Inc" },
    { knownSlugs: KNOWN, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "novartis");
});

test("resolveBrand — corporate suffix peel", () => {
  const r = resolveBrand(
    { brand: "Tyson Foods Inc" },
    { knownSlugs: KNOWN, aliases: {}, parents: {} },
  );
  assert.ok(["direct", "suffix", "hpAlias"].includes(r.routedVia), `routedVia: ${r.routedVia}`);
  // either tyson-foods-inc (alias) or tyson-foods (suffix) is acceptable
  assert.equal(r.slug, "tyson-foods");
});

test("resolveBrand — unknown brand → orphan", () => {
  const r = resolveBrand(
    { brand: "Totally Unknown Pharma XYZ" },
    { knownSlugs: KNOWN, aliases: {}, parents: {} },
  );
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("resolveBrand — project-level slug-aliases.json takes precedence over orphan", () => {
  const r = resolveBrand(
    { brand: "Some Acquired Startup" },
    { knownSlugs: KNOWN, aliases: { "some-acquired-startup": "pfizer" }, parents: {} },
  );
  assert.equal(r.slug, "pfizer");
  assert.equal(r.routedVia, "alias");
});

/* ─── HP_ALIASES coverage ───────────────────────────────────────────── */

test("HP_ALIASES — covers top pharma subsidiary names", () => {
  const required = [
    "hospira-inc",              // → pfizer
    "wyeth-pharmaceuticals-inc",// → pfizer
    "sandoz-inc",               // → novartis
    "genentech-inc",            // → roche
    "merck-sharp-and-dohme-llc",// → merck-and-co
    "eli-lilly-and-company",    // → eli-lilly
    "philip-morris-usa",        // → altria-group
    "altria",                   // → altria-group
    "tyson-foods-inc",          // → tyson-foods
    "jbs-usa",                  // → jbs-n-v
    "mckesson-corporation",     // → mckesson
    "endo-pharmaceuticals",     // → endo-health-solutions
  ];
  for (const k of required) {
    assert.ok(HP_ALIASES[k], `missing alias: ${k}`);
  }
});

/* ─── rollupSeverity ────────────────────────────────────────────────── */

test("rollupSeverity — single tag passthrough", () => {
  assert.equal(rollupSeverity(["leader"]), "leader");
  assert.equal(rollupSeverity(["concern"]), "concern");
  assert.equal(rollupSeverity(["positive"]), "positive");
  assert.equal(rollupSeverity([]), null);
});

test("rollupSeverity — concern + leader = mixed", () => {
  assert.equal(rollupSeverity(["concern", "leader"]), "mixed");
  assert.equal(rollupSeverity(["leader", "concern"]), "mixed");
});

test("rollupSeverity — multiple concerns, no upside = concern", () => {
  assert.equal(rollupSeverity(["concern", "concern", "mixed"]), "concern");
});

test("rollupSeverity — picks best rank when no concern", () => {
  assert.equal(rollupSeverity(["mixed", "positive"]), "positive");
  assert.equal(rollupSeverity(["mixed", "positive", "leader"]), "leader");
});

/* ─── aggregateNursingHomesByChain ─────────────────────────────────── */

test("aggregateNursingHomesByChain — Genesis facilities aggregate to concern", () => {
  const rows = [
    { provider_name: "GENESIS HEALTHCARE OF EAST POINT", overall_rating: "1" },
    { provider_name: "GENESIS HEALTHCARE NORTH",          overall_rating: "2" },
    { provider_name: "GENESIS HEALTHCARE OF MEMPHIS",     overall_rating: "1" },
  ];
  const out = aggregateNursingHomesByChain(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].slugHint, "genesis-healthcare");
  assert.equal(out[0].severity, "concern");
  assert.equal(out[0]._liveFacilities, 3);
  assert.ok(out[0]._liveAvgRating <= 2.4);
});

test("aggregateNursingHomesByChain — Ensign aggregates to positive/leader", () => {
  const rows = [
    { provider_name: "ENSIGN MAIN STREET",   overall_rating: "4" },
    { provider_name: "ENSIGN MORENO VALLEY", overall_rating: "4" },
    { provider_name: "ENSIGN PARKSIDE",      overall_rating: "5" },
    { provider_name: "ENSIGN VALLEY VIEW",   overall_rating: "5" },
  ];
  const out = aggregateNursingHomesByChain(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].slugHint, "ensign-group");
  assert.ok(["positive", "leader"].includes(out[0].severity), `got ${out[0].severity}`);
});

test("aggregateNursingHomesByChain — ignores chains below 3-facility floor", () => {
  const rows = [
    { provider_name: "BROOKDALE FORESTSIDE", overall_rating: "3" },
    { provider_name: "BROOKDALE STERLING",    overall_rating: "3" },
  ];
  const out = aggregateNursingHomesByChain(rows);
  // Brookdale only has 2 rows; should be filtered out (floor is 3)
  assert.equal(out.length, 0);
});

test("aggregateNursingHomesByChain — ignores non-matching rows entirely", () => {
  const rows = [
    { provider_name: "SOME UNRELATED NURSING HOME", overall_rating: "3" },
    { provider_name: "ANOTHER GENERIC SNF",         overall_rating: "4" },
  ];
  const out = aggregateNursingHomesByChain(rows);
  assert.equal(out.length, 0);
});

test("aggregateNursingHomesByChain — handles missing ratings without crashing", () => {
  const rows = [
    { provider_name: "GENESIS HEALTHCARE A", overall_rating: null },
    { provider_name: "GENESIS HEALTHCARE B", overall_rating: "" },
    { provider_name: "GENESIS HEALTHCARE C", overall_rating: "2" },
  ];
  const out = aggregateNursingHomesByChain(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]._liveFacilities, 3);
  // Only one rating numerically used (the "2"), so avg = 2.0 → concern
  assert.equal(out[0].severity, "concern");
});

/* ─── end-to-end shape smoke test ───────────────────────────────────── */

test("CURATED_ENTRIES — every brand has a slugHint set", () => {
  const noHint = CURATED_ENTRIES.filter(e => !e.slugHint);
  assert.equal(noHint.length, 0,
    `${noHint.length} curated entries missing slugHint: ${noHint.map(e => e.brand).join(", ")}`);
});

test("CURATED_ENTRIES — sources spread across all twelve buckets", () => {
  const seen = new Set(CURATED_ENTRIES.map(e => e.source));
  for (const k of Object.keys(SOURCE_URLS)) {
    if (k === "fda-drug-shortages" || k === "fda-maude-mfr" || k === "cms-nh-compare") {
      // these three are live-only buckets (curated entries optional)
      continue;
    }
    assert.ok(seen.has(k), `no curated entries for source: ${k}`);
  }
});
