# Data-source research — Round 5 (2026-06-09)

Round 5 of the data-source-discovery program. Prior rounds (R1–R4) and the
exclusion list in the project brief covered most US federal, EU member-state
regulators, NGO certifications, B Corp / Fair-Trade-style certifiers, and
the big 28-outlet investigative-journalism corpus. R5 deliberately targets
the **gaps Aron flagged** in the brief: regional/geographic, sector
verticals we cover thinly, methodology angles we don't have, and
issue-specific NGO benchmarks beyond what's already wired in.

Every source below was verified by fetching the URL or its hosting page
during research. Sources that turned out to duplicate something we already
ingest, were paywalled, or had been retired (e.g. GRI's discontinued
public database, BBFAW already in inventory, Cornell ILR already in
strike-map) were dropped before reaching this doc.

---

## 1. Geographic gaps

### 1.1 OECD National Contact Points (NCP) specific instances database — global
- **URL**: https://www.oecd.org/en/networks/national-contact-points-for-responsible-business-conduct/database.html
- **OECD Watch mirror**: https://www.oecdwatch.org/complaints-database/
- **Covers**: 700+ NCP cases across 110+ countries — non-judicial human-rights / environment / labour grievance complaints filed against named multinationals under the OECD Guidelines. Searchable by company, sector, issue, country.
- **Why it fits**: The single best source for international-grievance signals against multinationals from countries we under-cover (Africa beyond SA, MENA, SE Asia, Latin America, Central Asia). Each case has a "final statement" PDF with the company name, allegations, and outcome.
- **Accessibility**: Public web search; OECD Watch publishes a structured database. No formal API but pages render server-side and are scrapable. PDFs are linked per case.
- **Brand reach**: ~400 distinct multinationals — high overlap with TruNorth's index (Glencore, Shell, Total, Nestlé, Unilever, JBS, Vale, BHP, Adidas, H&M, Apple suppliers, etc.).
- **Priority**: **P0**

### 1.2 Land Matrix — global large-scale land acquisitions
- **URL**: https://landmatrix.org/
- **GitHub mirror**: https://github.com/sinnwerkstatt/landmatrix
- **Covers**: 2,000+ land deals 200ha+ since 2000 across ~100 low/middle-income countries (Africa, SE Asia, Latin America, Pacific). Each deal names investor, target country, hectares, intended use (agro, timber, renewables, conservation, tourism), and status.
- **Why it fits**: Direct hit for our Africa/SE-Asia/Pacific gap. Surfaces the agribusiness/timber/biofuel/mining brands behind land-grabs.
- **Accessibility**: Open-data dump on GitHub; web UI also exposes JSON. Free, CC license.
- **Brand reach**: ~600 investor companies; ~150 likely TruNorth matches (ADM, Cargill, Bunge, Olam, Wilmar, Sime Darby, IOI, Marubeni, Mitsui, Aliko Dangote Group, etc.).
- **Priority**: **P0**

### 1.3 South Africa B-BBEE Commission compliance registry
- **URL**: https://www.bbbeecommission.co.za/
- **Covers**: B-BBEE certificates and complaint outcomes for South African operations of multinationals — only mandatory DEI scoring regime in the world. Public registry of compliance reports + Major B-BBEE Transactions database.
- **Why it fits**: SA is the only Africa country in our exclusion list, and this is the canonical DEI signal for SA-operating brands. Useful for the global DEI category as a non-US benchmark.
- **Accessibility**: Online portal; PDFs and per-company pages. No public API but scrapable.
- **Brand reach**: ~200 multinationals operating in SA (Anglo American, Standard Bank, MTN, Naspers, Shoprite, Sasol, AB InBev SA, etc.).
- **Priority**: **P2** (regional, but a documented gap)

### 1.4 South Korea KFTC enforcement decisions
- **URL**: https://www.ftc.go.kr/eng/index.do (English) — decision archive at /eng/contents.do
- **Covers**: KFTC sanctions for cartel, abuse-of-dominance, unfair-subcontracting, and false-advertising violations. Per-decision PDFs name companies and penalties. KFTC has been aggressive against Apple, Google, Qualcomm, Microsoft, Coupang, and chaebols.
- **Why it fits**: Closes our APAC enforcement gap (we only have JFTC, China SAMR, CCI India, CCCS Singapore). South Korea is the world's 12th largest economy.
- **Accessibility**: HTML decisions + PDF rulings; English summaries published monthly. Scrapable.
- **Brand reach**: 100+ multinationals/year with named penalties.
- **Priority**: **P1** (was previously parked; brief specifically lists it as a gap)

### 1.5 Brazil CADE antitrust decisions
- **URL**: https://en.cade.gov.br/ and https://www.gov.br/cade/pt-br
- **Covers**: Brazilian antitrust authority — cartel investigations, abuse-of-dominance, merger conditions. Public docket includes named-respondent decisions.
- **Why it fits**: Brazil is largest LatAm market; previously parked; explicitly listed as a brief gap.
- **Accessibility**: Decisions exposed via gov.br portal, scrapable. Daily press releases name parties.
- **Brand reach**: ~200 multinationals/year (Ambev, JBS, Vale, Petrobras, plus US/EU MNCs operating in Brazil).
- **Priority**: **P1**

