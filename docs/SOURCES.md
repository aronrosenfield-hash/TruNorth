# TruNorth Data Sources — Master Registry

> **Single source of truth** for every data source TruNorth pulls from. Updated as we add or remove sources. Mirrored by `SOURCES_DATA` in `src/App.jsx`, which renders the in-app Sources tab.

**Last updated:** 2026-06-03

---

## Summary

| Status | Count |
|---|---|
| ✅ Live in pipeline | 46 |
| 🟡 In flight (agent building) | 0 |
| 📋 Planned (queued) | 54 |
| 💰 Paid alternatives (not used) | see bottom |
| **Total target** | **100+** |

---

## ✅ Live sources (46) — in active pipeline as of 2026-06-03

### Company universe (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| SEC EDGAR | https://www.sec.gov/edgar | Quarterly | Public ticker list + 10-K Exhibit 21 subsidiary tree |
| Wikidata | https://www.wikidata.org | Quarterly | Brand→parent corporate graph |
| Open Food Facts | https://world.openfoodfacts.org | Annual | Crowdsourced grocery brand-to-parent |

### Federal enforcement (4)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| DOJ Press Releases | https://www.justice.gov/news | Weekly | Antitrust, fraud, criminal, civil rights, environment, tax (90-day) |
| SEC Litigation Releases | https://www.sec.gov/litigation | Weekly | Lifetime + 24-mo defendant tracking |
| CourtListener (RECAP) | https://www.courtlistener.com | Weekly | Federal court records, case-type tagged |
| GSA SAM Excluded Parties | https://sam.gov/exclusions | Monthly | Federal contractor blacklist |

### Consumer protection (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| CFPB Complaint Database | https://www.consumerfinance.gov | Weekly | Financial brands — banks, credit, mortgages |
| CPSC Recalls | https://www.cpsc.gov/Recalls | Weekly | Toys, electronics, appliances |
| NHTSA Vehicle Recalls/Complaints | https://www.nhtsa.gov | Weekly | Auto brands — make × model × year |

### Political donations (4)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| FEC.gov | https://www.fec.gov | Monthly | US federal campaign finance |
| OpenSecrets | https://www.opensecrets.org | Monthly | Aggregated donations + lobbying |
| InfluenceMap | https://influencemap.org | Annual | Climate-policy lobbying scores |
| OpenStates | https://openstates.org | Monthly | State-level legislation |

### Charitable giving (2)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| Charity Navigator | https://www.charitynavigator.org | Annual | Nonprofit financial health |
| Candid / GuideStar | https://candid.org | Annual | Nonprofit 990 forms |

### Environmental (5)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| CDP (Carbon Disclosure Project) | https://www.cdp.net | Annual | A-D climate/water/forests grades |
| B Corp Certification | https://www.bcorporation.net | Annual | Certified-brand list |
| EPA Enforcement | https://www.epa.gov/enforcement | Monthly | Clean Air/Water/Superfund actions |
| EPA ECHO | https://echo.epa.gov | Weekly | Facility-level enforcement |
| Break Free From Plastic | https://www.breakfreefromplastic.org | Annual | Plastic polluter ranking |

### Labor practices (5)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| OSHA Violations | https://www.osha.gov | Monthly | Workplace inspections + fines |
| OSHA Severe Injury Reports | https://www.osha.gov/severe-injury-reports | Monthly | Amputations + hospitalizations per est. |
| NLRB | https://www.nlrb.gov | Monthly | Union elections + labor practices |
| Violation Tracker | https://violationtracker.goodjobsfirst.org | Monthly | 50+ agency penalties aggregator |
| Oxfam Behind The Brands | https://www.oxfam.org/behind-brands | Annual | Food-company worker rights |

### Supply chain & human rights (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| BHRRC | https://www.business-humanrights.org | Annual | Forced labor, child labor, slavery |
| US DOL Child/Forced Labor List | https://www.dol.gov/agencies/ilab | Annual | Annual gov list |
| Yale CELI Russia Tracker | https://som.yale.edu | Annual | A-F Russia exit grades |

### DEI (2)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| HRC Corporate Equality Index | https://www.hrc.org/cei | Annual | 0-100 LGBTQ+ workplace |
| EEOC | https://www.eeoc.gov | Annual | Workplace discrimination (aggregate) |

### Animal testing (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| PETA Beauty Without Bunnies | https://www.peta.org/living/personal-care-fashion/beauty-without-bunnies/ | Annual | Cruelty-free DB |
| Leaping Bunny | https://www.leapingbunny.org | Annual | Cruelty-free certification |
| ASPCA | https://www.aspca.org | Annual | Animal welfare in food/ag |

