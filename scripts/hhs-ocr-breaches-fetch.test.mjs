#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./hhs-ocr-breaches-fetch.mjs";
import { buildAugment } from "./hhs-ocr-breaches-merge.mjs";

test("HHS OCR fixture covers expected major HIPAA breaches", () => {
  assert.ok(FIXTURE.length >= 25, `fixture should cover >=25 breaches (was ${FIXTURE.length})`);
  const anthem = FIXTURE.find(r => /anthem/i.test(r.covered_entity));
  assert.ok(anthem);
  assert.equal(anthem.individuals_affected, 78_800_000);
  const change = FIXTURE.find(r => /change healthcare/i.test(r.covered_entity));
  assert.ok(change, "Change Healthcare 2024 breach missing");
});

test("buildAugment groups by covered entity → slug, emits parent slugs", () => {
  const aug = buildAugment(FIXTURE);
  assert.ok(aug["anthem"], "anthem slug not built");
  assert.ok(aug["elevance-health"], "anthem parent slug not emitted");
  assert.ok(aug["unitedhealth"] || aug["change-healthcare"], "change-healthcare/UHG missing");
  assert.ok(aug["kaiser"], "kaiser slug not built");
  assert.ok(aug["cvs"].breach_count >= 2, "CVS expected multiple incidents");
});

test("buildAugment skips unknown entities", () => {
  const aug = buildAugment([{ covered_entity: "Not a real hospital", individuals_affected: 1, submission_date: "2020-01-01" }]);
  assert.equal(Object.keys(aug).length, 0);
});
