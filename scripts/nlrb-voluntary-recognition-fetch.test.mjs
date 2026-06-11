#!/usr/bin/env node
/**
 * Unit tests for the NLRB voluntary-recognition pipeline (sprint G).
 *
 * Uses node:test. Exercises the parser, pagination, slug-resolver, and
 * augment-builder against handcrafted HTML fixtures under
 * test/fixtures/nlrb-voluntary-recognition/. No network calls.
 *
 * Locally:
 *   node --test scripts/nlrb-voluntary-recognition-fetch.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseSearchResults,
  parseCaseType,
  normalizeDate,
  parseWorkers,
  isVoluntaryRecognition,
  findNextPageUrl,
  decodeEntities,
  stripTags,
  parseCsv,
  csvRowToEntry,
  extractCacheId,
  buildFilterUrl,
  VR_CASE_TYPES,
  VR_DISPOSITION_PATTERNS,
  BASE_SEARCH_URL,
  DATA_URL,
} from "./nlrb-voluntary-recognition-fetch.mjs";
import { slugify, resolveSlug, buildAugment, entryPayload } from "./nlrb-voluntary-recognition-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(ROOT, "test/fixtures/nlrb-voluntary-recognition");

const loadFixture = (name) => fs.readFile(path.join(FIX, `${name}.html`), "utf-8");
const findRow = (rows, caseNumber) => rows.find(r => r.case_number === caseNumber);

/* --------------------------------------------------------- pure utilities */

test("decodeEntities + stripTags", () => {
  assert.equal(decodeEntities("Trader Joe&apos;s"), "Trader Joe's");
  assert.equal(decodeEntities("AT&amp;T"), "AT&T");
  assert.equal(stripTags("<span>  hello <b>world</b>  </span>"), "hello world");
});

test("parseCaseType extracts RM/RC/UC tokens", () => {
  assert.equal(parseCaseType("13-RM-294317"), "RM");
  assert.equal(parseCaseType("07-RC-318274"), "RC");
  assert.equal(parseCaseType("19-UC-301122"), "UC");
  assert.equal(parseCaseType("22-CA-300000"), "CA"); // unfair-labor-practice, not VR
  assert.equal(parseCaseType("garbage"), null);
  assert.equal(parseCaseType(null), null);
});

test("normalizeDate covers the three formats CATS emits", () => {
  assert.equal(normalizeDate("2026-03-12"), "2026-03-12");
  assert.equal(normalizeDate("3/12/2026"), "2026-03-12");
  assert.equal(normalizeDate("March 12, 2026"), "2026-03-12");
  assert.equal(normalizeDate(""), null);
  assert.equal(normalizeDate("not a date at all"), null);
});

test("parseWorkers tolerates label noise", () => {
  assert.equal(parseWorkers("42 employees"), 42);
  assert.equal(parseWorkers("Unit size: 88"), 88);
  assert.equal(parseWorkers("110 in unit"), 110);
  assert.equal(parseWorkers("305"), 305);
  assert.equal(parseWorkers("1,250 workers"), 1250);
  assert.equal(parseWorkers(""), null);
  assert.equal(parseWorkers("none"), null);
});

test("isVoluntaryRecognition discriminates correctly", () => {
  assert.ok(isVoluntaryRecognition("Voluntary Recognition"));
  assert.ok(isVoluntaryRecognition("Voluntarily recognized — withdrawn"));
  assert.ok(isVoluntaryRecognition("Vol. Rec."));
  assert.ok(isVoluntaryRecognition("Voluntary Recognition Bar — VRB filed"));
  assert.ok(!isVoluntaryRecognition("Complaint issued — ULP charge"));
  assert.ok(!isVoluntaryRecognition("Election held, certified"));
  assert.ok(!isVoluntaryRecognition(""));
});

test("VR_CASE_TYPES limited to representation petitions", () => {
  assert.ok(VR_CASE_TYPES.has("RM"));
  assert.ok(VR_CASE_TYPES.has("RC"));
  assert.ok(VR_CASE_TYPES.has("UC"));
  assert.ok(!VR_CASE_TYPES.has("CA"));
  assert.ok(!VR_CASE_TYPES.has("CB"));
});

