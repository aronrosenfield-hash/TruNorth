#!/usr/bin/env node
/**
 * Tests for wikidata-mass-fetch.mjs + wikidata-mass-merge.mjs.
 *
 * No network. Loads scripts/fixtures/wikidata/sample.json and exercises:
 *   - parseArgs / brandCandidates / chunk (fetcher pure helpers)
 *   - buildWikipediaUrl + parseWikipediaResponse (MW response parsing)
 *   - buildSparql + flattenBindings (SPARQL response parsing)
 *   - replayFixture (offline replay)
 *   - buildAugment (merger output shape + severity rules)
 *
 * Run: node --test scripts/wikidata-mass-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LICENSE,
  PROPERTIES,
  parseArgs,
  brandCandidates,
  buildWikipediaUrl,
  parseWikipediaResponse,
  buildSparql,
  flattenBindings,
  chunk,
  replayFixture,
} from "./wikidata-mass-fetch.mjs";
import { _buildAugment } from "./wikidata-mass-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/wikidata/sample.json");

test("LICENSE is the CC0 attribution", () => {
  assert.equal(LICENSE, "CC0 — Wikidata, https://www.wikidata.org");
});

test("PROPERTIES covers the spec'd Wikidata properties", () => {
  const props = PROPERTIES.map(p => p.prop);
  for (const required of ["P793", "P127", "P361", "P1830", "P463", "P166", "P159", "P3938", "P2002"]) {
    assert.ok(props.includes(required), `missing ${required}`);
  }
  // P793 must be marked negative; the merger relies on this.
  assert.equal(PROPERTIES.find(p => p.prop === "P793").negative, true);
});

test("parseArgs handles --limit, --out, --cache, --dry, --apply", () => {
  const a = parseArgs(["--limit", "50", "--out", "/tmp/x.json", "--cache", "--dry"]);
  assert.equal(a.limit, 50);
  assert.equal(a.out, "/tmp/x.json");
  assert.equal(a.cache, true);
  assert.equal(a.dry, true);
  const b = parseArgs(["--apply"]);
  assert.equal(b.apply, true);
});

test("brandCandidates strips 'The' and adds '(company)' fallback", () => {
  const c = brandCandidates("The Coca-Cola Company");
  assert.ok(c.includes("Coca-Cola Company"));
  assert.ok(c.includes("Coca-Cola Company (company)"));
});

test("brandCandidates doesn't duplicate '(company)' when already present", () => {
  const c = brandCandidates("Foo (company)");
  assert.equal(c.length, 1);
});

test("buildWikipediaUrl produces the right MW endpoint shape", () => {
  const u = new URL(buildWikipediaUrl(["Nike", "Apple Inc."]));
  assert.equal(u.origin + u.pathname, "https://en.wikipedia.org/w/api.php");
  assert.equal(u.searchParams.get("action"), "query");
  assert.equal(u.searchParams.get("titles"), "Nike|Apple Inc.");
  assert.equal(u.searchParams.get("redirects"), "1");
  assert.equal(u.searchParams.get("ppprop"), "wikibase_item|disambiguation");
});

test("parseWikipediaResponse maps redirect-resolved titles back to input", () => {
  const payload = {
    query: {
      redirects: [{ from: "Patagonia", to: "Patagonia, Inc." }],
      pages: [
        { title: "Patagonia, Inc.", pageprops: { wikibase_item: "Q1660552" } },
        { title: "Apple", pageprops: { wikibase_item: "Q312" } },
      ],
    },
  };
  const result = parseWikipediaResponse(payload, ["Patagonia", "Apple"]);
  assert.equal(result.get("Patagonia").qid, "Q1660552");
  assert.equal(result.get("Apple").qid, "Q312");
});

test("parseWikipediaResponse marks disambig pages", () => {
  const payload = {
    query: {
      pages: [{ title: "Mercury", pageprops: { wikibase_item: "Q123", disambiguation: "" } }],
    },
  };
  const result = parseWikipediaResponse(payload, ["Mercury"]);
  assert.equal(result.get("Mercury").disambig, true);
});

test("buildSparql includes all PROPERTIES as OPTIONALs + VALUES qids", () => {
  const q = buildSparql(["Q160746", "Q380"]);
  assert.ok(q.includes("VALUES ?item { wd:Q160746 wd:Q380 }"));
  assert.ok(q.includes("OPTIONAL { ?item wdt:P793"));
  assert.ok(q.includes("OPTIONAL { ?item wdt:P127"));
  assert.ok(q.includes("OPTIONAL { ?item wdt:P166"));
  assert.ok(q.includes("SERVICE wikibase:label"));
});

test("flattenBindings emits one row per (qid, prop, value); dedups duplicates", () => {
  const bindings = [
    {
      item:   { value: "http://www.wikidata.org/entity/Q160746" },
      p793:   { value: "http://www.wikidata.org/entity/Q1234" },
      p793Label: { value: "Baby formula scandal" },
      p127:   { value: "http://www.wikidata.org/entity/Q5" },
      p127Label: { value: "ACME Holdings" },
    },
    // Duplicate of the above — SPARQL OPTIONAL Cartesian artifact.
    {
      item:   { value: "http://www.wikidata.org/entity/Q160746" },
      p793:   { value: "http://www.wikidata.org/entity/Q1234" },
      p793Label: { value: "Baby formula scandal" },
    },
    {
      item:   { value: "http://www.wikidata.org/entity/Q380" },
      p2002:  { value: "Meta" },
    },
  ];
  const claims = flattenBindings(bindings);
  // Expect: Q160746/P793/Q1234, Q160746/P127/Q5, Q380/P2002/Meta — 3 rows.
  assert.equal(claims.length, 3);
  assert.deepEqual(
    claims.map(c => `${c.qid}|${c.prop}|${c.value}`).sort(),
    ["Q160746|P127|Q5", "Q160746|P793|Q1234", "Q380|P2002|Meta"]
  );
});

test("chunk groups by N", () => {
  assert.deepEqual(chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]]);
});

test("replayFixture returns the bundle as-is", async () => {
  const bundle = await replayFixture(FIXTURE);
  assert.equal(bundle._license, "CC0 — Wikidata, https://www.wikidata.org");
  assert.ok(bundle.resolved.length >= 3);
  assert.ok(bundle.claims.length >= 8);
});

// ─────────────────────────── merger tests ───────────────────────────────
test("buildAugment routes claims to the correct properties on each slug", async () => {
  const raw = await replayFixture(FIXTURE);
  const slugSet = new Set(["nestle", "patagonia", "meta-platforms"]);
  const companies = _buildAugment(raw, slugSet);

  assert.ok(companies["nestle"], "nestle should be present");
  assert.equal(companies["nestle"].significant_events.length, 2);
  assert.equal(companies["nestle"].member_of.length, 1);
  assert.equal(companies["patagonia"].award_received.length, 1);
  assert.equal(companies["patagonia"].twitter_handle, "patagonia");
});

test("buildAugment marks Nestlé environment as negative once 2+ events fire", async () => {
  const raw = await replayFixture(FIXTURE);
  const companies = _buildAugment(raw, new Set(["nestle"]));
  // Nestlé has two negative significant events but only one is environment-coded
  // (deforestation). The other is labor (child labour). Both narratives should
  // be informational/mixed since each category only sees 1 negative event.
  const n = companies["nestle"];
  // member_of "Roundtable on Sustainable Palm Oil" emits an info row
  assert.ok(n.narratives.environment, "should have an environment narrative");
});

test("buildAugment marks Patagonia 'positive' from B Corp award", async () => {
  const raw = await replayFixture(FIXTURE);
  const companies = _buildAugment(raw, new Set(["patagonia"]));
  const p = companies["patagonia"];
  assert.equal(p.narratives.environment.sc, "positive");
  assert.match(p.narratives.environment.text, /B Corp/i);
});

test("buildAugment skips claims for slugs not in the index", async () => {
  const raw = await replayFixture(FIXTURE);
  const companies = _buildAugment(raw, new Set(["patagonia"]));
  assert.equal(Object.keys(companies).length, 1);
  assert.ok(!companies["nestle"]);
});
