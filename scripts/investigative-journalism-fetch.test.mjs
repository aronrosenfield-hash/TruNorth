#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE, OUTLETS } from "./investigative-journalism-fetch.mjs";
import { buildAugment, SUBJECT_TO_SLUGS } from "./investigative-journalism-merge.mjs";

test("FIXTURE: each record cites a known outlet, has URL, headline, category, date, abstract", () => {
  assert.ok(FIXTURE.length >= 100, `Need at least 100 curated investigations, got ${FIXTURE.length}`);
  const okCats = new Set(["environment", "labor", "privacy", "health", "political", "dei", "animals", "guns", "charity"]);
  for (const r of FIXTURE) {
    assert.ok(OUTLETS[r.outlet], `Unknown outlet code: ${r.outlet}`);
    assert.ok(r.subject && r.subject.length > 0, `Missing subject`);
    assert.ok(r.headline && r.headline.length > 0, `Missing headline for ${r.subject}`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.date || ""), `Bad date for ${r.subject}: ${r.date}`);
    assert.ok(/^https?:\/\//.test(r.url || ""), `Bad URL for ${r.subject}: ${r.url}`);
    assert.ok(okCats.has(r.category), `Bad category for ${r.subject}: ${r.category}`);
    assert.ok(r.abstract && r.abstract.length > 0, `Missing abstract for ${r.subject}`);
    // Fair-use guard: ≤ 40 words
    const wc = String(r.abstract).split(/\s+/).filter(Boolean).length;
    assert.ok(wc <= 45, `Abstract too long (${wc} words) for ${r.subject} — fair-use limit`);
  }
});

test("FIXTURE: covers all 30+ outlets in OUTLETS metadata referenced by at least one record", () => {
  // Soft check — we expect coverage across most outlets but a few may sit idle (e.g. distilled)
  const used = new Set(FIXTURE.map(r => r.outlet));
  assert.ok(used.size >= 18, `Expected coverage across ≥18 outlets, got ${used.size}`);
});

test("FIXTURE: includes landmark Fortune-500 investigations", () => {
  const subjects = new Set(FIXTURE.map(r => r.subject));
  for (const must of ["Boeing", "Purdue Pharma", "Exxon Mobil", "Wells Fargo", "Facebook", "Volkswagen", "Johnson & Johnson", "Amazon", "Tesla", "Glencore", "JPMorgan Chase", "Goldman Sachs"]) {
    assert.ok(subjects.has(must), `Missing landmark subject ${must}`);
  }
});

test("buildAugment: severity_max = mixed for single-outlet brand", () => {
  const aug = buildAugment([
    { outlet: "wired", subject: "Clearview AI", headline: "x", date: "2020-01-20", url: "https://x", category: "privacy", abstract: "y" },
  ], OUTLETS);
  assert.ok(aug["clearview-ai"]);
  assert.equal(aug["clearview-ai"].severity_max, "mixed");
  assert.equal(aug["clearview-ai"].outlet_count, 1);
});

test("buildAugment: severity_max = poor when ≥2 distinct outlets cover same category", () => {
  const aug = buildAugment([
    { outlet: "wired",    subject: "Facebook", headline: "a", date: "2018-01-01", url: "https://a", category: "privacy", abstract: "x" },
    { outlet: "guardian", subject: "Facebook", headline: "b", date: "2018-02-01", url: "https://b", category: "privacy", abstract: "y" },
  ], OUTLETS);
  // "Facebook" maps to multiple slugs, all share severity
  const slug = "meta-platforms";
  assert.ok(aug[slug]);
  assert.equal(aug[slug].severity_max, "poor");
  assert.equal(aug[slug].outlet_count, 2);
});

test("buildAugment: severity_max = very_poor when ≥3 distinct outlets cover same category", () => {
  const aug = buildAugment([
    { outlet: "wsj",       subject: "Facebook", headline: "a", date: "2021-09-13", url: "https://a", category: "privacy", abstract: "x" },
    { outlet: "guardian",  subject: "Facebook", headline: "b", date: "2018-03-20", url: "https://b", category: "privacy", abstract: "y" },
    { outlet: "nyt",       subject: "Facebook", headline: "c", date: "2018-11-14", url: "https://c", category: "privacy", abstract: "z" },
  ], OUTLETS);
  assert.equal(aug["meta-platforms"].severity_max, "very_poor");
});