test("VR_DISPOSITION_PATTERNS contains the four expected matchers", () => {
  assert.equal(VR_DISPOSITION_PATTERNS.length, 4);
});

test("BASE_SEARCH_URL points at the Recent Filings representation-case filter", () => {
  // 2026-06: /search/case dropped browse-all + the numeric case_type facet
  // and no longer exposes dispositions; the pipeline now rides the Recent
  // Filings CSV export (see fetcher header).
  assert.match(BASE_SEARCH_URL, /^https:\/\/www\.nlrb\.gov\/reports\/graphs-data\/recent-filings/);
  assert.match(BASE_SEARCH_URL, /case_type%3AR/);
});

test("buildFilterUrl appends the mm/dd/yyyy date window", () => {
  const url = buildFilterUrl("06/11/2025", "06/10/2026");
  assert.match(url, new RegExp(`^${DATA_URL.replace(/[/.]/g, m => `\\${m}`)}\\?`));
  assert.match(url, /f%5B0%5D=case_type%3AR/);
  assert.match(url, /date_start=06%2F11%2F2025/);
  assert.match(url, /date_end=06%2F10%2F2026/);
});

/* ----------------------------------------------- CSV export path (live) */

test("parseCsv: quoted fields with embedded commas + newlines", () => {
  const rows = parseCsv('A,B,C\n"x, y","line1\nline2","say ""hi"""\nplain,2,3\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { A: "x, y", B: "line1\nline2", C: 'say "hi"' });
  assert.deepEqual(rows[1], { A: "plain", B: "2", C: "3" });
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("only,a,header\n"), []);
});

test("csvRowToEntry: accepts VR representation rows, rejects everything else", () => {
  const base = {
    "Name": "Starbucks Corporation",
    "Case Number": "13-RM-294317",
    "City": "Chicago",
    "States & Territories": "IL",
    "Date Closed": "03/12/2026",
    "Reason Closed": "Voluntary Recognition",
    "No. of Employees": "42",
    "Certified Representative": "Workers United, SEIU",
  };
  const e = csvRowToEntry(base);
  assert.ok(e, "VR RM row accepted");
  assert.equal(e.case_type, "RM");
  assert.equal(e.employer, "Starbucks Corporation");
  assert.equal(e.union, "Workers United, SEIU");
  assert.equal(e.recognition_date, "2026-03-12");
  assert.equal(e.location, "Chicago, IL");
  assert.equal(e.workers, 42);
  assert.equal(e.source_url, "https://www.nlrb.gov/case/13-RM-294317");

  // ULP charge — wrong case type.
  assert.equal(csvRowToEntry({ ...base, "Case Number": "22-CA-300000" }), null);
  // Real-world close methods that are NOT explicit voluntary recognitions.
  assert.equal(csvRowToEntry({ ...base, "Reason Closed": "Certific. of Representative" }), null);
  assert.equal(csvRowToEntry({ ...base, "Reason Closed": "Withdrawal Adjusted" }), null,
    "Withdrawal Adjusted is often VR-resolved in practice but the data does not say so — never inferred");
  assert.equal(csvRowToEntry({ ...base, "Reason Closed": "" }), null, "open cases skipped");
});

test("extractCacheId pulls the export cache token from the filtered page", () => {
  const html = '<a id="download-button" data-typeofreport="recent_filings" ' +
    'data-cacheid="recent_filings_data___abc123">Download CSV</a>';
  assert.equal(extractCacheId(html), "recent_filings_data___abc123");
  assert.equal(extractCacheId("<div>no export</div>"), null);
  assert.equal(extractCacheId(""), null);
});

test("CSV fixture end-to-end: 2 VR entries out of 6 rows", async () => {
  const csv = await fs.readFile(path.join(FIX, "recent-filings.csv"), "utf-8");
  const rows = parseCsv(csv);
  assert.equal(rows.length, 6);
  const entries = rows.map(csvRowToEntry).filter(Boolean);
  assert.equal(entries.length, 2, "Starbucks (explicit VR) + Apple (withdrawn after VR)");
  assert.deepEqual(entries.map(e => e.case_number).sort(),
    ["07-RC-318274", "13-RM-294317"]);
});

