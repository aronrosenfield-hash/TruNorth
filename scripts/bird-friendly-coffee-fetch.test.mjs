#!/usr/bin/env node
/**
 * Tests for the Bird Friendly Coffee pipeline (DW-59).
 *
 *   node --test scripts/bird-friendly-coffee-fetch.test.mjs
 *
 * Uses scripts/fixtures/bird-friendly-coffee/sample.html (6 roaster
 * cards across two template variants). No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseRoastersHtml,
  parseCertYear,
  extractWebsite,
  decodeEntities,
  stripTags,
  SOURCE_URL,
} from "./bird-friendly-coffee-fetch.mjs";

import {
  slugify,
  stripCoffeeSuffix,
  resolveBrand,
} from "./bird-friendly-coffee-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/bird-friendly-coffee/sample.html");
const loadFixture = () => fs.readFile(FIXTURE, "utf-8");

// ─── primitives ───────────────────────────────────────────────────────────
test("decodeEntities + stripTags", () => {
  assert.equal(decodeEntities("Birds &amp; Beans"), "Birds & Beans");
  assert.equal(stripTags("<p>  hello  </p>"), "hello");
});

test("parseCertYear: typical phrasings", () => {
  assert.equal(parseCertYear("Certified 2005"), 2005);
  assert.equal(parseCertYear("Certified since 2010"), 2010);
  assert.equal(parseCertYear("cert. year 2018"), 2018);
  assert.equal(parseCertYear("Founded in 1999"), 1999); // bare-year fallback
  assert.equal(parseCertYear(null), null);
});

test("extractWebsite: skips Smithsonian self-links", () => {
  assert.equal(
    extractWebsite('Visit <a href="https://nationalzoo.si.edu/about">us</a>'),
    null
  );
  assert.equal(
    extractWebsite('<a href="https://www.birdsandbeans.com">link</a>'),
    "https://www.birdsandbeans.com"
  );
});

// ─── parser ───────────────────────────────────────────────────────────────
test("parseRoastersHtml: 6 roasters across both variants", async () => {
  const items = parseRoastersHtml(await loadFixture());
  assert.equal(items.length, 6, `expected 6, got ${items.length}`);
});

test("parseRoastersHtml: Birds & Beans (entity-decoded, country, cert year)", async () => {
  const items = parseRoastersHtml(await loadFixture());
  const bb = items.find(r => /birds.*beans/i.test(r.brand));
  assert.ok(bb, "Birds & Beans present");
  assert.equal(bb.brand, "Birds & Beans");
  assert.equal(bb.country, "USA");
  assert.equal(bb.certYear, 2005);
  assert.equal(bb.website, "https://www.birdsandbeans.com");
  assert.equal(bb.sourceUrl, SOURCE_URL);
});

test("parseRoastersHtml: bf-brand variant (Equal Exchange w/ region)", async () => {
  const items = parseRoastersHtml(await loadFixture());
  const ee = items.find(r => r.brand === "Equal Exchange");
  assert.ok(ee, "Equal Exchange present");
  assert.equal(ee.region, "USA / New England");
  assert.equal(ee.certYear, 2008);
});

test("parseRoastersHtml: Peet's apostrophe survives", async () => {
  const items = parseRoastersHtml(await loadFixture());
  const peets = items.find(r => /peet/i.test(r.brand));
  assert.ok(peets, "Peet's present");
  assert.equal(peets.brand, "Peet's Coffee");
  assert.equal(peets.certYear, 2020);
});

// ─── merge helpers ────────────────────────────────────────────────────────
test("slugify handles apostrophes + ampersand", () => {
  assert.equal(slugify("Peet's Coffee"), "peets-coffee");
  assert.equal(slugify("Birds & Beans"), "birds-and-beans");
  assert.equal(slugify("Counter Culture Coffee"), "counter-culture-coffee");
});

test("stripCoffeeSuffix removes 'Coffee Roasters' etc.", () => {
  assert.equal(stripCoffeeSuffix("Stumptown Coffee Roasters"), "Stumptown");
  assert.equal(stripCoffeeSuffix("Allegro Coffee"), "Allegro");
  assert.equal(stripCoffeeSuffix("Counter Culture Coffee"), "Counter Culture");
  assert.equal(stripCoffeeSuffix("Equal Exchange"), "Equal Exchange");
});

// ─── end-to-end resolution ────────────────────────────────────────────────
test("resolveBrand: direct hit on full slugified brand", () => {
  const ctx = { knownSlugs: new Set(["counter-culture-coffee"]), aliases: {}, parents: {} };
  const r = resolveBrand("Counter Culture Coffee", ctx);
  assert.equal(r.slug, "counter-culture-coffee");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: direct hit on stripped variant ('Allegro Coffee' → 'allegro')", () => {
  const ctx = { knownSlugs: new Set(["allegro"]), aliases: {}, parents: {} };
  const r = resolveBrand("Allegro Coffee", ctx);
  assert.equal(r.slug, "allegro");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: parent fallback (Peet's → JAB)", () => {
  const ctx = {
    knownSlugs: new Set(["jab-holding"]),
    aliases: {},
    parents: { "peets-coffee": { parent: "jab-holding" } },
  };
  const r = resolveBrand("Peet's Coffee", ctx);
  assert.equal(r.slug, "jab-holding");
  assert.equal(r.routedVia, "parent");
});

test("resolveBrand: orphan", () => {
  const ctx = { knownSlugs: new Set(["birds-and-beans"]), aliases: {}, parents: {} };
  const r = resolveBrand("Lost Songbird Roastery", ctx);
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("end-to-end: 6 fixture roasters route as expected", async () => {
  const items = parseRoastersHtml(await loadFixture());
  const ctx = {
    knownSlugs: new Set([
      "birds-and-beans", "allegro-coffee", "counter-culture-coffee",
      "equal-exchange", "peets-coffee",
    ]),
    aliases: {},
    parents: {},
  };
  const routes = { direct: 0, alias: 0, parent: 0, orphan: 0 };
  for (const r of items) routes[resolveBrand(r.brand, ctx).routedVia]++;
  assert.equal(routes.direct, 5, `direct=${routes.direct}`);
  assert.equal(routes.orphan, 1, `orphan=${routes.orphan}`);
});
