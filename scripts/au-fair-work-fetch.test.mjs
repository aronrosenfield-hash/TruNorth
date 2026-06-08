#!/usr/bin/env node
/**
 * Test harness for au-fair-work-fetch.mjs + au-fair-work-merge.mjs.
 *
 * Uses scripts/fixtures/au-fair-work/sample.html (a hand-built page that
 * mirrors the real FWO Drupal listing structure with 6 representative
 * outcomes). NO network calls.
 *
 * Run via: node --test scripts/au-fair-work-fetch.test.mjs
 * Or:     node scripts/au-fair-work-fetch.test.mjs   (node:test self-runs)
 *
 * Exit 0 on success, non-zero on failure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePenaltyAud,
  parseAuDate,
  splitDefendants,
  truncateSummary,
  parseListingHtml,
} from "./au-fair-work-fetch.mjs";

import {
  slugify,
  nameVariants,
  resolveDefendant,
} from "./au-fair-work-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/au-fair-work/sample.html");

// ─── parsePenaltyAud ──────────────────────────────────────────────────────
test("parsePenaltyAud — dollar+commas", () => {
  assert.equal(parsePenaltyAud("$5,250,000"), 5_250_000);
  assert.equal(parsePenaltyAud("$340,000"), 340_000);
  assert.equal(parsePenaltyAud("$98,000"), 98_000);
});

test("parsePenaltyAud — 'million' suffix", () => {
  assert.equal(parsePenaltyAud("$5.25 million"), 5_250_000);
  assert.equal(parsePenaltyAud("1.1 million"), 1_100_000);
  assert.equal(parsePenaltyAud("$2m"), 2_000_000);
});

test("parsePenaltyAud — null and junk", () => {
  assert.equal(parsePenaltyAud(""), null);
  assert.equal(parsePenaltyAud(null), null);
  assert.equal(parsePenaltyAud("no penalty"), null);
});

// ─── parseAuDate ──────────────────────────────────────────────────────────
test("parseAuDate — '12 March 2024' (Australian wordy)", () => {
  assert.equal(parseAuDate("12 March 2024"), "2024-03-12");
  assert.equal(parseAuDate("8 February 2024"), "2024-02-08");
  assert.equal(parseAuDate("22 November 2024"), "2024-11-22");
});

test("parseAuDate — ISO + dd/mm/yyyy", () => {
  assert.equal(parseAuDate("2024-03-12"), "2024-03-12");
  assert.equal(parseAuDate("12/03/2024"), "2024-03-12");
});

test("parseAuDate — null + junk", () => {
  assert.equal(parseAuDate(null), null);
  assert.equal(parseAuDate(""), null);
});

// ─── splitDefendants ──────────────────────────────────────────────────────
test("splitDefendants — single defendant unchanged", () => {
  assert.deepEqual(splitDefendants("Coles Supermarkets Australia Pty Ltd"),
                   ["Coles Supermarkets Australia Pty Ltd"]);
});

test("splitDefendants — 'X and Y' splits", () => {
  const result = splitDefendants("Sushi Bay Pty Ltd and Ms Shin");
  assert.equal(result.length, 2);
  assert.equal(result[0], "Sushi Bay Pty Ltd");
  assert.equal(result[1], "Ms Shin");
});

test("splitDefendants — 'and Anor' stripped", () => {
  const result = splitDefendants("ACME Pty Ltd and Anor");
  assert.equal(result.length, 1);
  assert.equal(result[0], "ACME Pty Ltd");
});

// ─── truncateSummary ──────────────────────────────────────────────────────
test("truncateSummary — short text unchanged", () => {
  assert.equal(truncateSummary("Short."), "Short.");
});

test("truncateSummary — over 500 chars trimmed with ellipsis", () => {
  const long = "x ".repeat(400);  // 800 chars
  const t = truncateSummary(long);
  assert.ok(t.length <= 500, `expected <=500, got ${t.length}`);
  assert.ok(t.endsWith("…"), "ellipsis appended");
});

// ─── parseListingHtml against fixture ─────────────────────────────────────
test("parseListingHtml — fixture yields all 6 outcomes", async () => {
  const html = await fs.readFile(FIXTURE, "utf-8");
  const cases = parseListingHtml(html);
  assert.equal(cases.length, 6, "6 articles parsed");

  // Spot-check Coles
  const coles = cases.find(c => c.defendants[0]?.includes("Coles"));
  assert.ok(coles, "Coles case present");
  assert.equal(coles.penaltyAud, 5_250_000);
  assert.equal(coles.date, "2024-03-12");
  assert.equal(coles.court, "Federal Court of Australia");
  assert.ok(coles.sourceUrl.startsWith("https://www.fairwork.gov.au/"), "sourceUrl absolute");

  // Spot-check Sushi Bay — multi-defendant split
  const sushiBay = cases.find(c => c.defendants[0]?.includes("Sushi Bay"));
  assert.ok(sushiBay, "Sushi Bay case present");
  assert.equal(sushiBay.defendants.length, 2, "Sushi Bay has 2 defendants split out");
  assert.equal(sushiBay.penaltyAud, 15_300_000);

  // All summaries <= 500 chars
  for (const c of cases) {
    assert.ok((c.summary || "").length <= 500, `summary <=500 for ${c.defendants[0]}`);
  }
});

// ─── slugify + nameVariants ───────────────────────────────────────────────
test("slugify — basic cases", () => {
  assert.equal(slugify("Coles Group"), "coles-group");
  assert.equal(slugify("McDonald's"), "mcdonalds");
  assert.equal(slugify("AT&T"), "at-and-t");
});

test("nameVariants — strips AU corporate suffixes progressively", () => {
  const v = nameVariants("Coles Supermarkets Australia Pty Ltd");
  // Should include the full original and a progressively stripped variant
  // ending at "Coles Supermarkets" or "Coles".
  assert.ok(v.includes("Coles Supermarkets Australia Pty Ltd"), "original retained");
  // After stripping " Pty Ltd" and " Australia", we should expose
  // "Coles Supermarkets"
  assert.ok(v.some(x => x === "Coles Supermarkets" || x === "Coles"),
            `expected 'Coles Supermarkets' or 'Coles' in ${JSON.stringify(v)}`);
});

test("nameVariants — McDonald's Australia Holdings → McDonald's", () => {
  const v = nameVariants("McDonald's Australia Holdings Pty Ltd");
  assert.ok(v.some(x => x === "McDonald's"),
            `expected 'McDonald's' in ${JSON.stringify(v)}`);
});

// ─── resolveDefendant ─────────────────────────────────────────────────────
test("resolveDefendant — McDonald's AU resolves to mcdonald-s (au-alias)", () => {
  const indexSlugs = new Set(["mcdonald-s", "domino-s", "7-eleven"]);
  const parentMap = {};
  const result = resolveDefendant("McDonald's Australia Holdings Pty Ltd",
                                  indexSlugs, parentMap);
  assert.equal(result.slug, "mcdonald-s");
  assert.equal(result.routedVia, "au-alias");
});

test("resolveDefendant — Domino's Pizza Enterprises Ltd → domino-s", () => {
  const indexSlugs = new Set(["domino-s"]);
  const result = resolveDefendant("Domino's Pizza Enterprises Ltd",
                                  indexSlugs, {});
  assert.equal(result.slug, "domino-s");
});

test("resolveDefendant — 7-Eleven Stores Pty Ltd → 7-eleven", () => {
  const indexSlugs = new Set(["7-eleven"]);
  const result = resolveDefendant("7-Eleven Stores Pty Ltd", indexSlugs, {});
  assert.equal(result.slug, "7-eleven");
});

test("resolveDefendant — unknown defendant → orphan", () => {
  const result = resolveDefendant("Some Random Pty Ltd",
                                  new Set(["unrelated"]), {});
  assert.equal(result.slug, null);
  assert.equal(result.routedVia, "orphan");
});

test("resolveDefendant — uses brand-parent-map fallback", () => {
  const indexSlugs = new Set(["procter-and-gamble"]);
  const parentMap = { "always": { parent: "procter-and-gamble" } };
  const result = resolveDefendant("Always", indexSlugs, parentMap);
  assert.equal(result.slug, "procter-and-gamble");
  assert.equal(result.routedVia, "brand-parent");
});
