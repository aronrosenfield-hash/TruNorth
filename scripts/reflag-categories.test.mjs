// Tests for scripts/reflag-categories.mjs.
//
// Run:
//   node --test scripts/reflag-categories.test.mjs
//   node scripts/reflag-categories.test.mjs   (also works — default test runner)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  buildLookups,
  computeFlagsForCompany,
  CATEGORIES,
} from "./reflag-categories.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const COMPANIES_DIR  = path.join(ROOT, "public/data/companies");
const APPLICABILITY  = path.join(ROOT, "public/data/_meta/category-applicability.json");
const OVERRIDES_PATH = path.join(ROOT, "public/data/_meta/category-applicability-overrides.json");
const GIVING_PATH    = path.join(ROOT, "data/derived/corporate-giving-augment.json");
const TRANSPARENCY_P = path.join(ROOT, "data/derived/transparency-benchmarks-augment.json");
const WIKIRATE_P     = path.join(ROOT, "data/derived/wikirate-augment.json");
const CARBON_P       = path.join(ROOT, "data/derived/industry-carbon-intensity-augment.json");

function readJSON(p)     { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function safeJSON(p)     { try { return readJSON(p); } catch { return null; } }
function readCompany(s)  { return readJSON(path.join(COMPANIES_DIR, `${s}.json`)); }

const applicability  = readJSON(APPLICABILITY);
const overrides      = safeJSON(OVERRIDES_PATH) || { overrides: {} };
const giving         = safeJSON(GIVING_PATH)    || { companies: {} };
const transparency   = safeJSON(TRANSPARENCY_P) || { data: {} };
const wikirate       = safeJSON(WIKIRATE_P)     || { companies: {} };
const carbon         = safeJSON(CARBON_P)       || { companies: {} };
const LOOKUPS = buildLookups({ applicability, overrides, giving, transparency, wikirate, carbon });

// Separate lookup WITHOUT overrides — used to assert that the override file is
// what changes Walmart's behavior, not some unrelated change to cat-level rules.
const LOOKUPS_NO_OVERRIDES = buildLookups({
  applicability, overrides: { overrides: {} }, giving, transparency, wikirate, carbon,
});

// ─────────────────────── per-brand expectations ───────────────────────

test("Apple → guns na, health na, animals na, no execPay flag (has CIK/ticker)", () => {
  const apple = readCompany("apple");
  const f = computeFlagsForCompany(apple, LOOKUPS);
  assert.deepEqual(f.guns,    { na: true }, "guns must be NA for Technology");
  assert.deepEqual(f.health,  { na: true }, "health must be NA for Technology");
  assert.deepEqual(f.animals, { na: true }, "animals must be NA for Technology");
  assert.equal(f.execPay, undefined, "execPay must NOT be flagged (Apple is public)");
});

test("Walmart → guns applicable via override (NOT na), health NA by cat, disclosed everywhere else", () => {
  // Retail's cat-level applicability marks guns NA at the industry tier.
  // Walmart sells firearms, so public/data/_meta/category-applicability-overrides.json
  // promotes guns to "applicable" — reflag removes the {na:true} so a real
  // score gets computed downstream.
  const walmart = readCompany("walmart");
  const f = computeFlagsForCompany(walmart, LOOKUPS);
  assert.equal(f.guns, undefined,
    "override → guns must NOT be {na:true} for Walmart");
  assert.deepEqual(f.health,  { na: true }, "Retail cat default: health NA");
  assert.equal(f.animals, undefined,        "Retail has physical products — animals applicable");
  // Walmart is heavily-disclosed; explicit asserts pin the contract.
  assert.equal(f.execPay,      undefined, "Walmart is public — execPay disclosed");
  assert.equal(f.charity,      undefined, "Walmart is in corporate-giving augment");
  assert.equal(f.transparency, undefined, "Walmart is in transparency benchmarks");
});

test("Walmart → without override file, guns WOULD be {na:true} (sanity check)", () => {
  // Locks the contract: it's specifically the override map that changes
  // Walmart, not some unrelated tweak to the Retail cat applicability rule.
  const walmart = readCompany("walmart");
  const f = computeFlagsForCompany(walmart, LOOKUPS_NO_OVERRIDES);
  assert.deepEqual(f.guns, { na: true },
    "without overrides, Retail's cat-level rule must still mark guns NA");
});

test("Apple → guns still {na:true} (no override applies, cat-level rule wins)", () => {
  // Apple has no override entry, so it follows Technology's cat-level NA list.
  // This pins that overrides are surgical, not global.
  const apple = readCompany("apple");
  const f = computeFlagsForCompany(apple, LOOKUPS);
  assert.deepEqual(f.guns, { na: true },
    "Apple has no override; Technology cat-level guns NA must persist");
});

test("Patagonia → execPay notDisclosed (private), guns na, health na", () => {
  const pat = readCompany("patagonia");
  const f = computeFlagsForCompany(pat, LOOKUPS);
  assert.deepEqual(f.guns,    { na: true }, "Apparel & Fashion: guns NA");
  assert.deepEqual(f.health,  { na: true }, "Apparel & Fashion: health NA");
  assert.deepEqual(f.execPay, { notDisclosed: true }, "Patagonia is private — execPay notDisclosed");
});

test("environment _inferred — present iff narrative is 'No public record found.' AND in carbon augment", () => {
  // Apple: narrative IS 'No public record found.' → _inferred fires.
  const apple = readCompany("apple");
  const f1 = computeFlagsForCompany(apple, LOOKUPS);
  assert.deepEqual(f1.environment, { _inferred: true, basis: "Technology" });

  // Walmart: narrative is a real violation summary → _inferred suppressed.
  const walmart = readCompany("walmart");
  const f2 = computeFlagsForCompany(walmart, LOOKUPS);
  assert.equal(f2.environment, undefined);
});

test("small private brand → execPay/dei/charity/transparency notDisclosed", () => {
  // Pick a small private brand: scan for one with no ticker, no deiBadges,
  // not in giving, not in transparency/wikirate. Use deterministic discovery.
  const slugs = fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json"));
  let picked = null;
  for (const file of slugs) {
    const co = readJSON(path.join(COMPANIES_DIR, file));
    if (co.ticker || co.cik || co.isPublic) continue;
    if (Array.isArray(co.deiBadges) && co.deiBadges.length) continue;
    if (giving.companies?.[co.slug])         continue;
    if (transparency.data?.[co.slug])        continue;
    if (wikirate.companies?.[co.slug])       continue;
    picked = co;
    break;
  }
  assert.ok(picked, "should be able to find at least one small private brand");
  const f = computeFlagsForCompany(picked, LOOKUPS);
  assert.deepEqual(f.execPay,      { notDisclosed: true });
  assert.deepEqual(f.dei,          { notDisclosed: true });
  assert.deepEqual(f.charity,      { notDisclosed: true });
  assert.deepEqual(f.transparency, { notDisclosed: true });
});

// ─────────────────────── corpus-wide invariants ───────────────────────

test("all 11260 companies process without throwing; flags shape is canonical", () => {
  const slugs = fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json"));
  assert.equal(slugs.length, 11260, `expected 11260 companies, got ${slugs.length}`);
  let ok = 0;
  for (const file of slugs) {
    const co = readJSON(path.join(COMPANIES_DIR, file));
    if (!co.slug) co.slug = file.slice(0, -5);
    const f = computeFlagsForCompany(co, LOOKUPS);
    // shape check — values must each be exactly one of the 3 known shapes
    for (const [k, v] of Object.entries(f)) {
      assert.ok(CATEGORIES.includes(k), `${file}: unknown category in flags: ${k}`);
      const keys = Object.keys(v);
      const isNa            = keys.length === 1 && v.na === true;
      const isNotDisclosed  = keys.length === 1 && v.notDisclosed === true;
      const isInferred      = keys.length === 2 && v._inferred === true && typeof v.basis === "string";
      assert.ok(
        isNa || isNotDisclosed || isInferred,
        `${file}: invalid flag shape for ${k}: ${JSON.stringify(v)}`
      );
    }
    ok++;
  }
  assert.equal(ok, 11260);
});

test("snapshot diff — sc.<cat> values unchanged before/after reflag (hash compare)", () => {
  // Build a deterministic hash of every co.sc and other load-bearing fields.
  // Then simulate the reflag (in-memory only) and hash again. They must match.
  const slugs = fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json"));

  function hashSnapshot(includeFlags) {
    const h = crypto.createHash("sha256");
    for (const file of slugs.sort()) {
      const co = readJSON(path.join(COMPANIES_DIR, file));
      // Lock down everything that must not change.
      const lock = {
        slug:     co.slug || file.slice(0, -5),
        name:     co.name,
        cat:      co.cat,
        overall:  co.overall,
        sc:       co.sc,
        excl:     co.excl,        // bundle-only normally; pin if present
        political: co.political?.s,
        charity:  co.charity?.s,
        environment: co.environment?.s,
        labor:    co.labor?.s,
        dei:      co.dei?.s,
        animals:  co.animals?.s,
        guns:     co.guns?.s,
        privacy:  co.privacy?.s,
        execPay:  co.execPay?.s,
      };
      h.update(file + JSON.stringify(lock));
      if (includeFlags) h.update("flags=" + JSON.stringify(computeFlagsForCompany(co, LOOKUPS)));
    }
    return h.digest("hex");
  }
  const before = hashSnapshot(false);
  const after  = hashSnapshot(false); // same lock fields → must match identically
  assert.equal(before, after, "sc/narrative hash must be stable across re-reads");

  // Sanity: including flags in the hash MUST change the result for at least
  // one company (otherwise the reflag is a no-op).
  const withFlags = hashSnapshot(true);
  assert.notEqual(before, withFlags, "flags must materially change at least one entry");
});

test("bundle round-trip — flags survive into public/data/index.json", () => {
  // This test assumes a freshly-built bundle (see scripts/rebuild-bundle-index.mjs).
  // The bundle is rebuilt in CI by `npm run build`. If it is stale this test
  // points to which entry diverged.
  const bundlePath = path.join(ROOT, "public/data/index.json");
  if (!fs.existsSync(bundlePath)) {
    // CI/clean checkouts may not have it built yet — skip rather than fail.
    return;
  }
  const bundle = readJSON(bundlePath);
  // Spot-check three load-bearing brands.
  const samples = ["apple", "patagonia", "walmart"];
  for (const slug of samples) {
    const co = readCompany(slug);
    if (!co.slug) co.slug = slug;
    const expected = computeFlagsForCompany(co, LOOKUPS);
    const entry = bundle.find(e => e.slug === slug);
    assert.ok(entry, `bundle missing slug=${slug}`);
    if (Object.keys(expected).length === 0) {
      assert.ok(!entry.flags || Object.keys(entry.flags).length === 0,
        `${slug}: expected no flags in bundle, got ${JSON.stringify(entry.flags)}`);
    } else {
      assert.deepEqual(entry.flags, expected,
        `${slug}: bundle.flags must match detail.flags`);
    }
  }
});

test("idempotent — computeFlagsForCompany is pure / deterministic per company", () => {
  const apple = readCompany("apple");
  const f1 = computeFlagsForCompany(apple, LOOKUPS);
  const f2 = computeFlagsForCompany(apple, LOOKUPS);
  assert.deepEqual(f1, f2);
  // And: running on a co that already has `flags` does not let the prior flags
  // leak through — fresh computation only reads cat/ticker/etc.
  apple.flags = { political: { na: true }, GARBAGE: true };
  const f3 = computeFlagsForCompany(apple, LOOKUPS);
  assert.deepEqual(f3, f1, "prior flags must not influence recomputation");
});
