#!/usr/bin/env node
/**
 * Test harness for textile-exchange-fetch.mjs + textile-exchange-merge.mjs.
 *
 * Loads the checked-in fixture at scripts/fixtures/textile-exchange/sample.json,
 * exercises:
 *   - parseArgs                       (CLI parsing)
 *   - expandMirror                    (brand x certs row expansion)
 *   - pingDirectory                   (with a stubbed fetch — no network)
 *   - normalizeCompanyName, toSlug    (name normalization)
 *   - buildIndex + matchBrand         (apparel-only slug matching)
 *   - buildAugment                    (per-slug rollup with certCount)
 *
 * No network. Uses node:test from Node 22.
 *
 * Locally: node --test scripts/textile-exchange-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CERT_TYPES,
  SOURCE_URL,
  MIRROR,
  parseArgs,
  expandMirror,
  pingDirectory,
} from "./textile-exchange-fetch.mjs";
import {
  normalizeCompanyName,
  toSlug,
  buildIndex,
  matchBrand,
  buildAugment,
  parseArgs as parseMergeArgs,
} from "./textile-exchange-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures/textile-exchange/sample.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");

test("CERT_TYPES covers all five Textile Exchange standards in this bundle", () => {
  assert.deepEqual(CERT_TYPES, ["RCS", "GRS", "RWS", "RDS", "RMS"]);
});

test("SOURCE_URL points at the public standards landing page", () => {
  assert.equal(SOURCE_URL, "https://textileexchange.org/standards/");
});

test("MIRROR has at least 30 brands with at least one cert each", () => {
  assert.ok(MIRROR.length >= 30, `mirror length ${MIRROR.length} should be >= 30`);
  for (const entry of MIRROR) {
    assert.ok(entry.brand, "every mirror row has a brand");
    assert.ok(Array.isArray(entry.certs) && entry.certs.length > 0, `${entry.brand} has certs`);
    for (const c of entry.certs) assert.ok(CERT_TYPES.includes(c.type), `${entry.brand}: ${c.type} is one of the five standards`);
  }
});

test("parseArgs handles --out and --no-ping", () => {
  const a = parseArgs(["--out", "/tmp/x.json", "--no-ping"]);
  assert.equal(a.out, "/tmp/x.json");
  assert.equal(a.noPing, true);
});

test("parseMergeArgs handles --in and --out", () => {
  const a = parseMergeArgs(["--in", "/tmp/in.json", "--out", "/tmp/out.json"]);
  assert.equal(a.in, "/tmp/in.json");
  assert.equal(a.out, "/tmp/out.json");
});

test("expandMirror produces one row per (brand, cert_type)", () => {
  const rows = expandMirror();
  // Every cert in the mirror becomes a row.
  const expectedTotal = MIRROR.reduce((s, e) => s + e.certs.length, 0);
  assert.equal(rows.length, expectedTotal);
  // Each row carries the required fields.
  for (const r of rows) {
    assert.ok(r.brand);
    assert.ok(CERT_TYPES.includes(r.cert_type));
    assert.ok(r.source_url);
  }
});

test("expandMirror drops cert entries with unknown types", () => {
  const rows = expandMirror([
    { brand: "X", source_url: "u", certs: [{ type: "RCS", year: 2020 }, { type: "BOGUS", year: 2020 }] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cert_type, "RCS");
});

test("pingDirectory returns ok/status from a stubbed fetch", async () => {
  const stub = async (_url) => ({ ok: true, status: 200 });
  const res = await pingDirectory("https://textileexchange.org/standards/", { fetchImpl: stub });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
});

test("pingDirectory catches network errors non-fatally", async () => {
  const stub = async () => { throw new Error("ENETUNREACH"); };
  const res = await pingDirectory("https://example.invalid/", { fetchImpl: stub });
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
  assert.match(res.error, /ENETUNREACH/);
});

test("normalizeCompanyName strips common corporate suffixes", () => {
  assert.equal(normalizeCompanyName("Nike, Inc."), "Nike");
  assert.equal(normalizeCompanyName("Levi Strauss & Co."), "Levi Strauss");
  assert.equal(normalizeCompanyName("Gap Inc."), "Gap");
  assert.equal(normalizeCompanyName("VF Corporation"), "VF");
  assert.equal(normalizeCompanyName("The North Face"), "North Face");
});

test("toSlug produces TruNorth-style lower-kebab-case", () => {
  assert.equal(toSlug("Nike, Inc."), "nike");
  assert.equal(toSlug("Patagonia"), "patagonia");
  assert.equal(toSlug("Levi Strauss & Co."), "levi-strauss");
  assert.equal(toSlug("Victoria's Secret"), "victorias-secret");
  assert.equal(toSlug("H&M"), "h-and-m");
});

test("buildIndex + matchBrand resolves curated mirror brand names against the real apparel index", async () => {
  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const lookup = buildIndex(indexJson, { aliases: {}, parents: {} });
  // Each of these must resolve to an apparel slug present in the index.
  const probes = [
    ["Nike",                   "nike"],
    ["Patagonia",              "patagonia"],
    ["Primark",                "primark"],
    ["adidas",                 "adidas"],
    ["Allbirds",               "allbirds"],
    ["Reebok",                 "reebok"],
    ["Converse",               "converse"],
    ["Filson",                 "filson"],
    ["Carhartt",               "carhartt"],
    ["Levi Strauss & Co.",     "levi-strauss"],
  ];
  for (const [name, expected] of probes) {
    const hit = matchBrand(name, lookup);
    assert.ok(hit, `${name} should resolve`);
    assert.equal(hit.slug, expected, `${name} -> ${expected} (got ${hit?.slug})`);
  }
});

test("buildIndex skips non-apparel slugs", async () => {
  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const lookup = buildIndex(indexJson, { aliases: {}, parents: {} });
  // Any slug returned by matchBrand must belong to an apparel parent.
  const apparelSlugs = new Set(
    indexJson.filter(c => c.cat === "Apparel & Fashion").map(c => c.slug),
  );
  const hit = matchBrand("Nike", lookup);
  assert.ok(apparelSlugs.has(hit.slug), "matched slug is apparel");
});

test("buildAugment rolls cert rows into per-slug environment objects", async () => {
  const fixture = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const lookup = buildIndex(indexJson, { aliases: {}, parents: {} });
  const { companies, stats } = buildAugment(fixture.rows, lookup);

  // Nike should land with 4 distinct cert types (RCS/GRS/RWS/RDS), and
  // the duplicate Nike RCS row (2018 + 2021) must collapse to the
  // earliest year (2018).
  assert.ok(companies.nike, "nike present");
  assert.equal(companies.nike.environment.certCount, 4);
  const nikeTypes = companies.nike.environment.textileExchangeCerts.map(c => c.type);
  assert.deepEqual(nikeTypes, ["RCS", "GRS", "RWS", "RDS"], "stable sort by standard order");
  const nikeRcs = companies.nike.environment.textileExchangeCerts.find(c => c.type === "RCS");
  assert.equal(nikeRcs.year, 2018, "earliest year wins on dedupe");

  // Patagonia has 2 certs in the fixture (RDS + RWS).
  assert.equal(companies.patagonia.environment.certCount, 2);
  // Primark has 1.
  assert.equal(companies.primark.environment.certCount, 1);
  // sourceUrl is preserved from the row.
  assert.equal(companies.nike.environment.sourceUrl, "https://textileexchange.org/standards/");

  // The bogus brand is an orphan — does not appear in companies.
  assert.equal(stats.orphan_rows, 1);
});

test("buildAugment shape exactly matches the documented contract", async () => {
  const fixture = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const lookup = buildIndex(indexJson, { aliases: {}, parents: {} });
  const { companies } = buildAugment(fixture.rows, lookup);
  const sample = companies.nike;
  // Top-level: only "environment"
  assert.deepEqual(Object.keys(sample).sort(), ["environment"]);
  // environment: textileExchangeCerts (array), certCount (number), sourceUrl (string)
  const env = sample.environment;
  assert.ok(Array.isArray(env.textileExchangeCerts));
  assert.equal(typeof env.certCount, "number");
  assert.equal(typeof env.sourceUrl, "string");
  for (const c of env.textileExchangeCerts) {
    assert.ok(["RCS", "GRS", "RWS", "RDS", "RMS"].includes(c.type));
    assert.ok(c.year == null || typeof c.year === "number");
  }
});
