#!/usr/bin/env node
/**
 * Test harness for wikirate-fetch.mjs + wikirate-merge.mjs.
 *
 * Loads the 30-row checked-in fixture at scripts/fixtures/wikirate/sample.json,
 * exercises:
 *   - normalizeAnswerPayload (parsing)
 *   - replayFixture          (metric tagging + filter)
 *   - normalizeCompanyName + toSlug (name normalization)
 *   - buildIndex + matchCompany     (slug matching against the real index)
 *   - buildAugment                  (multi-metric output shape)
 *
 * No network calls. Uses node:test from Node 22.
 *
 * Locally: node --test scripts/wikirate-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  METRICS,
  LICENSE,
  parseArgs,
  buildUrl,
  normalizeAnswerPayload,
  replayFixture,
  computeStatus,
} from "./wikirate-fetch.mjs";
import {
  normalizeCompanyName,
  toSlug,
  buildIndex,
  matchCompany,
  buildAugment,
  isUsableRaw,
} from "./wikirate-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures/wikirate/sample.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

test("LICENSE constant is the required CC BY 4.0 attribution string", () => {
  assert.equal(LICENSE, "CC BY 4.0 — WikiRate, https://wikirate.org");
});

test("METRICS covers all six mandated benchmark families", () => {
  const names = METRICS.map(m => m.metric_name);
  assert.ok(names.some(n => n.startsWith("Clean Clothes Campaign+")), "CLEAN CLOTHES present");
  assert.ok(names.some(n => n.startsWith("Transparency Pledge+")),    "Transparency Pledge present");
  assert.ok(names.some(n => n.startsWith("Fashion Transparency")),    "Fashion Transparency Index present");
  assert.ok(names.some(n => n.startsWith("KnowTheChain+")),           "KnowTheChain present");
  assert.ok(names.some(n => n.startsWith("CDP+")),                    "CDP climate present");
  assert.ok(names.some(n => n.startsWith("Corporate Human Rights")),  "CHRB present");
  assert.ok(names.some(n => n.startsWith("Break Free From Plastic")), "BFFP present");
});

test("parseArgs handles --metric, --limit, --out, --cache, --dry", () => {
  const a = parseArgs(["--metric", "Transparency Pledge", "--limit", "50", "--out", "/tmp/x.json", "--cache", "--dry"]);
  assert.equal(a.metric, "Transparency Pledge");
  assert.equal(a.limit, 50);
  assert.equal(a.out, "/tmp/x.json");
  assert.equal(a.cache, true);
  assert.equal(a.dry, true);
});

test("parseArgs --limit clamps to [1, 200]", () => {
  assert.equal(parseArgs(["--limit", "9999"]).limit, 200);
  assert.equal(parseArgs(["--limit", "0"]).limit, 100); // 0 falls back to default
  assert.equal(parseArgs(["--limit", "-5"]).limit, 1);
});

test("buildUrl produces the documented endpoint shape", () => {
  const u = new URL(buildUrl("Fashion Transparency Index+Score", 50, 100));
  assert.equal(u.origin + u.pathname, "https://wikirate.org/Wikirate.json");
  assert.equal(u.searchParams.get("metric_name"), "Fashion Transparency Index+Score");
  assert.equal(u.searchParams.get("view"), "answer_list");
  assert.equal(u.searchParams.get("limit"), "50");
  assert.equal(u.searchParams.get("offset"), "100");
});

test("computeStatus distinguishes ok / partial / failed runs", () => {
  // No errors -> ok.
  assert.equal(computeStatus({ dry: false, metricCount: 9, errorCount: 0 }), "ok");
  // Some errors -> partial.
  assert.equal(computeStatus({ dry: false, metricCount: 9, errorCount: 3 }), "partial");
  // Every metric errored -> failed (this is what a network outage or a
  // Cloudflare 403 wall looks like; must never read as a clean empty run).
  assert.equal(computeStatus({ dry: false, metricCount: 9, errorCount: 9 }), "failed");
  // Dry runs never touch the network -> always ok.
  assert.equal(computeStatus({ dry: true, metricCount: 9, errorCount: 0 }), "ok");
});

test("isUsableRaw rejects failed and empty-live snapshots", () => {
  // Failed run (new fetcher) -> unusable, regardless of mode.
  assert.equal(isUsableRaw({ mode: "live", status: "failed", answer_count: 0, answers: [] }), false);
  // Legacy live snapshot with zero answers (pre-`status` fetcher swallowing
  // errors, e.g. data/raw/wikirate/2026-06-09.json) -> unusable.
  assert.equal(isUsableRaw({ mode: "live", answer_count: 0, answers: [] }), false);
  // Healthy live snapshot -> usable.
  assert.equal(isUsableRaw({ mode: "live", status: "ok", answer_count: 12, answers: [{}] }), true);
  // Partial live snapshot still has real data -> usable.
  assert.equal(isUsableRaw({ mode: "live", status: "partial", answer_count: 5, answers: [{}] }), true);
  // Dry snapshots are fixture replays; usable even without `status`.
  assert.equal(isUsableRaw({ mode: "dry", answer_count: 30, answers: [{}] }), true);
  // Garbage -> unusable.
  assert.equal(isUsableRaw(null), false);
  assert.equal(isUsableRaw("nope"), false);
});

test("normalizeAnswerPayload accepts {answer:[...]} envelope", async () => {
  const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const rows = normalizeAnswerPayload(raw);
  assert.equal(rows.length, 30, "fixture has 30 answer rows");
  assert.equal(rows[0].metric, "Fashion Transparency Index+Score");
  assert.equal(rows[0].company, "Nike, Inc.");
  assert.equal(rows[0].year, 2023);
  assert.equal(rows[0].value, "57");
  assert.ok(rows[0].url.startsWith("https://wikirate.org/"));
});

test("normalizeAnswerPayload accepts a bare array too", () => {
  const rows = normalizeAnswerPayload([
    { metric: "CDP+Climate Change Score", company: "Apple Inc.", year: 2023, value: "A", url: "https://wikirate.org/x" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, "A");
});

test("normalizeAnswerPayload drops rows missing metric/company/value", () => {
  const rows = normalizeAnswerPayload({ answer: [
    { metric: "X", company: "Y", value: "v" },
    { metric: "X", company: "Y", value: "" },          // empty value -> drop
    { metric: "X", company: "Y", value: null },        // null value -> drop
    { metric: "X", company: "Y" },                     // missing value -> drop
    { metric: "X", value: "v" },                       // missing company -> drop
    { company: "Y", value: "v" },                      // missing metric -> drop
  ]});
  assert.equal(rows.length, 1);
});

test("replayFixture tags each row with family/label/sourceUrl", async () => {
  const rows = await replayFixture(null, FIXTURE);
  assert.equal(rows.length, 30, "all 30 rows tagged (every fixture row matches a curated metric)");
  // Spot-check tagging: FTI should be 'transparency', KTC should be 'labor', CDP 'environment'.
  const fti = rows.find(r => r.metric.startsWith("Fashion Transparency"));
  assert.equal(fti.family, "transparency");
  assert.equal(fti.label, "Fashion Transparency Index");
  const ktc = rows.find(r => r.metric.startsWith("KnowTheChain+Apparel"));
  assert.equal(ktc.family, "labor");
  const cdp = rows.find(r => r.metric.startsWith("CDP+"));
  assert.equal(cdp.family, "environment");
});

test("replayFixture honors metric filter", async () => {
  const rows = await replayFixture("KnowTheChain", FIXTURE);
  assert.ok(rows.length >= 5, "at least 5 KTC rows in fixture");
  assert.ok(rows.every(r => r.metric.startsWith("KnowTheChain+")), "filter is exact");
});

test("normalizeCompanyName strips common corporate suffixes", () => {
  assert.equal(normalizeCompanyName("Nike, Inc."), "Nike");
  assert.equal(normalizeCompanyName("adidas AG"), "adidas");
  assert.equal(normalizeCompanyName("H&M Hennes & Mauritz AB"), "H&M Hennes & Mauritz");
  assert.equal(normalizeCompanyName("Apple Inc."), "Apple");
  assert.equal(normalizeCompanyName("Unilever PLC"), "Unilever");
  // Trailing ".com" is also peeled so "Amazon.com, Inc." → "Amazon".
  assert.equal(normalizeCompanyName("Amazon.com, Inc."), "Amazon");
  assert.equal(normalizeCompanyName("The Coca-Cola Company"), "Coca-Cola");
});

test("toSlug produces TruNorth-style lower-kebab-case", () => {
  assert.equal(toSlug("Nike, Inc."), "nike");
  assert.equal(toSlug("Patagonia, Inc."), "patagonia");
  // " & Co." is a corporate suffix and should be stripped before slugifying.
  assert.equal(toSlug("Levi Strauss & Co."), "levi-strauss");
  assert.equal(toSlug("Procter & Gamble"), "procter-and-gamble");
});

test("buildIndex + matchCompany resolves real WikiRate names to TruNorth slugs", async () => {
  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const lookup = buildIndex(indexJson, { aliases: {}, parents: {} });
  // Direct hits that should work without any aliases.
  const nike = matchCompany("Nike, Inc.", lookup);
  assert.equal(nike?.slug, "nike");
  const apple = matchCompany("Apple Inc.", lookup);
  assert.equal(apple?.slug, "apple");
  const patagonia = matchCompany("Patagonia, Inc.", lookup);
  assert.equal(patagonia?.slug, "patagonia");
  const primark = matchCompany("Primark", lookup);
  assert.equal(primark?.slug, "primark");
  // "Industria de Diseno Textil Inditex SA" should resolve directly via the
  // index name. (TruNorth has both that long form AND a "Zara / Inditex"
  // slug; either is a legitimate match.)
  const inditex = matchCompany("Industria de Diseno Textil Inditex SA", lookup);
  assert.ok(inditex?.slug, `Inditex resolved to ${inditex?.slug}`);
  // "The Coca-Cola Company" should resolve via "The "-stripping + suffix removal.
  const coke = matchCompany("The Coca-Cola Company", lookup);
  assert.equal(coke?.slug, "coca-cola");
});

test("buildAugment produces the multi-metric output shape", async () => {
  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const lookup = buildIndex(indexJson, { aliases: {}, parents: {} });
  const rows = await replayFixture(null, FIXTURE);
  const { companies, stats } = buildAugment(rows, lookup);

  // We expect at least Nike, Apple, Patagonia, Primark, Levi-Strauss matched.
  for (const slug of ["nike", "apple", "patagonia", "primark", "levi-strauss"]) {
    assert.ok(companies[slug], `${slug} should be in the augment`);
    assert.ok(companies[slug].metrics, `${slug} should have a metrics object`);
  }
  // Nike has FTI + Living Wage Gap + KTC Apparel + CHRB in the fixture — 4 metrics.
  const nikeMetrics = Object.keys(companies.nike.metrics);
  assert.ok(nikeMetrics.length >= 4, `Nike has multiple metrics, got ${nikeMetrics.length}: ${nikeMetrics.join(", ")}`);
  // Each metric carries value + year + sourceUrl.
  const fti = companies.nike.metrics["Fashion Transparency Index"];
  assert.equal(fti.value, "57");
  assert.equal(fti.year, 2023);
  assert.ok(fti.sourceUrl?.startsWith("https://wikirate.org/"));

  // Stats counts are consistent.
  assert.ok(stats.matched > 0);
  assert.ok(stats.matched + stats.orphan === rows.length);
});

test("buildAugment dedupes (company, metric) by keeping the newest year", async () => {
  // Two answers for the same metric on the same company, older first.
  const rows = [
    { company: "Nike, Inc.", metric: "Fashion Transparency Index+Score", value: "40", year: 2021, url: "u1",
      family: "transparency", label: "Fashion Transparency Index", sourceUrl: "u1" },
    { company: "Nike, Inc.", metric: "Fashion Transparency Index+Score", value: "57", year: 2023, url: "u2",
      family: "transparency", label: "Fashion Transparency Index", sourceUrl: "u2" },
  ];
  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const lookup = buildIndex(indexJson, { aliases: {}, parents: {} });
  const { companies } = buildAugment(rows, lookup);
  assert.equal(companies.nike.metrics["Fashion Transparency Index"].value, "57");
  assert.equal(companies.nike.metrics["Fashion Transparency Index"].year, 2023);
});
