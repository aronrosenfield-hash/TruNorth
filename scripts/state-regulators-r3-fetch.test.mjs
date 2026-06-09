#!/usr/bin/env node
/**
 * Parser unit tests for state-regulators-r3-fetch.mjs.
 * Run: node scripts/state-regulators-r3-fetch.test.mjs
 */

import assert from "node:assert/strict";
import {
  parseDollarAmount,
  mineDefendants,
  defendantFromTitle,
  parseCaAgList,
  parseCppaList,
  parseFlAgList,
  parseIlAgList,
  parseWaAgRss,
  parseOhAgList,
  parsePaAgList,
  parseNjAgRss,
  parseGaAgList,
  parseNcAgList,
} from "./state-regulators-r3-fetch.mjs";

/* ─── parseDollarAmount ───────────────────────────────────────────── */
assert.equal(parseDollarAmount("$3.97 million"),    3_970_000);
assert.equal(parseDollarAmount("$1.35M penalty"),   1_350_000);
assert.equal(parseDollarAmount("no money mentioned"), null);
console.log("✓ parseDollarAmount");

/* ─── defendantFromTitle ─────────────────────────────────────────── */
assert.match(defendantFromTitle("Carr: Laboratory Owner Faces Criminal Charges and Civil Complaint for Genetic Testing Fraud") || "", /Laboratory Owner/);
const ftd = defendantFromTitle("Attorney General Bonta Sues Equifax Inc. Over Data Breach");
assert.ok(ftd && /Equifax/.test(ftd), `got: ${ftd}`);
console.log("✓ defendantFromTitle");

/* ─── parseCaAgList ──────────────────────────────────────────────── */
const CA_HTML = `<div class="view-content">
  <div class="views-row views-row-1 panel-body">
    <div class="views-field views-field-title">
      <span class="field-content"><a href="/news/press-releases/attorney-general-bonta-sues-meta-platforms">Attorney General Bonta Sues Meta Platforms over Privacy Violations</a></span>
    </div>
    <div class="views-field views-field-field-release-date">
      <div class="field-content"><span property="dc:date" datatype="xsd:dateTime" content="2026-06-01T00:00:00-07:00" class="date-display-single">June 1, 2026</span></div>
    </div>
  </div>
</div>`;
const caRecs = parseCaAgList(CA_HTML);
assert.equal(caRecs.length, 1);
assert.equal(caRecs[0].source, "ca-ag");
assert.equal(caRecs[0].date, "2026-06-01");
assert.ok(/Meta/.test(caRecs[0].defendants[0] || ""), `defendants: ${JSON.stringify(caRecs[0].defendants)}`);
assert.equal(caRecs[0].category, "consumer-protection");
console.log("✓ parseCaAgList");

/* ─── parseCppaList ──────────────────────────────────────────────── */
const CPPA_HTML = `<ul>
  <li><a href="2025/20250930.html">Nation's Largest Rural Lifestyle Retailer to Pay $1.35M Over CCPA Violations</a></li>
  <li><a href="2025/20251217.html">CalPrivacy Issues Enforcement Advisory Highlighting Data Broker Registration</a></li>
  <li><a href="2020/20200101.html">Old action before cutoff to ensure year filter works enforcement settle</a></li>
  <li><a href="2025/20251008.html">Minnesota and New Hampshire Join Bipartisan Consortium</a></li>
</ul>`;
const cppaRecs = parseCppaList(CPPA_HTML);
// Enforcement-flavored items should pass; Minnesota/NH join is excluded.
assert.ok(cppaRecs.some(r => /Rural Lifestyle/i.test(r.caseTitle)), `got: ${JSON.stringify(cppaRecs.map(r=>r.caseTitle))}`);
assert.ok(cppaRecs.some(r => /Enforcement Advisory/i.test(r.caseTitle)));
assert.ok(!cppaRecs.some(r => /Minnesota and New Hampshire/i.test(r.caseTitle)), "non-enforcement filtered");
assert.ok(!cppaRecs.some(r => /Old action/i.test(r.caseTitle)), "year cutoff respected");
const rural = cppaRecs.find(r => /Rural Lifestyle/i.test(r.caseTitle));
assert.equal(rural.date, "2025-09-30");
assert.equal(rural.amountUsd, 1_350_000);
console.log("✓ parseCppaList");

/* ─── parseFlAgList ──────────────────────────────────────────────── */
const FL_HTML = `<div class="item">
  <a href="/newsrelease/attorney-general-james-uthmeier-files-first-nation-state-led-lawsuit-against-openai-ceo">Attorney General James Uthmeier Files First-in-the-Nation State-Led Lawsuit Against OpenAI, CEO Sam Altman for Deceptive Practices</a>
  <span>June 1, 2026</span>
</div>`;
const flRecs = parseFlAgList(FL_HTML);
assert.equal(flRecs.length, 1);
assert.equal(flRecs[0].date, "2026-06-01");
assert.ok(/OpenAI/.test(flRecs[0].defendants[0] || ""), `defendants: ${JSON.stringify(flRecs[0].defendants)}`);
console.log("✓ parseFlAgList");

/* ─── parseIlAgList ──────────────────────────────────────────────── */
const IL_HTML = `<div>
  <a class="news-item" href="/news/story/attorney-general-raoul-sues-amazon-com-over-deceptive-pricing"
     aria-label="June 08, 2026 - ATTORNEY GENERAL RAOUL SUES AMAZON.COM OVER DECEPTIVE PRICING">
    <time datetime="2026-06-08 3:30 PM">June 08, 2026</time>
    <p>ATTORNEY GENERAL RAOUL SUES AMAZON.COM OVER DECEPTIVE PRICING</p>
  </a>
</div>`;
const ilRecs = parseIlAgList(IL_HTML);
assert.equal(ilRecs.length, 1);
assert.equal(ilRecs[0].date, "2026-06-08");
assert.ok(/AMAZON/i.test(ilRecs[0].defendants[0] || ""), `defendants: ${JSON.stringify(ilRecs[0].defendants)}`);
console.log("✓ parseIlAgList");

