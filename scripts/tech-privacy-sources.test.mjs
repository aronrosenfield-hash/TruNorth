#!/usr/bin/env node
/**
 * Combined tests for Mozilla PNI / EFF WHYB / RDR / Markup / FTC fetch +
 * merge pipelines. Fixture-only; no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE as MOZILLA } from "./mozilla-pni-fetch.mjs";
import { buildAugment as mozBuild } from "./mozilla-pni-merge.mjs";

import { FIXTURE as EFF } from "./eff-whyb-fetch.mjs";
import { buildAugment as effBuild } from "./eff-whyb-merge.mjs";

import { FIXTURE as RDR } from "./rdr-bigtech-fetch.mjs";
import { buildAugment as rdrBuild } from "./rdr-bigtech-merge.mjs";

import { FIXTURE as MARKUP } from "./markup-investigations-fetch.mjs";
import { buildAugment as markupBuild } from "./markup-investigations-merge.mjs";

import { FIXTURE as FTC } from "./ftc-tech-reports-fetch.mjs";
import { buildAugment as ftcBuild } from "./ftc-tech-reports-merge.mjs";

test("Mozilla PNI: TikTok → bytedance + tiktok, warning rating, worst-rating wins", () => {
  const aug = mozBuild(MOZILLA);
  assert.equal(aug["bytedance"]?.rating, "warning");
  assert.equal(aug["meta-platforms"]?.rating, "warning");
  assert.equal(aug["apple"]?.rating, "good");
  assert.equal(aug["apple"]?.meets_min_security, true);
});

test("EFF WHYB: best vs poor tiers preserved", () => {
  const aug = effBuild(EFF);
  assert.equal(aug["apple"]?.stars, 5);
  assert.equal(aug["dropbox"]?.tier, "best");
  assert.equal(aug["t-mobile"]?.tier, "poor");
  // Composite slug aliasing — Microsoft/LinkedIn both emit microsoft
  assert.ok(aug["microsoft"]);
});

test("RDR Big Tech: composite score categorized", () => {
  const aug = rdrBuild(RDR);
  assert.ok(aug["meta-platforms"]);
  assert.equal(aug["meta-platforms"].tier, "poor");
  // Yahoo had the highest 2022 composite — tier mixed (56)
  assert.equal(aug["yahoo"].tier, "mixed");
  // ByteDance 2024 — poor
  assert.equal(aug["bytedance"].tier, "poor");
});

test("Markup: investigation count + themes aggregate per slug", () => {
  const aug = markupBuild(MARKUP);
  assert.ok(aug["meta-platforms"].investigation_count >= 2);
  assert.ok(aug["google-alphabet"].investigation_count >= 2);
  assert.ok(Array.isArray(aug["amazon"].themes));
  assert.ok(aug["amazon"].sample_investigations.length >= 1);
});

test("FTC: adverse findings counted separately from mentions", () => {
  const aug = ftcBuild(FTC);
  assert.ok(aug["meta-platforms"].mention_count >= 1);
  assert.ok(aug["meta-platforms"].adverse_count >= 1);
  // Microsoft has cloud + AI named-respondent mentions
  assert.ok(aug["microsoft"].mention_count >= 2);
});
