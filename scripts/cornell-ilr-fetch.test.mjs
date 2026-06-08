#!/usr/bin/env node
/**
 * Test harness for cornell-ilr-fetch.mjs + cornell-ilr-merge.mjs.
 *
 * Uses scripts/fixtures/cornell-ilr/sample.json (6 representative
 * actions mirroring the real /labor_actions.json schema). NO network.
 *
 * Run: node --test scripts/cornell-ilr-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  splitEmployers,
  splitUnions,
  normalizeActionType,
  normalizeAction,
  flattenLaborActions,
} from "./cornell-ilr-fetch.mjs";

import {
  slugify,
  nameVariants,
  resolveEmployer,
} from "./cornell-ilr-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/cornell-ilr/sample.json");

// ─── splitEmployers ───────────────────────────────────────────────────────
test("splitEmployers — single employer unchanged", () => {
  assert.deepEqual(splitEmployers("Starbucks"), ["Starbucks"]);
});

test("splitEmployers — semicolon-separated splits", () => {
  assert.deepEqual(splitEmployers("Uber; Lyft"), ["Uber", "Lyft"]);
  assert.deepEqual(splitEmployers("McDonald's; Burger King; Wendy's"),
                   ["McDonald's", "Burger King", "Wendy's"]);
});

test("splitEmployers — empty / null returns []", () => {
  assert.deepEqual(splitEmployers(""), []);
  assert.deepEqual(splitEmployers(null), []);
  assert.deepEqual(splitEmployers("   "), []);
});

// ─── splitUnions ──────────────────────────────────────────────────────────
test("splitUnions — semicolon-separated", () => {
  assert.deepEqual(splitUnions("Amazon Labor Union; Teamsters (IBT)"),
                   ["Amazon Labor Union", "Teamsters (IBT)"]);
});

test("splitUnions — single", () => {
  assert.deepEqual(splitUnions("Workers United"), ["Workers United"]);
});

// ─── normalizeActionType ──────────────────────────────────────────────────
test("normalizeActionType — Strike / Protest / Lockout", () => {
  assert.equal(normalizeActionType("Strike"), "strike");
  assert.equal(normalizeActionType("Protest"), "protest");
  assert.equal(normalizeActionType("Lockout"), "lockout");
  assert.equal(normalizeActionType("strike"), "strike");
});

test("normalizeActionType — empty / unknown", () => {
  assert.equal(normalizeActionType(""), "unknown");
  assert.equal(normalizeActionType(null), "unknown");
  assert.equal(normalizeActionType("something-else"), "unknown");
});

// ─── normalizeAction ──────────────────────────────────────────────────────
test("normalizeAction — single-employer Strike yields one record", () => {
  const row = {
    id: 1,
    Employer: "Starbucks",
    Labor_Organization: "Workers United",
    Authorized: "Y",
    Action_type: "Strike",
    Industry: ["Accommodation and Food Services"],
    Worker_demands: ["Pay"],
    Start_date: "2024-01-15",
    End_date: "2024-01-15",
    Duration: 1,
    Approximate_Number_of_Participants: 250,
    Bargaining_Unit_Size: null,
    locations: [{ City: "Seattle", State: "Washington", Zip: "98101" }],
    sources: ["https://example.com/a"],
    Notes: "Test",
  };
  const out = normalizeAction(row);
  assert.equal(out.length, 1);
  assert.equal(out[0].employer, "Starbucks");
  assert.equal(out[0].actionType, "strike");
  assert.equal(out[0].numWorkers, 250);
  assert.equal(out[0].authorized, true);
  assert.equal(out[0].numUnions, 1);
  assert.equal(out[0].city, "Seattle");
  assert.equal(out[0].sourceUrl, "https://example.com/a");
  assert.ok(out[0].trackerUrl.includes("#action-1"));
});

test("normalizeAction — multi-employer 'Uber; Lyft' yields 2 records", () => {
  const row = {
    id: 9,
    Employer: "Uber; Lyft",
    Labor_Organization: "Independent Drivers Guild",
    Authorized: "",
    Action_type: "Protest",
    Industry: [],
    Worker_demands: ["Pay"],
    Start_date: "2024-02-01",
    End_date: "2024-02-01",
    Duration: 1,
    Approximate_Number_of_Participants: 500,
    Bargaining_Unit_Size: null,
    locations: [{ City: "New York", State: "New York", Zip: "10001" }],
    sources: [],
    Notes: "",
  };
  const out = normalizeAction(row);
  assert.equal(out.length, 2);
  assert.equal(out[0].employer, "Uber");
  assert.equal(out[1].employer, "Lyft");
  // Shared metadata
  assert.equal(out[0].actionId, 9);
  assert.equal(out[1].actionId, 9);
  assert.equal(out[0].actionType, "protest");
  assert.equal(out[0].sourceUrl, null);
});

test("normalizeAction — empty Employer yields []", () => {
  const row = {
    id: 7,
    Employer: "",
    Labor_Organization: "Fight for $15",
    Action_type: "Protest",
    Start_date: "2024-04-01",
    End_date: "2024-04-01",
    locations: [],
    sources: [],
  };
  assert.deepEqual(normalizeAction(row), []);
});

// ─── flattenLaborActions against fixture ──────────────────────────────────
test("flattenLaborActions — fixture yields expected per-employer records", async () => {
  const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const actions = flattenLaborActions(raw);
  // 6 fixture rows, 1 has empty employer → 5 records (no multi-employer
  // expansion in this fixture).
  assert.equal(actions.length, 5,
    `expected 5 per-employer records, got ${actions.length}`);

  const employers = actions.map(a => a.employer).sort();
  assert.deepEqual(employers,
    ["Amazon.com", "Kaiser Permanente", "Starbucks", "Starbucks", "Trader Joe's"]);

  // All action types should normalise
  for (const a of actions) {
    assert.ok(["strike", "protest", "lockout"].includes(a.actionType),
      `bad actionType ${a.actionType}`);
  }
});

// ─── slugify ──────────────────────────────────────────────────────────────
test("slugify — basic cases", () => {
  assert.equal(slugify("Starbucks"), "starbucks");
  assert.equal(slugify("McDonald's"), "mcdonalds");
  assert.equal(slugify("AT&T"), "at-and-t");
  assert.equal(slugify("Amazon.com"), "amazon-com");
});

// ─── nameVariants ─────────────────────────────────────────────────────────
test("nameVariants — strips US corporate suffixes", () => {
  const v = nameVariants("Starbucks Corporation");
  assert.ok(v.includes("Starbucks"), `expected 'Starbucks' in ${JSON.stringify(v)}`);
});

test("nameVariants — drops .com tail", () => {
  const v = nameVariants("Amazon.com");
  assert.ok(v.includes("Amazon"), `expected 'Amazon' in ${JSON.stringify(v)}`);
});

test("nameVariants — drops dba clause", () => {
  const v = nameVariants("Condé Nast DBA The New Yorker");
  // After dba-strip we should have "Condé Nast" as a variant
  assert.ok(v.some(x => x.startsWith("Condé Nast")),
    `expected Condé Nast in ${JSON.stringify(v)}`);
});

// ─── resolveEmployer ──────────────────────────────────────────────────────
test("resolveEmployer — direct slug match", () => {
  const indexSlugs = new Set(["starbucks", "amazon", "kaiser-permanente"]);
  const r = resolveEmployer("Starbucks", indexSlugs, {});
  assert.equal(r.slug, "starbucks");
  assert.equal(r.routedVia, "direct");
});

test("resolveEmployer — Amazon.com → amazon via alias", () => {
  const indexSlugs = new Set(["amazon"]);
  const r = resolveEmployer("Amazon.com", indexSlugs, {});
  // "Amazon.com" → variants include "Amazon" (.com stripped). The bare
  // "Amazon" slugifies to "amazon" which is in the index → direct match.
  // Either direct or alias is acceptable; what matters is the slug.
  assert.equal(r.slug, "amazon");
});

test("resolveEmployer — McDonald's resolves to mcdonald-s", () => {
  const indexSlugs = new Set(["mcdonald-s"]);
  const r = resolveEmployer("McDonald's", indexSlugs, {});
  // "McDonald's" slugifies to "mcdonalds"; alias routes to "mcdonald-s"
  assert.equal(r.slug, "mcdonald-s");
  assert.equal(r.routedVia, "alias");
});

test("resolveEmployer — unknown employer → orphan", () => {
  const r = resolveEmployer("Some Random Plumbing Co",
                            new Set(["unrelated"]), {});
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("resolveEmployer — brand-parent-map fallback", () => {
  const indexSlugs = new Set(["procter-and-gamble"]);
  const parentMap = { "tide": { parent: "procter-and-gamble" } };
  const r = resolveEmployer("Tide", indexSlugs, parentMap);
  assert.equal(r.slug, "procter-and-gamble");
  assert.equal(r.routedVia, "brand-parent");
});
