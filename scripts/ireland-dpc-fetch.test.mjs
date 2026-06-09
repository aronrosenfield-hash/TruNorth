#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./ireland-dpc-fetch.mjs";
import { buildAugment } from "./ireland-dpc-merge.mjs";

test("Ireland DPC fixture has the headline EU privacy cases", () => {
  assert.ok(FIXTURE.length >= 12, "Expected at least 12 DPC actions");
  const meta12B = FIXTURE.find(r => r.fine_eur === 1_200_000_000);
  assert.ok(meta12B, "Missing €1.2B Meta Schrems II transfers fine");
  const tiktok530 = FIXTURE.find(r => r.fine_eur === 530_000_000);
  assert.ok(tiktok530, "Missing €530M TikTok China-transfers fine");
  const wa225 = FIXTURE.find(r => r.fine_eur === 225_000_000);
  assert.ok(wa225, "Missing €225M WhatsApp transparency fine");
});

test("buildAugment routes WhatsApp/Instagram/Facebook → meta-platforms", () => {
  const aug = buildAugment(FIXTURE);
  assert.ok(aug["meta-platforms"], "meta-platforms aggregate missing");
  // Meta total should be >€2.5B from the headline fines
  assert.ok(aug["meta-platforms"].total_fines_eur >= 2_500_000_000,
    `Meta total expected ≥€2.5B, got ${aug["meta-platforms"].total_fines_eur}`);
  // LinkedIn → microsoft
  assert.ok(aug["microsoft"], "LinkedIn should route to microsoft");
  // X / Twitter dual-alias
  assert.ok(aug["x-corp"], "x-corp missing");
  assert.ok(aug["twitter"], "twitter slug missing");
  // TikTok / ByteDance
  assert.ok(aug["bytedance"], "bytedance missing");
  assert.ok(aug["bytedance"].total_fines_eur >= 800_000_000, "TikTok total should be ≥€800M");
});

test("buildAugment skips unknown companies cleanly", () => {
  const aug = buildAugment([{ company: "Random Irish SME Ltd", date: "2024-01-01", fine_eur: 100 }]);
  assert.equal(Object.keys(aug).length, 0);
});

test("Actions are sorted newest-first", () => {
  const aug = buildAugment(FIXTURE);
  const meta = aug["meta-platforms"];
  const dates = meta.actions.map(a => a.date);
  const sorted = [...dates].sort().reverse();
  assert.deepEqual(dates, sorted, "Actions should be sorted newest-first");
});
