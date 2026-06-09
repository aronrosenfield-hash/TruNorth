#!/usr/bin/env node
/**
 * Tests for the Stanford FMTI fetcher + merger.
 *
 *   node --test scripts/fmti-fetch.test.mjs
 *
 * Covers:
 *   - CSV split handles quoted commas
 *   - parseScoresCsv yields correct totals for the Dec2025 fixture
 *   - banding ladder (leader ≥70, mixed 40–69, poor <40)
 *   - SLUG_HINTS covers every Dec2025 developer name
 *   - merger resolveBrand routing ladder + slugHint-parent fallback
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseScoresCsv,
  splitCsvRow,
  bandFor,
  SLUG_HINTS,
  ROUNDS,
} from "./fmti-fetch.mjs";

import { slugify, resolveBrand } from "./fmti-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "scripts/fixtures/fmti/Dec2025_scores.csv");

/* ────────────────────────── CSV split primitive ──────────────────────── */

test("splitCsvRow: plain row", () => {
  assert.deepEqual(splitCsvRow("a,b,c"), ["a", "b", "c"]);
});

test("splitCsvRow: quoted comma", () => {
  assert.deepEqual(
    splitCsvRow('"Permitted, restricted, and prohibited model behaviors",1,0'),
    ["Permitted, restricted, and prohibited model behaviors", "1", "0"]
  );
});

test('splitCsvRow: escaped quote ("")', () => {
  assert.deepEqual(splitCsvRow('"he said ""hi""",x'), ['he said "hi"', "x"]);
});

/* ─────────────────────────── parseScoresCsv ──────────────────────────── */

test("parseScoresCsv: tiny synthetic CSV", () => {
  const csv = [
    "Indicator,OpenAI,Anthropic",
    "x,1,0",
    "y,0,1",
    "z,1,1",
  ].join("\n");
  const { indicators, developers } = parseScoresCsv(csv);
  assert.equal(indicators, 3);
  assert.deepEqual(developers, [
    { name: "OpenAI", score: 2 },
    { name: "Anthropic", score: 2 },
  ]);
});

test("parseScoresCsv: Dec2025 fixture totals 100 indicators across 13 devs", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const { indicators, developers } = parseScoresCsv(csv);
  assert.equal(indicators, 100, "expected 100 indicators");
  assert.equal(developers.length, 13, "expected 13 developers in Dec2025");
  // Known-good values from cross-check with Python summing.
  const map = Object.fromEntries(developers.map(d => [d.name, d.score]));
  assert.equal(map["IBM"], 95);
  assert.equal(map["Writer"], 72);
  assert.equal(map["AI21 Labs"], 66);
  assert.equal(map["Anthropic"], 46);
  assert.equal(map["OpenAI"], 35);
  assert.equal(map["xAI"], 14);
});

/* ───────────────────────────── band rules ────────────────────────────── */

test("bandFor: leader ≥ 70", () => {
  assert.equal(bandFor(70), "leader");
  assert.equal(bandFor(95), "leader");
});

test("bandFor: mixed 40–69", () => {
  assert.equal(bandFor(40), "mixed");
  assert.equal(bandFor(69), "mixed");
});

test("bandFor: poor < 40", () => {
  assert.equal(bandFor(0), "poor");
  assert.equal(bandFor(39), "poor");
});

/* ─────────────────────────── slug-hint coverage ──────────────────────── */

test("SLUG_HINTS covers every Dec2025 developer name", async () => {
  const csv = await fs.readFile(FIXTURE, "utf-8");
  const { developers } = parseScoresCsv(csv);
  for (const d of developers) {
    assert.ok(SLUG_HINTS[d.name], `Missing slugHint for "${d.name}"`);
  }
});

test("SLUG_HINTS canonical entries route to TruNorth slugs", () => {
  assert.equal(SLUG_HINTS["Meta"], "meta-facebook");
  assert.equal(SLUG_HINTS["Google"], "google-alphabet");
  assert.equal(SLUG_HINTS["OpenAI"], "openai");
  assert.equal(SLUG_HINTS["Anthropic"], "anthropic");
});

/* ────────────────────────────── rounds catalog ───────────────────────── */

test("ROUNDS has the 3 known rounds ordered newest-first", () => {
  assert.equal(ROUNDS[0].label, "Dec2025");
  assert.equal(ROUNDS[ROUNDS.length - 1].label, "October2023");
  assert.ok(ROUNDS.every(r => r.csvUrl.startsWith("https://")));
});

/* ─────────────────────────── merger routing ──────────────────────────── */

test("slugify handles AI lab names with spaces / apostrophes", () => {
  assert.equal(slugify("AI21 Labs"), "ai21-labs");
  assert.equal(slugify("Hugging Face"), "hugging-face");
});

test("resolveBrand: slugHint wins when known", () => {
  const r = resolveBrand(
    { name: "OpenAI", slugHint: "openai" },
    { knownSlugs: new Set(["openai"]), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, "openai");
  assert.equal(r.routedVia, "slugHint");
});

test("resolveBrand: parent fallback when slugHint missing", () => {
  // Stability AI not in our index but mapped to a parent via brand-parent-map.
  // The slugified name "stability-ai" matches the parents map directly, so
  // resolveBrand routes via "parent" (the slugHint-parent branch only fires
  // when slugifyHint differs from slugify(name) — both equal here).
  const r = resolveBrand(
    { name: "Stability AI", slugHint: "stability-ai" },
    {
      knownSlugs: new Set(["coatue-management"]),
      aliases: {},
      parents: { "stability-ai": { parent: "coatue-management" } },
    },
  );
  assert.equal(r.slug, "coatue-management");
  assert.equal(r.routedVia, "parent");
});

test("resolveBrand: slugHint-parent fires when name slug ≠ hint", () => {
  // "Hugging Face" slugifies to "hugging-face" but our hint routes to the
  // canonical "hugging-face-sas"; if that hint isn't in knownSlugs but is
  // in parents, the slugHint-parent route should activate.
  const r = resolveBrand(
    { name: "Hugging Face", slugHint: "hugging-face-sas" },
    {
      knownSlugs: new Set(["amazon"]),
      aliases: {},
      parents: { "hugging-face-sas": { parent: "amazon" } },
    },
  );
  assert.equal(r.slug, "amazon");
  assert.equal(r.routedVia, "slugHint-parent");
});

test("resolveBrand: orphan when nothing matches", () => {
  const r = resolveBrand(
    { name: "Nowhere Labs", slugHint: "nowhere" },
    { knownSlugs: new Set(), aliases: {}, parents: {} },
  );
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});
