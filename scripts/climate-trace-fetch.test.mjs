#!/usr/bin/env node
/**
 * Tests for climate-trace-fetch.mjs + climate-trace-merge.mjs
 *
 * Fixtures (real Climate TRACE v5.7.0 excerpts, ~50 rows each):
 *   test/fixtures/climate-trace/ownership_sample.csv
 *   test/fixtures/climate-trace/emissions_sample.csv
 *
 * Locally:  node --test scripts/climate-trace-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCsvLine, extractOwnershipRow, extractEmissionsRow, rowYear,
  readOwnership, readEmissionsAggregated, runPipeline, findCsvMembers,
  SUBSECTORS,
} from "./climate-trace-fetch.mjs";

import {
  compactKey, dashSlug, buildIndexLookup, resolveParent, aggregateByParent,
  isExcludedParent,
} from "./climate-trace-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_OWN = path.join(__dirname, "..", "test/fixtures/climate-trace/ownership_sample.csv");
const FIXTURE_EM  = path.join(__dirname, "..", "test/fixtures/climate-trace/emissions_sample.csv");

// ─────────────────────── CSV parser ───────────────────────

test("parseCsvLine handles quoted fields with commas", () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
  assert.deepEqual(parseCsvLine('"hello ""world""",x'), ['hello "world"', "x"]);
  assert.deepEqual(parseCsvLine("plain,row,here"), ["plain", "row", "here"]);
});

test("parseCsvLine strips trailing CR", () => {
  assert.deepEqual(parseCsvLine("a,b\r"), ["a", "b"]);
});

// ─────────────────────── ownership extraction ───────────────────────

test("extractOwnershipRow returns null on missing parent", () => {
  assert.equal(extractOwnershipRow({ source_id: "X", parent_name: "" }), null);
  assert.equal(extractOwnershipRow({ source_id: "", parent_name: "Acme" }), null);
});

test("extractOwnershipRow returns null on zero/negative share", () => {
  assert.equal(extractOwnershipRow({
    source_id: "X", parent_name: "Acme", overall_share_percent: 0,
  }), null);
  assert.equal(extractOwnershipRow({
    source_id: "X", parent_name: "Acme", overall_share_percent: "not a number",
  }), null);
});

test("extractOwnershipRow normalizes 'not found' LEI to null", () => {
  const out = extractOwnershipRow({
    source_id: "1", parent_name: "Acme", overall_share_percent: "50",
    parent_lei: "not found",
  });
  assert.equal(out.parent_lei, null);
  assert.equal(out.share_percent, 50);
});

// ─────────────────────── emissions extraction ───────────────────────

test("rowYear parses 4-char prefix", () => {
  assert.equal(rowYear("2024-05-01 00:00:00"), 2024);
  assert.equal(rowYear("2021-01"), 2021);
  assert.equal(rowYear(""), null);
  assert.equal(rowYear(null), null);
});

test("extractEmissionsRow filters by allow-list and converts tonnes→kg", () => {
  const allow = new Set(["123"]);
  const out = extractEmissionsRow({
    source_id: "123", emissions_quantity: "100", start_time: "2024-01-01",
    gas: "co2e_100yr", iso3_country: "USA",
  }, allow);
  assert.equal(out.kg_co2e, 100_000); // tonnes → kg
  assert.equal(out.year, 2024);
  assert.equal(extractEmissionsRow({
    source_id: "999", emissions_quantity: "100", start_time: "2024-01-01",
  }, allow), null);
});

// ─────────────────────── fixture-driven streaming ───────────────────────

test("fixture: readOwnership yields ~50 valid rows", async () => {
  const rows = await readOwnership(createReadStream(FIXTURE_OWN));
  assert.ok(rows.length >= 40 && rows.length <= 50, `got ${rows.length} ownership rows`);
  for (const r of rows) {
    assert.ok(r.source_id);
    assert.ok(r.parent_name);
    assert.ok(r.share_percent > 0);
  }
});

test("fixture: readEmissionsAggregated collapses monthly rows to per-year", async () => {
  const ownRows = await readOwnership(createReadStream(FIXTURE_OWN));
  const sidSet = new Set(ownRows.map(o => o.source_id));
  const { aggregated, scanned, kept } = await readEmissionsAggregated(
    createReadStream(FIXTURE_EM), sidSet
  );
  // The emissions fixture is 200 monthly rows filtered to 2024 only,
  // so we should get FAR fewer aggregates (1 per source_id per year per gas).
  assert.ok(aggregated.length > 0, "produced at least one aggregate");
  assert.ok(aggregated.length < scanned, `aggregated (${aggregated.length}) < scanned (${scanned})`);
  assert.equal(kept, aggregated.length);
  // Every aggregate should be for one of our allow-listed source_ids.
  for (const a of aggregated) {
    assert.ok(sidSet.has(a.source_id));
    assert.ok(a.kg_co2e > 0);
    assert.equal(a.year, 2024);
  }
});

test("fixture: runPipeline (test stream mode) returns ownership + emissions", async () => {
  const snap = await runPipeline({
    ownership: createReadStream(FIXTURE_OWN),
    emissions: createReadStream(FIXTURE_EM),
  });
  assert.ok(snap.ownership.length >= 10);
  assert.ok(snap.emissions.length >= 1);
  assert.ok(snap._stats.em_kept === snap.emissions.length);
});

// ─────────────────────── findCsvMembers ───────────────────────

test("findCsvMembers picks ownership vs emissions vs skip", () => {
  const members = [
    "DATA/iron-and-steel_emissions_sources_v5_7_0.csv",
    "DATA/iron-and-steel_emissions_sources_ownership_v5_7_0.csv",
    "DATA/iron-and-steel_emissions_sources_confidence_v5_7_0.csv",
    "DATA/iron-and-steel_country_emissions_v5_7_0.csv",
    "ABOUT_THE_DATA/x.pdf",
  ];
  const out = findCsvMembers(members, "iron-and-steel");
  assert.equal(out.ownership, "DATA/iron-and-steel_emissions_sources_ownership_v5_7_0.csv");
  assert.equal(out.emissions, "DATA/iron-and-steel_emissions_sources_v5_7_0.csv");
});

test("findCsvMembers returns null for absent subsector", () => {
  const out = findCsvMembers([
    "DATA/cement_emissions_sources_v5_7_0.csv",
  ], "iron-and-steel");
  assert.equal(out.ownership, null);
  assert.equal(out.emissions, null);
});

// ─────────────────────── subsector manifest ───────────────────────

test("SUBSECTORS includes electricity-generation + the heavy industry set", () => {
  const subs = SUBSECTORS.map(s => s.subsector);
  assert.ok(subs.includes("electricity-generation"));
  assert.ok(subs.includes("iron-and-steel"));
  assert.ok(subs.includes("cement"));
  assert.ok(subs.includes("aluminum"));
  assert.ok(subs.includes("chemicals"));
});

// ─────────────────────── slug resolver ───────────────────────

test("compactKey strips diacritics + punctuation", () => {
  assert.equal(compactKey("Coca-Cola Co."), "cocacolaco");
  assert.equal(compactKey("ENGIE SA"), "engiesa");
  assert.equal(compactKey("Naïve Brand!"), "naivebrand");
});

test("dashSlug yields dashed slug", () => {
  assert.equal(dashSlug("ConocoPhillips"), "conocophillips");
  assert.equal(dashSlug("Berkshire Hathaway Energy"), "berkshire-hathaway-energy");
});

test("buildIndexLookup + resolveParent finds direct slug match", () => {
  const idx = [
    { slug: "engie", name: "ENGIE SA" },
    { slug: "exxon-mobil", name: "Exxon Mobil" },
    { slug: "duke-energy", name: "Duke Energy Corporation" },
  ];
  const lookup = buildIndexLookup(idx);
  assert.equal(resolveParent("ENGIE SA", lookup, {}).slug, "engie");
  assert.equal(resolveParent("Exxon Mobil", lookup, {}).slug, "exxon-mobil");
  assert.equal(resolveParent("Duke Energy Corporation", lookup, {}).slug, "duke-energy");
  assert.equal(resolveParent("Unknown Co", lookup, {}).slug, null);
});

test("resolveParent falls through to parent map", () => {
  const lookup = buildIndexLookup([{ slug: "berkshire-hathaway", name: "Berkshire Hathaway" }]);
  const map = { "berkshirehathawayenergy": { parent: "berkshire-hathaway", confidence: "high" } };
  const out = resolveParent("Berkshire Hathaway Energy", lookup, map);
  assert.equal(out.slug, "berkshire-hathaway");
  assert.equal(out.routed_via, "parent-map");
});

// ─────────────────────── parent filter ───────────────────────

test("isExcludedParent skips index funds and governments", () => {
  assert.equal(isExcludedParent("Vanguard"),         true);
  assert.equal(isExcludedParent("BlackRock"),        true);
  assert.equal(isExcludedParent("Government of India"), true);
  assert.equal(isExcludedParent("small shareholder(s)"), true);
  assert.equal(isExcludedParent("natural person(s)"),    true);
  assert.equal(isExcludedParent("unknown"),               true);
  assert.equal(isExcludedParent("", "legal entity"),      true);
  // state entity type alone excludes
  assert.equal(isExcludedParent("ACME State Co", "state"), true);
  // ordinary corporates pass
  assert.equal(isExcludedParent("Duke Energy Corp", "legal entity"), false);
  assert.equal(isExcludedParent("Exxon Mobil"),              false);
});

// ─────────────────────── aggregateByParent ───────────────────────

test("aggregateByParent equity-weights emissions across JV partners", () => {
  const snap = {
    ownership: [
      { source_id: "f1", parent_name: "ParentA", share_percent: 70, source_subsector: "x", iso3_country: "USA" },
      { source_id: "f1", parent_name: "ParentB", share_percent: 30, source_subsector: "x", iso3_country: "USA" },
    ],
    emissions: [
      { source_id: "f1", year: 2024, gas: "co2e_100yr", kg_co2e: 1_000_000, subsector: "x", iso3_country: "USA" },
    ],
  };
  const recs = aggregateByParent(snap);
  const a = recs.find(r => r.parent_name === "ParentA");
  const b = recs.find(r => r.parent_name === "ParentB");
  assert.equal(a.ghgCo2eKg, 700_000, "70% apportioned");
  assert.equal(b.ghgCo2eKg, 300_000, "30% apportioned");
  assert.equal(a.facilityCount, 1);
  assert.equal(a.ghgCo2eYear, 2024);
  assert.equal(a.ownershipPct, 70);
});

test("aggregateByParent picks LATEST year per parent", () => {
  const snap = {
    ownership: [
      { source_id: "f1", parent_name: "X Corp", share_percent: 100, source_subsector: "x", iso3_country: "USA" },
    ],
    emissions: [
      { source_id: "f1", year: 2022, gas: "co2", kg_co2e: 5_000_000, iso3_country: "USA" },
      { source_id: "f1", year: 2023, gas: "co2", kg_co2e: 7_000_000, iso3_country: "USA" },
      { source_id: "f1", year: 2024, gas: "co2", kg_co2e: 9_000_000, iso3_country: "USA" },
    ],
  };
  const recs = aggregateByParent(snap);
  assert.equal(recs[0].ghgCo2eKg, 9_000_000);
  assert.equal(recs[0].ghgCo2eYear, 2024);
  assert.deepEqual(recs[0].yearsAvailable, [2024, 2023, 2022]);
});

test("end-to-end fixture: snapshot → aggregateByParent → resolve produces ≥1 named parent", async () => {
  const snap = await runPipeline({
    ownership: createReadStream(FIXTURE_OWN),
    emissions: createReadStream(FIXTURE_EM),
  });
  const recs = aggregateByParent(snap);
  assert.ok(recs.length >= 5, `expected ≥5 unique parents, got ${recs.length}`);
  // Should include at least one well-known global parent (Engie / Iberdrola /
  // NextEra / Duke / Vistra etc. — these were in the curated fixture grep).
  const names = recs.map(r => r.parent_name.toLowerCase());
  const hit = names.some(n =>
    /engie|iberdrola|enel|nextera|duke|exxon|chevron|shell|bp|edf|rwe|equinor|repsol|conocophillips|totalenergies/.test(n)
  );
  assert.ok(hit, `expected at least one well-known parent in: ${names.slice(0, 10).join(", ")}`);
});
