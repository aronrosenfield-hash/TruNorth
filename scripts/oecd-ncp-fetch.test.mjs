/**
 * Tests for scripts/oecd-ncp-fetch.mjs + oecd-ncp-merge.mjs
 *
 *   node --test scripts/oecd-ncp-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENTRIES, SOURCE_URLS, build } from "./oecd-ncp-fetch.mjs";
import { rollupSeverity, themeToCategory, slugify, resolveBrand } from "./oecd-ncp-merge.mjs";

test("ENTRIES: every row has required fields", () => {
  assert.ok(ENTRIES.length >= 30, `expected ≥30 curated cases, got ${ENTRIES.length}`);
  for (const e of ENTRIES) {
    assert.ok(e.brand, "brand required");
    // slugHint can be null when the multinational has no TruNorth index entry.
    assert.ok(e.slugHint === null || typeof e.slugHint === "string", `slugHint type (brand: ${e.brand})`);
    assert.ok(e.caseTitle, "caseTitle required");
    assert.ok(e.sourceUrl && /^https?:\/\//.test(e.sourceUrl), `sourceUrl required & http(s) (brand: ${e.brand})`);
    assert.ok(["labor","political","environment","human-rights"].includes(e.theme), `valid theme (brand: ${e.brand}, theme: ${e.theme})`);
    assert.ok(["agreement","no-agreement","withdrawn","rejected","blocked","ongoing"].includes(e.outcome), `valid outcome (${e.outcome})`);
    assert.ok(["leader","positive","mixed","concern","landmark"].includes(e.severity), `valid severity (${e.severity})`);
    assert.ok(Array.isArray(e.issues) && e.issues.length, "issues required");
    assert.ok(typeof e.year === "number" && e.year >= 1990 && e.year <= 2030, "valid year");
    assert.ok(e.summary && e.summary.length <= 500, "summary ≤500 chars");
  }
});

test("ENTRIES: at least one brand has 2+ instances (pattern severity)", () => {
  const counts = {};
  for (const e of ENTRIES) counts[e.slugHint] = (counts[e.slugHint] || 0) + 1;
  const multi = Object.entries(counts).filter(([_, n]) => n >= 2);
  assert.ok(multi.length >= 3, `expected ≥3 brands with 2+ instances, got ${multi.length}`);
});

test("SOURCE_URLS: all are https", () => {
  for (const [k, v] of Object.entries(SOURCE_URLS)) {
    assert.ok(/^https:\/\//.test(v), `${k} must be https`);
  }
});

test("build() with limit returns correct shape", async () => {
  const out = await build({ limit: 5 });
  assert.equal(out.entries.length, 5);
  assert.ok(out._license);
  assert.ok(out._generated_at);
  assert.equal(typeof out._stats.entries, "number");
});

test("themeToCategory: covers all themes", () => {
  assert.equal(themeToCategory("labor"), "labor");
  assert.equal(themeToCategory("human-rights"), "labor"); // mapped to labor (worker/community rights)
  assert.equal(themeToCategory("political"), "political");
  assert.equal(themeToCategory("environment"), "environment");
});

test("rollupSeverity: single ongoing → mixed", () => {
  assert.equal(rollupSeverity(["mixed"]), "mixed");
});

test("rollupSeverity: 2 concern → concern", () => {
  assert.equal(rollupSeverity(["concern","concern"]), "concern");
});

test("rollupSeverity: 1 concern + 1 positive → mixed", () => {
  assert.equal(rollupSeverity(["concern","positive"]), "mixed");
});

test("rollupSeverity: 3+ instances any → concern (pattern)", () => {
  assert.equal(rollupSeverity(["mixed","mixed","mixed"]), "concern");
});

test("rollupSeverity: landmark wins", () => {
  assert.equal(rollupSeverity(["mixed","landmark"]), "landmark");
});

test("rollupSeverity: all positive → positive", () => {
  assert.equal(rollupSeverity(["positive","positive"]), "positive");
});

test("rollupSeverity: empty → null", () => {
  assert.equal(rollupSeverity([]), null);
});

test("slugify: handles ampersand + apostrophes", () => {
  assert.equal(slugify("H&M"), "h-and-m");
  assert.equal(slugify("Royal Dutch Shell"), "royal-dutch-shell");
  assert.equal(slugify("McDonald's"), "mcdonalds");
});

test("resolveBrand: slugHint takes priority when known", () => {
  const knownSlugs = new Set(["nestl"]);
  const out = resolveBrand(
    { brand: "Nestlé S.A.", slugHint: "nestl" },
    { knownSlugs, aliases: {}, parents: {} }
  );
  assert.equal(out.slug, "nestl");
  assert.equal(out.routedVia, "slugHint");
});

test("resolveBrand: returns null when slug unknown", () => {
  const out = resolveBrand(
    { brand: "Unknown Co", slugHint: "unknown-co" },
    { knownSlugs: new Set(), aliases: {}, parents: {} }
  );
  assert.equal(out.slug, null);
  assert.equal(out.routedVia, "orphan");
});
