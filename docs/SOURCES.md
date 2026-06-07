# TruNorth Data Sources — Master Registry

> **Single source of truth** for every data source TruNorth pulls from. Mirrored by `SOURCES_DATA` in `src/App.jsx`, which renders the in-app Sources tab. Any time we add or remove a source, both this doc + that array stay in sync.

**Last updated:** 2026-06-07 (B-14: Leaping Bunny + PETA BWB upgraded from manual entries to live quarterly pipeline)

---

## Summary

| Status | Count |
|---|---|
| ✅ Live in pipeline | **101** 🎯 |
| 🟡 In flight | 0 |
| 📋 Planned (queued) | 0 |
| 💰 Paid alternatives (not used) | see bottom |
| **Categories (in-app groups)** | **18** |

> **2026-06-04 milestone:** Hit the 100-source mark. All Tier 1-7 integrations shipped in the Jun 3-4 push (46 baseline + 54 new). Tier 8 (California Prop 65 + CARB) was deferred per product decision.

---

## ✅ Live sources (100, grouped by in-app category)

> Each group below maps 1:1 to a group in the Sources tab inside the app. URLs link to the primary source. Cadence shows how often the cron refreshes that source.

### Company universe (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| SEC EDGAR | https://www.sec.gov/edgar | Quarterly | Public ticker list + 10-K Exhibit 21 subsidiary tree |
| Wikidata | https://www.wikidata.org | Quarterly | Brand→parent corporate graph |
| Open Food Facts | https://world.openfoodfacts.org | Annual | Crowdsourced grocery brand-to-parent |

### Federal enforcement (19)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| DOJ Press Releases | https://www.justice.gov/news | Weekly | Antitrust, fraud, criminal, civil rights, environment, tax (90-day) |
| DOJ FCPA Cases | https://www.justice.gov/criminal/criminal-fraud/foreign-corrupt-practices-act | Monthly | Every DPA/NPA + criminal/civil FCPA case since 1977 |
| DOJ Antitrust Division | https://www.justice.gov/atr/case-document | Monthly | Settlements, judgments, merger challenges, cartel cases |
| SEC Litigation Releases | https://www.sec.gov/litigation | Weekly | Lifetime + 24-mo defendant tracking |
| CourtListener (RECAP) | https://www.courtlistener.com | Weekly | Federal court records, case-type tagged |
| GSA SAM Excluded Parties | https://sam.gov/exclusions | Monthly | Federal contractor blacklist |
| Treasury OFAC Sanctions | https://ofac.treasury.gov | Monthly | SDN + SSI + FSE + NS-PLC consolidated list |
| OCC Bank Enforcement | https://apps.occ.gov/EnforcementActions/ | Weekly | National-bank enforcement actions |
| FDIC Enforcement | https://orders.fdic.gov | Weekly | State-chartered bank orders + actions |
| Federal Reserve Enforcement | https://www.federalreserve.gov/supervisionreg/enforcementactions.htm | Monthly | Bulk CSV — bank holding cos + state member banks since 1989 |
| FINRA Disciplinary Actions | https://brokercheck.finra.org | Weekly | BrokerCheck regulatory history per broker-dealer |
| CFTC Enforcement | https://www.cftc.gov/PressRoom/PressReleases | Monthly | Civil monetary penalties — commodity traders, futures brokers |
| PCAOB Enforcement | https://pcaobus.org/oversight/enforcement/enforcement-actions | Monthly | Settled disciplinary orders against audit firms |
| FERC Enforcement | https://www.ferc.gov/enforcement-legal/enforcement/civil-penalty-actions | Weekly | Civil penalty actions against energy traders + utilities |
| HUD Fair Housing | https://www.hud.gov/program_offices/fair_housing_equal_opp/enforcement | Monthly | FHEO charges + settlements (race, disability, redlining) |
| Stanford Securities Class Action Clearinghouse | https://securities.stanford.edu/filings.html | Monthly | Every securities class action since 1996 |
| GAO Reports | https://www.gao.gov/reports-testimonies | Monthly | Reports + testimonies + bid protests |
| Oversight.gov (IG reports) | https://www.oversight.gov/reports | Monthly | 70+ federal Inspector General offices aggregated |
| MuckRock FOIA | https://www.muckrock.com | Monthly | Public Freedom of Information Act requests per brand |

