#!/usr/bin/env node
/**
 * Test harness for the animal-welfare-union pipeline (Sprint F).
 *
 * Uses node:test. Runs the six per-source parsers + the buildEntries fold
 * against hand-crafted HTML fixtures (~40 rows total spanning every source).
 * No network calls — the fixtures live in test/fixtures/animal-welfare-union/.
 *
 * Locally:
 *   node --test scripts/animal-welfare-union-fetch.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCfiLeapingBunny,
  parseChooseCrueltyFree,
  parseVeganSociety,
  parseHumaneLeague,
  parseCiwf,
  parseOpenWingAlliance,
  buildEntries,
  stripTags,
  decodeEntities,
  SOURCES,
} from "./animal-welfare-union-fetch.mjs";
import { slugify, resolveSlug } from "./animal-welfare-union-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(ROOT, "test/fixtures/animal-welfare-union");

const loadFixture = (name) => fs.readFile(path.join(FIX, `${name}.html`), "utf-8");
const findBrand = (items, name) =>
  items.find(b => b.brand.toLowerCase() === name.toLowerCase());

test("decodeEntities + stripTags", () => {
  assert.equal(decodeEntities("Burt&rsquo;s Bees"), "Burt’s Bees");
  assert.equal(decodeEntities("Ben &amp; Jerry&apos;s"), "Ben & Jerry's");
  assert.equal(stripTags("<span>  hello <b>world</b>  </span>"), "hello world");
});

test("parseCfiLeapingBunny: 6 brands w/ parents", async () => {
  const html = await loadFixture("cfi-leaping-bunny");
  const items = parseCfiLeapingBunny(html);
  assert.equal(items.length, 6, `expected 6, got ${items.length}`);
  const lush = findBrand(items, "Lush");
  assert.ok(lush, "Lush present");
  assert.equal(lush.parent_company, "Lush Cosmetics Ltd.");
  const aveeno = findBrand(items, "Aveeno");
  assert.ok(aveeno, "Aveeno present");
  assert.equal(aveeno.parent_company, "Johnson & Johnson");
  const burts = findBrand(items, "Burt’s Bees");
  assert.ok(burts, "Burt's Bees entity-decoded");
});

test("parseChooseCrueltyFree: 5 brands", async () => {
  const html = await loadFixture("choose-cruelty-free");
  const items = parseChooseCrueltyFree(html);
  assert.equal(items.length, 5);
  assert.ok(findBrand(items, "Sukin"));
  assert.ok(findBrand(items, "Frank Body"));
});

test("parseVeganSociety: 7 trademark holders", async () => {
  const html = await loadFixture("vegan-society");
  const items = parseVeganSociety(html);
  assert.equal(items.length, 7);
  assert.ok(findBrand(items, "Oatly"));
  // entity-decoded
  assert.ok(findBrand(items, "Ben & Jerry's"));
});

test("parseHumaneLeague: 6 rows, cage-free + deadline + progress", async () => {
  const html = await loadFixture("humane-league");
  const items = parseHumaneLeague(html);
  assert.equal(items.length, 6);
  const mcd = findBrand(items, "McDonald's");
  assert.ok(mcd, "McDonald's present");
  assert.ok(mcd.cageFree, "McDonald's cage-free committed");
  assert.equal(mcd.cageFree.deadline, 2025);
  assert.equal(mcd.cageFree.progress, 78);
  // broiler-only pledge: cageFree should be null
  const gm = findBrand(items, "General Mills");
  assert.equal(gm.cageFree, null, "General Mills broiler-only — no cage-free");
});

test("parseCiwf: 6 tier-ranked food companies", async () => {
  const html = await loadFixture("ciwf-benchmark");
  const items = parseCiwf(html);
  assert.equal(items.length, 6);
  assert.equal(findBrand(items, "Marks & Spencer").farmAnimalWelfareTier, 1);
  assert.equal(findBrand(items, "Unilever").farmAnimalWelfareTier, 2);
  assert.equal(findBrand(items, "Cargill").farmAnimalWelfareTier, 5);
});

test("parseOpenWingAlliance: 8 cage-free progress rows", async () => {
  const html = await loadFixture("open-wing-alliance");
  const items = parseOpenWingAlliance(html);
  assert.equal(items.length, 8);
  const walmart = findBrand(items, "Walmart");
  assert.ok(walmart.cageFree.committed);
  assert.equal(walmart.cageFree.deadline, 2025);
  assert.equal(walmart.cageFree.progress, 82);
  const aldi = findBrand(items, "Aldi");
  assert.equal(aldi.cageFree.progress, 100);
});

test("buildEntries: cross-source fold + signal merging", async () => {
  const perSource = [
    { key: "cfi-leaping-bunny", url: "u1", brands: parseCfiLeapingBunny(await loadFixture("cfi-leaping-bunny")) },
    { key: "choose-cruelty-free", url: "u2", brands: parseChooseCrueltyFree(await loadFixture("choose-cruelty-free")) },
    { key: "vegan-society", url: "u3", brands: parseVeganSociety(await loadFixture("vegan-society")) },
    { key: "humane-league", url: "u4", brands: parseHumaneLeague(await loadFixture("humane-league")) },
    { key: "ciwf-benchmark", url: "u5", brands: parseCiwf(await loadFixture("ciwf-benchmark")) },
    { key: "open-wing-alliance", url: "u6", brands: parseOpenWingAlliance(await loadFixture("open-wing-alliance")) },
  ];
  const entries = buildEntries(perSource);
  // Lush appears in both CFI + CCF (deduped to one entry across sources).
  const lush = entries.find(e => e.brand === "Lush");
  assert.ok(lush, "Lush present");
  assert.equal(lush.signals.crueltyFreeCertified, true);
  assert.ok(lush.sources.includes("cfi-leaping-bunny"));
  assert.ok(lush.sources.includes("choose-cruelty-free"), "Lush merged across two cruelty-free sources");

  // Unilever appears in humane-league (cage-free) AND CIWF (tier-2).
  const unilever = entries.find(e => e.brand === "Unilever");
  assert.ok(unilever, "Unilever present");
  assert.equal(unilever.signals.farmAnimalWelfareTier, 2);
  assert.equal(unilever.signals.cageFreeCommitment?.committed, true);
  assert.equal(unilever.signals.cageFreeCommitment?.deadline, 2025);
  assert.equal(unilever.signals.cageFreeCommitment?.progress, 100);

  // Tier-merge wins lowest. McDonald's tier=2 only (one source).
  const mcd = entries.find(e => e.brand === "McDonald's");
  assert.equal(mcd.signals.farmAnimalWelfareTier, 2);
});

test("slugify handles apostrophes + accents", () => {
  assert.equal(slugify("Burt's Bees"), "burts-bees");
  assert.equal(slugify("Estée Lauder"), "estee-lauder");
  assert.equal(slugify("Ben & Jerry's"), "ben-and-jerrys");
  assert.equal(slugify("McDonald's"), "mcdonalds");
});

test("resolveSlug: routed_via direct/alias/parent/orphan", async () => {
  const META = path.join(ROOT, "public/data/_meta");
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META, f), "utf-8")); }
    catch { return {}; }
  };
  const maps = {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
  // Direct: dove exists as a company file
  const r1 = resolveSlug("Dove", maps);
  assert.equal(r1.slug, "dove");
  assert.equal(r1.routed_via, "direct");

  // Parent routing: aveeno → johnson-and-johnson (per brand-parent-map)
  const r2 = resolveSlug("Aveeno", maps);
  // Could route via direct (if aveeno.json exists) or via parent. Either is OK
  // — we only assert that it lands on a real file.
  assert.ok(r2.slug, "Aveeno should resolve to some target slug");
  assert.notEqual(r2.routed_via, "orphan");

  // Orphan: utterly invented brand
  const r3 = resolveSlug("NoSuchBrand_zzz_xyz", maps);
  assert.equal(r3.slug, null);
  assert.equal(r3.routed_via, "orphan");
});

test("SOURCES contains the 6 union-only sources (no PETA/LeapingBunny dup)", () => {
  const keys = SOURCES.map(s => s.key);
  assert.equal(SOURCES.length, 6);
  assert.ok(!keys.includes("peta-bwb"), "PETA must not be in this fetcher (existing pipeline)");
  assert.ok(!keys.includes("leaping-bunny"), "Leaping Bunny must not be in this fetcher (existing pipeline)");
  assert.ok(keys.includes("cfi-leaping-bunny"));
  assert.ok(keys.includes("choose-cruelty-free"));
  assert.ok(keys.includes("vegan-society"));
  assert.ok(keys.includes("humane-league"));
  assert.ok(keys.includes("ciwf-benchmark"));
  assert.ok(keys.includes("open-wing-alliance"));
});

test("fixture row count totals ~40 across all six sources", async () => {
  const totals = await Promise.all([
    parseCfiLeapingBunny(await loadFixture("cfi-leaping-bunny")).length,
    parseChooseCrueltyFree(await loadFixture("choose-cruelty-free")).length,
    parseVeganSociety(await loadFixture("vegan-society")).length,
    parseHumaneLeague(await loadFixture("humane-league")).length,
    parseCiwf(await loadFixture("ciwf-benchmark")).length,
    parseOpenWingAlliance(await loadFixture("open-wing-alliance")).length,
  ]);
  const total = totals.reduce((a, b) => a + b, 0);
  assert.ok(total >= 30 && total <= 50, `expected ~40 fixture rows, got ${total}`);
});
