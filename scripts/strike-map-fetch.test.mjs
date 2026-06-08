#!/usr/bin/env node
/**
 * Test harness for strike-map-fetch.mjs + strike-map-merge.mjs.
 *
 * Uses scripts/fixtures/strike-map/sample.json — a hand-built fixture
 * mirroring the strikemap.org /api/map FeatureCollection shape with 7
 * representative entries (6 real events, 1 cluster pin). NO network.
 *
 * Run via:  node --test scripts/strike-map-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseWorkerCount,
  parseStrikeDate,
  truncateReason,
  normaliseStatus,
  featureToEvent,
  parseFeatureCollection,
} from "./strike-map-fetch.mjs";

import {
  slugify,
  nameVariants,
  resolveEmployer,
} from "./strike-map-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/strike-map/sample.json");

// ─── parseWorkerCount ────────────────────────────────────────────────────
test("parseWorkerCount — numeric and string", () => {
  assert.equal(parseWorkerCount(150), 150);
  assert.equal(parseWorkerCount("150"), 150);
  assert.equal(parseWorkerCount("1,500"), 1500);
  assert.equal(parseWorkerCount("~200 workers"), 200);
  assert.equal(parseWorkerCount("approximately 50"), 50);
});

test("parseWorkerCount — null / junk", () => {
  assert.equal(parseWorkerCount(null), null);
  assert.equal(parseWorkerCount(""), null);
  assert.equal(parseWorkerCount("no count"), null);
});

// ─── parseStrikeDate ──────────────────────────────────────────────────────
test("parseStrikeDate — ISO and timestamps", () => {
  assert.equal(parseStrikeDate("2025-11-12"), "2025-11-12");
  assert.equal(parseStrikeDate("2025-11-12T08:00:00Z"), "2025-11-12");
  assert.equal(parseStrikeDate("November 12, 2025"), "2025-11-12");
});

test("parseStrikeDate — null / junk", () => {
  assert.equal(parseStrikeDate(null), null);
  assert.equal(parseStrikeDate(""), null);
  assert.equal(parseStrikeDate("not a date"), null);
});

// ─── truncateReason ──────────────────────────────────────────────────────
test("truncateReason — short text passthrough", () => {
  assert.equal(truncateReason("Pay dispute."), "Pay dispute.");
});

test("truncateReason — over 400 chars trimmed", () => {
  const long = "x ".repeat(300);  // 600 chars
  const t = truncateReason(long);
  assert.ok(t.length <= 400, `expected <=400, got ${t.length}`);
  assert.ok(t.endsWith("…"));
});

// ─── normaliseStatus ─────────────────────────────────────────────────────
test("normaliseStatus — common variants", () => {
  assert.equal(normaliseStatus("Active"), "active");
  assert.equal(normaliseStatus("ongoing"), "active");
  assert.equal(normaliseStatus("Upcoming"), "upcoming");
  assert.equal(normaliseStatus("Finished"), "finished");
  assert.equal(normaliseStatus("past"), "finished");
  assert.equal(normaliseStatus(""), "unknown");
  assert.equal(normaliseStatus("foo"), "unknown");
});

// ─── featureToEvent ──────────────────────────────────────────────────────
test("featureToEvent — drops cluster pins", () => {
  const f = { properties: { cluster: true, point_count: 23 } };
  assert.equal(featureToEvent(f), null);
});

test("featureToEvent — drops features without an employer", () => {
  const f = { properties: { title: "" } };
  assert.equal(featureToEvent(f), null);
});

test("featureToEvent — happy path", () => {
  const f = {
    geometry: { coordinates: [-73.9, 40.7] },
    properties: {
      id: "evt-1",
      organisation: "Starbucks Corporation",
      organisationSlug: "starbucks",
      location: "New York, NY, USA",
      startDate: "2025-11-14",
      endDate: "2025-11-17",
      workerCount: 145,
      reason: "Union recognition",
      status: "finished",
      verified: true,
      url: "https://strikemap.org/strikes/evt-1",
    },
  };
  const e = featureToEvent(f);
  assert.equal(e.employer, "Starbucks Corporation");
  assert.equal(e.employerSlug, "starbucks");
  assert.equal(e.startDate, "2025-11-14");
  assert.equal(e.endDate, "2025-11-17");
  assert.equal(e.workerCount, 145);
  assert.equal(e.status, "finished");
  assert.equal(e.verified, true);
  assert.equal(e.lng, -73.9);
  assert.equal(e.lat, 40.7);
});

// ─── parseFeatureCollection against fixture ──────────────────────────────
test("parseFeatureCollection — fixture yields 6 events (cluster dropped)", async () => {
  const fc = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const events = parseFeatureCollection(fc);
  assert.equal(events.length, 6, "6 events parsed; cluster pin dropped");

  // Spot-check Amazon Seattle
  const amazon = events.find(e => e.employer === "Amazon" && (e.location || "").startsWith("Seattle"));
  assert.ok(amazon, "Amazon Seattle present");
  assert.equal(amazon.workerCount, 320);
  assert.equal(amazon.startDate, "2025-11-12");

  // All events have an employer
  for (const e of events) {
    assert.ok(e.employer, "every event has an employer");
  }
});

// ─── slugify / nameVariants ──────────────────────────────────────────────
test("slugify — basic cases", () => {
  assert.equal(slugify("Amazon"), "amazon");
  assert.equal(slugify("McDonald's"), "mcdonalds");
  assert.equal(slugify("AT&T"), "at-and-t");
  assert.equal(slugify("The Kroger Co."), "the-kroger-co");
});

test("nameVariants — strips 'The ' prefix and suffix variants", () => {
  const v = nameVariants("The Kroger Co.");
  assert.ok(v.some(x => x === "Kroger" || x === "Kroger Co."),
    `expected 'Kroger' in ${JSON.stringify(v)}`);
});

test("nameVariants — strips Inc / Corporation suffixes", () => {
  const v = nameVariants("Starbucks Corporation");
  assert.ok(v.some(x => x === "Starbucks"),
    `expected 'Starbucks' in ${JSON.stringify(v)}`);

  const v2 = nameVariants("Amazon.com, Inc.");
  assert.ok(v2.some(x => x === "Amazon" || x === "Amazon.com" || x === "Amazon com"),
    `expected an 'Amazon' variant in ${JSON.stringify(v2)}`);
});

// ─── resolveEmployer ─────────────────────────────────────────────────────
test("resolveEmployer — pre-supplied source-slug wins", () => {
  const indexSlugs = new Set(["starbucks"]);
  const r = resolveEmployer(
    { employer: "Starbucks Corporation", employerSlug: "starbucks" },
    indexSlugs,
    {},
  );
  assert.equal(r.slug, "starbucks");
  assert.equal(r.routedVia, "source-slug");
});

test("resolveEmployer — UPS aliases to united-parcel-service", () => {
  const indexSlugs = new Set(["united-parcel-service"]);
  const r = resolveEmployer({ employer: "UPS", employerSlug: "ups" }, indexSlugs, {});
  assert.equal(r.slug, "united-parcel-service");
  assert.equal(r.routedVia, "alias");
});

test("resolveEmployer — 'The Kroger Co.' resolves via nameVariants", () => {
  const indexSlugs = new Set(["kroger"]);
  const r = resolveEmployer({ employer: "The Kroger Co." }, indexSlugs, {});
  assert.equal(r.slug, "kroger");
});

test("resolveEmployer — Uber Technologies aliases to uber", () => {
  const indexSlugs = new Set(["uber"]);
  const r = resolveEmployer({ employer: "Uber Technologies" }, indexSlugs, {});
  assert.equal(r.slug, "uber");
});

test("resolveEmployer — unknown employer → orphan", () => {
  const r = resolveEmployer({ employer: "Some Random Bakery LLC" }, new Set(["unrelated"]), {});
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("resolveEmployer — brand-parent-map fallback", () => {
  const indexSlugs = new Set(["procter-and-gamble"]);
  const parentMap = { tide: { parent: "procter-and-gamble" } };
  const r = resolveEmployer({ employer: "Tide" }, indexSlugs, parentMap);
  assert.equal(r.slug, "procter-and-gamble");
  assert.equal(r.routedVia, "brand-parent");
});

// ─── end-to-end smoke through the fixture ────────────────────────────────
test("end-to-end — fixture events resolve to known TruNorth slugs", async () => {
  const fc = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const events = parseFeatureCollection(fc);

  // Pretend the index has these slugs.
  const indexSlugs = new Set([
    "amazon", "starbucks", "united-parcel-service",
    "uber", "kroger",
  ]);

  let matched = 0;
  for (const ev of events) {
    const { slug } = resolveEmployer(ev, indexSlugs, {});
    if (slug) matched++;
  }
  // All 6 fixture events should resolve.
  assert.equal(matched, 6, `expected 6 matched, got ${matched}`);
});
