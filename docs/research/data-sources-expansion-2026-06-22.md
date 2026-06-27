# TruNorth Data-Source Expansion — 2026-06-22

## Executive summary

This sweep surfaced **59 verified, net-new, public-record, company-level data sources** — each checked to be free or feasibly free, brand-resolvable, and non-duplicative of TruNorth's live ~100-source registry. Folding them in lifts the live registry from ~100 toward **160+ active sources** (and past **200+** once the multi-feed sources — FDA dashboards, state breach portals, EU/UK regulators — are counted as the discrete fetchers they become). The four highest-leverage adds are: **EPA Toxics Release Inventory (TRI)** (quantified per-facility chemical mass, parent-rollable, free REST API), the **Norges Bank / GPFG Exclusion List** (the single most authoritative state-backed conduct+product exclusion register, ingestible as a clean CC-BY OpenSanctions dataset), **Forest 500** (named-brand deforestation scores filling our biggest environment gap with deep CPG coverage), and the **FTC Legal Library — Cases & Proceedings** (6,000+ named-company consumer-protection actions — false advertising, deceptive billing, data-security). These adds also open four genuinely new scoring categories: **tax/subsidies**, **product safety & consumer protection**, **healthcare/pharma payments**, and **advertising-conduct** — each currently unrepresented in the live registry.

> **Build convention:** every source below follows TruNorth's canonical pipeline pattern — a `{src}-fetch.mjs` (pull + raw snapshot), a `{src}-merge.mjs` (entity-resolve + augment), and a workflow cron entry (nightly/weekly/monthly tier matched to the source cadence).

---

## Ranked catalog

