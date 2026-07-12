#!/usr/bin/env node
/**
 * Tests for fmcsa-sms-fetch.mjs + fmcsa-sms-merge.mjs.
 *
 * Uses node:test (built into Node 18+) — no extra deps. Runs against the
 * checked-in fixture at scripts/fixtures/fmcsa-sms/sample.json. NO network.
 *
 * Locally:
 *   node --test scripts/fmcsa-sms-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  normalizeName,
  parseNum,
  parseBasic,
  shapeRow,
  sniffDelimiter,
  streamRows,
  SYNTH_ROWS,
  looksLikeZip,
  SourceUnavailableError,
} from "./fmcsa-sms-fetch.mjs";

import {
  mergeSnapshot,
  resolveSlug,
  rollupBucket,
  FLEET_PARENT_ALIASES,
} from "./fmcsa-sms-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/fmcsa-sms/sample.json");

// ─────────────────────────── normalizers ────────────────────────────

test("normalizeName uppercases + strips suffixes", () => {
  assert.equal(normalizeName("Walmart Transportation LLC"), "WALMART");
  assert.equal(normalizeName("United Parcel Service, Inc."), "UNITED PARCEL SERVICE");
  assert.equal(normalizeName("J.B. Hunt Transport Services, Inc."), "J B HUNT");
  assert.equal(normalizeName("FedEx Corp"), "FEDEX");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName(null), "");
});

test("parseNum tolerates N/A, commas, percent signs", () => {
  assert.equal(parseNum("12.5"), 12.5);
  assert.equal(parseNum("1,234"), 1234);
  assert.equal(parseNum("8.4%"), 8.4);
  assert.equal(parseNum(""), null);
  assert.equal(parseNum("N/A"), null);
  assert.equal(parseNum("null"), null);
  assert.equal(parseNum(undefined), null);
});

test("parseBasic clamps to 0..100 and rejects sentinels", () => {
  assert.equal(parseBasic("0"), 0);
  assert.equal(parseBasic("100"), 100);
  assert.equal(parseBasic("78"), 78);
  assert.equal(parseBasic("-1"), null);
  assert.equal(parseBasic("999"), null);
  assert.equal(parseBasic(""), null);
});

// ─────────────────────────── shapeRow ───────────────────────────────

test("shapeRow maps FMCSA pipe-file header names", () => {
  const row = {
    "dot_number": "12345",
    "legal_name": "ACME TRUCKING INC",
    "parent_name": "ACME HOLDINGS CORP",
    "phy_city": "ALBANY",
    "phy_state": "NY",
    "total_power_units": "150",
    "total_drivers": "180",
    "vehicle_oos_pct": "6.2",
    "unsafe_driving_percentile": "55",
    "hos_compliance_percentile": "44",
    "vehicle_maint_percentile": "61",
    "controlled_subst_percentile": "8",
    "hm_compliance_percentile": "",
    "crash_indicator_percentile": "47",
    "alert_count": "1",
  };
  const r = shapeRow(row);
  assert.equal(r.dotNumber, "12345");
  assert.equal(r.carrierName, "ACME TRUCKING INC");
  assert.equal(r.parentName, "ACME HOLDINGS CORP");
  assert.equal(r.state, "NY");
  assert.equal(r.fleetSize, 150);
  assert.equal(r.outOfServiceRate, 6.2);
  assert.equal(r.basics.unsafeDriving, 55);
  assert.equal(r.basics.hazmat, null);
  assert.equal(r.alertCount, 1);
});

test("shapeRow returns null when dot or name is missing", () => {
  assert.equal(shapeRow({ legal_name: "X" }), null);
  assert.equal(shapeRow({ dot_number: "1" }), null);
});

// ─────────────────────────── streaming + delimiter sniff ────────────

test("sniffDelimiter picks pipe over comma over tab by count", () => {
  assert.equal(sniffDelimiter("a|b|c|d"), "|");
  assert.equal(sniffDelimiter("a\tb\tc"), "\t");
  assert.equal(sniffDelimiter("a,b,c"), ",");
});

test("streamRows parses a synthetic pipe-delimited TXT file", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fmcsa-sms-test-"));
  const file = path.join(tmp, "rows.txt");
  const content = [
    "dot_number|legal_name|parent_name|phy_state|total_power_units|vehicle_oos_pct|unsafe_driving_percentile|hos_compliance_percentile|vehicle_maint_percentile|controlled_subst_percentile|hm_compliance_percentile|crash_indicator_percentile|alert_count",
    "111|ALPHA TRUCKING INC|ALPHA HOLDINGS|TX|50|4.5|22|18|24|5||20|0",
    "222|BETA EXPRESS LLC|BETA CORP|CA|200|7.2|62|55|71|11|33|58|2",
    "", // blank line
    "garbage_line_with_no_delimiter",
  ].join("\n");
  await fs.writeFile(file, content);
  const got = [];
  for await (const r of streamRows(file)) got.push(r);
  assert.equal(got.length, 2);
  assert.equal(got[0].dotNumber, "111");
  assert.equal(got[1].basics.crashIndicator, 58);
  await fs.rm(tmp, { recursive: true, force: true });
});

// ─────────────────────────── fixture round-trip ─────────────────────

test("fixture is parseable + has 12 rows", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  assert.equal(snap.rowCount, 12);
  assert.equal(snap.rows.length, 12);
  assert.ok(snap._license.includes("49 USC 504"));
  for (const r of snap.rows) {
    assert.ok(r.dotNumber);
    assert.ok(r.carrierName);
    assert.ok(r.basics);
  }
});

test("looksLikeZip accepts the three PK signatures, rejects HTML", () => {
  // Local file header, empty archive, spanned marker.
  assert.equal(looksLikeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(looksLikeZip(Buffer.from([0x50, 0x4b, 0x05, 0x06])), true);
  assert.equal(looksLikeZip(Buffer.from([0x50, 0x4b, 0x07, 0x08])), true);
  // The exact failure mode we saw in CI: an HTML error page.
  assert.equal(looksLikeZip(Buffer.from("<!DOCTYPE html>", "utf-8")), false);
  assert.equal(looksLikeZip(Buffer.from("<HTML><HEAD>", "utf-8")), false);
  // Too short / empty.
  assert.equal(looksLikeZip(Buffer.from([0x50, 0x4b])), false);
  assert.equal(looksLikeZip(Buffer.alloc(0)), false);
});

test("SourceUnavailableError is tagged for soft-fail handling", () => {
  const err = new SourceUnavailableError("moved");
  assert.equal(err.sourceUnavailable, true);
  assert.equal(err.name, "SourceUnavailableError");
  assert.ok(err instanceof Error);
});

test("synthetic preview rows match fixture rowCount", () => {
  assert.equal(SYNTH_ROWS.length, 12);
});

// ─────────────────────────── matching ───────────────────────────────

test("FLEET_PARENT_ALIASES contains the most common big-fleet aliases", () => {
  for (const k of ["AMAZON", "FEDERAL EXPRESS", "UPS", "WALMART", "J B HUNT", "SCHNEIDER NATIONAL"]) {
    assert.ok(FLEET_PARENT_ALIASES[k], `missing alias: ${k}`);
  }
});

test("resolveSlug picks alias for AMAZON LOGISTICS INC", () => {
  const index = [
    { slug: "amazon-logistics", name: "Amazon Logistics" },
    { slug: "amazon", name: "Amazon" },
  ];
  const { byName, slugs } = buildLookup(index);
  const row = {
    carrierName: "AMAZON LOGISTICS INC",
    parentName: "AMAZON COM INC",
  };
  const res = resolveSlug(row, { byName, slugs, parentMap: {} });
  assert.ok(res);
  // Longest alias wins → AMAZON LOGISTICS → amazon-logistics
  assert.equal(res.slug, "amazon-logistics");
});

test("resolveSlug falls back to direct match when no alias", () => {
  const index = [{ slug: "old-dominion-freight-line", name: "Old Dominion Freight Line" }];
  const { byName, slugs } = buildLookup(index);
  const row = {
    carrierName: "OLD DOMINION FREIGHT LINE INC",
    parentName: "OLD DOMINION FREIGHT LINE INC",
  };
  const res = resolveSlug(row, { byName, slugs, parentMap: {} });
  assert.ok(res);
  assert.equal(res.slug, "old-dominion-freight-line");
});

test("resolveSlug returns null for unknown carrier", () => {
  const { byName, slugs } = buildLookup([]);
  const row = { carrierName: "RANDO TRUCKS INC", parentName: "RANDO INC" };
  assert.equal(resolveSlug(row, { byName, slugs, parentMap: {} }), null);
});

// ─────────────────────────── rollup ─────────────────────────────────

test("rollupBucket fleet-weights BASICs", () => {
  // Big carrier with score 80, tiny carrier with score 10. Weighted avg
  // should be much closer to 80 than to a naive (80+10)/2 = 45.
  const rows = [
    {
      dotNumber: "1", carrierName: "BIG CO", parentName: "BIG CO",
      fleetSize: 10000, basics: { unsafeDriving: 80 },
      outOfServiceRate: 7.5, alertCount: 2,
    },
    {
      dotNumber: "2", carrierName: "TINY CO", parentName: "TINY CO",
      fleetSize: 100, basics: { unsafeDriving: 10 },
      outOfServiceRate: 1, alertCount: 0,
    },
  ];
  const r = rollupBucket(rows, "https://example.test/");
  // Weighted: (80*10000 + 10*100) / 10100 = 80,1000 / 10100 ≈ 79.3
  assert.ok(r.fmcsaSafetyScores.unsafeDriving >= 78 && r.fmcsaSafetyScores.unsafeDriving <= 80, `got ${r.fmcsaSafetyScores.unsafeDriving}`);
  assert.equal(r.fleetSize, 10100);
  assert.equal(r.carrierCount, 2);
  assert.equal(r.alertCount, 2);
  assert.equal(r.worstCarrier.dotNumber, "1");
  assert.equal(r.worstCarrier.basicMax, 80);
});

test("rollupBucket ignores nulls in weighted average", () => {
  const rows = [
    { dotNumber: "1", carrierName: "A", parentName: "A", fleetSize: 100, basics: { unsafeDriving: 50 } },
    { dotNumber: "2", carrierName: "B", parentName: "B", fleetSize: 100, basics: { unsafeDriving: null } },
  ];
  const r = rollupBucket(rows, "");
  assert.equal(r.fmcsaSafetyScores.unsafeDriving, 50);
});

// ─────────────────────────── full mergeSnapshot ─────────────────────

test("mergeSnapshot routes fixture rows to expected slugs", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const index = [
    { slug: "amazon-logistics", name: "Amazon Logistics" },
    { slug: "fedex", name: "FedEx" },
    { slug: "ups", name: "UPS" },
    { slug: "walmart", name: "Walmart" },
    { slug: "j-b-hunt", name: "J.B. Hunt" },
    { slug: "schneider-national", name: "Schneider National" },
    { slug: "knight-swift-transportation-holdings", name: "Knight-Swift Transportation Holdings" },
    { slug: "werner-enterprises", name: "Werner Enterprises" },
    { slug: "old-dominion-freight-line", name: "Old Dominion Freight Line" },
    { slug: "xpo-logistics", name: "XPO Logistics" },
    { slug: "ryder-system", name: "Ryder System" },
    { slug: "landstar-system", name: "Landstar System" },
  ];
  const { augment, stats } = mergeSnapshot(snap, { index, parentMap: {} });
  assert.equal(stats.orphans, 0, "all 12 fixture rows should match");
  // At least 10 distinct parent slugs (some carriers might collapse).
  assert.ok(stats.matchedSlugs >= 10, `expected ≥10 matched slugs, got ${stats.matchedSlugs}`);
  // Spot-check the worst-of-the-worst — Amazon Logistics has unsafeDriving=78, vehMaint=91.
  const amazon = augment["amazon-logistics"];
  assert.ok(amazon, "amazon-logistics should appear");
  assert.equal(amazon.labor.fmcsaSafetyScores.vehicleMaintenance, 91);
  assert.equal(amazon.labor.outOfServiceRate, 8.4);
  // FedEx via FEDERAL EXPRESS alias.
  const fedex = augment["fedex"];
  assert.ok(fedex, "fedex should appear");
  assert.equal(fedex.labor.fmcsaSafetyScores.unsafeDriving, 35);
  // UPS via UNITED PARCEL alias.
  const ups = augment["ups"];
  assert.ok(ups, "ups should appear");
  assert.equal(ups.labor.fmcsaSafetyScores.unsafeDriving, 28);
  // Source URL points at per-DOT overview page.
  assert.match(amazon.labor.sourceUrl, /\/SMS\/Carrier\/900001\/Overview\.aspx$/);
});

test("mergeSnapshot orphans every row when index is empty + no aliases hit", () => {
  // Use names that don't match any FLEET_PARENT_ALIASES fragment.
  const snap = {
    rows: [
      { dotNumber: "1", carrierName: "BLUEBIRD FREIGHT INC", parentName: "BLUEBIRD INC", fleetSize: 10, basics: {} },
      { dotNumber: "2", carrierName: "SUNCOAST DELIVERY LLC", parentName: "SUNCOAST LLC", fleetSize: 5, basics: {} },
    ],
  };
  const { augment, stats } = mergeSnapshot(snap, { index: [], parentMap: {} });
  assert.equal(Object.keys(augment).length, 0);
  assert.equal(stats.orphans, 2);
});

// ─────────────────────────── helpers ─────────────────────────────────

function buildLookup(index) {
  const byName = new Map();
  const slugs = new Set();
  for (const e of index) {
    const k = normalizeName(e.name);
    if (k && !byName.has(k)) byName.set(k, e.slug);
    slugs.add(e.slug);
  }
  return { byName, slugs };
}
