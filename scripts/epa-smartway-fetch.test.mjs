#!/usr/bin/env node
/**
 * node --test scripts/epa-smartway-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeCarrier, buildSnapshot, SOURCE_URL } from "./epa-smartway-fetch.mjs";
import { buildAliasIndex, matchName, attributeCarrier, rollupBySlug } from "./epa-smartway-merge.mjs";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/epa-smartway/sample.csv");

test("normalizeCarrier maps EPA columns to internal shape", () => {
  const row = {
    "Partner Name": "FedEx Freight",
    "Parent Company": "FedEx Corporation",
    "Fleet Size": "10,200",
    "Partnership Year": "2005",
    "Partnership Tier": "SmartWay Carrier",
  };
  const c = normalizeCarrier(row);
  assert.equal(c.carrier_name, "FedEx Freight");
  assert.equal(c.parent_company, "FedEx Corporation");
  assert.equal(c.fleet_size, 10200);
  assert.equal(c.partnership_year, 2005);
  assert.equal(c.partnership_tier, "SmartWay Carrier");
});

test("normalizeCarrier handles missing fields without crashing", () => {
  const c = normalizeCarrier({ "Partner Name": "Tiny Co" });
  assert.equal(c.carrier_name, "Tiny Co");
  assert.equal(c.parent_company, "");
  assert.equal(c.fleet_size, null);
  assert.equal(c.partnership_year, null);
  assert.equal(c.partnership_tier, "");
});

test("buildSnapshot wraps with source metadata", () => {
  const snap = buildSnapshot([normalizeCarrier({ "Partner Name": "A" })]);
  assert.equal(snap.source, "epa-smartway");
  assert.equal(snap.source_url, SOURCE_URL);
  assert.equal(snap.carrier_count, 1);
  assert.ok(snap.generated_at);
  assert.ok(snap.snapshot_date);
});

test("fixture parses cleanly to expected row count", async () => {
  const txt = await fs.readFile(FIXTURE, "utf-8");
  const rows = parseCSVToObjects(txt).map(normalizeCarrier);
  // 30 carriers in the fixture (Amazon..Generic Random)
  assert.equal(rows.length, 30);
  assert.equal(rows[0].carrier_name, "Amazon Logistics, Inc.");
  assert.equal(rows[0].fleet_size, 18500);
});

test("matchName resolves FedEx Corporation -> fedex", () => {
  const idx = buildAliasIndex(["fedex", "ups", "amazon", "walmart"], {});
  assert.equal(matchName("FedEx Corporation", idx), "fedex");
  assert.equal(matchName("United Parcel Service", idx), null); // no alias yet
});

test("matchName uses parent-map alias for UPS", () => {
  const idx = buildAliasIndex(["ups"], { ups: { aliases: ["United Parcel Service"] } });
  assert.equal(matchName("United Parcel Service", idx), "ups");
});

test("attributeCarrier prefers parent_company over carrier_name", () => {
  const idx = buildAliasIndex(["fedex"], {});
  const out = attributeCarrier(
    { carrier_name: "FedEx Ground", parent_company: "FedEx Corporation", fleet_size: 100, partnership_year: 2010, partnership_tier: "T" },
    idx,
  );
  assert.equal(out.slug, "fedex");
  assert.equal(out.matched_on, "parent_company");
});

test("rollupBySlug sums fleet, takes earliest year, picks mode tier", async () => {
  const txt = await fs.readFile(FIXTURE, "utf-8");
  const carriers = parseCSVToObjects(txt).map(normalizeCarrier);
  const idx = buildAliasIndex(["fedex", "amazon", "walmart"], {
    ups: { aliases: ["United Parcel Service"] },
    amazon: { aliases: ["Amazon.com"] },
  });
  // Add ups slug for the UPS line.
  const idx2 = buildAliasIndex(["fedex", "amazon", "walmart", "ups"], {
    ups: { aliases: ["United Parcel Service"] },
    amazon: { aliases: ["Amazon.com"] },
  });
  const out = rollupBySlug(carriers, idx2, "https://www.epa.gov/smartway");
  // FedEx should aggregate 3 carrier rows: Freight (2005) + Ground (2005) + Express (2004)
  assert.ok(out.fedex);
  assert.equal(out.fedex.matched_carrier_count, 3);
  assert.equal(out.fedex.environment.smartwayPartnerSince, 2004);
  assert.equal(out.fedex.environment.fleetSize, 10200 + 36000 + 46000);
  assert.equal(out.fedex.environment.tier, "SmartWay Carrier");
  assert.equal(out.fedex.environment.sourceUrl, "https://www.epa.gov/smartway");
  // UPS single line
  assert.ok(out.ups);
  assert.equal(out.ups.environment.fleetSize, 119000);
  // Amazon parent attribution
  assert.ok(out.amazon);
  assert.equal(out.amazon.environment.smartwayPartnerSince, 2018);
});
