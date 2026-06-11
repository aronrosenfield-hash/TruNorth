# Data Sources R7 — deep-research sweep (2026-06-11)

> Produced by the deep-research workflow: 5 search angles, 23 primary sources fetched, 114 claims extracted, 25 adversarially verified (3-vote panels; 23 confirmed, 2 killed), 105 agents. Every finding below survived verification, including live endpoint fetches on 2026-06-11 and license-text confirmation. Constraints: $0, commercial use permitted, primary sources only, no advocacy rankings.

## Executive summary

Eight new license-clean, $0, commercial-use-permitted sources survived adversarial verification, and together they fill TruNorth's top priority gaps. The single biggest win is the DOL OFCCP FOIA library's now-complete (Feb 25, 2026) release of per-company Type 2 EEO-1 workforce demographic data for ~56,650 report-rows of federal contractors (2016-2020) — verified by downloading the 52 MB consolidated XLSX — which finally unlocks gap 1 (DEI at scale), supplemented by Illinois SOS per-company EEO filings. Gap 7 is solved by the keyless, rate-limit-free USAspending API (live-tested per-recipient endpoints with UEI/DUNS identifiers); SAM.gov's Exclusions bulk extract adds a debarment signal, while its Contract Awards API is impractical at the 10-requests/day free tier. Gap 6 gets two public-domain CBP feeds (UFLPA Entity List ~144 companies, WRO/Findings CSV ~97 named producers); gap 5 gets the FTC Legal Library's 6,086 per-company enforcement cases (public domain under 17 U.S.C. 105); and gap 2 gets USDA APHIS AWA licensee/inspection records, though brand-matchable animal-welfare coverage at 1,000+ scale remains unsolved. All US federal sources are public domain with no commercial-use restriction; the main operational hurdle is Akamai bot-blocking on dol.gov, ilsos.gov, cbp.gov, and ftc.gov requiring browser-grade fetch paths.

## Verified findings

### 1. DOL OFCCP FOIA library now hosts the complete per-company Type 2 EEO-1 workforce demograph

**Confidence:** high · **verification:** 9-0 across 3 merged claims

DOL OFCCP FOIA library now hosts the complete per-company Type 2 EEO-1 workforce demographic dataset for federal contractors, FY2016-2020 — the strongest available fill for TruNorth gap 1 (per-company DEI at scale). The fifth/final release landed Feb 25, 2026 (4,761 objecting contractors, 16,771 reports), following the Ninth Circuit's July 2025 holding (CIR v. DOL, No. 24-880) that this data is not confidential commercial information under FOIA Exemption 4; the district court lifted its stay Feb 9, 2026. As FOIA reading-room US government records, commercial reuse carries no disclosed restriction. Granularity adversarially verified: the consolidated third-release XLSX (Consolidated-Non-Exempt-EEO-1-Reports-508c.xlsx, ~52 MB) was downloaded and contains 56,650 rows x 221 columns — YEAR, CONAME (parent company), address, NAICS, DUNS, plus ~200 race-by-gender-by-job-category headcount columns — with a published data dictionary (DataSetDictionary-EEO1FY2016-2020.csv, 219 variables). Access: bulk CSV/XLSX files; plain curl with default UA got HTTP 200 on the file URL today, though the HTML page Akamai-blocks some clients (a spoofed Chrome UA got 403), so the fetcher should use default curl headers or a mirrored copy. Refresh: static historical release (2016-2020); no scheduled future releases. Effort: low-to-medium one-time ingest + brand matching on CONAME/DUNS. Build priority: highest of all candidates.

