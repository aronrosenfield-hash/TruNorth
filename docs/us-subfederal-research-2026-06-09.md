# US Sub-Federal + Specialty Data Source Research

**Date:** 2026-06-09
**Owner:** Aron / TruNorth
**Scope:** New US state, county, municipal, and specialty academic data sources NOT yet covered.

**Already covered (do NOT duplicate):**
- State AGs: NY, TX, CA, FL, IL, OH, PA, NJ, GA, NC, WA
- State regulators: NYDFS, CA CPPA, CA Prop 65, ATF FFL
- Federal regulators: EPA, FDA, FTC, SEC, CFPB, NHTSA, CPSC, OSHA, EEOC, FCC, DOJ, USDA, HHS-OIG, MSHA, CMS, CISA, SAM.gov, OFAC, BIS, FERC, DOL-WHD, DEA, FMCSA, PHMSA, NRC, FAA, NTSB, BTS
- Specialty: OpenSecrets federal, FollowTheMoney (partial), Stanford DIME (partial), Cornell ILR strike tracker

**Methodology:** ~25 targeted web searches across 10 categories; URLs spot-checked via WebFetch where feasible. All sources below are public, free, no paywall.

---

## 1. State-level lobbying / political $

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **CA CalAccess** raw TSV | CA | https://www.sos.ca.gov/campaign-lobbying/helpful-resources/raw-data-campaign-finance-and-lobbying-activity | Daily TSV bulk dump | Lobbyist employers (corp principals), payments, recipients since ~1999. Mirrors at calaccess.californiacivicdata.org. | ~800 brands w/ CA gov presence | **P0** | M |
| **NY COELIG** (ex-JCOPE) | NY | https://ethics.ny.gov/lobbying-datasets · https://webapps.jcope.ny.gov/public/ | Open NY portal (SODA/CSV), 278M+ records since 2011 | NY state lobbyist/client/compensation filings | ~600 brands | **P0** | M |
| **TX Ethics Commission** | TX | https://www.ethics.state.tx.us/search/lobby/ · CSV of activities reports | Daily CSV + Excel + PDF | TX lobby registrations (1998+) and activities (2000+); client compensation codes | ~500 brands | **P0** | M |
| **FL Lobbyist Registration** | FL | https://www.floridalobbyist.gov/ · https://floridalobbyist.gov/CompensationReportSearch/ · download endpoint at leg.state.fl.us cgi-bin View_Page.pl?Tab=lobbyist | Delimited download + free dataset | Executive/legislative branch lobbyists, principals, compensation | ~400 brands | P1 | M |
| **MA OCPF** | MA | https://www.ocpf.us/Reports/SearchItems | Search + downloads (CSV) | MA campaign finance + lobbyist client/expense data | ~200 brands | P1 | M |
| **WA PDC** open data | WA | https://www.pdc.wa.gov/political-disclosure-reporting-data/open-data · https://data.wa.gov | Full Socrata SODA API + CSV; "Lobbyist Compensation and Expenses" dataset | WA campaigns + L1/L2/L3 lobbyist filings, daily refresh | ~250 brands | P1 | S |
| **NYC City Clerk eLobbyist** | NYC | https://lobbyistsearch.nyc.gov/ · https://data.cityofnewyork.us/City-Government/City-Clerk-eLobbyist-Data/fmf3-knd8 | NYC Open Data (Socrata API + CSV) | NYC lobbyists, clients, subjects | ~300 brands | **P0** | S |
| **Chicago Board of Ethics** | Chicago | https://webapps1.chicago.gov/elf/public_search_lobbyists.html + Socrata datasets: data.cityofchicago.org Lobbyist-Data-{Lobbyists,Clients,Employers,Lobbying-Activity} | Socrata API + CSV | Quarterly Chicago lobbying filings | ~200 brands | P1 | S |
| **SF Ethics Commission** | SF | https://sfethics.org/disclosures/lobbyist-disclosure/lobbyist-disclosure-data · https://data.sfgov.org Lobbyist-Activity-API | DataSF Socrata API (nightly sync) | SF lobbyist contacts, campaign contributions linked to lobbyists | ~150 brands | P2 | S |
| **LA City Ethics** | LA | https://ethics.lacity.gov/data/hub · https://ethics.lacity.gov/lobbying/ | Search + Excel/CSV downloads | LA city lobbying entities, activity, projects | ~150 brands | P2 | S |

**Total category match:** ~2,500-3,000 brand-level political-influence signals, complementing OpenSecrets federal-only data.

---

