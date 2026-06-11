#!/usr/bin/env node
/**
 * Tests for sec-ecd-fetch.mjs (name normalization + augment shape) and the
 * sec-def14a / sec-ecd writers' ratio tiers in apply-augments.
 * Run: node scripts/sec-ecd-fetch.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normName } from "./sec-ecd-fetch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
function t(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

// ── normName ──────────────────────────────────────────────────────────────
t("normName strips legal suffixes and punctuation", () => {
  assert.equal(normName("Walmart Inc."), "walmart");
  assert.equal(normName("ALEXANDER’S, INC."), "alexanders");
  assert.equal(normName("The Coca-Cola Company"), "coca cola");
  assert.equal(normName("Cheniere Energy, Inc."), "cheniere energy");
});
t("normName keeps distinct brands distinct", () => {
  assert.notEqual(normName("Vera Bradley, Inc."), normName("Vera Wang Co"));
});

// ── ratio tiers must mirror getDisplay's execPay labels in src/App.jsx ────
// good = "<50:1", mixed = "50–300:1", poor = ">300:1"
function tierOf(ratio) { return ratio < 50 ? "good" : ratio <= 300 ? "mixed" : "poor"; }
t("ratio tiers match the UI labels", () => {
  assert.equal(tierOf(12), "good");
  assert.equal(tierOf(49.9), "good");
  assert.equal(tierOf(50), "mixed");
  assert.equal(tierOf(300), "mixed");
  assert.equal(tierOf(301), "poor");
  assert.equal(tierOf(1447), "poor");
});

// The tier thresholds above are duplicated inside the sec-def14a writer —
// assert the writer source still contains them so a future edit can't
// silently drift from this test (and from the UI).
t("apply-augments sec-def14a writer uses the same thresholds", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/apply-augments-to-companies.mjs"), "utf8");
  assert.ok(src.includes('name: "sec-def14a"'), "sec-def14a writer registered");
  assert.ok(src.includes('name: "sec-ecd"'), "sec-ecd writer registered");
  assert.ok(/ratio < 50 \? "good" : ratio <= 300 \? "mixed" : "poor"/.test(src), "tier expression intact");
  // sec-def14a (scored) must come BEFORE sec-ecd (narrative-only): the apply
  // loop is first-wins per category.
  assert.ok(src.indexOf('name: "sec-def14a"') < src.indexOf('name: "sec-ecd"'), "writer order: def14a before ecd");
});

// ── augment shape (when present) ──────────────────────────────────────────
t("sec-ecd augment (if generated) is non-empty and well-shaped", () => {
  const p = path.join(ROOT, "data/derived/sec-ecd-augment.json");
  if (!fs.existsSync(p)) { console.log("    (no augment yet — skipped)"); return; }
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const slugs = Object.keys(j).filter(k => !k.startsWith("_"));
  // B-60 guard convention: an existing augment must never be empty.
  assert.ok(slugs.length > 0, "augment has entries");
  const e = j[slugs[0]].execPay;
  assert.ok(typeof e.peoTotal === "number" && e.peoTotal > 0, "peoTotal numeric");
  assert.ok(typeof e.year === "number" && e.year >= 2022, "year sane");
  assert.ok(typeof e.cik === "number", "cik numeric");
});

console.log(`\n${passed} tests passed ✅`);