**Evidence:** Primary DOL page states verbatim: 'This is the fifth and final release of Type 2 EEO-1 Reports for years 2016 through 2020... includes the data of 4,761 federal contractor objectors... consisting of 16,771 Type 2 EEO-1 Reports.' Verifier independently downloaded the 52,364,452-byte consolidated XLSX on 2026-06-11 (HTTP 200), confirmed sheet dimension A1:HM56650 (56,650 rows x 221 cols), header columns YEAR/COMPANY/CONAME/STREET/NAICS/DUNS plus demographic headcounts, and the data dictionary. Ninth Circuit opinion and Feb 9/11/25 2026 stay-lift and release dates corroborated by Justia, SHRM, Fisher Phillips, govconemploymentexchange.com. Data not clawed back as of latest snapshots.

**Sources:**
- https://www.dol.gov/agencies/ofccp/foia/library/Employment-Information-Reports
- https://www.dol.gov/sites/dolgov/files/OFCCP/foia/files/Consolidated-Non-Exempt-EEO-1-Reports-508c.xlsx
- https://www.dol.gov/sites/dolgov/files/OFCCP/foia/files/DataSetDictionary-EEO1FY2016-2020.csv
- https://law.justia.com/cases/federal/appellate-courts/ca9/24-880/24-880-2025-07-30.html

### 2. Illinois Secretary of State Business Reporting portal (apps

**Confidence:** medium · **verification:** 3-0 (companion claim refuted 0-3)

Illinois Secretary of State Business Reporting portal (apps.ilsos.gov/businessreporting/) publishes per-company state EEO filings substantially similar to Section D of the federal EEO-1, under 805 ILCS 5/14.05 (SB 1480, effective Jan 1 2023) — a secondary per-company DEI stream for gap 1. Live search form verified 2026-06-11 with Form Type 'EEO' and years 2021-2026. Coverage is modest: Illinois BCA corporations only (no LLCs), Illinois employees only — likely hundreds of companies, not thousands. Access is search-interface only (POST form), behind Akamai bot-protection that killed automated POSTs, so ingestion requires browser-grade fetching. License: Illinois public records published by statutory mandate; no explicit commercial-use restriction found, but no affirmative license statement either — verify ToS before wiring. Note: a companion claim that the portal also publishes board-diversity/DEI-policy reports since 2020 was REFUTED (that stream is separate and tiny, ~97 timely 2023 filers). Build priority: medium — real per-company data, small coverage, hard access.

**Evidence:** Portal live 2026-06-11, contains verbatim: 'Illinois employers currently required to file an EEO-1 report will now be required to submit a similar report... substantially similar to the employment data reported under Section D of the federal EEO-1 Report. These reports will be published here.' Working search form exposes EEO form type. Verifier could not retrieve a sample filing (Akamai HTTP/2 INTERNAL_ERROR on automated POST), so non-empty per-company results are inferred from statute + live form, not directly observed — hence medium confidence. Per-company publication mandate corroborated by Littler, Jackson Lewis, DLA Piper, Mercer analyses.

**Sources:**
- https://apps.ilsos.gov/businessreporting/
- 805 ILCS 5/14.05 (SB 1480, 2021)

### 3. USAspending API (api

**Confidence:** high · **verification:** 12-0 across 4 merged claims

USAspending API (api.usaspending.gov) is the best gap-7 enrichment source for the 1,583 new NYSE/Nasdaq mid-caps: official US Treasury DATA Act system serving per-recipient federal contract/grant data, no API key, no auth ('Endpoints do not currently require any authorization'), no stated rate limits, public domain. Per-company endpoints live-verified 2026-06-11: POST /api/v2/recipient/ (18,283,884 recipients; returned APPLE INC with UEI HJAKCN4NEU95 and DUNS 060704780, and LOCKHEED MARTIN CORP with $52.4B), GET /api/v2/recipient/duns/<HASH>/ (full recipient profile incl. 25 alternate names and parent linkage — note path param is the recipient hash, not raw DUNS), POST /api/v2/autocomplete/recipient/, GET /api/v2/award_spending/recipient/ (requires fiscal_year + awarding_agency_id; 4,196 per-recipient results in test). Search data covers FY2008+; bulk_download endpoints reach FY2001. UEI/DUNS identifiers enable robust brand matching. Effort: low — standard fetch+merge pattern, keyless JSON API plus bulk downloads. Build priority: very high (high impact / lowest effort of all candidates).

