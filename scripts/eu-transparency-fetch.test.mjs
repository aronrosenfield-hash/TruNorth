#!/usr/bin/env node
/**
 * EU Transparency Register fetcher — tests (node:test).
 *
 * Exercises both code paths:
 *   - JSON shape() / parseSpendEur() / filterAndShape()  (backward-compat
 *     fixture at scripts/fixtures/eu-transparency/sample.json)
 *   - XML  shapeXmlBlock() / parseXmlPayload() / filterShapedXml()
 *     against the 30-org XML fixture (matches the new live source since
 *     the EU retired the JSON bulk dump pre-2026-06)
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
  decodeXmlEntities,
  shapeXmlBlock,
  parseXmlPayload,
  iterXmlBlocks,
  filterShapedXml,
} from "./eu-transparency-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_JSON = path.join(__dirname, "fixtures/eu-transparency/sample.json");
const FIXTURE_XML = path.join(__dirname, "fixtures/eu-transparency/sample.xml");

const fixturePayload = JSON.parse(await fs.readFile(FIXTURE_JSON, "utf-8"));
const rawResults = fixturePayload.results;
const xmlText = await fs.readFile(FIXTURE_XML, "utf-8");

/* ====================================================================
 *   shared helpers
 * ==================================================================== */

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

test("decodeXmlEntities — named and numeric refs", () => {
  assert.equal(decodeXmlEntities("Johnson &amp; Johnson"), "Johnson & Johnson");
  assert.equal(decodeXmlEntities("a &lt; b &gt; c"), "a < b > c");
  assert.equal(decodeXmlEntities("&quot;hi&quot;"), '"hi"');
  assert.equal(decodeXmlEntities("&#xd;"), "\r");
  assert.equal(decodeXmlEntities("caf&#233;"), "café");
});

/* ====================================================================
 *   JSON path (backward-compat — historical fixture)
 * ==================================================================== */

test("[JSON] fixture has 30 entries", () => {
  assert.equal(rawResults.length, 30);
});

