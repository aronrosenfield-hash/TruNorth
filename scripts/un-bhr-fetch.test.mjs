#!/usr/bin/env node
/**
 * Test harness for un-bhr-fetch.mjs.
 *
 * Runs the OHCHR latest-reports table parser, company-name extractor
 * and business-case filter against the hand-crafted fixture at
 *   scripts/fixtures/un-bhr/sample.html
 *
 * NO network calls — we deliberately do not hit ohchr.org from CI or
 * worktree review.
 *
 *   node --test scripts/un-bhr-fetch.test.mjs
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseLatestReportsPage,
  parseMetaCell,
  extractCompanies,
  isBusinessCase,
  stripHtml,
} from "./un-bhr-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/un-bhr/sample.html");

async function loadFixture() {
  return fs.readFile(FIXTURE, "utf-8");
}

test("parses every <tr data-id> row in the fixture", async () => {
  const html = await loadFixture();
  const rows = parseLatestReportsPage(html);
  // 5 sentinels total, but row 30001 appears twice → 4 unique
  assert.equal(rows.length, 4, "4 unique communications");
  const ids = rows.map(r => r.id).sort();
  assert.deepEqual(ids, ["30001", "30002", "30003", "30004"]);
});

test("first cell decomposes into date / country / type / ref", async () => {
  const html = await loadFixture();
  const rows = parseLatestReportsPage(html);
  const nga = rows.find(r => r.id === "30001");
  assert.equal(nga.date, "2026-01-15", "date normalised to ISO");
  assert.equal(nga.country, "Nigeria");
  assert.equal(nga.type, "JAL");
  assert.equal(nga.ref, "NGA 1/2026");
  assert.match(nga.source_url, /gId=30001$/);
});

test("parseMetaCell handles ordering shuffles", () => {
  // 4 <ul>s in canonical order
  const a = parseMetaCell(`
    <ul>02 Mar 2026</ul>
    <ul style="font-weight:700">Brazil</ul>
    <ul>UA</ul>
    <ul><a href="/x?gId=99">BRA 3/2026</a></ul>
  `);
  assert.equal(a.date, "2026-03-02");
  assert.equal(a.country, "Brazil");
  assert.equal(a.type, "UA");
  assert.equal(a.ref, "BRA 3/2026");
});

test("mandates list is extracted from the second cell", async () => {
  const html = await loadFixture();
  const rows = parseLatestReportsPage(html);
  const nga = rows.find(r => r.id === "30001");
  assert.ok(
    nga.mandates.some(m => /transnational corporations/i.test(m)),
    "Working Group mandate captured",
  );
  assert.ok(nga.mandates.includes("environment"));
});

test("summary text is truncated, strips 'More details…' tail", async () => {
  const html = await loadFixture();
  const rows = parseLatestReportsPage(html);
  const nga = rows.find(r => r.id === "30001");
  assert.ok(nga.summary.length > 50);
  assert.ok(nga.summary.length <= 1000);
  assert.ok(!/more details/i.test(nga.summary), "trailing link removed");
  assert.match(nga.summary, /Niger Delta/);
});

test("extractCompanies pulls ALL named corporations from a multi-company summary", () => {
  const text =
    "Information received concerning alleged violations linked to " +
    "Chevron Corporation, Shell plc and ExxonMobil Corporation, including " +
    "reported community displacement.";
  const names = extractCompanies(text);
  // Order is set-insertion order — check membership.
  assert.ok(names.some(n => /Chevron/.test(n)), `Chevron found in ${JSON.stringify(names)}`);
  assert.ok(names.some(n => /Shell/.test(n)), "Shell found");
  assert.ok(names.some(n => /ExxonMobil/.test(n)), "ExxonMobil found");
});

test("extractCompanies picks up single-name corporations via suffix", () => {
  const names = extractCompanies("activities of Glencore plc in the DRC");
  assert.ok(names.some(n => /Glencore/.test(n)), `Glencore found in ${JSON.stringify(names)}`);
});

test("extractCompanies ignores UN/State entities even with capitalised words", () => {
  const text =
    "The Working Group on the issue of human rights and transnational " +
    "corporations and other business enterprises and the Special " +
    "Rapporteur on the rights of indigenous peoples are concerned.";
  const names = extractCompanies(text);
  assert.equal(names.length, 0, `no corporate hits, got ${JSON.stringify(names)}`);
});

test("isBusinessCase keeps multi-company AL/UA with WGBHR mandate", async () => {
  const html = await loadFixture();
  const rows = parseLatestReportsPage(html);
  const nga = isBusinessCase(rows.find(r => r.id === "30001"));
  assert.ok(nga, "row 30001 kept");
  assert.ok(nga.named_companies.length >= 3, `3+ companies, got ${nga.named_companies.length}`);
  assert.equal(nga.topic, "environment");
});

test("isBusinessCase drops state-only cases with no corporate mention", async () => {
  const html = await loadFixture();
  const rows = parseLatestReportsPage(html);
  const blr = rows.find(r => r.id === "30003");
  assert.equal(isBusinessCase(blr), null, "Belarus row (no companies) is dropped");
});

test("isBusinessCase keeps single-company case (Glencore)", async () => {
  const html = await loadFixture();
  const rows = parseLatestReportsPage(html);
  const che = isBusinessCase(rows.find(r => r.id === "30002"));
  assert.ok(che, "row 30002 kept");
  assert.ok(che.named_companies.some(n => /Glencore/.test(n)));
});

test("stripHtml decodes entities and collapses whitespace", () => {
  assert.equal(stripHtml("foo&amp;bar"), "foo&bar");
  assert.equal(stripHtml("<p>hello   <b>world</b></p>"), "hello world");
  assert.equal(stripHtml(null), "");
});