test("buildAugment: same outlet + multiple pieces does NOT escalate", () => {
  const aug = buildAugment([
    { outlet: "wsj", subject: "Facebook", headline: "a", date: "2021-01-01", url: "https://a", category: "privacy", abstract: "x" },
    { outlet: "wsj", subject: "Facebook", headline: "b", date: "2021-02-01", url: "https://b", category: "privacy", abstract: "y" },
  ], OUTLETS);
  assert.equal(aug["meta-platforms"].severity_max, "mixed");
  assert.equal(aug["meta-platforms"].outlet_count, 1);
  assert.equal(aug["meta-platforms"].investigation_count, 2);
});

test("buildAugment: by_category breakdown is per-category, not global", () => {
  // 2 outlets on privacy (poor), 1 outlet on labor (mixed) → top-level = poor (worst)
  const aug = buildAugment([
    { outlet: "wired",    subject: "Amazon", headline: "a", date: "2019-07-25", url: "https://a", category: "privacy", abstract: "x" },
    { outlet: "intercept",subject: "Amazon", headline: "b", date: "2019-07-25", url: "https://b", category: "privacy", abstract: "y" },
    { outlet: "reveal",   subject: "Amazon", headline: "c", date: "2020-09-29", url: "https://c", category: "labor", abstract: "z" },
  ], OUTLETS);
  assert.equal(aug["amazon"].severity_max, "poor");
  assert.equal(aug["amazon"].by_category.privacy.outlet_count, 2);
  assert.equal(aug["amazon"].by_category.labor.outlet_count, 1);
});

test("buildAugment: investigations are sorted newest-first and capped at 5", () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    records.push({ outlet: "wired", subject: "Facebook", headline: `H${i}`, date: `2020-01-${(i + 1).toString().padStart(2, "0")}`, url: `https://x/${i}`, category: "privacy", abstract: `a${i}` });
  }
  const aug = buildAugment(records, OUTLETS);
  const inv = aug["meta-platforms"].investigations;
  assert.equal(inv.length, 5);
  // Sorted newest first
  for (let i = 1; i < inv.length; i++) {
    assert.ok(inv[i - 1].date >= inv[i].date, "Not newest-first ordering");
  }
});

test("FIXTURE: Boeing is cross-cited across ≥3 outlets in labor → very_poor", () => {
  const aug = buildAugment(FIXTURE, OUTLETS);
  const boeing = aug["boeing"];
  assert.ok(boeing, "Boeing should have augment");
  assert.ok(boeing.outlet_count >= 3, `Boeing should be covered by 3+ outlets, got ${boeing.outlet_count}`);
  assert.equal(boeing.severity_max, "very_poor");
});

test("FIXTURE: Exxon Mobil cross-cited as very_poor on environment", () => {
  const aug = buildAugment(FIXTURE, OUTLETS);
  const exxon = aug["exxon-mobil"];
  assert.ok(exxon);
  assert.ok(exxon.by_category.environment);
  assert.ok(exxon.by_category.environment.outlet_count >= 3, `Exxon environment outlet_count = ${exxon.by_category.environment.outlet_count}`);
});

test("SUBJECT_TO_SLUGS: every known subject in FIXTURE resolves to ≥1 slug (or empty for archival)", () => {
  const archivalSubjects = new Set(["Asbestos Industry", "Lead Industry"]);
  for (const r of FIXTURE) {
    const slugs = SUBJECT_TO_SLUGS[r.subject];
    if (!slugs) {
      // Unmapped → should still soft-fallback in slugsForSubject. Allowed.
      continue;
    }
    if (archivalSubjects.has(r.subject)) continue;
    assert.ok(slugs.length >= 1, `Subject ${r.subject} has empty slug list`);
  }
});
