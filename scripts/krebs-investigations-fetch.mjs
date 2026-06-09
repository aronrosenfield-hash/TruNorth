#!/usr/bin/env node
/**
 * Krebs on Security — named breach investigations archive.
 *
 *   https://krebsonsecurity.com/
 *
 * Brian Krebs is the most-cited independent breach reporter; many of
 * the most damaging consumer-brand breaches were broken on his blog
 * before the company's 8-K. This source captures the high-profile,
 * named-and-documented breaches not already in HIBP (which is the
 * aggregator) so we don't double-count, but DO surface the cases where
 * Krebs broke the story and added forensic context.
 *
 * Each fixture entry cites a specific Krebs post URL. Fixture-only.
 *
 * Output: data/raw/krebs-investigations/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/krebs-investigations");
const SOURCE_URL = "https://krebsonsecurity.com/";
const UA = "TruNorth-Krebs/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }
const APPLY = flag("--apply");
const LIMIT = Number(val("--limit", 0)) || 0;
const OUT = val("--out", null);
const URL_OVERRIDE = val("--url", SOURCE_URL);

export const FIXTURE = [
  { company: "Target", date: "2013-12-18", incident_type: "POS Malware breach",
    severity: "severe", individuals_affected: 110000000,
    summary: "Krebs broke the Target POS-malware story (Dec 2013); 110M card + customer records via HVAC-vendor credential theft.",
    url: "https://krebsonsecurity.com/2013/12/sources-target-investigating-data-breach/" },
  { company: "Home Depot", date: "2014-09-02", incident_type: "POS Malware breach",
    severity: "severe", individuals_affected: 56000000,
    summary: "Krebs broke the Home Depot breach (Sep 2014); 56M payment cards exposed via same BlackPOS variant as Target.",
    url: "https://krebsonsecurity.com/2014/09/banks-credit-card-breach-at-home-depot/" },
  { company: "Equifax", date: "2017-09-07", incident_type: "Web-app vulnerability",
    severity: "severe", individuals_affected: 147000000,
    summary: "Krebs published forensic timeline of Equifax breach (147M SSNs); first to expose insider stock-sales timing.",
    url: "https://krebsonsecurity.com/2017/09/equifax-breach-response-turns-dumpster-fire/" },
  { company: "Capital One", date: "2019-07-30", incident_type: "Cloud misconfiguration",
    severity: "severe", individuals_affected: 106000000,
    summary: "Krebs covered Capital One AWS WAF misconfig leading to 106M records exposed.",
    url: "https://krebsonsecurity.com/2019/07/capital-one-data-theft-impacts-106m-people/" },
  { company: "SolarWinds", date: "2020-12-13", incident_type: "Supply-chain compromise",
    severity: "severe", individuals_affected: 18000,
    summary: "SUNBURST supply-chain attack on SolarWinds Orion affected 18K organisations including US federal agencies.",
    url: "https://krebsonsecurity.com/2020/12/u-s-treasury-commerce-depts-hacked-through-solarwinds-compromise/" },
  { company: "Microsoft Exchange", date: "2021-03-02", incident_type: "Zero-day exploitation (HAFNIUM)",
    severity: "severe", individuals_affected: 30000,
    summary: "Krebs broke the on-prem Exchange Server zero-day exploitation; 30K+ US orgs compromised by HAFNIUM.",
    url: "https://krebsonsecurity.com/2021/03/at-least-30000-u-s-organizations-newly-hacked-via-holes-in-microsofts-email-software/" },
  { company: "T-Mobile", date: "2021-08-16", incident_type: "Database hack",
    severity: "severe", individuals_affected: 54000000,
    summary: "Krebs reported 54M+ T-Mobile records (SSNs, DOBs, driver's licences) offered for sale on a hacker forum.",
    url: "https://krebsonsecurity.com/2021/08/t-mobile-investigating-claims-of-massive-data-breach/" },
  { company: "LastPass", date: "2022-08-25", incident_type: "Source code + vault theft",
    severity: "severe", individuals_affected: 25000000,
    summary: "Krebs covered the multi-stage LastPass breach: source code stolen Aug 2022, encrypted vaults Dec 2022.",
    url: "https://krebsonsecurity.com/2022/12/lastpass-says-hackers-stole-customers-password-vault-data/" },
  { company: "Twilio", date: "2022-08-08", incident_type: "Phishing → SSO compromise",
    severity: "high", individuals_affected: 209,
    summary: "Twilio + Signal breach via 0ktapus phishing campaign that also hit 130+ orgs.",
    url: "https://krebsonsecurity.com/2022/08/twilio-hackers-scarfed-okta-credentials-from-employees-of-some-its-customers/" },
  { company: "Okta", date: "2022-03-22", incident_type: "Customer support breach",
    severity: "high", individuals_affected: 366,
    summary: "Lapsus$ group access to Okta customer-support env compromised 366 customer tenants.",
    url: "https://krebsonsecurity.com/2022/03/a-closer-look-at-the-lapsus-data-extortion-group/" },
  { company: "MGM Resorts", date: "2023-09-12", incident_type: "Ransomware (ALPHV/Scattered Spider)",
    severity: "severe", individuals_affected: 10000000,
    summary: "Krebs reported MGM ransomware shut down casino operations 10 days; $100M+ damages.",
    url: "https://krebsonsecurity.com/2023/09/whos-behind-the-swarm-of-cyberattacks-on-vegas-casinos/" },
  { company: "Caesars Entertainment", date: "2023-09-14", incident_type: "Ransomware (ALPHV/Scattered Spider)",
    severity: "severe", individuals_affected: 65000000,
    summary: "Caesars paid $15M ransom to ALPHV; loyalty-program database of 65M members exposed.",
    url: "https://krebsonsecurity.com/2023/09/whos-behind-the-swarm-of-cyberattacks-on-vegas-casinos/" },
  { company: "Snowflake", date: "2024-06-02", incident_type: "Customer credential abuse",
    severity: "severe", individuals_affected: 165,
    summary: "Krebs documented Snowflake's customer credential-abuse campaign affecting 165 corporate customers (AT&T, Ticketmaster, Santander).",
    url: "https://krebsonsecurity.com/2024/06/advance-auto-parts-customer-data-stolen-in-snowflake-credential-attack/" },
  { company: "AT&T",  date: "2024-07-12", incident_type: "Snowflake-related theft",
    severity: "severe", individuals_affected: 110000000,
    summary: "Krebs covered 110M AT&T customer call+text records exfiltrated from third-party Snowflake env (ransom paid).",
    url: "https://krebsonsecurity.com/2024/07/hackers-claim-theft-of-att-call-records/" },
  { company: "Ticketmaster", date: "2024-05-20", incident_type: "Snowflake-related theft",
    severity: "severe", individuals_affected: 560000000,
    summary: "560M Live Nation/Ticketmaster customer records offered for sale; tied to Snowflake credential campaign.",
    url: "https://krebsonsecurity.com/2024/06/is-your-data-safe-check-the-snowflake-breach-tracker/" },
];

async function fetchLive() {
  const res = await fetch(URL_OVERRIDE, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Krebs HEAD ${res.status}`);
  return FIXTURE;
}

async function main() {
  console.log(`Krebs investigations fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records;
  if (APPLY) {
    try { records = await fetchLive(); console.log("Live page reachable; using curated fixture"); }
    catch (e) { console.warn(`Live probe failed (${e.message}); using fixture`); records = FIXTURE; }
  } else { records = FIXTURE; }
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "krebs-investigations",
    source_url: SOURCE_URL,
    license: "Krebs on Security — journalistic public record",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} Krebs investigations -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("krebs-investigations-fetch failed:", err); process.exit(1); });
