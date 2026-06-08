#!/usr/bin/env node
/**
 * Tests for scripts/lib/egregious-rotation.mjs + the JSON source of truth.
 *
 * Pinned-date snapshots verify:
 *   - Rotation works with 30 facts at rotationDays=1.
 *   - 2026-06-08 (today, when shipped) → fact index 15.
 *   - 2026-06-23 (PH launch day) → fact index 0 = Home Depot.
 *   - 2026-07-23 (one full cycle later) → fact index 0 again.
 *   - getCurrentEgregious is pure (same date → same fact).
 *
 * No network. Run via: node --test scripts/egregious-rotation.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getCurrentEgregious } from "./lib/egregious-rotation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACTS_JSON = path.resolve(HERE, "../public/data/_meta/egregious-facts.json");
const LOGO_CLASS_JSON = path.resolve(HERE, "../public/data/_meta/egregious-logo-classification.json");

async function loadFacts() {
  const raw = JSON.parse(await fs.readFile(FACTS_JSON, "utf8"));
  return raw;
}

async function loadLogoClass() {
  return JSON.parse(await fs.readFile(LOGO_CLASS_JSON, "utf8"));
}

test("egregious-facts.json has 30 entries with required fields", async () => {
  const raw = await loadFacts();
  assert.equal(raw.facts.length, 30, "expected exactly 30 facts");
  assert.equal(raw.rotationDays, 1, "rotationDays should be 1 (daily)");
  assert.equal(raw.epoch, "1970-01-18", "epoch should be 1970-01-18 (chosen to land Home Depot on Jun 23 2026)");

  for (const f of raw.facts) {
    assert.ok(f.id, `fact missing id`);
    assert.ok(f.brandSlug, `${f.id} missing brandSlug`);
    assert.ok(f.brandName, `${f.id} missing brandName`);
    assert.ok(f.statNumber, `${f.id} missing statNumber`);
    assert.ok(f.statKicker, `${f.id} missing statKicker`);
    assert.ok(f.source, `${f.id} missing source`);
    assert.ok(f.sourceUrl, `${f.id} missing sourceUrl`);
    assert.ok(["positive", "negative"].includes(f.polarity), `${f.id} polarity must be positive|negative`);
    assert.ok(f.brandLogoUrl === null || typeof f.brandLogoUrl === "string", `${f.id} brandLogoUrl must be string|null`);
  }
});

test("Home Depot is at index 0", async () => {
  const raw = await loadFacts();
  assert.equal(raw.facts[0].brandSlug, "home-depot");
});

test("Jun 23 2026 (PH launch day) lands on Home Depot", async () => {
  const raw = await loadFacts();
  const { fact, index } = getCurrentEgregious({
    facts: raw.facts,
    rotationDays: raw.rotationDays,
    epoch: raw.epoch,
    date: new Date("2026-06-23T12:00:00Z"),
  });
  assert.equal(index, 0, "Jun 23 2026 must land on the first fact (Home Depot)");
  assert.equal(fact.brandSlug, "home-depot");
});

test("Jul 23 2026 (one full cycle later) lands on Home Depot again", async () => {
  const raw = await loadFacts();
  const { index, fact } = getCurrentEgregious({
    facts: raw.facts,
    rotationDays: raw.rotationDays,
    epoch: raw.epoch,
    date: new Date("2026-07-23T12:00:00Z"),
  });
  assert.equal(index, 0);
  assert.equal(fact.brandSlug, "home-depot");
});

test("Jun 24 2026 advances to Amazon (index 1)", async () => {
  const raw = await loadFacts();
  const { index, fact } = getCurrentEgregious({
    facts: raw.facts,
    rotationDays: raw.rotationDays,
    epoch: raw.epoch,
    date: new Date("2026-06-24T12:00:00Z"),
  });
  assert.equal(index, 1);
  assert.equal(fact.brandSlug, "amazon");
});

test("rotation is deterministic — same date always yields same fact", async () => {
  const raw = await loadFacts();
  const d = new Date("2026-06-08T00:00:00Z");
  const a = getCurrentEgregious({ facts: raw.facts, rotationDays: raw.rotationDays, epoch: raw.epoch, date: d });
  const b = getCurrentEgregious({ facts: raw.facts, rotationDays: raw.rotationDays, epoch: raw.epoch, date: d });
  assert.equal(a.index, b.index);
  assert.equal(a.fact.id, b.fact.id);
});

test("rotation cycles through all 30 brands in 30 days", async () => {
  const raw = await loadFacts();
  const seen = new Set();
  // Start on Jun 23 (index 0) and walk forward 30 days.
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.UTC(2026, 5, 23 + i));
    const { fact } = getCurrentEgregious({
      facts: raw.facts,
      rotationDays: raw.rotationDays,
      epoch: raw.epoch,
      date,
    });
    seen.add(fact.brandSlug);
  }
  assert.equal(seen.size, 30, "rotation should visit all 30 brands within 30 days");
});

test("polarity distribution: 20 negative, 10 positive", async () => {
  const raw = await loadFacts();
  const neg = raw.facts.filter(f => f.polarity === "negative").length;
  const pos = raw.facts.filter(f => f.polarity === "positive").length;
  assert.equal(neg, 20);
  assert.equal(pos, 10);
});

// --- Logo-classification map ---------------------------------------------

test("egregious-logo-classification.json covers all 30 brands", async () => {
  const raw = await loadFacts();
  const cls = await loadLogoClass();
  assert.ok(cls.brands, "classification file must have a 'brands' object");
  for (const f of raw.facts) {
    assert.equal(
      typeof cls.brands[f.brandSlug], "boolean",
      `classification missing or non-boolean for ${f.brandSlug}`
    );
  }
});

test("ExxonMobil is classified as wordmark (hasTextInLogo=true)", async () => {
  // Renderer should omit the redundant 'Exxon Mobil' text label and
  // enlarge the logo to occupy the brand-identity area.
  const cls = await loadLogoClass();
  assert.equal(cls.brands["exxon-mobil"], true);
});

test("Mark-only brands keep their text label (hasTextInLogo=false)", async () => {
  // Mark-only logos contain no readable brand name on their own, so the
  // text label must remain. Starbucks (siren) and Audi (four rings) are
  // the canonical mark-only set after Aron's 2026-06-08 PM review flipped
  // home-depot/amazon/chipotle/acura-usa/ben-and-jerry-s to wordmark
  // (their cached PNGs contain the brand name even though the canonical
  // brand identity is mark-first).
  const cls = await loadLogoClass();
  for (const slug of ["starbucks", "audi-usa", "google-alphabet"]) {
    assert.equal(cls.brands[slug], false, `${slug} should be classified as mark-only`);
  }
});
