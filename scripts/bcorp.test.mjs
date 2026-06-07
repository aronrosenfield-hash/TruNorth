#!/usr/bin/env node
/**
 * Test harness for the B Corp pipeline (B-data5).
 *
 * Runs the parser + slug resolver against the 3 synthetic fixture HTML files
 * under test/fixtures/bcorp/. NO network calls — we deliberately do not ping
 * bcorporation.net from CI or worktree review.
 *
 * Locally: node scripts/bcorp.test.mjs
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBcorpPage, normalizeDate } from "./bcorp-fetch.mjs";
import { resolveSlug, slugify } from "./bcorp-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/bcorp");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}

async function loadMaps() {
  const meta = path.join(ROOT, "public/data/_meta");
  let aliases = {}, parents = {};
  try { aliases = JSON.parse(await fs.readFile(path.join(meta, "slug-aliases.json"), "utf-8")); } catch {}
  try { parents = JSON.parse(await fs.readFile(path.join(meta, "brand-parent-map.json"), "utf-8")); } catch {}
  return { aliases, parents };
}

async function main() {
  console.log("--- parseBcorpPage (3 template variants) ---");

  const p1 = await fs.readFile(path.join(FIXTURES, "bcorp-page-1.html"), "utf-8");
  const items1 = parseBcorpPage(p1);
  eq(items1.length, 4, "page 1 (li.bcorp-entry × 4)");
  eq(items1[0].brand, "Patagonia, Inc.", "page 1 brand[0]");
  eq(items1[0].overall_score, 151.4, "page 1 score[0]");
  eq(items1[0].scores.environment, 62.8, "page 1 env subscore[0]");
  eq(items1[0].certification_date, "2011-12-12", "page 1 cert date[0]");
  eq(items1[0].recertification_due, "2027-12-12", "page 1 recert due[0]");
  eq(items1[2].certification_date, "2018-02-08", "page 1 freeform date normalized");

  const p2 = await fs.readFile(path.join(FIXTURES, "bcorp-page-2.html"), "utf-8");
  const items2 = parseBcorpPage(p2);
  eq(items2.length, 4, "page 2 (div.bcorp-entry × 4)");
  eq(items2[3].brand, "Dr. Bronner's", "page 2 brand[3] (entity decode)");
  eq(items2[3].overall_score, 152.9, "page 2 score[3]");

  const p3 = await fs.readFile(path.join(FIXTURES, "bcorp-page-3.html"), "utf-8");
  const items3 = parseBcorpPage(p3);
  eq(items3.length, 7, "page 3 (tr.bcorp-entry × 7)");
  eq(items3[0].brand, "Hyatt Hotels Corporation", "page 3 brand[0]");
  eq(items3[3].brand, "Danone North America", "page 3 brand[3]");

  console.log("\n--- normalizeDate ---");
  eq(normalizeDate("2018-04-12"), "2018-04-12", "ISO passthrough");
  eq(normalizeDate("February 8, 2018"), "2018-02-08", "freeform 'Feb 8, 2018'");
  eq(normalizeDate("2019"), "2019-01-01", "year-only");
  eq(normalizeDate(""), null, "empty → null");

  console.log("\n--- slugify (suffix-stripping) ---");
  eq(slugify("Patagonia, Inc."), "patagonia", "strips Inc.");
  eq(slugify("Ben & Jerry's Homemade, Inc."), "ben-and-jerrys-homemade", "amp + apostrophe");
  eq(slugify("Method Products PBC"), "method-products", "strips PBC");
  eq(slugify("Dr. Bronner's"), "dr-bronners", "strips apostrophe");

  console.log("\n--- resolveSlug ---");
  const maps = await loadMaps();
  // Known overrides — these should match regardless of company-universe state
  eq(resolveSlug("Patagonia, Inc.", maps).routed_via, "override", "patagonia → override");
  eq(resolveSlug("Allbirds, Inc.", maps).routed_via, "override", "allbirds → override");
  eq(resolveSlug("Danone North America", maps).routed_via, "override", "danone-na → override");
  // Explicit override_skip — Athleta (Gap Inc.) and KIND
  eq(resolveSlug("Athleta (Gap Inc.)", maps).slug, null, "athleta-gap → no-route (override_skip)");
  eq(resolveSlug("Athleta (Gap Inc.)", maps).routed_via, "override_skip", "athleta-gap routed_via");
  // Negative-control assertion: confirm none of the 30 negative brands appear
  // in the synthetic raw feed (so resolveSlug is never called on them in
  // production — they remain unenriched, which is the desired behavior).
  const raw = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/_raw/bcorp.json"), "utf-8"));
  const rawSlugs = new Set(raw.certified_brands.map(b => slugify(b.brand)));
  const negatives = ["walmart","exxonmobil","chevron","target","amazon","meta","google","apple","microsoft","nike","starbucks","mcdonalds","coca-cola","pepsico","tesla","ford","general-motors","boeing","wells-fargo","jpmorgan-chase","bank-of-america","citigroup","verizon","at-t","disney","netflix","spotify","t-mobile","best-buy","home-depot"];
  const leaked = negatives.filter(n => rawSlugs.has(n));
  eq(leaked.length, 0, `0/30 negative controls leak into raw feed (leaked: ${leaked.join(",") || "none"})`);

  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error("bcorp.test failed:", err); process.exit(1); });