### 1.6 SOMO — Centre for Research on Multinational Corporations
- **URL**: https://www.somo.nl/publications/
- **Covers**: 50+ years of investigative reports naming multinationals — electronics, energy, minerals, agri, apparel, pharma, finance. Each report names companies and their alleged role in specific harms. Strong coverage of Asia (Bangladesh, India, Indonesia, Philippines) and Africa supply chains.
- **Why it fits**: Fills the "investigative journalism" angle for non-Western supply-chain stories that ProPublica/Bloomberg may miss. Already used as a feeder source by BHRRC, but the underlying SOMO corpus is independently citeable.
- **Accessibility**: PDF reports + HTML index, no API, but ~12 reports/year. Manual extraction or full-text PDF scrape.
- **Brand reach**: 100–150 named companies/year, mostly tech / extractives / apparel — high overlap with our index.
- **Priority**: **P1**

---

## 2. Sector gaps

### 2.1 Real estate / construction — Eviction Lab corporate landlord data
- **URL**: https://evictionlab.org/
- **Specific dataset**: https://evictionlab.org/eviction-tracking/ (corporate landlord scorecards in select cities)
- **Covers**: 80M+ US eviction records 2000-present + named "corporate landlord" tracker for major REITs (Invitation Homes, Tricon, Progress Residential, Greystar, American Homes 4 Rent, etc.). Includes serial-eviction-filer rates per landlord.
- **Why it fits**: The brief flags real estate as a thin category. Eviction-filing rates are the single best public-records labor/community signal for residential REITs and corporate landlords.
- **Accessibility**: Bulk downloads (CSV) freely available; corporate-landlord scorecards as JSON.
- **Brand reach**: ~50 major corporate landlords; expandable to the ~300 publicly traded residential REITs.
- **Priority**: **P0**

### 2.2 HUD OIG enforcement & multifamily REAC inspection scores
- **URL**: https://www.hud.gov/program_offices/housing/mfh/rfp/inventory_rt and https://www.hudoig.gov/library/audit-reports
- **Covers**: REAC physical-inspection scores (1-100) on every HUD-subsidized multifamily property + HUD-OIG audit findings (fraud, mismanagement) on named owners/managers/developers.
- **Why it fits**: Captures landlord/REIT quality, not just evictions. HUD-OIG already in our list but we only catch *enforcement actions*, not REAC scores tied to owners.
- **Accessibility**: REAC scores on HUD data portal as CSV; owner field links to corporate parents. May require WAF workaround as noted in R4.
- **Brand reach**: ~200 affordable-housing developers / REITs.
- **Priority**: **P2** (data acquisition is fiddly; lower priority than 2.1)

### 2.3 Education / EdTech — College Scorecard + DOE Borrower Defense
- **URL**: https://collegescorecard.ed.gov/ + https://studentaid.gov/data-center/student/loan-forgiveness/borrower-defense-data
- **Covers**: For-profit college outcomes (gainful employment, debt-to-earnings ratio, repayment rates) and Borrower Defense to Repayment claims by institution (which surfaces large-scale fraud findings against for-profit chains).
- **Why it fits**: Explicit brief gap — beyond Common Sense Privacy we lack EdTech / for-profit-college coverage. Borrower-Defense data is the qui-tam equivalent for higher-ed.
- **Accessibility**: Open data, downloadable CSVs.
- **Brand reach**: ~100 for-profit / online colleges (University of Phoenix, Grand Canyon, DeVry, Strayer, Capella, Western Governors, Liberty, ITT/Westwood/Argosy legacies, Kaplan, Stride, Chegg).
- **Priority**: **P1**

### 2.4 Sports / entertainment / media labor — UnionFacts entertainment vertical
- **URL**: https://www.unionfacts.com/
- **Covers**: Lists labor-law charges by employer including studios, networks, sports teams. Privately operated but free; aggregates NLRB + DOL data with entertainment-industry vertical cuts.
- **Why it fits**: Brief lists sports/entertainment labor as a gap. UnionFacts indexes the studio/network/team employer side. (Cornell ILR Labor Action Tracker is already ingested via B-strike-map.)
- **Accessibility**: HTML, scrapable, no API. Right-of-center political slant — must be filtered.
- **Priority**: **P2** (slant-risk; verify against NLRB primary data we already ingest)

