#!/usr/bin/env node
/**
 * Test harness for ca-ag-fetch.mjs.
 *
 * Runs the listing parser + defendant extraction + settlement parsing +
 * categorization against 3 hand-crafted HTML fixtures that mirror the
 * real CA AG /consumers/actions Drupal markup. NO network calls — we
 * deliberately do not ping oag.ca.gov from CI or worktree review.
 *
 * Locally: node scripts/ca-ag-fetch.test.mjs
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseListingPage,
  extractDefendant,
  extractSettlementUSD,
  inferActionType,
  categorize,
} from "./ca-ag-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/ca-ag");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}
function truthy(actual, msg) {
  if (actual) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg} (got ${JSON.stringify(actual)})`); }
}

async function main() {
  console.log("CA AG fetch parser tests\n");

  // --- parseListingPage across all 3 fixtures ---
  const pages = ["list-page-1.html", "list-page-2.html", "list-page-3.html"];
  const allItems = [];
  for (const p of pages) {
    const html = await fs.readFile(path.join(FIXTURES, p), "utf-8");
    const items = parseListingPage(html);
    console.log(`\n[${p}] parsed ${items.length} items`);
    for (const it of items) {
      console.log(`  - ${it.date} | ${it.title.slice(0, 80)}`);
    }
    eq(items.length, 3, `${p}: 3 listings parsed`);
    allItems.push(...items);
  }

  console.log("\nField extraction:\n");

  // --- Meta data breach (page 1, listing 1) ---
  const meta = allItems[0];
  eq(meta.date, "2026-05-14", "meta: date parsed");
  eq(extractDefendant(meta.title), "Meta Platforms", "meta: defendant extracted");
  eq(extractSettlementUSD(meta.title + " " + meta.summary), 95_000_000, "meta: $95M parsed");
  eq(inferActionType(meta.title), "settlement", "meta: action_type=settlement");
  eq(categorize(meta.title + " " + meta.summary), "privacy", "meta: categorized as privacy");

  // --- Amazon wage theft (page 1, listing 2) ---
  const amazon = allItems[1];
  eq(amazon.date, "2026-04-28", "amazon: date parsed");
  eq(extractDefendant(amazon.title), "Amazon", "amazon: defendant extracted");
  eq(inferActionType(amazon.title), "lawsuit", "amazon: action_type=lawsuit");
  eq(categorize(amazon.title + " " + amazon.summary), "labor", "amazon: categorized as labor");

  // --- Walmart hazardous waste (page 1, listing 3) ---
  const walmart = allItems[2];
  eq(walmart.date, "2026-04-11", "walmart: date parsed");
  eq(extractDefendant(walmart.title), "Walmart Stores Inc.", "walmart: defendant extracted (with corp suffix)");
  eq(extractSettlementUSD(walmart.title), 12_000_000, "walmart: $12M parsed");
  eq(inferActionType(walmart.title), "judgment", "walmart: action_type=judgment");
  eq(categorize(walmart.title + " " + walmart.summary), "environment", "walmart: categorized as environment");

  // --- DoorDash misclassification (page 2, listing 1) ---
  const doordash = allItems[3];
  eq(extractDefendant(doordash.title), "DoorDash", "doordash: defendant extracted");
  eq(extractSettlementUSD(doordash.title + " " + doordash.summary), 43_000_000, "doordash: $43M parsed");
  eq(categorize(doordash.title + " " + doordash.summary), "labor", "doordash: categorized as labor");

  // --- Comcast deceptive billing (page 2, listing 2) ---
  const comcast = allItems[4];
  eq(extractDefendant(comcast.title), "Comcast Corporation", "comcast: defendant extracted");
  eq(inferActionType(comcast.title), "lawsuit", "comcast: action_type=lawsuit");
  eq(categorize(comcast.title + " " + comcast.summary), "consumer_fraud", "comcast: categorized as consumer_fraud");

  // --- Chevron air quality (page 2, listing 3) ---
  const chevron = allItems[5];
  eq(extractDefendant(chevron.title), "Chevron Corporation", "chevron: defendant extracted");
  eq(extractSettlementUSD(chevron.summary), 7_500_000, "chevron: $7.5M parsed");
  eq(categorize(chevron.title + " " + chevron.summary), "environment", "chevron: categorized as environment");

  // --- Clearview AI biometric (page 3, listing 1) ---
  const clearview = allItems[6];
  eq(extractDefendant(clearview.title), "Clearview AI", "clearview: defendant extracted");
  eq(inferActionType(clearview.title), "charges", "clearview: action_type=charges");
  eq(categorize(clearview.title + " " + clearview.summary), "privacy", "clearview: categorized as privacy");

  // --- Honda warranty (page 3, listing 2) ---
  const honda = allItems[7];
  eq(extractDefendant(honda.title), "Honda Motor Co.", "honda: defendant extracted");
  eq(extractSettlementUSD(honda.title), 2_100_000, "honda: $2.1M parsed");

  // --- Acme Charity (page 3, listing 3) ---
  const acme = allItems[8];
  eq(extractDefendant(acme.title), "Acme Charity Fundraisers", "acme: defendant extracted");
  eq(inferActionType(acme.title), "judgment", "acme: action_type=judgment");
  eq(categorize(acme.title + " " + acme.summary), "charity", "acme: categorized as charity");

  // --- Edge case: defendant extraction handles "Stores Inc." trailer ---
  truthy(extractDefendant(walmart.title).startsWith("Walmart"), "walmart variant starts with Walmart");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
