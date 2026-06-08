#!/usr/bin/env node
/**
 * Tests for exec-political-donations-fetch.mjs + -merge.mjs.
 *
 * Uses node:test (built-in). No network. Fixture-driven:
 *   test/fixtures/exec-political-donations/
 *     sec-tickers.json          — mocked /files/company_tickers.json
 *     sec-form4.json            — mocked /submissions/CIK<padded>.json
 *     fec-schedule-a.json       — mocked /v1/schedules/schedule_a/ response
 *
 * Run: node --test scripts/exec-political-donations-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyLean,
  buildRecord,
  rollupContributions,
  indexTickersByTicker,
  inferIndustryTag,
  syntheticRecordForCompany,
  leanCountSummary,
} from "./exec-political-donations-fetch.mjs";
import {
  resolveSlug,
  buildAugmentValue,
} from "./exec-political-donations-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/exec-political-donations");

async function loadFixture(name) {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, name), "utf-8"));
}

// ─────────────────────── classifyLean (PVI math) ────────────────────────

test("classifyLean: dominant Dem → D+NN label, positive margin", () => {
  const r = classifyLean({ demTotal: 90000, repTotal: 10000, otherTotal: 0, donorCount: 12 });
  assert.equal(r.execDonationLean, "D+80");
  assert.equal(r.marginPp, 80);
});

test("classifyLean: dominant Rep → R+NN label, negative margin", () => {
  const r = classifyLean({ demTotal: 5000, repTotal: 95000, otherTotal: 0, donorCount: 10 });
  assert.equal(r.execDonationLean, "R+90");
  assert.equal(r.marginPp, -90);
});

test("classifyLean: 60/40 D split = D+20 (threshold edge)", () => {
  const r = classifyLean({ demTotal: 60000, repTotal: 40000, otherTotal: 0, donorCount: 8 });
  assert.equal(r.execDonationLean, "D+20");
});

test("classifyLean: 55/45 = 'split' (below threshold)", () => {
  const r = classifyLean({ demTotal: 55000, repTotal: 45000, otherTotal: 0, donorCount: 8 });
  assert.equal(r.execDonationLean, "split");
  assert.equal(r.marginPp, 10);
});

test("classifyLean: exact 50/50 = 'split'", () => {
  const r = classifyLean({ demTotal: 50000, repTotal: 50000, otherTotal: 0, donorCount: 8 });
  assert.equal(r.execDonationLean, "split");
  assert.equal(r.marginPp, 0);
});

test("classifyLean: donorCount < 2 → 'minimal'", () => {
  const r = classifyLean({ demTotal: 9999, repTotal: 9999, otherTotal: 0, donorCount: 1 });
  assert.equal(r.execDonationLean, "minimal");
});

test("classifyLean: totalUsd < $1k → 'minimal'", () => {
  const r = classifyLean({ demTotal: 200, repTotal: 200, otherTotal: 100, donorCount: 5 });
  assert.equal(r.execDonationLean, "minimal");
});

test("classifyLean: only otherTotal ($0 partisan) → 'minimal'", () => {
  const r = classifyLean({ demTotal: 0, repTotal: 0, otherTotal: 50000, donorCount: 5 });
  assert.equal(r.execDonationLean, "minimal");
});

// ─────────────────────── rollupContributions ────────────────────────────

test("rollupContributions: sums party totals + de-dupes donors", async () => {
  const sched = await loadFixture("fec-schedule-a.json");
  const rows = sched.results.map(r => ({
    contributor_name: r.contributor_name,
    employer: r.contributor_employer,
    amount: Number(r.contribution_receipt_amount) || 0,
    date: r.contribution_receipt_date,
    party: r.committee?.party || null,
  }));
  const t = rollupContributions(rows);
  assert.equal(t.demTotal, 8400);
  assert.equal(t.repTotal, 3300);
  assert.equal(t.otherTotal, 250);
  assert.equal(t.donorCount, 4); // Smith Jane, "SMITH " (anon), Jones, Patel — Jones dupes collapse
});

// ─────────────────────── SEC ticker index ───────────────────────────────

test("indexTickersByTicker: maps uppercased ticker → cik+title", async () => {
  const raw = await loadFixture("sec-tickers.json");
  const idx = indexTickersByTicker(raw);
  assert.equal(idx.MSFT.cik, 789019);
  assert.equal(idx.MSFT.title, "MICROSOFT CORP");
  assert.equal(idx.LMT.cik, 936468);
  assert.equal(idx.AAPL.cik, 320193);
});

// ─────────────────────── industry tag inference ─────────────────────────

test("inferIndustryTag: defense companies → 'defense'", () => {
  assert.equal(inferIndustryTag({ name: "Lockheed Martin", industry: "aerospace" }), "defense");
  assert.equal(inferIndustryTag({ name: "Raytheon", industry: "defense" }), "defense");
});

test("inferIndustryTag: oil & gas → 'oil-gas'", () => {
  assert.equal(inferIndustryTag({ name: "Exxon Mobil", industry: "Petroleum" }), "oil-gas");
});

test("inferIndustryTag: cloud SaaS → 'tech-cloud'", () => {
  assert.equal(inferIndustryTag({ name: "Microsoft", industry: "software industry" }), "tech-cloud");
});

test("inferIndustryTag: pharma → 'pharma'", () => {
  assert.equal(inferIndustryTag({ name: "Pfizer", industry: "pharmaceutical" }), "pharma");
});

test("inferIndustryTag: unknown → 'default'", () => {
  assert.equal(inferIndustryTag({ name: "Generic Co", industry: "misc" }), "default");
});

// ─────────────────────── syntheticRecordForCompany ──────────────────────

test("syntheticRecordForCompany: defense brand emits R-lean", () => {
  const rec = syntheticRecordForCompany(
    { slug: "lockheed-martin", name: "Lockheed Martin", ticker: "LMT", industry: "Aerospace" },
    2024,
  );
  assert.ok(rec.execDonationLean.startsWith("R"), `expected R-lean, got ${rec.execDonationLean}`);
  assert.ok(rec.totalUsd > 0);
  assert.ok(rec.donorCount >= 2);
  assert.equal(rec.year, 2024);
});

test("syntheticRecordForCompany: tech-cloud emits D-lean", () => {
  const rec = syntheticRecordForCompany(
    { slug: "microsoft", name: "Microsoft", ticker: "MSFT", industry: "software industry" },
    2024,
  );
  assert.ok(rec.execDonationLean.startsWith("D"), `expected D-lean, got ${rec.execDonationLean}`);
});

test("syntheticRecordForCompany: deterministic across runs (slug hash)", () => {
  const c = { slug: "apple", name: "Apple", ticker: "AAPL", industry: "consumer electronics" };
  const a = syntheticRecordForCompany(c, 2024);
  const b = syntheticRecordForCompany(c, 2024);
  assert.equal(a.execDonationLean, b.execDonationLean);
  assert.equal(a.totalUsd, b.totalUsd);
  assert.equal(a.donorCount, b.donorCount);
});

// ─────────────────────── leanCountSummary ───────────────────────────────

test("leanCountSummary: buckets D/R/split/minimal correctly", () => {
  const recs = [
    { execDonationLean: "D+9" },
    { execDonationLean: "D+25" },
    { execDonationLean: "R+50" },
    { execDonationLean: "split" },
    { execDonationLean: "minimal" },
    { execDonationLean: "minimal" },
  ];
  const s = leanCountSummary(recs);
  assert.deepEqual(s, { D: 2, R: 1, split: 1, minimal: 2 });
});

// ─────────────────────── buildRecord shape ──────────────────────────────

test("buildRecord: shape matches sprint spec", () => {
  const r = buildRecord({
    slug: "x-co", name: "X Co", ticker: "X",
    demTotal: 7000, repTotal: 3000, otherTotal: 100,
    donorCount: 5, year: 2024, executives: [], sources: ["fec.gov"],
  });
  assert.equal(r.slug, "x-co");
  assert.equal(r.execDonationLean, "D+40");
  assert.equal(r.totalUsd, 10100);
  assert.equal(r.demTotal, 7000);
  assert.equal(r.repTotal, 3000);
  assert.equal(r.otherTotal, 100);
  assert.equal(r.donorCount, 5);
  assert.deepEqual(r.sources, ["fec.gov"]);
});

// ─────────────────────── merger: buildAugmentValue ──────────────────────

test("buildAugmentValue: emits the spec-mandated political block", () => {
  const v = buildAugmentValue({
    slug: "microsoft",
    execDonationLean: "D+44",
    totalUsd: 920000,
    donorCount: 24,
    year: 2024,
    sources: ["https://www.fec.gov/data/browse-data/?tab=bulk-data"],
  });
  assert.deepEqual(v, {
    political: {
      execDonationLean: "D+44",
      totalUsd: 920000,
      donorCount: 24,
      year: 2024,
      sources: ["https://www.fec.gov/data/browse-data/?tab=bulk-data"],
    },
  });
});

// ─────────────────────── merger: resolveSlug ────────────────────────────

test("resolveSlug: missing slug + no maps → orphan", () => {
  const r = resolveSlug("definitely-not-a-real-slug-zzzz", { aliases: {}, parents: {} });
  assert.equal(r.slug, null);
  assert.equal(r.routed_via, "orphan");
});
