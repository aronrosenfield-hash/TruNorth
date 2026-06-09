#!/usr/bin/env node
/**
 * Ireland DPC (Data Protection Commission) — enforcement actions.
 *
 *   https://www.dataprotection.ie/en/news-media/press-releases
 *   https://www.dataprotection.ie/en/dpc-guidance/law/regulatory-activity
 *
 * The Irish DPC is the lead supervisory authority for most US Big Tech
 * companies in the EU because their EU HQs are in Ireland (Meta, Google,
 * Apple, TikTok, X/Twitter, LinkedIn, Microsoft, etc.). DPC decisions
 * therefore have outsized impact on global privacy enforcement.
 *
 * Many DPC fines also flow through enforcementtracker.com (covered by
 * gdpr-enforcement source) but this dedicated fetcher captures DPC-led
 * inquiries with full case context including the lead-supervisory-
 * authority dimension that's lost in the EDPB tracker.
 *
 * STRATEGY: fixture-only (real public DPC decisions). --apply does a HEAD.
 *
 * Output: data/raw/ireland-dpc/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ireland-dpc");
const SOURCE_URL = "https://www.dataprotection.ie/en/news-media/press-releases";
const UA = "TruNorth-IrelandDPC/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }
const APPLY = flag("--apply");
const LIMIT = Number(val("--limit", 0)) || 0;
const OUT = val("--out", null);
const URL_OVERRIDE = val("--url", SOURCE_URL);

export const FIXTURE = [
  { company: "Meta Platforms Ireland Ltd. (Facebook)", date: "2024-12-17", fine_eur: 251000000,
    issue: "GDPR breach-notification + technical/organisational measures",
    summary: "€251M DPC final decision (Dec 2024) on Meta for the 2018 'View As' security breach affecting ~29M accounts including 3M EU users.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/data-protection-commission-announces-final-decisions-in-two-inquiries-into-meta-platforms-ireland-limited" },
  { company: "TikTok Technology Ltd.", date: "2025-05-02", fine_eur: 530000000,
    issue: "Unlawful transfer of EU user data to China",
    summary: "€530M DPC fine (May 2025) on TikTok — unlawful transfers of EEA user data to China without adequate protection, plus transparency failings.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/dpc-announces-its-final-decision-tiktok-inquiry" },
  { company: "Meta Platforms Ireland Ltd. (Facebook)", date: "2023-05-22", fine_eur: 1200000000,
    issue: "EU–US data transfers (Schrems II)",
    summary: "€1.2B DPC fine (May 2023) on Meta — record GDPR fine — for transferring EU user data to the US without adequate safeguards (Schrems II violation).",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/data-protection-commission-announces-conclusion-inquiry-meta-ireland" },
  { company: "Meta Platforms Ireland Ltd.", date: "2023-01-04", fine_eur: 390000000,
    issue: "Legal basis for personalised advertising",
    summary: "€390M (€210M Facebook + €180M Instagram) DPC decision (Jan 2023) — Meta wrongfully relied on 'contract' as legal basis for behavioural advertising.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/data-protection-commission-announces-conclusion-two-inquiries-meta-ireland" },
  { company: "Meta Platforms Ireland Ltd. (Instagram)", date: "2022-09-15", fine_eur: 405000000,
    issue: "Children's privacy on Instagram",
    summary: "€405M DPC fine (Sep 2022) over Instagram default settings exposing children's contact information and accounts being public by default.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/data-protection-commission-announces-decision-instagram-inquiry" },
  { company: "Meta Platforms Ireland Ltd. (Facebook)", date: "2022-11-28", fine_eur: 265000000,
    issue: "Data scraping of public profile information",
    summary: "€265M DPC fine (Nov 2022) for failing to prevent scraping of 533M Facebook users' phone numbers/profile data published online in 2019.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/data-protection-commission-announces-conclusion-inquiry-meta-ireland" },
  { company: "Meta Platforms Ireland Ltd. (WhatsApp)", date: "2021-09-02", fine_eur: 225000000,
    issue: "Transparency obligations under GDPR",
    summary: "€225M DPC fine (Sep 2021) on WhatsApp Ireland — second-largest GDPR fine at the time — for failing to explain how WhatsApp shares data with Meta.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/data-protection-commission-announces-decision-whatsapp-inquiry" },
  { company: "TikTok Technology Ltd.", date: "2023-09-15", fine_eur: 345000000,
    issue: "Children's privacy defaults",
    summary: "€345M DPC fine (Sep 2023) on TikTok — children's accounts set to public by default, family-pairing flaw, and dark patterns nudging teens to keep accounts public.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/dpc-announces-345-million-euro-fine-tiktok" },
  { company: "LinkedIn Ireland Unlimited Company", date: "2024-10-24", fine_eur: 310000000,
    issue: "Behavioural ads — lawful basis + transparency",
    summary: "€310M DPC fine (Oct 2024) on LinkedIn (Microsoft) for processing member data for behavioural-analysis and targeted ads without valid lawful basis.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/irish-data-protection-commission-fines-linkedin-ireland-eur-310-million" },
  { company: "X Internet Unlimited Company (Twitter)", date: "2020-12-15", fine_eur: 450000,
    issue: "Failure to notify breach within 72 hours",
    summary: "€450K DPC fine (Dec 2020) — first major cross-border GDPR enforcement by Ireland — on Twitter International for missing the 72-hour breach-notification deadline.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/data-protection-commission-announces-decision-twitter-inquiry" },
  { company: "Yahoo / Verizon Media EMEA Ltd.", date: "2024-04-26", fine_eur: 0,
    issue: "Children's accounts — reprimand + order",
    summary: "DPC reprimand + order (Apr 2024) directing Yahoo EMEA to bring its processing of children's data into compliance with GDPR.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases" },
  { company: "Airbnb Ireland UC", date: "2022-05-24", fine_eur: 32000,
    issue: "Excessive ID-document collection",
    summary: "€32K DPC reprimand + small fine (May 2022) on Airbnb Ireland for requiring users to upload passport/ID for account verification beyond what GDPR justified.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases" },
  { company: "Bank of Ireland", date: "2023-05-25", fine_eur: 750000,
    issue: "Customer-account breach disclosures",
    summary: "€750K DPC fine on Bank of Ireland for failing to adequately notify customers and DPC of breaches affecting the credit-rating system.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases" },
  { company: "OpenAI Ireland Ltd.", date: "2024-09-20", fine_eur: 0,
    issue: "GDPR lawful basis + transparency — inquiry opened",
    summary: "DPC formally opened cross-border inquiry into OpenAI's ChatGPT training-data lawful basis under Article 65 GDPR (Sep 2024).",
    url: "https://www.dataprotection.ie/en/news-media/press-releases" },
  { company: "X Internet Unlimited Company", date: "2024-09-04", fine_eur: 0,
    issue: "AI training on EU user data without consent",
    summary: "DPC obtained High Court undertaking (Sep 2024) from X (Twitter) to stop using EU users' posts to train Grok AI without lawful basis.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/court-confirms-suspension-of-processing-of-personal-data-by-x-for-training-of-grok-ai" },
];

async function fetchLive() {
  const res = await fetch(URL_OVERRIDE, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Ireland DPC HEAD ${res.status}`);
  return FIXTURE;
}

async function main() {
  console.log(`Ireland DPC fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records;
  if (APPLY) {
    try { records = await fetchLive(); console.log("Live page reachable; using curated fixture"); }
    catch (e) { console.warn(`Live probe failed (${e.message}); using fixture`); records = FIXTURE; }
  } else { records = FIXTURE; }
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "ireland-dpc",
    source_url: SOURCE_URL,
    license: "Public record (Irish Data Protection Commission)",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} Ireland DPC actions -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("ireland-dpc-fetch failed:", err); process.exit(1); });
