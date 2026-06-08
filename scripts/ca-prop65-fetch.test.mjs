#!/usr/bin/env node
/**
 * Tests for ca-prop65-fetch.mjs + ca-prop65-merge.mjs
 *
 * Uses node:test (no extra deps). Fixtures live at:
 *   scripts/fixtures/ca-prop65/chemicals.csv
 *   scripts/fixtures/ca-prop65/notices-search.html
 *
 * Locally: node scripts/ca-prop65-fetch.test.mjs
 *          node --test scripts/ca-prop65-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCSV,
  normalizeChemicalRow,
  findChemicalListUrl,
  parseNoticesPage,
  findNextPageUrl,
  stripHtml,
} from "./ca-prop65-fetch.mjs";

import {
  slugify,
  rawSlugify,
  resolveSlug,
  aggregateBySlug,
} from "./ca-prop65-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures/ca-prop65");

/* ============================================================ */
/*   PART 1: chemical list parsing                              */
/* ============================================================ */

test("parseCSV: handles quoted fields with embedded commas", () => {
  const csv = `a,b,c\n"hello, world","x",1\n"a ""quoted"" b",y,2\n`;
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].a, "hello, world");
  assert.equal(rows[1].a, 'a "quoted" b');
  assert.equal(rows[1].b, "y");
});

test("parseCSV: tolerates trailing newline", () => {
  const csv = `h1,h2\nv1,v2\n`;
  const rows = parseCSV(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { h1: "v1", h2: "v2" });
});

test("normalizeChemicalRow: maps OEHHA columns to canonical shape", () => {
  const r = normalizeChemicalRow({
    Chemical: "Benzene",
    "CAS No.": "71-43-2",
    "Type of Toxicity": "Cancer",
    "Listing Mechanism": "IARC",
    "Date Listed": "2/27/1987",
  });
  assert.equal(r.chemical, "Benzene");
  assert.equal(r.cas_number, "71-43-2");
  assert.equal(r.type_of_toxicity, "cancer");
  assert.equal(r.listing_mechanism, "IARC");
  assert.equal(r.date_listed, "2/27/1987");
});

test("normalizeChemicalRow: drops rows without a chemical name", () => {
  assert.equal(normalizeChemicalRow({ Chemical: "", "CAS No.": "x" }), null);
});

test("chemicals.csv fixture parses to ≥10 chemicals with known fields", async () => {
  const text = await fs.readFile(path.join(FIXTURES, "chemicals.csv"), "utf-8");
  const rows = parseCSV(text).map(normalizeChemicalRow).filter(Boolean);
  assert.ok(rows.length >= 10, `expected ≥10 chemicals, got ${rows.length}`);
  // Spot-check a few well-known Prop 65 chemicals
  const names = rows.map(r => r.chemical);
  assert.ok(names.includes("Benzene"));
  assert.ok(names.includes("Formaldehyde (gas)"));
  assert.ok(names.some(n => n.startsWith("Di(2-ethylhexyl)phthalate")));
  // CAS numbers are populated where present
  const bz = rows.find(r => r.chemical === "Benzene");
  assert.equal(bz.cas_number, "71-43-2");
  assert.equal(bz.type_of_toxicity, "cancer");
});

test("findChemicalListUrl: prefers CSV over XLSX", () => {
  const html = `
    <a href="/media/p65_single03022024_0.xlsx">XLSX</a>
    <a href="/media/p65_single03022024_0.csv">CSV</a>
  `;
  const r = findChemicalListUrl(html);
  assert.equal(r.format, "csv");
  assert.ok(r.url.endsWith(".csv"));
});

test("findChemicalListUrl: falls back to XLSX if no CSV", () => {
  const html = `<a href="/media/p65_single03022024_0.xlsx">XLSX</a>`;
  const r = findChemicalListUrl(html);
  assert.equal(r.format, "xlsx");
});

test("findChemicalListUrl: returns null when no match", () => {
  assert.equal(findChemicalListUrl("<a href='/foo.txt'>x</a>"), null);
  assert.equal(findChemicalListUrl(""), null);
});

/* ============================================================ */
/*   PART 2: OAG notice search parsing                          */
/* ============================================================ */

test("stripHtml: removes tags and decodes basic entities", () => {
  // &nbsp; → space, tags stripped, &amp; → &; the resulting tokens are
  // re-joined with a single space (we don't try to be smarter than that).
  assert.equal(stripHtml("<p>Hello&nbsp;<b>world</b>&amp;more</p>"), "Hello world &more");
});

test("notices-search.html fixture: parses all 10 data rows", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "notices-search.html"), "utf-8");
  const rows = parseNoticesPage(html);
  assert.equal(rows.length, 10, `expected 10 notice rows, got ${rows.length}`);
});

test("notices-search.html: captures defendant, plaintiff, chemical, date, url", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "notices-search.html"), "utf-8");
  const rows = parseNoticesPage(html);
  const first = rows[0];
  assert.equal(first.ag_number, "2026-00123");
  assert.equal(first.notice_date, "2026-05-14");
  assert.equal(first.plaintiff, "Center for Environmental Health");
  assert.equal(first.defendant, "Walmart Inc.");
  assert.equal(first.chemical_alleged, "Lead");
  assert.equal(first.product_type, "Imported ceramic mugs");
  assert.ok(first.url && first.url.includes("2026-00123.pdf"));
});

