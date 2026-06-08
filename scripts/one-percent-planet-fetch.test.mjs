#!/usr/bin/env node
/**
 * node --test scripts/one-percent-planet-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeMember, buildSnapshot } from "./one-percent-planet-fetch.mjs";
import { buildAliasIndex, matchMember } from "./one-percent-planet-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/one-percent-planet/sample.json");

test("normalizeMember preserves merger-relevant fields", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const m = normalizeMember(seed.results[0]);
  assert.equal(m.business_name, "Patagonia, Inc.");
  assert.equal(m.country, "United States");
  assert.equal(m.member_since, "2002");
  assert.equal(m.category, "Apparel");
});

test("normalizeMember accepts camelCase alt-keys", () => {
  const m = normalizeMember({ businessName: "X Co", countryName: "FR", memberSince: 2020, businessCategory: "Food" });
  assert.equal(m.business_name, "X Co");
  assert.equal(m.country, "FR");
  assert.equal(m.member_since, "2020");
  assert.equal(m.category, "Food");
});

test("buildSnapshot groups by category + country", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const snap = buildSnapshot(seed.results.map(normalizeMember));
  assert.equal(snap.member_count, 6);
  assert.equal(snap.by_category.Apparel, 2);
  assert.equal(snap.by_country["United States"], 5);
});

test("matchMember exact-matches via normalized slug", () => {
  const idx = buildAliasIndex(["patagonia", "allbirds", "klean-kanteen"], {});
  assert.equal(matchMember("Patagonia, Inc.", idx), "patagonia");
  assert.equal(matchMember("Allbirds", idx), "allbirds");
  assert.equal(matchMember("Klean Kanteen", idx), "klean-kanteen");
});

test("matchMember returns null for unknown name", () => {
  const idx = buildAliasIndex(["patagonia"], {});
  assert.equal(matchMember("Wholly Unrelated Brand", idx), null);
});

test("matchMember uses alias for Dr. Bronner's", () => {
  const idx = buildAliasIndex(["dr-bronners"], { "dr-bronners": { aliases: ["Dr. Bronner's"] } });
  assert.equal(matchMember("Dr. Bronner's", idx), "dr-bronners");
});