## 2. State environmental enforcement (beyond CA-CARB)

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **NY DEC** | NY | https://dec.ny.gov/regulatory/enforcement · plus EPA ECHO mirror | Web search + Orders on Consent + Docket Mgmt System (closed cases 2005+); bulk via ECHO | NY air/water/hazwaste consent orders, penalties | ~300 brands | P1 | M |
| **TX TCEQ Compliance History** | TX | https://www.tceq.texas.gov/compliance/enforcement/compliance-history/search.html | Free ASCII bulk file (300k+ records) via comphist@tceq.texas.gov; search portal | Statewide compliance history grouped by county; pending + closed actions | ~400 brands | **P0** | M |
| **FL DEP AirInfo** | FL | https://floridadep.gov/sec/sec/content/compliance-data-airinfo · https://floridadep.gov/central/central/forms/2025-violations | Web search by SIC/name; annual violation lists | FL air consent orders + penalties; supplemental enviro projects | ~200 brands | P1 | M |
| **PA DEP eFACTS** | PA | https://www.ahs.dep.pa.gov/eFACTSWeb/default.aspx · https://www.pa.gov/agencies/dep/data-and-tools | Search portal + reporting tools at cedatareporting.pa.gov | PA inspections, NOVs, civil penalty assessments, consent orders | ~300 brands | P1 | M |
| **IL EPA Enforcement Orders** | IL | https://epa.illinois.gov/topics/compliance-enforcement/enforcement-orders.html | Searchable web portal, 2002+ | IL Compliance Commitment Agreements, settlement & admin citation orders | ~250 brands | P2 | M |
| **MassDEP** | MA | https://eeaonline.eea.state.ma.us/Portal/#!/search/enforcements · https://openamend.org/data/MADEP_enforcement_actions.html | Public search portal; 3rd-party archive | MA hazwaste, wetlands, air, asbestos enforcement | ~150 brands | P2 | M |
| **WA Ecology Facility/Site DB** | WA | https://ecology.wa.gov/regulations-permits/guidance-technical-assistance/facility-site-database | Web search + map | WA cleanup sites, hazwaste generators, enforcement actions | ~150 brands | P2 | M |
| **OR DEQ Enforcement DB** | OR | https://www.deq.state.or.us/programs/enforcement/EnfQuery.asp · https://www.oregon.gov/deq/pages/enforcement-actions.aspx | Web query tool by source name | OR formal enforcement actions, penalties (up to $25k/violation/day) | ~100 brands | P2 | S |

**Note:** Most state enviro enforcement is also surfaced via EPA's ECHO national database, but state-level systems capture state-only programs and richer narrative text not in ECHO.

---

## 3. State workers' comp / labor enforcement (beyond Cal-OSHA)

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **CA DLSE Wage Claim Search** | CA | https://cadir.my.site.com/wcsearch/s/ · https://www.dir.ca.gov/dlse/WageClaimOfficeSearch.asp | Salesforce-based search portal; PRA for bulk | Wage-theft judgments by employer, industry, amount | ~400 brands | **P0** | M |
| **WA L&I Wage Violations** | WA | https://secure.lni.wa.gov/wageviolations/ | Web search by business | WA employers with wage law violations | ~200 brands | P1 | S |
| **NY DOL Labor Standards** | NY | https://dol.ny.gov/wage-theft-hub · https://dol.ny.gov/labor-standards-complaint-process | Mostly aggregate stats; no live search; FOIL for bulk | NY wage-theft orders, $20M+ recovered FY23 | ~150 brands | P2 | L (FOIL bottleneck) |
| **NYC Comptroller Employer Violations Dashboard** | NYC | https://comptroller.nyc.gov/services/for-the-public/employer-violations-dashboard/violations/wage-theft/ | Public dashboard | NYC wage-theft violators (cross-agency) | ~150 brands | P1 | S |
| **IL Dept of Labor** | IL | https://labor.illinois.gov/unpaidwages.html · WPCA penalties at labor.illinois.gov/laws-rules/fls/wpca-penalties.html | Search results limited; FOIA for bulk | IL wage-payment violations | ~100 brands | P2 | L (FOIA) |
| **TX TWC** | TX | https://www.twc.texas.gov/ | Limited public search; TPIA needed | TX wage claim adjudications | ~100 brands | P2 | L |

---

