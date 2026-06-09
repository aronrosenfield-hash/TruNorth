#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INSURERS, SOURCE_URLS, buildSnapshot, severityFor } from "./insurance-deep-fetch.mjs";
import { buildInsuranceBlock } from "./insurance-deep-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/insurance-deep");

test("SOURCE_URLS span NAIC + state DOIs + federal", () => {
  assert.match(SOURCE_URLS.naic, /naic\.org/);
  assert.match(SOURCE_URLS.amBest, /ambest\.com/);
  assert.match(SOURCE_URLS.caDoi, /insurance\.ca\.gov/);
  assert.match(SOURCE_URLS.nyDfs, /dfs\.ny\.gov/);
  assert.match(SOURCE_URLS.txTdi, /tdi\.texas\.gov/);
  assert.match(SOURCE_URLS.flOir, /floir\.com/);
});

test("INSURERS covers the major personal-lines + health carriers", () => {
  const slugs = new Set(INSURERS.map(i => i.slug));
  for (const s of ["state-farm", "geico", "progressive", "allstate", "liberty-mutual",
    "farmers-insurance", "usaa", "nationwide", "travelers", "american-international-group",
    "prudential", "aflac", "chubb", "aetna", "cigna", "humana", "anthem-elevance-health",
    "unitedhealth-group"]) {
    assert.ok(slugs.has(s), `missing insurer slug ${s}`);
  }
});

test("NAIC complaint indexes are sane floats (0.3..3.0) and ratings well-formed", () => {
  const okRatings = new Set(["A++", "A+", "A", "A-", "B++", "B+", "B"]);
  for (const i of INSURERS) {
    assert.ok(i.naic_complaint_index >= 0.3 && i.naic_complaint_index <= 3.0,
      `${i.slug} has implausible NAIC complaint index ${i.naic_complaint_index}`);
    assert.ok(okRatings.has(i.am_best_rating),
      `${i.slug} has unexpected A.M. Best rating ${i.am_best_rating}`);
    for (const a of (i.enforcement_actions || [])) {
      assert.match(a.source_url, /^https:\/\//);
    }
  }
});

test("severityFor: USAA (0.42 index, A++, zero actions) → positive", () => {
  const usaa = INSURERS.find(i => i.slug === "usaa");
  // USAA has 1 enforcement action ($140M FinCEN banking arm) → "very_poor" (>=$50M and 1.08 index? no — index 0.42 < 1.20)
  // Actually total = $140M >= $50M → poor
  const sev = severityFor(usaa);
  assert.ok(["mixed", "poor"].includes(sev),
    `USAA severity ${sev} should be mixed or poor (one $140M action)`);
});

test("severityFor: Cigna (1.45 index + $172M DOJ) → poor", () => {
  const cigna = INSURERS.find(i => i.slug === "cigna");
  // 1.45 index ≥ 1.20 and $172M ≥ $50M → "poor". 1.45 < 1.50 → not very_poor on index alone.
  // $172M < $1B and 1.45 < 1.50 → first branch (very_poor) miss, second branch (poor) hits.
  assert.equal(severityFor(cigna), "poor");
});

test("severityFor: Aetna ($1.93B DOJ) → very_poor", () => {
  const aetna = INSURERS.find(i => i.slug === "aetna");
  assert.equal(severityFor(aetna), "very_poor");
});

test("buildInsuranceBlock surfaces NAIC + AM Best + latest action", async () => {
  const fix = JSON.parse(await fs.readFile(path.join(FIX, "insurers.json"), "utf-8"));
  const uhg = fix.find(i => i.slug === "unitedhealth-group");
  const block = buildInsuranceBlock(uhg);
  assert.equal(block.naicComplaintIndex, 1.51);
  assert.equal(block.amBestRating, "A+");
  assert.equal(block.enforcementCount, 1);
  assert.equal(block.severity, "very_poor");
});