### 2.5 Insurance — Insure Our Future scorecard
- **URL**: https://insure-our-future.com/scorecard/
- **Covers**: 30 global re/insurers scored 0-10 on coal, oil & gas underwriting + investments. Annual scorecard PDFs include per-company breakdown.
- **Why it fits**: Brief flags "insurance beyond NAIC" — we have NAIC complaints, A.M. Best ratings, but no climate-insurance signal. This is the canonical one.
- **Accessibility**: Annual PDF with structured tables; per-company landing pages at insure-our-future.com/company/<slug>.
- **Brand reach**: 30 named insurers (AIG, Allianz, Aviva, AXA, Berkshire, Chubb, Hartford, Liberty Mutual, Lloyd's, Munich Re, Progressive, Swiss Re, Tokio Marine, Travelers, Zurich, etc.).
- **Priority**: **P0**

### 2.6 Defense — SIPRI Arms Industry Top-100 Database
- **URL**: https://www.sipri.org/databases/armsindustry
- **Top 100 list**: https://www.sipri.org/visualizations/2025/sipri-top-100-arms-producing-and-military-services-companies-world-2024
- **Covers**: Annual arms-sales revenue 2002–2024 for the 100 largest arms producers/military-services companies globally — US, EU, Russia, China, Israel, South Korea, India, Turkey, Brazil. Interactive Tableau dashboard + downloadable CSV.
- **Why it fits**: Brief flags "defense / weapons beyond Norway GPFG" as a gap. SIPRI Top-100 is the canonical structured list with revenue weighting (so we can score by *concentration* of arms revenue, not just inclusion). Complements GPFG exclusions.
- **Accessibility**: Free CSV via SIPRI; visualizations are scrapable.
- **Brand reach**: 100 named producers, near-100% relevant.
- **Priority**: **P0**

### 2.7 Crypto / fintech — FINRA Disciplinary Actions + FINRA BrokerCheck (firm-level)
- **URL**: https://www.finra.org/rules-guidance/oversight-enforcement/finra-disciplinary-actions-online + https://brokercheck.finra.org/
- **OpenSanctions FINRA feed**: https://www.opensanctions.org/datasets/us_finra_actions/
- **Covers**: Every FINRA disciplinary action 2005-present against broker-dealers (firm-level), with AWCs, settlements, complaints, and arbitration awards. Includes crypto-broker firms now under FINRA jurisdiction (Robinhood, Webull, eToro US, etc.).
- **Why it fits**: Brief flags "crypto/fintech beyond NYDFS" — FINRA's firm-level enforcement is the natural complement to NYDFS state-level. OpenSanctions even publishes the FINRA actions as a dataset which gives us a turnkey ingestion path.
- **Accessibility**: OpenSanctions ZIP feed (JSON-lines), plus FINRA's own search portal.
- **Brand reach**: ~500 broker-dealer firms; ~50 fintech-relevant (Robinhood, Coinbase brokerage arm, SoFi Securities, Webull, M1 Finance, Public, Charles Schwab, Fidelity, Vanguard).
- **Priority**: **P0**

### 2.8 Heavy industry / mining — BHRRC Transition Minerals Tracker
- **URL**: https://www.business-humanrights.org/en/from-us/transition-minerals-tracker/
- **Covers**: Human-rights allegations against 250+ companies producing the 6 transition minerals (cobalt, copper, lithium, manganese, nickel, zinc) tied to renewable-energy supply chains. 510 allegations 2010-2022 across Peru, Chile, DRC, Indonesia, etc.
- **Why it fits**: Brief flags "heavy industry / mining beyond MSHA". MSHA is US-only and OSHA-style. This is global, supply-chain-linked, and ties to climate / EV / battery brands.
- **Accessibility**: HTML dashboard + structured CSV download; BHRRC already in our list but the Transition Minerals Tracker is a separate dataset we haven't ingested.
- **Brand reach**: ~250 mining majors (Glencore, BHP, Vale, Rio Tinto, Anglo, Norilsk, Codelco, Antofagasta, Sumitomo Metal Mining, Tianqi, Ganfeng, MMG, First Quantum, etc.).
- **Priority**: **P0**

---

## 3. Methodology gaps

### 3.1 State worker-safety — CARB Enforcement Data Portal (CA, then template for other states)
- **URL**: https://ww2.arb.ca.gov/our-work/programs/enforcement-policy-reports/enforcement-data-portal
- **Covers**: All California Air Resources Board enforcement actions 2022+ — citations, settlements, penalties — by company. Trucking, fuels, refineries, manufacturers. The brief's "CA-CARB-parked" item.
- **Why it fits**: Direct unblocking of a parked source. CARB is the toughest state environmental regulator in the country; brand attribution is straightforward (carriers, refiners, vehicle manufacturers).
- **Accessibility**: Interactive dashboard; CSV export available. Quarterly enforcement-summary PDF.
- **Brand reach**: ~500 companies; ~100 likely TruNorth matches (fleet operators, oil majors, auto makers, refineries, AB InBev, etc.).
- **Priority**: **P0** (un-parks the brief's stated todo)

### 3.2 State worker-safety — Cal/OSHA citations (un-park the brief's Cal-OSHA-parked item)
- **URL**: https://www.dir.ca.gov/dosh/dosh_enforcement_activity.html — but actual searchable data routes through OSHA's IMIS at https://www.osha.gov/ords/imis/establishment.html
- **Covers**: Cal/OSHA logs into the federal IMIS database alongside fed OSHA. Establishment-level inspection history, citations, penalties.
- **Why it fits**: Brief calls it out as a methodology gap ("state-level worker safety beyond Cal-OSHA-parked"). Federal OSHA Severe Injury Reports and ALL violations are already ingested, but Cal/OSHA covers state-plan states (CA, NJ, NY public sector, OR, WA, KY, MN, NM, etc.). Adding the state-plan filter to our existing OSHA fetch is the cheapest possible delta.
- **Accessibility**: Already ingestible via existing OSHA ingestion — just need to drop the federal-only filter.
- **Brand reach**: Hundreds of CA-operating brands not currently captured.
- **Priority**: **P1** (cheap, high-leverage delta to existing pipeline)

### 3.3 State political donations — FollowTheMoney (National Institute on Money in Politics)
- **URL**: https://www.followthemoney.org/
- **Covers**: 50-state campaign contributions, ballot-measure spending, lobbying expenditures for every state-level race + ballot measure. $100B+ documented. Now in transition to integrate with OpenSecrets but the legacy DB is intact.
- **Why it fits**: Brief explicitly flags "state-level political donations beyond OpenSecrets federal". This is the canonical source. OpenSecrets handles FEC; FollowTheMoney handles state.
- **Accessibility**: Web UI + CSV exports per query; bulk dumps available on request. No standing API but the data is queryable.
- **Brand reach**: ~20,000 corporate donors documented; thousands overlap with TruNorth index.
- **Priority**: **P0**

### 3.4 State environmental enforcement — TCEQ (Texas) enforcement reports
- **URL**: https://www.tceq.texas.gov/compliance/enforcement/enforcement-reports
- **Covers**: Monthly + annual TCEQ enforcement orders, penalties, and respondent companies. Texas is the largest state by industrial emissions outside California.
- **Why it fits**: Brief flags "state-level environmental enforcement beyond what we have". TX is the highest-leverage delta — petrochem corridor, fracking, refining, plastics.
- **Accessibility**: Monthly PDF + spreadsheet downloads; web UI for searching.
- **Brand reach**: ~300 named respondents/year (Exxon, Chevron, Valero, Marathon, Dow, Formosa Plastics, etc.).
- **Priority**: **P1**

### 3.5 Whistleblower complaint volume — SEC Office of Whistleblower annual reports
- **URL**: https://www.sec.gov/enforcement-litigation/whistleblower-program (annual report PDFs)
- **Covers**: Annual report lists the number of tips received by topic (insider trading, accounting fraud, market manipulation, FCPA, etc.) and by company-respondent when public. Plus award notices when whistleblower payouts are made — those notices reference the underlying enforcement action which names the company.
- **Why it fits**: Brief flags "whistleblower complaint databases". SEC's annual report is the only public signal at the firm level.
- **Accessibility**: Annual PDFs; structured tables for awards. Each award notice cross-references an enforcement action in the SEC litigation feed (which we already ingest), giving a "whistleblower-triggered" boolean.
- **Brand reach**: ~50 companies/year tied to whistleblower awards.
- **Priority**: **P2** (mostly enriches existing SEC data with a "whistleblower-flagged" boolean)

### 3.6 Government contractor spending — USAspending.gov API
- **URL**: https://api.usaspending.gov/ (free, no API key)
- **Covers**: Every federal contract, grant, loan, direct payment since FY2008. Filter by recipient_name, agency, NAICS, fiscal year. Linkable to SAM.gov entities.
- **Why it fits**: Brief flags "government contractor SAM.gov contracts beyond debarments". We have OFAC/BIS/SAM debarments but no contract-volume signal. Useful for the "defense supplier" / "ICE supplier" / "federal contractor concentration" angles.
- **Accessibility**: Open REST API, no auth.
- **Brand reach**: Tens of thousands of contractors. Top 200 awardees would cover most TruNorth-relevant brands.
- **Priority**: **P1**

### 3.7 Health-insurance claim-denial rates — KFF + CMS Transparency in Coverage PUF
- **URL**: https://data.healthcare.gov/dataset/5c232812-fc30-4dd7-8af7-015ce0073eb8 (CMS PUF) + KFF analysis at https://www.kff.org/patient-consumer-protections/claims-denials-and-appeals-in-aca-marketplace-plans-in-2024/
- **Covers**: Annual issuer-level claim denial rates on ACA marketplace plans. 2024 data: Oscar 25.3%, Molina 22%, Kaiser ~6%. Plan-level breakdown available too.
- **Why it fits**: Brief explicit gap — "health-insurance denial rates / claim disputes". This is the cleanest signal: a single number per insurer.
- **Accessibility**: CMS PUF as free CSV; KFF provides a curated downloadable working file. Annual update.
- **Brand reach**: ~150 ACA marketplace issuers (UnitedHealthcare, Anthem/Elevance, CVS Aetna, Cigna, Humana, Centene/Ambetter, Kaiser, Molina, Oscar, Blue-Cross plans).
- **Priority**: **P0**

### 3.8 Patent litigation — Stanford NPE Litigation Database
- **URL**: https://npe.law.stanford.edu/
- **Covers**: Every federal patent-infringement case 2000+ tagged by whether plaintiff is a practicing entity, NPE/PAE/troll, or university. Identifies repeat-defendant brands hit hardest by patent trolls + repeat-plaintiff aggressive patent assertors.
- **Why it fits**: Brief flags "patent litigation / IP disputes" as a methodology gap.
- **Accessibility**: Public web; data available on request from Stanford. Can be substituted with RECAP/CourtListener patent-case scrape.
- **Brand reach**: Major tech, auto, pharma, retail (Apple, Samsung, Google, Amazon, Microsoft, Cisco, Ford, GM, Pfizer, Merck, Walmart, Target).
- **Priority**: **P2** (NPE signal is subtle — being sued by a troll is not really a brand value signal; being a troll plaintiff is)

### 3.9 NAAG Multistate Settlements Database
- **URL**: https://www.naag.org/news-resources/research-data/multistate-settlements-database/
- **Covers**: Lists every multistate AG settlement (consumer protection, antitrust, false claims, data privacy, opioid) with respondent companies and settlement amounts.
- **Why it fits**: Brief flag — "state attorney general consumer protection enforcement database multi-state". We currently catch only ~12 state AGs individually. NAAG complements them by capturing settlement-only outcomes (no docket) and joint actions where the lead AG isn't one of our 12.
- **Accessibility**: Public search UI; no API but scrapable.
- **Brand reach**: ~300 large-settlement defendants over its life.
- **Priority**: **P0**

### 3.10 State PUC decisions — California CPUC + Pennsylvania PUC dockets (templates for 50 states)
- **URLs**: https://docs.cpuc.ca.gov/SearchRes.aspx (CA), https://www.puc.pa.gov/search/docket-search/ (PA)
- **Covers**: Public Utilities Commission rate cases, enforcement, safety investigations against named utilities. CPUC has issued multi-billion fines against PG&E (wildfires), SoCalGas (Aliso Canyon).
- **Why it fits**: Brief explicitly lists "state public utility commission decisions" as a methodology gap. Highest leverage for investor-owned utilities.
- **Accessibility**: Per-state docket search; CA + PA expose full-text via search. NARUC publishes a directory of all 50 PUC websites.
- **Brand reach**: 50-100 investor-owned utilities (PG&E, Edison Intl, Sempra, NextEra/FPL, Duke, Dominion, Southern Co, Exelon, AEP, Xcel, etc.).
- **Priority**: **P1** (start with the top-5 utility states: CA, TX, FL, NY, IL)

### 3.11 Class-action settlements — CourtListener RECAP settlement-tagged dockets
- **URL**: https://www.courtlistener.com/recap/
- **Covers**: Free Law Project's RECAP indexes hundreds of millions of federal-court docket entries from PACER. We can filter on settlement-class types to surface class-action settlements by defendant.
- **Why it fits**: Brief flag — "class-action settlement databases beyond CourtListener" — but CourtListener itself is the gateway to a settlement-tagged docket-entry view we don't yet ingest. Pair with §3.9 for the AG-side.
- **Accessibility**: Documented free REST API.
- **Brand reach**: Most major federal-court defendants over time.
- **Priority**: **P1**

---

## 4. NGO / academic depth

### 4.1 Foundation Model Transparency Index (FMTI) — Stanford CRFM
- **URL**: https://crfm.stanford.edu/fmti/
- **GitHub**: https://github.com/stanford-crfm/fmti
- **Covers**: Annual 0-100 transparency score for 13+ flagship foundation-model developers (OpenAI, Anthropic, Google, Meta, Amazon, IBM, AI21, Writer, Alibaba, DeepSeek, Midjourney, Mistral, xAI).
- **Why it fits**: Brief explicit gap — "AI ethics / algorithmic accountability". This is the canonical AI-transparency benchmark with structured per-company scores.
- **Accessibility**: GitHub repo with the scoring matrix as JSON/CSV.
- **Brand reach**: 13 today; FMTI says it expands annually.
- **Priority**: **P0**

### 4.2 AlgorithmWatch AI Ethics Guidelines Global Inventory + decision-system case studies
- **URL**: https://algorithmwatch.org/en/ai-ethics-guidelines-global-inventory/
- **Covers**: 167+ corporate/governmental AI-ethics guidelines + investigative reports on company AI deployments (Meta moderation, Apple Card credit-scoring, Uber driver-deactivation, etc.).
- **Why it fits**: Complements FMTI with a "voluntary commitments" signal — flags companies that have *published* an AI-ethics policy vs not. Plus investigative reporting that names companies in algorithmic-harm cases.
- **Accessibility**: HTML directory + reports.
- **Brand reach**: ~80 named corporates with published AI-ethics docs.
- **Priority**: **P2**

### 4.3 Forest 500 (Global Canopy)
- **URL**: https://forest500.org/
- **Covers**: 350 companies + 150 financial institutions with greatest exposure to deforestation across 9 forest-risk commodities (beef, cocoa, coffee, leather, palm, pulp, rubber, soy, timber). Scored 0-100 on commitments + implementation.
- **Why it fits**: We have WWF Palm + RSPO + Mighty Earth campaigns, but not the cross-commodity Forest 500 score. This complements our scattered commodity certs with a single per-company score.
- **Accessibility**: HTML rankings + CSV download.
- **Brand reach**: 500 companies — high overlap with TruNorth food/apparel/forest-products index.
- **Priority**: **P0**

### 4.4 Mighty Earth Soy & Cattle Deforestation Tracker
- **URL**: https://soyandcattlemonitor.mightyearth.org/tracker-scorecard/
- **Covers**: Quarterly satellite-verified deforestation alerts tied to Brazil's largest soy traders (ADM, Bunge, Cargill, COFCO, LDC, Amaggi, ALZ) and meatpackers (JBS, Marfrig, Minerva), with downstream retailer/restaurant linkages.
- **Why it fits**: Adds a recent-deforestation behavioral signal on top of Forest 500's policy/disclosure signal. Names downstream retailers as supply-chain culpability.
- **Accessibility**: Web map + scorecard JSON + quarterly PDF.
- **Brand reach**: ~10 directly named upstream traders/meatpackers; ~50 downstream retailer/restaurant linkages.
- **Priority**: **P1**

### 4.5 Banking on Climate Chaos — BankTrack supplement (per-deal Dodgy Deals database)
- **URL**: https://www.banktrack.org/banks
- *(Banking on Climate Chaos *report* is already in our list. The BankTrack Dodgy Deals dataset is separate.)*
- **Covers**: 600+ "Dodgy Deals" — individual project-finance deals tagged with the participating banks. Includes pipelines, mines, plantations, hydro, weapons. Per-bank pages aggregate all flagged deals.
- **Why it fits**: BoCC gives aggregate $; Dodgy Deals gives per-project provenance, more defensible for explanations.
- **Accessibility**: HTML per-bank pages; scrapable. No API but stable URLs.
- **Brand reach**: ~80 banks named across all deals.
- **Priority**: **P2**

### 4.6 Fair Finance Guide — country-level bank policy scorecards
- **URL**: https://www.fairfinanceinternational.org/
- **Covers**: Bank/insurer/pension-fund policy scores (0-10) on 23 sustainability themes (climate, human rights, labor, biodiversity, tax, gender, etc.) across 16 countries (Belgium, Brazil, France, Germany, India, Indonesia, Japan, Mexico, Netherlands, Norway, Pakistan, Philippines, Sweden, Thailand, US, Vietnam).
- **Why it fits**: Adds non-US/EU bank scoring (Indonesia, Thailand, Brazil, India) — closes a SE-Asia + LatAm financial-sector gap. Complements US BoCC.
- **Accessibility**: Per-country sites publish CSV/PDF scorecards. Methodology PDF documents weights.
- **Brand reach**: ~160 banks/insurers/pension funds.
- **Priority**: **P1**

### 4.7 World Animal Protection — Pecking Order / Cruelty Cost / Climate Culprits scorecards
- **URL**: https://api.worldanimalprotection.org/ + restaurant scorecard at https://www.worldanimalprotection.us/research/
- **Covers**: Three distinct scorecards — Pecking Order (egg supply chain), Cruelty Cost (chicken welfare), Climate Culprits (meat producer emissions). Plus the Animal Protection Index for governments (less relevant to brands).
- **Why it fits**: We have BBFAW, GAP 5-Step, CIWF, Open Wing Alliance. World Animal Protection's restaurant-chain + meat-producer scorecards are a separate angle.
- **Accessibility**: HTML, scrapable. Annual PDF.
- **Brand reach**: ~30 restaurant chains + 10 meat producers.
- **Priority**: **P2** (much redundancy with existing BBFAW/OWA; marginal lift)

### 4.8 RSF World Press Freedom Index — country dimension for media brand HQ
- **URL**: https://rsf.org/en/index
- **Covers**: 180-country annual ranking of press freedom. Not company-level, but useful as a *country risk modifier* for media companies HQed in repressive countries (Russia Today, CCTV, Xinhua, MBC Group Saudi, etc.).
- **Why it fits**: Brief flag — "press freedom (RSF, CPJ corporate accountability)". RSF doesn't score companies but can serve as a country-risk overlay for our media-brand entries.
- **Accessibility**: CSV downloads of the country index.
- **Brand reach**: Indirect — ~50 media brands whose country of operation gets the score.
- **Priority**: **P2** (signal is indirect; useful only after MBFC-style direct coverage)

### 4.9 CPJ Global Impunity Index + Killed-database (corporate attribution where it exists)
- **URL**: https://cpj.org/data/
- **Covers**: Database of journalists killed/imprisoned with structured fields including "media organization" of victim. Useful for media-brand evaluation in the rare case the *outlet was the target*. Mostly captures hostile-government coverage, not corporate harm.
- **Why it fits**: Brief mentions it as a candidate; turns out the corporate-accountability angle is thin. Mostly a country-risk overlay like RSF.
- **Priority**: **P2** (low payoff for our use case; document but don't build)

### 4.10 Tax Justice Network — Corporate Tax Haven Index (jurisdiction-level)
- **URL**: https://cthi.taxjustice.net/
- **Covers**: 64 jurisdictions ranked on corporate-tax-abuse enablement (Haven Score × Global Scale Weight). The companion Financial Secrecy Index ranks 133 jurisdictions on banking secrecy.
- **Why it fits**: Indirect — applies a country-risk modifier to companies HQed in tax havens. Complements ITEP federal-tax data we just ingested.
- **Accessibility**: Annual CSV; HTML rankings. CC license.
- **Brand reach**: Indirect — every multinational gets a HQ-jurisdiction tag.
- **Priority**: **P2**

### 4.11 PIRG Failing the Fix — repair scorecard (manufacturer-level)
- **URL**: https://pirg.org/edfund/resources/failing-the-fix-2026/
- **Covers**: Annual right-to-repair grades for phone (Apple, Google, Motorola, Samsung) and laptop (Acer, ASUS, Dell, HP, Lenovo, Microsoft) manufacturers. Combines iFixit repairability scores with manufacturer right-to-repair lobbying positions.
- **Why it fits**: Brief flag — "repair / right-to-repair scorecards". This is the canonical per-manufacturer grade.
- **Accessibility**: Annual PDF with structured grade tables; HTML release.
- **Brand reach**: ~15 named manufacturers, expanding to appliances in newer editions.
- **Priority**: **P0**

### 4.12 iFixit Repairability scores — per-device scoring (manufacturer rollup)
- **URL**: https://www.ifixit.com/repairability
- **Covers**: 1-10 repairability score per device, with rollups by manufacturer for smartphones, smartwatches, tablets, laptops.
- **Why it fits**: Complements PIRG with device-granularity. Together they form the cleanest right-to-repair signal.
- **Accessibility**: HTML per-device pages; iFixit has historically been data-friendly.
- **Brand reach**: ~30 manufacturers across categories.
- **Priority**: **P1** (after #4.11)

### 4.13 Cultural Survival corporate accountability monitoring (Indigenous rights)
- **URL**: https://www.culturalsurvival.org/news (filter: corporate accountability)
- **Covers**: Investigative reports + UN-forum statements naming corporations involved in violations of FPIC (Free, Prior, Informed Consent) on Indigenous lands. Mostly mining, dams, oil, agribusiness across Americas, Asia-Pacific, Africa.
- **Why it fits**: Brief explicit gap — "indigenous rights / land use". Cultural Survival is the longest-running NGO in this space and they name corporations in their reports.
- **Accessibility**: HTML article archive; no structured DB but ~50 reports/year nameable.
- **Brand reach**: ~50 named corporates/year.
- **Priority**: **P1** (combined with our R3 First Peoples Worldwide hand-seed and Land Matrix from §1.2 gives strong indigenous-rights coverage)

### 4.14 EITI revenue & company-payment data (US national + international)
- **URLs**: https://eiti.org/countries (international, 55 countries) + https://revenuedata.doi.gov (US Interior portal)
- **Covers**: Oil, gas, mining company payments to governments — at project-level since 2018. ~1,400 companies disclosed globally; ~25 disclosed for US.
- **Why it fits**: Closes the extractive-revenue-flow gap. Useful for "what fraction of $COMPANY revenue came from $REPRESSIVE_REGIME" signals.
- **Accessibility**: revenuedata.doi.gov is a structured open-data portal with CSVs. EITI's country sites publish PDFs of varying structure.
- **Brand reach**: 1,400 globally; ~150 majors (Shell, BP, Chevron, ExxonMobil, Total, Equinor, Eni, Repsol, Anglo, Glencore, BHP, Vale, Rio Tinto, Newmont, Barrick).
- **Priority**: **P1**

---

## 5. International consumer-review aggregators

### 5.1 CHOICE (Australia) — recommended brands + Shonky Awards
- **URL**: https://www.choice.com.au/about-us/products-and-services/top-product-reviews + https://www.choice.com.au/shonky-awards
- **Covers**: "CHOICE Recommended" badges for ~500 products/year + annual Shonky Awards (worst-of brand list) — both publicly listed. Magazine reviews paywalled, but recommended-product and Shonky lists are free.
- **Why it fits**: Brief lists Choice as a target. Shonky Awards in particular are a strong negative-signal source (e.g. Samsung washing machines, Kmart kids' helmets, Coles supermarket).
- **Accessibility**: HTML lists, no API; Shonky archive at /shonky-awards.
- **Brand reach**: ~300 named brands annually.
- **Priority**: **P1**

### 5.2 Which? (UK) — Best Buy + Don't Buy free lists
- **URL**: https://www.which.co.uk/
- **Covers**: Best Buy / Don't Buy product designations published in marketing teasers (full reviews paywalled). Plus the Which? "Wooden Spoon" worst-of awards.
- **Why it fits**: Brief target. UK perspective complements US CR auto data we already have.
- **Accessibility**: Free HTML for the categorical lists; deep reviews paywalled.
- **Brand reach**: ~200 brands across categories.
- **Priority**: **P1**

### 5.3 Stiftung Warentest (Germany) — short verdicts only (no paid data)
- **URL**: https://www.test.de/
- **Covers**: Top-line verdicts ("Very Good" → "Unsatisfactory") published free for the headline product in each monthly test (8-10/month). Detailed scores paywalled at €0.75–€5.
- **Why it fits**: Brief target. German consumer benchmarks.
- **Accessibility**: Free landing pages list the verdict + product list each month. Structured scrape possible.
- **Brand reach**: ~120 verdicts/year; ~80 brand-mappable.
- **Priority**: **P2** (lower yield due to paywall; only top-line public)

### 5.4 Forbrukerrådet (Norwegian Consumer Council) — corporate reports
- **URL**: https://www.forbrukerradet.no/side/reports-and-publications/
- **Covers**: ~20 reports/year naming specific tech and consumer-product companies for privacy abuses, planned obsolescence, dark patterns. "Out of Control" (2020), "Deceived by Design" (2018), "Ghost in the Machine" (2023), "Breaking Free" (2026).
- **Why it fits**: Brief target. Forbrukerrådet's reports are widely picked up and name specific companies (Tinder, Grindr, Meta, Google, Microsoft, MyHeritage, Roomba/iRobot, John Deere, HP printer-ink lock-in).
- **Accessibility**: English-language PDFs + HTML reports.
- **Brand reach**: ~30 named companies/year; high overlap with TruNorth tech index.
- **Priority**: **P0**

### 5.5 Test-Achats / Test Aankoop (Belgium)
- **URL**: https://www.test-achats.be/ (FR) / https://www.test-aankoop.be/ (NL)
- **Covers**: Belgian consumer-org with class-action capability. Publishes corporate-action lawsuits (Tesla autopilot, VW dieselgate, Apple iPhone throttling, Ryanair fee abuse) with claim periods + outcome documentation — these are public.
- **Why it fits**: Brief target. Class-action filings reveal pattern of corporate misconduct against EU consumers.
- **Accessibility**: HTML; class-action archive on the website.
- **Brand reach**: ~20 named defendants in active class actions.
- **Priority**: **P2**

---

## 6. Quick reference — full table

| # | Source | Category | Priority |
|---|--------|----------|----------|
| 1.1 | OECD NCP specific-instances DB | grievance / human-rights | P0 |
| 1.2 | Land Matrix | environment / indigenous / labor | P0 |
| 1.3 | South Africa B-BBEE registry | dei (SA) | P2 |
| 1.4 | South Korea KFTC | antitrust | P1 |
| 1.5 | Brazil CADE | antitrust | P1 |
| 1.6 | SOMO reports | investigative / supply chain | P1 |
| 2.1 | Eviction Lab corporate landlord scorecard | housing / labor | P0 |
| 2.2 | HUD REAC inspection scores | housing | P2 |
| 2.3 | College Scorecard + Borrower Defense | education | P1 |
| 2.4 | UnionFacts (entertainment vertical) | labor | P2 |
| 2.5 | Insure Our Future scorecard | environment / insurance | P0 |
| 2.6 | SIPRI Arms Industry Top-100 | defense | P0 |
| 2.7 | FINRA Disciplinary Actions | financial / crypto | P0 |
| 2.8 | BHRRC Transition Minerals Tracker | mining / human rights | P0 |
| 3.1 | CARB Enforcement Portal | environment / state | P0 |
| 3.2 | Cal/OSHA via IMIS state-plan filter | labor / state | P1 |
| 3.3 | FollowTheMoney (state donations) | political | P0 |
| 3.4 | TCEQ enforcement | environment / state | P1 |
| 3.5 | SEC Whistleblower annual reports | financial / fraud | P2 |
| 3.6 | USAspending federal contracts | political / defense | P1 |
| 3.7 | KFF / CMS claim-denial PUF | health insurance | P0 |
| 3.8 | Stanford NPE Litigation DB | IP / litigation | P2 |
| 3.9 | NAAG Multistate Settlements | consumer protection | P0 |
| 3.10 | State PUC dockets (CA, PA, TX, FL, NY, IL) | utility / state | P1 |
| 3.11 | CourtListener settlement-tagged dockets | class actions | P1 |
| 4.1 | Stanford FMTI | AI ethics | P0 |
| 4.2 | AlgorithmWatch inventory | AI ethics | P2 |
| 4.3 | Forest 500 | deforestation | P0 |
| 4.4 | Mighty Earth Soy & Cattle | deforestation | P1 |
| 4.5 | BankTrack Dodgy Deals | climate finance | P2 |
| 4.6 | Fair Finance Guide (16 countries) | finance / sustainability | P1 |
| 4.7 | World Animal Protection scorecards | animal welfare | P2 |
| 4.8 | RSF World Press Freedom Index | press freedom (country) | P2 |
| 4.9 | CPJ Killed/Impunity DB | press freedom | P2 |
| 4.10 | Tax Justice Network CTHI/FSI | tax / governance | P2 |
| 4.11 | PIRG Failing the Fix | right to repair | P0 |
| 4.12 | iFixit repairability scores | right to repair | P1 |
| 4.13 | Cultural Survival reports | indigenous rights | P1 |
| 4.14 | EITI revenue data (US + intl) | extractives / governance | P1 |
| 5.1 | CHOICE Australia + Shonky | consumer (AU) | P1 |
| 5.2 | Which? UK Best Buy / Wooden Spoon | consumer (UK) | P1 |
| 5.3 | Stiftung Warentest verdicts | consumer (DE) | P2 |
| 5.4 | Forbrukerrådet reports | privacy / consumer (NO) | P0 |
| 5.5 | Test-Achats class-actions | consumer (BE) | P2 |

---

## 7. Recommended top-10 to build next

Selected by **(brand-reach × accessibility × brief-stated-gap-closure)**.

1. **OECD National Contact Points specific instances DB** (§1.1) — single biggest international-grievance source; ~400 multinationals; we have nothing comparable. URL has structured per-case pages. **Build first.**
2. **Stanford Foundation Model Transparency Index** (§4.1) — closes the AI-ethics gap completely; 13 of the world's biggest AI companies; CSV on GitHub.
3. **Insure Our Future scorecard** (§2.5) — closes insurance-beyond-NAIC gap; 30 named global insurers; clean per-company landing pages.
4. **SIPRI Arms Industry Top-100** (§2.6) — closes defense-beyond-GPFG gap; ~100 named arms producers with revenue weighting.
5. **PIRG Failing the Fix + iFixit repairability** (§4.11 + 4.12) — closes the right-to-repair gap; methodology overlaps so they can be paired.
6. **Eviction Lab corporate landlord scorecards** (§2.1) — closes real-estate / REIT gap with the cleanest negative signal (eviction rate per landlord); free CSV.
7. **KFF / CMS Transparency in Coverage PUF — claim-denial rates** (§3.7) — closes health-insurance gap; one number per insurer, annually refreshed; CMS CSV.
8. **Forest 500 (Global Canopy)** (§4.3) — single cross-commodity deforestation score for 500 companies; complements our patchwork of WWF Palm + RSPO + RTRS.
9. **FollowTheMoney (NIMP) state campaign finance** (§3.3) — closes state-political-donations gap; 50-state coverage; ~20k corporate donors.
10. **BHRRC Transition Minerals Tracker** (§2.8) — closes mining-beyond-MSHA gap; 250 mining majors with EV/battery supply-chain linkage.

### Honorable mentions (build in second wave)

- CARB Enforcement Portal (§3.1) — un-parks an existing brief item; CA-specific.
- NAAG Multistate Settlements (§3.9) — fills the gap left by our per-state AG fetchers.
- Forbrukerrådet reports (§5.4) — narrow but high-quality privacy signal; ~30 named companies/year.
- Land Matrix (§1.2) — top-tier for global agri/extractives but match rate will be lower than the Forest 500.
- Stanford NPE Litigation DB (§3.8) — defer unless we add a litigation-burden category.

---

## 8. Excluded after verification

- **iFixit alone** — covered by §4.11 + 4.12 pairing.
- **OpenCorporates** — fundamentally a registry/KYB tool, not a values signal; commercial use restricted; we already resolve corporate entities via Wikidata + manual graph.
- **OpenSanctions PEPs** — beyond our scope (people, not brands); but we noted the FINRA-on-OpenSanctions feed (§2.7).
- **GRI public database** — discontinued April 2021.
- **Cornell ILR Labor Action Tracker** — already in our list (B-strike-map).
- **Coller FAIRR Protein Producer Index** — already in our list.
- **Corporate Human Rights Benchmark (CHRB)** — already in our list.
- **Global Slavery Index (Walk Free)** — country-level, no corporate scoring; KnowTheChain already covers the corporate angle for us.
- **Mines and Communities** — long-form journalism, not a structured database; better to use BHRRC Transition Minerals Tracker (§2.8).
- **Article One Advisors** — consulting firm, not a public dataset.
- **CARMA International** — paid media-monitoring service, not a public press-freedom dataset.
- **AlgorithmWatch inventory** alone — kept as P2 because FMTI (§4.1) is the higher-leverage AI source.
- **ProPublica Nonprofit Explorer** — useful for 990 corporate-foundation grants but largely overlaps with what our IRS-990 partial ingest already covers; would be P3 follow-up if we ever do a "corporate-giving deep dive."

---

## How to refresh

Re-run with the same prompt 3-6 months out. Update the exclusion list with anything shipped from this round so R6 doesn't reproduce it. Watchlist for emerging sources:

- **EU CSDDD enforcement decisions** (effective phased 2027-2029) — will become the canonical EU human-rights-due-diligence signal.
- **California SB 253 climate disclosure** — first filings 2026; per-company emissions CSV coming online.
- **UN B-Tech / Generative-AI assessments** — pilot benchmark of LLM providers in progress.
- **Open Supply Hub** — facility-level disclosures rising rapidly; already cross-referenced by Fashion Revolution and KnowTheChain; merits a direct ingestion if facility-level resolution becomes valuable.