### Consumer protection (5)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| CFPB Complaint Database | https://www.consumerfinance.gov | Weekly | Financial brands — banks, credit, mortgages, debt collection |
| CPSC Recalls | https://www.cpsc.gov/Recalls | Weekly | Toys, electronics, appliances |
| NHTSA Vehicle Recalls + Complaints | https://www.nhtsa.gov | Weekly | Auto brands — make × model × year |
| FCC Consumer Complaints | https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj | Weekly | Wireless, internet, robocalls, billing |
| California AG Enforcement Actions | https://oag.ca.gov/consumers/actions | Monthly | High-signal consumer-protection settlements — privacy, labor, environment, charity, consumer fraud (B-27) |

### Political donations (6)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| FEC.gov | https://www.fec.gov | Monthly | US federal campaign finance |
| OpenSecrets | https://www.opensecrets.org | Monthly | Aggregated donations + lobbying |
| InfluenceMap | https://influencemap.org | Annual | Climate-policy lobbying scores |
| OpenStates | https://openstates.org | Monthly | State-level legislation |
| CPA-Zicklin Index | https://politicalaccountability.net/cpa-zicklin-index | Annual | S&P 500 ranking on political-spending disclosure |
| As You Sow | https://www.asyousow.org/reports | Annual | Shareholder-resolution + corporate scorecards |

### Charitable giving (2)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| Charity Navigator | https://www.charitynavigator.org | Annual | Nonprofit financial health |
| Candid / GuideStar | https://candid.org | Annual | Nonprofit 990 forms |

### Environmental (8)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| CDP (Carbon Disclosure Project) | https://www.cdp.net | Annual | A–D climate/water/forests grades |
| B Corp Certification | https://www.bcorporation.net | Annual | Certified-brand list |
| EPA Enforcement | https://www.epa.gov/enforcement | Monthly | Clean Air/Water/Superfund actions |
| EPA ECHO | https://echo.epa.gov | Weekly | Facility-level enforcement |
| PHMSA Pipeline Incidents | https://www.phmsa.dot.gov/data-and-statistics/pipeline/pipeline-incident-flagged-files | Weekly | Fatalities, injuries, damages per pipeline operator |
| NRC Event Reports | https://www.nrc.gov/reading-rm/doc-collections/event-status | Weekly | Nuclear utility events + enforcement |
| Break Free From Plastic | https://www.breakfreefromplastic.org | Annual | Annual plastic polluter ranking |
| Climate Action 100+ | https://www.climateaction100.org | Annual | ~167 focus companies + disclosure grades |

### Labor practices (8)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| OSHA Violations | https://www.osha.gov | Monthly | Workplace inspections + fines |
| OSHA Severe Injury Reports | https://www.osha.gov/severe-injury-reports | Monthly | Per-establishment amputations + hospitalizations |
| MSHA Mine Incidents | https://www.msha.gov/data-reports | Weekly | Citations, fatalities, penalties per mine operator |
| NLRB | https://www.nlrb.gov | Monthly | Union elections + labor-practice investigations |
| DOL Wage & Hour Division | https://enforcedata.dol.gov | Monthly | Back wages, employee impact per case |
| DOL OFCCP | https://www.dol.gov/agencies/ofccp | Monthly | Federal-contractor audits + settlements |
| Violation Tracker | https://violationtracker.goodjobsfirst.org | Monthly | Aggregates 50+ federal agency penalties |
| Oxfam Behind The Brands | https://www.oxfam.org/en/research/behind-brands | Annual | Food-company worker rights |

### Supply-chain & human rights (8)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| BHRRC | https://www.business-humanrights.org | Annual | Forced labor, child labor, modern slavery |
| US DOL TVPRA Child/Forced Labor List | https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods | Annual | Government list of high-risk products |
| Yale CELI Russia Tracker | https://som.yale.edu | Annual | A–F grades on post-2022 Russia exit |
| KnowTheChain | https://knowthechain.org/benchmarks | Annual | ICT / F&B / Apparel / General sector benchmarks |
| UK Modern Slavery Act Registry | https://modern-slavery-statement-registry.service.gov.uk | Annual | UK gov registry of corporate MSA statements |
| GoodWeave Certification | https://goodweave.org | Annual | Anti-child-labor certification for rugs/textiles |
| Fair Trade USA | https://www.fairtradecertified.org | Annual | Fair Trade Certified consumer brands |
| Rainforest Alliance | https://www.rainforest-alliance.org | Annual | Certified coffee, tea, cocoa, bananas, palm oil brands |

### DEI (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| HRC Corporate Equality Index | https://www.hrc.org/cei | Annual | 0–100 LGBTQ+ workplace score |
| EEOC | https://www.eeoc.gov | Annual | Workplace discrimination (aggregate) |
| UK Gender Pay Gap Service | https://gender-pay-gap.service.gov.uk | Annual | Mean/median pay gap for every UK employer >250 staff |

