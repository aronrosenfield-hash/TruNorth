# Workforce, Governance & Financial-Accountability Data Sources for TruNorth

**Date:** 2026-06-08
**Author:** Research agent
**Scope:** Net-new corporate-accountability datasets covering **board composition & governance, workforce composition, financial accountability (tax/audit), executive turnover & scandal indicators, organized-labor signals, and worker-safety regulators beyond OSHA**, to complement TruNorth's existing ~130 data sources before the 2026-06-23 Product Hunt launch.
**Exclusions:** Anything already shipped or queued in BACKLOG (SEC DEF14A / Form 4 / Exhibit 21, FEC PAC + individual exec donations, OpenSecrets, USAspending, Disability:IN, EEOC EEO-1, 50/50 WOB, CHRB via WikiRate, IRS 990, DOL WHD, MSHA — see brief). Heavily paywalled sources (Refinitiv, GMI, BoardEx, Reputation Institute, Equilar paid tier) are listed only in the **skip table**.

---

## 1. Top-line findings

- **Highest-value, lowest-effort wins for the next sprint** are SEC 8-K Item 5.02 (executive departures), DOL OFLC LCA disclosure data (H-1B / PERM employer-level), FMCSA SMS (motor-carrier safety), Cornell ILR Labor Action Tracker (strikes), FRA railroad accident data, and AFL-CIO Executive Paywatch. Each is a single bulk-download or REST endpoint, and each maps directly to a TruNorth scoring category that currently has thin or no coverage.
- **Tax-avoidance** is the biggest single signal gap. ITEP's "Corporate Tax Avoidance" data tables (~342 named Fortune-500 companies × 5-year effective tax rate) are publishable as CSV with attribution and are the cleanest "shamed for paying $0 federal tax" feed available for free.
- **Governance NGO databases** (LCDA, Black Enterprise B.E. Registry, US SIF members, CII Focus List, BoardSource diversity studies) mostly do **not** publish machine-readable feeds. They produce annual PDF reports with brand-tagged tables; OCR or hand-curated extraction is acceptable for a one-shot baseline but does not justify recurring infra.
- **Glassdoor / LinkedIn employer-page** workforce data remains off-limits under ToS. The annual Glassdoor "Best Places to Work" press-release list (~Top 100 / category, brand names public) is fine to mirror; the underlying ratings are not.
- **PCAOB inspection findings** are excellent quality but tie to audit *firms* (Deloitte, EY, PwC, KPMG, BDO), not to the audited public company. The cross-walk back to consumer brands requires SEC 10-K auditor disclosure — doable but not Sprint-priority.

---

## 2. Comparison table — net-new sources

