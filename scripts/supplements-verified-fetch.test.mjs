#!/usr/bin/env node
/**
 * Tests for supplements-verified-fetch.mjs + supplements-verified-merge.mjs.
 *
 * Uses scripts/fixtures/supplements-verified/*.html — hand-built pages
 * that mirror the live NSF Sport / NSF 173 / USP markup. NO network
 * calls.
 *
 * Run: node --test scripts/supplements-verified-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseNsfSport,
  parseNsf173,
  parseUsp,
  buildUspFallback,
  USP_VERIFIED_BRAND_FALLBACK,
} from "./supplements-verified-fetch.mjs";

import {
  slugify,
  nameVariants,
  resolveBrand,
  SUPPLEMENT_ALIASES,
} from "./supplements-verified-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/supplements-verified");

// ─── parseNsfSport ────────────────────────────────────────────────────────
test("parseNsfSport — extracts product/brand pairs and dedupes", async () => {
  const html = await fs.readFile(path.join(FIX, "nsf-sport-sample.html"), "utf-8");
  const entries = parseNsfSport(html);
  // 5 distinct (brand, product); the duplicate Abbott row is deduped.
  assert.equal(entries.length, 5, "5 unique product/brand pairs");
  for (const e of entries) {
    assert.equal(e.certType, "NSF Sport");
    assert.ok(e.brand && e.product, "brand+product present");
    assert.equal(e.sourceUrl, "https://www.nsfsport.com/certified-products/search-results.php");
  }
  const abbott = entries.find(e => e.brand === "Abbott");
  assert.ok(abbott, "Abbott present");
  assert.equal(abbott.product, "Ensure Plus");
  const thorne = entries.find(e => /Thorne/.test(e.brand));
  assert.ok(thorne, "Thorne entry present (trademark glyph preserved)");
});

// ─── parseNsf173 ──────────────────────────────────────────────────────────
test("parseNsf173 — extracts company + trade designations, skips section headers", async () => {
  const html = await fs.readFile(path.join(FIX, "nsf-173-sample.html"), "utf-8");
  const entries = parseNsf173(html);
  // 2 companies × 2 products = 4 entries; the "Dietary Supplements"
  // section heading must NOT become a company.
  assert.equal(entries.length, 4, "4 finished products");
  for (const e of entries) {
    assert.equal(e.certType, "NSF 173");
    assert.notEqual(e.brand, "Dietary Supplements", "section heading not promoted to a company");
  }
  const abbott = entries.find(e => e.brand === "Abbott Laboratories Nutrition" && e.product === "Ensure Original Vanilla");
  assert.ok(abbott, "Abbott Ensure parsed");
  const pure = entries.find(e => e.brand === "Pure Encapsulations LLC" && e.product === "Vitamin D3 1000 IU");
  assert.ok(pure, "Pure Encapsulations Vitamin D parsed");
});

// ─── parseUsp ─────────────────────────────────────────────────────────────
test("parseUsp — extracts participant brand names when present", async () => {
  const html = await fs.readFile(path.join(FIX, "usp-sample.html"), "utf-8");
  const entries = parseUsp(html);
  assert.ok(entries.length >= 4, `expected >=4 USP brands, got ${entries.length}`);
  const names = new Set(entries.map(e => e.brand));
  assert.ok(names.has("Nature Made"));
  assert.ok(names.has("Kirkland Signature"));
});

test("parseUsp — returns [] on Akamai 'Access Denied' page", () => {
  const blocked = "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>";
  assert.deepEqual(parseUsp(blocked), []);
});

test("buildUspFallback — returns one entry per fallback brand, all USP Verified", () => {
  const entries = buildUspFallback();
  assert.equal(entries.length, USP_VERIFIED_BRAND_FALLBACK.length);
  for (const e of entries) {
    assert.equal(e.certType, "USP Verified");
    assert.equal(e._via, "fallback");
    assert.ok(e.brand);
  }
});

// ─── slugify ──────────────────────────────────────────────────────────────
test("slugify — basics + TruNorth convention", () => {
  assert.equal(slugify("Optimum Nutrition"), "optimum-nutrition");
  assert.equal(slugify("Thorne®"), "thorne");
  assert.equal(slugify("Nature's Bounty"), "natures-bounty");
  assert.equal(slugify("Garden of Life, LLC"), "garden-of-life-llc");
});

// ─── nameVariants ─────────────────────────────────────────────────────────
test("nameVariants — strips trailing legal suffixes progressively", () => {
  const v = nameVariants("Pure Encapsulations LLC");
  assert.ok(v.includes("Pure Encapsulations LLC"));
  assert.ok(v.some(x => x === "Pure Encapsulations"),
            `expected 'Pure Encapsulations' in ${JSON.stringify(v)}`);
});

test("nameVariants — peels supplement-flavoured suffixes", () => {
  const v = nameVariants("21st Century HealthCare, Inc.");
  // After NFKD normalisation + suffix stripping, should expose the core.
  assert.ok(v.some(x => /21st Century/.test(x)),
            `expected '21st Century' in ${JSON.stringify(v)}`);
});

test("nameVariants — drops parenthetical and trademark glyphs", () => {
  const v = nameVariants("AG1 (USA) Inc.");
  assert.ok(v.includes("AG1"), `expected 'AG1' in ${JSON.stringify(v)}`);
});

// ─── resolveBrand ─────────────────────────────────────────────────────────
test("resolveBrand — direct slug match wins", () => {
  const idx = new Set(["abbott-laboratories", "herbalife"]);
  const r = resolveBrand("Herbalife", idx, {});
  assert.equal(r.slug, "herbalife");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand — Optimum Nutrition → glanbia via supplement-alias", () => {
  const idx = new Set(["glanbia"]);
  const r = resolveBrand("Optimum Nutrition", idx, {});
  assert.equal(r.slug, "glanbia");
  assert.equal(r.routedVia, "supplement-alias");
});

test("resolveBrand — Garden of Life → nestle via supplement-alias", () => {
  const idx = new Set(["nestle"]);
  const r = resolveBrand("Garden of Life", idx, {});
  assert.equal(r.slug, "nestle");
  assert.equal(r.routedVia, "supplement-alias");
});

test("resolveBrand — Kirkland Signature → costco-wholesale", () => {
  const idx = new Set(["costco-wholesale"]);
  const r = resolveBrand("Kirkland Signature", idx, {});
  assert.equal(r.slug, "costco-wholesale");
});

test("resolveBrand — unknown brand becomes orphan", () => {
  const r = resolveBrand("Boutique Sport Co.", new Set(["herbalife"]), {});
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("resolveBrand — falls back to brand-parent-map", () => {
  const idx = new Set(["procter-and-gamble"]);
  const pm = { "newchapter": { parent: "procter-and-gamble" } };
  const r = resolveBrand("NewChapter", idx, pm);
  assert.equal(r.slug, "procter-and-gamble");
  assert.equal(r.routedVia, "brand-parent");
});

// ─── SUPPLEMENT_ALIASES sanity ────────────────────────────────────────────
test("SUPPLEMENT_ALIASES — every key slugifies to itself (canonical form)", () => {
  for (const key of Object.keys(SUPPLEMENT_ALIASES)) {
    // Keys should be lower-case, hyphen-separated — already in slug form.
    assert.equal(slugify(key.replace(/-/g, " ")), key,
                 `alias key '${key}' is not in slug form`);
  }
});