**Evidence:** All endpoints fetched live on 2026-06-11 with HTTP 200 and no key: spending_by_award returned per-recipient Boeing contract record; /api/v2/recipient/ keyword 'Apple Inc' returned byte-for-byte {"name":"APPLE INC","uei":"HJAKCN4NEU95","duns":"060704780","amount":15787.75}; docs page states 'Endpoints do not currently require any authorization' verbatim with zero rate-limit mentions. US government work product, public domain under 17 U.S.C. 105.

**Sources:**
- https://api.usaspending.gov/
- https://api.usaspending.gov/docs/endpoints
- https://api.usaspending.gov/api/v2/recipient/
- https://github.com/fedspendingtransparency/usaspending-api

### 4. SAM

**Confidence:** high · **verification:** 15-0 across 5 merged claims

SAM.gov offers three relevant GSA APIs, but only the bulk Exclusions extract is practical for a $0 pipeline. (a) Contract Awards API (api.sam.gov/contract-awards/v1/search) serves per-contract FPDS records (5.69M+ records, per-awardee sections) but requires a SAM.gov API key with 10 requests/day for non-federal users without a role (1,000/day with a role) — impractical for full-corpus ingestion vs. USAspending's keyless bulk files of the same FPDS data; skip in favor of USAspending. (b) Exclusions API (entity-information/v4/exclusions) returns per-entity federal debarment/suspension records (~268k entities incl. ~16.6k org-type) — a usable enforcement-style signal, though brand-matchable coverage is modest and skewed to small contractors. (c) Entity/Exclusions Extracts Download API (api.sam.gov/data-services/v1/extracts) serves monthly full + daily incremental bulk ZIP files (SAM_Exclusions_Public_Extract_V2 CSV), so one bulk file per day fits even the 10-req/day tier. License caveat: SAM.gov ToS prohibit commercial use of legacy D&B-sourced fields in pre-April-2022 records — strip those fields and keep the public exclusion facts. Build priority: low-medium (Exclusions extract only).

**Evidence:** GSA docs verified live: rate-limit table states exactly 'Non-federal user (no SAM.gov role): Personal API key, 10 requests/day'; Contract Awards OpenAPI spec fetched (53KB, HTTP 200) with worked examples showing totalRecords=5,691,511 and per-awardee data. Exclusions per-entity granularity confirmed via OpenSanctions us_sam_exclusions mirror refreshed 2026-06-11 07:55 UTC (268,051 entities, 5,351 companies) from SAM's daily extract. Extracts API docs confirm monthly full + daily incremental public ZIPs retrievable by GET with a free key. Direct curls returned empty envoy 404s — gateway behavior for unauthenticated requests, also seen on known-live SAM APIs, not dead endpoints.

**Sources:**
- https://open.gsa.gov/api/contract-awards/
- https://open.gsa.gov/api/exclusions-api/
- https://open.gsa.gov/api/sam-entity-extracts-api/
- https://open.gsa.gov/api/

### 5. CBP forced-labor records (gap 6) are two free, public-domain, per-entity federal feeds

**Confidence:** high · **verification:** 18-0 across 6 merged claims

CBP forced-labor records (gap 6) are two free, public-domain, per-entity federal feeds. (1) UFLPA Entity List: DHS/FLETF roster of ~144 named companies subject to a rebuttable import-ban presumption under 19 U.S.C. § 1307, published in the Federal Register and mirrored by OpenSanctions (us_dhs_uflpa); the companion CBP UFLPA dashboard is shipment-level statistics only (no importer names) — use the Entity List, not the dashboard, for brand matching. (2) Withhold Release Orders & Findings: downloadable CSV at cbp.gov/document/stats/withhold-release-orders-findings (withhold-release-orders-findings-fy26-dec.csv, 97 records; 55 active WROs + 9 Findings) with per-producer fields (Effective Date, Country, Status, Entity, Remarks) naming specific companies (e.g., Giant Manufacturing Co. Ltd.; Jan 2026 WRO against coffee producer Finca Monte Grande), updated event-driven 'on an as needed basis.' License: CBP copyright notice confirms site content is public domain, commercial use permitted, citation requested. Coverage caveat: ~250 total named entities, mostly upstream foreign factories rather than consumer brands, so this is a high-signal red-flag overlay, not a broad-coverage source. Access: cbp.gov 403s non-browser fetchers — use browser UA or the CSV/Tableau public endpoints. Effort: low. Build priority: medium-high (strong signal, small N).