| ID | Source | URL | What it covers | Access | License | Freshness | US-rel. | Diff. | Recommendation |
|----|--------|-----|----------------|--------|---------|-----------|---------|-------|----------------|
| G-1 | **SEC EDGAR 8-K Item 5.02 (executive/director departures)** | https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K | Every CEO/CFO/director departure, severance terms, appointment of replacements, since 2004 (~250k events) | EDGAR full-text search + bulk JSONL.GZ; parse Item 5.02 sub-headers | Public domain (US gov) | Real-time (filed within 4 business days of event) | Maximum | **S** | **BUILD NOW** — reuses existing SEC fetch infra |
| G-2 | **DOL OFLC LCA Disclosure Data (H-1B + H-1B1 + E-3)** | https://www.dol.gov/agencies/eta/foreign-labor/performance | Per-LCA: employer name, FEIN, occupation, wage offered, worksite, certified/denied; quarterly Q1FY26 currently shipped | Quarterly CSV/XLSX bulk download (~700k rows/yr) | Public domain | Quarterly, ~6 wk after quarter close | Maximum | **S** | **BUILD NOW** — clean CSV, employer-level rollup is trivial |
| G-3 | **DOL OFLC PERM (Green Card) Disclosure Data** | https://www.dol.gov/agencies/eta/foreign-labor/performance | Permanent labor certification filings by employer, occupation, wage; companion to LCA | Quarterly CSV/XLSX | Public domain | Quarterly | Maximum | **S** | **BUILD NOW** — same fetcher as G-2 |
| G-4 | **FMCSA SAFER + SMS data downloads** | https://ai.fmcsa.dot.gov/SMS/Tools/Downloads.aspx | Carrier-level safety scores, inspections, violations, crashes for every USDOT-registered motor carrier (~600k entities) | Monthly bulk CSV (Company Census + SMS Input + Crash) on DOT Open Data Portal | Public domain | Monthly (3rd Friday snapshot) | Maximum | **S** | **BUILD NOW** — covers UPS, FedEx, Amazon Logistics, Walmart Transportation, Sysco, US Foods, every CPG distributor |
| G-5 | **FRA Office of Safety — accident/incident data** | https://safetydata.fra.dot.gov/officeofsafety/publicsite/on_the_fly_download.aspx | Every reportable railroad accident, casualty, highway-rail crossing incident, by reporting railroad | On-the-fly CSV download + bulk datasets via data.transportation.gov | Public domain | Monthly | High (BNSF, UP, CSX, Norfolk Southern; rail-shipped commodities) | **S** | **BUILD NOW** — paired with G-4 closes the freight-safety signal |
| G-6 | **FAA Legal Enforcement Actions + Civil Penalty Cases** | https://www.faa.gov/about/office_org/headquarters_offices/agc/practice_areas/enforcement/reports | Closed enforcement actions (penalties, certificate suspensions) against airlines, repair stations, charter operators | Quarterly PDF report + searchable case-by-name HTML | Public domain | Quarterly | High (United, American, Delta, Southwest, Boeing, SpaceX, etc.) | **M** (PDF + HTML scrape) | **WAITLIST** — narrower coverage than G-4/G-5; build post-launch |
| G-7 | **ITEP "Corporate Tax Avoidance" data tables** | https://itep.org/corporate-tax-avoidance-trump-tax-law/ | 342 Fortune-500 companies × 5-yr (2018-2022) federal effective tax rate; "paid $0" flag | Published HTML/PDF reports with downloadable Excel appendix | Attribution required; non-commercial-friendly; we should request reuse permission for app-side display | Annual (latest 5-yr update Apr 2026) | Maximum | **S** | **BUILD NOW** — single XLSX import, ~342 high-signal rows |
| G-8 | **AFL-CIO Executive Paywatch** | https://aflcio.org/paywatch | S&P 500 CEO pay ratios, total compensation, year-over-year change | Annual interactive table (~500 rows); HTML scrape; site blocks WebFetch UA so use a real browser fetch | Public; attribute AFL-CIO | Annual (May release) | Maximum | **S** | **BUILD NOW** — corroborates our just-shipped DEF14A pay-ratio signal |
| G-9 | **Cornell ILR Labor Action Tracker** | https://striketracker.ilr.cornell.edu/ | Every US strike + labor protest since 2021, with employer name, union, location, # workers, duration | Interactive map; methodology page; **2021 + 2022 + 2023 + 2024 annual datasets published as CSV** | CC-BY (Cornell ILR + UIUC) | Annual full release; monthly methodology updates | Maximum | **S** | **BUILD NOW** — paired with NLRB-CATS (existing) for paired strike + ULP signal |
| G-10 | **BLS Work Stoppages program (WSP)** | https://www.bls.gov/wsp/ | Monthly + annual major work stoppages (≥1k workers, ≥1 shift) — establishment, union, days idle | HTML tables + downloadable XLSX | Public domain | Monthly | Maximum | **S** | **BUILD NOW** — official government corroboration of G-9 |
| G-11 | **PCAOB Firm Inspection Reports** | https://pcaobus.org/oversight/inspections/inspection-reports | Audit-firm inspection findings, deficiency rates by firm-year (Big-4 plus regional) | Per-firm PDF reports; no bulk feed | Public; attribute PCAOB | Annual per firm | Indirect (need 10-K auditor cross-walk) | **L** (PDF parsing + audit-firm→client mapping) | **WAITLIST** — high-value but high-effort; post-launch |
| G-12 | **Tax Justice Network — Corporate Tax Haven Index (data portal)** | https://cthi.taxjustice.net/ | Country-level scoring of jurisdictions enabling multinational tax avoidance; full dataset on TJN Data Portal | Bulk download CSV/XLSX from data.taxjustice.net | Free for non-commercial use; commercial requires permission — **license-check needed before app shipment** | Biennial | Indirect — used as country weights, not direct brand flags | **M** | **WAITLIST** — pair with G-7 if we expand to "subsidiary tax-haven exposure" using existing Exhibit-21 data |
| G-13 | **ProPublica Corporate Tax Profile / Reveal** | https://projects.propublica.org/nonprofits/ (and ProPublica enterprise reporting) | ProPublica's *Nonprofit* Explorer covers 990s (already DW-21, just shipped #24); ProPublica's separate Trump-tax-cut and "Secret IRS Files" corporate angles are **journalism, not a dataset** | Article text only | n/a | n/a | n/a | n/a | **SKIP** — there is no separate ProPublica corporate-tax API beyond Nonprofit Explorer (already integrated) |
| G-14 | **BLS Quarterly Census of Employment and Wages (QCEW)** | https://www.bls.gov/cew/ | Quarterly counts of establishments, employment, wages by 6-digit NAICS, state, county; covers ~95% of US jobs | Bulk CSV slices via QCEW Open Data Access | Public domain | Quarterly (~6 mo lag) | Maximum (industry baselines, not employer-named) | **S** | **WAITLIST** — used as denominator/baseline rather than per-brand flag; layer it after launch when scoring math needs industry context |
| G-15 | **NLRB Petitions + Voluntary Recognition (CATS) — voluntary recognition slice** | https://www.nlrb.gov/reports-guidance/reports/agency-performance-reports (CATS public dataset) | RC/RM/RD/UD/UC petitions, election results, voluntary recognition events by employer | Free dataset distribution via NLRB FOIA Reading Room + Cornell ILR mirrors | Public domain | Monthly | Maximum | **M** (NLRB direct downloads + Cornell ILR mirror; CATS is the canonical feed) | **BUILD NOW** — already in BACKLOG DW-50 but **voluntary-recognition** as a positive-signal slice is under-spec'd; flag it as part of the same pipeline |
| G-16 | **Cornell ILR Union Election Outcomes (mirror of NLRB CATS)** | https://www.ilr.cornell.edu/worker-institute/research-data/union-election-data | Cleaner per-election CSV (1999–present) with employer name + outcome, easier than raw NLRB | Direct CSV | Public; attribute Cornell ILR | Annual | Maximum | **S** | **BUILD NOW** — strictly easier path to the same data as G-15 |
| G-17 | **Strategic Organizing Center (SOC) Capital Markets reports** | https://thesoc.org/our-work/ | Brand-named investigative reports (Amazon DSP injury rates, Tesla labor, Starbucks union) | PDF reports; quarterly cadence | Public; attribute SOC | Quarterly | Maximum | **L** (NLP extraction from narratives) | **WAITLIST** — single-PDF mentions already cross with NLRB; not worth dedicated pipeline pre-launch |
| G-18 | **More Perfect Union investigations** | https://perfectunion.us/ | Brand-named worker-treatment investigations (Dollar General, Amazon, Starbucks) | Article archive; no structured dataset | Public; attribution | Continuous | High | **L** | **SKIP** — overlaps SOC + NLRB + DOL WHD with no incremental structured-data value |
| G-19 | **LaborNotes article archive** | https://labornotes.org/ | Investigative coverage of strikes, organizing campaigns by brand | Article archive only | Public; attribution | Continuous | High | **L** | **SKIP** — no structured dataset |
| G-20 | **ProxyMonitor.org (Manhattan Institute)** | https://www.proxymonitor.org/ | Database of shareholder proposals at Fortune 250 (~2008–present), with proponent, topic tag, vote outcome | Filterable scorecard with **CSV export** in UI; no documented API | Manhattan Institute terms; attribute; **email communications@manhattan.institute to confirm commercial reuse** | Annual proxy-season refresh | Maximum (F250 only) | **M** (CSV export per filter; ~10k rows historical) | **WAITLIST** — interesting governance signal but politically opinionated (right-leaning framing); revisit after license check |
| G-21 | **Council of Institutional Investors (CII) — historical Focus List** | https://www.cii.org/resources | Pre-2011 published "Focus List" of underperforming-governance firms; current Focus List is **members-only** | Wikipedia + academic mirrors hold historical list; current is paywalled | n/a (historical only) | Static (no new public releases) | Maximum (historical) | **L** (manual capture from academic papers) | **SKIP** — stale, members-only now |
| G-22 | **Latino Corporate Directors Association (LCDA) — Latino Board Monitor + CA Public-Company Board study** | https://latinocorporatedirectors.org/ca_public_company_boards.php | Annual report on Latino representation in Fortune 1000 + 662 CA-HQ public companies (incl. 233 "all-white-board" named companies) | Annual PDF report; **named-company table** | Public; attribute LCDA | Annual | Maximum | **M** (PDF table extraction; ~few hundred companies) | **BUILD NOW** — fills a category gap (Latino board representation), tiny scrape budget |
| G-23 | **Black Enterprise B.E. Registry of Corporate Directors** | https://www.blackenterprise.com/ ("Power in the Boardroom" annual feature) | Black corporate directors at S&P 500 / Fortune 500 | Annual print + web feature; **registry tables on web** | Public; attribute Black Enterprise | Annual | Maximum | **M** | **BUILD NOW** — paired with G-22 to fill non-white board-rep signal |
| G-24 | **Equilar 100 / 200 / NYT Highest-Paid CEOs annual table** | https://www.equilar.com/reports/ (NYT mirror publishes full table without paywall) | Highest-paid US public-company CEOs (Equilar 100 ≈ ≥$1B-revenue firms; Equilar 200 historical) | **NYT runs the full table free** each spring; Equilar's own site teases | Equilar TOS restricts redistribution; NYT republication is read-only; **store as comparative metric only, link out, don't republish raw** | Annual (Apr/May) | Maximum | **S** (~200 rows annually) | **WAITLIST** — corroborates our DEF14A pay-ratio data; not net-new; license risk |
| G-25 | **US SIF members directory** | https://www.ussif.org/ + https://www.ussif.org/assetowners | 200+ asset owners, asset managers, financial advisors who joined sustainable-investing trade body | HTML scrape of public member roster | Public; attribute US SIF | Annual | High (positive-signal for asset managers in our universe — BlackRock, State Street, Vanguard, Calvert, Trillium) | **S** | **WAITLIST** — most TruNorth users are consumer-grading not investor-grading; defer |
| G-26 | **AFL-CIO Strike Map** | https://aflcio.org/strike-map | Affiliate-authorized strikes — narrower than G-9 but officially blessed | HTML/JS map; data appears to be a JSON endpoint behind the map | Public; attribute AFL-CIO | Continuous | Maximum | **M** (JSON sniff) | **WAITLIST** — Cornell ILR Tracker (G-9) is broader; build only as cross-check |
| G-27 | **Federal Mediation & Conciliation Service work-stoppages dataset (1984–2020)** | https://catalog.data.gov/dataset?q=FMCS+work+stoppage | Historical stoppages incl. <1,000 workers, fills BLS WSP gap | data.gov CSV | Public domain | Static (program ended 2020) | High (historical baseline) | **S** | **WAITLIST** — useful for one-shot historical context, not ongoing |
| G-28 | **Glassdoor "Best Places to Work" annual press-release table** | https://www.glassdoor.com/Award/Best-Places-to-Work-LST_KQ0,19.htm | Top-100 (US Large, US SMB, Canada, UK, etc.) by category; brand-named list | HTML page (the **list** is public; ratings are not) | Public press release; attribute Glassdoor | Annual (January) | Maximum | **S** | **BUILD NOW** — single-page scrape, ~500 brand rows/year, positive signal, ToS-safe |
| G-29 | **IPEDS Human Resources component (higher-ed employer detail)** | https://nces.ed.gov/ipeds/ | Workforce composition for every Title-IV institution: race, gender, occupational breakdown, FT/PT | IPEDS Data Center CSV | Public domain | Annual | Indirect (universities only) | **S** | **SKIP** — universities aren't in our consumer-brand universe |
| G-30 | **USCIS H-1B Employer Data Hub** | https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub | Per-employer counts of H-1B *approvals* (vs. DOL OFLC which is LCA filings — different dataset) | Annual CSV | Public domain | Annual | Maximum | **S** | **BUILD NOW** — pair with G-2 (USCIS counts approvals, OFLC counts certifications; both useful) |
| G-31 | **The Conference Board ESG Center datasets** | https://www.conference-board.org/topics/esg | Aggregated S&P 500 governance practice trends (board diversity %, board age, etc.) | Member-only reports; only public version is press summaries with company-level tables | Members-only; press tables attributable | Annual | Maximum | **L** | **SKIP** — paywalled core data, not worth license push |
| G-32 | **BoardSource Leading with Intent (nonprofit) + Director DataPoints** | https://boardsource.org/research-critical-issues/leading-with-intent/ | Nonprofit board diversity research — not corporate boards | PDF reports | Public | Biennial | n/a (nonprofit, off-scope) | n/a | **SKIP** — off-scope (nonprofits, not consumer brands) |
| G-33 | **Salesforce / Gap / Intel-style voluntary pay-equity disclosures** | Company-by-company press releases | "Equal pay for equal work" annual reports — ~20-30 large public companies disclose | One-by-one curation | Public | Annual | High (limited coverage) | **M** | **WAITLIST** — start with G-2/G-3 first |
| G-34 | **SEC AAERs (Accounting and Auditing Enforcement Releases)** | https://www.sec.gov/divisions/enforce/friactions.shtml | Every SEC accounting-fraud enforcement action since 1990s | Press-release HTML index; PDF orders | Public domain | Continuous | Maximum | **M** (HTML + PDF scrape) | **BUILD NOW** — small dataset (~hundreds since 1990), every entry is an enforced accounting violation with named issuer; very high signal |
| G-35 | **SEC EDGAR — 8-K Item 4.02 (non-reliance on prior financials / restatements)** | EDGAR full-text by item code | Material restatements of prior financial statements | Same EDGAR feed as G-1, different item code | Public domain | Real-time | Maximum | **S** | **BUILD NOW** — shipped alongside G-1 in same 8-K parser; near-zero marginal cost |
| G-36 | **Public Citizen — executive pay / severance reports** | https://www.citizen.org/ | Periodic named reports on extreme severance packages (no standing "Severance Watch" database confirmed in search) | One-off PDF reports | Public; attribution | Irregular | High | **L** | **SKIP** — no structured dataset; signal already captured via DEF14A + 8-K Item 5.02 (G-1) |
| G-37 | **IUF (International Union of Food Workers) corporate campaigns** | https://www.iuf.org/ | Active corporate campaigns (Nestlé, Pepsi, Starbucks, JBS, etc.) | News-style site; no structured dataset | Public; attribution | Continuous | Medium (international) | **L** | **SKIP** — overlaps BHRRC (existing) |