### Data privacy & security (4)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| Have I Been Pwned | https://haveibeenpwned.com | Monthly | 1000+ documented breaches |
| CISA Known Exploited Vulnerabilities | https://www.cisa.gov/kev | Weekly | Per-vendor CVE catalog |
| EFF | https://www.eff.org | Annual | Corporate surveillance |
| Mozilla Privacy Not Included | https://foundation.mozilla.org/privacynotincluded | Annual | Privacy ratings per app |

### Health & product safety (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| OpenFDA | https://open.fda.gov | Weekly | Food/drug/device recalls |
| CDC FoodNet | https://www.cdc.gov/foodnet | Monthly | Multistate foodborne outbreaks |
| HHS OIG | https://oig.hhs.gov | Monthly | Healthcare fraud + LEIE exclusions |

### Executive pay (2)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| AFL-CIO Executive Paywatch | https://aflcio.org/paywatch | Annual | CEO-to-worker pay ratios |
| SEC Executive Comp Proxy | https://www.sec.gov | Annual | Proxy disclosures |

### News & global press (3)

| Source | URL | Cadence | Notes |
|---|---|---|---|
| Google News RSS | https://news.google.com | Daily | US news per brand |
| AllSides Media Bias | https://www.allsides.com/media-bias | Quarterly | Bias ratings for outlets |
| GDELT Project | https://www.gdeltproject.org | Weekly | Global multilingual press |

---

## 📋 Planned (54) — added in waves below

### Tier 1: Federal regulators with public APIs (15)

| # | Source | URL | Category | Status |
|---|---|---|---|---|
| 1 | FSIS Recalls (meat/poultry) | https://www.fsis.usda.gov/recalls | Health & product safety | Planned |
| 2 | PHMSA Pipeline Incidents | https://www.phmsa.dot.gov/incident-reporting | Environmental | Planned |
| 3 | MSHA Mine Incidents | https://www.msha.gov/data-reports | Labor practices | Planned |
| 4 | FAA Service Difficulty Reports | https://av-info.faa.gov | Health & product safety | Planned |
| 5 | FRA Railroad Incidents | https://railroads.dot.gov/data | Health & product safety | Planned |
| 6 | NTSB Accident Reports | https://www.ntsb.gov/safety | Health & product safety | Planned |
| 7 | FCC Consumer Complaints | https://www.fcc.gov/consumer-help-center-data | Consumer protection | Planned |
| 8 | OCC Bank Enforcement | https://occ.gov/topics/laws-and-regulations | Federal enforcement | Planned |
| 9 | FDIC Enforcement Decisions | https://orders.fdic.gov | Federal enforcement | Planned |
| 10 | FINRA Disciplinary Actions | https://brokercheck.finra.org | Federal enforcement | Planned |
| 11 | NRC Event Reports | https://www.nrc.gov/reading-rm | Environmental | Planned |
| 12 | FERC Enforcement Actions | https://www.ferc.gov/enforcement | Federal enforcement | Planned |
| 13 | Treasury OFAC SDN List | https://ofac.treasury.gov/sanctions-list-service | Federal enforcement | Planned |
| 14 | DOL Wage & Hour Division | https://enforcedata.dol.gov | Labor practices | Planned |
| 15 | DOL OFCCP Audits | https://www.dol.gov/agencies/ofccp | Labor practices | Planned |

### Tier 2: HTML scrapes — federal (8)

| # | Source | URL | Category | Status |
|---|---|---|---|---|
| 16 | DOJ FCPA Cases | https://www.justice.gov/criminal/fcpa | Federal enforcement | Planned |
| 17 | PCAOB Enforcement | https://pcaobus.org/oversight/enforcement | Federal enforcement | Planned |
| 18 | Federal Reserve Enforcement | https://www.federalreserve.gov/supervisionreg/enforcementactions.htm | Federal enforcement | Planned |
| 19 | CFTC Enforcement | https://www.cftc.gov/PressRoom/Releases | Federal enforcement | Planned |
| 20 | HUD Fair Housing complaints | https://www.hud.gov/program_offices/fair_housing_equal_opp | Federal enforcement | Planned |
| 21 | ATF Firearm Industry Compliance | https://www.atf.gov | Labor practices | Planned |
| 22 | DEA Diversion Control | https://www.deadiversion.usdoj.gov | Health & product safety | Planned |
| 23 | USDA Animal Care violations | https://www.aphis.usda.gov/aphis/ourfocus/animalwelfare | Animal testing | Planned |

### Tier 3: Industry certifications — annual lists (12)

