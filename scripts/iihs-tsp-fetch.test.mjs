#!/usr/bin/env node
/**
 * Test harness for iihs-tsp-fetch.mjs + iihs-tsp-merge.mjs.
 *
 * Uses scripts/fixtures/iihs-tsp/sample-2024.html (a hand-built page that
 * mirrors the real IIHS TSP listing structure with 8 representative
 * award entries — mix of TSP and TSP+). NO network calls.
 *
 * Run via: node --test scripts/iihs-tsp-fetch.test.mjs
 *
 * Exit 0 on success, non-zero on failure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  makeNameFromSlug,
  parseModelLabel,
  parseListingHtml,
} from "./iihs-tsp-fetch.mjs";

import {
  resolveMakeSlug,
} from "./iihs-tsp-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/iihs-tsp/sample-2024.html");

// ─── makeNameFromSlug ─────────────────────────────────────────────────────
test("makeNameFromSlug — simple brand", () => {
  assert.equal(makeNameFromSlug("honda"), "Honda");
  assert.equal(makeNameFromSlug("toyota"), "Toyota");
  assert.equal(makeNameFromSlug("subaru"), "Subaru");
});

test("makeNameFromSlug — hyphenated brand", () => {
  assert.equal(makeNameFromSlug("mercedes-benz"), "Mercedes-Benz");
  assert.equal(makeNameFromSlug("alfa-romeo"), "Alfa-Romeo");
});

test("makeNameFromSlug — acronyms uppercased", () => {
  assert.equal(makeNameFromSlug("bmw"), "BMW");
  assert.equal(makeNameFromSlug("gmc"), "GMC");
});

// ─── parseModelLabel ──────────────────────────────────────────────────────
test("parseModelLabel — single year prefix", () => {
  const r = parseModelLabel("2024 Toyota Camry 4-door sedan");
  assert.equal(r.modelYearLabel, "2024");
  assert.equal(r.modelDescriptor, "Toyota Camry 4-door sedan");
});

test("parseModelLabel — year range prefix", () => {
  const r = parseModelLabel("2024-25 Acura Integra 4-door hatchback");
  assert.equal(r.modelYearLabel, "2024-25");
  assert.equal(r.modelDescriptor, "Acura Integra 4-door hatchback");
});

test("parseModelLabel — no year prefix returns whole string", () => {
  const r = parseModelLabel("Some Model");
  assert.equal(r.modelYearLabel, null);
  assert.equal(r.modelDescriptor, "Some Model");
});

test("parseModelLabel — empty / null", () => {
  assert.deepEqual(parseModelLabel(""), { modelYearLabel: null, modelDescriptor: "" });
  assert.deepEqual(parseModelLabel(null), { modelYearLabel: null, modelDescriptor: "" });
});

// ─── parseListingHtml against fixture ─────────────────────────────────────
test("parseListingHtml — fixture yields all 8 award entries", async () => {
  const html = await fs.readFile(FIXTURE, "utf-8");
  const entries = parseListingHtml(html, 2024);
  assert.equal(entries.length, 8, "8 cards parsed");

  // Award-tier mix matches fixture: 5 TSP+, 3 TSP
  const plus  = entries.filter(e => e.award === "TSP+");
  const plain = entries.filter(e => e.award === "TSP");
  assert.equal(plus.length, 5, "5 TSP+ entries");
  assert.equal(plain.length, 3, "3 TSP entries");

  // Spot-check Acura Integra (TSP+)
  const acura = entries.find(e => e.makeSlug === "acura");
  assert.ok(acura, "Acura entry present");
  assert.equal(acura.award, "TSP+");
  assert.equal(acura.modelYearLabel, "2024-25");
  assert.equal(acura.make, "Acura");
  assert.equal(acura.modelSlug, "integra-4-door-hatchback");

  // Spot-check Mercedes-Benz hyphenated brand name
  const mb = entries.find(e => e.makeSlug === "mercedes-benz");
  assert.ok(mb, "Mercedes-Benz entry present");
  assert.equal(mb.make, "Mercedes-Benz");
  assert.equal(mb.award, "TSP+");

  // Spot-check Toyota plain TSP
  const toyota = entries.find(e => e.makeSlug === "toyota");
  assert.ok(toyota, "Toyota entry present");
  assert.equal(toyota.award, "TSP");

  // All entries have a source URL pointing at iihs.org
  for (const e of entries) {
    assert.ok(e.sourceUrl.startsWith("https://www.iihs.org/"), `sourceUrl absolute for ${e.makeSlug}/${e.modelSlug}`);
    assert.ok(e.awardYear === 2024, `awardYear stamped`);
  }
});

// ─── resolveMakeSlug ──────────────────────────────────────────────────────
test("resolveMakeSlug — honda routes to honda-usa via alias", () => {
  const indexSlugs = new Set(["honda-usa", "honda"]);
  const r = resolveMakeSlug("honda", indexSlugs, {});
  assert.equal(r.slug, "honda-usa");
  assert.equal(r.routedVia, "alias");
});

test("resolveMakeSlug — bare-slug brand (jeep) direct match via alias", () => {
  const indexSlugs = new Set(["jeep"]);
  const r = resolveMakeSlug("jeep", indexSlugs, {});
  assert.equal(r.slug, "jeep");
  // jeep is in the alias map pointing to itself, so it routes via alias
  assert.equal(r.routedVia, "alias");
});

test("resolveMakeSlug — direct match for unaliased brand", () => {
  const indexSlugs = new Set(["aptera-motors", "aptera"]);
  const r = resolveMakeSlug("aptera", indexSlugs, {});
  assert.equal(r.slug, "aptera");
  assert.equal(r.routedVia, "direct");
});

test("resolveMakeSlug — suffix:-usa fallback when no alias", () => {
  // Pick a brand NOT in the alias map; only suffix candidate is available
  const indexSlugs = new Set(["someniche-usa"]);
  const r = resolveMakeSlug("someniche", indexSlugs, {});
  assert.equal(r.slug, "someniche-usa");
  assert.equal(r.routedVia, "suffix:-usa");
});

test("resolveMakeSlug — brand-parent-map fallback", () => {
  const indexSlugs = new Set(["volkswagen-usa"]);
  const parentMap = { "skoda": { parent: "volkswagen-usa" } };
  const r = resolveMakeSlug("skoda", indexSlugs, parentMap);
  assert.equal(r.slug, "volkswagen-usa");
  assert.equal(r.routedVia, "brand-parent");
});

test("resolveMakeSlug — unmatched make → orphan", () => {
  const r = resolveMakeSlug("notamake", new Set(["unrelated"]), {});
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("resolveMakeSlug — null/empty input → orphan", () => {
  const r = resolveMakeSlug("", new Set(), {});
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

// ─── end-to-end smoke: parse fixture then merge ──────────────────────────
test("end-to-end — fixture entries merge into per-slug counts", async () => {
  const html = await fs.readFile(FIXTURE, "utf-8");
  const entries = parseListingHtml(html, 2024);

  // Build a fake index with only the canonical slugs we care about
  const indexSlugs = new Set([
    "acura-usa", "honda-usa", "hyundai-usa", "subaru-usa",
    "toyota-usa", "mercedes-benz-usa",
    // Mazda is NOT in TruNorth's index (we confirmed during dev) → orphan
  ]);

  const counts = new Map();
  let orphans = 0;
  for (const e of entries) {
    const { slug } = resolveMakeSlug(e.makeSlug, indexSlugs, {});
    if (!slug) { orphans++; continue; }
    if (!counts.has(slug)) counts.set(slug, { tsp: 0, tspPlus: 0 });
    const c = counts.get(slug);
    if (e.award === "TSP+") c.tspPlus++; else c.tsp++;
  }

  // Honda has 2 entries in fixture (Civic hatchback TSP + Civic sedan TSP+)
  assert.equal(counts.get("honda-usa")?.tsp, 1);
  assert.equal(counts.get("honda-usa")?.tspPlus, 1);

  // Acura: 1 TSP+
  assert.equal(counts.get("acura-usa")?.tspPlus, 1);
  // Subaru: 1 TSP+
  assert.equal(counts.get("subaru-usa")?.tspPlus, 1);
  // Mercedes-Benz: 1 TSP+
  assert.equal(counts.get("mercedes-benz-usa")?.tspPlus, 1);
  // Toyota: 1 plain TSP
  assert.equal(counts.get("toyota-usa")?.tsp, 1);

  // Mazda is excluded from indexSlugs above → contributes to orphans
  assert.equal(orphans, 1, "Mazda is the lone orphan");
});
