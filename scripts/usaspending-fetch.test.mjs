#!/usr/bin/env node
/**
 * Test harness for usaspending-fetch.mjs.
 *
 * Runs parseAwardRow + aggregateAwards + the merger's resolveSlug + the
 * federalContracts block builder against 3 hand-crafted JSON fixtures
 * that mirror the real USAspending API /search/spending_by_award/ shape.
 * NO network calls — we deliberately do not ping api.usaspending.gov from
 * CI or worktree review.
 *
 * Locally: node scripts/usaspending-fetch.test.mjs
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAwardRow,
  aggregateAwards,
  topByAmount,
  fiveYearWindow,
} from "./usaspending-fetch.mjs";
import { buildFederalContractsBlock } from "./usaspending-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/usaspending");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}
function truthy(actual, msg) {
  if (actual) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg} (got ${JSON.stringify(actual)})`); }
}

async function loadFixture(name) {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, name), "utf-8"));
}

async function main() {
  console.log("USAspending fetch parser tests\n");

  // ── fiveYearWindow ──
  console.log("\n[fiveYearWindow]\n");
  const win = fiveYearWindow(new Date("2026-06-07T00:00:00Z"));
  eq(win.start_date, "2021-06-07", "start_date is exactly 5y before now");
  eq(win.end_date,   "2026-06-07", "end_date is now");

  // ── parseAwardRow + aggregate (Lockheed: 5 defense contracts) ──
  console.log("\n[Lockheed fixture: 5 defense contracts]\n");
  const lockheed = await loadFixture("lockheed-page-1.json");
  eq(lockheed.results.length, 5, "fixture: 5 awards");
  const lockheedAwards = lockheed.results.map(parseAwardRow);

  eq(lockheedAwards[0].amount, 1850000000, "row 0: $1.85B amount parsed");
  eq(lockheedAwards[0].agency, "Department of Defense", "row 0: agency parsed");
  eq(lockheedAwards[0].naics, "Other Aircraft Parts and Auxiliary Equipment Manufacturing", "row 0: NAICS parsed");
  eq(lockheedAwards[0].date, "2024-08-12", "row 0: Start Date parsed");
  truthy(lockheedAwards[0].description.includes("F-35"), "row 0: description includes F-35");
  truthy(lockheedAwards[0].description.length <= 240, "row 0: description trimmed <= 240 chars");

  const lockheedAgg = aggregateAwards({ slug: "lockheed-martin", name: "Lockheed Martin" }, lockheedAwards);
  eq(lockheedAgg.status, "ok", "Lockheed aggregate: status=ok");
  eq(lockheedAgg.award_count_last_5y, 5, "Lockheed aggregate: 5 awards");
  eq(lockheedAgg.total_obligated_USD_last_5y, 4127000000, "Lockheed aggregate: total = $4.127B");
  eq(lockheedAgg.primary_agency, "Department of Defense", "Lockheed aggregate: DoD is primary agency");
  eq(lockheedAgg.recent_top5.length, 5, "Lockheed aggregate: recent_top5 has 5 entries");
  eq(lockheedAgg.recent_top5[0].amount, 1850000000, "Lockheed aggregate: top5[0] is the largest award");
  eq(
    lockheedAgg.primary_naics,
    "Other Aircraft Parts and Auxiliary Equipment Manufacturing",
    "Lockheed aggregate: primary NAICS = aircraft parts (top by $)"
  );

  // ── Microsoft fixture: 3 awards, JWCC dominates ──
  console.log("\n[Microsoft fixture: 3 cloud + software contracts]\n");
  const ms = await loadFixture("microsoft-page-1.json");
  const msAwards = ms.results.map(parseAwardRow);
  eq(msAwards.length, 3, "Microsoft: 3 awards parsed");
  const msAgg = aggregateAwards({ slug: "microsoft", name: "Microsoft" }, msAwards);
  eq(msAgg.status, "ok", "Microsoft aggregate: status=ok");
  eq(msAgg.total_obligated_USD_last_5y, 1046000000, "Microsoft aggregate: total = $1.046B");
  eq(msAgg.primary_agency, "Department of Defense", "Microsoft aggregate: DoD is primary (JWCC + IVAS)");
  eq(
    msAgg.primary_naics,
    "Computing Infrastructure Providers, Data Processing, Web Hosting, and Related Services",
    "Microsoft aggregate: primary NAICS = cloud infra ($745M JWCC dominates)"
  );
  eq(msAgg.recent_top5.length, 3, "Microsoft aggregate: only 3 entries in top5 (fewer than 5 awards)");

  // ── Moderna fixture: empty result set ──
  console.log("\n[Moderna fixture: 0 awards (5y window misses Operation Warp Speed)]\n");
  const moderna = await loadFixture("moderna-empty.json");
  eq(moderna.results.length, 0, "Moderna: 0 results in fixture");
  const modernaAgg = aggregateAwards({ slug: "moderna", name: "Moderna" }, moderna.results.map(parseAwardRow));
  eq(modernaAgg.status, "no_contracts", "Moderna aggregate: status=no_contracts");
  eq(modernaAgg.total_obligated_USD_last_5y, 0, "Moderna aggregate: total = $0");
  eq(modernaAgg.award_count_last_5y, 0, "Moderna aggregate: 0 awards");
  eq(modernaAgg.recent_top5.length, 0, "Moderna aggregate: empty recent_top5");
  eq(modernaAgg.primary_agency, null, "Moderna aggregate: null primary_agency");

  // ── topByAmount helper ──
  console.log("\n[topByAmount helper]\n");
  const top1 = topByAmount([
    { label: "DoD",  amount: 100 },
    { label: "HHS",  amount: 50 },
    { label: "DoD",  amount: 25 },
    { label: null,   amount: 999 },
  ], 1);
  eq(top1[0].label, "DoD", "topByAmount: DoD beats HHS (100+25 > 50)");
  eq(top1[0].amount, 125, "topByAmount: sums duplicate labels");

  // ── buildFederalContractsBlock (merger shape) ──
  console.log("\n[buildFederalContractsBlock]\n");
  const block = buildFederalContractsBlock(lockheedAgg, "2026-06-07T00:00:00.000Z");
  eq(block.totalObligatedUSDLast5y, 4127000000, "block: total renamed to camelCase");
  eq(block.awardCountLast5y, 5, "block: award_count_last_5y renamed");
  eq(block.recentTop5.length, 5, "block: recentTop5 has 5 entries");
  eq(block.recentTop5[0].amount, 1850000000, "block: top5[0] amount preserved");
  eq(block.primaryAgency, "Department of Defense", "block: primaryAgency");
  eq(block.lastUpdated, "2026-06-07T00:00:00.000Z", "block: lastUpdated injected");
  eq(block.source, "usaspending", "block: source tag");
  eq(block.sourceUrl, "https://www.usaspending.gov/", "block: sourceUrl");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("usaspending-fetch.test failed:", err);
  process.exit(1);
});
