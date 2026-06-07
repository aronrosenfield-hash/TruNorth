#!/usr/bin/env node
/**
 * Tests for naag-fetch.mjs (and a few naag-merge.mjs helpers).
 *
 * Uses node:test against the saved HTML fixtures in scripts/fixtures/naag/.
 * No network calls — we deliberately do not ping naag.org from CI.
 *
 * Run: node --test scripts/naag-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseListingPage,
  parseDetailPage,
  parseAmountUsd,
  parseDate,
  clean,
} from "./naag-fetch.mjs";
import {
  slugify,
  mineDefendantsFromSummary,
  resolveSlug,
  buildAugment,
} from "./naag-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures/naag");

const listHtml   = await fs.readFile(path.join(FIXTURE_DIR, "sample-list.html"), "utf-8");
const detailHtml = await fs.readFile(path.join(FIXTURE_DIR, "sample-detail.html"), "utf-8");

/* ────────────────────── amount parser ──────────────────────────── */

test("parseAmountUsd: dollar+million", () => {
  assert.equal(parseAmountUsd("$700 million settlement"), 700_000_000);
});
test("parseAmountUsd: dollar+billion", () => {
  assert.equal(parseAmountUsd("$2.5 billion settlement"), 2_500_000_000);
});
test("parseAmountUsd: 26B compact (without dollar sign)", () => {
  assert.equal(parseAmountUsd("a $26 billion multistate settlement"), 26_000_000_000);
});
test("parseAmountUsd: $141 million", () => {
  assert.equal(parseAmountUsd("$141 million multistate settlement with Intuit"), 141_000_000);
});
test("parseAmountUsd: $1,250,000.50 picks largest", () => {
  assert.equal(parseAmountUsd("paid $1,250,000.50 over two years"), 1_250_001); // rounded
});
test("parseAmountUsd: $250,000 (no unit suffix)", () => {
  assert.equal(parseAmountUsd("$250,000 settlement"), 250_000);
});
test("parseAmountUsd: returns null for empty", () => {
  assert.equal(parseAmountUsd(""), null);
});

/* ────────────────────── date parser ────────────────────────────── */

test("parseDate: long English", () => {
  assert.equal(parseDate("September 30, 2019"), "2019-09-30");
});
test("parseDate: ISO 8601 timestamp", () => {
  assert.equal(parseDate("2022-09-06T14:00:00+00:00"), "2022-09-06");
});
test("parseDate: returns null on garbage", () => {
  assert.equal(parseDate("circa last week"), null);
});

/* ────────────────────── listing parser ─────────────────────────── */

test("parseListingPage: extracts 6 settlements", () => {
  const { items } = parseListingPage(listHtml);
  assert.equal(items.length, 6);
});

test("parseListingPage: each item has title + url", () => {
  const { items } = parseListingPage(listHtml);
  for (const it of items) {
    assert.ok(it.title.length > 5, `title too short: ${JSON.stringify(it.title)}`);
    assert.ok(it.url.startsWith("https://www.naag.org/multistate-case/"), `bad url: ${it.url}`);
  }
});

test("parseListingPage: first item is Equifax with date + summary", () => {
  const { items } = parseListingPage(listHtml);
  assert.match(items[0].title, /Equifax/);
  assert.equal(items[0].date, "2019-09-30");
  assert.match(items[0].summary, /\$700 million/);
});

test("parseListingPage: detects next-page link", () => {
  const { next } = parseListingPage(listHtml);
  assert.match(next, /multistate-cases\/page\/2/);
});

/* ────────────────────── detail parser ──────────────────────────── */

test("parseDetailPage: Equifax fields", () => {
  const rec = parseDetailPage(detailHtml, "https://www.naag.org/multistate-case/equifax-data-breach-settlement/");
  assert.equal(rec.caseTitle, "Equifax Data Breach Multistate Settlement");
  assert.equal(rec.amountUsd, 700_000_000);
  assert.equal(rec.date, "2019-09-30");
  // Trailing periods are stripped by the defendant cleaner.
  assert.deepEqual(rec.defendants, ["Equifax Inc", "Equifax Information Services LLC"]);
  assert.ok(rec.statesInvolved.includes("California"));
  assert.ok(rec.statesInvolved.includes("New York"));
  assert.ok(rec.statesInvolved.includes("Puerto Rico"));
  assert.ok(rec.statesInvolved.length >= 48, `expected 48+ states, got ${rec.statesInvolved.length}`);
  assert.ok(rec.summary.length > 0 && rec.summary.length <= 500);
  assert.match(rec.summary, /\$700 million/);
});

/* ────────────────────── slugify ────────────────────────────────── */

