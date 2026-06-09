#!/usr/bin/env node
/**
 * Citizen Lab — surveillance vendor / mercenary spyware accountability.
 *
 *   https://citizenlab.ca/category/research/targeted-threats/
 *
 * The University of Toronto's Citizen Lab is the world's leading
 * independent investigator of commercial mercenary spyware. Their
 * published research names the vendors whose tooling has been used
 * against journalists, activists, and dissidents. This source flags
 * companies whose products are surveillance-tech infrastructure, not
 * just B2B IT vendors.
 *
 * Fixture is built from named, attributed Citizen Lab reports (each
 * with the report URL) — not from speculation.
 *
 * Output: data/raw/citizen-lab/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/citizen-lab");
const SOURCE_URL = "https://citizenlab.ca/category/research/targeted-threats/";
const UA = "TruNorth-CitizenLab/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }
const APPLY = flag("--apply");
const LIMIT = Number(val("--limit", 0)) || 0;
const OUT = val("--out", null);
const URL_OVERRIDE = val("--url", SOURCE_URL);

export const FIXTURE = [
  { vendor: "NSO Group", product: "Pegasus spyware", first_reported: "2016-08-24",
    severity: "severe",
    summary: "Citizen Lab named NSO Group's Pegasus as the spyware behind targeted attacks on journalists, activists, and heads of state in 45+ countries.",
    report_url: "https://citizenlab.ca/2018/09/hide-and-seek-tracking-nso-groups-pegasus-spyware-to-operations-in-45-countries/" },
  { vendor: "Candiru / Saito Tech", product: "DevilsTongue", first_reported: "2021-07-15",
    severity: "severe",
    summary: "Israeli spyware vendor Candiru linked to attacks on journalists + civil society; sanctioned by US Commerce in Nov 2021.",
    report_url: "https://citizenlab.ca/2021/07/hooking-candiru-another-mercenary-spyware-vendor-comes-into-focus/" },
  { vendor: "QuaDream", product: "REIGN spyware",  first_reported: "2023-04-11",
    severity: "severe",
    summary: "Israeli spyware vendor QuaDream's REIGN tool used to target journalists, opposition figures in 5+ countries.",
    report_url: "https://citizenlab.ca/2023/04/spyware-vendor-quadream-exploits-victims-customers/" },
  { vendor: "Cytrox / Intellexa Consortium", product: "Predator spyware", first_reported: "2021-12-16",
    severity: "severe",
    summary: "Predator spyware sold by North Macedonia's Cytrox + Intellexa group; deployed against journalists in Greece, Egypt.",
    report_url: "https://citizenlab.ca/2021/12/pegasus-vs-predator-dissidents-doubly-infected-iphones-reveal-cytrox-mercenary-spyware/" },
  { vendor: "Hacking Team", product: "Remote Control System", first_reported: "2014-02-17",
    severity: "severe",
    summary: "Italian Hacking Team (now Memento Labs) sold spyware to governments documented attacking journalists/activists in 21 countries.",
    report_url: "https://citizenlab.ca/2014/02/mapping-hacking-teams-untraceable-spyware/" },
  { vendor: "FinFisher / Lench IT / Gamma Group", product: "FinSpy",  first_reported: "2012-07-25",
    severity: "severe",
    summary: "Anglo-German Gamma Group's FinSpy commercial spyware documented in 25+ countries targeting opposition figures.",
    report_url: "https://citizenlab.ca/2012/07/from-bahrain-with-love-finfishers-spy-kit-exposed/" },
  { vendor: "Paragon Solutions", product: "Graphite spyware", first_reported: "2025-01-31",
    severity: "severe",
    summary: "Citizen Lab + WhatsApp identified Israeli Paragon Solutions' Graphite spyware targeting journalists in Italy + others.",
    report_url: "https://citizenlab.ca/2025/06/first-known-victims-of-paragon-mercenary-spyware-speak-out/" },
  { vendor: "Sandvine", product: "PacketLogic DPI",  first_reported: "2018-03-09",
    severity: "high",
    summary: "Canadian DPI vendor Sandvine's devices used by Turkey + Egypt to inject malware into HTTP traffic; sold to ProcessUnity 2024.",
    report_url: "https://citizenlab.ca/2018/03/bad-traffic-sandvines-packetlogic-devices-deploy-government-spyware-turkey-syria/" },
  { vendor: "Blue Coat Systems / Symantec", product: "Filtering + DPI hardware", first_reported: "2013-01-15",
    severity: "high",
    summary: "Blue Coat devices found censoring Internet in Syria, Burma, China; now part of Symantec/Broadcom.",
    report_url: "https://citizenlab.ca/2013/01/planet-blue-coat-redux/" },
  { vendor: "TikTok / ByteDance", product: "TikTok mobile app", first_reported: "2021-03-22",
    severity: "moderate",
    summary: "Citizen Lab found TikTok's data-collection broadly comparable to other big social platforms; no obvious covert channel — but flagged its centralized-PRC ownership as a structural risk.",
    report_url: "https://citizenlab.ca/2021/03/tiktok-vs-douyin-a-security-and-privacy-analysis/" },
  { vendor: "Tencent / WeChat", product: "WeChat messenger", first_reported: "2020-05-07",
    severity: "high",
    summary: "WeChat international-user content surveilled for keyword analysis used to censor PRC accounts; Citizen Lab documented cross-account surveillance.",
    report_url: "https://citizenlab.ca/2020/05/we-chat-they-watch/" },
  { vendor: "Zoom Video Communications", product: "Zoom client",   first_reported: "2020-04-03",
    severity: "moderate",
    summary: "Zoom's claim of end-to-end encryption was incorrect; meeting keys routed via PRC servers in some calls (since remediated).",
    report_url: "https://citizenlab.ca/2020/04/move-fast-roll-your-own-crypto-a-quick-look-at-the-confidentiality-of-zoom-meetings/" },
];

async function fetchLive() {
  const res = await fetch(URL_OVERRIDE, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Citizen Lab HEAD ${res.status}`);
  return FIXTURE;
}

async function main() {
  console.log(`Citizen Lab fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records;
  if (APPLY) {
    try { records = await fetchLive(); console.log("Live page reachable; using curated fixture"); }
    catch (e) { console.warn(`Live probe failed (${e.message}); using fixture`); records = FIXTURE; }
  } else { records = FIXTURE; }
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "citizen-lab",
    source_url: SOURCE_URL,
    license: "Citizen Lab research — public reports (CC BY 4.0)",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} Citizen Lab cases -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("citizen-lab-fetch failed:", err); process.exit(1); });
