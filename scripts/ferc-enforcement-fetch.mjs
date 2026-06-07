#!/usr/bin/env node
/**
 * DW-9 — FERC enforcement actions (civil penalties, market manipulation,
 * pipeline safety) — monthly.
 *
 * FERC's enforcement section publishes:
 *   1. A press-release RSS feed:  https://www.ferc.gov/news-events/news/rss.xml
 *      (general — we filter by category=Enforcement)
 *   2. A Civil Penalty Actions index page:
 *      https://www.ferc.gov/enforcement-legal/enforcement/civil-penalty-actions
 *      (HTML — Cloudflare-protected, frequently 403s)
 *   3. An annual Reports on Enforcement PDF:
 *      https://www.ferc.gov/enforcement-legal/enforcement/annual-reports
 *
 * For the scheduled pipeline we try the RSS first (no auth, lightweight),
 * fall back to a curated JSON seed (see scripts/fixtures/ferc-enforcement
 * /sample.json — same shape as the production seed we'd ship). The
 * structured shape we emit:
 *
 *   { docket, company, violation, civil_penalty_usd, disgorgement_usd, date, url }
 *
 * Output:
 *   data/raw/ferc-enforcement/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N
 *   --out PATH
 *   --fixture       use scripts/fixtures/ferc-enforcement/sample.json
 *   --rss           force the RSS path (otherwise we fall back if RSS fails)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ferc-enforcement");
const FIXTURE = path.join(__dirname, "fixtures/ferc-enforcement/sample.json");

export const RSS_URL = "https://www.ferc.gov/news-events/news/rss.xml";
export const INDEX_URL = "https://www.ferc.gov/enforcement-legal/enforcement/civil-penalty-actions";
const UA = "TruNorth-FERC/1.0 (+https://www.trunorthapp.com)";

/**
 * Minimal RSS <item> extractor — handles <item>…</item> blocks and pulls
 * <title>, <link>, <pubDate>, <description>, <category>. CDATA-aware.
 */
export function parseRssItems(xml) {
  if (typeof xml !== "string") return [];
  const items = [];
  const blockRe = /<item[\s>][\s\S]*?<\/item>/g;
  const blocks = xml.match(blockRe) || [];
  for (const block of blocks) {
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      pubDate: extractTag(block, "pubDate"),
      description: extractTag(block, "description"),
      category: extractTag(block, "category"),
    });
  }
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  let v = m[1].trim();
  // Unwrap CDATA
  v = v.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  // Cheap entity decode
  v = v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return v;
}

/** "Wed, 19 Mar 2024 14:00:00 GMT" → "2024-03-19" (best-effort). */
export function rssDateToISO(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Map RSS item → enforcement-action shape. We pull out a civil penalty
 * USD if the description contains "$X million/$X" — pure best-effort.
 */
export function rssItemToAction(item) {
  const desc = item.description || "";
  const penaltyMatch = desc.match(/\$([\d,.]+)\s*(million|m|billion|b)?/i);
  let penalty = 0;
  if (penaltyMatch) {
    const n = Number(penaltyMatch[1].replace(/,/g, ""));
    const unit = (penaltyMatch[2] || "").toLowerCase();
    penalty = unit.startsWith("b") ? n * 1e9 : unit.startsWith("m") ? n * 1e6 : n;
  }
  return {
    docket: "",
    company: item.title || "",
    violation: stripHtml(desc).slice(0, 280),
    civil_penalty_usd: Math.round(penalty),
    disgorgement_usd: 0,
    date: rssDateToISO(item.pubDate),
    url: item.link || INDEX_URL,
  };
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function buildSnapshot(actions) {
  const total = actions.reduce((s, a) => s + (a.civil_penalty_usd || 0), 0);
  return {
    source: "ferc-enforcement",
    source_url: INDEX_URL,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    action_count: actions.length,
    total_civil_penalty_usd: total,
    actions,
  };
}

async function fetchRss() {
  const res = await fetch(RSS_URL, { headers: { "User-Agent": UA, "Accept": "application/rss+xml" } });
  if (!res.ok) throw new Error(`FERC RSS ${res.status} ${res.statusText}`);
  return res.text();
}

function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: false, rssOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--fixture") out.fixture = true;
    else if (argv[i] === "--rss") out.rssOnly = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`FERC enforcement fetcher starting... (${args.fixture ? "FIXTURE" : "LIVE"})`);

  let actions = [];

  if (args.fixture) {
    const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    actions = seed.items || [];
  } else {
    try {
      const xml = await fetchRss();
      const items = parseRssItems(xml).filter(it =>
        /enforce|civil penalty|market manipulation|pipeline safety/i.test(it.title + " " + (it.category || ""))
      );
      actions = items.map(rssItemToAction);
      if (actions.length === 0 && !args.rssOnly) {
        console.warn("RSS returned 0 enforcement items — falling back to bundled seed.");
        const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
        actions = seed.items || [];
      }
    } catch (err) {
      if (args.rssOnly) throw err;
      console.warn(`RSS fetch failed (${err.message}) — falling back to bundled seed.`);
      const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
      actions = seed.items || [];
    }
  }

  if (args.limit && args.limit > 0) actions = actions.slice(0, args.limit);

  const snap = buildSnapshot(actions);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap.action_count} actions, $${(snap.total_civil_penalty_usd/1e6).toFixed(1)}M total)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ferc-enforcement-fetch failed:", err);
    process.exit(1);
  });
}
