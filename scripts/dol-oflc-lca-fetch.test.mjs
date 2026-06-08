#!/usr/bin/env node
/**
 * node --test scripts/dol-oflc-lca-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ingestRow,
  finalizeAgg,
  buildSnapshot,
  annualizeWage,
  defaultXlsxUrl,
} from "./dol-oflc-lca-fetch.mjs";
import { parseCSV } from "./lib/csv-mini.mjs";
import {
  buildAliasIndex,
  matchEmployer,
  aggregateForSlug,
} from "./dol-oflc-lca-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/dol-oflc-lca/sample.csv");

test("annualizeWage converts hourly to yearly", () => {
  assert.equal(annualizeWage(40, "Hour"), 40 * 2080);
  assert.equal(annualizeWage(2000, "Week"), 2000 * 52);
  assert.equal(annualizeWage(8000, "Month"), 96000);
  assert.equal(annualizeWage(150000, "Year"), 150000);
  assert.equal(annualizeWage("", "Year"), 0);
});

test("defaultXlsxUrl points at an existing FY pattern", () => {
  const url = defaultXlsxUrl(new Date("2026-06-08T00:00:00Z"));
  assert.match(url, /LCA_Disclosure_Data_FY\d{4}_Q4\.xlsx$/);
});

test("ingestRow aggregates per employer and counts statuses", async () => {
  const rows = parseCSV(await fs.readFile(FIXTURE, "utf-8"));
  const agg = new Map();
  for (const r of rows) ingestRow(r, agg);

  assert.equal(agg.size, 7); // amazon, google, walmart, apple, meta, tyson, somecorp

  const amazon = agg.get("AMAZON.COM SERVICES LLC");
  assert.equal(amazon.lca_count, 3);
  assert.equal(amazon.certified_count, 2);
  assert.equal(amazon.denied_count, 1);

  const google = agg.get("GOOGLE LLC");
  assert.equal(google.lca_count, 3);
  assert.equal(google.certified_count, 2);
  assert.equal(google.withdrawn_count, 1);
});

test("finalizeAgg produces a wage-weighted average and top occupations", async () => {
  const rows = parseCSV(await fs.readFile(FIXTURE, "utf-8"));
  const agg = new Map();
  for (const r of rows) ingestRow(r, agg);
  const employers = finalizeAgg(agg, { fiscalYear: "FY2025_Q1", sourceUrl: "x" });

  const amazon = employers.find((e) => e.employer_name === "AMAZON.COM SERVICES LLC");
  // (165000*1 + 195000*2 + 180000*1) / (1+2+1) = (165k+390k+180k)/4 = 183,750
  assert.equal(amazon.avg_wage_offered_usd, 183750);
  assert.ok(amazon.top_occupations.length > 0);
  assert.equal(amazon.top_occupations[0].title, "Software Developers");
});

test("annualization kicks in for hourly Apple row", async () => {
  const rows = parseCSV(await fs.readFile(FIXTURE, "utf-8"));
  const agg = new Map();
  for (const r of rows) ingestRow(r, agg);
  const employers = finalizeAgg(agg, { fiscalYear: "FY2025_Q1", sourceUrl: "x" });
  const apple = employers.find((e) => e.employer_name === "APPLE INC");
  // 3 software at 205k (3 workers) + 1 hardware at $40/hr (1 worker)
  // weighted: (205000*3 + 40*2080*1) / (3+1) = (615000 + 83200) / 4 = 174550
  assert.equal(apple.avg_wage_offered_usd, 174550);
});

test("buildSnapshot rolls up totals", async () => {
  const rows = parseCSV(await fs.readFile(FIXTURE, "utf-8"));
  const agg = new Map();
  for (const r of rows) ingestRow(r, agg);
  const employers = finalizeAgg(agg, { fiscalYear: "FY2025_Q1", sourceUrl: "x" });
  const snap = buildSnapshot(employers, {
    fiscalYear: "FY2025_Q1",
    sourceUrl: "x",
    fileName: "test.xlsx",
  });
  assert.equal(snap.source, "dol-oflc-lca");
  assert.equal(snap.total_lcas, rows.length);
  assert.equal(snap.employer_count, 7);
  assert.ok(snap.total_certified >= snap.total_lcas - 2); // 2 non-certified rows in fixture
});

test("matchEmployer routes legal names to slugs via curated aliases", () => {
  // Without curated aliases, auto-generated slug index does exact-only:
  //   "GOOGLE LLC" → norm "google" → matches exact "google".
  //   "AMAZON.COM SERVICES LLC" → norm "amazon.com services" → no exact hit.
  const bare = buildAliasIndex(["amazon", "google"], {});
  assert.equal(matchEmployer("GOOGLE LLC", bare), "google");
  assert.equal(matchEmployer("AMAZON.COM SERVICES LLC", bare), null);

  // With curated aliases (substring word-boundary fallback enabled):
  const curated = buildAliasIndex(
    ["amazon", "walmart"],
    {
      amazon: { aliases: ["Amazon.com Services", "Amazon Web Services"] },
      walmart: { aliases: ["Wal-Mart Associates"] },
    },
  );
  assert.equal(matchEmployer("AMAZON.COM SERVICES LLC", curated), "amazon");
  assert.equal(matchEmployer("WAL-MART ASSOCIATES INC", curated), "walmart");
});

test("matchEmployer does not over-match common-word slugs", () => {
  // Real-world bug guard: generic slugs like 'america' / 'international'
  // exist in /public/data/companies and must NOT pull in every multinational
  // H-1B filer (HCL America, UST Global, Mastercard International).
  const idx = buildAliasIndex(["america", "global", "international"], {});
  assert.equal(matchEmployer("HCL AMERICA INC", idx), null);
  assert.equal(matchEmployer("UST GLOBAL INC", idx), null);
  assert.equal(matchEmployer("MASTERCARD INTERNATIONAL INCORPORATED", idx), null);
});

test("matchEmployer returns null for unknown employers", () => {
  const idx = buildAliasIndex(["amazon", "google"], {});
  assert.equal(matchEmployer("SOMECORP HOLDINGS LLC", idx), null);
});

test("aggregateForSlug rolls multiple filers into one slug record", async () => {
  const rows = parseCSV(await fs.readFile(FIXTURE, "utf-8"));
  const agg = new Map();
  for (const r of rows) ingestRow(r, agg);
  const employers = finalizeAgg(agg, { fiscalYear: "FY2025_Q1", sourceUrl: "x" });

  // Pretend Amazon and Google both rolled up to a synthetic "tech-giant" slug
  const merged = aggregateForSlug(
    "tech-giant",
    [
      employers.find((e) => e.employer_name === "AMAZON.COM SERVICES LLC"),
      employers.find((e) => e.employer_name === "GOOGLE LLC"),
    ],
    "https://x",
    "FY2025_Q1",
  );
  assert.equal(merged.slug, "tech-giant");
  assert.equal(merged.labor.h1bFilings.totalLCAs, 6);
  assert.equal(merged.labor.h1bFilings.certifiedCount, 4);
  assert.equal(merged.labor.h1bFilings.year, "FY2025_Q1");
  assert.ok(merged.labor.h1bFilings.avgWage > 150000);
  assert.equal(merged.labor.sourceUrl, "https://x");
});
