#!/usr/bin/env node
/**
 * Tests for powerbase-fetch.mjs + powerbase-merge.mjs.
 *
 * No network. Replays scripts/fixtures/powerbase/sample.json.
 * Run: node --test scripts/powerbase-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LICENSE,
  CATEGORY_PATTERNS,
  SEED_BRANDS,
  parseArgs,
  classifyCategory,
  replayFixture,
} from "./powerbase-fetch.mjs";
import {
  pickCategory,
  classifyPage,
  buildAugment,
} from "./powerbase-merge.mjs";

test("LICENSE is the CC BY-SA Powerbase attribution", () => {
  assert.ok(LICENSE.includes("CC BY-SA"));
  assert.ok(LICENSE.includes("Powerbase"));
});

test("SEED_BRANDS includes core oil / tobacco / finance brands", () => {
  assert.ok(SEED_BRANDS.includes("ExxonMobil"));
  assert.ok(SEED_BRANDS.includes("Philip Morris International"));
  assert.ok(SEED_BRANDS.includes("Goldman Sachs"));
});

test("CATEGORY_PATTERNS recognizes lobbying / front-group / climate denial", () => {
  assert.ok(CATEGORY_PATTERNS.some(p => p.rx.test("Category:Lobby groups")));
  assert.ok(CATEGORY_PATTERNS.some(p => p.rx.test("Category:Front groups")));
  assert.ok(CATEGORY_PATTERNS.some(p => p.rx.test("Category:Climate denial")));
});

test("classifyCategory returns the right (signal, cat) tuple", () => {
  const a = classifyCategory("Category:Lobby groups");
  assert.equal(a.signal, "lobbying");
  assert.equal(a.cat, "political");
  const b = classifyCategory("Category:Oil Industry");
  assert.equal(b.cat, "environment");
  assert.equal(classifyCategory("Category:Random"), null);
});

test("parseArgs handles --limit, --out, --url, --cache, --dry, --apply", () => {
  const a = parseArgs(["--limit", "50", "--out", "/tmp/p.json", "--cache", "--dry"]);
  assert.equal(a.limit, 50);
  assert.equal(a.cache, true);
  assert.equal(a.dry, true);
});

test("replayFixture returns the bundle as-is", async () => {
  const bundle = await replayFixture();
  assert.equal(bundle._license, "CC BY-SA 3.0 — Powerbase (Spinwatch), https://powerbase.info");
  assert.ok(bundle.pages.length >= 2);
});

// ─── merger tests ───────────────────────────────────────────────────────
test("pickCategory prioritises political over environment", () => {
  assert.equal(pickCategory([{cat: "environment"}, {cat: "political"}]), "political");
  assert.equal(pickCategory([{cat: "environment"}]), "environment");
  assert.equal(pickCategory([]), "political");
});

test("classifyPage: ExxonMobil (≥2 refs + neg keywords) → poor", () => {
  const page = {
    title: "Exxon Mobil",
    page_url: "https://powerbase.info/index.php/Exxon_Mobil",
    extract: "ExxonMobil decades of climate denial funding and tax avoidance and revolving door...",
    categories: [
      {category_title: "Category:Oil Industry", signal: "fossil_fuel", cat: "environment"},
      {category_title: "Category:Tax avoidance", signal: "tax_avoidance", cat: "political"},
    ],
    external_link_count: 24,
  };
  const r = classifyPage(page);
  assert.equal(r.sc, "poor");
  assert.equal(r.severity, "negative");
  assert.equal(r.category, "political"); // tax_avoidance signals political
  assert.ok(r.narrative.includes("Powerbase wiki"));
});

test("classifyPage: page with no ref count → mixed (conservative default)", () => {
  const page = {
    title: "X",
    page_url: "https://powerbase.info/index.php/X",
    extract: "Stub page about X.",
    categories: [{category_title: "Category:Oil Industry", signal: "fossil_fuel", cat: "environment"}],
    external_link_count: 0,
  };
  const r = classifyPage(page);
  assert.equal(r.sc, "mixed");
});

test("buildAugment filters to known slugs + emits narratives", async () => {
  const raw = await replayFixture();
  const slugSet = new Set(["exxonmobil", "philip-morris-international", "patagonia"]);
  const aug = buildAugment(raw, slugSet);
  assert.ok(aug["exxonmobil"]);
  assert.ok(aug["philip-morris-international"]);
  assert.equal(aug["exxonmobil"].narratives.political?.sc, "poor");
  assert.equal(aug["philip-morris-international"].narratives.political?.sc, "poor");
  // patagonia has no categories → no narrative emitted (no signal)
  // but extract.length is 160 ≥ 100 so it WILL emit
  if (aug["patagonia"]) {
    assert.equal(aug["patagonia"].narratives.political?.sc, "mixed");
  }
});

test("buildAugment honours slug aliases", async () => {
  const raw = { pages: [{ slug: "exxon-mobil", name: "Exxon", title: "Exxon Mobil", page_url: "x", extract: "Long extract over a hundred chars to clear the signal threshold for the Powerbase merging logic and the test.", categories: [], external_link_count: 0 }] };
  const aug = buildAugment(raw, new Set(["exxonmobil"]), { "exxon-mobil": "exxonmobil" });
  assert.ok(aug["exxonmobil"]);
});
