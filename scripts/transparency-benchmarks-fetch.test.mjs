#!/usr/bin/env node
/**
 * Tests for transparency-benchmarks-fetch.mjs (+ merger pure functions).
 *
 * node:test runner. NO network calls. Fixture lives inline + on disk
 * under test/fixtures/transparency-benchmarks/.
 *
 *   node --test scripts/transparency-benchmarks-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalize,
  compositeScore,
  buildRecord,
  buildSnapshot,
  allSlugs,
  RDR_2024,
  TXN_PLEDGE_SIGNATORIES,
  CHRB_2024_RAW,
  FASHION_REV_2024,
  SOURCES,
} from "./transparency-benchmarks-fetch.mjs";

import {
  resolveSlug,
  mergeRecords,
  buildAugment,
} from "./transparency-benchmarks-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/transparency-benchmarks");

// ──────────────────────── normalize() ────────────────────────

test("normalize: RDR + Just Capital pass through, clamped 0–100", () => {
  assert.equal(normalize("rdr", 53), 53);
  assert.equal(normalize("rdr", 0), 0);
  assert.equal(normalize("rdr", 999), 100);
  assert.equal(normalize("rdr", -5), 0);
  assert.equal(normalize("justCapital", 88), 88);
  assert.equal(normalize("justCapital", null), null);
});

test("normalize: txnPledge boolean → 100 / 0", () => {
  assert.equal(normalize("txnPledge", true), 100);
  assert.equal(normalize("txnPledge", false), 0);
});

test("normalize: CHRB raw 0–26 → 0–100", () => {
  assert.equal(normalize("chrb", 0), 0);
  assert.equal(normalize("chrb", 13), 50);
  assert.equal(normalize("chrb", 26), 100);
  assert.equal(normalize("chrb", 23), 88);
});

test("normalize: Fashion Rev raw 0–250 → 0–100", () => {
  assert.equal(normalize("fashionRevTransparency", 0), 0);
  assert.equal(normalize("fashionRevTransparency", 125), 50);
  assert.equal(normalize("fashionRevTransparency", 250), 100);
  assert.equal(normalize("fashionRevTransparency", 200), 80);
});

test("normalize: null in → null out for all subs", () => {
  for (const s of ["rdr", "txnPledge", "justCapital", "chrb", "fashionRevTransparency"]) {
    assert.equal(normalize(s, null), null);
  }
});

// ──────────────────────── compositeScore() ────────────────────────

test("compositeScore: averages non-null sub-scores", () => {
  assert.equal(compositeScore({ a: 100, b: 0 }), 50);
  assert.equal(compositeScore({ a: 80, b: 60, c: 40 }), 60);
});

test("compositeScore: ignores nulls and undefined entries", () => {
  assert.equal(compositeScore({ a: 100, b: null, c: undefined, d: 50 }), 75);
});

test("compositeScore: returns null when nothing present", () => {
  assert.equal(compositeScore({ a: null, b: null }), null);
  assert.equal(compositeScore({}), null);
});

// ──────────────────────── buildRecord() ────────────────────────

test("buildRecord: Microsoft has RDR + Just Capital + CHRB", () => {
  const rec = buildRecord("microsoft");
  assert.ok(rec);
  assert.equal(rec.slug, "microsoft");
  assert.equal(rec.subScores.rdr, 53);
  assert.equal(rec.subScores.justCapital, 95);
  assert.equal(rec.subScores.chrb, normalize("chrb", 15.0)); // 58
  assert.equal(rec.subScores.txnPledge, null);
  assert.equal(rec.subScores.fashionRevTransparency, null);
  // 3 sub-scores: 53 + 95 + 58 = 206 / 3 = 68.67 → 69
  assert.equal(rec.compositeScore, 69);
  assert.equal(rec.sourceUrls.length, 3);
  assert.ok(rec.sourceUrls.includes(SOURCES.rdr.url));
});

test("buildRecord: Nike (Transparency Pledge + CHRB + Fashion Rev)", () => {
  const rec = buildRecord("nike");
  assert.ok(rec);
  assert.equal(rec.subScores.txnPledge, 100);
  assert.equal(rec.subScores.chrb, normalize("chrb", 21.5)); // 83
  assert.equal(rec.subScores.fashionRevTransparency, normalize("fashionRevTransparency", 132)); // 53
  assert.equal(rec.subScores.rdr, null);
});

test("buildRecord: SHEIN (non-signatory + CHRB + Fashion Rev — all low)", () => {
  const rec = buildRecord("shein");
  assert.ok(rec);
  assert.equal(rec.subScores.txnPledge, 0);
  assert.equal(rec.subScores.chrb, normalize("chrb", 2.5)); // 10
  assert.equal(rec.subScores.fashionRevTransparency, normalize("fashionRevTransparency", 10)); // 4
  // (0 + 10 + 4) / 3 = 4.67 → 5
  assert.equal(rec.compositeScore, 5);
});

test("buildRecord: slug with no coverage returns null", () => {
  assert.equal(buildRecord("nonexistent-brand-zzzz"), null);
});

// ──────────────────────── buildSnapshot() ────────────────────────

test("buildSnapshot: companies sorted descending by composite", () => {
  const snap = buildSnapshot(new Date("2026-06-07T00:00:00Z"));
  assert.ok(snap.companies.length > 0);
  for (let i = 1; i < snap.companies.length; i++) {
    assert.ok(
      snap.companies[i - 1].compositeScore >= snap.companies[i].compositeScore,
      `position ${i}: ${snap.companies[i - 1].compositeScore} should be >= ${snap.companies[i].compositeScore}`
    );
  }
});

test("buildSnapshot: includes source citations + generated_at", () => {
  const snap = buildSnapshot(new Date("2026-06-07T00:00:00Z"));
  assert.equal(snap.generated_at, "2026-06-07T00:00:00.000Z");
  assert.equal(snap.source_category, "transparency");
  assert.ok(snap.sources.rdr.license.includes("CC BY-SA"));
  assert.ok(snap.sources.chrb.license.includes("CC BY"));
  assert.ok(snap.sources.fashionRevTransparency.license.includes("NonCommercial"));
});

test("buildSnapshot: every company has 0–100 composite + non-empty sourceUrls", () => {
  const snap = buildSnapshot();
  for (const c of snap.companies) {
    assert.ok(c.compositeScore >= 0 && c.compositeScore <= 100, `${c.slug}: ${c.compositeScore}`);
    assert.ok(c.sourceUrls.length > 0, `${c.slug}: empty sourceUrls`);
  }
});

test("buildSnapshot: tags well over 100 companies (meets 1000-target floor proxy)", () => {
  const snap = buildSnapshot();
  // Within the 5 benchmark lists themselves; the merger fans out via
  // brand-parent-map at apply time. The snapshot itself should comfortably
  // cover the seed universe.
  assert.ok(snap.company_count >= 100, `expected >=100 seed records, got ${snap.company_count}`);
});

// ──────────────────────── source table sanity ────────────────────────

test("RDR table: 14 companies, all scores in [0, 100]", () => {
  assert.equal(RDR_2024.length, 14);
  for (const r of RDR_2024) {
    assert.ok(r.score >= 0 && r.score <= 100, `${r.slug}: ${r.score}`);
    assert.ok(r.slug && r.name, `RDR row missing slug/name: ${JSON.stringify(r)}`);
  }
});

test("Transparency Pledge: no slug both signed AND non-signed", async () => {
  const { TXN_PLEDGE_MAJOR_NONSIGNATORIES } = await import("./transparency-benchmarks-fetch.mjs");
  const signedSet = new Set(TXN_PLEDGE_SIGNATORIES);
  for (const slug of TXN_PLEDGE_MAJOR_NONSIGNATORIES) {
    assert.ok(!signedSet.has(slug), `${slug} listed in both signatories and non-signatories`);
  }
});

test("CHRB raw scores all in [0, 26]", () => {
  for (const r of CHRB_2024_RAW) {
    assert.ok(r.raw >= 0 && r.raw <= 26, `${r.slug}: raw=${r.raw}`);
  }
});

test("Fashion Rev raw scores all in [0, 250]", () => {
  for (const r of FASHION_REV_2024) {
    assert.ok(r.raw >= 0 && r.raw <= 250, `${r.slug}: raw=${r.raw}`);
  }
});

// ──────────────────────── merger: resolveSlug ────────────────────────

test("resolveSlug: direct match wins", () => {
  const maps = { aliases: {}, parents: {} };
  const res = resolveSlug("nike", maps, (s) => s === "nike");
  assert.deepEqual(res, { slug: "nike", routed_via: "direct" });
});

test("resolveSlug: falls through to alias", () => {
  const maps = { aliases: { "h-and-m": "hm" }, parents: {} };
  const res = resolveSlug("h-and-m", maps, (s) => s === "hm");
  assert.deepEqual(res, { slug: "hm", routed_via: "alias" });
});

test("resolveSlug: falls through to parent", () => {
  const maps = { aliases: {}, parents: { "uniqlo": { parent: "fast-retailing" } } };
  const res = resolveSlug("uniqlo", maps, (s) => s === "fast-retailing");
  assert.deepEqual(res, { slug: "fast-retailing", routed_via: "parent" });
});

test("resolveSlug: orphan when nothing resolves", () => {
  const maps = { aliases: {}, parents: {} };
  const res = resolveSlug("ghost-brand", maps, () => false);
  assert.deepEqual(res, { slug: null, routed_via: "orphan" });
});

// ──────────────────────── merger: mergeRecords ────────────────────────

test("mergeRecords: takes max of each sub-score, recomputes composite", () => {
  const a = {
    compositeScore: 50,
    subScores: { rdr: 50, txnPledge: null, justCapital: 50, chrb: null, fashionRevTransparency: null },
    sourceUrls: ["http://a"],
  };
  const b = {
    compositeScore: 80,
    subScores: { rdr: 80, txnPledge: 100, justCapital: 60, chrb: null, fashionRevTransparency: null },
    sourceUrls: ["http://b"],
  };
  const m = mergeRecords(a, b);
  assert.equal(m.subScores.rdr, 80);
  assert.equal(m.subScores.txnPledge, 100);
  assert.equal(m.subScores.justCapital, 60);
  // (80 + 100 + 60) / 3 = 80
  assert.equal(m.compositeScore, 80);
  assert.deepEqual(m.sourceUrls.sort(), ["http://a", "http://b"]);
});

test("mergeRecords: null + record returns record", () => {
  const r = {
    compositeScore: 42, subScores: { rdr: 42 }, sourceUrls: ["x"],
  };
  assert.equal(mergeRecords(null, r), r);
  assert.equal(mergeRecords(r, null), r);
});

// ──────────────────────── merger: buildAugment ────────────────────────

test("buildAugment: produces {slug: {transparency: {...}}}", () => {
  const snapshot = {
    sources: SOURCES,
    companies: [
      {
        slug: "nike",
        compositeScore: 75,
        subScores: { rdr: null, txnPledge: 100, justCapital: null, chrb: 83, fashionRevTransparency: 53 },
        sourceUrls: ["https://transparencypledge.org/signatory-list/"],
      },
    ],
  };
  const maps = { aliases: {}, parents: {} };
  const { out, log } = buildAugment(
    snapshot,
    maps,
    new Date("2026-06-07T00:00:00Z"),
    (s) => s === "nike",
  );
  assert.equal(out.company_count, 1);
  assert.equal(out.data.nike.transparency.compositeScore, 75);
  assert.equal(out.data.nike.transparency.subScores.txnPledge, 100);
  assert.equal(out.data.nike.transparency.subScores.chrb, 83);
  assert.equal(log.merged.length, 1);
  assert.equal(log.merged[0].routed_via, "direct");
  assert.equal(log.orphans.length, 0);
});

test("buildAugment: orphans when no company file matches", () => {
  const snapshot = {
    sources: SOURCES,
    companies: [
      {
        slug: "ghost-brand", compositeScore: 50,
        subScores: { rdr: 50, txnPledge: null, justCapital: null, chrb: null, fashionRevTransparency: null },
        sourceUrls: ["https://example"],
      },
    ],
  };
  const maps = { aliases: {}, parents: {} };
  const { out, log } = buildAugment(snapshot, maps, new Date(), () => false);
  assert.equal(out.company_count, 0);
  assert.equal(log.orphans.length, 1);
  assert.equal(log.orphans[0].slug, "ghost-brand");
});

// ──────────────────────── fixture round-trip ────────────────────────

test("fixture round-trip: snapshot fixture parses + builds augment cleanly", async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(FIXTURES, "snapshot-sample.json"), "utf-8")
  );
  // Companies in fixture: nike, microsoft, shein
  const maps = { aliases: {}, parents: {} };
  const { out } = buildAugment(
    fixture,
    maps,
    new Date("2026-06-07T00:00:00Z"),
    (s) => ["nike", "microsoft", "shein"].includes(s),
  );
  assert.equal(out.company_count, 3);
  assert.ok(out.data.nike.transparency.compositeScore > out.data.shein.transparency.compositeScore);
  assert.ok(out.data.microsoft.transparency.subScores.rdr != null);
});