test("slugify: strips Inc. suffix", () => {
  assert.equal(slugify("Equifax Inc."), "equifax");
});
test("slugify: handles & → and", () => {
  assert.equal(slugify("Johnson & Johnson"), "johnson-and-johnson");
});
test("slugify: strips multiple corp suffixes", () => {
  assert.equal(slugify("McKesson Corporation"), "mckesson");
});
test("slugify: handles LLC", () => {
  assert.equal(slugify("Google LLC"), "google");
});

/* ────────────────────── summary mining ─────────────────────────── */

test("mineDefendantsFromSummary: extracts opioid distributors", () => {
  const text = "$26 billion multistate settlement with McKesson Corporation, Cardinal Health Inc., AmerisourceBergen Corporation, and Johnson & Johnson resolving claims related to opioids.";
  const out = mineDefendantsFromSummary(text);
  assert.ok(out.includes("McKesson Corporation"));
  assert.ok(out.includes("Cardinal Health Inc"));
  assert.ok(out.includes("AmerisourceBergen Corporation"));
  assert.ok(out.includes("Johnson & Johnson"), `got: ${JSON.stringify(out)}`);
});

test("mineDefendantsFromSummary: returns [] when no 'with X' anchor", () => {
  const out = mineDefendantsFromSummary("The settlement was announced today.");
  assert.deepEqual(out, []);
});

/* ────────────────────── resolveSlug ────────────────────────────── */

test("resolveSlug: Equifax Inc. → equifax (direct)", () => {
  const maps = {
    aliases: {},
    parentMap: {},
    indexSlugs: new Set(["equifax"]),
    indexByName: new Map(),
  };
  const { slug, via } = resolveSlug("Equifax Inc.", maps);
  assert.equal(slug, "equifax");
  assert.equal(via, "direct");
});

test("resolveSlug: parent-map fallback", () => {
  const maps = {
    aliases: {},
    parentMap: { "oreo": { parent: "mondelez-international" } },
    indexSlugs: new Set(["mondelez-international"]),
    indexByName: new Map(),
  };
  const { slug, via } = resolveSlug("Oreo", maps);
  assert.equal(slug, "mondelez-international");
  assert.equal(via, "parent");
});

test("resolveSlug: orphan", () => {
  const maps = {
    aliases: {}, parentMap: {},
    indexSlugs: new Set(["walmart"]),
    indexByName: new Map(),
  };
  const { slug, via } = resolveSlug("Tiny Unknown Co", maps);
  assert.equal(slug, null);
  assert.equal(via, "orphan");
});

/* ────────────────────── buildAugment ───────────────────────────── */

test("buildAugment: filters settlements under $1M", () => {
  const settlements = [
    { caseTitle: "Big", defendants: ["Acme Inc."], statesInvolved: [], amountUsd: 5_000_000, date: "2024-01-01", summary: "", sourceUrl: "https://x" },
    { caseTitle: "Small", defendants: ["Acme Inc."], statesInvolved: [], amountUsd: 500_000, date: "2024-01-02", summary: "", sourceUrl: "https://y" },
    { caseTitle: "NoAmount", defendants: ["Acme Inc."], statesInvolved: [], amountUsd: null, date: "2024-01-03", summary: "", sourceUrl: "https://z" },
  ];
  const maps = {
    aliases: {}, parentMap: {},
    indexSlugs: new Set(["acme"]),
    indexByName: new Map(),
  };
  const { augment, totalKept } = buildAugment(settlements, maps);
  assert.equal(totalKept, 1);
  assert.equal(augment.acme.settlements.length, 1);
  assert.equal(augment.acme.settlements[0].caseTitle, "Big");
});

test("buildAugment: opioid case fans out to 4 companies", () => {
  const settlements = [{
    caseTitle: "Opioid Distributors Multistate Settlement",
    defendants: ["Opioid Distributors"],
    statesInvolved: ["California", "New York"],
    amountUsd: 26_000_000_000,
    date: "2022-02-25",
    summary: "$26 billion multistate settlement with McKesson Corporation, Cardinal Health Inc., AmerisourceBergen Corporation, and Johnson & Johnson resolving claims related to the marketing and distribution of prescription opioids.",
    sourceUrl: "https://www.naag.org/multistate-case/opioid-distributors-settlement/",
  }];
  const maps = {
    aliases: {}, parentMap: {},
    indexSlugs: new Set(["mckesson", "cardinal-health", "johnson-and-johnson", "amerisourcebergen"]),
    indexByName: new Map(),
  };
  const { augment, unmatched } = buildAugment(settlements, maps);
  assert.ok(augment.mckesson, "mckesson matched");
  assert.ok(augment["cardinal-health"], "cardinal-health matched");
  assert.ok(augment["johnson-and-johnson"], "j&j matched");
  assert.equal(unmatched.length, 0);
});

/* ────────────────────── clean ──────────────────────────────────── */

test("clean: normalizes whitespace and curly quotes", () => {
  assert.equal(clean("  it's  going  to be  great  "), "it's going to be great");
  assert.equal(clean("hello\n\n world"), "hello world");
});
