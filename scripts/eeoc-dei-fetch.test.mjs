#!/usr/bin/env node
/**
 * Tests for eeoc-dei-fetch.mjs + eeoc-dei-merge.mjs.
 *
 * Uses node:test (Node 20+). No network. Validates:
 *   - validateRow() catches schema problems
 *   - buildRecord() produces the right shape for valid + null-metric rows
 *   - buildDeiBlock() preserves the EEOC corroborating-source URL
 *   - Every registry row passes schema validation
 *   - No duplicate slugs in registry
 *   - The 50-row fixture below converts cleanly end-to-end
 *
 * Local: node --test scripts/eeoc-dei-fetch.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  REGISTRY,
  buildRecord,
  validateRow,
} from "./eeoc-dei-fetch.mjs";
import { buildDeiBlock } from "./eeoc-dei-merge.mjs";

// ─── 50-row fixture covering the major industries.
// Each row is a minimal registry entry with realistic numbers. Mix in
// a few "edge" rows (null metrics, mid-range, very-high) so the parser
// and validator both get hit.
export const FIXTURE = [
  { slug: "apple",            name: "Apple",            year: 2023, women_all_pct: 35, women_leadership_pct: 31, minority_pct: 50, url: "https://www.apple.com/diversity/" },
  { slug: "microsoft",        name: "Microsoft",        year: 2023, women_all_pct: 33, women_leadership_pct: 30, minority_pct: 56, url: "https://www.microsoft.com/diversity" },
  { slug: "google-alphabet",  name: "Google",           year: 2023, women_all_pct: 34, women_leadership_pct: 31, minority_pct: 54, url: "https://about.google/belonging/diversity-annual-report/" },
  { slug: "amazon",           name: "Amazon",           year: 2022, women_all_pct: 46, women_leadership_pct: 30, minority_pct: 54, url: "https://www.aboutamazon.com/workplace/diversity-inclusion" },
  { slug: "meta-platforms",   name: "Meta",             year: 2023, women_all_pct: 37, women_leadership_pct: 36, minority_pct: 51, url: "https://about.meta.com/diversity/" },
  { slug: "netflix",          name: "Netflix",          year: 2023, women_all_pct: 52, women_leadership_pct: 53, minority_pct: 53, url: "https://about.netflix.com/en/inclusion" },
  { slug: "walmart",          name: "Walmart",          year: 2023, women_all_pct: 53, women_leadership_pct: 47, minority_pct: 53, url: "https://corporate.walmart.com/dei" },
  { slug: "target",           name: "Target",           year: 2023, women_all_pct: 56, women_leadership_pct: 51, minority_pct: 53, url: "https://corporate.target.com/dei" },
  { slug: "costco",           name: "Costco",           year: 2023, women_all_pct: 45, women_leadership_pct: 26, minority_pct: 50, url: "https://www.costco.com/sustainability-people.html" },
  { slug: "home-depot",       name: "Home Depot",       year: 2023, women_all_pct: 39, women_leadership_pct: 32, minority_pct: 56, url: "https://corporate.homedepot.com/" },
  { slug: "starbucks",        name: "Starbucks",        year: 2023, women_all_pct: 71, women_leadership_pct: 65, minority_pct: 51, url: "https://stories.starbucks.com/inclusion-and-diversity/" },
  { slug: "mcdonalds",        name: "McDonald's",       year: 2023, women_all_pct: 60, women_leadership_pct: 44, minority_pct: 51, url: "https://corporate.mcdonalds.com/dei" },
  { slug: "coca-cola",        name: "Coca-Cola",        year: 2023, women_all_pct: 45, women_leadership_pct: 39, minority_pct: 51, url: "https://www.coca-colacompany.com/dei" },
  { slug: "pepsi",            name: "PepsiCo",          year: 2023, women_all_pct: 44, women_leadership_pct: 41, minority_pct: 43, url: "https://www.pepsico.com/dei" },
  { slug: "pfizer",           name: "Pfizer",           year: 2023, women_all_pct: 53, women_leadership_pct: 49, minority_pct: 49, url: "https://www.pfizer.com/about/responsibility/equity" },
  { slug: "johnson-and-johnson", name: "Johnson & Johnson", year: 2023, women_all_pct: 49, women_leadership_pct: 49, minority_pct: 48, url: "https://www.jnj.com/dei" },
  { slug: "merck",            name: "Merck",            year: 2023, women_all_pct: 49, women_leadership_pct: 48, minority_pct: 43, url: "https://www.merck.com/inclusion/" },
  { slug: "moderna",          name: "Moderna",          year: 2023, women_all_pct: 53, women_leadership_pct: 45, minority_pct: 53, url: "https://www.modernatx.com/dei" },
  { slug: "unitedhealth-group", name: "UnitedHealth Group", year: 2023, women_all_pct: 70, women_leadership_pct: 55, minority_pct: 49, url: "https://www.unitedhealthgroup.com/dei" },
  { slug: "cvs-health",       name: "CVS Health",       year: 2023, women_all_pct: 73, women_leadership_pct: 60, minority_pct: 47, url: "https://www.cvshealth.com/dei" },
  { slug: "jpmorgan-chase",   name: "JPMorgan Chase",   year: 2023, women_all_pct: 49, women_leadership_pct: 35, minority_pct: 53, url: "https://www.jpmorganchase.com/dei" },
  { slug: "bank-of-america",  name: "Bank of America",  year: 2023, women_all_pct: 51, women_leadership_pct: 40, minority_pct: 50, url: "https://about.bankofamerica.com/dei" },
  { slug: "wells-fargo",      name: "Wells Fargo",      year: 2023, women_all_pct: 56, women_leadership_pct: 47, minority_pct: 48, url: "https://www.wellsfargo.com/about/diversity/" },
  { slug: "goldman-sachs",    name: "Goldman Sachs",    year: 2023, women_all_pct: 41, women_leadership_pct: 28, minority_pct: 46, url: "https://www.goldmansachs.com/dei" },
  { slug: "visa",             name: "Visa",             year: 2023, women_all_pct: 47, women_leadership_pct: 39, minority_pct: 56, url: "https://corporate.visa.com/dei" },
  { slug: "mastercard",       name: "Mastercard",       year: 2023, women_all_pct: 47, women_leadership_pct: 42, minority_pct: 54, url: "https://www.mastercard.us/dei" },
  { slug: "verizon",          name: "Verizon",          year: 2023, women_all_pct: 36, women_leadership_pct: 35, minority_pct: 60, url: "https://www.verizon.com/dei" },
  { slug: "atandt",           name: "AT&T",             year: 2023, women_all_pct: 34, women_leadership_pct: 33, minority_pct: 50, url: "https://about.att.com/dei" },
  { slug: "comcast",          name: "Comcast",          year: 2023, women_all_pct: 36, women_leadership_pct: 36, minority_pct: 47, url: "https://corporate.comcast.com/dei" },
  { slug: "disney",           name: "Disney",           year: 2023, women_all_pct: 51, women_leadership_pct: 47, minority_pct: 49, url: "https://thewaltdisneycompany.com/dei" },
  { slug: "exxon-mobil",      name: "ExxonMobil",       year: 2023, women_all_pct: 31, women_leadership_pct: 28, minority_pct: 42, url: "https://corporate.exxonmobil.com/dei" },
  { slug: "chevron",          name: "Chevron",          year: 2023, women_all_pct: 30, women_leadership_pct: 28, minority_pct: 49, url: "https://www.chevron.com/dei" },
  { slug: "boeing",           name: "Boeing",           year: 2023, women_all_pct: 24, women_leadership_pct: 26, minority_pct: 35, url: "https://www.boeing.com/dei" },
  { slug: "lockheed-martin",  name: "Lockheed Martin",  year: 2023, women_all_pct: 24, women_leadership_pct: 25, minority_pct: 30, url: "https://www.lockheedmartin.com/dei" },
  { slug: "honeywell",        name: "Honeywell",        year: 2023, women_all_pct: 30, women_leadership_pct: 28, minority_pct: 35, url: "https://www.honeywell.com/dei" },
  { slug: "caterpillar",      name: "Caterpillar",      year: 2023, women_all_pct: 23, women_leadership_pct: 24, minority_pct: 30, url: "https://www.caterpillar.com/dei" },
  { slug: "ford",             name: "Ford Motor",       year: 2023, women_all_pct: 26, women_leadership_pct: 27, minority_pct: 40, url: "https://corporate.ford.com/dei" },
  { slug: "general-motors",   name: "General Motors",   year: 2023, women_all_pct: 29, women_leadership_pct: 26, minority_pct: 36, url: "https://www.gm.com/dei" },
  { slug: "tesla",            name: "Tesla",            year: 2022, women_all_pct: 24, women_leadership_pct: 22, minority_pct: 60, url: "https://www.tesla.com/diversity" },
  { slug: "fedex",            name: "FedEx",            year: 2023, women_all_pct: 27, women_leadership_pct: 28, minority_pct: 50, url: "https://www.fedex.com/dei" },
  { slug: "ups",              name: "UPS",              year: 2023, women_all_pct: 26, women_leadership_pct: 32, minority_pct: 49, url: "https://about.ups.com/dei" },
  { slug: "nike",             name: "Nike",             year: 2023, women_all_pct: 50, women_leadership_pct: 43, minority_pct: 41, url: "https://about.nike.com/en/impact" },
  { slug: "accenture",        name: "Accenture",        year: 2023, women_all_pct: 48, women_leadership_pct: 30, minority_pct: 50, url: "https://www.accenture.com/dei" },
  { slug: "deloitte",         name: "Deloitte",         year: 2023, women_all_pct: 49, women_leadership_pct: 37, minority_pct: 43, url: "https://www2.deloitte.com/dei" },
  { slug: "ibm",              name: "IBM",              year: 2023, women_all_pct: 33, women_leadership_pct: 29, minority_pct: 45, url: "https://www.ibm.com/impact/be-equal" },
  { slug: "oracle",           name: "Oracle",           year: 2022, women_all_pct: 30, women_leadership_pct: 26, minority_pct: 50, url: "https://www.oracle.com/dei" },
  { slug: "intel",            name: "Intel",            year: 2023, women_all_pct: 28, women_leadership_pct: 24, minority_pct: 53, url: "https://www.intel.com/dei" },
  { slug: "marriott",         name: "Marriott",         year: 2023, women_all_pct: 56, women_leadership_pct: 50, minority_pct: 67, url: "https://www.marriott.com/dei" },
  { slug: "hilton",           name: "Hilton",           year: 2023, women_all_pct: 53, women_leadership_pct: 48, minority_pct: 63, url: "https://www.hilton.com/dei" },
  { slug: "delta-air-lines",  name: "Delta Air Lines",  year: 2023, women_all_pct: 47, women_leadership_pct: 43, minority_pct: 47, url: "https://www.delta.com/dei" },
];

// ─── validateRow ───────────────────────────────────────────────

test("validateRow accepts a clean row", () => {
  assert.deepEqual(validateRow(FIXTURE[0]), []);
});

test("validateRow rejects missing slug", () => {
  const errs = validateRow({ ...FIXTURE[0], slug: undefined });
  assert.ok(errs.some(e => /slug/i.test(e)), `expected slug error, got ${errs}`);
});

test("validateRow rejects invalid URL", () => {
  const errs = validateRow({ ...FIXTURE[0], url: "not-a-url" });
  assert.ok(errs.some(e => /url/i.test(e)));
});

test("validateRow rejects out-of-range percentage", () => {
  const errs = validateRow({ ...FIXTURE[0], women_all_pct: 150 });
  assert.ok(errs.some(e => /women_all_pct/.test(e)), `expected percentage error, got ${errs}`);
});

test("validateRow rejects negative percentage", () => {
  const errs = validateRow({ ...FIXTURE[0], minority_pct: -5 });
  assert.ok(errs.some(e => /minority_pct/.test(e)));
});

test("validateRow rejects implausible year", () => {
  const errs = validateRow({ ...FIXTURE[0], year: 1990 });
  assert.ok(errs.some(e => /year/i.test(e)));
});

test("validateRow accepts null metric values", () => {
  const errs = validateRow({ ...FIXTURE[0], women_leadership_pct: null });
  assert.deepEqual(errs, []);
});

// ─── buildRecord ───────────────────────────────────────────────

test("buildRecord produces expected shape", () => {
  const r = buildRecord(FIXTURE[0]);
  assert.equal(r.dei.womenAllRolesPct, 35);
  assert.equal(r.dei.womenLeadershipPct, 31);
  assert.equal(r.dei.racialEthnicMinorityPct, 50);
  assert.equal(r.dei.source, "voluntary-corporate-disclosure");
  assert.equal(r.dei.year, 2023);
  assert.equal(r.dei.sourceUrl, "https://www.apple.com/diversity/");
  assert.equal(r._name, "Apple");
  assert.equal(r._url_status, null);
});

test("buildRecord returns null when all metrics are null", () => {
  const r = buildRecord({
    slug: "x", name: "X", year: 2023, url: "https://x.com",
    women_all_pct: null, women_leadership_pct: null, minority_pct: null,
  });
  assert.equal(r, null);
});

test("buildRecord includes urlStatus when provided", () => {
  const r = buildRecord(FIXTURE[0], { ok: true, status: 200 });
  assert.deepEqual(r._url_status, { ok: true, status: 200 });
});

// ─── buildDeiBlock ─────────────────────────────────────────────

test("buildDeiBlock attaches EEOC corroborating-source URL", () => {
  const raw = buildRecord(FIXTURE[0]);
  const block = buildDeiBlock(raw);
  assert.equal(block.womenAllRolesPct, 35);
  assert.equal(block.eeocCorroboratingSource,
    "https://www.eeoc.gov/statistics/employment/eeo1-public-use-aggregate-reports");
  assert.equal(block.source, "voluntary-corporate-disclosure");
});

test("buildDeiBlock handles missing fields gracefully", () => {
  const block = buildDeiBlock({ dei: {} });
  assert.equal(block.womenAllRolesPct, null);
  assert.equal(block.womenLeadershipPct, null);
  assert.equal(block.racialEthnicMinorityPct, null);
  assert.equal(block.source, "voluntary-corporate-disclosure");
  assert.equal(block.year, null);
  assert.equal(block.sourceUrl, null);
  // Corroborating EEOC source URL is always populated.
  assert.ok(/eeoc\.gov/.test(block.eeocCorroboratingSource));
});

// ─── fixture roundtrip ─────────────────────────────────────────

test("fixture has 50 rows", () => {
  assert.equal(FIXTURE.length, 50, `expected 50 rows, got ${FIXTURE.length}`);
});

test("all fixture rows pass validation", () => {
  for (const row of FIXTURE) {
    assert.deepEqual(validateRow(row), [], `row ${row.slug} failed: ${validateRow(row).join("; ")}`);
  }
});

test("fixture roundtrips through buildRecord -> buildDeiBlock", () => {
  for (const row of FIXTURE) {
    const rec = buildRecord(row);
    assert.ok(rec, `row ${row.slug} produced null record`);
    const block = buildDeiBlock(rec);
    assert.equal(block.womenAllRolesPct, row.women_all_pct);
    assert.equal(block.womenLeadershipPct, row.women_leadership_pct);
    assert.equal(block.racialEthnicMinorityPct, row.minority_pct);
    assert.equal(block.year, row.year);
    assert.equal(block.sourceUrl, row.url);
  }
});

// ─── REGISTRY sanity ──────────────────────────────────────────

test("every REGISTRY row passes validation", () => {
  const errors = [];
  for (const row of REGISTRY) {
    const errs = validateRow(row);
    if (errs.length) errors.push({ slug: row.slug, errs });
  }
  assert.equal(errors.length, 0,
    `Invalid REGISTRY rows: ${JSON.stringify(errors.slice(0, 5))}`);
});

test("REGISTRY has no duplicate slugs", () => {
  const seen = new Map();
  const dupes = [];
  for (const row of REGISTRY) {
    if (seen.has(row.slug)) dupes.push(row.slug);
    else seen.set(row.slug, true);
  }
  assert.deepEqual(dupes, [], `Duplicate slugs: ${dupes.join(", ")}`);
});

test("REGISTRY has at least 200 rows", () => {
  assert.ok(REGISTRY.length >= 200,
    `Expected >=200 registry rows, got ${REGISTRY.length}`);
});

test("REGISTRY rows all have HTTPS source URLs", () => {
  const bad = REGISTRY.filter(r => !/^https:\/\//.test(r.url));
  assert.deepEqual(bad.map(b => b.slug), [],
    `Non-HTTPS URLs: ${bad.map(b => b.slug).join(", ")}`);
});
