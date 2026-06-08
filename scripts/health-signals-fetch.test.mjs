#!/usr/bin/env node
/**
 * node:test suite for the health-signals pipeline.
 *
 * Covers:
 *   - CARCINOGENS set + isCarcinogen() including casing + parens edge cases
 *   - fdaDateRange() — produces YYYYMMDD strings, end == today, span == 5y
 *   - buildOpenFdaUrls() — every expected stream + valid URL structure
 *   - buildTriUrls() — 6 years × 10 pages = 60 URLs
 *   - aggregateTriRows() — per-parent kg + carcinogen filtering
 *   - slugifyFirm() — handles common FDA / TRI suffix patterns
 *   - resolveSlug() — synonym, alias, parent-fallback, prefix fallback
 *   - buildPerSlugCounts() — full end-to-end against the fixture set
 *
 * No network calls.
 * Locally:  node --test scripts/health-signals-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CARCINOGENS,
  isCarcinogen,
  fdaDateRange,
  buildOpenFdaUrls,
  buildTriUrls,
  aggregateTriRows,
} from "./health-signals-fetch.mjs";

import {
  slugifyFirm,
  resolveSlug,
  buildPerSlugCounts,
} from "./health-signals-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(ROOT, "test/fixtures/health-signals");

async function loadFixture(name) {
  return JSON.parse(await fs.readFile(path.join(FIX, name), "utf-8"));
}

test("CARCINOGENS — includes IARC Group 1 staples", () => {
  for (const c of ["BENZENE", "FORMALDEHYDE", "VINYL CHLORIDE", "ASBESTOS", "ETHYLENE OXIDE"]) {
    assert.ok(CARCINOGENS.has(c), `CARCINOGENS missing ${c}`);
  }
});

test("isCarcinogen — handles lowercase / mixed case", () => {
  assert.equal(isCarcinogen("benzene"), true);
  assert.equal(isCarcinogen("Benzene"), true);
  assert.equal(isCarcinogen("BENZENE"), true);
});

test("isCarcinogen — strips trailing parens qualifier", () => {
  assert.equal(isCarcinogen("Chromium (except chromium VI oxide)"), true);
  assert.equal(isCarcinogen("Asbestos (friable)"), true);
});

test("isCarcinogen — handles prefix match with comma suffix", () => {
  assert.equal(isCarcinogen("Benzene, 1-methyl-"), true);
});

test("isCarcinogen — rejects non-carcinogens", () => {
  assert.equal(isCarcinogen("Sodium hydroxide (solution)"), false);
  assert.equal(isCarcinogen("Ammonia"), false);
  assert.equal(isCarcinogen(""), false);
  assert.equal(isCarcinogen(null), false);
});

test("fdaDateRange — 5-year span ending today, YYYYMMDD format", () => {
  const now = new Date("2026-06-07T00:00:00Z");
  const { start, end } = fdaDateRange(5, now);
  assert.equal(end, "20260607");
  assert.equal(start, "20210607");
  assert.match(start, /^\d{8}$/);
  assert.match(end, /^\d{8}$/);
});

test("buildOpenFdaUrls — covers all 10 expected streams", () => {
  const urls = buildOpenFdaUrls(new Date("2026-06-07T00:00:00Z"));
  const expected = [
    "drugRecalls", "drugRecallsCls1",
    "deviceRecalls", "deviceRecallsCls1",
    "foodRecalls", "foodRecallsCls1",
    "deviceEvents", "drugEvents", "tobaccoEvents",
    "drugLabelsBoxed",
  ];
  for (const k of expected) {
    assert.ok(urls[k], `missing OpenFDA url: ${k}`);
    assert.match(urls[k], /^https:\/\/api\.fda\.gov\//, `${k} not pointing to api.fda.gov`);
    assert.match(urls[k], /count=/, `${k} missing count facet`);
    // High-volume endpoints cap at 500 anonymous; others at 1000.
    assert.match(urls[k], /limit=(500|1000)/, `${k} missing limit=500|1000`);
  }
});

test("buildOpenFdaUrls — Class I queries include classification filter", () => {
  const urls = buildOpenFdaUrls(new Date("2026-06-07T00:00:00Z"));
  assert.match(urls.drugRecallsCls1, /classification:%22Class\+I%22/);
  assert.match(urls.foodRecallsCls1, /classification:%22Class\+I%22/);
  assert.match(urls.deviceRecallsCls1, /product_res_status:%22Class\+I%22/);
});

test("buildTriUrls — default = 6 years × 10 pages = 60 URLs, correct row windows", () => {
  const urls = buildTriUrls();
  assert.equal(urls.length, 60);
  assert.equal(urls[0].year, 2019);
  assert.equal(urls[0].page, 0);
  assert.match(urls[0].url, /YEAR\/2019\/rows\/0:9999\/JSON$/);
  assert.match(urls[1].url, /rows\/10000:19999\/JSON$/);
  assert.equal(urls[urls.length - 1].year, 2024);
});

test("aggregateTriRows — filters carcinogens, sums by parent, converts to kg", async () => {
  const fix = await loadFixture("tri-rows.json");
  const agg = aggregateTriRows(fix.rows);
  // 9 fixture rows, 1 non-carcinogen + 1 blank-parent → 7 used. Of those,
  // the blank-parent row IS a carcinogen so counts toward carcinogenRowCount
  // but not toward any parent bucket.
  assert.equal(agg.carcinogenRowCount, 8, "8 carcinogen rows");
  // 5 parents matched (Exxon, Dow, 3M, DuPont, Pfizer, Merck = 6)
  assert.equal(Object.keys(agg.perParent).length, 6);

  // Exxon = 88,000 + 30,000 lbs = 118,000 lbs = 53,524 kg
  const exxon = agg.perParent["EXXON MOBIL CORPORATION"];
  assert.ok(exxon, "Exxon parent present");
  assert.equal(exxon.carcinogenKg, Math.round(118000 * 0.453592));
  assert.equal(exxon.facilityCount, 2);
  assert.deepEqual([...exxon.chemicals].sort(), ["Benzene", "Ethylene Oxide"].sort());

  // Dow 1,3-Butadiene only
  const dow = agg.perParent["DOW INC"];
  assert.equal(dow.carcinogenKg, Math.round(45000 * 0.453592));

  // Pfizer Dichloromethane
  const pfz = agg.perParent["PFIZER INC"];
  assert.equal(pfz.carcinogenKg, Math.round(8000 * 0.453592));

  // Merck Chromium edge case
  assert.ok(agg.perParent["MERCK & CO INC"], "Merck parent matched via parens-strip");
});

test("aggregateTriRows — ignores rows with zero or invalid lbs", () => {
  const rows = [
    { PARENT_CO_NAME: "X CORP", CHEMICAL: "Benzene", TOTAL_RELEASES: 0 },
    { PARENT_CO_NAME: "X CORP", CHEMICAL: "Benzene", TOTAL_RELEASES: "NaN" },
    { PARENT_CO_NAME: "X CORP", CHEMICAL: "Benzene", TOTAL_RELEASES: -5 },
  ];
  const agg = aggregateTriRows(rows);
  assert.equal(Object.keys(agg.perParent).length, 0);
});

test("slugifyFirm — strips common corporate suffixes", () => {
  assert.equal(slugifyFirm("PFIZER, INC."), "pfizer");
  assert.equal(slugifyFirm("JOHNSON & JOHNSON CONSUMER INC."), "johnson-and-johnson-consumer");
  assert.equal(slugifyFirm("3M Company"), "3m");
  assert.equal(slugifyFirm("Dow Chemical Company"), "dow-chemical");
  assert.equal(slugifyFirm(""), null);
  assert.equal(slugifyFirm(null), null);
});

test("resolveSlug — direct hit, synonym, prefix fallback", () => {
  const maps = { aliases: {}, parents: {} };
  const exists = (s) => ["pfizer", "merck", "johnson-and-johnson", "dow", "exxon-mobil"].includes(s);

  // direct (after slugify → "pfizer")
  let r = resolveSlug("PFIZER, INC.", maps, exists);
  assert.equal(r.slug, "pfizer");

  // synonym ("johnson-and-johnson-consumer" → "johnson-and-johnson")
  r = resolveSlug("JOHNSON & JOHNSON CONSUMER INC.", maps, exists);
  assert.equal(r.slug, "johnson-and-johnson");

  // synonym for Merck ("merck-sharp-and-dohme" → "merck")
  r = resolveSlug("MERCK SHARP & DOHME CORP", maps, exists);
  assert.equal(r.slug, "merck");

  // prefix fallback for unknown but slugifies to known prefix
  r = resolveSlug("DOW FREEPORT TX OPERATIONS", maps, exists);
  assert.equal(r.slug, "dow");

  // alias path
  const mapsWithAlias = { aliases: { "loreal": "l-or-al" }, parents: {} };
  const exists2 = (s) => s === "l-or-al";
  r = resolveSlug("L'Oreal USA", mapsWithAlias, exists2);
  assert.equal(r.slug, "l-or-al");

  // parent-fallback path
  const mapsWithParent = { aliases: {}, parents: { "advil": { parent: "haleon" } } };
  const exists3 = (s) => s === "haleon";
  r = resolveSlug("ADVIL", mapsWithParent, exists3);
  assert.equal(r.slug, "haleon");
});

test("resolveSlug — returns null when nothing resolves", () => {
  const maps = { aliases: {}, parents: {} };
  const r = resolveSlug("ACME PLASTICS UNKNOWN INC", maps, () => false);
  assert.equal(r, null);
});

test("buildPerSlugCounts — end-to-end against fixture set", async () => {
  // Load every fixture into the shape the merger expects.
  const openfda = {
    drugRecalls:        (await loadFixture("openfda-drug-recalls.json")).results,
    drugRecallsCls1:    (await loadFixture("openfda-drug-recalls-cls1.json")).results,
    deviceRecalls:      (await loadFixture("openfda-device-recalls.json")).results,
    deviceRecallsCls1:  (await loadFixture("openfda-device-recalls-cls1.json")).results,
    foodRecalls:        (await loadFixture("openfda-food-recalls.json")).results,
    foodRecallsCls1:    (await loadFixture("openfda-food-recalls-cls1.json")).results,
    deviceEvents:       (await loadFixture("openfda-device-events.json")).results,
    drugEvents:         (await loadFixture("openfda-drug-events.json")).results,
    tobaccoEvents:      (await loadFixture("openfda-tobacco-events.json")).results,
    drugLabelsBoxed:    (await loadFixture("openfda-drug-labels-boxed.json")).results,
  };
  const triRows = (await loadFixture("tri-rows.json")).rows;
  const triAgg = aggregateTriRows(triRows);

  const maps = { aliases: {}, parents: {} };
  // Pretend the following company JSON files exist.
  const known = new Set([
    "pfizer", "merck", "abbvie", "johnson-and-johnson", "teva", "viatris",
    "medtronic", "philips", "boston-scientific", "dexcom",
    "tyson-foods", "nestle", "kraft-heinz",
    "altria", "juul-labs",
    "exxon-mobil", "dow", "3m", "dupont",
  ]);
  const exists = (s) => known.has(s);

  const { companies, orphans } = buildPerSlugCounts(openfda, triAgg.perParent, maps, exists);

  // Pfizer hits: drugRecalls 42 + drugEvents 250000 + boxedWarningLabels 14
  //   class1 = drugRecallsCls1 5
  //   tri = ~8000 lbs Dichloromethane
  assert.ok(companies["pfizer"], "pfizer in output");
  assert.equal(companies["pfizer"].health.recallEvents5y, 42);
  assert.equal(companies["pfizer"].health.adverseEvents5y, 250000);
  assert.equal(companies["pfizer"].health.warningLetters5y, 14);
  assert.equal(companies["pfizer"].health.class1RecallCount, 5);
  assert.ok(companies["pfizer"].health.carcinogenEmissionsKg > 0, "pfizer carcinogen kg > 0");
  assert.ok(companies["pfizer"].health.sourceUrls.length >= 2, "pfizer has multiple sourceUrls");

  // Teva — drugRecalls 95, class1 9. No adverse events fixture for Teva.
  assert.equal(companies["teva"].health.recallEvents5y, 95);
  assert.equal(companies["teva"].health.class1RecallCount, 9);

  // Johnson & Johnson — consumer subsidiary maps to parent via synonym.
  assert.equal(companies["johnson-and-johnson"].health.recallEvents5y, 27);
  assert.equal(companies["johnson-and-johnson"].health.warningLetters5y, 3);

  // Medtronic = device recalls 31 + device events 5400, class1 = 3
  assert.equal(companies["medtronic"].health.recallEvents5y, 31);
  assert.equal(companies["medtronic"].health.adverseEvents5y, 5400);
  assert.equal(companies["medtronic"].health.class1RecallCount, 3);

  // Philips Respironics → philips
  assert.equal(companies["philips"].health.recallEvents5y, 88);
  assert.equal(companies["philips"].health.adverseEvents5y, 18200);
  assert.equal(companies["philips"].health.class1RecallCount, 12);

  // Food
  assert.equal(companies["tyson-foods"].health.recallEvents5y, 12);
  assert.equal(companies["tyson-foods"].health.class1RecallCount, 2);

  // Tobacco — JUUL Labs (synonym maps to juul-labs)
  assert.equal(companies["juul-labs"].health.adverseEvents5y, 320);

  // TRI emitters
  assert.ok(companies["exxon-mobil"].health.carcinogenEmissionsKg > 30000,
    "Exxon ≥ 30,000 kg carcinogens");
  assert.ok(companies["dow"].health.carcinogenEmissionsKg > 0);
  assert.ok(companies["3m"].health.carcinogenEmissionsKg > 0);
  assert.ok(companies["dupont"].health.carcinogenEmissionsKg > 0);

  // The "SOME UNKNOWN PRIVATE PHARMA LLC" fixture firm should be orphaned.
  // The "ACME PLASTICS INC" non-carcinogen TRI row should NOT appear at all
  // (it's filtered before parent aggregation).
  assert.ok(
    orphans.some(o => o.firm.includes("UNKNOWN")),
    "unknown pharma firm shows up in orphans",
  );
  assert.equal(
    orphans.find(o => o.firm.includes("ACME")), undefined,
    "non-carcinogen Acme parent is filtered, not orphaned",
  );

  // All tagged companies are in our `known` set (no leakage).
  for (const slug of Object.keys(companies)) {
    assert.ok(known.has(slug), `unexpected slug in output: ${slug}`);
  }
});

test("buildPerSlugCounts — Class I total sums across drug/device/food", async () => {
  const openfda = {
    drugRecallsCls1:   [{ term: "Pfizer Inc.", count: 3 }],
    deviceRecallsCls1: [{ term: "Pfizer Inc.", count: 2 }],
    foodRecallsCls1:   [{ term: "Pfizer Inc.", count: 1 }],
  };
  const maps = { aliases: {}, parents: {} };
  const exists = (s) => s === "pfizer";
  const { companies } = buildPerSlugCounts(openfda, {}, maps, exists);
  assert.equal(companies["pfizer"].health.class1RecallCount, 6);
});
