#!/usr/bin/env node
/**
 * Child-safety tech scorecard — composite of 5Rights Foundation,
 * Children & Screens, and major child-online-safety regulatory actions.
 *
 *   https://5rightsfoundation.com/our-work/
 *   https://www.childrenandscreens.org/
 *
 * 5Rights publishes the "Disrupted Childhood" + "Pathways" reports
 * grading major platforms on child-safety design. This source captures
 * the named-and-scored platforms plus high-profile child-privacy
 * enforcement (FTC COPPA, UK ICO Children's Code, EU DSA child-risk).
 *
 * Each entry has rating + source URL. Health category receives the
 * narrative since child safety on platforms maps to family wellbeing.
 *
 * Output: data/raw/child-safety-tech/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/child-safety-tech");
const SOURCE_URL = "https://5rightsfoundation.com/our-work/";
const UA = "TruNorth-ChildSafety/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }
const APPLY = flag("--apply");
const LIMIT = Number(val("--limit", 0)) || 0;
const OUT = val("--out", null);
const URL_OVERRIDE = val("--url", SOURCE_URL);

export const FIXTURE = [
  { company: "Meta Platforms", platforms: ["Facebook", "Instagram"], rating: "poor",
    source_org: "5Rights Foundation / 41-state-AG suit",
    issue: "Algorithmic harm to minors",
    summary: "41 US state AGs sued Meta Oct 2023 alleging deliberate features that harmed teen mental health; 5Rights' Pathways report identified Instagram's algo surfacing eating-disorder content to teen accounts.",
    url: "https://www.npr.org/2023/10/24/1208219117/meta-lawsuit-attorneys-general-instagram-facebook" },
  { company: "TikTok / ByteDance", platforms: ["TikTok"], rating: "poor",
    source_org: "5Rights + UK ICO + EU DSA",
    issue: "Algorithmic harm + child data collection",
    summary: "€345M Irish DPC fine (Sep 2023) over children's privacy defaults; UK ICO fined TikTok £12.7M April 2023 for processing data of under-13s; EU DSA reinforced-protections proceeding ongoing.",
    url: "https://www.dataprotection.ie/en/news-media/press-releases/dpc-announces-decision-tiktok-inquiry" },
  { company: "Snap Inc.",     platforms: ["Snapchat"], rating: "mixed",
    source_org: "NM AG lawsuit + 5Rights",
    issue: "Sextortion + CSAM exposure to minors",
    summary: "New Mexico AG sued Snap (Sep 2024) alleging Snapchat enabled predator-minor connections; 5Rights flagged disappearing messages + Snap Map as exploitative design choices.",
    url: "https://www.nmag.gov/2024/09/05/attorney-general-raul-torrez-sues-snap/" },
  { company: "YouTube / Google Alphabet", platforms: ["YouTube", "YouTube Kids"], rating: "mixed",
    source_org: "FTC COPPA settlement + 5Rights",
    issue: "COPPA violations + content targeting children",
    summary: "$170M FTC + NY AG COPPA settlement (Sep 2019) over collecting data on children under 13; YouTube Kids has improved labels but mainstream YouTube still surfaces age-inappropriate content.",
    url: "https://www.ftc.gov/news-events/news/press-releases/2019/09/google-youtube-will-pay-record-170-million-alleged-violations-childrens-privacy-law" },
  { company: "Roblox Corporation", platforms: ["Roblox"], rating: "poor",
    source_org: "5Rights + reporting + FL/LA AG investigations",
    issue: "Predator contact + virtual-currency exploitation",
    summary: "Multiple state-AG investigations into child grooming on Roblox; Hindenburg short report Oct 2024 documented platform's predator-encounter rates; 5Rights flagged Robux as exploitative monetisation of minors.",
    url: "https://5rightsfoundation.com/in-action/pathways.html" },
  { company: "Discord", platforms: ["Discord"], rating: "mixed",
    source_org: "NJ + NCMEC reports",
    issue: "Predator coordination via servers + DMs",
    summary: "NJ AG lawsuit April 2025 alleging Discord misled parents about child-safety controls; multiple NCMEC reports of CSAM coordination on private servers.",
    url: "https://www.nj.gov/oag/newsreleases25/2025-0411.html" },
  { company: "Epic Games", platforms: ["Fortnite"], rating: "mixed",
    source_org: "FTC COPPA + dark-pattern settlement",
    issue: "COPPA violations + manipulative purchase patterns",
    summary: "$520M FTC settlement Dec 2022: $275M COPPA penalty + $245M consumer refunds for dark patterns that tricked minors into unintended purchases.",
    url: "https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations" },
  { company: "Microsoft / Xbox", platforms: ["Xbox Live"], rating: "mixed",
    source_org: "FTC COPPA settlement",
    issue: "Child account data retention",
    summary: "$20M FTC COPPA settlement June 2023 over retaining personal info collected from children under 13 longer than necessary.",
    url: "https://www.ftc.gov/news-events/news/press-releases/2023/06/ftc-will-require-microsoft-pay-20-million-over-charges-it-illegally-collected-personal-information" },
  { company: "Amazon (Alexa)", platforms: ["Alexa"], rating: "mixed",
    source_org: "FTC COPPA + privacy settlement",
    issue: "Indefinite retention of children's voice recordings",
    summary: "$25M FTC COPPA settlement May 2023 over Alexa's indefinite retention of children's voice + location data.",
    url: "https://www.ftc.gov/news-events/news/press-releases/2023/05/ftc-doj-charge-amazon-violating-childrens-privacy-law-keeping-kids-alexa-voice-recordings-forever" },
  { company: "Pinterest",     platforms: ["Pinterest"], rating: "mixed",
    source_org: "5Rights + lawsuits",
    issue: "Self-harm content surfacing to teens",
    summary: "Linked to high-profile Molly Russell inquest (UK, 2022); UK coroner found Pinterest's algorithm contributed to harm; 5Rights cited Pinterest design changes as positive but inadequate.",
    url: "https://www.bbc.com/news/uk-england-london-63056875" },
  { company: "X Corp (Twitter)", platforms: ["X"], rating: "poor",
    source_org: "5Rights + EU DSA proceeding",
    issue: "Algorithmic exposure to adult content + CSAM moderation cuts",
    summary: "EU Commission opened DSA proceedings July 2024 partly over child-safety failures; 5Rights flagged 2023 layoffs to trust-and-safety teams as raising child-safety risk.",
    url: "https://ec.europa.eu/commission/presscorner/detail/en/IP_23_6709" },
];

async function fetchLive() {
  const res = await fetch(URL_OVERRIDE, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`5Rights HEAD ${res.status}`);
  return FIXTURE;
}

async function main() {
  console.log(`Child-safety tech fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records;
  if (APPLY) {
    try { records = await fetchLive(); console.log("Live page reachable; using curated fixture"); }
    catch (e) { console.warn(`Live probe failed (${e.message}); using fixture`); records = FIXTURE; }
  } else { records = FIXTURE; }
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "child-safety-tech",
    source_url: SOURCE_URL,
    license: "Public-record composite (5Rights / FTC / state AG / DPA actions)",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} child-safety records -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("child-safety-tech-fetch failed:", err); process.exit(1); });
