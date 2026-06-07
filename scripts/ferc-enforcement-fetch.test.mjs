#!/usr/bin/env node
/**
 * node --test scripts/ferc-enforcement-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseRssItems, rssDateToISO, rssItemToAction, buildSnapshot,
} from "./ferc-enforcement-fetch.mjs";
import {
  buildAliasIndex, matchCompany, aggregateForSlug,
} from "./ferc-enforcement-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/ferc-enforcement/sample.json");

test("parseRssItems extracts items + CDATA", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>FERC fines BP $20M</title><link>https://x</link>
      <pubDate>Wed, 19 Mar 2024 14:00:00 GMT</pubDate>
      <description><![CDATA[<p>Civil penalty of $20 million for market manipulation.</p>]]></description>
      <category>Enforcement</category></item>
    <item><title>FERC docs released</title><link>https://y</link>
      <pubDate>Mon, 01 Apr 2024 00:00:00 GMT</pubDate>
      <description>routine filings</description></item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "FERC fines BP $20M");
  assert.ok(items[0].description.includes("$20 million"));
  assert.equal(items[0].category, "Enforcement");
});

test("rssDateToISO normalises RFC822 → YYYY-MM-DD", () => {
  assert.equal(rssDateToISO("Wed, 19 Mar 2024 14:00:00 GMT"), "2024-03-19");
  assert.equal(rssDateToISO(""), null);
});

test("rssItemToAction extracts $ million penalty", () => {
  const a = rssItemToAction({
    title: "FERC fines BP",
    description: "Civil penalty of $20 million for market manipulation.",
    pubDate: "Wed, 19 Mar 2024 14:00:00 GMT",
    link: "https://x",
  });
  assert.equal(a.civil_penalty_usd, 20000000);
  assert.equal(a.date, "2024-03-19");
  assert.ok(a.violation.includes("market manipulation"));
});

test("buildSnapshot sums civil penalties", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const snap = buildSnapshot(seed.items);
  assert.equal(snap.action_count, 4);
  assert.equal(snap.total_civil_penalty_usd, 213600000 + 20000000 + 1500000 + 750000);
});

test("aggregateForSlug rolls up actions by penalty", async () => {
  const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const etActions = seed.items.filter(a => /energy transfer|etc tiger/i.test(a.company));
  const agg = aggregateForSlug("energy-transfer", etActions, "https://www.ferc.gov/...");
  assert.equal(agg.action_count, 2);
  assert.equal(agg.total_civil_penalty_usd, 1500000 + 750000);
  assert.equal(agg.recent_top5[0].docket, "IN16-3-000");
  assert.equal(agg.earliest_action, "2016-11-18");
  assert.equal(agg.latest_action, "2020-05-21");
});

test("matchCompany finds BP via alias map", () => {
  const idx = buildAliasIndex(["bp"], { bp: { aliases: ["BP America Inc."] } });
  assert.equal(matchCompany("BP America Inc.", idx), "bp");
});
