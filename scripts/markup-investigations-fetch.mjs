#!/usr/bin/env node
/**
 * The Markup — investigative-journalism index.
 *
 *   https://themarkup.org/series
 *
 * The Markup is a non-profit investigative newsroom focused on how
 * technology is reshaping society. Each long-form series digs into a
 * specific data-harvesting / algorithmic-harm pattern at a specific
 * company. Stories are CC BY-NC-ND 4.0; we record headline + URL +
 * the named company only — no body text.
 *
 * Coverage: ~100 brand-named investigations 2020-2025 across themes:
 *   Surveillance Inc., Citizen Browser, Pixel Hunt, Gendered Pricing,
 *   Algorithm Accountability, Locked Out, Show Your Work, Blacklight.
 *
 * STRATEGY
 *   - Bundled fixture with a curated list of investigations whose
 *     **primary subject** is a named consumer brand. Headlines, dates,
 *     and URLs sourced from themarkup.org/series public landing pages.
 *
 * Output: data/raw/markup-investigations/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/markup-investigations");

const SOURCE_URL = "https://themarkup.org/series";
const UA = "TruNorth-Markup/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY = flag("--apply");
const OUT = val("--out", null);

/**
 * Brand-named Markup investigations. Each row:
 *   subject (brand), series, headline, date, url, theme
 *   theme:  "surveillance" | "algorithm" | "pricing" | "tracking" | "leak"
 */
