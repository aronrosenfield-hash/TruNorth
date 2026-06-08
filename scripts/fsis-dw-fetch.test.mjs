#!/usr/bin/env node
/**
 * Tests for fsis-dw-fetch.mjs + fsis-dw-merge.mjs
 *
 * Locally:  node --test scripts/fsis-dw-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePounds, classifyRisk, dedupeRecalls, normalizeRecall,
} from "./fsis-dw-fetch.mjs";
import { aggregate } from "./fsis-dw-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "test/fixtures/fsis-dw/sample.json");

test("FSIS-DW: parsePounds handles commas + missing", () => {
  assert.equal(parsePounds("29,819 pounds"), 29819);
  assert.equal(parsePounds("7,194,058 pounds"), 7194058);
  assert.equal(parsePounds("0 pounds"), 0);
  assert.equal(parsePounds(""), null);
  assert.equal(parsePounds(null), null);
  assert.equal(parsePounds("approximately"), null);
});

test("FSIS-DW: classifyRisk parses Class I/II/III", () => {
  assert.equal(classifyRisk("Class I"), "Class I");
  assert.equal(classifyRisk("Class II"), "Class II");
  assert.equal(classifyRisk("Class III"), "Class III");
  assert.equal(classifyRisk("Clase I"), null);
  assert.equal(classifyRisk(""), null);
});

test("FSIS-DW: dedupeRecalls keeps English when both present", () => {
  const records = [
    { field_recall_number: "X-1", langcode: "Spanish",  field_title: "es" },
    { field_recall_number: "X-1", langcode: "English",  field_title: "en" },
    { field_recall_number: "X-2", langcode: "Spanish",  field_title: "only-es" },
  ];
  const out = dedupeRecalls(records);
  assert.equal(out.length, 2);
  const x1 = out.find(r => r.field_recall_number === "X-1");
  assert.equal(x1.langcode, "English", "English wins");
  const x2 = out.find(r => r.field_recall_number === "X-2");
  assert.equal(x2.langcode, "Spanish", "Spanish-only kept");
});

test("FSIS-DW: fixture end-to-end yields 9 brands", async () => {
  const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  // 10 entries, but Tyson has English+Spanish for same recall → dedupes to 9
  const deduped = dedupeRecalls(raw);
  assert.equal(deduped.length, 9, "Tyson EN+ES collapses");

  const rows = deduped.map(normalizeRecall).filter(Boolean);
  // Use a fixed reference time matching fixtures so we have stable counts.
  const referenceNow = Date.parse("2026-01-01T00:00:00Z");
  const companies = aggregate(rows, referenceNow);
  // 9 distinct brands (Tyson, JBS, Boar's Head, Perdue, Cargill, Hormel,
  // Smithfield, Pilgrim's, Butterball).
  assert.equal(Object.keys(companies).length, 9);
});

test("FSIS-DW: aggregate counts Class I correctly", async () => {
  const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const rows = dedupeRecalls(raw).map(normalizeRecall).filter(Boolean);
  const referenceNow = Date.parse("2026-01-01T00:00:00Z");
  const companies = aggregate(rows, referenceNow);

  const tyson = companies[Object.keys(companies).find(k => /tyson/.test(k))];
  assert.equal(tyson.class_I_count, 1);
  assert.equal(tyson.total_recalls, 1);
  assert.equal(tyson.pounds_recalled_total, 29819);

  const boars = companies[Object.keys(companies).find(k => /boar/.test(k))];
  assert.equal(boars.class_I_count, 1);
  assert.equal(boars.pounds_recalled_total, 7194058);
});

test("FSIS-DW: recent_24mo_count respects cutoff", async () => {
  const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const rows = dedupeRecalls(raw).map(normalizeRecall).filter(Boolean);
  // If "now" is 2026-12-31, the 2024-03-15 Tyson recall is just inside 24mo.
  const now = Date.parse("2026-03-01T00:00:00Z");
  const companies = aggregate(rows, now);
  // Pilgrim's recall (2025-04-04) should be recent under all timeframes here.
  const pilgrims = companies[Object.keys(companies).find(k => /pilgrim/.test(k))];
  assert.equal(pilgrims.recent_24mo_count, 1);
  assert.equal(pilgrims.hasMeatPoultryRecall24mo, true);
});

test("FSIS-DW: recent_recalls capped at 5", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    recall_number: `R-${i}`, company: "X Co",
    date: `2025-0${i + 1}-01`, risk_level: "Class I",
    reason: "Listeria", product: "x", pounds_recalled: 100, states: "US",
    url: "http://example.com",
  }));
  const out = aggregate(rows, Date.now());
  const key = Object.keys(out)[0];
  assert.equal(out[key].recent_recalls.length, 5);
  assert.equal(out[key].total_recalls, 7);
});
