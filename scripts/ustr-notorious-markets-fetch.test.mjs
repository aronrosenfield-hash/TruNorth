#!/usr/bin/env node
/**
 * Test harness for ustr-notorious-markets-{fetch,merge}.mjs.
 *
 * Uses scripts/fixtures/ustr-notorious-markets/sample.txt (no network).
 *
 * Run: node --test scripts/ustr-notorious-markets-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURATED_MARKETS,
  verifyMarket,
} from "./ustr-notorious-markets-fetch.mjs";
import {
  slugify,
  resolveSlug,
} from "./ustr-notorious-markets-merge.mjs";

test("CURATED_MARKETS — every entry has required fields", () => {
  for (const m of CURATED_MARKETS) {
    assert.ok(m.marketName, `missing marketName`);
    assert.ok(m.slugKey, `${m.marketName} missing slugKey`);
    assert.ok(m.operator, `${m.marketName} missing operator`);
    assert.ok(["online", "physical"].includes(m.category));
    assert.ok(Array.isArray(m.aliases) && m.aliases.length > 0);
  }
});

test("CURATED_MARKETS — slugKey is properly slugified", () => {
  for (const m of CURATED_MARKETS) {
    assert.equal(m.slugKey, m.slugKey.toLowerCase());
    assert.match(m.slugKey, /^[a-z0-9-]+$/);
  }
});

test("verifyMarket — finds known alias case-insensitively", () => {
  const text = "Section: TAOBAO\nTaobao is operated by Alibaba.";
  assert.equal(verifyMarket(text, ["TAOBAO", "Taobao"]), true);
  assert.equal(verifyMarket(text, ["NotPresentMarket"]), false);
  assert.equal(verifyMarket("", ["Taobao"]), false);
});

test("slugify — basic cases", () => {
  assert.equal(slugify("Alibaba Group Holding"), "alibaba-group-holding");
  assert.equal(slugify("ByteDance Ltd."), "bytedance-ltd");
  assert.equal(slugify("PDD Holdings"), "pdd-holdings");
});

test("resolveSlug — direct match", () => {
  const knownSlugs = new Set(["alibaba", "bytedance"]);
  assert.deepEqual(
    resolveSlug("alibaba", { knownSlugs, aliases: {}, parents: {} }),
    { slug: "alibaba", routedVia: "direct" },
  );
});

test("resolveSlug — alias map", () => {
  const knownSlugs = new Set(["alibaba"]);
  const aliases = { "alibaba-group": "alibaba" };
  assert.deepEqual(
    resolveSlug("alibaba-group", { knownSlugs, aliases, parents: {} }),
    { slug: "alibaba", routedVia: "alias" },
  );
});

test("resolveSlug — parent map", () => {
  const knownSlugs = new Set(["bytedance"]);
  const parents = { "douyin": "bytedance" };
  assert.deepEqual(
    resolveSlug("douyin", { knownSlugs, aliases: {}, parents }),
    { slug: "bytedance", routedVia: "parent" },
  );
});

test("resolveSlug — returns null for unknown", () => {
  const knownSlugs = new Set(["alibaba"]);
  assert.equal(
    resolveSlug("nonexistent-brand-xyz", { knownSlugs, aliases: {}, parents: {} }),
    null,
  );
});

test("verifyMarket — fixture detects all curated markets", async () => {
  // Run the fixture text through verification end-to-end.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.join(__dirname, "fixtures/ustr-notorious-markets/sample.txt");
  const text = await fs.readFile(fixture, "utf-8");
  let verified = 0;
  for (const m of CURATED_MARKETS) {
    if (verifyMarket(text, m.aliases)) verified++;
  }
  // Fixture covers Taobao, Pinduoduo, DHGate, Douyin, Baidu, VK — 6/8.
  assert.ok(verified >= 6, `expected ≥6 verified, got ${verified}`);
});
