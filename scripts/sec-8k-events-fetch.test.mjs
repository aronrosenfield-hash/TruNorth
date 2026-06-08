#!/usr/bin/env node
/**
 * Test harness for sec-8k-events-fetch.mjs (node:test).
 *
 * Exercises the pure functions — htmlToText, archiveUrl,
 * pickRecent8KEvents, parseItem502, parseItem402 — against real-ish
 * 8-K HTML excerpts under test/fixtures/sec-8k-events/. No network calls.
 *
 * Also smoke-tests the merger's buildAugmentBlock + resolveSlug.
 *
 * Locally: node --test scripts/sec-8k-events-fetch.test.mjs
 *          node scripts/sec-8k-events-fetch.test.mjs
 *
 * Exit 0 on success, non-zero on any failed assertion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  htmlToText,
  archiveUrl,
  pickRecent8KEvents,
  parseItem502,
  parseItem402,
} from "./sec-8k-events-fetch.mjs";

import { buildAugmentBlock, resolveSlug } from "./sec-8k-events-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/sec-8k-events");

test("htmlToText strips tags and decodes basic entities", () => {
  const html = "<p>Hello&nbsp;<b>world</b></p>\n<script>x</script>";
  const txt = htmlToText(html);
  assert.equal(txt.includes("<"), false);
  assert.match(txt, /Hello\s+world/);
});

test("archiveUrl builds an EDGAR archive URL with no-dash accession", () => {
  const url = archiveUrl("0000320193", "0000320193-25-000005", "aapl-8k.htm");
  assert.equal(url, "https://www.sec.gov/Archives/edgar/data/320193/000032019325000005/aapl-8k.htm");
});

test("pickRecent8KEvents filters to 8-K + items 5.02/4.02 inside lookback", () => {
  // Fake submissions JSON with a mix of forms / items / dates.
  const today = new Date("2025-06-01T00:00:00Z");
  const subs = {
    filings: {
      recent: {
        form: ["8-K", "8-K", "10-K", "8-K", "8-K/A", "8-K"],
        filingDate: [
          "2025-03-15", // 8-K with 5.02 — INCLUDE
          "2024-08-01", // 8-K with 2.02 — exclude (wrong item)
          "2025-04-01", // 10-K — exclude (wrong form)
          "2022-01-15", // 8-K with 5.02 — exclude (>24mo old)
          "2024-11-04", // 8-K/A with 4.02 — INCLUDE
          "2025-05-20", // 8-K with 5.02 and 9.01 — INCLUDE
        ],
        accessionNumber: ["a1", "a2", "a3", "a4", "a5", "a6"],
        primaryDocument: ["d1.htm", "d2.htm", "d3.htm", "d4.htm", "d5.htm", "d6.htm"],
        items: ["5.02", "2.02", "", "5.02", "4.02", "5.02,9.01"],
        reportDate: ["", "", "", "", "", ""],
      },
    },
  };
  const events = pickRecent8KEvents(subs, { today, lookbackDays: 24 * 30 });
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => e.accession).sort(), ["a1", "a5", "a6"]);
  const a1 = events.find(e => e.accession === "a1");
  assert.deepEqual(a1.items, ["5.02"]);
  const a5 = events.find(e => e.accession === "a5");
  assert.deepEqual(a5.items, ["4.02"]);
});

test("pickRecent8KEvents does not match 15.02 or 14.02 (word-boundary)", () => {
  const today = new Date("2025-06-01T00:00:00Z");
  const subs = {
    filings: {
      recent: {
        form: ["8-K", "8-K"],
        filingDate: ["2025-04-01", "2025-04-02"],
        accessionNumber: ["x1", "x2"],
        primaryDocument: ["d1.htm", "d2.htm"],
        items: ["15.02", "14.02"],
        reportDate: ["", ""],
      },
    },
  };
  const events = pickRecent8KEvents(subs, { today });
  assert.equal(events.length, 0);
});

test("parseItem502 extracts role/action/person/severance from CEO resignation 8-K", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "item-5-02-resignation.html"), "utf-8");
  const text = htmlToText(html);
  const out = parseItem502(text);
  assert.ok(out.length >= 1, "expected at least one parsed event");
  const ev = out[0];
  assert.equal(ev.role, "CEO");
  assert.equal(ev.action, "Resignation");
  assert.equal(ev.personName, "John D. Smith");
  assert.equal(ev.severanceDisclosed, true);
  assert.match(ev.excerpt, /Item\s+5\.02/i);
});

test("parseItem502 classifies a plain director appointment as Appointment with no severance", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "item-5-02-director-appointment.html"), "utf-8");
  const text = htmlToText(html);
  const out = parseItem502(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, "Appointment");
  assert.equal(out[0].severanceDisclosed, false);
  // Role: should detect "Director" (the appointment is to the Board).
  assert.equal(out[0].role, "Director");
});

test("parseItem502 returns [] when no Item 5.02 heading is present", () => {
  assert.deepEqual(parseItem502("Item 2.02 Results of Operations. Some text."), []);
});

test("parseItem402 extracts restated periods and excerpt", async () => {
  const html = await fs.readFile(path.join(FIXTURES, "item-4-02-restatement.html"), "utf-8");
  const text = htmlToText(html);
  const out = parseItem402(text);
  assert.ok(out, "expected a parsed 4.02 object");
  // The fixture mentions FY 2023 and Q1 2024 + Q2 2024.
  assert.ok(out.periodsAffected.includes("2023"), `expected 2023 in ${out.periodsAffected}`);
  assert.ok(out.periodsAffected.includes("2024"), `expected 2024 in ${out.periodsAffected}`);
  assert.ok(out.periodsAffected.includes("Q1 2024"), `expected Q1 2024 in ${out.periodsAffected}`);
  assert.ok(out.periodsAffected.includes("Q2 2024"), `expected Q2 2024 in ${out.periodsAffected}`);
  assert.match(out.excerpt, /Item\s+4\.02/i);
});

test("parseItem402 returns null when section absent", () => {
  assert.equal(parseItem402("Item 5.02 here. No 4.02."), null);
});

test("buildAugmentBlock keeps only departure-like actions and computes severance flag", () => {
  const record = {
    execDepartures: [
      { filingDate: "2025-03-15", role: "CEO", action: "Resignation", personName: "X",
        severanceDisclosed: true,  sourceUrl: "https://example/1" },
      { filingDate: "2025-03-15", role: "CEO", action: "Appointment", personName: "Y",
        severanceDisclosed: false, sourceUrl: "https://example/2" },
      { filingDate: "2024-06-01", role: "Director", action: "Retirement", personName: "Z",
        severanceDisclosed: false, sourceUrl: "https://example/3" },
    ],
    restatements: [
      { filingDate: "2024-11-04", periodsAffected: ["2023", "Q1 2024"],
        sourceUrl: "https://example/r1", excerpt: "..." },
    ],
  };
  const out = buildAugmentBlock(record);
  assert.ok(out);
  assert.equal(out.execPay.recentExecDepartures.length, 2);
  assert.deepEqual(out.execPay.recentExecDepartures.map(d => d.action), ["Resignation", "Retirement"]);
  assert.equal(out.execPay.severanceDisclosed, true);
  assert.equal(out.governance.recentRestatements.length, 1);
  assert.deepEqual(out.governance.recentRestatements[0].periodsAffected, ["2023", "Q1 2024"]);
});

test("buildAugmentBlock returns null when nothing remains after filtering", () => {
  const record = {
    execDepartures: [
      { filingDate: "2025-01-01", role: "CEO", action: "Appointment",
        personName: null, severanceDisclosed: false, sourceUrl: "u" },
    ],
    restatements: [],
  };
  assert.equal(buildAugmentBlock(record), null);
});

test("resolveSlug returns null routing for unknown slugs with empty maps", () => {
  const r = resolveSlug("definitely-not-a-real-brand-zzz", { aliases: {}, parents: {} });
  assert.equal(r.slug, null);
  assert.equal(r.routed_via, "orphan");
});