**Evidence:** All verified live 2026-06-11: CBP page carries verbatim the §1307 rebuttable-presumption text; WRO CSV downloaded with 97 named-entity records; dashboard page (last-modified 2026-06-11) states 'updated on an as needed basis with the new addition, removal, or modification of WROs and Findings'; copyright notice verbatim: 'information on the U.S. Customs and Border Protection website is in the public domain and may be reproduced, published or otherwise used without the permission of the CBP'; UFLPA stats page greps zero importer names, confirming shipment-level-only granularity there. Finca Monte Grande WRO confirmed via official CBP CSMS bulletin #67544333 (Jan 29, 2026).

**Sources:**
- https://www.cbp.gov/trade/forced-labor/UFLPA
- https://www.cbp.gov/newsroom/stats/trade/withhold-release-orders-findings-dashboard
- https://www.cbp.gov/document/stats/withhold-release-orders-findings
- https://www.cbp.gov/site-policy-notices/copyright-notice
- https://www.cbp.gov/newsroom/stats/trade/uyghur-forced-labor-prevention-act-statistics

### 6. FTC Legal Library Cases and Proceedings (ftc

**Confidence:** high · **verification:** 6-0 across 2 merged claims

FTC Legal Library Cases and Proceedings (ftc.gov/legal-library/browse/cases-proceedings) holds 6,086 per-company enforcement case records — federal court actions and administrative adjudicative proceedings covering privacy violations, false advertising, fraud, and anticompetitive conduct — directly feeding TruNorth's data-privacy category and gap 5 (FTC consent decrees). Per-company granularity verified via individual case pages (e.g., In the Matter of Twitter, Inc. privacy consent order; FTC v. Celsius Network) with facet filters including 'Privacy and Security.' License clean: FTC website policy states material is US government work, public domain under 17 U.S.C. 105, attribution requested 'where feasible' (precatory, not binding) — third-party exhibits embedded in filings are the only excluded material, and case facts/metadata are uncopyrightable regardless. Access: HTML browse (403 to generic fetchers, browser UA required) — check the FTC developer API as the cleaner ingestion path. Refresh: continuous (hundreds of new cases/year). Effort: medium (case-to-brand entity matching from case titles). Build priority: high.

**Evidence:** Fetched live 2026-06-11 with browser UA: listing shows 'Displaying 1 - 20 of 6086'; per-company case URLs confirmed (092-3093-twitter-inc-corporation, 222-3105-illuminate-education-inc-matter); facets field_consumer_protection_topics include 'Privacy and Security' and 'Advertising and Marketing.' Policy page verbatim: 'the material is in the public domain and is not subject to copyright restrictions (17 U.S.C. 105)... use, duplication, or redistribution... should be accompanied by appropriate attribution, where feasible.'

**Sources:**
- https://www.ftc.gov/legal-library/browse/cases-proceedings
- https://www.ftc.gov/policy-notices/website-policy

### 7. USDA APHIS Animal Care Public Search Tool provides per-entity Animal Welfare Act complianc

**Confidence:** high · **verification:** 6-0 across 2 merged claims (access-method companion claim refuted 0-3)