---

## 3. Top 15 ranked

Ranking is composite of **(signal density × US-coverage × ease-of-integration × distinctness from existing sources)**.

| Rank | ID | Source | Why it ranks |
|------|----|--------|-------------|
| 1 | G-1 | SEC 8-K Item 5.02 | Real-time executive-departure feed; every named officer change; reuses EDGAR infra |
| 2 | G-4 | FMCSA SMS | Single bulk feed covers safety for every USDOT carrier; touches Amazon Logistics, FedEx, UPS, Walmart Transport, Sysco, and every CPG distributor |
| 3 | G-2 | DOL OFLC LCA disclosure | Per-employer H-1B + wage data; clean quarterly CSV; visibility on tech/finance/consumer hiring practices |
| 4 | G-9 | Cornell ILR Labor Action Tracker | Cleanest US strikes dataset; CSV + CC-BY; high topical resonance |
| 5 | G-7 | ITEP Corporate Tax Avoidance | 342 named Fortune-500 companies × federal effective tax rate; clean XLSX, "$0 federal tax" headline flag |
| 6 | G-5 | FRA accident/incident data | Every US railroad accident; complements G-4 |
| 7 | G-34 | SEC AAERs | Every enforced accounting fraud, named issuer, since 1990 |
| 8 | G-8 | AFL-CIO Executive Paywatch | Corroborates DEF14A pay-ratio with NGO badge; broad press recognition |
| 9 | G-30 | USCIS H-1B Employer Data Hub | Approvals (vs. LCA filings); per-employer counts; pairs with G-2 |
| 10 | G-3 | DOL OFLC PERM disclosure | Same fetcher as G-2; green-card sponsorship transparency |
| 11 | G-16 | Cornell ILR Union Election Outcomes | Easier path to NLRB CATS data |
| 12 | G-35 | SEC 8-K Item 4.02 (restatements) | Free piggyback on G-1 parser |
| 13 | G-28 | Glassdoor BPTW annual lists | ToS-safe positive signal; one page/year |
| 14 | G-22 | LCDA Latino Board Monitor | Fills Latino-board-rep gap; small annual extract |
| 15 | G-23 | Black Enterprise B.E. Registry | Fills Black-board-rep gap; small annual extract |