test("notices-search.html: dates normalized to YYYY-MM-DD", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "notices-search.html"), "utf-8");
  const rows = parseNoticesPage(html);
  for (const r of rows) {
    assert.match(r.notice_date, /^\d{4}-\d{2}-\d{2}$/, `bad date: ${r.notice_date}`);
  }
});

test("findNextPageUrl: respects rel='next'", () => {
  const html = `<a href="/prop65/60-day-notice-search?page=3" rel="next">Next</a>`;
  const next = findNextPageUrl(html, "https://oag.ca.gov/prop65/60-day-notice-search?page=2");
  assert.ok(next.includes("page=3"));
});

test("findNextPageUrl: synthesizes page+1 when no rel='next'", () => {
  const next = findNextPageUrl("<div></div>", "https://oag.ca.gov/prop65/60-day-notice-search?page=4");
  assert.ok(next.includes("page=5"));
});

/* ============================================================ */
/*   PART 3: merge — slug resolution + aggregation              */
/* ============================================================ */

test("slugify: strips corporate suffixes", () => {
  assert.equal(slugify("Walmart Inc."), "walmart");
  assert.equal(slugify("Walmart Stores Inc."), "walmart");
  assert.equal(slugify("Amazon.com Services LLC"), "amazon-com-services");
  assert.equal(slugify("The Home Depot Inc."), "the-home-depot");
  assert.equal(slugify("Target Corporation"), "target");
  assert.equal(slugify("Costco Wholesale Corporation"), "costco-wholesale");
});

test("rawSlugify: preserves suffixes", () => {
  assert.equal(rawSlugify("Walmart Inc."), "walmart-inc");
  assert.equal(rawSlugify("Target Corp."), "target-corp");
});

test("resolveSlug: direct hit", () => {
  const known = new Set(["walmart", "target", "amazon"]);
  const r = resolveSlug("Walmart Inc.", known, { aliases: {}, parents: {} });
  assert.equal(r.slug, "walmart");
  assert.equal(r.routed_via, "direct");
});

test("resolveSlug: alias fallback", () => {
  const known = new Set(["alphabet"]);
  const maps = { aliases: { google: "alphabet" }, parents: {} };
  const r = resolveSlug("Google", known, maps);
  assert.equal(r.slug, "alphabet");
  assert.equal(r.routed_via, "alias");
});

test("resolveSlug: parent fallback", () => {
  const known = new Set(["unilever"]);
  const maps = { aliases: {}, parents: { dove: { parent: "unilever" } } };
  const r = resolveSlug("Dove", known, maps);
  assert.equal(r.slug, "unilever");
  assert.equal(r.routed_via, "parent");
});

test("resolveSlug: first-token fallback", () => {
  const known = new Set(["walmart"]);
  const r = resolveSlug("Walmart Stores Holdings", known, { aliases: {}, parents: {} });
  // slugify drops 'stores' and 'holdings' → 'walmart' (direct)
  assert.equal(r.slug, "walmart");
});

test("resolveSlug: orphan", () => {
  const known = new Set(["walmart"]);
  const r = resolveSlug("XYZ Unknown Co.", known, { aliases: {}, parents: {} });
  assert.equal(r.slug, null);
  assert.equal(r.routed_via, "orphan");
});

test("aggregateBySlug: applies 2-notice threshold", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "notices-search.html"), "utf-8");
  const notices = parseNoticesPage(html);
  const known = new Set(["walmart", "amazon", "target", "home-depot", "costco"]);
  const { bySlug, kept, dropped, orphans } = aggregateBySlug(notices, known, { aliases: {}, parents: {} });

  // Walmart has 3, Amazon has 2 (both via first-token from amazon-com-*),
  // Target has 2 → kept = 3.
  // Costco has 1 (via first-token fallback) → dropped (below 2-notice threshold).
  // "The Home Depot Inc." → "the-home-depot" → no match, first-token "the"
  // is too short → ORPHAN (not in bySlug at all).
  // "XYZ Boutique Soaps LLC" → orphan.
  assert.equal(kept, 3);
  assert.equal(dropped, 1);
  assert.ok(bySlug.walmart, "walmart bucket present");
  assert.equal(bySlug.walmart.prop65.noticeCount, 3);
  assert.equal(bySlug.amazon.prop65.noticeCount, 2);
  assert.equal(bySlug.target.prop65.noticeCount, 2);
  assert.equal(bySlug["home-depot"], undefined);
  assert.equal(bySlug.costco, undefined);

  // Both Home Depot and XYZ Boutique Soaps → orphans
  assert.ok(orphans.size >= 2, `expected ≥2 orphans, got ${orphans.size}`);
});

test("aggregateBySlug: dedupes chemicals and keeps recent notices sorted desc", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "notices-search.html"), "utf-8");
  const notices = parseNoticesPage(html);
  const known = new Set(["walmart"]);
  const { bySlug } = aggregateBySlug(notices, known, { aliases: {}, parents: {} });
  const wm = bySlug.walmart.prop65;
  assert.deepEqual([...wm.chemicalsCited].sort(), ["Cadmium", "Di(2-ethylhexyl)phthalate (DEHP)", "Lead"]);
  // Recent notices sorted descending by date
  const dates = wm.recentNotices.map(n => n.date);
  assert.deepEqual([...dates], [...dates].sort().reverse());
});
