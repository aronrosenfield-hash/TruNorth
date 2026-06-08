#!/usr/bin/env node
/**
 * Tests for the Better Cotton pipeline (DW-57).
 *
 *   node --test scripts/better-cotton-fetch.test.mjs
 *
 * Uses scripts/fixtures/better-cotton/sample.html (8 hand-crafted member
 * cards across two template variants). No network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseMembersHtml,
  parseMemberSince,
  stripTags,
  decodeEntities,
  SOURCE_URL,
} from "./better-cotton-fetch.mjs";

import {
  slugify,
  stripCorporateSuffix,
  resolveBrand,
} from "./better-cotton-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/better-cotton/sample.html");

const loadFixture = () => fs.readFile(FIXTURE, "utf-8");

// ─── primitives ───────────────────────────────────────────────────────────
test("decodeEntities + stripTags handle apostrophes & ampersands", () => {
  assert.equal(decodeEntities("Levi&#39;s"), "Levi's");
  assert.equal(decodeEntities("H&amp;M"), "H&M");
  assert.equal(stripTags("<span>  hello <b>world</b>  </span>"), "hello world");
});

test("parseMemberSince: typical phrasings", () => {
  assert.equal(parseMemberSince("Member since 2014"), 2014);
  assert.equal(parseMemberSince("Joined 2010"), 2010);
  assert.equal(parseMemberSince("since 2005"), 2005);
  assert.equal(parseMemberSince("estd 1999"), 1999); // bare year fallback
  assert.equal(parseMemberSince(""), null);
  assert.equal(parseMemberSince(null), null);
});

// ─── parser ───────────────────────────────────────────────────────────────
test("parseMembersHtml: 8 members across both templates", async () => {
  const html = await loadFixture();
  const items = parseMembersHtml(html);
  assert.equal(items.length, 8, `expected 8, got ${items.length}`);
});

test("parseMembersHtml: member-card variant carries country + memberSince", async () => {
  const html = await loadFixture();
  const items = parseMembersHtml(html);
  const nike = items.find(m => /nike/i.test(m.brand));
  assert.ok(nike, "Nike present");
  assert.equal(nike.country, "United States");
  assert.equal(nike.memberSince, 2014);
  assert.equal(nike.sourceUrl, SOURCE_URL);
});

test("parseMembersHtml: bci-member variant (IKEA)", async () => {
  const items = parseMembersHtml(await loadFixture());
  const ikea = items.find(m => m.brand === "IKEA");
  assert.ok(ikea, "IKEA present");
  assert.equal(ikea.memberSince, 2005);
});

test("parseMembersHtml: entity-encoded brand decodes", async () => {
  const items = parseMembersHtml(await loadFixture());
  const levis = items.find(m => /levi/i.test(m.brand));
  assert.ok(levis, "Levi's present");
  assert.equal(levis.brand, "Levi's", "apostrophe decoded");
});

test("parseMembersHtml: H&M ampersand decodes", async () => {
  const items = parseMembersHtml(await loadFixture());
  const hm = items.find(m => m.brand === "H&M");
  assert.ok(hm, "H&M present");
  assert.equal(hm.memberSince, 2009);
});

test("parseMembersHtml: no footer-link false positives", async () => {
  const items = parseMembersHtml(await loadFixture());
  assert.equal(items.filter(m => /^contact$/i.test(m.brand)).length, 0);
});

// ─── merge helpers ────────────────────────────────────────────────────────
test("slugify handles apostrophes + ampersands + diacritics", () => {
  assert.equal(slugify("Levi's"), "levis");
  assert.equal(slugify("H&M"), "h-and-m");
  assert.equal(slugify("Estée Lauder"), "estee-lauder");
  assert.equal(slugify("Gap Inc."), "gap-inc");
});

test("stripCorporateSuffix removes Inc/AG/Ltd", () => {
  assert.equal(stripCorporateSuffix("Nike, Inc."), "Nike");
  assert.equal(stripCorporateSuffix("Adidas AG"), "Adidas");
  assert.equal(stripCorporateSuffix("Burberry Group plc"), "Burberry");
});

// ─── end-to-end resolution ────────────────────────────────────────────────
test("resolveBrand: direct hit (Nike → nike)", () => {
  const ctx = { knownSlugs: new Set(["nike", "adidas"]), aliases: {}, parents: {} };
  const r = resolveBrand("Nike, Inc.", ctx);
  assert.equal(r.slug, "nike");
  assert.equal(r.routedVia, "direct");
});

test("resolveBrand: alias hit", () => {
  const ctx = {
    knownSlugs: new Set(["hennes-and-mauritz"]),
    aliases: { "h-and-m": "hennes-and-mauritz" },
    parents: {},
  };
  const r = resolveBrand("H&M", ctx);
  assert.equal(r.slug, "hennes-and-mauritz");
  assert.equal(r.routedVia, "alias");
});

test("resolveBrand: parent hit", () => {
  const ctx = {
    knownSlugs: new Set(["gap-inc"]),
    aliases: {},
    parents: { "old-navy": { parent: "gap-inc" } },
  };
  const r = resolveBrand("Old Navy", ctx);
  assert.equal(r.slug, "gap-inc");
  assert.equal(r.routedVia, "parent");
});

test("resolveBrand: orphan", () => {
  const ctx = { knownSlugs: new Set(["nike"]), aliases: {}, parents: {} };
  const r = resolveBrand("Zzz Cotton Co — Unknown Brand", ctx);
  assert.equal(r.slug, null);
  assert.equal(r.routedVia, "orphan");
});

test("end-to-end: 8 fixture members resolve as expected", async () => {
  const html = await loadFixture();
  const members = parseMembersHtml(html);
  const ctx = {
    knownSlugs: new Set(["nike", "adidas", "h-and-m", "ikea", "target", "gap-inc"]),
    aliases: { "levis": "levi-strauss" },
    parents: {},
  };
  // Pre-seed knownSlugs with the alias target so it can resolve.
  ctx.knownSlugs.add("levi-strauss");

  const routes = { direct: 0, alias: 0, parent: 0, orphan: 0 };
  for (const m of members) routes[resolveBrand(m.brand, ctx).routedVia]++;
  assert.equal(routes.direct, 6, `direct=${routes.direct}`); // nike,adidas,h-and-m,ikea,target,gap-inc
  assert.equal(routes.alias, 1, `alias=${routes.alias}`);   // levis
  assert.equal(routes.orphan, 1, `orphan=${routes.orphan}`); // Zzz Cotton Co
});
