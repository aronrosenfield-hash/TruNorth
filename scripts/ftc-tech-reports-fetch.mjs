#!/usr/bin/env node
/**
 * FTC Tech Reports + Section 6(b) studies.
 *
 *   https://www.ftc.gov/news-events/topics/technology
 *   https://www.ftc.gov/policy/studies/section-6b-studies
 *
 * Under Section 6(b) of the FTC Act, the agency can compel detailed
 * data-practice disclosures from specific named companies. Recent 6(b)
 * studies + tech reports (e.g. "Social Media and Video Streaming
 * Services" 2024, "Cloud Computing" 2023, "Pharmacy Benefit Managers"
 * 2022, "ISP Data Practices" 2021) are the closest thing the US has to
 * a published privacy audit.
 *
 * Reports are public-domain government works.
 *
 * STRATEGY
 *   - Bundled fixture catalogues 6(b) studies + reports that name
 *     specific companies as respondents. Adverse findings (e.g. "company
 *     failed to disclose practices fully", "engaged in tracking despite
 *     ToS") flagged as such.
 *
 * Output: data/raw/ftc-tech-reports/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ftc-tech-reports");

const SOURCE_URL = "https://www.ftc.gov/policy/studies/section-6b-studies";
const UA = "TruNorth-FTC/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY = flag("--apply");
const OUT = val("--out", null);

/**
 * FTC 6(b) study / tech report respondents and findings. Each row:
 *   company, study_title, study_year, finding_class:
 *     "named_respondent" | "adverse_finding" | "settlement_referenced",
 *   url
 */
