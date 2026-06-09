#!/usr/bin/env node
/**
 * Tests for wikipedia-controversies-fetch.mjs + wikipedia-controversies-merge.mjs.
 *
 * No network. Loads scripts/fixtures/wikipedia/sample.json and exercises:
 *   - parseArgs, classifySection, stripWikitext (fetcher pure helpers)
 *   - SECTION_PATTERNS coverage spot-check
 *   - CATEGORY_PATTERNS coverage spot-check
 *   - replayFixture (offline replay)
 *   - merger classifySection severity rules
 *   - buildAugment (multi-category collapse)
 *
 * Run: node --test scripts/wikipedia-controversies-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LICENSE,
  SECTION_PATTERNS,
  CATEGORY_PATTERNS,
  parseArgs,
  classifySection as classifyHeading,
  stripWikitext,
  replayFixture,
} from "./wikipedia-controversies-fetch.mjs";
import {
  classifySection,
  buildAugment,
} from "./wikipedia-controversies-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/wikipedia/sample.json");

test("LICENSE is the CC BY-SA attribution", () => {
  assert.equal(LICENSE, "CC BY-SA 4.0 — Wikipedia, https://en.wikipedia.org");
});

test("SECTION_PATTERNS covers each spec'd heading family", () => {
  const headings = [
    "Controversies", "Criticism", "Lawsuits", "Legal issues",
    "Environmental impact", "Labor practices", "Privacy concerns",
    "Animal welfare", "Health and safety",
  ];
  for (const h of headings) {
    assert.ok(classifyHeading(h) != null, `heading "${h}" should match`);
  }
});

test("classifySection (fetcher) returns the right TruNorth category", () => {
  assert.equal(classifyHeading("Controversies"), "governance");
  assert.equal(classifyHeading("Environmental impact"), "environment");
  assert.equal(classifyHeading("Labor practices"), "labor");
  assert.equal(classifyHeading("Privacy concerns"), "privacy");
  assert.equal(classifyHeading("Animal welfare"), "animals");
  assert.equal(classifyHeading("Lobbying"), "political");
  assert.equal(classifyHeading("Philanthropy"), "charity");
  assert.equal(classifyHeading("Diversity"), "dei");
  assert.equal(classifyHeading("Random Junk Section"), null);
});

test("CATEGORY_PATTERNS recognizes B Corp + accused-of categories", () => {
  const bcorp = CATEGORY_PATTERNS.find(p => p.rx.test("Category:B Lab-certified corporations"));
  assert.ok(bcorp);
  assert.equal(bcorp.positive, true);
  const accused = CATEGORY_PATTERNS.find(p => p.rx.test("Category:Companies accused of greenwashing"));
  assert.ok(accused);
  assert.equal(accused.positive, false);
});

test("parseArgs handles --limit, --out, --cache, --dry, --apply", () => {
  const a = parseArgs(["--limit", "10", "--out", "/tmp/y.json", "--cache", "--dry"]);
  assert.equal(a.limit, 10);
  assert.equal(a.cache, true);
  assert.equal(a.dry, true);
});

test("stripWikitext removes refs, templates, file links, internal links", () => {
  const wt = `==Controversies==
{{Main|Foo}}
The company faced a [[lawsuit|class action]] in 2021<ref>{{cite news|url=https://nyt.com}}</ref>.
[[File:Foo.jpg|thumb]]
Result: settlement of '''$5 million'''.`;
  const out = stripWikitext(wt);
  assert.ok(!out.includes("{{"));
  assert.ok(!out.includes("[["));
  assert.ok(!out.includes("<ref"));
  assert.ok(!out.includes("File:"));
  assert.ok(out.includes("class action"));
  assert.ok(out.includes("settlement"));
});

test("replayFixture returns the bundle as-is", async () => {
  const bundle = await replayFixture(FIXTURE);
  assert.equal(bundle._license, "CC BY-SA 4.0 — Wikipedia, https://en.wikipedia.org");
  assert.ok((bundle.pages || []).length >= 3);
});

// ─────────────────────────── merger tests ───────────────────────────────
test("merger classifySection marks Meta privacy as 'poor' (strong negative)", () => {
  const section = {
    heading: "Privacy concerns",
    category: "privacy",
    text: "Facebook–Cambridge Analytica data scandal was a major incident. Settlement reached with the FTC for a $5 billion fine. Multiple class action lawsuits filed.",
    ref_count: 18,
    external_link_count: 10,
    url: "https://en.wikipedia.org/wiki/Meta_Platforms#Privacy_concerns",
  };
  const out = classifySection(section);
  assert.equal(out.sc, "poor");
  assert.equal(out.severity, "negative");
  assert.ok(out.text.includes('Wikipedia "Privacy concerns" section'));
});

test("merger classifySection marks Patagonia sustainability as 'positive'", () => {
  const section = {
    heading: "Sustainability",
    category: "environment",
    text: "Patagonia donated 1% of sales to environmental groups and pledged carbon neutral operations. Certified B Corporation.",
    ref_count: 5,
    external_link_count: 3,
    url: "https://en.wikipedia.org/wiki/Patagonia,_Inc.#Sustainability",
  };
  const out = classifySection(section);
  assert.equal(out.sc, "positive");
  assert.equal(out.severity, "positive");
});

test("merger classifySection caps narrative to 200 chars of section text", () => {
  const longText = "A ".repeat(800);
  const section = {
    heading: "Controversies",
    category: "governance",
    text: longText,
    ref_count: 0,
    external_link_count: 0,
    url: "https://en.wikipedia.org/wiki/X#Controversies",
  };
  const out = classifySection(section);
  // Narrative includes the "Wikipedia \"…\" section: " prefix plus ≤200 chars of body.
  assert.ok(out.text.length <= 240, `narrative too long: ${out.text.length}`);
});

test("buildAugment collapses sections and emits per-category narratives", async () => {
  const raw = await replayFixture(FIXTURE);
  const slugSet = new Set(["nestle", "patagonia", "meta-platforms"]);
  const companies = buildAugment(raw, slugSet);

  assert.ok(companies["nestle"]);
  assert.ok(companies["nestle"].narratives.governance);
  assert.ok(companies["nestle"].narratives.environment);
  assert.ok(companies["patagonia"].narratives.environment);
  assert.equal(companies["patagonia"].narratives.environment.sc, "positive");
  assert.equal(companies["meta-platforms"].narratives.privacy.sc, "poor");
});

test("buildAugment ignores pages whose slug is not in the index", async () => {
  const raw = await replayFixture(FIXTURE);
  const companies = buildAugment(raw, new Set(["nestle"]));
  assert.equal(Object.keys(companies).length, 1);
  assert.ok(companies["nestle"]);
  assert.ok(!companies["patagonia"]);
});