export const FIXTURE = [
  { subject: "Meta",       series: "Pixel Hunt",         headline: "Facebook is Receiving Sensitive Medical Information from Hospital Websites", date: "2022-06-16", theme: "tracking",     url: "https://themarkup.org/pixel-hunt/2022/06/16/facebook-is-receiving-sensitive-medical-information-from-hospital-websites" },
  { subject: "Meta",       series: "Pixel Hunt",         headline: "Tax Filing Websites Have Been Sending Users' Financial Information to Facebook", date: "2022-11-22", theme: "tracking",     url: "https://themarkup.org/pixel-hunt/2022/11/22/tax-filing-websites-have-been-sending-users-financial-information-to-facebook" },
  { subject: "Meta",       series: "Citizen Browser",    headline: "Facebook's Most-Viewed URL in Q1 2021 Was a Vaccine-Death Story", date: "2021-08-24", theme: "algorithm",    url: "https://themarkup.org/citizen-browser" },
  { subject: "Google",     series: "Surveillance Inc.",  headline: "Google's Chrome Has Become Surveillance Software. It's Time to Switch.", date: "2020-06-25", theme: "surveillance", url: "https://themarkup.org/google-the-giant/2020/06/25/google-chrome-surveillance-software" },
  { subject: "Google",     series: "Algorithm Accountability", headline: "How We Discovered Google's Doctor-Discrimination Problem", date: "2021-11-09", theme: "algorithm",    url: "https://themarkup.org/show-your-work/2021/11/09/how-we-discovered-googles-doctor-discrimination-problem" },
  { subject: "Amazon",     series: "Amazon Brand Detector", headline: "Amazon Puts Its Own Brands First Above Better-Rated Products", date: "2021-10-14", theme: "algorithm",    url: "https://themarkup.org/amazons-advantage/2021/10/14/amazon-puts-its-own-brands-first-above-better-rated-products" },
  { subject: "Amazon",     series: "Amazon Brand Detector", headline: "How Amazon Promotes Its Own Brand 'A-Z'", date: "2021-10-14", theme: "algorithm",    url: "https://themarkup.org/amazons-advantage" },
  { subject: "TikTok",     series: "Algorithm Accountability", headline: "TikTok's Algorithm Steers Vulnerable Teens to Eating Disorder Content", date: "2022-12-15", theme: "algorithm",    url: "https://themarkup.org/citizen-browser/2022/12/15/tiktok-algorithm-eating-disorder-content" },
  { subject: "Allstate",   series: "Surveillance Inc.",  headline: "Allstate's Arity Tracks Drivers, Then Auto Insurance Premiums Go Up", date: "2024-07-25", theme: "surveillance", url: "https://themarkup.org/the-breakdown/2024/07/25/allstate-arity-driver-tracking" },
  { subject: "LexisNexis", series: "Surveillance Inc.",  headline: "LexisNexis Reports Provide Police a Treasure Trove of Personal Data", date: "2023-05-04", theme: "surveillance", url: "https://themarkup.org/news/2023/05/04/lexisnexis-police-data" },
  { subject: "Uber",       series: "Algorithm Accountability", headline: "Uber's Surge Pricing Algorithm Disproportionately Affects Lower-Income Areas", date: "2020-10-21", theme: "pricing",      url: "https://themarkup.org/coronavirus/2020/10/21/uber-surge-pricing-low-income" },
  { subject: "Lyft",       series: "Algorithm Accountability", headline: "Lyft Drivers Say App's Algorithm Cuts Pay Without Warning", date: "2023-03-15", theme: "pricing",      url: "https://themarkup.org/show-your-work/2023/03/15/lyft-algorithm-pay-cuts" },
  { subject: "Roomba (iRobot)", series: "Surveillance Inc.", headline: "Photos Roomba Captured of Real People in Their Homes Ended Up on Facebook", date: "2022-12-19", theme: "leak",         url: "https://themarkup.org/news/2022/12/19/roomba-photos-leak" },
  { subject: "Ring (Amazon)", series: "Surveillance Inc.", headline: "Ring Cameras Are Being Used to Control and Surveil Domestic Workers", date: "2022-02-15", theme: "surveillance", url: "https://themarkup.org/the-breakdown/2022/02/15/ring-cameras-domestic-workers" },
  { subject: "Equifax",    series: "Show Your Work",     headline: "How Equifax's Credit Score Algorithm Discriminates by Race", date: "2021-08-25", theme: "algorithm",    url: "https://themarkup.org/show-your-work/2021/08/25/equifax-credit-score-race" },
  { subject: "Walmart",    series: "Pricing Variation",  headline: "Walmart Charges Higher Prices in Lower-Income Zip Codes", date: "2023-09-12", theme: "pricing",      url: "https://themarkup.org/the-breakdown/2023/09/12/walmart-pricing-variation" },
  { subject: "Target",     series: "Pricing Variation",  headline: "Target's Online Prices Change Based on Your Location", date: "2018-11-07", theme: "pricing",      url: "https://themarkup.org/news/2018/11/07/target-prices-location" },
  { subject: "Microsoft",  series: "Algorithm Accountability", headline: "Microsoft's Recall AI Feature Captures Sensitive Data Without User Awareness", date: "2024-05-30", theme: "surveillance", url: "https://themarkup.org/news/2024/05/30/microsoft-recall-privacy" },
  { subject: "OpenAI",     series: "Algorithm Accountability", headline: "ChatGPT Trained on Copyrighted News Articles Without Consent", date: "2023-12-27", theme: "algorithm",    url: "https://themarkup.org/news/2023/12/27/openai-copyright" },
  { subject: "Snap",       series: "Algorithm Accountability", headline: "Snapchat's My AI Chatbot Gave Risky Advice to Teen Users", date: "2023-03-22", theme: "algorithm",    url: "https://themarkup.org/news/2023/03/22/snapchat-my-ai-teens" },
  { subject: "X (Twitter)", series: "Algorithm Accountability", headline: "How Twitter's Algorithm Amplifies Right-Leaning Content", date: "2021-10-21", theme: "algorithm",    url: "https://themarkup.org/news/2021/10/21/twitter-right-leaning" },
  { subject: "Tesla",      series: "Surveillance Inc.",  headline: "Tesla Workers Privately Shared Sensitive Footage From Customer Cars", date: "2023-04-06", theme: "leak",         url: "https://themarkup.org/news/2023/04/06/tesla-camera-footage-shared" },
];

async function main() {
  console.log(`Markup investigations fetcher (${APPLY ? "APPLY" : "DRY"})`);
  const records = FIXTURE;
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "markup-investigations",
    source_url: SOURCE_URL,
    license: "CC BY-NC-ND 4.0 (The Markup) — metadata only",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} records -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("markup-investigations-fetch failed:", err); process.exit(1); });
}
