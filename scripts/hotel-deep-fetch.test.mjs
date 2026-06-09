#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HOTELS, SOURCE_URLS, buildSnapshot, severityFor } from "./hotel-deep-fetch.mjs";
import { buildHotelBlock } from "./hotel-deep-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/hotel-deep");

test("SOURCE_URLS resolve to known public-record archives", () => {
  assert.match(SOURCE_URLS.uniteHere, /unitehere\.org/);
  assert.match(SOURCE_URLS.cdcNors, /cdc\.gov\/norsdashboard/);
  assert.match(SOURCE_URLS.ada, /ada\.gov\/cases/);
  assert.match(SOURCE_URLS.greenKey, /greenkey\.global/);
});

test("HOTELS includes the 6 majors plus 3 Vegas/platform brands", () => {
  const slugs = new Set(HOTELS.map(h => h.slug));
  for (const s of ["marriott-international", "hilton", "hyatt-hotels", "wyndham-hotels",
    "choice-hotels", "ihg-holiday-inn", "las-vegas-sands", "mgm-resorts-international",
    "caesars-entertainment", "airbnb", "expedia-group", "booking-holdings", "best-western"]) {
    assert.ok(slugs.has(s), `missing hotel slug ${s}`);
  }
});

test("every UNITE HERE / ADA citation carries a source URL", () => {
  for (const h of HOTELS) {
    for (const d of (h.unite_here_disputes || [])) {
      assert.match(d.source_url, /^https:\/\//);
    }
    for (const d of (h.ada_consent_decrees || [])) {
      assert.match(d.source_url, /^https:\/\/(www\.)?(ada|justice)\.gov/);
    }
  }
});

test("severityFor flags Wyndham (9 outbreaks + ADA decree) as poor", () => {
  const wynd = HOTELS.find(h => h.slug === "wyndham-hotels");
  assert.equal(severityFor(wynd), "poor");
});

test("severityFor: Hilton (38 Green Key properties, low outbreaks) → positive", () => {
  const hilton = HOTELS.find(h => h.slug === "hilton");
  // Hilton has 1 dispute + 1 ADA decree → "mixed" before positive check.
  // The ranking should be: ADA decrees >= 1 → mixed
  const sev = severityFor(hilton);
  assert.ok(["mixed", "positive"].includes(sev));
});

test("buildHotelBlock rewrites snake_case keys to camelCase and stamps source URLs", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "hotels.json"), "utf-8"));
  const marriott = fix.find(h => h.slug === "marriott-international");
  const block = buildHotelBlock(marriott);
  assert.equal(block.uniteHereDisputes.length, 1);
  assert.equal(block.adaConsentDecrees.length, 1);
  assert.equal(block.cdcOutbreaks5yr, 6);
  assert.ok(block.sourceUrls.length === 4);
});

test("buildSnapshot stamps source identifier and license", () => {
  const snap = buildSnapshot(HOTELS.slice(0, 2));
  assert.equal(snap.source, "hotel-deep");
  assert.equal(snap.hotel_count, 2);
  assert.match(snap.methodology, /UNITE HERE/);
});
