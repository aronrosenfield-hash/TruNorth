#!/usr/bin/env node
/**
 * node --test scripts/tco-certified-fetch.test.mjs
 *
 * Exercises tco-certified-fetch.mjs (normalizer + snapshot builder) and
 * tco-certified-merge.mjs (slug resolver + aggregator) against the
 * bundled fixture. Zero network calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeProduct,
  parseCertDate,
  buildSnapshot,
  SOURCE_URL,
} from "./tco-certified-fetch.mjs";

import {
  slugify,
  resolveBrand,
  aggregateBySlug,
  TECH_BRAND_ALIASES,
} from "./tco-certified-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/tco-certified/sample.json");

// ─── parseCertDate ────────────────────────────────────────────────────────
test("parseCertDate — ISO passthrough", () => {
  assert.equal(parseCertDate("2024-04-12"), "2024-04-12");
});

test("parseCertDate — EU dd/mm/yyyy", () => {
  assert.equal(parseCertDate("12/04/2024"), "2024-04-12");
  assert.equal(parseCertDate("01-09-2025"), "2025-09-01");
});

test("parseCertDate — long English forms", () => {
  assert.equal(parseCertDate("April 12, 2024"), "2024-04-12");
  assert.equal(parseCertDate("12 April 2024"), "2024-04-12");
});

test("parseCertDate — year-only string + integer", () => {
  assert.equal(parseCertDate("2024"), "2024-01-01");
  assert.equal(parseCertDate(2024), "2024-01-01");
});

test("parseCertDate — empty / null / garbage", () => {
  assert.equal(parseCertDate(""), "");
  assert.equal(parseCertDate(null), "");
  assert.equal(parseCertDate("not a date"), "");
});

// ─── normalizeProduct ─────────────────────────────────────────────────────
test("normalizeProduct — fixture row preserves the fields the merger needs", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const p = normalizeProduct(seed.products[0]);
  assert.equal(p.product_name, "MacBook Air 13-inch (M3)");
  assert.equal(p.brand_name, "Apple");
  assert.equal(p.model_number, "MRXN3LL/A");
  assert.equal(p.category, "Notebooks");
  assert.equal(p.certification_date, "2024-04-12");
  assert.match(p.certificate_url, /tcocertified\.com/);
});

test("normalizeProduct — accepts alias keys (brand vs brand_name)", () => {
  const p = normalizeProduct({
    product: "Test Display",
    brand: "Apple",
    model: "MX001",
    type: "Displays",
    cert_level: "TCO Certified, generation 9",
    cert_date: "2024-04-12",
    url: "https://example.com/",
  });
  assert.equal(p.product_name, "Test Display");
  assert.equal(p.brand_name, "Apple");
  assert.equal(p.model_number, "MX001");
  assert.equal(p.category, "Displays");
  assert.equal(p.certification_level, "TCO Certified, generation 9");
  assert.equal(p.certification_date, "2024-04-12");
});

test("normalizeProduct — empty / non-object → null", () => {
  assert.equal(normalizeProduct(null), null);
  assert.equal(normalizeProduct({}), null);
});

// ─── buildSnapshot ────────────────────────────────────────────────────────
test("buildSnapshot — wraps products with license + source + count", () => {
  const snap = buildSnapshot([{ brand_name: "Apple" }], { snapshotDate: "2026-06-08" });
  assert.equal(snap._product_count, 1);
  assert.equal(snap._snapshot_date, "2026-06-08");
  assert.equal(snap._source, SOURCE_URL);
  assert.equal(snap.products.length, 1);
});

// ─── slugify ──────────────────────────────────────────────────────────────
test("slugify — basics", () => {
  assert.equal(slugify("Apple"), "apple");
  assert.equal(slugify("Samsung Electronics"), "samsung-electronics");
  assert.equal(slugify("LG Electronics, Inc."), "lg-electronics-inc");
  assert.equal(slugify("HP"), "hp");
});

// ─── resolveBrand ─────────────────────────────────────────────────────────
test("resolveBrand — direct match", () => {
  const idx = new Set(["apple", "dell", "hp", "lenovo", "microsoft", "acer"]);
  assert.deepEqual(resolveBrand("Apple", idx, {}),
                   { slug: "apple", routedVia: "direct" });
  assert.deepEqual(resolveBrand("Dell", idx, {}),
                   { slug: "dell", routedVia: "direct" });
});

test("resolveBrand — TECH alias for Samsung Electronics → samsung-usa", () => {
  const idx = new Set(["samsung-usa"]);
  assert.deepEqual(resolveBrand("Samsung Electronics", idx, {}),
                   { slug: "samsung-usa", routedVia: "alias" });
});

test("resolveBrand — TECH alias for LG Electronics → lg-usa", () => {
  const idx = new Set(["lg-usa"]);
  assert.deepEqual(resolveBrand("LG Electronics", idx, {}),
                   { slug: "lg-usa", routedVia: "alias" });
});

test("resolveBrand — brand-parent-map fallback", () => {
  const idx = new Set(["apple"]);
  const pm = { "beats": { parent: "apple" } };
  assert.deepEqual(resolveBrand("Beats", idx, pm),
                   { slug: "apple", routedVia: "brand-parent" });
});

test("resolveBrand — unknown → orphan", () => {
  assert.deepEqual(resolveBrand("Some Random IT Brand", new Set(["unrelated"]), {}),
                   { slug: null, routedVia: "orphan" });
});

test("resolveBrand — empty input → orphan", () => {
  assert.deepEqual(resolveBrand("", new Set(), {}),
                   { slug: null, routedVia: "orphan" });
});

// ─── aggregateBySlug (full fixture, end-to-end) ───────────────────────────
test("aggregateBySlug — fixture produces the brief's shape", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const products = seed.products.map(normalizeProduct).filter(Boolean);

  const indexSlugs = new Set([
    "apple", "dell", "hp", "lenovo", "microsoft", "acer",
    "samsung-usa", "lg-usa", "sony-usa", "panasonic-usa",
  ]);
  const { bySlug, orphans, routedViaCounts } = aggregateBySlug(products, { indexSlugs, parentMap: {} });

  // Every fixture brand should match one of our slugs (no orphans)
  assert.equal(orphans.length, 0, `expected 0 orphans, got: ${JSON.stringify(orphans)}`);

  // Apple has 3 fixture products (notebook, AIO, display)
  assert.ok(bySlug["apple"], "apple slug present");
  assert.equal(bySlug["apple"].environment.tcoCertifiedCount, 3);
  assert.equal(bySlug["apple"].environment.latestCertYear, 2024);
  assert.deepEqual(
    bySlug["apple"].environment.productCategories,
    ["All-in-One PCs", "Displays", "Notebooks"]
  );
  assert.equal(bySlug["apple"].environment.sourceUrl,
               "https://tcocertified.com/product-finder/");

  // Samsung Electronics → samsung-usa (alias-routed), 3 fixture products
  assert.ok(bySlug["samsung-usa"], "samsung-usa slug present (via alias)");
  assert.equal(bySlug["samsung-usa"].environment.tcoCertifiedCount, 3);

  // Dell has 4 fixture products spanning notebook/desktop/display/datacenter
  assert.equal(bySlug["dell"].environment.tcoCertifiedCount, 4);
  assert.equal(bySlug["dell"].environment.productCategories.length, 4);

  // Routing counts should agree with the totals.
  const totalRouted = routedViaCounts.direct + routedViaCounts.alias
                    + routedViaCounts["brand-parent"] + routedViaCounts.orphan;
  assert.equal(totalRouted, products.length);
  assert.ok(routedViaCounts.direct >= 1, "at least one direct match (Apple)");
  assert.ok(routedViaCounts.alias  >= 1, "at least one alias match (Samsung)");
});

test("TECH_BRAND_ALIASES — covers the documented top-tier IT brands", () => {
  // Sanity: alias map values should resolve to slugs that *can* exist in
  // our index. We don't actually check the index here (that's the
  // resolver's job), only that the map isn't accidentally typo'd into
  // unreachable garbage.
  for (const [k, v] of Object.entries(TECH_BRAND_ALIASES)) {
    assert.ok(typeof k === "string" && k.length > 0, `bad alias key ${k}`);
    assert.ok(typeof v === "string" && v.length > 0, `bad alias value for ${k}`);
    assert.equal(slugify(v), v, `alias value '${v}' for '${k}' must already be slug-form`);
  }
});
