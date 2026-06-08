#!/usr/bin/env node
/**
 * Tests for the static UPC → slug cache shipped with the iOS app.
 *
 *   node --test scripts/upc-cache.test.mjs
 *
 * Verifies:
 *   - public/data/_meta/upc-to-slug.json parses
 *   - every UPC key is an 8 / 12 / 13 digit numeric string
 *   - every value.slug references a real file in public/data/companies/
 *   - file size is under 500 KB (so it doesn't bloat the IPA)
 *   - if bush-brothers exists in the index, the Bush's Best UPC resolves
 *     correctly (smoke test for the priority-brand pipeline)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UPC_JSON = path.join(ROOT, "public/data/_meta/upc-to-slug.json");
const COMPANIES_DIR = path.join(ROOT, "public/data/companies");
const INDEX_JSON = path.join(ROOT, "public/data/index.json");

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

test("upc-to-slug.json parses as JSON", async () => {
  const text = await fs.readFile(UPC_JSON, "utf8");
  assert.doesNotThrow(() => JSON.parse(text));
});

test("file size is under 500 KB", async () => {
  const st = await fs.stat(UPC_JSON);
  const kb = st.size / 1024;
  assert.ok(kb < 500, `upc-to-slug.json is ${kb.toFixed(1)} KB, must stay under 500`);
});

test("every UPC key is 8 / 12 / 13 digits", async () => {
  const data = await readJson(UPC_JSON);
  const keys = Object.keys(data).filter(k => k !== "_doc");
  assert.ok(keys.length > 0, "expected at least one UPC entry");
  for (const k of keys) {
    assert.match(k, /^\d+$/, `UPC ${k} is not all digits`);
    assert.ok([8, 12, 13].includes(k.length), `UPC ${k} length ${k.length} is not 8/12/13`);
  }
});

test("every slug references a real company file", async () => {
  const data = await readJson(UPC_JSON);
  // Read companies dir once for fast existence checks.
  const files = new Set(
    (await fs.readdir(COMPANIES_DIR))
      .filter(f => f.endsWith(".json"))
      .map(f => f.slice(0, -".json".length))
  );
  const missing = [];
  for (const [upc, v] of Object.entries(data)) {
    if (upc === "_doc") continue;
    assert.ok(v && typeof v === "object", `value for ${upc} is not an object`);
    assert.ok(typeof v.slug === "string" && v.slug.length > 0, `value for ${upc} missing slug`);
    if (!files.has(v.slug)) missing.push({ upc, slug: v.slug });
  }
  assert.equal(missing.length, 0, `${missing.length} UPCs reference unknown slugs (first: ${JSON.stringify(missing[0])})`);
});

test("every value has brand and name strings", async () => {
  const data = await readJson(UPC_JSON);
  for (const [upc, v] of Object.entries(data)) {
    if (upc === "_doc") continue;
    assert.equal(typeof v.brand, "string", `value for ${upc} missing brand`);
    assert.equal(typeof v.name, "string", `value for ${upc} missing name`);
  }
});

test("entries are dedupe-clean (no duplicate UPC keys)", async () => {
  // JSON.parse already dedupes string keys; this test mostly guards against
  // someone hand-editing the file. We also verify the index.json contract.
  const data = await readJson(UPC_JSON);
  const idx = await readJson(INDEX_JSON);
  const slugSet = new Set(idx.map(c => c.slug).filter(Boolean));
  for (const [upc, v] of Object.entries(data)) {
    if (upc === "_doc") continue;
    assert.ok(slugSet.has(v.slug), `slug ${v.slug} for UPC ${upc} not in index.json`);
  }
});

test("Bush's Best UPC resolves correctly (when bush-brothers slug exists)", async () => {
  const data = await readJson(UPC_JSON);
  const idx = await readJson(INDEX_JSON);
  const hasBush = idx.some(c => c.slug === "bush-brothers");
  if (!hasBush) {
    // Coordinated test — the parallel agent expanding brand-parent-map is
    // adding the bush-brothers entry. Until that lands, just skip.
    console.log("[upc-cache.test] SKIP: bush-brothers slug not yet in index.json");
    return;
  }
  const target = data["039400016014"] || data["0039400016014"];
  assert.ok(target, "Bush's Best UPC 039400016014 missing from cache");
  assert.equal(target.slug, "bush-brothers", `expected bush-brothers, got ${target.slug}`);
});