## 4. State insurance commissioner enforcement (beyond NAIC index)

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **CA DOI Enforcement Actions** | CA | https://cdicloud.insurance.ca.gov/cal/EnforcementActions · https://www.insurance.ca.gov/01-consumers/120-company/13-enfactions/ · doc search legaldocs.insurance.ca.gov | Public search; PDFs downloadable; required by CA Insurance Code §§12938/12968 | CA insurer/agent enforcement, July 2001+ | ~80 brands | P1 | M |
| **TX TDI Enforcement** | TX | https://tdi.texas.gov/commissioner/actions.html · https://wwwapps.tdi.state.tx.us/inter/asproot/enforcement/index.html | Search 2020+; older via open-records | TX disciplinary orders, consent orders, penalties | ~70 brands | P1 | M |
| **FL OIR Orders** | FL | https://floir.gov/search · public records office | Two search tools (pre/post 7/1/2015); PDFs | FL consent orders, cease & desist | ~60 brands | P2 | M |
| **IL DOI** | IL | https://idoi.illinois.gov/companies/company-lookup.html · https://apps.ilsos.gov/adminactionssearch/ · ParityTrack reports | Search portal; some via SOS Admin Actions search | IL stipulation-and-consent orders, fines | ~50 brands | P2 | M |

**Caveat:** Many insurance enforcement targets are LLC entities, not the consumer-facing brand parent — entity resolution required.

---

## 5. State public utility commission enforcement

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **CPUC Decisions + Enforcement** | CA | https://docs.cpuc.ca.gov/DecisionsSearchForm.aspx · monthly enforcement spreadsheets at cpuc.ca.gov/-/media/cpuc-website/divisions/consumer-protection-and-enforcement-division/documents/ueb/enforcement-actions/ | Search portal + monthly PDF/Excel spreadsheets | CPUC citations, fines $489M+ since 2004 (telecom + energy + water) | ~80 brands (utilities, telecom, ISPs) | **P0** | M |
| **TX PUCT Interchange** | TX | https://interchange.puc.texas.gov/ | Free public filing system with all non-confidential orders | PUCT admin penalties (telecom + electric REPs) | ~50 brands | P1 | M |
| **TX Railroad Commission** | TX | https://www.rrc.texas.gov/news/ (monthly press releases) · Master Default/Agreed Orders on Hearings/General Counsel pages | Monthly PDF/web releases; older orders need scraping | TX oil/gas/pipeline enforcement ($1M+/month avg) | ~40 brands (oil majors, midstream) | P1 | M |
| **NY DPS / PSC** | NY | https://dps.ny.gov/ · https://documents.dps.ny.gov/public/Common/ViewDoc.aspx | DMM document search | NY utility wrongdoing orders, penalties | ~40 brands | P2 | M |
| **FL PSC** | FL | https://www.floridapsc.com/ · https://www2.psc.state.fl.us/ | Public document/case search | FL utility delinquency notices, show-cause | ~30 brands | P2 | M |
| **IL ICC e-Docket** | IL | https://www.icc.illinois.gov/e-docket/ | Free docket search | IL utility violations, one-call enforcement | ~30 brands | P2 | M |

---

## 6. State pharmacy board actions (for chain pharmacies)

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **CA Board of Pharmacy** | CA | https://www.pharmacy.ca.gov/enforcement/discipline.shtml · quarterly action pages | Quarterly HTML lists, 2005+; verify-a-license tool | CA pharmacy + pharmacist discipline (revocation, suspension, probation) | ~30 chain-pharmacy brand entities (CVS, Walgreens, Rite Aid, Costco, Walmart pharmacies) | P1 | M |
| **NY OP Enforcement Actions** | NY | https://www.op.nysed.gov/enforcement/enforcement-actions | Web search since 1994 | NY pharmacy establishment + practitioner discipline | ~25 brands | P1 | M |
| **TX SBP Disciplinary Summaries** | TX | https://www.pharmacy.texas.gov/newsletter/Disciplinary_Action_Summaries.asp · quarterly archives | Quarterly PDF newsletters | TX pharmacy + tech disciplinary actions | ~25 brands | P2 | M |
| **FL DOH MQA** | FL | https://mqa-internet.doh.state.fl.us/MQASearchServices/EnforcementActionsBusiness | Public search portal | FL pharmacy/business discipline + admin actions | ~25 brands | P2 | M |
| **IL IDFPR** | IL | https://online-obre.micropact.com/Lookup/LicenseLookup.aspx · https://apps.ilsos.gov/adminactionssearch/ | Search portal | IL pharmacy license + admin actions | ~20 brands | P2 | M |

---

## 7. Municipal-level data

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **NYC PASSPort / VENDEX** | NYC | https://www.nyc.gov/site/mocs/index.page · https://vendexnyc.com (3rd party) | Vendor info via MOCS; "Caution List" via FOIL | NYC contractor performance, prior contracts, caution-list status | ~100 brands w/ NYC contracts | P2 | L (FOIL-heavy) |
| **NYC eLobbyist** (see §1) | NYC | covered above | | | | | |
| **Chicago / SF / LA lobbying** (see §1) | | covered above | | | | | |