/* ------------------------------------------- parser (LEGACY search pages) */

test("parseSearchResults: page-1 captures both table + card shapes", async () => {
  const html = await loadFixture("page-1");
  const { rows, skipped } = parseSearchResults(html);

  // 5 table VR rows + 2 card VR rows = 7 hits on page-1.
  // (Trader Joe's = certified election, Amazon = ULP, "Mystery Co." missing
  // case number — all three skipped.)
  assert.equal(rows.length, 7, `expected 7 VR hits, got ${rows.length}`);
  assert.ok(skipped >= 1, "Mystery Co. row should be skipped");

  const sbux = findRow(rows, "13-RM-294317");
  assert.ok(sbux, "Starbucks Chicago present");
  assert.equal(sbux.case_type, "RM");
  assert.equal(sbux.employer, "Starbucks Corporation");
  assert.equal(sbux.union, "Workers United, SEIU");
  assert.equal(sbux.recognition_date, "2026-03-12");
  assert.equal(sbux.location, "Chicago, IL");
  assert.equal(sbux.workers, 42);
  assert.equal(sbux.source_url, "https://www.nlrb.gov/case/13-RM-294317");

  const apple = findRow(rows, "07-RC-318274");
  assert.ok(apple, "Apple Towson present");
  assert.equal(apple.employer, "Apple Inc.");
  assert.equal(apple.workers, 110);

  const msft = findRow(rows, "27-RM-275111");
  assert.ok(msft, "Microsoft (card shape) present");
  assert.equal(msft.employer, "Microsoft Corporation");
  assert.equal(msft.workers, 305);

  // Excluded: ULP (CA case type) and certified election.
  assert.equal(findRow(rows, "22-CA-300000"), undefined, "CA case must be excluded");
  assert.equal(findRow(rows, "14-RC-292001"), undefined, "Non-VR disposition must be excluded");
});

test("parseSearchResults: page-2 + dedupe (page-1 overlap)", async () => {
  const page1 = await loadFixture("page-1");
  const page2 = await loadFixture("page-2");
  const all = [...parseSearchResults(page1).rows, ...parseSearchResults(page2).rows];

  // Manual dedupe by case_number to mirror the fetcher's seen-map step.
  const byCase = new Map();
  for (const r of all) byCase.set(r.case_number, r);
  assert.equal(byCase.size, 8, "page-1 + page-2 should dedupe to 8 unique cases (Walmart added; Starbucks dup folded)");
});

test("findNextPageUrl: detects rel=next + returns null when missing", async () => {
  const page1 = await loadFixture("page-1");
  const page2 = await loadFixture("page-2");
  const next1 = findNextPageUrl(page1);
  assert.ok(next1?.startsWith("https://www.nlrb.gov/search/case"), `expected nlrb absolute URL, got ${next1}`);
  assert.equal(findNextPageUrl(page2), null, "page-2 has no pager => walker stops");
  assert.equal(findNextPageUrl(""), null);
});

/* ---------------------------------------------------------- slug-resolver */

test("slugify strips corporate suffixes + apostrophes", () => {
  assert.equal(slugify("Starbucks Corporation"), "starbucks");
  assert.equal(slugify("Apple Inc."), "apple");
  assert.equal(slugify("Chipotle Mexican Grill, Inc."), "chipotle-mexican-grill");
  assert.equal(slugify("Trader Joe's"), "trader-joes");
  assert.equal(slugify("REI Co-op"), "rei-co-op");
  assert.equal(slugify("AT&T"), "at-and-t");
});

test("resolveSlug: direct hit on real company file (starbucks)", async () => {
  const maps = { aliases: {}, parents: {} };
  const r = resolveSlug("Starbucks Corporation", maps);
  assert.equal(r.slug, "starbucks");
  assert.equal(r.routed_via, "direct");
});

