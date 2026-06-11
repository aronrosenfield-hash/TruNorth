#!/usr/bin/env node
/**
 * Tests for the Animal Welfare Approved (AWA) pipeline.
 *
 *   node --test scripts/awa-fetch.test.mjs
 *
 * Uses scripts/fixtures/awa/sample.html (7 farm cards across two template
 * variants spanning 6 product categories). No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseFarmsHtml,
  normalizeCategories,
  decodeEntities,
  stripTags,
  isAwaListing,
  isProducerListing,
  listingToFarm,
  dedupeFarms,
  SOURCE_URL,
} from "./awa-fetch.mjs";

import {
  slugify,
  stripFarmSuffix,
  resolveBrand,
} from "./awa-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/awa/sample.html");
const loadFixture = () => fs.readFile(FIXTURE, "utf-8");

// ─── primitives ───────────────────────────────────────────────────────────
test("decodeEntities + stripTags", () => {
  assert.equal(decodeEntities("Pete &amp; Gerry&#39;s"), "Pete & Gerry's");
  assert.equal(stripTags("<span>  X </span>"), "X");
});

test("normalizeCategories: comma + slash + alias normalisation", () => {
  assert.deepEqual(normalizeCategories("beef, eggs"), ["beef", "eggs"]);
  assert.deepEqual(normalizeCategories("Chicken/Eggs"), ["chicken", "eggs"]);
  assert.deepEqual(normalizeCategories("Milk and Cheese"), ["dairy", "cheese"]);
  assert.deepEqual(normalizeCategories("pig & lamb"), ["pork", "lamb"]);
  assert.deepEqual(normalizeCategories(""), []);
  assert.deepEqual(normalizeCategories(null), []);
});

test("normalizeCategories: dedupes & drops unknown tokens", () => {
  assert.deepEqual(normalizeCategories("beef, beef, eggs, unicorn"), ["beef", "eggs"]);
});

// ─── parser ───────────────────────────────────────────────────────────────
test("parseFarmsHtml: 7 farms across both variants", async () => {
  const items = parseFarmsHtml(await loadFixture());
  assert.equal(items.length, 7, `expected 7, got ${items.length}`);
});

test("parseFarmsHtml: farm-card with .product-categories block", async () => {
  const items = parseFarmsHtml(await loadFixture());
  const niman = items.find(f => f.brand === "Niman Ranch");
  assert.ok(niman, "Niman Ranch present");
  assert.equal(niman.state, "IA");
  assert.equal(niman.country, "USA");
  assert.deepEqual(niman.productCategories, ["beef", "pork", "lamb"]);
  assert.equal(niman.sourceUrl, SOURCE_URL);
});

test("parseFarmsHtml: awa-listing variant with inline 'Products:' line", async () => {
  const items = parseFarmsHtml(await loadFixture());
  const wop = items.find(f => f.brand === "White Oak Pastures");
  assert.ok(wop, "White Oak Pastures present");
  assert.deepEqual(wop.productCategories, ["beef", "poultry", "lamb", "pork"]);
});

test("parseFarmsHtml: entity-decoded apostrophe + ampersand", async () => {
  const items = parseFarmsHtml(await loadFixture());
  const pg = items.find(f => /pete/i.test(f.brand));
  assert.ok(pg, "Pete & Gerry's present");
  assert.equal(pg.brand, "Pete & Gerry's Organic Eggs");
  assert.deepEqual(pg.productCategories, ["eggs"]);
});

test("parseFarmsHtml: multi-category Applegate", async () => {
  const items = parseFarmsHtml(await loadFixture());
  const ap = items.find(f => f.brand === "Applegate");
  assert.deepEqual(ap.productCategories, ["beef", "pork", "poultry"]);
});

// ─── GeoDirectory API mapper (post-2026 site redesign) ────────────────────
const API_LISTING = {
  title: { raw: "Archway Farm" },
  region: "New Hampshire",
  country: "United States",
  post_category: [{ name: "Pork" }, { name: "Eggs" }],
  certification_type: { rendered: ["Animal Welfare"] },
  store_type: { rendered: ["Farm Stores"] },
  link: "https://agreenerworld.org/agw-listings/united-states/new-hampshire/keene/pork/archway-farm/",
};

test("isAwaListing: keeps Animal Welfare, drops other AGW certs", () => {
  assert.ok(isAwaListing(API_LISTING));
  assert.ok(isAwaListing({ certification_type: { rendered: ["Animal Welfare", "Grassfed"] } }));
  assert.ok(!isAwaListing({ certification_type: { rendered: ["Certified Regenerative by AGW"] } }));
  assert.ok(!isAwaListing({ certification_type: { rendered: ["Non-GMO"] } }));
  assert.ok(!isAwaListing({}));
});

test("isProducerListing: producer store types only (outlets carry, not hold, the cert)", () => {
  assert.ok(isProducerListing(API_LISTING));
  assert.ok(isProducerListing({ store_type: { rendered: ["CSAs"] } }));
  assert.ok(isProducerListing({ store_type: { rendered: ["Farm Stays & BnBs", "Online Shopping"] } }));
  assert.ok(!isProducerListing({ store_type: { rendered: ["Stores"] } }), "Kroger et al. excluded");
  assert.ok(!isProducerListing({ store_type: { rendered: ["Restaurants"] } }));
  assert.ok(!isProducerListing({ store_type: { rendered: ["Online Shopping"] } }), "marketplaces excluded");
  assert.ok(!isProducerListing({}));
});

test("listingToFarm maps API fields to the snapshot farm shape", () => {
  const f = listingToFarm(API_LISTING);
  assert.equal(f.brand, "Archway Farm");
  assert.equal(f.state, "New Hampshire");
  assert.equal(f.country, "United States");
  assert.deepEqual(f.productCategories, ["pork", "eggs"]);
  assert.deepEqual(f.storeTypes, ["Farm Stores"]);
  assert.match(f.sourceUrl, /agreenerworld\.org/);
  assert.equal(listingToFarm({ title: { raw: "" } }), null, "nameless listings dropped");
});

test("dedupeFarms collapses on brand + state", () => {
  const a = { brand: "Archway Farm", state: "NH" };
  const out = dedupeFarms([a, { ...a }, { brand: "Archway Farm", state: "VT" }]);
  assert.equal(out.length, 2);
});

// ─── merge helpers ────────────────────────────────────────────────────────
test("slugify handles apostrophes + ampersand + diacritics", () => {
  assert.equal(slugify("Pete & Gerry's"), "pete-and-gerrys");
  assert.equal(slugify("Niman Ranch"), "niman-ranch");
  assert.equal(slugify("White Oak Pastures"), "white-oak-pastures");
});

test("stripFarmSuffix strips Family Farm / Dairy / Ranch", () => {
  assert.equal(stripFarmSuffix("Bluebird Family Farm"), "Bluebird");
  assert.equal(stripFarmSuffix("Niman Ranch"), "Niman");
  assert.equal(stripFarmSuffix("Clover Sonoma Dairy"), "Clover Sonoma");
  assert.equal(stripFarmSuffix("Applegate"), "Applegate");
});

// ─── end-to-end resolution ────────────────────────────────────────────────
test("resolveBrand: direct hit (Niman Ranch)", () => {
  const ctx = { knownSlugs: new Set(["niman-ranch"]), aliases: {}, parents: {} };
  const r = resolveBrand("Niman Ranch", ctx);
  assert.equal(r.slug, "niman-ranch");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: stripped variant resolves when only short slug exists", () => {
  const ctx = { knownSlugs: new Set(["bluebird"]), aliases: {}, parents: {} };
  const r = resolveBrand("Bluebird Family Farm", ctx);
  assert.equal(r.slug, "bluebird");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: parent fallback (Niman Ranch → Perdue Farms)", () => {
  const ctx = {
    knownSlugs: new Set(["perdue-farms"]),
    aliases: {},
    parents: { "niman-ranch": { parent: "perdue-farms" } },
  };
  const r = resolveBrand("Niman Ranch", ctx);
  assert.equal(r.slug, "perdue-farms");
  assert.equal(r.routedVia, "parent");
});

test("resolveBrand: orphan", () => {
  const ctx = { knownSlugs: new Set(["niman-ranch"]), aliases: {}, parents: {} };
  const r = resolveBrand("Lost Hollow Farm", ctx);
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("end-to-end: 7 fixture farms route as expected", async () => {
  const items = parseFarmsHtml(await loadFixture());
  const ctx = {
    knownSlugs: new Set([
      "vital-farms", "niman-ranch", "applegate", "organic-valley",
      "white-oak-pastures", "pete-and-gerrys",
    ]),
    aliases: { "pete-and-gerrys-organic-eggs": "pete-and-gerrys" },
    parents: {},
  };
  const routes = { direct: 0, alias: 0, parent: 0, orphan: 0 };
  for (const f of items) routes[resolveBrand(f.brand, ctx).routedVia]++;
  // direct: vital-farms, niman-ranch, applegate, organic-valley, white-oak-pastures
  // alias: pete-and-gerrys-organic-eggs → pete-and-gerrys
  // orphan: Lost Hollow Farm
  assert.equal(routes.direct, 5, `direct=${routes.direct}`);
  assert.equal(routes.alias, 1, `alias=${routes.alias}`);
  assert.equal(routes.orphan, 1, `orphan=${routes.orphan}`);
});