export const FIXTURE = [
  // Social Media & Video Streaming 6(b) (2020 order, 2024 report)
  { company: "Meta",      study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "Cited for extensive children's-data collection + opaque algorithms.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "Amazon",    study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "Twitch cited for inadequate child-protection controls.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "Google",    study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "YouTube cited for ad targeting practices despite COPPA settlement.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "TikTok (ByteDance)", study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "Cited for retention of minor-user content + cross-border data flows.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "Snap",      study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "named_respondent", note: "Named respondent; comparatively limited data retention.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "X (Twitter)", study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "Cited for ad-targeting based on inferred sensitive attributes.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "Reddit",    study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "named_respondent", note: "Named respondent; pseudonymous model noted as mitigating factor.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "Discord",   study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "named_respondent", note: "Named respondent; broad metadata retention noted.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },
  { company: "WhatsApp",  study_title: "A Look Behind the Screens: Social Media and Video Streaming 6(b)", study_year: 2024, finding_class: "named_respondent", note: "Default E2EE noted as best practice.", url: "https://www.ftc.gov/system/files/ftc_gov/pdf/Social-Media-6b-Report.pdf" },

  // ISP Privacy 6(b) (2019 order, 2021 report)
  { company: "AT&T",      study_title: "ISPs' Privacy Practices 6(b)", study_year: 2021, finding_class: "adverse_finding", note: "Cited for combining web browsing + TV viewing data for ad targeting.", url: "https://www.ftc.gov/system/files/documents/reports/look-what-isps-know-about-you-examining-privacy-practices-six-major-internet-service-providers/p195402_isp_6b_staff_report.pdf" },
  { company: "Verizon",   study_title: "ISPs' Privacy Practices 6(b)", study_year: 2021, finding_class: "adverse_finding", note: "Cited for default opt-in to behavioral ad targeting.", url: "https://www.ftc.gov/system/files/documents/reports/look-what-isps-know-about-you-examining-privacy-practices-six-major-internet-service-providers/p195402_isp_6b_staff_report.pdf" },
  { company: "Comcast",   study_title: "ISPs' Privacy Practices 6(b)", study_year: 2021, finding_class: "adverse_finding", note: "Cited for race-of-household + interest-segment inference.", url: "https://www.ftc.gov/system/files/documents/reports/look-what-isps-know-about-you-examining-privacy-practices-six-major-internet-service-providers/p195402_isp_6b_staff_report.pdf" },
  { company: "T-Mobile",  study_title: "ISPs' Privacy Practices 6(b)", study_year: 2021, finding_class: "adverse_finding", note: "Cited for selling app-usage data; subsidiary Sprint formerly collected web traffic.", url: "https://www.ftc.gov/system/files/documents/reports/look-what-isps-know-about-you-examining-privacy-practices-six-major-internet-service-providers/p195402_isp_6b_staff_report.pdf" },

  // Cloud Computing 6(b) (2023 order)
  { company: "Amazon",    study_title: "Cloud Computing Business Practices 6(b)", study_year: 2023, finding_class: "named_respondent", note: "AWS named; report focuses on competition + customer lock-in.", url: "https://www.ftc.gov/news-events/news/press-releases/2023/03/ftc-launches-inquiry-cloud-computing-business-practices" },
  { company: "Microsoft", study_title: "Cloud Computing Business Practices 6(b)", study_year: 2023, finding_class: "named_respondent", note: "Azure named; Teams/365 bundling raised.", url: "https://www.ftc.gov/news-events/news/press-releases/2023/03/ftc-launches-inquiry-cloud-computing-business-practices" },
  { company: "Google",    study_title: "Cloud Computing Business Practices 6(b)", study_year: 2023, finding_class: "named_respondent", note: "Google Cloud named.", url: "https://www.ftc.gov/news-events/news/press-releases/2023/03/ftc-launches-inquiry-cloud-computing-business-practices" },

  // AI Partnerships 6(b) (2024 order)
  { company: "Microsoft", study_title: "Generative-AI Investments + Partnerships 6(b)", study_year: 2024, finding_class: "named_respondent", note: "OpenAI investment scrutinized.", url: "https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-launches-inquiry-generative-ai-investments-partnerships" },
  { company: "Amazon",    study_title: "Generative-AI Investments + Partnerships 6(b)", study_year: 2024, finding_class: "named_respondent", note: "Anthropic investment scrutinized.", url: "https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-launches-inquiry-generative-ai-investments-partnerships" },
  { company: "Google",    study_title: "Generative-AI Investments + Partnerships 6(b)", study_year: 2024, finding_class: "named_respondent", note: "Anthropic + DeepMind partnerships scrutinized.", url: "https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-launches-inquiry-generative-ai-investments-partnerships" },
  { company: "OpenAI",    study_title: "Generative-AI Investments + Partnerships 6(b)", study_year: 2024, finding_class: "named_respondent", note: "Microsoft partnership scrutinized.", url: "https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-launches-inquiry-generative-ai-investments-partnerships" },

  // Pharmacy Benefit Managers 6(b) (2022 order, 2024 interim report)
  { company: "CVS Health",         study_title: "Pharmacy Benefit Manager 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "Caremark cited for steering generics to higher-cost alternatives.", url: "https://www.ftc.gov/news-events/news/press-releases/2024/07/ftc-releases-interim-staff-report-prescription-drug-middlemen" },
  { company: "Cigna",              study_title: "Pharmacy Benefit Manager 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "Express Scripts cited for rebate-aggregation conflicts.", url: "https://www.ftc.gov/news-events/news/press-releases/2024/07/ftc-releases-interim-staff-report-prescription-drug-middlemen" },
  { company: "UnitedHealth Group", study_title: "Pharmacy Benefit Manager 6(b)", study_year: 2024, finding_class: "adverse_finding", note: "OptumRx cited for steering + reimbursement disparities.", url: "https://www.ftc.gov/news-events/news/press-releases/2024/07/ftc-releases-interim-staff-report-prescription-drug-middlemen" },
];

async function main() {
  console.log(`FTC tech reports fetcher (${APPLY ? "APPLY" : "DRY"})`);
  const records = FIXTURE;
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "ftc-tech-reports",
    source_url: SOURCE_URL,
    license: "Public domain (US federal government)",
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
  main().catch(err => { console.error("ftc-tech-reports-fetch failed:", err); process.exit(1); });
}
