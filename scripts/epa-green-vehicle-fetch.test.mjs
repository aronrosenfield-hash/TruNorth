#!/usr/bin/env node
/**
 * node --test scripts/epa-green-vehicle-fetch.test.mjs
 *
 * No network calls — drives the fetcher's pure helpers and the merger's
 * pure aggregation function against the bundled fixture CSV.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isEV,
  isFCEV,
  isPHEV,
  isHybrid,
  isZevEligible,
  normalizeRow,
  buildSnapshot,
} from "./epa-green-vehicle-fetch.mjs";
import { resolveMake, aggregateByAutomaker, MAKE_TO_SLUG } from "./epa-green-vehicle-merge.mjs";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/epa-green-vehicle/sample.csv");

async function loadFixtureRows() {
  const text = await fs.readFile(FIXTURE, "utf-8");
  return parseCSVToObjects(text);
}

// ── classification helpers ──

test("isEV is true for battery EVs, false for PHEVs and ICE", () => {
  assert.equal(isEV({ fuelType1: "Electricity", fuelType2: "" }), true);
  assert.equal(isEV({ fuelType1: "Electricity", fuelType2: "Regular Gasoline" }), false);
  assert.equal(isEV({ fuelType1: "Regular Gasoline" }), false);
});

test("isFCEV is true only for Hydrogen", () => {
  assert.equal(isFCEV({ fuelType1: "Hydrogen" }), true);
  assert.equal(isFCEV({ fuelType1: "Electricity" }), false);
});

test("isPHEV catches both atvType label and phevBlended boolean", () => {
  assert.equal(isPHEV({ atvType: "Plug-in Hybrid" }), true);
  assert.equal(isPHEV({ atvType: "", phevBlended: "true" }), true);
  assert.equal(isPHEV({ atvType: "Hybrid" }), false);
});

test("isHybrid catches non-plug hybrids only", () => {
  assert.equal(isHybrid({ atvType: "Hybrid" }), true);
  assert.equal(isHybrid({ atvType: "Plug-in Hybrid" }), false);
});

test("isZevEligible: EVs yes, PHEVs no, ICE no", () => {
  assert.equal(isZevEligible({ fuelType1: "Electricity", co2TailpipeGpm: "0" }), true);
  assert.equal(isZevEligible({ fuelType1: "Hydrogen", co2TailpipeGpm: "0" }), true);
  assert.equal(
    isZevEligible({ fuelType1: "Regular Gasoline", fuelType2: "Electricity", atvType: "Plug-in Hybrid", co2TailpipeGpm: "222" }),
    false
  );
  assert.equal(isZevEligible({ fuelType1: "Regular Gasoline", co2TailpipeGpm: "468" }), false);
  // Defensive: an "EV" row that somehow carries non-zero tailpipe CO2 is rejected.
  assert.equal(isZevEligible({ fuelType1: "Electricity", co2TailpipeGpm: "5" }), false);
});

// ── row normalization ──

test("normalizeRow preserves make/model/year and computes flags", () => {
  const v = normalizeRow({
    make: "Tesla", model: "Model 3 Long Range AWD", year: "2024",
    fuelType1: "Electricity", fuelType2: "", atvType: "EV",
    comb08: "131", combE: "131", co2TailpipeGpm: "0",
  });
  assert.equal(v.make, "Tesla");
  assert.equal(v.model, "Model 3 Long Range AWD");
  assert.equal(v.year, 2024);
  assert.equal(v.fuel_type, "Electricity");
  assert.equal(v.mpge, 131);
  assert.equal(v.co2_g_per_mi, 0);
  assert.equal(v.is_ev, true);
  assert.equal(v.zev_eligible, true);
});

test("normalizeRow on a PHEV tags is_phev but not zev_eligible", () => {
  const v = normalizeRow({
    make: "Ford", model: "Escape PHEV FWD", year: "2024",
    fuelType1: "Regular Gasoline", fuelType2: "Electricity", atvType: "Plug-in Hybrid",
    comb08: "40", combE: "105", co2TailpipeGpm: "222.0", phevBlended: "true",
  });
  assert.equal(v.is_phev, true);
  assert.equal(v.is_ev, false);
  assert.equal(v.zev_eligible, false);
  // PHEV: we report comb08 (gasoline MPG); the electric pathway is
  // captured by the is_phev flag, not by stuffing combE (which is
  // kWh/100mi, NOT MPGe) into the MPGe field.
  assert.equal(v.mpge, 40);
});

// ── snapshot ──

test("buildSnapshot computes ev_count + zev_eligible_count from fixture", async () => {
  const rows = await loadFixtureRows();
  const vehicles = rows.map(normalizeRow);
  const snap = buildSnapshot(vehicles);
  assert.equal(snap.source, "epa-green-vehicle");
  assert.equal(snap.vehicle_count, vehicles.length);
  assert.ok(snap.ev_count > 0, "fixture should have at least one EV");
  assert.ok(snap.zev_eligible_count > 0, "fixture should have at least one ZEV-eligible vehicle");
  assert.equal(snap.ev_count, snap.zev_eligible_count, "fixture has no hydrogen, so EV count == ZEV count");
  assert.ok(snap.license.includes("public domain"));
});

// ── merger: make resolution ──

test("resolveMake routes Lexus → toyota-motor (Toyota luxury brand)", () => {
  assert.equal(resolveMake("Lexus"), "toyota-motor");
  assert.equal(resolveMake("LEXUS"), "toyota-motor");
  assert.equal(resolveMake("Tesla"), "tesla");
  assert.equal(resolveMake("Cadillac"), "general-motors");
  assert.equal(resolveMake("Some Phantom Make"), null);
});

test("MAKE_TO_SLUG contains all major US/EU/JP/KR brands", () => {
  for (const m of ["tesla", "ford", "chevrolet", "toyota", "honda", "hyundai", "kia", "bmw", "mercedes-benz", "volkswagen"]) {
    assert.ok(MAKE_TO_SLUG[m], `missing ${m}`);
  }
});

// ── merger: aggregation ──

test("aggregateByAutomaker rolls up per-slug environment block from fixture", async () => {
  const rows = await loadFixtureRows();
  const vehicles = rows.map(normalizeRow);
  const { augment, unmatched } = aggregateByAutomaker(vehicles);

  // Tesla — 3 EVs, all ZEV-eligible.
  assert.ok(augment.tesla, "tesla bucket exists");
  assert.equal(augment.tesla.environment.evCount, 3);
  assert.equal(augment.tesla.environment.zevEligibleCount, 3);
  assert.equal(augment.tesla.environment.evPctOfFleet, 1);
  assert.equal(augment.tesla.environment.year, 2024);
  assert.equal(augment.tesla.environment.sourceUrl, "https://www.fueleconomy.gov/feg/download.shtml");

  // Ford — 2 EVs, 1 ICE truck, 1 PHEV (Escape).
  assert.ok(augment["ford-motor"], "ford-motor bucket exists");
  assert.equal(augment["ford-motor"].environment.evCount, 2);
  assert.equal(augment["ford-motor"].environment.zevEligibleCount, 2);
  assert.equal(augment["ford-motor"].phevCount, 1);
  assert.equal(augment["ford-motor"].vehicleCount, 4);

  // Lexus would be merged into toyota-motor — fixture has none, but
  // Toyota itself should still aggregate.
  assert.ok(augment["toyota-motor"], "toyota-motor bucket exists");
  assert.ok(augment["toyota-motor"].environment.evCount >= 1);

  // avgMpgE is bounded and finite.
  for (const [slug, val] of Object.entries(augment)) {
    assert.ok(val.environment.avgMpgE === null || (val.environment.avgMpgE > 0 && val.environment.avgMpgE < 200),
      `${slug} avgMpgE in plausible range, got ${val.environment.avgMpgE}`);
  }

  // No unmatched makes in this curated fixture.
  assert.equal(unmatched.length, 0, `unmatched should be empty, got ${JSON.stringify(unmatched)}`);
});

test("aggregateByAutomaker buckets unknown makes under unmatched", () => {
  const vehicles = [
    normalizeRow({ make: "Tesla", model: "Model 3", year: "2024", fuelType1: "Electricity", comb08: "131", combE: "131", co2TailpipeGpm: "0" }),
    normalizeRow({ make: "Phantom Motors", model: "X1", year: "2024", fuelType1: "Regular Gasoline", comb08: "25", co2TailpipeGpm: "350" }),
  ];
  const { augment, unmatched } = aggregateByAutomaker(vehicles);
  assert.ok(augment.tesla);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].make, "phantom motors");
  assert.equal(unmatched[0].count, 1);
});