---

## 4. Top 8 for next sprint — with effort estimates

These are everything ranked 1–8 above, sequenced for a single ~5-day "data sprint" before Jun 17 App Store cut.

| # | ID | Source | Effort (developer-hours) | Output | Notes |
|---|----|--------|--------------------------|--------|-------|
| 1 | G-1 + G-35 | SEC 8-K Items 5.02 & 4.02 | **4–6 h** | `data/raw/sec-8k/` + augment JSON keyed by CIK | Single fetcher; parse item codes; the existing SEC EDGAR pull pattern (DEF14A, Form 4) is the blueprint. Daily cron, 5-yr lookback for initial backfill. |
| 2 | G-4 | FMCSA SMS | **3–4 h** | `data/raw/fmcsa-sms/` monthly snapshot | Single ZIP download, NAICS-filterable; carrier-name fuzzy-join to existing brand-parent-map |
| 3 | G-2 + G-3 | DOL OFLC LCA + PERM | **3–4 h** | `data/raw/dol-oflc/` quarterly snapshots | Two XLSX bulk files; one fetcher; aggregate per employer FEIN |
| 4 | G-9 | Cornell ILR Labor Action Tracker | **2–3 h** | `data/raw/ilr-labor-action-tracker/` | Annual CSV; brand-name fuzzy join; small rows (~1.5k events/yr) |
| 5 | G-7 | ITEP Corporate Tax Avoidance | **2 h** | `data/raw/itep-tax-avoidance/` | Single XLSX appendix; ~342 rows; one-shot annual cron + manual license-attribution review |
| 6 | G-5 | FRA accident/incident | **2–3 h** | `data/raw/fra-safety/` | On-the-fly CSV + bulk; ~5k events/yr |
| 7 | G-34 | SEC AAERs | **3–4 h** | `data/raw/sec-aaer/` | HTML index scrape + PDF text extraction for issuer name; ~50–80 actions/yr |
| 8 | G-8 | AFL-CIO Executive Paywatch | **2 h** | `data/raw/aflcio-paywatch/` | Annual scrape; ~500 rows; needs real-browser UA (Vercel function returned 403 in test) |