test("resolveSlug: orphan returns null", () => {
  const maps = { aliases: {}, parents: {} };
  const r = resolveSlug("Totally Made Up Industries Inc.", maps);
  assert.equal(r.slug, null);
  assert.equal(r.routed_via, "orphan");
});

test("resolveSlug: alias routing", () => {
  const maps = {
    aliases: { "msft": "microsoft" },
    parents: {},
  };
  const r = resolveSlug("MSFT", maps);
  assert.equal(r.slug, "microsoft");
  assert.equal(r.routed_via, "alias");
});

test("resolveSlug: parent routing falls back when brand is unknown", () => {
  const maps = {
    aliases: {},
    parents: { "made-up-subsidiary": { parent: "apple" } },
  };
  const r = resolveSlug("Made Up Subsidiary", maps);
  assert.equal(r.slug, "apple");
  assert.equal(r.routed_via, "parent");
});

/* -------------------------------------------------------- augment builder */

test("entryPayload keeps only display-relevant fields", () => {
  const e = {
    case_number: "13-RM-294317",
    case_type: "RM",
    employer: "Starbucks Corporation", // not in payload
    union: "Workers United, SEIU",
    recognition_date: "2026-03-12",
    location: "Chicago, IL",
    workers: 42,
    disposition: "Closed — Voluntary Recognition",
    source_url: "https://www.nlrb.gov/case/13-RM-294317",
  };
  const p = entryPayload(e);
  assert.ok(!("employer" in p), "employer is keyed at the slug level, not per-entry");
  assert.equal(p.case_number, "13-RM-294317");
  assert.equal(p.union, "Workers United, SEIU");
  assert.equal(p.workers, 42);
});

test("buildAugment: aggregates per-slug + positive-signal annotation", async () => {
  const html = await loadFixture("page-1");
  const { rows } = parseSearchResults(html);
  const { companies, orphans } = buildAugment(rows, { aliases: {}, parents: {} });

  // Starbucks appears twice on page-1 (Chicago + Buffalo).
  const sbux = companies["starbucks"];
  assert.ok(sbux, "starbucks matched");
  assert.equal(sbux.labor.voluntaryRecogCount, 2);
  assert.equal(sbux.labor.signal, "positive", "POSITIVE labor signal annotation");
  assert.ok(Array.isArray(sbux.labor.voluntaryRecognitions));
  assert.equal(sbux.labor.voluntaryRecognitions[0].recognition_date, "2026-03-12",
    "most recent recognition sorted first");
  assert.equal(sbux.labor.lastRecognitionDate, "2026-03-12");
  assert.equal(sbux.labor.workersUnionized, 73, "42 + 31");
  assert.equal(sbux.routedVia, "direct");
  assert.match(sbux.labor.sourceUrl, /nlrb\.gov/);

  // Apple (1 recognition).
  assert.ok(companies["apple"]);
  assert.equal(companies["apple"].labor.voluntaryRecogCount, 1);
  assert.equal(companies["apple"].labor.workersUnionized, 110);

  // Chipotle's slugified name is "chipotle-mexican-grill". The brand-parent
  // map normally aliases this to "chipotle"; without it the row becomes an
  // orphan, which is the safer default. Assert the orphan path here.
  assert.ok(orphans.some(o => /Chipotle/i.test(o.employer)),
    "Chipotle Mexican Grill is an orphan in the no-aliases test");
});

test("buildAugment: orphan path captures employer + case number", () => {
  const rows = [{
    case_number: "99-RM-999999",
    case_type: "RM",
    employer: "Made Up Co.",
    union: "Some Union",
    recognition_date: "2026-01-01",
    location: "Nowhere, ZZ",
    workers: 10,
    disposition: "Voluntary Recognition",
    source_url: "https://www.nlrb.gov/case/99-RM-999999",
  }];
  const { companies, orphans } = buildAugment(rows, { aliases: {}, parents: {} });
  assert.equal(Object.keys(companies).length, 0);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].employer, "Made Up Co.");
  assert.equal(orphans[0].case_number, "99-RM-999999");
});