### political

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [UK CMA Cases](https://www.gov.uk/cma-cases) | UK antitrust (Ch I/II), merger & consumer-law enforcement w/ penalties; net-new jurisdiction vs EU DG Comp | Dozens–low-hundreds of named parties; large consumer-facing firms w/ UK ops | GOV.UK case finder + content API | free | ongoing | 6 |
| [UK FCA Final Notices + FS Register](https://register.fca.org.uk/s/) | UK financial-misconduct enforcement (fines/censures/prohibitions); FRN-keyed clean resolution | All FCA/PRA notices 2014+; FS Register all authorised firms | Register API (FRN) + HTML/PDF notices | free | daily / as issued | 6 |
| [LobbyFacts (EU Transparency Register)](http://www.lobbyfacts.eu/) | EU lobbying cost / FTE / EP passes / EC meetings per org | ~17k registered orgs incl. most Brussels-active multinationals | Official register open data (data.europa.eu) + LobbyFacts views | free | ~weekly | 6 |
| [UK Register of Consultant Lobbyists (ORCL)](https://registrarofconsultantlobbyists.org.uk/) | UK agency-lobbying client disclosure (which brands retain lobbyists) | Agency-only; hundreds of client orgs, subset brand-matchable | Searchable register + full download | free | quarterly | 4 |

### charity

_No net-new sources surfaced in this sweep for the charity category._

### environment

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [EPA Toxics Release Inventory (TRI)](https://www.epa.gov/enviro/envirofacts-data-service-api-v1) | Quantified per-facility releases/transfers of ~800 toxics (mass, not just enforcement); parent-rollable | ~20k+ facilities/yr; most large CPG/food/auto manufacturers | Envirofacts REST API (no key) + Basic Plus bulk CSV/ZIP | free | annual | 9 |
| [Forest 500 (Global Canopy)](https://forest500.org/rankings/companies/) | Named-brand deforestation scores across 9 forest-risk commodities | 500 companies (heavy CPG) + 150 FIs; per-commodity scores | Excel (4 tabs) + 4 CSVs | free | annual | 9 |
| [USDA Organic INTEGRITY Database](https://organic.ams.usda.gov/integrity/) | Federal registry of USDA-certified-organic operations + status/scopes | 21k US / 31k worldwide ops; many food/CPG handlers | INTEGRITY SOAP/REST API + monthly snapshots + Ag Data Commons mirror | free | continuous / monthly | 9 |
| [RSPO Member & Certificate Registry](https://rspo.org/search-members/) | Sustainable-palm-oil supply-chain certification (net-new; we lack RSPO) | Thousands of members incl. Unilever, Nestlé, P&G, Colgate, Ferrero | Searchable directory + CSV/PDF lists | free | continuous / annual ACOP | 8 |
| [Science Based Targets initiative (SBTi)](https://sciencebasedtargets.org/target-dashboard) | Independently *validated* science-based emissions targets (vs disclosure/engagement) | ~10k+ companies; heavy FMCG/apparel/electronics/retail | Bulk companies xlsx (ISIN + LEI) | free | weekly | 7 |
| [EPA GHGRP / FLIGHT](https://www.epa.gov/ghgreporting/data-sets) | Regulator-collected facility Scope-1 GHG + parent rollup (independent of CDP) | ~8k large emitters; food/bev & CPG parents via Reported Parent Cos file | Envirofacts bulk + FLIGHT export | free | annual | 7 |
| [Banking on Climate Chaos](https://www.bankingonclimatechaos.org/) | Bank-by-bank fossil-fuel financing totals (grades consumer megabanks) | ~65 banks deeply (up to ~1,900); Chase, BofA, Citi, Wells Fargo | Full report + league tables + company lists | free | annual | 7 |
| [EPEAT Registry (GEC)](https://www.epeat.net/) | Electronics eco-cert (Bronze/Silver/Gold; lifecycle/materials, beyond ENERGY STAR) | Thousands of products; Apple, Dell, HP, Lenovo, Samsung | Public registry + per-product reports (HTML scrape) | free | daily | 7 |
| [bluesign System Partner list](https://www.bluesign.com/find-sustainable-brands) | Safer-chemistry / responsible-textile-production seal | 800–900+ partners; Patagonia, Mammut, lululemon, L.L.Bean | Brands-only PDF (monthly) + HTML directory | free | monthly/quarterly | 7 |
| [Non-GMO Project Verified](https://www.nongmoproject.org/find-non-gmo/) | Leading NA Non-GMO seal (distinct from organic) | 60k+ products / 3k+ brands; broad mainstream grocery | Brand-searchable Product Finder + spreadsheet on request | free | continuous | 7 |
| [Regenerative Organic Certified (ROC)](https://regenorganic.org/product-directory/) | Highest-bar regen-ag seal (soil + animal welfare + farmworker fairness) | ~145 companies / 1k+ products; Patagonia, Dr. Bronner's, Lundberg | Brand-searchable directory (HTML) | free | continuous | 6 |
| [Urgewald Global Coal Exit List (GCEL)](https://www.coalexit.org/data) | Coal-share-of-revenue / new-coal-developer flag (finer than CDP) | ~1,500 parents (~3,000 incl. subs) w/ parent-sub links | Excel bulk after free registration | freemium | annual | 6 |
| [OEKO-TEX Buying Guide / Label Check](https://www.oeko-tex.com/en/buying-guide/) | Textile chemical-safety seal (STANDARD 100 / MADE IN GREEN) | Large certified network; few hundred apparel/home brands resolvable | Buying Guide + Label Check (HTML, per-cert lookup) | free | continuous | 6 |
| [GOTS Certified Suppliers DB](https://global-standard.org/find-suppliers-shops-and-inputs/certifiedsuppliers) | Organic-fiber-processing certification (beyond FSC/Fair Trade) | Tens of thousands of entities; low-hundreds of brand owners | Searchable DB + per-entry scope certs (HTML) | free | frequent | 6 |
| [Global Energy Monitor (Ownership Trackers)](https://globalenergymonitor.org/projects/global-energy-ownership-tracker/download-data/) | Asset-to-parent fossil exposure w/ LEI (CC BY 4.0) | 182k facilities; utility/energy parents (Duke, NextEra, Southern) | Bulk Excel/CSV via request form | free | bi-annual | 5 |
| [EU ETS Union Registry / EUTL](https://www.eea.europa.eu/en/datahub/datahubitem-view/98f04097-26de-4fca-86c4-63834818c0c0) | Regulator-verified EU CO2 emissions (complements US GHGRP) | ~15k installations + 1.5k airlines; EU plants of global brands | EEA datahub bulk + euets.info CSV mirror | free | annual | 5 |
| [EU Industrial Emissions Portal (E-PRTR)](https://industry.eea.europa.eu/industrial-emissions/dataset) | EU analogue of TRI (pollutant releases/transfers, EU sites) | Largest IED complexes; food/bev/chem/paper/metals/autos | User-friendly Excel/CSV + full DB ZIP | free | annual | 5 |
| [ENERGY STAR Certified Products](https://data.energystar.gov/) | Federal energy-efficiency mark per appliance/electronics model | 45k+ models / ~1,800 brand owners (appliances/electronics only) | Socrata SODA API + CSV/JSON/XML bulk | free | daily | 5 |
| [USGBC LEED Project Directory](https://www.usgbc.org/projects) | Green-building cert for owned/operated buildings (Certified→Platinum) | 100k+ projects; hundreds of consumer-brand owners | Public directory (HTML) | free | continuous | 5 |
| [EU Ecolabel Product Catalogue (ECAT)](https://environment.ec.europa.eu/app/ecolabel-product-catalogue) | EU positive lifecycle eco-cert (detergents/paints/textiles/cosmetics/paper) | 3k+ licence holders / 100k+ products; tens–low-hundreds brand matches | API + CSV bulk (EU Open Data Portal) | free | continuous | 4 |

### labor

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [Fair Labor Association — Accredited & Participating](https://www.fairlabor.org/members/fla-accredited/) | Multi-year third-party labor-rights accreditation roster (positive) | 20+ accredited (Nike, adidas, lululemon, Uniqlo) + participating | Member directory + accreditation PDFs (HTML) | free | continuous | 7 |
| [Fair Food Program — Participating Buyers](https://fairfoodprogram.org/buyers/) | Worker-certified contractual commitment (+ documented non-joiners) | ~14 buyers (Walmart, McDonald's, Whole Foods, Chipotle, Yum) | HTML (site 403s bots; Wikipedia/FFSC mirror) | free | continuous / annual | 7 |
| [Fair Wear Foundation — Member Brands & Checks](https://www.fairwear.org/brands/) | Per-brand human-rights-due-diligence rating (Leader/Good/Needs Improvement) | 100+ garment brands (mostly EU labels) | Brand directory + per-brand PDF (factoryguide mirror) | free | annual | 6 |
| [Worker Rights Consortium — Factory Investigations](https://www.workersrights.org/our-work/factory-investigations/) | Named-brand factory-violation reports + whether remedies implemented | Hundreds of investigations + 20-yr collegiate-licensee DB | Reports HTML/PDF + search DB (subdomain blocks bots) | free | as completed / quarterly | 6 |
| [Open Supply Hub (OS Hub)](https://info.opensupplyhub.org/api) | Brand→supplier-facility mapping (join key for labor attribution) | Millions of facilities; broad brand sourcing coverage | Free CSV ≤5k facilities; API paid (~$225/mo) | freemium | continuous | 5 |

### dei

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [EEOC Newsroom press-release feed](https://www.eeoc.gov/newsroom/search) | High-frequency per-employer lawsuits/conciliations/settlements w/ $ + basis | 7,500+ releases; named employers, hundreds of consumer brands | HTML search (paginated scrape; RSS thin) | free | continuous | 7 |
| [EEOC OGC Annual Litigation Report](https://www.eeoc.gov/office-general-counsel-fiscal-year-2025-annual-report) | Named-defendant merits-suit digest (basis, court #, recovery, relief) | ~90–120 defendants/yr; archive back to ~2003 | One parseable HTML page per FY | free | annual | 6 |
| [California Civil Rights Dept (CRD) Reading Room](https://calcivilrights.ca.gov/readingroom/) | State civil-rights suits/settlements EEOC doesn't litigate (Tesla, Activision) | Dozens of high-profile named cases + settlements list | HTML reading room + PDFs (scrapeable) | free | continuous | 5 |

### animals

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [Fur Free Retailer (Fur Free Alliance)](https://furfreeretailer.com/) | Binding fur-free policy registry (apparel/luxury animal-welfare) | ~1,500+ brands; Gucci, Prada, Chanel, H&M, Zara, VF, adidas | Filterable directory (HTML scrape) | free | rolling | 7 |
| [Seafood Watch — Business Partners](https://www.seafoodwatch.org/collaborations/businesses) | Sustainable/humane-seafood sourcing commitments per company | ~340 partners; Whole Foods, Aramark, Compass, Disney, Red Lobster | Partner pages (JS-rendered, scrapeable) | free | rolling | 6 |

### guns

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [Don't Bank on the Bomb — Nuclear Weapon Producers](https://www.dontbankonthebomb.com/nwproducers/) | "Nuclear-weapons producer" flag from public defense contracts | ~24 cos/cycle; mostly defense primes (overlaps SIPRI) | HTML list + annual PDF | free | annual | 4 |

### privacy

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [GDPR Enforcement Tracker (CMS Law)](https://www.enforcementtracker.com/) | Every disclosed GDPR/ePrivacy fine (amount, article, authority) | ~3,195 actions; heavy consumer-multinational (Meta, Amazon, H&M, TikTok) | DataTables AJAX (scrape) + Excel/PDF report | free | hourly | 8 |
| [California AG Data Breach List](https://oag.ca.gov/privacy/databreach/list) | Legally-mandated breach notices (org + dates + notice) | Thousands since 2012; effectively every national brand in CA | HTML + full CSV bulk export | free | continuous | 8 |
| [Washington State AG Data Breach (Socrata)](https://data.wa.gov/resource/sb4j-ca4h.json) | Cleanest breach feed w/ quantitative severity (cause, attack type, affected) | All WA notices since Jul 2015; national brands in WA | Live Socrata JSON API + CSV/JSON bulk | free | continuous | 8 |
| [FTC Privacy & Data-Security Enforcement](https://www.ftc.gov/legal-library/browse/cases-proceedings) | US privacy/data-security consent orders (US counterpart to EU DPA fines) | Hundreds of orders; dozens of recognizable brands | HTML browse (ftc.gov 403s bots — server-side scrape) | free | continuous | 7 |
| [HHS OCR Breach Portal ("Wall of Shame")](https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf) | HIPAA breaches 500+ (pharmacy/insurer/retail-clinic) | 5,000+ breaches; thin consumer-brand slice | HTML portal + CSV export | free | continuous | 5 |
| [California Data Broker Registry (CPPA)](https://cppa.ca.gov/data_broker_registry/) | Statutory "is a data broker" flag + disclosed data-trading | ~500 brokers; mostly B2B, few consumer brands | HTML registry + per-year CSV | free | annual | 4 |

### execPay

_No net-new sources surfaced in this sweep for the executive-pay category._

---

## New categories

### tax / subsidies / corporate welfare

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [Good Jobs First — Subsidy Tracker](https://subsidytracker.goodjobsfirst.org/) | Per-parent corporate-welfare totals (credits, abatements, grants, megadeals) | 752k awards → ~1,500–3,000 parents; deep on Walmart/Amazon/Target/Nike | Free per-parent HTML pages (site 403s bots); bulk CSV paid | freemium | quarterly | 8 |
| [USAspending.gov — Federal Award Data](https://api.usaspending.gov/) | Federal contract/grant/loan $ flowing TO a brand (parent-UEI rollup) | Millions of recipients; skews defense/health/aerospace | Public REST API (no key) + bulk archive | free | daily | 4 |
| [ICIJ Offshore Leaks Database](https://offshoreleaks.icij.org/pages/database) | "Brand/owner appears in offshore secrecy structures" soft flag | 810k+ entities; thin, noisy slice maps to brand parents | Bulk CSV + Neo4j + REST/reconciliation API | free | per-leak | 4 |

### product safety & consumer protection

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [FTC Legal Library — Cases & Proceedings](https://www.ftc.gov/legal-library/browse/cases-proceedings) | Named-company FTC actions (false advertising, deceptive billing, data-security) | 6,086 cases; hundreds–1,000+ consumer brands | Filterable browse + refunds dataset (browser-grade fetch) | free | continuous | 8 |
| [FDA Warning Letters](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters) | Firm-level violation letters (adulteration, misbranding, deceptive labeling) | Thousands of firms; food/drug/supplement/cosmetic/device/tobacco | Advanced-search + per-letter spreadsheet export | free | weekly | 8 |
| [FDA Inspection Citations & Form 483s](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-references/inspection-citation) | Upstream inspection-failure record (483 observations, NAI/VAI/OAI) | All inspected FDA establishments; FEI-keyed | REST API (api-datadashboard.fda.gov) + bulk Excel | free | weekly | 8 |
| [EU Safety Gate (RAPEX)](https://ec.europa.eu/safety-gate-alerts/) | EU dangerous-product alerts (brand + hazard + corrective measure); non-US | Tens of thousands of alerts across 31 countries | Weekly XML API + EU Open Data bulk + OpenDataSoft mirror | free | weekly/daily | 8 |
| [Health Canada Recalls & Safety Alerts](https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3) | Full second NA regulator's recall record (food/products/health/cosmetics/devices) | All Canadian recalls; heavy US/CA multinational overlap | JSON API + CSV bulk (EN/FR), OGL-Canada | free | daily | 7 |
| [Australia ACCC Product Safety recalls](https://www.productsafety.gov.au/recalls) | APAC recall register (brand + hazard + action) | 8,000+ records; many global brands (overlaps US recalls) | HTML search + RSS feed | free | daily | 5 |

### healthcare / pharma payments

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [FDA Compliance Actions Dashboard](https://datadashboard.fda.gov/oii/cd/complianceactions.htm) | Warning Letters / seizures / injunctions by firm (NOT in openFDA) | All firms w/ these actions; drug/food/device/cosmetic/tobacco | Excel "Download Dataset" + OII API (free key optional) | free | weekly | 8 |
| [FDA Inspections / Classification DB (NAI/VAI/OAI)](https://datadashboard.fda.gov/oii/cd/inspections.htm) | Firm/facility inspection outcomes (OAI = out-of-compliance) + 483s | All classified FDA inspections; firm + FEI | Dashboard Excel exports + OII API | free | weekly | 7 |
| [Opioid Settlement Tracker](https://www.opioidsettlementtracker.com/globalsettlementtracker) | Defendant-level opioid settlement $ (CVS, Walgreens, Walmart, J&J, Teva) | ~12–20 defendants; ~$58B tracked | Rebuild from primary state-AG / SEC 8-K records (NC license on compilation) | free | as settled | 7 |
| [CMS Open Payments (Sunshine Act)](https://openpaymentsdata.cms.gov/about/api) | Pharma/device payments to prescribers per manufacturer | All manufacturers/GPOs since 2013; pharma majors | No-auth Socrata API + bulk CSV | free | annual | 6 |
| [FDAAA TrialsTracker (Oxford)](https://fdaaa.trialstracker.net/) | Per-sponsor clinical-trial-results reporting compliance (due/reported/overdue) | Hundreds of sponsors; large pharma maps to consumer brands | HTML table + "Download this data" | free | continuous | 5 |

### Norges Bank ethics exclusions

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [Norges Bank / GPFG Exclusion & Observation List](https://www.nbim.no/en/responsible-investment/exclusion-of-companies/) | Most authoritative state-backed conduct+product exclusion register (weapons, tobacco, coal, human-rights, corruption, GHG) | ~580 companies, each w/ stated criterion | OpenSanctions `no_nbim_exclusions` JSON/CSV (CC-BY) or NBIM scrape | free | continuous | 9 |

### advertising & marketing conduct

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [UK ASA Advertising Rulings](https://www.asa.org.uk/codes-and-rulings/rulings.html) | UK ad-regulator adjudications (misleading/greenwashing; advertiser + Upheld) | Hundreds of brands; archive back to ~2002; greenwashing subset deep | HTML search (robots-allowed scrape; no API) | free | weekly | 7 |

### corporate fraud / financial-crime enforcement

| Source | Signal added | Coverage | Access | Cost | Cadence | Value |
|---|---|---|---|---|---|---|
| [FinCEN Enforcement Actions](https://www.fincen.gov/news/enforcement-actions) | Treasury BSA/AML civil penalties (distinct from OFAC/OCC/FDIC/Fed) | Dozens–low-hundreds of actions; mostly banks/MSBs/crypto | HTML list + linked consent-order PDFs | free | continuous | 5 |

---

## Ingestion priority

Each source becomes a `{src}-fetch.mjs` + `{src}-merge.mjs` + a workflow cron entry on the tier matching its cadence (daily/weekly → nightly or weekly cron; annual/quarterly → monthly cron).

### Quick wins — free API / bulk export, clean entity keys

These have a documented API or bulk file and a stable key (ID, ISIN/LEI, FEI, FRN, UEI, or Socrata fields). Build these first.

- **EPA Toxics Release Inventory (TRI)** — Envirofacts REST + Basic Plus bulk; FRS ID + parent name.
- **Norges Bank / GPFG Exclusions** — OpenSanctions `no_nbim_exclusions` JSON/CSV (CC-BY); our existing `opensanctions-fetch.mjs` only streams the consolidated sanctions set, so add this dataset explicitly.
- **Forest 500** — Excel + 4 CSVs; company name + parent.
- **USDA Organic INTEGRITY** — SOAP/REST API + monthly XML snapshot + Ag Data Commons mirror.
- **EPA GHGRP / FLIGHT** — Reported Parent Companies XLSB; facility ID + parent + ownership %.
- **SBTi Target Dashboard** — weekly companies xlsx; ISIN + LEI (cleanest resolution in the batch).
- **Washington State AG Data Breach** — live Socrata JSON API; org name + industry.
- **California AG Data Breach** — full CSV bulk export.
- **FDA Inspection Citations & 483s** — REST API + bulk Excel; firm + FEI.
- **FDA Compliance Actions Dashboard** — Excel "Download Dataset"; firm + FEI.
- **FDA Inspections / Classification DB** — dashboard Excel exports; firm + FEI.
- **CMS Open Payments** — no-auth Socrata API + bulk CSV; manufacturer name.
- **ENERGY STAR Certified Products** — Socrata SODA API; brand_name + model + UPC.
- **EU Safety Gate (RAPEX)** — weekly XML API + EU Open Data / OpenDataSoft mirror (brand string only — see Caveats).
- **Health Canada Recalls** — JSON API + CSV bulk (OGL-Canada).
- **EU Ecolabel (ECAT)** — API + CSV bulk (EU Open Data Portal).
- **USAspending.gov** — public REST API (no key) + bulk archive; recipient UEI / parent UEI.
- **UK FCA FS Register** — official API keyed on Firm Reference Number (Final Notices scrape separately).
- **Global Energy Monitor** — CC BY 4.0 bulk Excel/CSV via request form; owner + parent + LEI.
- **EU ETS / EUTL** — EEA datahub bulk + euets.info CSV mirror.
- **EU E-PRTR** — user-friendly Excel/CSV + full DB ZIP.
- **ICIJ Offshore Leaks** — bulk CSV + reconciliation API (treat as soft flag — see Caveats).
- **HHS OCR Breach Portal** — CSV export.
- **California Data Broker Registry** — per-year CSV.
- **GDPR Enforcement Tracker** — DataTables AJAX JSON endpoint (scrape; attribution required).

### Medium — public HTML/PDF, light scraping or per-record lookup, mostly-clean names

Stable but no clean bulk API; ingest via polite paginated scrape or per-entry pages, with name-normalization to the brand map.

- **FDA Warning Letters** — advanced-search + per-letter spreadsheet export (data.gov XML mirror is stale).
- **FTC Legal Library — Cases & Proceedings** — filterable browse; case→brand matching is medium effort; ftc.gov needs browser-grade fetch.
- **FTC Privacy & Data-Security Enforcement** — same ftc.gov 403 protection; server-side scrape.
- **EEOC Newsroom press-release feed** — paginated HTML scrape (~313 pages); RSS only ~20 recent items.
- **EEOC OGC Annual Litigation Report** — one parseable HTML page per FY (historical backfill for the newsroom feed).
- **California CRD Reading Room** — HTML case files + PDFs.
- **RSPO Member Registry** — searchable directory + CSV/PDF export.
- **bluesign System Partners** — brands-only PDF (monthly).
- **Non-GMO Project Verified** — brand-searchable Finder + spreadsheet on request.
- **Regenerative Organic Certified** — brand-searchable directory.
- **EPEAT Registry** — registry + per-product reports.
- **USGBC LEED** — public directory HTML.
- **Fair Labor Association** — member directory + accreditation PDFs.
- **Fair Food Program** — small stable roster (Wikipedia/FFSC mirror; site 403s bots).
- **Fair Wear Foundation** — directory + per-brand PDF (factoryguide mirror for JS page).
- **Fur Free Retailer** — filterable directory scrape.
- **Seafood Watch Business Partners** — JS-rendered partner pages.
- **Urgewald GCEL** — Excel after free registration.
- **UK ASA Rulings** — weekly HTML rulings scrape (robots-allowed).
- **UK CMA Cases** — GOV.UK case finder + content API.
- **UK FCA Final Notices** — HTML/PDF (Register half is a Quick win).
- **LobbyFacts / EU Transparency Register** — prefer the official register open data over the LobbyFacts UI.
- **UK ORCL** — searchable register + full download.
- **FinCEN Enforcement Actions** — HTML list + consent-order PDFs.
- **FDAAA TrialsTracker** — HTML table + "Download this data".
- **Opioid Settlement Tracker** — rebuild defendant→amount from primary state-AG / SEC 8-K records (do NOT ingest the NC compilation directly).
- **Good Jobs First — Subsidy Tracker** — rate-limited per-parent HTML pages (bulk CSV is paywalled, site 403s automated fetch).
- **Banking on Climate Chaos** — public report datasets + league tables.

### Heavy — fuzzy matching, blocked fetchers, or entity-resolution work

Real ingestion lift: name-only entity resolution, anti-bot blocks, unstructured per-record extraction, or join-key infrastructure rather than a direct verdict.

- **EU Safety Gate (RAPEX)** — clean API but brand is a free-text string with no registry ID, and ~1/3 of notifications are low-completeness / unbranded counterfeit goods; needs name-normalization + filtering.
- **Worker Rights Consortium** — unstructured per-investigation PDF/HTML extraction; search subdomain blocks bots.
- **Open Supply Hub** — infrastructure/join key, not a verdict; free CSV caps at 5k facilities (API ~$225/mo); use as enrichment only.
- **ICIJ Offshore Leaks** — name/jurisdiction fuzzy matching with high false-positive and defamation risk; soft flag only.
- **OEKO-TEX** — per-certificate-number lookup, no bulk; certs often resolve to suppliers not consumer brands.
- **GOTS Certified Suppliers** — HTML search only; many entries are mid-supply-chain processors.

---

## Caveats

- **License / commercial-reuse review (paid app):** TruNorth is a paid app, so non-commercial or copyleft terms need legal review before shipping. **Opioid Settlement Tracker** is CC BY-NC — rebuild the defendant→amount table from primary state-AG / SEC 8-K / nationalopioidsettlement.com records rather than ingesting the compilation. **ICIJ Offshore Leaks** is ODbL + CC BY-SA — commercial use is permitted but ShareAlike copyleft is awkward for a proprietary app; ingest direct from ICIJ (commercial-OK), not the NC OpenSanctions mirror. **SBTi**, **Urgewald GCEL**, **Forest 500**, **RSPO**, **Banking on Climate Chaos**, **Global Canopy**, and **Don't Bank on the Bomb** reserve rights / expect attribution — confirm bulk-redistribution terms. **GDPR Enforcement Tracker** (CMS) and **ASA** expect attribution and have unverified bulk-reuse terms.
- **Anti-bot / blocked fetchers:** **ftc.gov** (FTC Legal Library + Privacy enforcement) sits behind Akamai and 403s automated fetch — needs a real-UA server-side scrape, not WebFetch. **Good Jobs First** and **Fair Food Program** 403 automated fetchers (use rate-limited per-parent pages / the Wikipedia-FFSC mirror). The **WRC** search subdomain blocks bots.
- **Name-only entity resolution (no registry ID):** **EU Safety Gate (RAPEX)**, **Health Canada**, **ACCC**, **GDPR Tracker**, **EEOC** feeds, **CRD**, **ASA**, **FinCEN**, and most NGO certification rosters key on a company/brand name string — they need normalization into the brand map and carry fuzzy-match risk. RAPEX is the worst case: a large share of alerts are unbranded/counterfeit marketplace goods, so net brand-match yield is real but lossy.
- **Coverage-limited / narrow vertical:** **ENERGY STAR**, **EPEAT** (electronics/appliances only); **CMS Open Payments**, **FDAAA TrialsTracker** (pharma/device majors only); **EU ETS / E-PRTR / EU Ecolabel / GHGRP** (EU-only or heavy-industry-skewed, thin CPG overlap); **HHS OCR** and **California Data Broker Registry** (mostly non-consumer / B2B entities); **FinCEN** (banks/MSBs/crypto). High signal where they hit, but small marginal coverage across TruNorth's CPG-heavy catalog.
- **Signal-framing risk:** **CMS Open Payments** ("payments to doctors"), **USAspending** ("receives federal contracts"), and **ICIJ Offshore Leaks** ("appears offshore") are NOT inherently wrongdoing — frame as low-weight flags, never standalone verdicts. **LobbyFacts** and **FEC**-style figures are self-declared, not audited.
- **Overlap to manage:** **EEOC OGC Annual Report** is the curated downstream of the EEOC newsroom feed — use the feed as primary, the report as historical backfill. **CRD** partially overlaps EEOC on the biggest cases (Activision was both) — build one CRD fetcher. **Don't Bank on the Bomb** (~24 cos) mostly overlaps the live SIPRI list. **ACCC** / **Health Canada** recalls partly co-move with existing US CPSC/NHTSA/FSIS/FDA feeds for shared multinationals — the lift is the country-specific tail.
- **Housekeeping note:** the **Build-75 pbxproj/Info.plist bump** (`1fec2ee50`) lives on `feat/qa-review-fixes-2026-06-14`, not main — cherry-pick before the next ship-from-main or it re-bumps and collides.