**Sprint total:** roughly **21–28 developer-hours**, fits inside a 3-day focused push if pipelined like DW-7-to-17 was.

**Important order-of-operations:**
- G-1+G-35 **first** (SEC infra reuse, biggest signal payoff, lowest risk)
- G-4, G-5 **parallel** (separate DOT subagencies, no integration coupling)
- G-2+G-3 together (same fetcher)
- G-7 needs **license-attribution review** with ITEP before app-side surfacing — kick off the email Mon Jun 9 so reply lands before launch

---

## 5. Skip list (with reasons)

| ID | Source | Skip reason |
|----|--------|-------------|
| G-13 | ProPublica "Corporate Tax Profile" | No separate corporate dataset; 990 Nonprofit Explorer already shipped #24 |
| G-18 | More Perfect Union | Journalism only, no structured dataset; brand mentions already cross with NLRB/WHD |
| G-19 | LaborNotes | Same — articles only |
| G-21 | CII current Focus List | Members-only since 2011; historical list is academic-paper-only |
| G-29 | IPEDS HR | Universities, not consumer brands |
| G-31 | The Conference Board ESG Center | Paywalled core data; press tables thin |
| G-32 | BoardSource (nonprofit board diversity) | Off-scope |
| G-36 | Public Citizen "Executive Severance Watch" | Could not confirm a maintained database; G-1 (8-K Item 5.02) captures named severance disclosures |
| G-37 | IUF | International union, narrative-only, overlaps BHRRC |
| **(prefiltered)** | Diligent / GMI Ratings | Paywalled |
| **(prefiltered)** | Refinitiv ESG | Paywalled |
| **(prefiltered)** | BoardEx | Expensive paid; not worth |
| **(prefiltered)** | Reputation Institute | Paywalled |
| **(prefiltered)** | LinkedIn corporate page data | ToS scraping risk |
| **(prefiltered)** | Glassdoor employer ratings beyond press releases | ToS scraping risk (G-28 BPTW press lists are the only safe slice) |