### Firearms (1)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| ATF Federal Firearms Licenses | https://www.atf.gov/firearms/listing-federal-firearms-licensees | Monthly | Manufacturer/dealer/importer license types by state |

### Animal testing & welfare (4)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| PETA Beauty Without Bunnies | https://crueltyfree.peta.org/companies-do-test-on-animals/ + /companies-dont-test-on-animals/ | Quarterly | B-14: two-list scrape (DO test + DON'T test). Negative list lights "Confirmed animal testing" badge; positive list lights "Cruelty-free certified". Fetcher: `scripts/peta-bwb-fetch.mjs`; merger: `scripts/cruelty-free-merge.mjs`. Cloudflare-tolerant (emits `blocked` field on 403/503 so merger can keep using prior snapshot). |
| Leaping Bunny | https://www.leapingbunny.org/shopping-guide | Quarterly | B-14: certified-brand list scrape by A–Z + 0–9 letter pages, 2s req delay. Strongest cruelty-free signal (binding pledge incl. ingredient suppliers). Third-party certification overrides AI-narrative-based `sc.animals`. Fetcher: `scripts/leaping-bunny-fetch.mjs`. |
| ASPCA | https://www.aspca.org | Annual | Animal welfare in food/agriculture supply chains |
| USDA APHIS Enforcement | https://www.aphis.usda.gov/aphis/ourfocus/animalwelfare/news-info/enforcement | Monthly | AWA inspection violations + civil penalties |

### Drug enforcement (1)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| DEA Diversion Control | https://www.federalregister.gov/agencies/drug-enforcement-administration | Monthly | DEA Decisions, Orders + Show Cause notices (pharmacies, distributors, mfrs) |

### Data privacy & security (8)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| Have I Been Pwned | https://haveibeenpwned.com | Monthly | 1,000+ documented breaches |
| CISA Known Exploited Vulnerabilities | https://www.cisa.gov/kev | Weekly | Actively-exploited CVE catalog per vendor |
| NIST National Vulnerability Database | https://nvd.nist.gov | Monthly | Lifetime + recent 24-mo + critical/high CVE counts |
| OSV (Open Source Vulnerabilities) | https://osv.dev | Monthly | Per-package vulns across npm/Maven/NuGet/PyPI/etc. |
| GitHub Security Advisories | https://github.com/advisories | Monthly | Per-package advisories filtered to vendor maintainers |
| CERT Vulnerability Notes | https://kb.cert.org/vuls | Monthly | Carnegie Mellon SEI per-vendor security disclosures |
| EFF | https://www.eff.org | Annual | Corporate surveillance + privacy records |
| Mozilla Privacy Not Included | https://foundation.mozilla.org/privacynotincluded | Annual | App/service privacy ratings |

### Health & product safety (7)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| OpenFDA | https://open.fda.gov | Weekly | Food, drug, device recalls by Class I/II/III |
| FSIS Recalls (USDA) | https://www.fsis.usda.gov/recalls | Weekly | Meat, poultry, egg products — separate from FDA |
| NTSB Accident Reports | https://data.ntsb.gov | Weekly | Aviation, rail, marine, highway investigations |
| FAA Service Difficulty Reports | https://av-info.faa.gov/sdrx | Weekly | SDRs + Airworthiness Directives + accident data per aircraft mfr |
| FRA Railroad Incidents | https://railroads.dot.gov/safety-data | Weekly | Fatalities + hazmat releases per railroad |
| CDC FoodNet | https://www.cdc.gov/foodnet | Monthly | Multistate foodborne outbreaks per brand |
| HHS OIG | https://oig.hhs.gov/fraud/enforcement | Monthly | Healthcare fraud + LEIE exclusions |

### Sustainability certifications & rankings (9)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| Marine Stewardship Council (MSC) | https://www.msc.org | Annual | Sustainable-seafood certification |
| Forest Stewardship Council (FSC) | https://fsc.org | Annual | Sustainable forestry for paper/lumber/packaging |
| Cradle to Cradle Certified | https://www.c2ccertified.org | Annual | Bronze/Silver/Gold/Platinum tiers for circular-economy products |
| Climate Neutral Certified | https://www.climateneutral.org | Annual | Brand-level carbon-neutral cert with offset disclosure |
| UN Global Compact | https://www.unglobalcompact.org/participation | Annual | UN voluntary corporate sustainability initiative participants |
| JUST 100 (JUST Capital) | https://justcapital.com | Annual | Russell 1000 ranking on workers/customers/communities/environment/shareholders |
| Ethisphere World's Most Ethical Companies | https://ethisphere.com/wme | Annual | Annual ~135-company honoree list |
| Newsweek Most Responsible Companies | https://www.newsweek.com/rankings/americas-most-responsible-companies | Annual | Annual top 600 US ranking on ESG |
| WikiRate | https://wikirate.org | Monthly | Crowdsourced ESG metrics aggregator (needs API key) |

