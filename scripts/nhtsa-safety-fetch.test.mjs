#!/usr/bin/env node
/**
 * node --test scripts/nhtsa-safety-fetch.test.mjs
 *
 * Drives the fetcher's parse + rollup helpers, and the merger's
 * buildSafetyBlock, against the real NHTSA API responses saved under
 * scripts/fixtures/nhtsa-safety/ (one make/year fully populated).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseStars,
  parseVehicleDetail,
  buildMakeRollup,
  buildSnapshot,
  API_BASE,
} from "./nhtsa-safety-fetch.mjs";
import { NHTSA_MAKE_TO_SLUG, buildSafetyBlock } from "./nhtsa-safety-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/nhtsa-safety");

async function loadFixture(name) {
  return JSON.parse(await fs.readFile(path.join(FIX, name), "utf-8"));
}

test("API_BASE is the documented NHTSA root", () => {
  assert.equal(API_BASE, "https://api.nhtsa.gov/SafetyRatings");
});

test("parseStars coerces numeric strings and rejects 'Not Rated'", () => {
  assert.equal(parseStars("5"), 5);
  assert.equal(parseStars("3"), 3);
  assert.equal(parseStars(0), null);
  assert.equal(parseStars(""), null);
  assert.equal(parseStars("Not Rated"), null);
  assert.equal(parseStars(null), null);
  assert.equal(parseStars(undefined), null);
  assert.equal(parseStars("6"), null);     // out-of-range guard
});

test("parseVehicleDetail extracts the fields the merger needs", async () => {
  const resp = await loadFixture("toyota-camry-2023.json");
  const r = parseVehicleDetail(resp.Results[0]);
  assert.equal(r.vehicleId, 18580);
  assert.equal(r.make, "TOYOTA");
  assert.equal(r.model, "CAMRY");
  assert.equal(r.modelYear, 2023);
  assert.equal(r.overallStars, 5);
  assert.equal(r.frontCrashStars, 5);
  assert.equal(r.sideCrashStars, 5);
  assert.equal(r.rolloverStars, 5);
  assert.equal(typeof r.rolloverProbability, "number");
  assert.equal(r.recallsCount, 2);
  assert.ok(r.description.includes("CAMRY"));
});

test("the makes endpoint fixture lists Toyota among 2023 makes", async () => {
  const resp = await loadFixture("makes-2023.json");
  const makes = resp.Results.map(r => r.Make);
  assert.ok(makes.includes("TOYOTA"));
  assert.ok(makes.includes("FORD"));
  assert.ok(makes.includes("TESLA"));
});

test("the models endpoint fixture lists CAMRY for TOYOTA 2023", async () => {
  const resp = await loadFixture("models-toyota-2023.json");
  const models = resp.Results.map(r => r.Model);
  assert.ok(models.includes("CAMRY"));
  assert.ok(models.includes("COROLLA"));
  assert.ok(resp.Count > 10);
});

test("buildMakeRollup averages overall stars and counts vehicles", async () => {
  const a = parseVehicleDetail((await loadFixture("toyota-camry-2023.json")).Results[0]);
  const b = parseVehicleDetail((await loadFixture("toyota-camry-2023-awd.json")).Results[0]);
  const c = parseVehicleDetail((await loadFixture("toyota-camry-2023-awd-later.json")).Results[0]);
  const rollup = buildMakeRollup("TOYOTA", [
    { year: 2023, make: "TOYOTA", model: "CAMRY", variants: [a, b, c] },
  ]);
  assert.equal(rollup.make, "TOYOTA");
  assert.equal(rollup.model_count, 1);
  assert.equal(rollup.vehicle_count, 3);
  assert.equal(rollup.rated_vehicle_count, 3);
  assert.equal(rollup.avg_overall_stars, 5);
});

test("buildSnapshot tallies make/model/vehicle counts and year range", () => {
  const makesObj = {
    TOYOTA: { make: "TOYOTA", model_count: 1, vehicle_count: 3, rated_vehicle_count: 3, avg_overall_stars: 5, models: [] },
  };
  const snap = buildSnapshot(2018, 2026, makesObj);
  assert.equal(snap.source, "nhtsa-safety");
  assert.equal(snap.make_count, 1);
  assert.equal(snap.model_count, 1);
  assert.equal(snap.vehicle_count, 3);
  assert.deepEqual(snap.year_range, { start: 2018, end: 2026 });
  assert.equal(snap.license.includes("public domain"), true);
});

test("NHTSA_MAKE_TO_SLUG covers the major US automakers", () => {
  // Sanity floor — at least these 25 brands must be routable. If this
  // breaks, automaker coverage has regressed and the merger will start
  // logging orphans for big names.
  const required = [
    "TOYOTA", "FORD", "HONDA", "HYUNDAI", "KIA", "NISSAN", "SUBARU",
    "TESLA", "VOLKSWAGEN", "BMW", "MERCEDES-BENZ", "CHRYSLER",
    "JEEP", "RAM", "DODGE", "CHEVROLET", "CADILLAC", "BUICK", "GMC",
    "LINCOLN", "ACURA", "LEXUS", "INFINITI",
  ];
  for (const m of required) {
    assert.ok(NHTSA_MAKE_TO_SLUG[m], `missing slug routing for ${m}`);
    assert.match(NHTSA_MAKE_TO_SLUG[m], /^[a-z0-9-]+$/);
  }
});

test("buildSafetyBlock keys top/bottom by (year,model) and shape matches spec", async () => {
  const a = parseVehicleDetail((await loadFixture("toyota-camry-2023.json")).Results[0]);
  const b = parseVehicleDetail((await loadFixture("toyota-camry-2023-awd.json")).Results[0]);
  // Synthesize a contrived 2-star variant so bottom2StarModels has content.
  const lowStar = {
    vehicleId: 99999, description: "2020 Demo BAD MODEL", modelYear: 2020,
    make: "TOYOTA", model: "DEMO", overallStars: 2, frontCrashStars: 2,
    sideCrashStars: 3, rolloverStars: 2, rolloverProbability: 0.3,
    complaintsCount: 0, recallsCount: 0, investigationCount: 0,
  };
  const rollup = buildMakeRollup("TOYOTA", [
    { year: 2023, make: "TOYOTA", model: "CAMRY", variants: [a, b] },
    { year: 2020, make: "TOYOTA", model: "DEMO", variants: [lowStar] },
  ]);
  const block = buildSafetyBlock(rollup, { start: 2018, end: 2026 });
  assert.equal(block.avgOverallStars, 4);
  assert.equal(block.vehicleCount, 3);
  assert.equal(block.modelCount, 2);
  // top5StarModels deduped to one row for CAMRY 2023
  assert.equal(block.top5StarModels.length, 1);
  assert.equal(block.top5StarModels[0].model, "CAMRY");
  assert.equal(block.top5StarModels[0].overallStars, 5);
  // bottom2StarModels picks the contrived DEMO
  assert.equal(block.bottom2StarModels.length, 1);
  assert.equal(block.bottom2StarModels[0].overallStars, 2);
  // Spec-required key set
  assert.deepEqual(block.year, { start: 2018, end: 2026 });
  assert.deepEqual(block.sourceUrls, ["https://www.nhtsa.gov/ratings"]);
});