The strongest municipal signal is lobbying (already in §1). VENDEX/PASSPort is real but hard to extract cleanly.

---

## 8. County-level data

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **LA County Restaurant Inspections** | LA County | https://data.lacounty.gov/Health/LOS-ANGELES-COUNTY-RESTAURANT-AND-MARKET-INSPECTIO/6ni6-h5kp · https://data.lacity.org/Community-Economic-Development/Restaurant-and-Market-Health-Inspections/29fd-3paw | Socrata API + CSV bulk | A/B/C grades + violations for all unincorporated LA + 85 of 88 cities | ~80 chain restaurant brands (McDonald's, Starbucks, Chipotle, etc.) at outlet granularity | **P0** | S |
| **Cook County Open Data** | Cook County, IL | https://datacatalog.cookcountyil.gov/ · environmental story page sjer-a8rm | Socrata API + CSV | Environmental permitting, inspections | ~30 brands | P2 | M |
| **Harris County PCS** | Harris County, TX | https://pcs.harriscountytx.gov/ · https://www.harriscountytx.gov/Services-Portal/Dashboards-Datasets-Hub | Limited public data; TPIA for bulk | Houston-area pollution control + enforcement | ~30 brands | P2 | L |

LA County restaurant inspections is the single biggest county-level prize — it gives outlet-level health-code data for major QSR chains.

---

## 9. Specialty academic datasets

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **Stanford DIME v4.0** | National | https://data.stanford.edu/dime · http://web.stanford.edu/~bonica/data.html | Free .csv.gz + .rdata bulk (850M+ contributions, 1979-2024); CFscores for 156k candidates, 37k committees, 36M donors | Comprehensive donor ideology + corporate PAC scores at state + federal levels | ~3,000 brands matchable via committee + employer fields | **P0** (deepen our partial workflow) | M |
| **DIME Plus** | National | https://data.stanford.edu/dime-plus | Public + extended fields | Adds firm-level employer linkage | overlap w/ DIME | P1 | M |
| **Harvard Election Data Archive** | National | https://dataverse.harvard.edu/dataverse/eda · MEDSL at dataverse.harvard.edu/dataverse/medsl | Free Harvard Dataverse downloads | Election results, returns, voting — narrow corp utility | ~50 indirect | P2 | M |
| **MIT Election Lab (MEDSL)** | National | https://electionlab.mit.edu/data · https://github.com/MEDSL | R package + Dataverse | Election returns only; no native corporate-PAC dataset (use DIME instead) | ~0 direct | P2 | n/a — DIME superset |
| **UC Berkeley Labor Center** | National + CA | https://laborcenter.berkeley.edu/low-wage-work/industry-research/ · https://laborcenter.berkeley.edu/publication_type/report/ | HTML reports + occasional CSV appendices | Industry low-wage research, fast-food, gig, warehousing — citable narrative, not bulk data | qualitative | P2 | M (manual citation) |
| **Cornell ILR Workplace Issues Resources** | National | (we have strike tracker) — also https://www.ilr.cornell.edu/labor-action-tracker | Already covered | | | done | — |

**DIME v4.0 going to full depth** is the single highest-leverage item here.

---

## 10. Specialty corporate ethics datasets

| Source | Jurisdiction | URL | Access | Coverage | Match est. | Priority | Effort |
|---|---|---|---|---|---|---|---|
| **Powerbase (Spinwatch)** | Global | https://powerbase.info/index.php/Main_Page | Public MediaWiki, scrape-friendly | Wiki of PR firms, lobby networks, corporate front groups, revolving-door | ~800 brands w/ political/PR exposure | P1 | M (wiki scraping + entity resolution) |
| **WikiCorporates** | Global | https://www.wikicorporates.org/wiki/Public_Interest_Investigations | Public wiki | Public-interest investigations into corporates | ~300 brands | P2 | M |
| **BCG MERCO** | Spain/LatAm | (Spanish-language industry index) | Mostly aggregate ranks, not row-level | Reputation rank by company | low US match | P2 — skip | — |
| **RepTrak / Reputation Institute** | Global | Public site lists only Top-100 rankings | Aggregate only; bulk is paywalled | Top-100 reputation rank | <100 brands | P2 — skip | — |
| **Corporate Eye / Corporate Watch UK** | UK/Global | https://corporatewatch.org/ (linked from Powerbase) | Free articles + company profiles | UK-focused corporate criticism; narrative not structured data | qualitative | P2 | M |