### International regulators (4)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| EU DG Comp Antitrust | https://ec.europa.eu/competition/antitrust | Monthly | EU Commission antitrust + merger decisions, fines in EUR |
| EU Consolidated Sanctions | https://www.sanctionsmap.eu | Monthly | EU financial sanctions DB — entities + programmes |
| Canadian Competition Bureau | https://www.canada.ca/en/competition-bureau | Monthly | Merger reviews + deceptive marketing + cartels (CAD) |
| Australian ACCC | https://www.accc.gov.au | Monthly | Enforcement actions + court cases (AUD) |

### Executive pay (2)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| AFL-CIO Executive Paywatch | https://aflcio.org/paywatch | Annual | CEO-to-worker pay ratios |
| SEC Executive Compensation Proxy | https://www.sec.gov | Annual | DEF 14A proxy disclosures |

### News & global press (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| Google News RSS | https://news.google.com | Daily | US news per brand across 1,000+ outlets |
| AllSides Media Bias | https://www.allsides.com/media-bias | Quarterly | Bias ratings for 33+ outlets (left → right) |
| GDELT Project | https://www.gdeltproject.org | Weekly | Global news + events in 100+ languages |

---

## 💰 Paid sources (not used) — for future consideration

### Scraping infrastructure (would re-enable Cloudflare-blocked sources)

| Service | Cost | Could re-enable |
|---|---|---|
| ScrapingBee | $49/mo | BBB ratings, ConsumerAffairs |
| ScraperAPI | $49/mo | Same — alternative vendor |
| Bright Data | $500+/mo | Enterprise residential IPs |
| Apify | $49-99/mo | General scraping (incl. Indeed reviews) |

### Premium ESG ratings (institutional tier)

| Service | Cost | What it adds |
|---|---|---|
| MSCI ESG | $30k+/yr | Industry-standard ESG ratings |
| Sustainalytics | $25k+/yr | Morningstar's ESG database |
| Refinitiv ESG | $15k+/yr | Comprehensive ESG database |
| Bloomberg ESG | $24k/yr/terminal | Terminal-only |

### Premium news feeds

| Service | Cost | What |
|---|---|---|
| NewsAPI | $449/mo | Structured news aggregation |
| NewsCatcher | $349/mo | Alternative |
| Mediastack | $99/mo | Cheaper news alternative |
| Crunchbase Pro | $99-999/mo | Funding + startup data |
| OpenCorporates Premium | $$$ | Corporate hierarchy graphs |
| D&B Hoovers | $5k+/yr | Enterprise corporate data |
| PACER | $0.10/page | Federal court records (we have CourtListener free subset) |

### Currently used (paid or freemium)

| Service | Cost | Used for |
|---|---|---|
| Anthropic API | ~$20-50/mo | News extraction + narrative bake |
| PostHog | Free <1M events/mo | Analytics |
| MailerLite | Free <1k subscribers / <12k emails | Email list |
| Resend | Free <3k emails/mo | Transactional email |
| Vercel | Free hobby tier | Hosting |
| GitHub Actions | Free 2,000 min/mo | Cron jobs (~30% utilization) |
| Apple Developer | $99/yr | App Store membership |

### Future paid items (in BACKLOG as blocked)

| Item | Cost | Status |
|---|---|---|
| Apify Indeed scraper | $10/mo | X-3 — needs LLC + token |
| MailerLite paid plan | $9-39/mo | X-4 — triggers at >1k subscribers |
| RevenueCat + Apple IAP | Free <$2.5k MRR | X-2 — needs LLC |

---

## How this document is maintained

- Updated when sources are added/removed.
- The `SOURCES_DATA` array in `src/App.jsx` is the live runtime mirror; keep them in sync.
- The marketing landing's source-count claim is computed from this list.
- Per-source cadences feed the user-facing "About freshness" panel in the Sources tab.
- See `/docs/INVESTOR_BRIEF.md` for the same data in investor-facing framing.