USDA APHIS Animal Care Public Search Tool provides per-entity Animal Welfare Act compliance records — licensed/registered persons (dealers, exhibitors as licensees; research facilities, carriers, intermediate handlers as registrants), per-facility inspection reports, and annual research-facility animal-use reports — a federal primary source for the animal-welfare category, distinct from TruNorth's existing awa-* source (which is A Greener World's certification, not USDA). Brand-matchable coverage is limited: the >17,500-entity universe skews to breeders/exhibitors/labs, so matches concentrate in corporate research registrants (pharma/CPG animal-testing sites) — this does NOT solve gap 2's 1,000+ brand target. Ingestion path: a prior claim that access is interactive-search-only was REFUTED — APHIS publishes a downloadable List of Active Licensees and Registrants (PDF + XLSX variant, HTTP 200 today) and downloadable inspection data; avoid scraping the Salesforce tool (bot-blocked). License: USDA federal records, public domain. Caveat: inspection reports were removed in 2017, restored under pressure, and may carry redactions; some enforcement records remain FOIA-only. Effort: low-medium. Build priority: medium (fills a category gap partially; modest brand yield).

**Evidence:** Primary page (Last Modified Nov 17, 2025) contains verbatim: 'This Public Search Tool lists persons licensed and registered under the AWA, inspection reports, and annual research facility animal use reports.' Licensee/registrant split matches 7 U.S.C. 2133-2136, corroborated by CRS R47179 and APHIS licensing guide. Bulk licensee list and Salesforce tool both returned HTTP 200 on 2026-06-11. Verifiers confirmed the existing TruNorth awa-fetch.mjs ingests A Greener World certification, so no redundancy.

**Sources:**
- https://www.aphis.usda.gov/awa/public-search
- https://aphis.my.site.com/PublicSearchTool/s/
- https://www.aphis.usda.gov/sites/default/files/List-of-Active-Licensees-and-Registrants.pdf

## Build-priority list (impact ÷ effort)

| # | Source | Gap | Category | Effort | Notes |
|---|---|---|---|---|---|
| 1 | **DOL OFCCP EEO-1 Type 2** (FY2016-2020, 56,650 rows) | 1 DEI | dei | low-med, one-time | Bulk XLSX verified downloadable; brand-match on CONAME/DUNS; THE per-company DEI unlock. Use default curl UA (Akamai 403s spoofed UAs) |
| 2 | **USAspending API** | 7 mid-caps | transparency/labor | low | Keyless, no rate limit, per-recipient UEI/DUNS endpoints live-tested |
| 3 | **FTC Legal Library** (6,086 cases) | 5 privacy/consumer | privacy | medium | Public domain (17 U.S.C. 105); Akamai — needs browser-grade fetch |
| 4 | **CBP UFLPA Entity List** (~144 cos) | 6 forced labor | labor | low | Public domain; maps to childLabor/forcedLabor structural flags |
| 5 | **CBP WRO/Findings CSV** (~97 producers) | 6 forced labor | labor | low | Public domain CSV |
| 6 | **SAM.gov Exclusions bulk extract** | 7 mid-caps | transparency | low | Debarment signal; bulk file practical, Awards API is NOT (10 req/day) |
| 7 | **USDA APHIS AWA records** | 2 animals | animals | medium | Per-entity inspections/licensees; brand-matchable subset modest |
| 8 | **Illinois SOS EEO filings** | 1 DEI | dei | medium | Hundreds of IL corporations; Akamai-blocked POST form |

**Unsolved after R7:** animal welfare at 1,000+ brand scale (APHIS helps but is facility-oriented); guns remains na-backfill + FFL (already shipped as Lever 2).

**Cross-cutting operational note:** dol.gov, ilsos.gov, cbp.gov, ftc.gov all sit behind Akamai bot protection. Counterintuitively, DEFAULT curl headers passed while a spoofed Chrome UA got 403 on dol.gov — build fetchers with plain curl first, browser-grade fetch only where needed, and commit raw snapshots so reruns don't depend on the WAF's mood (B-60/61/62 guard conventions apply).