---

## 6. Notes on license / ToS hygiene before app-side display

Three items in the **Build Now** list need active-attribution checks before user-facing strings ship:

- **G-7 ITEP** — request explicit reuse permission for in-app numeric display (effective-tax-rate %). Email contact via itep.org/about/contact. Default to "(source: ITEP)" linkout if no reply.
- **G-8 AFL-CIO Paywatch** — public site, but they prefer "AFL-CIO Executive Paywatch (2026)" attribution. Embed a one-line credit on the brand detail card.
- **G-9 Cornell ILR Labor Action Tracker** — CC-BY 4.0; attribution "Cornell ILR + UIUC Labor Action Tracker" + URL.

Everything else in the Build-Now top-8 is **public domain (US federal data)** and needs only a generic data-source page acknowledgement.

---

## 7. Cross-references to existing BACKLOG

For the maintainer reading this later:

- **G-15/G-16 NLRB Voluntary Recognition** overlaps **DW-50 NLRB CATS** already on waitlist — these notes argue for promoting the "voluntary recognition as positive signal" sub-slice as part of the same PR
- **G-12 TJN Corporate Tax Haven Index** pairs naturally with our shipped **SEC 10-K Exhibit 21** data (subsidiary jurisdictions) for a possible post-launch "tax-haven exposure" sub-score
- **G-14 BLS QCEW** is the right baseline-denominator dataset for *any* future "company size / industry norm" calculations; not a signal source itself
- **G-24 Equilar 200** corroborates **shipped PR #21 DEF14A pay-ratio** — license risk argues for "link-out only" rather than re-ingestion

