#!/usr/bin/env node
/**
 * Test harness for the Discovery-Pass 2026-06-09 batch:
 *   - hrc-cei
 *   - cdp-climate
 *   - ncrc-cra
 *   - glaad-sri
 *   - mind-share-partners
 *
 * Verifies that each merger's resolveSlug() correctly routes real-world
 * sample names to TruNorth index slugs using the offline fixtures and a
 * synthetic index slug-set (so the test runs without depending on
 * public/data/index.json being present).
 *
 * Run via:  node --test scripts/discovery-pass-2026-06-09.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSlug as hrcResolve } from "./hrc-cei-merge.mjs";
import { resolveSlug as cdpResolve } from "./cdp-climate-merge.mjs";
import { resolveSlug as ncrcResolve } from "./ncrc-cra-merge.mjs";
import { resolveSlug as glaadResolve } from "./glaad-sri-merge.mjs";
import { resolveSlug as mspResolve } from "./mind-share-partners-merge.mjs";

const INDEX = new Set([
  "apple","walmart","tesla","patagonia","pfizer","disney","netflix",
  "google-alphabet","amazon","microsoft","meta-platforms","ibm","intel",
  "cisco","salesforce","atandt","verizon","walgreens","ups","spotify",
  "costco","capital-one","levi-strauss","jpmorgan-chase","wells-fargo",
  "citigroup","goldman-sachs","morgan-stanley","bank-of-america",
  "truist-financial","pnc-financial","first-us-bancshares",
  "huntington-bancshares-inc","keycorp","silicon-valley-bank","regions-financial",
  "warner-bros-discovery","paramount","comcast","nbcuniversal",
  "fox-corporation","sony-pictures-entertainment","kellogg-s","hershey",
  "exxonmobil","ey","pwc","deloitte","kpmg","ally-financial",
]);

const PARENT_MAP = {};

// ─── HRC ─────────────────────────────────────────────────────────────────
test("hrc-cei: maps top-100 brands to index slugs", () => {
  assert.equal(hrcResolve("Apple Inc.", INDEX, PARENT_MAP).slug, "apple");
  assert.equal(hrcResolve("Alphabet Inc.", INDEX, PARENT_MAP).slug, "google-alphabet");
  assert.equal(hrcResolve("Wells Fargo & Company", INDEX, PARENT_MAP).slug, "wells-fargo");
  assert.equal(hrcResolve("Verizon Communications Inc.", INDEX, PARENT_MAP).slug, "verizon");
  assert.equal(hrcResolve("Walgreens Boots Alliance, Inc.", INDEX, PARENT_MAP).slug, "walgreens");
  assert.equal(hrcResolve("Spotify Technology S.A.", INDEX, PARENT_MAP).slug, "spotify");
});

test("hrc-cei: returns orphan for unknown brands", () => {
  const r = hrcResolve("Made-Up Holdings Ltd", INDEX, PARENT_MAP);
  assert.equal(r.slug, null);
  assert.equal(r.via, "orphan");
});

// ─── CDP ─────────────────────────────────────────────────────────────────
test("cdp-climate: maps fossil & tech brands", () => {
  assert.equal(cdpResolve("ExxonMobil Corporation", INDEX, PARENT_MAP).slug, "exxonmobil");
  assert.equal(cdpResolve("Microsoft Corporation", INDEX, PARENT_MAP).slug, "microsoft");
  assert.equal(cdpResolve("Tesla, Inc.", INDEX, PARENT_MAP).slug, "tesla");
});

// ─── NCRC CRA ────────────────────────────────────────────────────────────
test("ncrc-cra: maps bank entities to parent slugs", () => {
  assert.equal(ncrcResolve("Bank of America, N.A.", INDEX).slug, "bank-of-america");
  assert.equal(ncrcResolve("JPMorgan Chase Bank, N.A.", INDEX).slug, "jpmorgan-chase");
  assert.equal(ncrcResolve("Wells Fargo Bank, N.A.", INDEX).slug, "wells-fargo");
  assert.equal(ncrcResolve("Silicon Valley Bank", INDEX).slug, "silicon-valley-bank");
  assert.equal(ncrcResolve("Truist Bank", INDEX).slug, "truist-financial");
});

test("ncrc-cra: returns orphan when parent not in index", () => {
  const r = ncrcResolve("TD Bank, N.A.", INDEX);
  assert.equal(r.slug, null);
});

// ─── GLAAD ───────────────────────────────────────────────────────────────
test("glaad-sri: maps studios to parent slugs via alias", () => {
  assert.equal(glaadResolve("The Walt Disney Company", INDEX).slug, "disney");
  assert.equal(glaadResolve("Warner Bros. Discovery", INDEX).slug, "warner-bros-discovery");
  assert.equal(glaadResolve("Paramount Global", INDEX).slug, "paramount");
  assert.equal(glaadResolve("Netflix, Inc.", INDEX).slug, "netflix");
  assert.equal(glaadResolve("Comcast Corporation", INDEX).slug, "comcast");
});

// ─── Mind Share Partners ─────────────────────────────────────────────────
test("mind-share-partners: maps signatories with corporate suffixes", () => {
  assert.equal(mspResolve("The Walt Disney Company", INDEX).slug, "disney");
  assert.equal(mspResolve("AT&T Inc.", INDEX).slug, "atandt");
  assert.equal(mspResolve("Capital One Financial Corp.", INDEX).slug, "capital-one");
  assert.equal(mspResolve("Verizon Communications Inc.", INDEX).slug, "verizon");
  assert.equal(mspResolve("Kellogg Company", INDEX).slug, "kellogg-s");
  assert.equal(mspResolve("PwC (PricewaterhouseCoopers)", INDEX).slug, "pwc");
});
