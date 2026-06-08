#!/usr/bin/env node
/**
 * Test harness for corporate-giving-fetch.mjs + corporate-giving-merge.mjs.
 *
 * Uses node:test so it runs via `node --test scripts/corporate-giving-fetch.test.mjs`.
 * NO network calls — we deliberately do not ping projects.propublica.org
 * from CI or worktree review. The ~40-row inline fixture mirrors the
 * shape of a real ProPublica /organizations/{EIN}.json response.
 *
 * Locally: node --test scripts/corporate-giving-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEED,
  SEED_BULK,
  CHILD_INHERIT,
  SLUG_REMAP,
  expandedSeed,
  buildRecord,
  parsePropublicaOrg,
  normalizeEin,
  formatEin,
  fmtUsd,
} from "./corporate-giving-fetch.mjs";

import { buildCharityBlock } from "./corporate-giving-merge.mjs";

// ─────────────── 40-row inline fixture (synthetic but real-shape) ───────────────
// Mirrors the field names ProPublica's /organizations/{EIN}.json returns.
// Each row simulates the most recent Form 990 filing for a corporate
// foundation. The synthetic dollar figures are deliberately conservative
// so they don't collide with anything the live API would return.
const FIXTURE_PROPUBLICA_ORGS = [
  { ein: "205639919", name: "Walmart Foundation",            grants:   85_400_000, year: 2023 },
  { ein: "203259884", name: "Google.org",                    grants:   60_000_000, year: 2023 },
  { ein: "911144442", name: "Microsoft Philanthropies",      grants:   55_000_000, year: 2023 },
  { ein: "136037292", name: "JPMorgan Chase Foundation",     grants:   45_000_000, year: 2023 },
  { ein: "566038899", name: "Bank of America Charitable",    grants:   40_000_000, year: 2023 },
  { ein: "411367441", name: "Wells Fargo Foundation",        grants:   38_000_000, year: 2023 },
  { ein: "522167177", name: "Citi Foundation",               grants:   35_000_000, year: 2023 },
  { ein: "203676839", name: "Goldman Sachs Gives",           grants:   33_000_000, year: 2023 },
  { ein: "237297463", name: "Morgan Stanley Foundation",     grants:   30_000_000, year: 2023 },
  { ein: "136082357", name: "ExxonMobil Foundation",         grants:   28_000_000, year: 2023 },
  { ein: "133539279", name: "Pfizer Foundation",             grants:   27_000_000, year: 2023 },
  { ein: "591730960", name: "Johnson & Johnson Foundation",  grants:   25_000_000, year: 2023 },
  { ein: "226029474", name: "Merck Foundation",              grants:   24_000_000, year: 2023 },
  { ein: "364591926", name: "AbbVie Foundation",             grants:   22_000_000, year: 2023 },
  { ein: "350890989", name: "Eli Lilly Foundation",          grants:   20_000_000, year: 2023 },
  { ein: "133717538", name: "Bristol-Myers Squibb Fdn",      grants:   18_000_000, year: 2023 },
  { ein: "274034796", name: "Gilead Sciences Foundation",    grants:   16_000_000, year: 2023 },
  { ein: "954341425", name: "Amgen Foundation",              grants:   14_000_000, year: 2023 },
  { ein: "237054603", name: "Abbott Fund",                   grants:   12_000_000, year: 2023 },
  { ein: "411663008", name: "Medtronic Foundation",          grants:   10_000_000, year: 2023 },
  { ein: "411941760", name: "United Health Foundation",      grants:    9_500_000, year: 2023 },
  { ein: "061203479", name: "CVS Health Foundation",         grants:    9_000_000, year: 2023 },
  { ein: "411857553", name: "Target Foundation",             grants:    8_500_000, year: 2023 },
  { ein: "582363876", name: "Home Depot Foundation",         grants:    8_000_000, year: 2023 },
  { ein: "237109507", name: "Lowe's Foundation",             grants:    7_500_000, year: 2023 },
  { ein: "411836064", name: "Best Buy Foundation",           grants:    7_000_000, year: 2023 },
  { ein: "237406425", name: "Kroger Foundation",             grants:    6_500_000, year: 2023 },
  { ein: "204529433", name: "Albertsons Foundation",         grants:    6_000_000, year: 2023 },
  { ein: "596160974", name: "Publix Super Markets Charities",grants:    5_500_000, year: 2023 },
  { ein: "043007178", name: "TJX Foundation",                grants:    5_000_000, year: 2023 },
  { ein: "911325671", name: "Starbucks Foundation",          grants:    4_500_000, year: 2023 },
  { ein: "363143518", name: "RMHC",                          grants:    4_000_000, year: 2023 },
  { ein: "943347800", name: "Salesforce Foundation",         grants:    3_800_000, year: 2023 },
  { ein: "943092928", name: "Intel Foundation",              grants:    3_600_000, year: 2023 },
  { ein: "770443347", name: "Cisco Foundation",              grants:    3_400_000, year: 2023 },
  { ein: "770528617", name: "NVIDIA Foundation",             grants:    3_200_000, year: 2023 },
  { ein: "200963895", name: "Adobe Foundation",              grants:    3_000_000, year: 2023 },
  { ein: "311639618", name: "Nike Foundation",               grants:    2_800_000, year: 2023 },
  { ein: "381459376", name: "Ford Motor Company Fund",       grants:    2_600_000, year: 2023 },
  { ein: "237071797", name: "General Motors Foundation",     grants:    2_400_000, year: 2023 },
];

function buildPropublicaResponse(row) {
  return {
    organization: { ein: row.ein, name: row.name, ntee_code: "T20" },
    filings_with_data: [
      { tax_prd_yr: row.year, grntspaidprgmsrvcs: row.grants, totcntrbgfts: row.grants * 1.1 },
      { tax_prd_yr: row.year - 1, grntspaidprgmsrvcs: row.grants * 0.9, totcntrbgfts: row.grants },
    ],
  };
}

// ─────────────────────────────── tests ───────────────────────────────

test("SEED is non-empty and well-formed", () => {
  assert.ok(Array.isArray(SEED));
  assert.ok(SEED.length > 100, `SEED has ${SEED.length} entries, want > 100`);
  for (const s of SEED.slice(0, 10)) {
    assert.ok(s.slug, "every seed has a slug");
    assert.ok(typeof s.latestTotalUsd === "number", "every seed has a numeric latestTotalUsd");
    assert.ok(s.sourceUrl, "every seed has a sourceUrl");
    assert.ok(typeof s.year === "number" && s.year >= 2020 && s.year <= 2030, "year sane");
  }
});

test("SEED_BULK rows have 7 columns", () => {
  for (const row of SEED_BULK.slice(0, 5)) {
    assert.equal(row.length, 7, `bulk row should be [slug, foundationName, ein, total, pct, year, url]`);
  }
});

test("expandedSeed merges SEED + SEED_BULK + CHILD_INHERIT to a flat array", () => {
  const arr = expandedSeed();
  assert.ok(arr.length >= SEED.length + 10, "expanded includes bulk + inherit");
  const slugs = arr.map(s => s.slug);
  assert.equal(new Set(slugs).size, slugs.length, "no duplicate slugs after expansion");
  assert.ok(arr.length > 500, `target ≥500 entries, got ${arr.length}`);
});

test("CHILD_INHERIT only references parents that exist in SEED + SEED_BULK", () => {
  const parentSlugs = new Set([
    ...SEED.map(s => SLUG_REMAP[s.slug] || s.slug),
    ...SEED_BULK.map(r => SLUG_REMAP[r[0]] || r[0]),
  ]);
  for (const [child, parent] of CHILD_INHERIT) {
    assert.ok(parentSlugs.has(parent), `CHILD_INHERIT child "${child}" references unknown parent "${parent}"`);
  }
});

test("normalizeEin strips formatting", () => {
  assert.equal(normalizeEin("20-5639919"), "205639919");
  assert.equal(normalizeEin("205639919"), "205639919");
  assert.equal(normalizeEin("20 5639919"), "205639919");
  assert.equal(normalizeEin(null), null);
  assert.equal(normalizeEin("invalid"), null);
  assert.equal(normalizeEin("12345"), null, "too short = invalid");
});

test("formatEin rebuilds the dashed form", () => {
  assert.equal(formatEin("205639919"), "20-5639919");
  assert.equal(formatEin("20-5639919"), "20-5639919");
  assert.equal(formatEin(null), null);
});

test("fmtUsd handles all scales", () => {
  assert.equal(fmtUsd(1_730_000_000), "$1.73B");
  assert.equal(fmtUsd(85_000_000), "$85.0M");
  assert.equal(fmtUsd(500), "$500");
  assert.equal(fmtUsd(0), "$0");
  assert.equal(fmtUsd(null), "$0");
});

test("buildRecord (dry mode, no propublica) returns a clean charity record", () => {
  const seed = SEED[0]; // walmart
  const rec = buildRecord(seed, null);
  assert.equal(rec.slug, "walmart");
  assert.equal(rec.foundationName, "Walmart Foundation");
  assert.equal(rec.ein, "20-5639919", "ein is formatted XX-XXXXXXX");
  assert.equal(rec.totalGivingUsd, 1_730_000_000);
  assert.equal(rec.year, 2024);
  assert.equal(rec.source, "corporate-disclosure");
  assert.equal(rec.status, "ok");
  assert.equal(rec.foundation990, undefined, "no 990 block in dry mode");
});

test("buildRecord (blend mode) tags source as blend when propublica refreshes 990", () => {
  const seed = SEED[0];
  const pp = { totalGrants: 85_400_000, fiscalYear: 2023, url: "https://example.com" };
  const rec = buildRecord(seed, pp);
  assert.equal(rec.source, "blend");
  assert.deepEqual(rec.foundation990, {
    totalGrants: 85_400_000,
    fiscalYear: 2023,
    propublicaUrl: "https://example.com",
  });
});

test("parsePropublicaOrg picks the most recent filing by tax_prd_yr", () => {
  const fixture = buildPropublicaResponse(FIXTURE_PROPUBLICA_ORGS[0]);
  const parsed = parsePropublicaOrg(fixture);
  assert.ok(parsed);
  assert.equal(parsed.fiscalYear, 2023, "newest year");
  assert.equal(parsed.totalGrants, 85_400_000);
  assert.ok(parsed.url.includes("205639919"));
});

test("parsePropublicaOrg returns null for missing/empty payloads", () => {
  assert.equal(parsePropublicaOrg(null), null);
  assert.equal(parsePropublicaOrg({}), null);
  assert.equal(parsePropublicaOrg({ filings_with_data: [] }), null);
});

test("parsePropublicaOrg sorts unsorted filings", () => {
  const fixture = {
    organization: { ein: "111111111" },
    filings_with_data: [
      { tax_prd_yr: 2020, grntspaidprgmsrvcs: 100 },
      { tax_prd_yr: 2023, grntspaidprgmsrvcs: 999 },
      { tax_prd_yr: 2021, grntspaidprgmsrvcs: 500 },
    ],
  };
  const parsed = parsePropublicaOrg(fixture);
  assert.equal(parsed.fiscalYear, 2023);
  assert.equal(parsed.totalGrants, 999);
});

test("buildCharityBlock (merger) preserves all top-line fields", () => {
  const rec = buildRecord(SEED[0], null);
  const block = buildCharityBlock(rec);
  assert.equal(block.totalGivingUsd, 1_730_000_000);
  assert.equal(block.foundationName, "Walmart Foundation");
  assert.equal(block.ein, "20-5639919");
  assert.equal(block.pctRevenue, 0.0027);
  assert.equal(block.year, 2024);
  assert.equal(block.source, "corporate-disclosure");
});

test("buildCharityBlock attaches foundation990 sub-record when present", () => {
  const rec = buildRecord(SEED[0], { totalGrants: 1, fiscalYear: 2023, url: "u" });
  const block = buildCharityBlock(rec);
  assert.ok(block.foundation990);
  assert.equal(block.foundation990.fiscalYear, 2023);
});

test("FIXTURE: all 40 propublica fixtures round-trip parse cleanly", () => {
  for (const row of FIXTURE_PROPUBLICA_ORGS) {
    const fixture = buildPropublicaResponse(row);
    const parsed = parsePropublicaOrg(fixture);
    assert.equal(parsed.totalGrants, row.grants, `${row.name} grants`);
    assert.equal(parsed.fiscalYear, row.year, `${row.name} year`);
    assert.ok(parsed.url.includes(row.ein), `${row.name} url contains EIN`);
  }
});

test("SLUG_REMAP only contains string→string entries", () => {
  for (const [k, v] of Object.entries(SLUG_REMAP)) {
    assert.equal(typeof k, "string");
    assert.equal(typeof v, "string");
    assert.notEqual(v, "", `${k} maps to empty string`);
  }
});

test("expandedSeed inherits parent giving onto children via CHILD_INHERIT", () => {
  const arr = expandedSeed();
  const bySlug = Object.fromEntries(arr.map(s => [s.slug, s]));
  // pick a child we know is in CHILD_INHERIT
  const [childSlug, parentSlug] = CHILD_INHERIT[0]; // bounty -> procter-and-gamble
  assert.ok(bySlug[parentSlug], `parent ${parentSlug} present`);
  assert.ok(bySlug[childSlug], `child ${childSlug} present`);
  assert.equal(
    bySlug[childSlug].latestTotalUsd,
    bySlug[parentSlug].latestTotalUsd,
    "child inherits parent's disclosed total"
  );
  assert.equal(
    bySlug[childSlug].sourceUrl,
    bySlug[parentSlug].sourceUrl,
    "child inherits parent's source url"
  );
});

test("SEED contains all required mega-givers (sanity)", () => {
  const slugs = new Set(SEED.map(s => SLUG_REMAP[s.slug] || s.slug));
  for (const required of [
    "walmart", "microsoft", "apple", "amazon", "pfizer", "merck",
    "johnson-and-johnson", "berkshire-hathaway", "jpmorgan-chase",
    "wells-fargo", "exxon-mobil", "chevron", "nike", "coca-cola"
  ]) {
    assert.ok(slugs.has(required), `mega-giver "${required}" present in SEED`);
  }
});
