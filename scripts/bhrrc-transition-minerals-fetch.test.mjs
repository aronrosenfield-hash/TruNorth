#!/usr/bin/env node
/**
 * Tests for the BHRRC Transition Minerals Tracker fetcher + merger.
 *
 *   node --test scripts/bhrrc-transition-minerals-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS, ALLEGATION_TYPES } from "./bhrrc-transition-minerals-fetch.mjs";
import {
  severityFor,
  resolveBrand,
  buildAugment,
} from "./bhrrc-transition-minerals-merge.mjs";

/* ─────────────────────────── corpus integrity ────────────────────────── */

test("BHRRC: every entry has a company name + minerals + allegation_count", () => {
  for (const e of ENTRIES) {
    assert.ok(e.company, `missing company on ${JSON.stringify(e)}`);
    assert.ok(Array.isArray(e.minerals) && e.minerals.length, `${e.company}: no minerals`);
    assert.ok(typeof e.allegation_count === "number" && e.allegation_count >= 0, `${e.company}: bad allegation_count`);
  }
});

test("BHRRC: covers all 6 transition minerals across the corpus", () => {
  const six = new Set(["cobalt", "copper", "lithium", "manganese", "nickel", "zinc"]);
  const seen = new Set();
  for (const e of ENTRIES) for (const m of e.minerals) seen.add(m);
  for (const m of six) assert.ok(seen.has(m), `missing transition mineral coverage: ${m}`);
});

test("BHRRC: priority brands present in corpus", () => {
  const PRIORITY = [
    "Glencore plc", "BHP Group", "Rio Tinto plc", "Vale S.A.", "Codelco",
    "Albemarle Corporation", "Sociedad Química y Minera (SQM)",
    "Tianqi Lithium Corporation", "Ganfeng Lithium",
    "Freeport-McMoRan", "Nornickel (Norilsk Nickel)",
    "Tesla Inc", "CATL (Contemporary Amperex Technology)",
  ];
  const set = new Set(ENTRIES.map(e => e.company));
  for (const b of PRIORITY) {
    assert.ok(set.has(b), `priority brand missing: ${b}`);
  }
});

test("BHRRC: every entry has at least one allegation_type drawn from the documented vocabulary", () => {
  const vocab = new Set(ALLEGATION_TYPES);
  for (const e of ENTRIES) {
    assert.ok(Array.isArray(e.allegation_types) && e.allegation_types.length,
      `${e.company}: missing allegation_types`);
    for (const t of e.allegation_types) {
      assert.ok(vocab.has(t), `${e.company}: unknown allegation type "${t}"`);
    }
  }
});

test("BHRRC: source URLs all present + https://", () => {
  for (const v of Object.values(SOURCE_URLS)) {
    assert.match(v, /^https:\/\//, `bad source URL: ${v}`);
  }
});

/* ─────────────────────────── severity classifier ────────────────────── */

test("severityFor thresholds: 15+ very_poor, 5+ poor, 2-4 mixed, 1 low", () => {
  assert.equal(severityFor(20), "very_poor");
  assert.equal(severityFor(15), "very_poor");
  assert.equal(severityFor(14), "poor");
  assert.equal(severityFor(5),  "poor");
  assert.equal(severityFor(4),  "mixed");
  assert.equal(severityFor(2),  "mixed");
  assert.equal(severityFor(1),  "low");
  assert.equal(severityFor(0),  null);
  assert.equal(severityFor(null), null);
});

/* ─────────────────────────── buildAugment shape ─────────────────────── */

test("buildAugment preserves all fields and derives severity", () => {
  const a = buildAugment({
    company: "Glencore plc",
    minerals: ["cobalt", "copper"],
    allegation_count: 56,
    countries: ["DRC"],
    allegation_types: ["worker-rights"],
    period: "2010-2024",
    sourceUrl: "https://example.org",
  });
  assert.equal(a.display_name, "Glencore plc");
  assert.equal(a.allegation_count, 56);
  assert.equal(a.severity, "very_poor");
  assert.deepEqual(a.minerals, ["cobalt", "copper"]);
  assert.equal(a.sourceUrl, "https://example.org");
});

/* ─────────────────────────── slug resolution ─────────────────────────── */

test("resolveBrand: slugHint wins when known", () => {
  const knownSlugs = new Set(["glencore-plc"]);
  const r = resolveBrand(
    { company: "Glencore plc", slugHint: "glencore-plc" },
    { knownSlugs, aliases: {}, parents: {} }
  );
  assert.equal(r.slug, "glencore-plc");
  assert.equal(r.routedVia, "slugHint");
});

test("resolveBrand: falls through slugHint when hint is not known", () => {
  // Hint slug not in index → falls back to direct toSlug match.
  const knownSlugs = new Set(["albemarle"]);
  const r = resolveBrand(
    { company: "Albemarle Corporation", slugHint: "albemarle-not-real" },
    { knownSlugs, aliases: {}, parents: {} }
  );
  assert.equal(r.slug, "albemarle");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: alias resolution", () => {
  const knownSlugs = new Set(["vale-real"]);
  const aliases = { "vale": "vale-real" };
  const r = resolveBrand(
    { company: "Vale" },
    { knownSlugs, aliases, parents: {} }
  );
  assert.equal(r.slug, "vale-real");
  assert.equal(r.routedVia, "alias");
});

test("resolveBrand: parent resolution", () => {
  const knownSlugs = new Set(["parent-co"]);
  const parents = { "subsidiary": { parent: "parent-co" } };
  const r = resolveBrand(
    { company: "Subsidiary" },
    { knownSlugs, aliases: {}, parents }
  );
  assert.equal(r.slug, "parent-co");
  assert.equal(r.routedVia, "parent");
});

test("resolveBrand: orphan when nothing matches", () => {
  const knownSlugs = new Set();
  const r = resolveBrand(
    { company: "Unknown Mining Co" },
    { knownSlugs, aliases: {}, parents: {} }
  );
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});