---

## 8. Source URLs (all cited)

- SEC EDGAR: https://www.sec.gov/edgar
- SEC AAER index: https://www.sec.gov/divisions/enforce/friactions.shtml
- DOL OFLC Performance Data: https://www.dol.gov/agencies/eta/foreign-labor/performance
- OFLC LCA historical dataset (data.gov): https://catalog.data.gov/dataset/labor-condition-application-for-nonimmigrant-workers-lca-program-historical-data
- USCIS H-1B Employer Data Hub: https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub
- FMCSA Open Data: https://www.fmcsa.dot.gov/registration/fmcsa-data-dissemination-program
- FMCSA SMS Downloads: https://ai.fmcsa.dot.gov/SMS/Tools/Downloads.aspx
- FRA Safety Data: https://railroads.dot.gov/safety-data
- FRA on-the-fly download: https://safetydata.fra.dot.gov/OfficeofSafety/publicsite/on_the_fly_download.aspx
- FAA Enforcement Reports: https://www.faa.gov/about/office_org/headquarters_offices/agc/practice_areas/enforcement/reports
- FAA Civil Penalty Cases: https://www.faa.gov/about/office_org/headquarters_offices/agc/practice_areas/adjudication/civil_penalty/CaseFile/all
- BLS Work Stoppages: https://www.bls.gov/wsp/
- BLS QCEW: https://www.bls.gov/cew/
- Cornell ILR Labor Action Tracker: https://striketracker.ilr.cornell.edu/
- Cornell ILR Union Election Outcomes: https://www.ilr.cornell.edu/worker-institute/research-data/union-election-data
- AFL-CIO Executive Paywatch: https://aflcio.org/paywatch
- AFL-CIO Strike Map: https://aflcio.org/strike-map
- ITEP Corporate Tax Avoidance landing: https://itep.org/corporate-tax-avoidance/
- ITEP 5-yr 2018–2022 report: https://itep.org/corporate-tax-avoidance-trump-tax-law/
- Tax Justice Network CTHI: https://cthi.taxjustice.net/
- TJN Data Portal: https://taxjustice.net/indexes-tools/
- PCAOB inspection reports: https://pcaobus.org/oversight/inspections/inspection-reports
- ProxyMonitor: https://www.proxymonitor.org/
- CII: https://www.cii.org/
- LCDA: https://latinocorporatedirectors.org/
- LCDA CA Public Company Boards: https://latinocorporatedirectors.org/ca_public_company_boards.php
- Black Enterprise: https://www.blackenterprise.com/
- US SIF: https://www.ussif.org/
- Equilar 100/200 (NYT mirror): https://www.equilar.com/reports/
- Glassdoor Best Places to Work: https://www.glassdoor.com/Award/Best-Places-to-Work-LST_KQ0,19.htm
- FMCS Work Stoppages 1984–2020: https://catalog.data.gov/dataset?q=FMCS+work+stoppage
- Conference Board ESG Center: https://www.conference-board.org/topics/esg
- BoardSource: https://boardsource.org/
- Strategic Organizing Center: https://thesoc.org/our-work/
- More Perfect Union: https://perfectunion.us/
- LaborNotes: https://labornotes.org/
- IUF: https://www.iuf.org/
- Public Citizen: https://www.citizen.org/

---

*End of report — ~3,400 words.*