International OpenSecrets equivalents:
- UK: https://transparency.org.uk + https://www.electoralcommission.org.uk/who-we-are-and-what-we-do/financial-reporting/search-political-donations (Free, structured) — interesting for UK brand subsidiaries
- EU: https://transparency-register.europa.eu (EU Transparency Register) — covered already in EU-enforcement work but worth confirming bulk download
- Canada: https://lobbycanada.gc.ca/ — Free, structured

---

## TOP 10 RECOMMENDED BUILDS (next sprint)

Ranked by signal-per-effort, brand-match volume, and gap relative to current TruNorth coverage:

| Rank | Source | Why | Effort | Brands |
|---|---|---|---|---|
| **1** | **Stanford DIME v4.0 full depth** | Already have a partial workflow; going full unlocks state+federal corporate-PAC ideology for ~3k brands. Cleanest CSV bulk. | M | 3,000 |
| **2** | **CA CalAccess raw bulk** | Biggest single state lobby DB. Daily TSV. Mirrors at California Civic Data Coalition. | M | 800 |
| **3** | **NY COELIG Open NY dataset** | 278M records on Socrata, easy ingest. Catches NY-headquartered + NY-active brands missed by federal-only lobby. | M | 600 |
| **4** | **TX Ethics Commission lobby CSV** | Daily CSV — covers TX oil/gas/finance brands that under-report federally. | M | 500 |
| **5** | **LA County restaurant inspections** | Only county-level food-safety dataset in scope with Socrata API. Per-outlet A/B/C grades for QSR chains. Differentiator for food-category UX. | S | 80 (per-outlet data on huge chains) |
| **6** | **NYC eLobbyist (Socrata)** | One API call, ~300 brand matches, clean schema. Good complement to NY state. | S | 300 |
| **7** | **CA DLSE Wage Claim Search** | Direct wage-theft signal at the employer level — high-emotion, high-trust category. Salesforce backend is scrapeable. | M | 400 |
| **8** | **CPUC enforcement monthly spreadsheets** | Citations for telecom/energy/water utilities — covers brands (AT&T, Verizon, PG&E, SoCal Edison) where federal data thin. Already in tabular format. | M | 80 |
| **9** | **TX TCEQ Compliance History bulk file** | One ASCII file, 300k+ records — best state-level enviro coverage for TX brand subsidiaries (refineries, petrochem). Cheap email request. | M | 400 |
| **10** | **Powerbase wiki scrape** | Highest-value narrative source we don't have. Reveals PR/front-group/revolving-door links not in any government dataset. | M | 800 |

**Total fresh brand-signal coverage from top 10:** ~6,960 brand-level data points (with overlap), spanning lobbying, wage theft, environmental, utility, food safety, and ideology.

---

## Lower-priority but worth tracking

- WA PDC (Socrata-native, easy if we ever expand WA brand focus)
- FL Lobbyist Registration (delimited download, low cost)
- TX RRC enforcement (monthly press releases — useful for oil/gas brand parents)
- MassDEP enforcement portal (P2 unless we deepen MA brand coverage)
- Chicago Board of Ethics Socrata datasets (easy P2 add)
- SF Ethics + LA City Ethics (easy P2 adds; small marginal coverage)

## Explicitly skipped

- BCG MERCO, RepTrak — aggregate-only / paywalled / low US coverage
- Corporate Eye — narrative-only, no structured data
- MIT MEDSL corporate-PAC — DIME is the superset; no separate corporate-PAC dataset exists
- Harvard Election Data Archive — election returns only, marginal corporate value

---

## Open questions for next research pass

1. Does NY DEC have a downloadable enforcement docket CSV beyond ECHO? (Currently looks PDF/portal-only.)
2. Is the PA DEP eFACTS bulk-extractable, or is cedatareporting.pa.gov the only avenue?
3. Does NYC PASSPort have any public API beyond FOIL? (Likely no, given vendor-confidentiality framing.)
4. Are there state-level securities/blue-sky enforcement databases worth indexing (e.g., TX State Securities Board, MA Secretary)? — not in scope this pass.
5. State AG offices we don't have (CT, MD, VA, MN, MI, AZ) — worth a separate pass if expanding state-AG coverage.

---

## Source URLs (spot-checks)

Spot-checked live via WebFetch on 2026-06-09:
- CA DOI enforcement search: confirmed public access, no bulk download.
- NYC Open Data eLobbyist: confirmed Socrata-hosted (CSV/JSON/SODA).
- LA County restaurant inspections: confirmed open data portal hosting.
- MassDEP enforcement portal: portal exists; full schema requires direct exploration.

All other URLs cited from primary state/agency websites or established academic mirrors (Stanford Libraries, Harvard Dataverse, California Civic Data Coalition).
