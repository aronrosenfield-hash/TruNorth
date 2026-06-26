#!/usr/bin/env node
/**
 * Test harness for privacy-enforcement-fetch.mjs.
 *
 * Exercises the pure parsers + STRICT name matcher + augment builder against
 * tiny in-memory fixtures that mirror the real source shapes. NO network calls
 * (we never ping oag.ca.gov / data.wa.gov / cppa.ca.gov from CI or a worktree).
 *
 * Locally: node scripts/privacy-enforcement-fetch.test.mjs
 * Exit 0 on success, 1 on any assertion failure.
 */

import assert from "node:assert/strict";
import {
  parseCaBreaches,
  shapeWaBreaches,
  parseBrokers,
  strictNameKeys,
  buildAugment,
} from "./privacy-enforcement-fetch.mjs";

let pass = 0,
  fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ok  ${msg}`);
  } else {
    fail++;
    console.error(`  FAIL ${msg}`);
  }
}
function eq(a, b, msg) {
  try {
    assert.deepEqual(a, b);
    pass++;
    console.log(`  ok  ${msg}`);
  } catch {
    fail++;
    console.error(`  FAIL ${msg}\n        expected: ${JSON.stringify(b)}\n        actual:   ${JSON.stringify(a)}`);
  }
}

// ── tiny index + parent-map mirroring real structures ──
const INDEX = [
  { slug: "general-motors", name: "General Motors" },
  { slug: "marriott-international", name: "Marriott International" },
  { slug: "capital-one", name: "Capital One" },
  { slug: "acxiom", name: "Acxiom" },
  { slug: "american", name: "American" }, // a real short single-word brand in the index
  { slug: "city-holding", name: "City Holding" },
  { slug: "general-mills", name: "General Mills" },
];
// parent-map keys are normalized sub-brand strings → { parent: <slug> }
const PARENT_MAP = {
  blue: { parent: "general-mills" }, // Blue® cheese → General Mills (the real collision)
  "marriott-international": { parent: "marriott-international" },
};

function main() {
  console.log("privacy-enforcement-fetch tests");

  // ── strictNameKeys ──
  console.log("\nstrictNameKeys:");
  eq(strictNameKeys("General Motors Company"), ["general motors"], "strips Co/Company suffix");
  ok(
    strictNameKeys("Amazon Web Services US").includes("amazon web services"),
    "offers a geo-stripped key ('amazon web services') alongside the full name",
  );
  ok(
    !strictNameKeys("American Lending Center").includes("american"),
    "does NOT emit a bare first-word ('american') for a long name",
  );

  // ── CA breach parser ──
  console.log("\nparseCaBreaches:");
  const caCsv =
    '"Organization Name","Date(s) of Breach  (if known)","Reported Date"\n' +
    '"General Motors Company","04/13/2026, 05/21/2026","06/25/2026"\n' +
    '"American Lending Center","01/23/2025","06/25/2026"\n' +
    '"Blank Org With No Breach Date","","06/01/2026"\n';
  const ca = parseCaBreaches(caCsv);
  eq(ca.length, 3, "parses 3 data rows");
  eq(ca[0].breachIso, "2026-05-21", "picks the LATEST of multiple breach dates");
  eq(ca[2].breachIso, "2026-06-01", "falls back to Reported Date when breach date blank");

  // ── WA breach shaper ──
  console.log("\nshapeWaBreaches:");
  const wa = shapeWaBreaches([
    {
      name: "General Motors Company",
      cyberattacktype: "Ransomware",
      databreachcause: "Cyberattack",
      washingtoniansaffected: "2,079,648",
      dateend: "2023-01-05T00:00:00.000",
    },
    {
      name: "Some Co",
      cyberattacktype: "",
      databreachcause: "Theft",
      washingtoniansaffected: "0",
      year: "2020",
    },
  ]);
  eq(wa[0].cause, "Ransomware", "prefers cyberattacktype over coarse cause");
  eq(wa[0].affected, 2079648, "parses comma-grouped affected count");
  eq(wa[0].breachIso, "2023-01-05", "derives ISO date from dateend");
  eq(wa[1].cause, "Theft", "falls back to databreachcause when no attack type");
  eq(wa[1].affected, null, "affected=0 → null");
  eq(wa[1].breachIso, "2020-01-01", "year-only → Jan 1 of that year");

  // ── CPPA broker parser (curly apostrophes + non-breaking hyphens in header) ──
  console.log("\nparseBrokers:");
  const brokerCsv =
    "﻿Data broker name:,Data broker collects personal information of minors:," +
    "Data broker collects consumers’ biometric data,Data broker collects consumers’ precise geolocation," +
    "Data broker shared or sold consumers’ data to law enforcement in the past year…," +
    "Data broker shared or sold consumers’ data to a developer of a GenAI system or model in the past year\n" +
    "Acxiom LLC,Yes,No,Yes,No,No\n" +
    "Some Broker Inc.,No,No,No,Yes,Yes\n";
  const brokers = parseBrokers(brokerCsv);
  eq(brokers.length, 2, "parses 2 broker rows");
  eq(brokers[0].name, "Acxiom LLC", "reads the legal name column");
  ok(brokers[0].collectsMinors === true, "Acxiom collectsMinors=true (Yes)");
  ok(brokers[0].collectsGeolocation === true, "Acxiom collectsGeolocation=true");
  ok(brokers[0].collectsBiometric === false, "Acxiom collectsBiometric=false (No)");
  ok(brokers[1].soldToLawEnforcement === true, "Some Broker soldToLawEnforcement=true");
  ok(brokers[1].soldToGenAI === true, "Some Broker soldToGenAI=true");

  // ── buildAugment: matching + aggregation + shape ──
  console.log("\nbuildAugment:");
  const caRows = [
    { org: "General Motors Company", breachIso: "2022-04-29" },
    { org: "General Motors", breachIso: "2023-08-01" }, // 2nd GM filing → count aggregates
    { org: "American Lending Center", breachIso: "2025-01-01" }, // must NOT match `american`
    { org: "Blue Cross of California", breachIso: "2024-01-01" }, // must NOT hit `blue`→general-mills
    { org: "Capital One", breachIso: "2023-02-04" },
  ];
  const waRows = shapeWaBreaches([
    {
      name: "General Motors Company",
      cyberattacktype: "Ransomware",
      washingtoniansaffected: "500000",
      dateend: "2024-06-01T00:00:00.000",
    },
  ]);
  const brokerRows = parseBrokers(brokerCsv); // Acxiom + Some Broker (Some Broker won't match index)
  const { augment, stats } = buildAugment({
    caRows,
    waRows,
    brokerRows,
    index: INDEX,
    parentMap: PARENT_MAP,
  });

  ok(augment["general-motors"], "GM present");
  eq(augment["general-motors"].breaches.count, 3, "GM aggregates 2 CA + 1 WA filing");
  eq(augment["general-motors"].breaches.mostRecent, "2024-06-01", "GM mostRecent is the newest across sources");
  eq(augment["general-motors"].breaches.maxAffected, 500000, "GM maxAffected from WA");
  eq(augment["general-motors"].breaches.causes, ["Ransomware"], "GM causes from WA attack type");
  ok(augment["capital-one"], "Capital One present");
  ok(augment["acxiom"] && augment["acxiom"].dataBroker.registered === true, "Acxiom broker present");
  ok(!augment["american"], "FALSE-POSITIVE GUARD: `american` NOT matched from 'American Lending Center'");
  ok(
    !(augment["general-mills"] && augment["general-mills"].breaches),
    "FALSE-POSITIVE GUARD: 'Blue Cross of California' did NOT roll up to general-mills via `blue`",
  );

  // every entry carries lastUpdated; sub-objects only when data exists
  for (const [slug, e] of Object.entries(augment)) {
    ok(typeof e.lastUpdated === "string" && e.lastUpdated.length > 0, `${slug} has lastUpdated`);
    ok(e.breaches || e.dataBroker, `${slug} has at least one signal`);
  }
  ok(stats.totalSlugCount === Object.keys(augment).length, "stats.totalSlugCount matches augment size");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
