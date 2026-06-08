#!/usr/bin/env node
/**
 * Test harness for employee-ratings-fetch.mjs +
 * employee-ratings-merge.mjs. Uses node:test (Node 22 built-in). NO
 * network calls — we deliberately do NOT ping Glassdoor / Indeed /
 * AmbitionBox / Wikidata. Pages are sample-captured HTML fixtures
 * with synthetic but shape-faithful aggregateRating blocks.
 *
 * Locally: node --test scripts/employee-ratings-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractAggregateRating,
  extractGlassdoorExtras,
  buildGlassdoorUrl,
  buildIndeedUrl,
  buildAmbitionBoxUrl,
  parseWikidataResults,
  slugify,
  slugifyCorp,
  matchSlug,
  safeNumber,
  assemblePrimarySignal,
} from "./employee-ratings-fetch.mjs";

import { buildLaborBlock, buildAugment } from "./employee-ratings-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_DIR = path.resolve(__dirname, "../test/fixtures/employee-ratings");

async function fix(name) {
  return fs.readFile(path.join(FIX_DIR, name), "utf-8");
}

test("safeNumber handles numbers, strings, junk", () => {
  assert.equal(safeNumber("3.4"), 3.4);
  assert.equal(safeNumber(42), 42);
  assert.equal(safeNumber("not a number"), null);
  // Number("") and Number(null) both coerce to 0 — documented JS quirk.
  // safeNumber preserves that (Number.isFinite(0) === true).
  assert.equal(safeNumber(""), 0);
  assert.equal(safeNumber(null), 0);
  assert.equal(safeNumber(undefined), null);
});

test("slugify normalizes common edge cases", () => {
  assert.equal(slugify("Johnson & Johnson"), "johnson-and-johnson");
  assert.equal(slugify("AT&T"), "at-and-t");
  assert.equal(slugify("3M Company"), "3m-company");
  assert.equal(slugify("  Walmart  "), "walmart");
  assert.equal(slugify("L'Oréal"), "l-or-al");
});

test("slugifyCorp strips Inc / Corp / Holdings / The", () => {
  assert.equal(slugifyCorp("Walmart Inc."), "walmart");
  assert.equal(slugifyCorp("The Boeing Company"), "boeing");
  assert.equal(slugifyCorp("Alphabet Holdings LLC"), "alphabet");
  assert.equal(slugifyCorp("Microsoft Corporation"), "microsoft");
  assert.equal(slugifyCorp("Johnson & Johnson"), "johnson-and-johnson");
});

test("matchSlug: direct → corp-stripped → alias", () => {
  const real = new Set(["walmart", "boeing", "google-alphabet"]);
  const aliases = { "alphabet": "google-alphabet" };
  assert.equal(matchSlug("Walmart", real, aliases), "walmart");
  assert.equal(matchSlug("The Boeing Company", real, aliases), "boeing");
  assert.equal(matchSlug("Alphabet Inc.", real, aliases), "google-alphabet");
  assert.equal(matchSlug("Nonexistent", real, aliases), null);
});

test("extractAggregateRating: Glassdoor JSON-LD with aggregateRating", async () => {
  const html = await fix("glassdoor-walmart.html");
  const agg = extractAggregateRating(html);
  assert.ok(agg, "expected an aggregateRating");
  assert.equal(agg.ratingValue, 3.4);
  assert.equal(agg.reviewCount, 65432);
});

test("extractAggregateRating: Indeed @graph array with EmployerAggregateRating", async () => {
  const html = await fix("indeed-microsoft.html");
  const agg = extractAggregateRating(html);
  assert.ok(agg);
  assert.equal(agg.ratingValue, 4.2);
  assert.equal(agg.reviewCount, 9876);
});

test("extractAggregateRating: Cloudflare challenge page returns null", async () => {
  const html = await fix("glassdoor-cloudflare-challenge.html");
  const agg = extractAggregateRating(html);
  assert.equal(agg, null);
});

test("extractGlassdoorExtras: parses recommend + CEO approval percentages", async () => {
  const html = await fix("glassdoor-walmart.html");
  const extras = extractGlassdoorExtras(html);
  assert.equal(extras.recommend_to_friend_pct, 51);
  assert.equal(extras.ceo_approval_pct, 72);
});

test("extractGlassdoorExtras: missing values return null fields", () => {
  const extras = extractGlassdoorExtras("<html><body>nothing here</body></html>");
  assert.equal(extras.recommend_to_friend_pct, null);
  assert.equal(extras.ceo_approval_pct, null);
});

test("buildGlassdoorUrl strips EI_IE prefix and slugifies name", () => {
  assert.equal(
    buildGlassdoorUrl("EI_IE715", "Walmart"),
    "https://www.glassdoor.com/Overview/Working-at-Walmart-EI_IE715.htm"
  );
  assert.equal(
    buildGlassdoorUrl("1651", "Microsoft Corporation"),
    "https://www.glassdoor.com/Overview/Working-at-Microsoft-Corporation-EI_IE1651.htm"
  );
  assert.equal(buildGlassdoorUrl(null, "Walmart"), null);
});

test("buildIndeedUrl uses raw slug ID", () => {
  assert.equal(
    buildIndeedUrl("walmart"),
    "https://www.indeed.com/cmp/walmart"
  );
  assert.equal(buildIndeedUrl(null), null);
});

test("buildAmbitionBoxUrl slugifies company name", () => {
  assert.equal(
    buildAmbitionBoxUrl("Johnson & Johnson"),
    "https://www.ambitionbox.com/overview/johnson-and-johnson-overview"
  );
});

test("parseWikidataResults dedups by QID and merges signal", async () => {
  const json = JSON.parse(await fix("wikidata-sparql.json"));
  const rows = parseWikidataResults(json);
  assert.equal(rows.length, 3, "3 unique QIDs after dedup");
  const walmart = rows.find(r => r.qid === "Q483551");
  assert.ok(walmart);
  assert.equal(walmart.slug, "walmart");
  assert.equal(walmart.glassdoor_id, "715");
  assert.equal(walmart.indeed_id, "walmart");
  assert.equal(walmart.employees, 2100000);
  assert.equal(walmart.founded, "1962-07-02");
  assert.equal(walmart.hq_country, "United States of America");
  const ms = rows.find(r => r.qid === "Q2283");
  assert.equal(ms.slug, "microsoft");
  // Nonexistent Co has only an Indeed ID — should still appear.
  const nonexistent = rows.find(r => r.qid === "Q9999999");
  assert.ok(nonexistent);
  assert.equal(nonexistent.indeed_id, "nonexistent-co");
  assert.equal(nonexistent.glassdoor_id, null);
});

test("assemblePrimarySignal prefers Glassdoor > Indeed > AmbitionBox > Wikidata", () => {
  assert.equal(assemblePrimarySignal({
    glassdoor: { status: "ok" }, indeed: { status: "ok" }, ambitionbox: { status: "ok" }
  }), "glassdoor");
  assert.equal(assemblePrimarySignal({
    glassdoor: { status: "blocked" }, indeed: { status: "ok" }, ambitionbox: { status: "ok" }
  }), "indeed");
  assert.equal(assemblePrimarySignal({
    glassdoor: { status: "blocked" }, indeed: { status: "blocked" }, ambitionbox: { status: "ok" }
  }), "ambitionbox");
  assert.equal(assemblePrimarySignal({
    glassdoor: { status: "blocked" }, indeed: { status: "blocked" }, ambitionbox: { status: "blocked" }
  }), "wikidata-only");
});

// ─────────────────────────── merger tests ───────────────────────

test("buildLaborBlock: full success → preserves all fields", () => {
  const rec = {
    slug: "walmart", name: "Walmart", qid: "Q483551",
    glassdoor: { status: "ok", rating: 3.4, review_count: 65432, ceo_approval_pct: 72, recommend_to_friend_pct: 51, year: 2026, url: "https://www.glassdoor.com/x" },
    indeed:    { status: "ok", rating: 3.5, review_count: 41000, year: 2026, url: "https://www.indeed.com/cmp/walmart" },
    ambitionbox: { status: "not_found" },
    wikidata: { glassdoor_id: "715", indeed_id: "walmart" },
    primary_signal: "glassdoor",
  };
  const block = buildLaborBlock(rec);
  assert.equal(block.glassdoorRating, 3.4);
  assert.equal(block.indeedRating, 3.5);
  assert.equal(block.ambitionboxRating, null);
  assert.equal(block.ceoApproval, 72);
  assert.equal(block.recommendToFriend, 51);
  assert.equal(block.reviewCountGlassdoor, 65432);
  assert.equal(block.reviewCountIndeed, 41000);
  assert.equal(block.source, "glassdoor");
  assert.equal(block.hasPublicPage, true);
  assert.equal(block.sourceUrls.indeed, "https://www.indeed.com/cmp/walmart");
});

test("buildLaborBlock: blocked scrape, wikidata-only → null ratings but page flag", () => {
  const rec = {
    slug: "apple", name: "Apple",
    glassdoor:   { status: "blocked" },
    indeed:      { status: "blocked" },
    ambitionbox: { status: "blocked" },
    wikidata: { glassdoor_id: "1138", indeed_id: "apple" },
    primary_signal: "wikidata-only",
  };
  const block = buildLaborBlock(rec);
  assert.equal(block.glassdoorRating, null);
  assert.equal(block.indeedRating, null);
  assert.equal(block.ceoApproval, null);
  assert.equal(block.source, "wikidata-only");
  assert.equal(block.hasPublicPage, true);
});

test("buildAugment: produces by_slug with full source summary", () => {
  const raw = {
    generated_at: "2026-06-07T00:00:00Z",
    mode: "apply",
    live_scrape: true,
    ok_glassdoor: 1, ok_indeed: 0, ok_ambitionbox: 0, wikidata_only: 1,
    records: [
      {
        slug: "walmart", name: "Walmart",
        glassdoor: { status: "ok", rating: 3.4, review_count: 65432, ceo_approval_pct: 72, recommend_to_friend_pct: 51 },
        indeed: { status: "blocked" }, ambitionbox: { status: "blocked" },
        wikidata: { glassdoor_id: "715", indeed_id: "walmart" },
        primary_signal: "glassdoor",
      },
      {
        slug: "apple", name: "Apple",
        glassdoor: { status: "blocked" }, indeed: { status: "blocked" }, ambitionbox: { status: "blocked" },
        wikidata: { glassdoor_id: "1138", indeed_id: "apple" },
        primary_signal: "wikidata-only",
      },
    ],
  };
  const aug = buildAugment(raw);
  assert.equal(Object.keys(aug.by_slug).length, 2);
  assert.equal(aug.by_slug.walmart.labor.glassdoorRating, 3.4);
  assert.equal(aug.by_slug.apple.labor.source, "wikidata-only");
  assert.equal(aug.source_summary.glassdoor, 1);
  assert.equal(aug.source_summary.wikidata_only, 1);
});