/* ─── parseWaAgRss ───────────────────────────────────────────────── */
const WA_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item>
    <title>AG Brown sues T-Mobile USA, Inc. over alleged data breach affecting Washingtonians</title>
    <link>https://www.atg.wa.gov/news/news-releases/ag-brown-sues-tmobile</link>
    <pubDate>Mon, 02 Jun 2026 10:00:00 +0000</pubDate>
    <description>Action against T-Mobile USA, Inc. seeking $50 million in penalties.</description>
  </item>
</channel></rss>`;
const waRecs = parseWaAgRss(WA_RSS);
assert.equal(waRecs.length, 1);
assert.equal(waRecs[0].date, "2026-06-02");
assert.ok(/T-Mobile/.test(waRecs[0].defendants[0] || ""), `defendants: ${JSON.stringify(waRecs[0].defendants)}`);
assert.equal(waRecs[0].amountUsd, 50_000_000);
console.log("✓ parseWaAgRss");

/* ─── parseOhAgList ──────────────────────────────────────────────── */
const OH_HTML = `<div class="ohio-news">
  <h2 class="h3"><a href="/Media/News-Releases/June-2026/Yost-Sues-Ambulance-Company-Over-Deceptive-Billing">Yost Sues Ambulance Company Over Deceptive Billing Practices</a></h2>
  <div class="news-summary"><p>Filed against Falck USA, Inc. alleging $12 million in overcharges.</p></div>
  <div class="news-date">6/5/2026</div>
</div>`;
const ohRecs = parseOhAgList(OH_HTML);
assert.equal(ohRecs.length, 1);
assert.equal(ohRecs[0].date, "2026-06-05");
assert.ok(/Falck/.test((ohRecs[0].defendants[0] || "") + (ohRecs[0].defendants[1] || "")), `defendants: ${JSON.stringify(ohRecs[0].defendants)}`);
assert.equal(ohRecs[0].amountUsd, 12_000_000);
console.log("✓ parseOhAgList");

/* ─── parsePaAgList ──────────────────────────────────────────────── */
const PA_HTML = `<article>
  <h2><a href="https://www.attorneygeneral.gov/taking-action/ag-sundays-environmental-crimes-section-charges-company-with-franklin-county-waste-spill/">AG Sunday's Environmental Crimes Section Charges Company with Franklin County Waste Spill</a></h2>
  <span class="date">06/03/2026</span>
</article>`;
const paRecs = parsePaAgList(PA_HTML);
assert.ok(paRecs.length >= 1, `got: ${JSON.stringify(paRecs)}`);
assert.ok(paRecs[0].sourceUrl.includes("franklin-county-waste-spill"));
console.log("✓ parsePaAgList");

/* ─── parseNjAgRss ───────────────────────────────────────────────── */
const NJ_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item>
    <title>NJ Bureau of Securities Sues XYZ Capital LLC for Investor Fraud</title>
    <link>https://www.njoag.gov/nj-bureau-sues-xyz-capital</link>
    <pubDate>Mon, 04 Jun 2026 10:00:00 +0000</pubDate>
    <description>Sued XYZ Capital LLC for defrauding investors of $2.5 million.</description>
  </item>
</channel></rss>`;
const njRecs = parseNjAgRss(NJ_RSS);
assert.equal(njRecs.length, 1);
assert.equal(njRecs[0].date, "2026-06-04");
assert.ok(njRecs[0].defendants.some(d => /XYZ Capital/i.test(d)), `defendants: ${JSON.stringify(njRecs[0].defendants)}`);
console.log("✓ parseNjAgRss");

/* ─── parseGaAgList ──────────────────────────────────────────────── */
const GA_HTML = `<a href="/press-releases/2026-06-05/carr-laboratory-owner-faces-criminal-charges">
  <h2 class="global-teaser__title">Carr: Laboratory Owner Faces Criminal Charges and Civil Complaint for Genetic Testing Fraud</h2>
  <div class="global-teaser__description">June 05, 2026</div>
</a>`;
const gaRecs = parseGaAgList(GA_HTML);
assert.equal(gaRecs.length, 1);
assert.equal(gaRecs[0].date, "2026-06-05");
assert.ok(/Laboratory Owner/.test(gaRecs[0].defendants[0] || ""), `defendants: ${JSON.stringify(gaRecs[0].defendants)}`);
console.log("✓ parseGaAgList");

/* ─── parseNcAgList ──────────────────────────────────────────────── */
const NC_HTML = `<article>
  <h2><a href="https://ncdoj.gov/ncdoj-ncdeq-sue-to-stop-durham-companys-contamination-of-state-waters/" rel="bookmark">NCDOJ, NCDEQ Sue to Stop Durham Company's Contamination of State Waters</a></h2>
  <time datetime="2026-06-09T10:00:00+00:00">June 9, 2026</time>
</article>`;
const ncRecs = parseNcAgList(NC_HTML);
assert.equal(ncRecs.length, 1);
assert.equal(ncRecs[0].date, "2026-06-09");
assert.equal(ncRecs[0].source, "nc-ag");
console.log("✓ parseNcAgList");

console.log("\nAll r3 parser tests pass.");