test("[JSON] shape — Google entry pulled apart correctly", () => {
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

test("[JSON] shape — Cefic (top spender) parses 10M+ band", () => {
  const cefic = rawResults.find(r => r.name.startsWith("Cefic"));
  const s = shape(cefic);
  assert.equal(s.annualSpendEur, 10_375_000);
  assert.equal(s.accreditedLobbyists, 12);
});

test("[JSON] shape — returns null on missing id or name", () => {
  assert.equal(shape({ name: "no id" }), null);
  assert.equal(shape({ identificationCode: "x", name: "" }), null);
  assert.equal(shape({}), null);
});

test("[JSON] filterAndShape — drops NGOs, keeps companies + trade assocs", () => {
  const kept = filterAndShape(rawResults);
  assert.equal(kept.length, 29);
  assert.ok(!kept.some(k => k.name.includes("Friends of the Earth")));
  assert.ok(kept.some(k => k.name === "DigitalEurope"));
  assert.ok(kept.some(k => k.name === "BusinessEurope"));
});

test("[JSON] filterAndShape — respects --limit equivalent", () => {
  const kept = filterAndShape(rawResults, { limit: 5 });
  assert.equal(kept.length, 5);
});

test("[JSON] integration — top 10 spenders in fixture as expected", () => {
  const kept = filterAndShape(rawResults);
  const top10 = [...kept]
    .sort((a, b) => (b.annualSpendEur || 0) - (a.annualSpendEur || 0))
    .slice(0, 10)
    .map(k => k.name);
  assert.equal(top10[0], "Cefic - The European Chemical Industry Council");
  assert.ok(top10.includes("Meta Platforms Ireland Ltd"));
  assert.ok(top10.includes("Microsoft Corporation"));
  assert.ok(top10.includes("Google"));
  assert.ok(top10.includes("ExxonMobil Petroleum & Chemical BVBA"));
});

/* ====================================================================
 *   XML path (new — current live source)
 * ==================================================================== */

const xmlAll = parseXmlPayload(xmlText);

test("[XML] iterXmlBlocks yields every interestRepresentative", () => {
  const blocks = Array.from(iterXmlBlocks(xmlText));
  assert.equal(blocks.length, 30);
});

test("[XML] parseXmlPayload — 30 shaped records from fixture", () => {
  assert.equal(xmlAll.length, 30);
});

test("[XML] shapeXmlBlock — Google entry pulled apart correctly", () => {
  const google = xmlAll.find(r => r.name === "Google");
  assert.ok(google, "Google should be in XML output");
  assert.equal(google.registrationId, "27798511275-77");
  assert.equal(google.category, "Companies & groups");
  assert.equal(google.headquartersCountry, "Ireland"); // upper→title-cased
  assert.equal(google.accreditedLobbyists, 8);
  assert.equal(google.annualSpendEur, 6_250_000); // (6_000_000 + 6_499_999) / 2 rounded up
  assert.ok(google.fields.includes("Digital single market"));
  assert.ok(google.fields.includes("Taxation"));
  assert.equal(google.lastUpdated, "2026-04-12");
  assert.ok(google.sourceUrl.includes("27798511275-77"));
});

test("[XML] shapeXmlBlock — handles XML entities in name (J&J)", () => {
  const jnj = xmlAll.find(r => r.registrationId === "765141329163-49");
  assert.ok(jnj, "Johnson & Johnson should be in XML output");
  assert.equal(jnj.name, "Johnson & Johnson Services Inc.");
});

test("[XML] shapeXmlBlock — intermediaries don't poison annual spend", () => {
  // Microsoft has a closedYear with intermediaries[representationCosts]
  // 100k-199k inside, plus its own costs 7M-7.5M. We must pick 7M-7.5M.
  const ms = xmlAll.find(r => r.name === "Microsoft Corporation");
  assert.ok(ms);
  assert.equal(ms.annualSpendEur, 7_250_000);
});

test("[XML] shapeXmlBlock — Cefic top spender 10M+ range", () => {
  const cefic = xmlAll.find(r => r.name.startsWith("Cefic"));
  assert.ok(cefic);
  // (10_000_000 + 10_749_999) / 2 = 10_374_999.5 -> 10_375_000
  assert.equal(cefic.annualSpendEur, 10_375_000);
  assert.equal(cefic.accreditedLobbyists, 12);
});

test("[XML] shapeXmlBlock — country name title-cased from UPPERCASE", () => {
  const apple = xmlAll.find(r => r.name === "Apple Inc.");
  assert.equal(apple.headquartersCountry, "United States");
});

test("[XML] shapeXmlBlock — returns null on missing id or name", () => {
  assert.equal(shapeXmlBlock("<foo/>"), null);
  assert.equal(
    shapeXmlBlock("<identificationCode>x</identificationCode>"),
    null,
  );
});

test("[XML] filterShapedXml — drops NGOs, keeps companies + trade assocs", () => {
  const kept = filterShapedXml(xmlAll);
  // 1 NGO ("Friends of the Earth Europe") dropped.
  assert.equal(kept.length, 29);
  assert.ok(!kept.some(k => k.name.includes("Friends of the Earth")));
  assert.ok(kept.some(k => k.name === "DigitalEurope"));
  assert.ok(kept.some(k => k.name === "BusinessEurope"));
  // "Companies & groups" must be matched (regex covers /compan(y|ies)/)
  assert.ok(kept.some(k => k.category === "Companies & groups"));
});

test("[XML] filterShapedXml — respects --limit equivalent", () => {
  const kept = filterShapedXml(xmlAll, { limit: 5 });
  assert.equal(kept.length, 5);
});

test("[XML] integration — top 10 spenders in XML fixture as expected", () => {
  const kept = filterShapedXml(xmlAll);
  const top10 = [...kept]
    .sort((a, b) => (b.annualSpendEur || 0) - (a.annualSpendEur || 0))
    .slice(0, 10)
    .map(k => k.name);
  assert.equal(top10[0], "Cefic - The European Chemical Industry Council");
  assert.ok(top10.includes("Meta Platforms Ireland Ltd"));
  assert.ok(top10.includes("Microsoft Corporation"));
  assert.ok(top10.includes("Google"));
  assert.ok(top10.includes("ExxonMobil Petroleum & Chemical BVBA"));
});

test("[XML] shape parity — every JSON-fixture id is present in XML fixture", () => {
  const idsJson = new Set(rawResults.map(r => r.identificationCode));
  const idsXml = new Set(xmlAll.map(r => r.registrationId));
  for (const id of idsJson) assert.ok(idsXml.has(id), `xml missing ${id}`);
});