| # | Source | URL | Category | Status |
|---|---|---|---|---|
| 24 | Fair Trade USA Certified | https://www.fairtradecertified.org | Supply chain & human rights | Planned |
| 25 | Rainforest Alliance Certified | https://www.rainforest-alliance.org | Supply chain & human rights | Planned |
| 26 | Marine Stewardship Council | https://www.msc.org | Environmental | Planned |
| 27 | Forest Stewardship Council | https://fsc.org | Environmental | Planned |
| 28 | Cradle to Cradle Certified | https://www.c2ccertified.org | Environmental | Planned |
| 29 | Climate Neutral Certified | https://www.climateneutral.org | Environmental | Planned |
| 30 | GoodWeave | https://goodweave.org | Supply chain & human rights | Planned |
| 31 | UN Global Compact participants | https://www.unglobalcompact.org/participation | Sustainability | Planned |
| 32 | JUST 100 (Forbes/JUST Capital) | https://justcapital.com | Sustainability ranking | Planned |
| 33 | Ethisphere Most Ethical Companies | https://ethisphere.com/wme | Sustainability ranking | Planned |
| 34 | Newsweek's Most Responsible Companies | https://www.newsweek.com/rankings/americas-most-responsible-companies | Sustainability ranking | Planned |
| 35 | Climate Action 100+ | https://www.climateaction100.org | Environmental | Planned |

### Tier 4: Tech security (4)

| # | Source | URL | Category | Status |
|---|---|---|---|---|
| 36 | NIST NVD (full CVE DB) | https://nvd.nist.gov | Data privacy & security | Planned |
| 37 | OSV (Open Source Vulnerabilities) | https://osv.dev | Data privacy & security | Planned |
| 38 | GitHub Security Advisories | https://github.com/advisories | Data privacy & security | Planned |
| 39 | CERT Vulnerability Notes (Carnegie Mellon) | https://kb.cert.org/vuls | Data privacy & security | Planned |

### Tier 5: Legal / accountability (5)

| # | Source | URL | Category | Status |
|---|---|---|---|---|
| 40 | Stanford Securities Class Action Clearinghouse | https://securities.stanford.edu | Federal enforcement | Planned |
| 41 | GAO Reports | https://www.gao.gov/reports-testimonies | Federal enforcement | Planned |
| 42 | Inspector General Reports (Oversight.gov) | https://www.oversight.gov | Federal enforcement | Planned |
| 43 | MuckRock FOIA Database | https://www.muckrock.com | Federal enforcement | Planned |
| 44 | DOJ Antitrust Filings & Briefs | https://www.justice.gov/atr/case-document | Federal enforcement | Planned |

### Tier 6: International (6)

| # | Source | URL | Category | Status |
|---|---|---|---|---|
| 45 | EU Commission antitrust decisions | https://ec.europa.eu/competition/antitrust | Federal enforcement | Planned |
| 46 | EU sanctions list | https://www.sanctionsmap.eu | Federal enforcement | Planned |
| 47 | UK Modern Slavery Act registry | https://modern-slavery-statement-registry.service.gov.uk | Supply chain & human rights | Planned |
| 48 | UK Gender Pay Gap Service | https://gender-pay-gap.service.gov.uk | DEI | Planned |
| 49 | Canadian Competition Bureau | https://www.canada.ca/en/competition-bureau | Federal enforcement | Planned |
| 50 | Australian ACCC | https://www.accc.gov.au | Federal enforcement | Planned |

### Tier 7: ESG / data aggregators (4)

| # | Source | URL | Category | Status |
|---|---|---|---|---|
| 51 | As You Sow | https://www.asyousow.org | Political/Environmental | Planned |
| 52 | CPA-Zicklin Index | https://politicalaccountability.net/cpa-zicklin-index | Political donations | Planned |
| 53 | KnowTheChain | https://knowthechain.org | Supply chain & human rights | Planned |
| 54 | WikiRate | https://wikirate.org | ESG aggregator | Planned |

### Tier 8 (skipped per user request): California state agencies (2)

| # | Source | Why skipped |
|---|---|---|
| — | California Prop 65 warnings | Per-product chemical exposure (different granularity) |
| — | California CARB enforcement | State-level air quality (overlap with EPA) |

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
| GitHub Actions | Free 2000 min/mo | Cron jobs (~30% utilization) |
| Apple Developer | $99/yr | App Store membership |

### Future paid items (in BACKLOG as blocked)

| Item | Cost | Status |
|---|---|---|
| Apify Indeed scraper | $10/mo | X-3 — needs LLC + token |
| MailerLite paid plan | $9-39/mo | X-4 — triggers at >1k subscribers |
| RevenueCat + Apple IAP | Free <$2.5k MRR | X-2 — needs LLC |

---

## How this document is maintained

- This doc is updated when sources are added/removed.
- The `SOURCES_DATA` array in `src/App.jsx` is the live runtime mirror; keep them in sync.
- The marketing landing's source-count claim is computed from this list.
- Per-source cadences feed into the user-facing "About freshness" panel in the Sources tab.
