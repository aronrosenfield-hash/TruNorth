#!/usr/bin/env node
/**
 * Tests for scripts/lib/news-brand-match.mjs.
 *
 * Run with: node scripts/lib/news-brand-match.test.mjs
 *
 * These guard the NEEDS_CONTEXT / NEGATIVE_CONTEXT lists against
 * regressions when new common-word collisions are discovered. Add a
 * test pair whenever a new false-positive shows up in production
 * augment runs.
 */

import { matchBrands, resolveSlug } from "./news-brand-match.mjs";

let pass = 0, fail = 0;
const assert = (cond, label) => {
  if (cond) { pass++; console.log("  ✓", label); }
  else      { fail++; console.log("  ✗", label); }
};

async function run() {
  console.log("matchBrands — positive matches");
  assert((await matchBrands("Walmart sued for wage theft")).includes("walmart"), "Walmart sued");
  assert((await matchBrands("Nike says factory workers earn double minimum wage in Indonesia")).includes("nike"), "Nike factory workers");
  assert((await matchBrands("McDonalds franchise lawsuit settled")).includes("mcdonald-s"), "McDonalds → mcdonald-s alias");
  assert((await matchBrands("Tyson Foods recalls 8 million pounds of chicken")).includes("tyson-foods"), "Tyson Foods recall");
  assert((await matchBrands("ExxonMobil to face $50M climate settlement")).includes("exxonmobil"), "ExxonMobil settlement");
  assert((await matchBrands("Pfizer's COVID drug trial misled investors")).includes("pfizer"), "Pfizer trial");
  assert((await matchBrands("Meta hit with $1B EU privacy fine")).includes("meta-platforms"), "Meta privacy fine");

  console.log("\nmatchBrands — negative-context rejections");
  assert(!(await matchBrands("Apple pie recipe of the season")).length, "Apple pie (food, not company)");
  assert(!(await matchBrands("NASA Mars rover finds new rock")).length, "Mars rover (planet)");
  assert(!(await matchBrands("Amazon rainforest deforestation hits record high")).length, "Amazon rainforest");
  assert(!(await matchBrands("Henry Ford biography wins Pulitzer")).length, "Henry Ford (historical)");
  assert(!(await matchBrands("World moves away from fossil fuels")).length, "Fossil fuels (not Fossil watches)");
  assert(!(await matchBrands("Mayor announces nationwide impact policy")).length, "Nationwide adverb (not insurer)");
  assert(!(await matchBrands("Federal budget deficit grows to $2T")).length, "Federal budget (not Budget rental)");
  assert(!(await matchBrands("Camel milk: FDA no longer warns")).length, "Camel milk (not Camel cigarettes)");
  assert(!(await matchBrands("Zoom court hearing for inmate")).length, "Zoom court (video conference, not Zoom corp)");
  assert(!(await matchBrands("Gap year in education hits rich vs poor")).length, "Gap year (idiom, not Gap Inc)");
  assert(!(await matchBrands("Welcome to Costco banner — FAKE image")).length, "Costco fake image debunking");
  assert(!(await matchBrands("X post user said")).length, "X post (platform reference)");
  assert(!(await matchBrands("Facebook pages claimed that Streep and Ivanka Trump had an on-air encounter")).length, "Facebook pages (rumor medium, not Meta corp)");
  assert((await matchBrands("Facebook hit with FTC investigation over teen data")).includes("meta-platforms"), "Facebook corporate action → meta-platforms");

  console.log("\nresolveSlug — alias + parent-map");
  assert(await resolveSlug("McDonalds") === "mcdonald-s", "McDonalds alias → mcdonald-s");
  assert(await resolveSlug("Lays") === "lay-s", "Lays alias → lay-s");
  assert(await resolveSlug("walmart") === "walmart", "walmart direct");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
