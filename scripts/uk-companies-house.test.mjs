#!/usr/bin/env node
/**
 * Test harness for the UK Companies House pipeline (B-data9).
 *
 * Runs the response-shaping function against 3 fixture JSON files
 * (profile, officers, filing history). NO network calls.
 *
 * Locally: node scripts/uk-companies-house.test.mjs
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shape } from "./uk-companies-house-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/uk-companies-house");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}
function truthy(actual, msg) {
  if (actual) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg} (got ${JSON.stringify(actual)})`); }
}

async function loadJson(name) {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, name), "utf-8"));
}

async function main() {
  console.log("UK Companies House — shape() tests against 3 fixtures");

  const profile  = await loadJson("tesco-profile.json");
  const officers = await loadJson("tesco-officers.json");
  const filings  = await loadJson("tesco-filing-history.json");

  const target = { slug: "tesco", name: "Tesco PLC", company_number: "00445790" };
  const shaped = shape(target, profile, officers, filings);

  eq(shaped.slug, "tesco", "slug preserved");
  eq(shaped.status, "ok", "status ok");
  eq(shaped.company_number, "00445790", "company_number passes through");
  eq(shaped.incorporated, "1947-11-27", "incorporated date from date_of_creation");
  eq(shaped.company_status, "active", "company_status");
  eq(shaped.company_type, "plc", "company_type");
  eq(Array.isArray(shaped.sic_codes), true, "sic_codes is array");
  eq(shaped.sic_codes.length, 2, "2 SIC codes from fixture");
  eq(shaped.officers.length, 3, "resigned officer filtered out (3 of 4)");
  truthy(shaped.officers.every(o => !o.resigned_on), "no resigned officers in output");
  eq(shaped.officers[0].name, "MURPHY, Kenneth John", "first officer name");
  eq(shaped.officers[0].role, "director", "first officer role");
  eq(shaped.latest_filing_date, "2026-05-21", "latest filing date pulled");
  truthy(shaped.registered_office_address.includes("Welwyn Garden City"), "address includes locality");
  truthy(shaped.source_url.endsWith("00445790"), "source_url targets CH number");

  // Empty input safety
  const empty = shape(target, {}, { items: [] }, { items: [] });
  eq(empty.status, "ok", "empty inputs still produce a shaped record");
  eq(empty.officers.length, 0, "empty officers list");
  eq(empty.sic_codes.length, 0, "empty sic_codes list");
  eq(empty.latest_filing_date, null, "no latest filing -> null");

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
