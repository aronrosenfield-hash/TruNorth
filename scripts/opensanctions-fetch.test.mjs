#!/usr/bin/env node
/**
 * Tests for opensanctions-fetch.mjs (+ opensanctions-merge.mjs match logic).
 *
 * Drives the streaming fetcher against the 40-line JSONL fixture at
 *   scripts/fixtures/opensanctions/sample.jsonl
 * via a `file://` URL — no network calls. Then exercises the merge match
 * rules against a hand-crafted brand index.
 *
 * Run: node --test scripts/opensanctions-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";
import { createReadStream } from "node:fs";

import {
  keepEntity,
  projectEntity,
  fetchAndFilter,
} from "./opensanctions-fetch.mjs";
import {
  normalizeName,
  buildBrandLookup,
  matchEntity,
} from "./opensanctions-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/opensanctions/sample.jsonl");

async function tmpFile(suffix = ".jsonl") {
  const p = path.join(os.tmpdir(), `os-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  return p;
}

async function readJsonl(file) {
  const out = [];
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) out.push(JSON.parse(line));
  return out;
}

test("keepEntity keeps Company/Organization with topics:sanction", () => {
  const ok = {
    schema: "Organization",
    caption: "Acme Sanctioned Co",
    properties: { name: ["Acme Sanctioned Co"], topics: ["sanction"] },
  };
  assert.equal(keepEntity(ok), true);
});

test("keepEntity drops Person schema", () => {
  const person = {
    schema: "Person",
    caption: "Jane Doe",
    properties: { name: ["Jane Doe"], topics: ["sanction"] },
  };
  assert.equal(keepEntity(person), false);
});

test("keepEntity drops entities without topics:sanction", () => {
  const noTopic = {
    schema: "Company",
    caption: "Plain Co",
    properties: { name: ["Plain Co"], topics: [] },
  };
  assert.equal(keepEntity(noTopic), false);
});

test("keepEntity drops nameless entities", () => {
  const nameless = {
    schema: "Organization",
    caption: "",
    properties: { topics: ["sanction"] },
  };
  assert.equal(keepEntity(nameless), false);
});

test("projectEntity flattens names + crosswalk IDs from referents", () => {
  const e = {
    id: "NK-abc",
    caption: "Cap Co",
    schema: "Company",
    datasets: ["us_ofac_sdn"],
    first_seen: "2024-01-01T00:00:00",
    last_seen: "2026-06-01T00:00:00",
    referents: ["us-sec-cik-1234567", "Q42", "random-tag"],
    properties: {
      name: ["Cap Co", "Cap Company"],
      alias: ["Cap"],
      country: ["us"],
      topics: ["sanction"],
      programId: ["US-OFAC-SDN"],
      sourceUrl: ["https://example/details"],
      wikidataId: ["Q9999"],
    },
  };
  const p = projectEntity(e);
  assert.equal(p.id, "NK-abc");
  assert.deepEqual([...p.names].sort(), ["Cap", "Cap Co", "Cap Company"].sort());
  assert.deepEqual(p.countries, ["us"]);
  assert.deepEqual(p.programIds, ["US-OFAC-SDN"]);
  // Wikidata QIDs come from BOTH properties.wikidataId AND referents matching /^Q\d+$/.
  assert.ok(p.wikidataIds.includes("Q9999"));
  assert.ok(p.wikidataIds.includes("Q42"));
  // SEC CIK extracted from `us-sec-cik-1234567` referent.
  assert.ok(p.secCiks.includes("1234567"));
});

test("fetchAndFilter streams fixture and keeps all 40 organizations", async () => {
  const out = await tmpFile();
  const url = pathToFileURL(FIXTURE).toString();
  const { kept, scanned } = await fetchAndFilter({
    url,
    outPath: out,
    indexUrl: null,
  });
  assert.equal(scanned, 40, "scanned all 40 fixture lines");
  // Fixture is Org/Company-only, but three lines lack `topics:["sanction"]`
  // (two have empty topics, one is export-control/debarment) — those are
  // exactly the records keepEntity is meant to filter out.
  assert.equal(kept, 37, "kept 37 of 40 fixture entities (3 lack topics:sanction)");

  const rows = await readJsonl(out);
  assert.equal(rows.length, 37);
  // Spot check the first row is the Myanmar Yatai entry.
  assert.ok(rows[0].names.some(n => /Yatai/i.test(n)));
  assert.ok(rows[0].topics.includes("sanction"));
  assert.ok(rows[0].datasets.length >= 1);

  await fs.unlink(out);
});

test("fetchAndFilter honors --limit", async () => {
  const out = await tmpFile();
  const url = pathToFileURL(FIXTURE).toString();
  const { kept } = await fetchAndFilter({
    url,
    outPath: out,
    limit: 5,
    indexUrl: null,
  });
  assert.equal(kept, 5);
  const rows = await readJsonl(out);
  assert.equal(rows.length, 5);
  await fs.unlink(out);
});

test("normalizeName strips suffixes, punctuation, diacritics", () => {
  assert.equal(normalizeName("The Boeing Company, Inc."), "boeing");
  assert.equal(normalizeName("Lockheed Martin Corp."), "lockheed martin");
  // "&" expands to " and " then "and" is dropped as a noise token, so
  // "Procter & Gamble Co." collapses to "procter gamble".
  assert.equal(normalizeName("Procter & Gamble Co."), "procter gamble");
  assert.equal(normalizeName("Société Générale"), "societe generale");
  // empty / generic-only input collapses to empty string
  assert.equal(normalizeName("The Company Inc"), "");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName(null), "");
});

test("matchEntity prefers wikidata QID over name", () => {
  const lookup = buildBrandLookup([
    { slug: "acme",   name: "Acme",          wikidataId: "Q12345" },
    { slug: "wrong",  name: "Acme Sanctioned Co" },  // exact-name distractor
  ]);
  const entity = projectEntity({
    id: "NK-x",
    caption: "Acme Sanctioned Co",
    schema: "Company",
    datasets: [],
    properties: {
      name: ["Acme Sanctioned Co"],
      topics: ["sanction"],
      wikidataId: ["Q12345"],
    },
  });
  const m = matchEntity(entity, lookup);
  assert.equal(m.slug, "acme");
  assert.equal(m.kind, "wikidata_qid");
});

test("matchEntity exact-normalized-name match (single brand)", () => {
  const lookup = buildBrandLookup([
    { slug: "myanmar-yatai", name: "Myanmar Yatai International Holding Group" },
  ]);
  const entity = projectEntity({
    id: "NK-y",
    caption: "Myanmar Yatai International Holding Group Co., LTD.",
    schema: "Organization",
    datasets: ["us_ofac_sdn"],
    properties: {
      name: ["Myanmar Yatai International Holding Group Co., LTD."],
      topics: ["sanction"],
    },
  });
  const m = matchEntity(entity, lookup);
  assert.equal(m.slug, "myanmar-yatai");
  assert.equal(m.kind, "exact_normalized_name");
});

test("matchEntity returns null on unique unmatched name", () => {
  const lookup = buildBrandLookup([{ slug: "acme", name: "Acme" }]);
  const entity = projectEntity({
    id: "NK-z",
    caption: "Some Other Sanctioned Co",
    schema: "Company",
    datasets: [],
    properties: { name: ["Some Other Sanctioned Co"], topics: ["sanction"] },
  });
  assert.equal(matchEntity(entity, lookup), null);
});

test("matchEntity flags ambiguous names rather than guessing", () => {
  const lookup = buildBrandLookup([
    { slug: "acme-trading-east", name: "Acme Trading Partners" },
    { slug: "acme-trading-west", name: "Acme Trading Partners" },
  ]);
  const entity = projectEntity({
    id: "NK-q",
    caption: "Acme Trading Partners",
    schema: "Company",
    datasets: [],
    properties: { name: ["Acme Trading Partners"], topics: ["sanction"] },
  });
  const m = matchEntity(entity, lookup);
  // ambiguous_name returns slug:null + candidates list
  assert.equal(m.slug, null);
  assert.equal(m.kind, "ambiguous_name");
  assert.deepEqual([...m.candidates].sort(), ["acme-trading-east", "acme-trading-west"]);
});

test("matchEntity ignores single-token name matches (false-positive guard)", () => {
  // "Apple" and "Opera" are real brands whose name normalizes to a single
  // token — and OpenSanctions has dozens of sanctioned shell cos with
  // those names. We must NOT auto-tag the consumer brand on a single-token
  // collision.
  const lookup = buildBrandLookup([
    { slug: "opera", name: "Opera" },
  ]);
  const entity = projectEntity({
    id: "NK-fake",
    caption: "Opera",
    schema: "Company",
    datasets: ["us_ofac_sdn"],
    properties: { name: ["Opera"], topics: ["sanction"] },
  });
  assert.equal(matchEntity(entity, lookup), null);
});
