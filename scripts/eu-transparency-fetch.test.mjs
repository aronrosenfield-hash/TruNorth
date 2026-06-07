#!/usr/bin/env node
/**
 * EU Transparency Register fetcher — tests (node:test).
 *
 * Exercises shape(), parseSpendEur(), filterAndShape() against the 30-org
 * fixture at scripts/fixtures/eu-transparency/sample.json. NO network.
 *
 * Run: node --test scripts/eu-transparency-fetch.test.mjs
 *  or: node scripts/eu-transparency-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  shape,
  parseSpendEur,
  parseInt0,
  filterAndShape,
} from "./eu-transparency-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/eu-transparency/sample.json");

const fixturePayload = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
const rawResults = fixturePayload.results;

test("fixture has 30 entries", () => {
  assert.equal(rawResults.length, 30);
});

test("parseSpendEur — band midpoint", () => {
  assert.equal(parseSpendEur("100,000 - 199,999"), 150_000);
  assert.equal(parseSpendEur("6,000,000 - 6,499,999"), 6_250_000);
  assert.equal(parseSpendEur("100,000–199,999"), 150_000); // en-dash
});

test("parseSpendEur — bounded sides", () => {
  assert.equal(parseSpendEur("<10,000"), 5_000);
  assert.equal(parseSpendEur(">=10,000,000"), 10_000_000);
  assert.equal(parseSpendEur(">10,000,000"), 10_000_000);
});

test("parseSpendEur — plain numbers and edge cases", () => {
  assert.equal(parseSpendEur("250000"), 250_000);
  assert.equal(parseSpendEur("250,000"), 250_000);
  assert.equal(parseSpendEur(250_000), 250_000);
  assert.equal(parseSpendEur(""), null);
  assert.equal(parseSpendEur(null), null);
  assert.equal(parseSpendEur(undefined), null);
});

test("parseInt0 — defaults to 0 on garbage", () => {
  assert.equal(parseInt0(7), 7);
  assert.equal(parseInt0("12"), 12);
  assert.equal(parseInt0(null), 0);
  assert.equal(parseInt0("not a number"), 0);
});

test("shape — Google entry pulled apart correctly", () => {
  const google = rawResults.find(r => r.name === "Google");
  const s = shape(google);
  assert.equal(s.registrationId, "27798511275-77");
  assert.equal(s.name, "Google");
  assert.equal(s.category, "Company");
  assert.equal(s.headquartersCountry, "Ireland");
  assert.equal(s.accreditedLobbyists, 8);
  assert.equal(s.annualSpendEur, 6_250_000);
  assert.ok(s.fields.includes("Digital single market"));
  assert.ok(s.fields.includes("Taxation"));
  assert.equal(s.lastUpdated, "2026-04-12");
  assert.ok(s.sourceUrl.startsWith("https://transparency-register"));
});

test("shape — Cefic (top spender) parses 10M+ band", () => {
  const cefic = rawResults.find(r => r.name.startsWith("Cefic"));
  const s = shape(cefic);
  assert.equal(s.annualSpendEur, 10_375_000);
  assert.equal(s.accreditedLobbyists, 12);
});

test("shape — returns null on missing id or name", () => {
  assert.equal(shape({ name: "no id" }), null);
  assert.equal(shape({ identificationCode: "x", name: "" }), null);
  assert.equal(shape({}), null);
});

test("filterAndShape — drops NGOs, keeps companies + trade assocs", () => {
  const kept = filterAndShape(rawResults);
  // 1 NGO ("Friends of the Earth Europe") should be dropped.
  assert.equal(kept.length, 29);
  assert.ok(!kept.some(k => k.name.includes("Friends of the Earth")));
  assert.ok(kept.some(k => k.name === "DigitalEurope"));
  assert.ok(kept.some(k => k.name === "BusinessEurope"));
});

test("filterAndShape — respects --limit equivalent", () => {
  const kept = filterAndShape(rawResults, { limit: 5 });
  assert.equal(kept.length, 5);
});

test("integration — top 10 spenders in fixture as expected", () => {
  const kept = filterAndShape(rawResults);
  const top10 = [...kept]
    .sort((a, b) => (b.annualSpendEur || 0) - (a.annualSpendEur || 0))
    .slice(0, 10)
    .map(k => k.name);
  // Cefic should be #1 (€10M+ band)
  assert.equal(top10[0], "Cefic - The European Chemical Industry Council");
  // Sanity — these all belong in the top 10
  assert.ok(top10.includes("Meta Platforms Ireland Ltd"));
  assert.ok(top10.includes("Microsoft Corporation"));
  assert.ok(top10.includes("Google"));
  assert.ok(top10.includes("ExxonMobil Petroleum & Chemical BVBA"));
});
