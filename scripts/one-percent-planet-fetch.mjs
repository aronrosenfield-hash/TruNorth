#!/usr/bin/env node
/**
 * DW-12 — 1% for the Planet member directory — quarterly.
 *
 * 1% for the Planet is a global network of businesses that commit to
 * donating at least 1% of annual revenue to environmental causes. The
 * member directory:
 *
 *   Landing: https://www.onepercentfortheplanet.org/businesses
 *   API:     https://www.onepercentfortheplanet.org/api/businesses/search
 *            (undocumented JSON endpoint backing the directory UI;
 *            paginates via ?page=N&pageSize=50 and returns the same
 *            shape as the fixture below)
 *
 * No API key today, but the org does maintain a partner-tier API behind
 * an auth token. If we ever need higher throughput or category filters:
 *
 *   export ONEPERCENT_API_TOKEN=... # request at partners@onepercentfortheplanet.org
 *
 * For the scaffolded pipeline we read the bundled fixture by default and
 * call the public search endpoint when --live is passed.
 *
 * Output:
 *   data/raw/one-percent-planet/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --limit N
 *   --out PATH
 *   --fixture   (default in CI to keep deterministic; flip to --live to
 *                exercise the network path)
 *   --live      hit the network
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayUTC } from "./lib/csv-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/one-percent-planet");
const FIXTURE = path.join(__dirname, "fixtures/one-percent-planet/sample.json");

export const SEARCH_URL = "https://www.onepercentfortheplanet.org/api/businesses/search";
const UA = "TruNorth-OnePercent/1.0 (+https://www.trunorthapp.com)";
const API_TOKEN = process.env.ONEPERCENT_API_TOKEN; // optional

export function normalizeMember(m) {
  return {
    business_name: (m.business_name || m.name || m.businessName || "").trim(),
    country: (m.country || m.countryName || "").trim(),
    member_since: String(m.member_since || m.memberSince || m.joined_year || "").trim() || null,
    category: (m.category || m.industry || m.businessCategory || "").trim(),
  };
}

export function buildSnapshot(members) {
  const byCategory = {};
  const byCountry = {};
  for (const m of members) {
    if (m.category) byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    if (m.country) byCountry[m.country] = (byCountry[m.country] || 0) + 1;
  }
  return {
    source: "one-percent-planet",
    source_url: "https://www.onepercentfortheplanet.org/businesses",
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    member_count: members.length,
    by_category: byCategory,
    by_country: byCountry,
    members,
  };
}

async function fetchAllLive() {
  const all = [];
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  if (API_TOKEN) headers["Authorization"] = `Bearer ${API_TOKEN}`;
  let page = 1;
  const PAGE_SIZE = 50;
  while (page <= 200) { // hard cap — ~10k members possible
    const url = `${SEARCH_URL}?page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`onepercent ${res.status} on page ${page}`);
    const data = await res.json();
    const batch = data.results || data.businesses || [];
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

function parseArgs(argv) {
  const out = { limit: null, outPath: null, fixture: true, live: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--out") out.outPath = argv[++i];
    else if (argv[i] === "--fixture") out.fixture = true;
    else if (argv[i] === "--live") { out.live = true; out.fixture = false; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`1% for the Planet fetcher starting... (${args.live ? "LIVE" : "FIXTURE"})`);

  let members = [];
  if (args.live) {
    try {
      const raw = await fetchAllLive();
      members = raw.map(normalizeMember);
    } catch (err) {
      console.warn(`Live fetch failed (${err.message}) — falling back to fixture.`);
      const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
      members = (seed.results || []).map(normalizeMember);
    }
  } else {
    const seed = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    members = (seed.results || []).map(normalizeMember);
  }

  if (args.limit && args.limit > 0) members = members.slice(0, args.limit);

  const snap = buildSnapshot(members);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.outPath || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath} (${snap.member_count} members)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("one-percent-planet-fetch failed:", err);
    process.exit(1);
  });
}
