#!/usr/bin/env node
/**
 * node --test scripts/ewg-skin-deep-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeProduct, buildSnapshot } from "./ewg-skin-deep-fetch.mjs";
import { buildAliasIndex, matchBrand, rollUpByBrand, classify } from "./ewg-skin-deep-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/ewg-skin-deep/sample.json");

test("normalizeProduct clamps score to 1-10 and requires brand+product", () => {
  assert.equal(normalizeProduct(null), null);
  assert.equal(normalizeProduct({ product: "X", brand: "", score: 5 }), null);
  assert.equal(normalizeProduct({ product: "X", brand: "B" }), null);
  const p = normalizeProduct({ product: "X", brand: "B", score: 15 });
  assert.equal(p.score, 10);
  const q = normalizeProduct({ product: "X", brand: "B", score: 0 });
  assert.equal(q.score, 1);
});

test("classify severity matches the heuristic table", () => {
  assert.equal(classify({ sample: 2, avg: 1, worst: 1, pct_flagged: 0 }), "neutral", "tiny sample");
  assert.equal(classify({ sample: 4, avg: 8, worst: 10, pct_flagged: 0.8 }), "negative");
  assert.equal(classify({ sample: 4, avg: 4, worst: 8, pct_flagged: 0.25 }), "mixed");
  assert.equal(classify({ sample: 4, avg: 1.5, worst: 2, pct_flagged: 0 }), "positive");
  assert.equal(classify({ sample: 4, avg: 4.5, worst: 6, pct_flagged: 0 }), "neutral");
});

test("rollUpByBrand computes avg / worst / pct_flagged correctly", () => {
  const products = [
    { product: "P1", brand: "B", score: 2 },
    { product: "P2", brand: "B", score: 4 },
    { product: "P3", brand: "B", score: 7 },
    { product: "P4", brand: "B", score: 9 },
  ];
  const map = new Map([["foo", products]]);
  const out = rollUpByBrand(map, "https://example.org/");
  assert.equal(out.foo.ewg_product_count, 4);
  assert.equal(out.foo.ewg_worst_score, 9);
  assert.equal(out.foo.ewg_avg_score, 5.5);
  assert.equal(out.foo.ewg_pct_flagged, 0.5);
  assert.equal(out.foo.ewg_flagged_count, 2);
  assert.equal(out.foo.sample_products[0].score, 9);
  assert.equal(out.foo.severity, "negative"); // pct_flagged>=0.5
});

test("fixture covers the brand rollup happy path end-to-end", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const products = seed.products.map(normalizeProduct).filter(Boolean);
  const snap = buildSnapshot(products);
  assert.ok(snap.product_count >= 50, `expected >=50 fixture products, got ${snap.product_count}`);

  // Group by brand
  const byBrand = new Map();
  for (const p of products) {
    if (!byBrand.has(p.brand)) byBrand.set(p.brand, []);
    byBrand.get(p.brand).push(p);
  }
  // Burt's Bees should classify as positive (all scores 1-2)
  const bees = byBrand.get("Burt's Bees");
  assert.ok(bees);
  assert.equal(classify({
    sample: bees.length,
    avg: bees.reduce((a, p) => a + p.score, 0) / bees.length,
    worst: Math.max(...bees.map(p => p.score)),
    pct_flagged: bees.filter(p => p.score >= 7).length / bees.length,
  }), "positive");

  // Bath & Body Works trends negative (scores 6-8, ≥1 flagged)
  const bbw = byBrand.get("Bath & Body Works");
  assert.ok(bbw);
  const bbwSev = classify({
    sample: bbw.length,
    avg: bbw.reduce((a, p) => a + p.score, 0) / bbw.length,
    worst: Math.max(...bbw.map(p => p.score)),
    pct_flagged: bbw.filter(p => p.score >= 7).length / bbw.length,
  });
  assert.ok(["negative", "mixed"].includes(bbwSev), `expected negative/mixed got ${bbwSev}`);
});

test("matchBrand finds 'Burt's Bees' via 2-token head", () => {
  const idx = buildAliasIndex(["burts-bees", "olay"], {});
  // "Burt's Bees" normalizes to "burts bees" — slug "burts-bees" indexes as "burts bees"
  assert.equal(matchBrand("Burt's Bees", idx), "burts-bees");
});
