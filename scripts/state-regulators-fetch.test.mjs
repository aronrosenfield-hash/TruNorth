#!/usr/bin/env node
/**
 * Unit tests for state-regulators-fetch.mjs parsers.
 * Run: node scripts/state-regulators-fetch.test.mjs
 */

import assert from "node:assert/strict";
import {
  parseDollarAmount,
  mineDefendants,
  parseNyAgDetail,
  parseTxAgDetail,
  parseTxAgList,
  parseNyDfsList,
} from "./state-regulators-fetch.mjs";

/* ─── parseDollarAmount ───────────────────────────────────────────── */

assert.equal(parseDollarAmount("$3.97 million"),    3_970_000);
assert.equal(parseDollarAmount("$1.2 billion"),     1_200_000_000);
assert.equal(parseDollarAmount("$50,000 in fines"), 50_000);
assert.equal(parseDollarAmount("no dollar amount"), null);
// pick largest of multiple
assert.equal(parseDollarAmount("paid $25 million and recovered $700 million"), 700_000_000);
console.log("✓ parseDollarAmount");

/* ─── mineDefendants ──────────────────────────────────────────────── */

const found = mineDefendants(
  "Attorney General James reached an agreement with Equifax Inc. and JUUL Labs, Inc. to settle the matter."
);
assert.ok(found.some(s => /Equifax/.test(s)), `Equifax not found: ${found.join(",")}`);
assert.ok(found.some(s => /JUUL/.test(s)), `JUUL not found: ${found.join(",")}`);
console.log("✓ mineDefendants");

/* ─── parseNyAgDetail ─────────────────────────────────────────────── */

const NYAG_HTML = `
<html><head>
  <title>AG James Secures $3.97 Million from Xponential | NY AG</title>
  <meta property="article:published_time" content="2026-06-09T10:00:00-04:00"/>
</head><body>
<h1>Attorney General James Secures More Than $3.97 Million from Xponential Fitness for Misleading Franchise Owners</h1>
<article>
  <p>NEW YORK – New York Attorney General Letitia James today announced that the
  Office of the Attorney General (OAG) has secured its largest ever financial
  settlement related to violations of New York's Franchise Sales Act. Following
  an OAG investigation, California-based fitness studio company Xponential
  Fitness, Inc. will pay $3,971,250 for illegally misleading small business
  owners.</p>
</article>
</body></html>
`;
const rec = parseNyAgDetail(NYAG_HTML, "https://ag.ny.gov/press-release/2026/test");
assert.equal(rec.source, "ny-ag");
assert.equal(rec.date, "2026-06-09");
assert.equal(rec.category, "consumer-protection");
assert.ok(rec.defendants.some(d => /Xponential/i.test(d)), `defendants: ${JSON.stringify(rec.defendants)}`);
assert.ok(rec.amountUsd >= 3_971_000 && rec.amountUsd <= 4_000_000, `amount: ${rec.amountUsd}`);
console.log("✓ parseNyAgDetail");

/* ─── parseTxAgDetail ─────────────────────────────────────────────── */

const TXAG_HTML = `
<html><head>
  <title>Paxton Investigates FIFA | TX AG</title>
  <meta name="description" content="Attorney General Ken Paxton launched an investigation into the Fédération Internationale de Football Association (FIFA) over allegations that the organization misled fans regarding seat pricing for the 2026 World Cup."/>
  <meta property="article:published_time" content="2026-05-01T09:00:00Z"/>
</head><body>
<h1>Attorney General Ken Paxton Investigates FIFA to Ensure Fans Have Access to Accurate and Honest Pricing</h1>
<main>
<div class="field--name-body"><p>Paxton announces investigation into FIFA over misleading pricing.</p></div>
</main>
</body></html>
`;
const tx = parseTxAgDetail(TXAG_HTML, "https://www.texasattorneygeneral.gov/news/releases/test");
assert.equal(tx.source, "tx-ag");
assert.equal(tx.date, "2026-05-01");
assert.ok(tx.defendants.some(d => /FIFA/.test(d)), `defendants: ${JSON.stringify(tx.defendants)}`);
console.log("✓ parseTxAgDetail");

/* ─── parseTxAgList ───────────────────────────────────────────────── */

const TXAG_LIST_HTML = `
<html><body>
<div class="main-content-wysiwyg-container">
  <div class="m-b-3">
    <h4 class="m-b-1 h4-sans"><a href="/news/releases/attorney-general-ken-paxton-investigates-fifa-pricing">Attor­ney Gen­er­al Ken Pax­ton Inves­ti­gates FIFA over Pricing</a></h4>
    <p class="m-b-0">Paxton announced an investigation into FIFA over ticket pricing for the 2026 World Cup.</p>
    <p class="meta m-b-0">June 09, 2026  | Press Release</p>
  </div>
</div>
</body></html>
`;
const txList = parseTxAgList(TXAG_LIST_HTML);
assert.equal(txList.length, 1);
assert.equal(txList[0].date, "2026-06-09");
assert.equal(txList[0].source, "tx-ag");
assert.ok(txList[0].defendants.some(d => /FIFA/.test(d)), `txList defendants: ${JSON.stringify(txList[0].defendants)}`);
// Soft-hyphens stripped from title
assert.ok(!txList[0].caseTitle.includes("­"), `soft-hyphens leaked: ${txList[0].caseTitle}`);
console.log("✓ parseTxAgList");

/* ─── parseNyDfsList ──────────────────────────────────────────────── */

const NYDFS_HTML = `
<html><body>
<table>
  <tr><td>2025-04-10</td><td><a href="/industry-guidance/enforcement-discipline/ea20250410-block">Consent Order to Block, Inc.</a></td><td>$40 million penalty for AML deficiencies</td></tr>
  <tr><td>2025-01-23</td><td><a href="/industry-guidance/enforcement-discipline/ea20250123-paypal-inc">Consent Order to PayPal, Inc.</a></td></tr>
  <tr><td>2020-01-01</td><td><a href="/industry_guidance/enforcement_discipline/ea20200101_oldcase">Old Case Before Cutoff</a></td></tr>
  <tr><td>n/a</td><td><a href="/industry-guidance/enforcement-discipline/ea20250926-notice-of-satisfaction">Notice of Satisfaction of Agreements</a></td></tr>
</table>
</body></html>
`;
const dfs = parseNyDfsList(NYDFS_HTML, "test");
const blockRec = dfs.find(r => /Block/i.test(r.defendants[0] || ""));
assert.ok(blockRec, `Block not found in: ${JSON.stringify(dfs.map(d => d.defendants))}`);
assert.equal(blockRec.date, "2025-04-10");
assert.equal(blockRec.amountUsd, 40_000_000);
assert.equal(blockRec.source, "ny-dfs");
assert.equal(blockRec.category, "financial-regulation");
const paypalRec = dfs.find(r => /PayPal/i.test(r.defendants[0] || ""));
assert.ok(paypalRec, "PayPal not found");
// Verify cutoff drops 2020 records, and Notice of Satisfaction is dropped
assert.ok(!dfs.some(r => /old case/i.test(r.caseTitle)), "Old case should be filtered");
assert.ok(!dfs.some(r => /notice of satisfaction/i.test(r.defendants[0] || "")), "Notice of Satisfaction should be dropped");
console.log("✓ parseNyDfsList");

console.log("\nAll parser tests pass.");
