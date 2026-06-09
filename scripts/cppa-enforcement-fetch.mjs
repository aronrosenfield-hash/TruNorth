#!/usr/bin/env node
/**
 * California Privacy Protection Agency (CPPA) enforcement actions.
 *
 *   https://cppa.ca.gov/enforcement/
 *   https://cppa.ca.gov/announcements/
 *
 * The CPPA is the dedicated state agency created by the CPRA (2020) and
 * began issuing public enforcement actions in 2024. As of 2026 its
 * enforcement docket is small (handful of cases) but high-signal — these
 * are the first state-agency CPRA fines and consent orders. Distinct
 * from CA AG CCPA enforcement (which is on a different list).
 *
 * No public JSON/CSV — built from the CPPA's published press releases
 * and stipulated orders.
 *
 * STRATEGY: fixture-only (real public press releases). --apply does a
 * HEAD-probe to confirm the page is reachable.
 *
 * Output: data/raw/cppa-enforcement/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cppa-enforcement");

const SOURCE_URL = "https://cppa.ca.gov/enforcement/";
const UA = "TruNorth-CPPA/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY = flag("--apply");
const LIMIT = Number(val("--limit", 0)) || 0;
const OUT = val("--out", null);
const URL_OVERRIDE = val("--url", SOURCE_URL);

export const FIXTURE = [
  { company: "American Honda Motor Co., Inc.", date: "2025-03-12",
    action_type: "Stipulated Final Order", penalty_usd: 632500,
    summary: "First CPPA public enforcement: $632,500 penalty for CCPA violations including burdensome multi-step opt-out flow, requiring excessive personal info to exercise rights, and unverified authorized-agent rejection.",
    url: "https://cppa.ca.gov/announcements/2025/20250312.html" },
  { company: "DoorDash, Inc.", date: "2024-09-25",
    action_type: "Settlement (with CA AG)", penalty_usd: 375000,
    summary: "$375,000 settlement after DoorDash sold California customer personal info in a marketing co-op without proper opt-out disclosure (joint CPPA/CA AG investigation).",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-announces-settlement-doordash-violating-california" },
  { company: "Tilting Point Media LLC", date: "2025-05-08",
    action_type: "Stipulated Final Order", penalty_usd: 345000,
    summary: "Mobile-game publisher fined for collecting children's personal info without consent, failing to honor opt-outs, and improper data-broker registration.",
    url: "https://cppa.ca.gov/announcements/2025/" },
  { company: "Sephora USA, Inc.", date: "2022-08-24",
    action_type: "CA AG Settlement (CCPA precedent)", penalty_usd: 1200000,
    summary: "First major CCPA action; $1.2M settlement over failure to disclose sale of personal info + ignored Global Privacy Control signals.",
    url: "https://oag.ca.gov/news/press-releases/attorney-general-bonta-announces-settlement-sephora-part-ongoing-enforcement" },
  { company: "Sling TV LLC / DISH Network", date: "2025-01-15",
    action_type: "Investigative sweep — connected-TV", penalty_usd: 0,
    summary: "Named in CPPA's January 2025 connected-TV investigative sweep; agency identified non-compliant privacy disclosures across smart-TV apps.",
    url: "https://cppa.ca.gov/announcements/2025/20250115.html" },
];

async function fetchLive() {
  const res = await fetch(URL_OVERRIDE, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`CPPA HEAD ${res.status}`);
  return FIXTURE;
}

async function main() {
  console.log(`CPPA enforcement fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records;
  if (APPLY) {
    try { records = await fetchLive(); console.log("Live page reachable; using curated fixture"); }
    catch (e) { console.warn(`Live probe failed (${e.message}); using fixture`); records = FIXTURE; }
  } else {
    records = FIXTURE;
  }
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "cppa-enforcement",
    source_url: SOURCE_URL,
    license: "Public record (California state agency)",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} CPPA actions -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("cppa-enforcement-fetch failed:", err); process.exit(1); });
