#!/usr/bin/env node
/**
 * Test harness for fdaaa-trials-fetch.mjs + fdaaa-trials-merge.mjs.
 *
 * Uses scripts/fixtures/fdaaa-trials/{sponsors,rankings,trials}.csv —
 * hand-built rows that mirror the real TrialsTracker CSV schema. NO
 * network calls.
 *
 * Run via: node --test scripts/fdaaa-trials-fetch.test.mjs
 *
 * Exit 0 on success, non-zero on failure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCsv,
  parseBool,
  parseIntSafe,
  yearOf,
  joinSponsorsAndRankings,
  compactTrial,
} from "./fdaaa-trials-fetch.mjs";

import {
  slugVariants,
  resolveSponsor,
  aggregateSponsors,
  FDAAA_ALIASES,
} from "./fdaaa-trials-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures/fdaaa-trials");

// ─── parseCsv ─────────────────────────────────────────────────────────────
test("parseCsv — basic header + 2 rows", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { a: "1", b: "2", c: "3" });
  assert.deepEqual(rows[1], { a: "4", b: "5", c: "6" });
});

test("parseCsv — quoted fields with embedded commas", () => {
  const csv = `name,note\n"Acme, Inc.","hello, world"\nBob,plain\n`;
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Acme, Inc.");
  assert.equal(rows[0].note, "hello, world");
  assert.equal(rows[1].name, "Bob");
});

test("parseCsv — escaped double-quotes inside quoted field", () => {
  const csv = `q\n"she said ""hi"" today"\n`;
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].q, 'she said "hi" today');
});

test("parseCsv — BOM and trailing newline tolerated", () => {
  const csv = "﻿a,b\n1,2\n";
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { a: "1", b: "2" });
});

test("parseCsv — empty / single-line returns []", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("just-a-header\n"), []);
});

// ─── parseBool / parseIntSafe / yearOf ────────────────────────────────────
test("parseBool — accepts True/False, yes/no, 1/0", () => {
  assert.equal(parseBool("True"), true);
  assert.equal(parseBool("true"), true);
  assert.equal(parseBool("1"), true);
  assert.equal(parseBool("yes"), true);
  assert.equal(parseBool("False"), false);
  assert.equal(parseBool(""), false);
  assert.equal(parseBool(null), false);
  assert.equal(parseBool(undefined), false);
});

test("parseIntSafe — numbers and edge cases", () => {
  assert.equal(parseIntSafe("42"), 42);
  assert.equal(parseIntSafe("0"), 0);
  assert.equal(parseIntSafe(""), null);
  assert.equal(parseIntSafe(null), null);
  assert.equal(parseIntSafe("not-a-number"), null);
});

test("yearOf — extracts year from ISO date", () => {
  assert.equal(yearOf("2026-06-08"), 2026);
  assert.equal(yearOf("1999-12-31"), 1999);
  assert.equal(yearOf(null), null);
  assert.equal(yearOf(""), null);
});

// ─── joinSponsorsAndRankings ──────────────────────────────────────────────
test("joinSponsorsAndRankings — fixture yields 6 records with correct math", async () => {
  const sponsorsCsv = await fs.readFile(path.join(FIXTURE_DIR, "sponsors.csv"), "utf-8");
  const rankingsCsv = await fs.readFile(path.join(FIXTURE_DIR, "rankings.csv"), "utf-8");
  const sponsors = parseCsv(sponsorsCsv);
  const rankings = parseCsv(rankingsCsv);

  const joined = joinSponsorsAndRankings(sponsors, rankings);
  assert.equal(joined.length, 6, "6 ranking rows → 6 records");

  // Pfizer: 284 due, 284 reported → 0 late, 100%
  const pfizer = joined.find(r => r.slug === "pfizer");
  assert.ok(pfizer);
  assert.equal(pfizer.totalTrials, 284);
  assert.equal(pfizer.trialsDue, 284);
  assert.equal(pfizer.trialsReported, 284);
  assert.equal(pfizer.trialsLateOrMissing, 0);
  assert.equal(pfizer.compliancePct, 100);
  assert.equal(pfizer.year, 2026);
  assert.equal(pfizer.isIndustry, true);
  assert.ok(pfizer.sourceUrl.startsWith("https://fdaaa.trialstracker.net/sponsor/pfizer"));

  // Tiny sponsor: 6 due, 3 reported → 3 late, 50%
  const tiny = joined.find(r => r.slug === "some-tiny-industry-sponsor-inc");
  assert.ok(tiny);
  assert.equal(tiny.trialsDue, 6);
  assert.equal(tiny.trialsReported, 3);
  assert.equal(tiny.trialsLateOrMissing, 3);
  assert.equal(tiny.compliancePct, 50);

  // Mystery: 10 due, 3 reported → 7 late, 30%
  const mystery = joined.find(r => r.slug === "mystery-pharma-co");
  assert.equal(mystery.trialsLateOrMissing, 7);
  assert.equal(mystery.compliancePct, 30);

  // Academic sponsor flagged correctly
  const academic = joined.find(r => r.slug === "md-anderson-cancer-center");
  assert.equal(academic.isIndustry, false);
});

// ─── compactTrial ─────────────────────────────────────────────────────────
test("compactTrial — preserves key fields, truncates title", () => {
  const row = {
    completion_date: "2017-01-18",
    days_late: "3063",
    has_exemption: "False",
    has_results: "False",
    is_pact: "True",
    publication_url: "https://clinicaltrials.gov/study/NCT01702155",
    registry_id: "NCT01702155",
    results_due: "True",
    sponsor_name: "Delta-Fly Pharma, Inc.",
    sponsor_slug: "delta-fly-pharma-inc",
    start_date: "2012-10-10",
    status: "overdue",
    title: "x".repeat(500),
  };
  const c = compactTrial(row);
  assert.equal(c.registryId, "NCT01702155");
  assert.equal(c.sponsorSlug, "delta-fly-pharma-inc");
  assert.equal(c.status, "overdue");
  assert.equal(c.daysLate, 3063);
  assert.equal(c.hasResults, false);
  assert.equal(c.resultsDue, true);
  assert.equal(c.title.length, 250, "title truncated to 250 chars");
});

// ─── slugVariants ─────────────────────────────────────────────────────────
test("slugVariants — strips standard corporate suffixes", () => {
  const v = slugVariants("pfizer-inc");
  assert.ok(v.includes("pfizer-inc"), "original retained");
  assert.ok(v.includes("pfizer"), "suffix -inc stripped");
});

test("slugVariants — peels multiple suffixes", () => {
  const v = slugVariants("eli-lilly-and-company");
  // "co"/"company" then "and"… we don't strip "and", so should end at "eli-lilly-and"
  assert.ok(v.some(x => x === "eli-lilly-and") || v.some(x => x === "eli-lilly"),
            `expected eli-lilly variant in ${JSON.stringify(v)}`);
});

test("slugVariants — handles biotech/pharma tail", () => {
  const v = slugVariants("regeneron-pharmaceuticals");
  assert.ok(v.includes("regeneron"), `expected 'regeneron' in ${JSON.stringify(v)}`);
});

// ─── resolveSponsor ───────────────────────────────────────────────────────
test("resolveSponsor — direct slug match", () => {
  const r = resolveSponsor("pfizer", new Set(["pfizer"]), {});
  assert.equal(r.slug, "pfizer");
  assert.equal(r.routedVia, "direct");
});

test("resolveSponsor — alias for Merck subsidiary", () => {
  const r = resolveSponsor(
    "merck-sharp-dohme-llc",
    new Set(["merck-and-co", "pfizer"]),
    {},
  );
  assert.equal(r.slug, "merck-and-co");
  assert.equal(r.routedVia, "alias");
});

test("resolveSponsor — alias for J&J / Janssen", () => {
  const r = resolveSponsor(
    "janssen-research-development-llc",
    new Set(["johnson-and-johnson"]),
    {},
  );
  assert.equal(r.slug, "johnson-and-johnson");
  assert.equal(r.routedVia, "alias");
});

test("resolveSponsor — alias for Roche subsidiary", () => {
  const r = resolveSponsor(
    "hoffmann-la-roche",
    new Set(["roche"]),
    {},
  );
  assert.equal(r.slug, "roche");
  assert.equal(r.routedVia, "alias");
});

test("resolveSponsor — suffix-stripped match (regeneron-pharmaceuticals → regeneron)", () => {
  const r = resolveSponsor(
    "regeneron-pharmaceuticals",
    new Set(["regeneron"]),
    {},
  );
  assert.equal(r.slug, "regeneron");
  // either alias or suffix is acceptable — both are encoded
  assert.ok(r.routedVia === "alias" || r.routedVia === "suffix",
            `expected alias or suffix, got ${r.routedVia}`);
});

test("resolveSponsor — unknown sponsor → orphan", () => {
  const r = resolveSponsor("totally-unknown-pharma-xyz", new Set(["pfizer"]), {});
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("resolveSponsor — brand-parent-map fallback", () => {
  const r = resolveSponsor(
    "kite-pharma",
    new Set(["gilead-sciences"]),
    {},   // empty parentMap; alias should handle Kite directly
  );
  assert.equal(r.slug, "gilead-sciences");
});

test("resolveSponsor — brand-parent-map when no alias", () => {
  const r = resolveSponsor(
    "some-acquired-startup-inc",
    new Set(["big-pharma"]),
    { "some-acquired-startup": { parent: "big-pharma" } },
  );
  assert.equal(r.slug, "big-pharma");
  assert.equal(r.routedVia, "brand-parent");
});

// ─── aggregateSponsors ────────────────────────────────────────────────────
test("aggregateSponsors — single sponsor passthrough", () => {
  const agg = aggregateSponsors([{
    slug: "pfizer",
    totalTrials: 284, trialsDue: 284, trialsReported: 284,
    compliancePct: 100, year: 2026,
    sourceUrl: "https://fdaaa.trialstracker.net/sponsor/pfizer/",
  }]);
  assert.equal(agg.totalTrials, 284);
  assert.equal(agg.trialsLateOrMissing, 0);
  assert.equal(agg.compliancePct, 100);
  assert.equal(agg.year, 2026);
  assert.equal(agg._license, "Apache-2.0");
  assert.equal(agg.sourceUrl, "https://fdaaa.trialstracker.net/sponsor/pfizer/");
});

test("aggregateSponsors — multiple Janssen subs roll into J&J totals", () => {
  const agg = aggregateSponsors([
    { slug: "janssen-research-development-llc", totalTrials: 143, trialsDue: 143, trialsReported: 141, compliancePct: 99,  year: 2026, sourceUrl: "https://fdaaa.trialstracker.net/sponsor/janssen-research-development-llc/" },
    { slug: "janssen-vaccines-prevention-bv",   totalTrials: 32,  trialsDue: 32,  trialsReported: 30,  compliancePct: 94,  year: 2026, sourceUrl: "https://fdaaa.trialstracker.net/sponsor/janssen-vaccines-prevention-bv/" },
    { slug: "janssen-pharmaceutical-kk",        totalTrials: 9,   trialsDue: 9,   trialsReported: 9,   compliancePct: 100, year: 2026, sourceUrl: "https://fdaaa.trialstracker.net/sponsor/janssen-pharmaceutical-kk/" },
  ]);
  assert.equal(agg.totalTrials, 143 + 32 + 9);
  assert.equal(agg.trialsLateOrMissing, (143 - 141) + (32 - 30) + (9 - 9));   // 4
  // Recomputed: floor(100 * 180 / 184) = 97
  assert.equal(agg.compliancePct, Math.floor(100 * (141 + 30 + 9) / (143 + 32 + 9)));
  // Multi-sub: source URL points to rankings page
  assert.equal(agg.sourceUrl, "https://fdaaa.trialstracker.net/rankings/");
});

test("aggregateSponsors — handles null totalTrials gracefully", () => {
  const agg = aggregateSponsors([{
    slug: "x", totalTrials: null, trialsDue: 10, trialsReported: 7,
    compliancePct: 70, year: 2025,
    sourceUrl: "https://fdaaa.trialstracker.net/sponsor/x/",
  }]);
  assert.equal(agg.totalTrials, null);
  assert.equal(agg.trialsLateOrMissing, 3);
  assert.equal(agg.compliancePct, 70);
});

// ─── FDAAA_ALIASES sanity ─────────────────────────────────────────────────
test("FDAAA_ALIASES — coverage of top-10 pharma subsidiary slugs", () => {
  // Touch the most-load-bearing aliases so future edits don't accidentally
  // drop them.
  const required = [
    "merck-sharp-dohme-llc",
    "janssen-research-development-llc",
    "hoffmann-la-roche",
    "genentech-inc",
    "novartis-pharmaceuticals",
    "eli-lilly-and-company",
    "kite-a-gilead-company",
    "alexion-pharmaceuticals-inc",
    "celgene",
    "modernatx-inc",
  ];
  for (const k of required) {
    assert.ok(FDAAA_ALIASES[k], `missing alias: ${k}`);
  }
});
