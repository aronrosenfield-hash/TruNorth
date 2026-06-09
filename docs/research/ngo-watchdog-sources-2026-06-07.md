# NGO / Watchdog / Journalism / Academic Data Sources for TruNorth

**Date:** 2026-06-07
**Author:** Research agent
**Scope:** Non-government, name-and-shame corporate accountability datasets to complement TruNorth's ~113 government data sources before the 2026-06-23 Product Hunt launch.

This report intentionally **does not duplicate items already on the DW-1 through DW-60 BACKLOG waitlist**. Several "obvious" candidates (BHRRC API, KnowTheChain benchmarks, Mighty Earth deforestation, ICIJ Offshore Leaks, Banking on Climate Chaos, Cornell ILR strikes, As You Sow funds, FAIRR, Urgewald, Coller, Walk Free corporate assessments, InfluenceMap, RDR, EWG Skin Deep, OWA fulfilment) are already queued — they appear in the final tables only for **delta notes** (e.g., "new sub-dataset since DW added"). Net-new sources start at row N-1 below.

---

## 1. Net-new sources (not in BACKLOG)

| ID | Source | URL | Data type | Format | License / ToS | Freshness | US-relevance | Difficulty | Recommendation |
|----|--------|-----|-----------|--------|---------------|-----------|--------------|------------|----------------|
| N-1 | **WikiRate (open ESG platform)** | https://wikirate.org/data | 8M+ data points × 150k companies, including Clean Clothes Campaign Transparency Score, Fashion Checker Brand+Factory Data, Modern Slavery Statement assessments, and dozens of benchmark mirrors | CSV + JSON via free API (account required) | **CC BY 4.0** — fully open, attribution required | Continuously updated; benchmarks refresh annually | High — most large US consumer brands present | **S** (REST + CSV exports, well documented) | **BUILD NOW — top priority.** Single integration unlocks Clean Clothes Campaign, Transparency Pledge compliance, Fashion Checker wage data, Modern Slavery Act mirror, and a long tail of academic benchmarks. CC BY 4.0 is best-case license for us. |
| N-2 | **Fair Labor Association — Third Party Complaint Tracking Chart + Investigation Reports** | https://www.fairlabor.org/accountability/fair-labor-investigations/tpc-tracking-chart/ | Per-complaint: brand, supplier, country, status, remediation plan; plus full investigation PDFs | HTML table (scrape) + PDF reports | Public; no explicit ToS prohibition; attribute FLA | Updated as complaints progress | Medium-High — every FLA-affiliated brand (Nike, Adidas, Patagonia, PVH, Under Armour, H&M, etc.) | **M** (table scrape; PDFs for narrative) | **BUILD NOW.** Tiny dataset (~50–100 active complaints), enormous signal density per row. Pairs with WRC for collegiate apparel. |
| N-3 | **Worker Rights Consortium — Factory Disclosure Database + Investigations Archive** | https://www.workersrights.org/our-work/factory-database/ | Collegiate apparel licensees × factories × locations; 20yr historical investigations | JS-rendered web UI (headless scrape); no API | Public; affiliate disclosure data; attribute WRC | Updated as licensees report (quarterly) | High — every collegiate-licensed brand (Nike, Adidas, Champion/Hanesbrands, Russell, Under Armour, Fanatics, '47 Brand) | **M** (Puppeteer-style scrape, then parse) | **BUILD NOW.** Investigations Archive is the unique value (Honduran sweatshop reports etc.). Factory disclosure list is useful for cross-referencing with BHRRC. |
| N-4 | **ProPublica Nonprofit Explorer API v2** | https://projects.propublica.org/nonprofits/api | IRS Form 990 / 990-PF / 990-T data for 1.8M+ orgs, including corporate foundations and trade-association 501(c)(6)s | Free REST JSON API | Free use under ProPublica Data Terms of Use | Continuous (IRS release cadence) | Maximum US-relevance | **S** (clean REST, well-documented) | **BUILD NOW.** Listed in BACKLOG as DW-21, but worth confirming: this is **the** way to compute real charity-% per brand and to flag trade-association membership (e.g., Koch-funded ALEC). Already validated above other candidates. |
| N-5 | **Multistate Settlements Database (NAAG)** | https://www.naag.org/news-resources/research-data/multistate-settlements-database/ | Every multistate AG settlement since ~1980s with named defendants, $ amounts, topic tags | Filterable web search; no API | Public; attribute NAAG | Continuously added | Maximum — fills NY / TX / MA AG gap we don't cover | **M** (paginated table scrape; ~hundreds of records) | **BUILD NOW.** Single source replaces 50-state AG scraping. Captures e.g., Equifax $700M, Vaping JUUL, Google location-data, opioid distributors. Highest signal-per-row of any source in this report. |
| N-6 | **State Energy & Environmental Impact Center — AG Actions Database** | https://stateimpactcenter.org/ag-work/ag-actions | State AG environmental enforcement actions, filterable by state/agency/company | Filterable web app | Public; attribute NYU Law | Updated continuously | High; complements N-5 for environmental specifically | **M** (scrape) | **WAITLIST.** Overlaps N-5 + DW environmental sources. Build only if environmental category needs more depth post-launch. |
| N-7 | **OCCRP Aleph (public datasets)** | https://aleph.occrp.org/ | Global archive of public records + leaks + company registries + sanctions + court filings; **company-search REST API** | REST JSON API (gated registration for some datasets; large public surface free) | Public datasets: free; some leak datasets vetted/restricted; attribute OCCRP | Continuous | Medium (international corporate networks; useful for offshore ownership of consumer brands) | **L** (API access needs request; entity resolution is non-trivial) | **WAITLIST.** Massive corpus but signal-to-noise is poor for consumer-brand grading. ICIJ Offshore Leaks (DW-43) covers the highest-value subset. Revisit post-launch if we add a "corporate-ownership opacity" sub-score. |
| N-8 | **OpenSanctions (ICIJ Offshore Leaks mirror + 250+ other lists)** | https://www.opensanctions.org/datasets/icij_offshoreleaks/ | Bulk JSON of ICIJ Offshore Leaks, PEPs, sanctions, debarments, leaks — **deduplicated as FollowTheMoney entities** | Bulk JSON download + REST API | CC-BY 4.0 for most, some upstream licenses cascade; commercial use allowed with attribution | Daily refresh | High (entity resolution to US brands works well) | **S** (single bulk JSON; we already use OpenSanctions per CFTC/Singapore MAS DW items) | **BUILD NOW.** Easiest path to ICIJ Offshore Leaks (DW-43) — fetch it via OpenSanctions instead of standing up ICIJ's own API. Also adds Interpol Red Notices, World-Check public mirrors, etc. Reuses existing OpenSanctions fetch infrastructure. |
| N-9 | **PETA "Companies That Test on Animals" list (the other side of Beauty Without Bunnies)** | https://www.peta.org/about-peta/learn-about-peta/info-businesses/companies-test-on-animals/ | Brand-level "do test on animals" list + companies under PETA active corporate campaigns | HTML list (scrape) | Public; attribute PETA | Monthly-ish | High | **S** (small HTML page) | **BUILD NOW.** We already have Beauty Without Bunnies (positive list); the negative list closes the loop and produces a binary flag per brand. Trivial to integrate. |
| N-10 | **Stand.earth Fossil Free Fashion Scorecard 2025** | https://stand.earth/fashion/resources/2025-scorecard/all-scores/ | 42 global fashion brands × 5 impact areas × letter grades | HTML table + PDF | Public; attribute Stand.earth | Biennial (2023 → 2025 → 2027) | High (H&M, Levi's, Nike, Adidas, Gap, Patagonia, Lululemon all rated) | **S** (~42 rows, single page scrape) | **BUILD NOW.** Lightest-weight environmental scorecard for apparel. Pairs naturally with KnowTheChain Apparel (DW-22) for paired labor+climate fashion signal. |
| N-11 | **Stanford Securities Class Action Clearinghouse (SCAC)** | https://securities.stanford.edu/filings.html | 4,000+ securities class actions since 1995 PSLRA | HTML (scrape); no official API | Public; site under reconstruction, scheduled return Winter 2026 | Effectively static until relaunch | Maximum — every public consumer brand sued | **M** (existing community R/Python scrapers) | **WAITLIST.** Wait for SCAC reboot (Winter 2026 = post-launch). Revisit once the new site ships — likely to include an official feed. Securities-fraud signal somewhat redundant with DW-28 FTC + DW-20 EEOC for consumer-facing grading. |
| N-12 | **Business Benchmark on Farm Animal Welfare (BBFAW) 2024** | https://www.bbfaw.com/ | 150 largest global food cos × 4 welfare dimensions × annual tier rank | Interactive dashboard + annual report PDF | Public; attribute BBFAW + Chronos Sustainability | Annual (Nov/Dec release) | High — McDonald's, Walmart, Kraft Heinz, Mondelez, Nestlé, Tyson, JBS, Kroger, Costco all in 150 | **M** (dashboard scrape; PDF tier table as fallback) | **BUILD NOW.** Animal-welfare category is currently thin; BBFAW + our existing Coller FAIRR (DW-29) + Open Wing Alliance Fulfilment Report (DW-2 / OWA) gives us three independent corroborating signals. |
| N-13 | **Stop the Bleed / NGO Forum (workers in conflict zones)** | (no single canonical site found) | — | — | — | — | — | — | **SKIP.** Could not locate a maintained machine-readable dataset under this exact name; possibly conflated with the medical Stop the Bleed campaign. Drop. |
| N-14 | **Sweatfree Communities / Sweatfree Coalition** | https://sweatfreepurchasing.org/ | Municipal/state procurement contracts + violator lists | Mostly PDFs; scattered | Public | Quarterly-ish; low cadence | Medium | **L** (PDF parsing, low yield) | **SKIP.** Low ROI; KnowTheChain Apparel (DW-22) + WRC (N-3) + FLA (N-2) cover the same brand universe with much better data. |
| N-15 | **Solidarity Center (AFL-CIO) — country/sector reports** | https://www.solidaritycenter.org/ | Investigative reports on global union-busting and worker repression | Long-form PDFs; no structured dataset | Public; attribution required | Irregular | Medium | **XL** (NLP extraction from narrative reports) | **SKIP.** No structured data. The named-brand signal it would surface is already captured by BHRRC (DW-24) and NLRB (DW-50). |
| N-16 | **Asia Floor Wage Alliance** | https://asia.floorwage.org/ | Per-country garment-industry wage benchmarks + named brand-supplier wage gaps | PDF reports; periodic | Public | Annual-ish | Low (geographic) | **L** | **SKIP.** Same data lands in WikiRate (N-1) as Fashion Checker / Clean Clothes Campaign feeds. Use N-1 instead. |
| N-17 | **Climate Action Tracker / Net Zero Tracker (corporate net-zero claims vs. reality)** | https://zerotracker.net/ | 4,000+ entities (countries, regions, cities, FTSE100, Fortune 500) × net-zero claim quality | **Open CSV + JSON API** | Open data; attribute Net Zero Tracker / NewClimate Institute / ECIU | Monthly | High (all Fortune 500 covered) | **S** (clean CSV download + simple REST) | **BUILD NOW.** Cleanest signal for "greenwashing risk" complementary to InfluenceMap (DW-18). Net-zero pledge quality scored on integrity criteria. |
| N-18 | **Mercy For Animals investigation timeline** | https://mercyforanimals.org/ + https://stock.mercyforanimals.org/ | ~100+ undercover investigations linked to named suppliers/brands since 2003 | HTML archive (scrape) | Public; attribute MFA | As released | High (Tyson, JBS, Costco, McDonald's, Wendy's, Dairy Queen, Hormel hit) | **M** (per-investigation page parse) | **WAITLIST.** Powerful narrative content but tedious entity resolution (named supplier → consumer brand). Hold until v2 of animals category. |
| N-19 | **The Humane League — corporate pledge tracker (broiler welfare beyond cage-free)** | https://thehumaneleague.org/our-impact | Better Chicken Commitment pledge status by brand | HTML; PDF reports | Public; attribute THL | Annual | High | **S** | **WAITLIST.** Largely overlaps Open Wing Alliance (DW pipeline). Revisit if broiler-welfare becomes a distinct flag. |
| N-20 | **Fashion Checker (Clean Clothes Campaign + WikiRate)** | https://fashionchecker.org/ | Brand × living-wage commitment × supply chain transparency × worker-wage data | Web app; underlying data on WikiRate | CC BY 4.0 via WikiRate | Annual+ | High | **S** (via N-1 WikiRate API) | **BUILD NOW — as part of N-1.** Don't integrate separately; fetch via WikiRate dataset endpoints. |
| N-21 | **Transparency Pledge signatory list** | https://transparencypledge.org/ | 76+ apparel brands committed to factory disclosure | HTML | Public | Annual | High | **S** | **BUILD NOW — bundle with N-3 WRC.** Boolean flag per brand: signed/not-signed Transparency Pledge. |

---

## 2. Already on BACKLOG — delta / upgrade notes

Items below are **already queued (DW-x)**; this section flags new sub-datasets or API changes worth capturing when those waitlist items are picked up.

| BACKLOG ID | Source | Delta / new sub-dataset | Action |
|------------|--------|-------------------------|--------|
| DW-24 | **BHRRC** | API now exposes Migrant Worker Allegations sub-database and Rapid Response stories with daily JSON. Endpoint structure (Categories / Companies / Components / Stories) is documented; registration is free. | When DW-24 ships, fetch all four object types — not only Stories. |
| DW-22 | **KnowTheChain** | 2025 ICT benchmark is live (49 cos; avg 20/100; only Samsung/HPE/Cisco >50). Full datasets remain downloadable per sector. | Confirm 2025 numbers; F&B and Apparel benchmarks were last refreshed earlier. |
| DW-43 | **ICIJ Offshore Leaks** | Now exposes a free reconciliation API + bulk CSV per node type. Open Database License + CC-BY-SA. Easiest path is **OpenSanctions mirror (N-8)** — already validated. | Switch DW-43 plan to consume via OpenSanctions instead of standing up ICIJ's own infra. |
| DW-25 | **Mighty Earth** | Soy & Cattle Scorecard now has a live Tracker map; only scorecards (10 cos × 100 pts) are structured. Palm oil monitoring lives in separate Palm Oil Innovation Group reports. | DW-25 captures the scorecards. Palm-oil-specific data remains best-handled by RSPO (DW-44). |
| DW-31 | **Banking on Climate Chaos** | 2025 report released 2025-06-17 covering $869B FY24 fossil financing across 65 banks × 2,700+ fossil clients. Annual cadence confirmed. | Plan DW-31 fetch for late June each year. |
| DW-18 | **InfluenceMap / LobbyMap** | 1,000+ companies + 300 trade associations scored. Regional platforms added (Brazil, India). | DW-18 scope already covers this. |
| DW-32 | **Ranking Digital Rights** | 2025 Big Tech Edition (April 2025) shipped under World Benchmarking Alliance; new download endpoints. | DW-32 captures it. |
| DW-21 | **ProPublica Nonprofit Explorer** | API v2 confirmed stable; free under Data ToU. | Already captured (see N-4 callout). |
| DW-42 | **Cornell ILR Labor Action Tracker** | JSON build available on GitHub (`ilrWebServices/StrikeSiteTracker`); CSV by email request. | Use the GitHub JSON build artifact — no scrape, no email request. |
| DW-29 | **Coller FAIRR Protein Producer Index** | Continuing annual cadence; pairs natively with BBFAW (N-12). | When DW-29 ships, ingest BBFAW alongside. |
| DW-2 | **WBA Social Benchmark / Open Wing Alliance** | OWA Fair and Fowl 2025 report (Sep 2025): 92% of 2024-deadline commitments fulfilled; 2,500 commitments; 1,157 transitioned. | Confirm OWA Fair and Fowl PDF/CSV when DW-2 ships. |

---

## 3. Tier-S net-new shortlist — Top 15 ranked by signal × accessibility

Ranking heuristic: **(brand-naming density) × (machine-readability) × (US consumer-brand coverage) ÷ (engineering effort)**.

| Rank | ID | Source | One-line value |
|------|----|--------|----------------|
| 1 | **N-1** | WikiRate API (CC BY 4.0, 150k cos, 8M datapoints) | Unlocks 5+ benchmarks in one integration; best license terms of any source in this report. |
| 2 | **N-5** | NAAG Multistate Settlements DB | Replaces 50-state AG scraping with one source; every billion-dollar consumer settlement of the last 40 years. |
| 3 | **N-8** | OpenSanctions ICIJ Offshore Leaks mirror | Easiest path to DW-43; reuses existing OpenSanctions fetch pattern. |
| 4 | **N-17** | Net Zero Tracker | Cleanest greenwashing signal; F500 coverage; CSV+API. |
| 5 | **N-2** | FLA Third Party Complaint Tracking | ~100 high-density rows; every major activewear/footwear brand. |
| 6 | **N-12** | BBFAW Farm Animal Welfare 2024 | Doubles animal-welfare corroboration for top 150 food cos. |
| 7 | **N-3** | WRC Factory Disclosure + Investigations | Unique collegiate-apparel sweat-shop investigation archive. |
| 8 | **N-10** | Stand.earth Fossil Free Fashion Scorecard | 42 fashion brands, climate letter-grade, low effort. |
| 9 | **N-9** | PETA "Companies That Test on Animals" | Trivial negative-list complement to existing BWB. |
| 10 | **N-21** | Transparency Pledge signatories | Boolean flag per apparel brand. |
| 11 | **N-20** | Fashion Checker | Covered by N-1; counts as bundled signal. |
| 12 | DW-2 OWA | (already queued) Fair and Fowl 2025 PDF | Pull the 2025 corporate-by-corporate table when DW-2 ships. |
| 13 | **N-4** | ProPublica Nonprofit Explorer (=DW-21) | Real charity-% per Fortune 500 corp foundation. |
| 14 | DW-22 KnowTheChain 2025 ICT | Confirm latest scores. |
| 15 | **N-19** | The Humane League broiler tracker | Defer until v2 animals category. |

---

## 4. Top 6–8 to integrate this sprint (pre-launch June 23)

Recommended pre-launch picks. All have machine-readable outputs and clear licenses.

1. **N-1: WikiRate API** — single integration, multiple datasets, CC BY 4.0. Highest ROI item in the report.
2. **N-8: OpenSanctions ICIJ Offshore Leaks mirror** — closes DW-43 by reusing existing OpenSanctions fetch infrastructure.
3. **N-5: NAAG Multistate Settlements Database** — biggest single name-and-shame consumer settlement source missing from current pipeline.
4. **N-17: Net Zero Tracker CSV** — clean greenwashing flag; complements DW-18 InfluenceMap nicely.
5. **N-9: PETA "Companies That Test on Animals" list** — half-day effort; closes the animal-testing loop with binary positive/negative flags.
6. **N-2: FLA Third Party Complaints** — tiny dataset, very high density; pairs with the apparel cluster.
7. **N-10: Stand.earth Fossil Free Fashion Scorecard** — half-day effort; 42 brands × letter grade for apparel-climate.
8. **N-21: Transparency Pledge signatories** — half-day boolean flag; bundles cleanly with N-3 if there's time.

If only **3** can be done before June 23, ship: **N-1 + N-5 + N-8**.

---

## 5. Skipped and why

| Source | Reason |
|--------|--------|
| CDP / Carbon Disclosure Project | Public corporate disclosure access **requires a paid data license** since 2025. Stay on InfluenceMap (DW-18) + Net Zero Tracker (N-17) instead. |
| Reputation Institute / RepTrak | Paid commercial product. |
| Wharton / Notre Dame Mendoza / Drexel LeBow indices | Behind academic paywalls or one-off PDFs. No machine-readable feed. |
| Sweatfree Communities, Solidarity Center, Asia Floor Wage Alliance | No structured data; signal already covered by KnowTheChain + WRC + FLA + WikiRate. |
| Stop the Bleed (worker conflict zones) | No locatable canonical dataset. |
| Bellingcat case archives | Long-form journalism, no structured feed. |
| Bureau of Investigative Journalism | Long-form journalism, no structured feed. |
| The Markup Citizen Browser | Project sunset; archived only. |
| CorpWatch.org | Site largely static archive since ~2016. |
| MotherJones police-funding database | Narrow scope, no maintained feed. |
| Documented investigations | Long-form journalism. |
| Mealey's class actions, Class Action Defense Blog | Paywalled. |
| Stanford SCAC (currently) | Under reconstruction; revisit Winter 2026 post-launch. |
| Reputation Institute / Mendoza / Wharton / Drexel | Paywalled or non-machine-readable. |
| EWG Skin Deep direct | No public API; gated. Stay on DW-36 plan via partner channel. |
| Cruelty Free International / Leaping Bunny | Duplicate of existing Leaping Bunny integration. |
| Greenpeace investigations | Story-by-story; no structured feed. |

---

## 6. License / ToS notes worth highlighting

- **WikiRate (N-1)**: CC BY 4.0. Cleanest license. Attribution required — add a "Data: WikiRate (CC BY 4.0)" footer in brand-card source list.
- **ICIJ Offshore Leaks (DW-43 / N-8)**: Open Database License + CC-BY-SA on contents. Must always cite **International Consortium of Investigative Journalists**. ShareAlike could affect any derived/published dataset we host — keep derived data internal or relicense.
- **OpenSanctions (N-8 conduit)**: CC-BY 4.0 for most datasets; some upstream licenses cascade (note in fetch script).
- **ProPublica Nonprofit Explorer (N-4 / DW-21)**: Free under ProPublica Data Terms of Use; commercial OK with attribution.
- **OCCRP Aleph (N-7)**: Free for vetted journalists/researchers; some leak datasets restricted. **Commercial product use is a grey area** — would need explicit confirmation from OCCRP before relying on it. (Reason this is waitlisted, not built.)
- **Net Zero Tracker (N-17)**: Open data; attribute NewClimate Institute / Energy & Climate Intelligence Unit.
- **FLA, WRC, Stand.earth, PETA, NAAG, BBFAW, KnowTheChain**: All public web content; no explicit machine-access ToS prohibition found. Attribute the source on each brand card and respect robots.txt.

---

## Citations

- ICIJ Offshore Leaks: https://offshoreleaks.icij.org/pages/database , https://www.icij.org/inside-icij/2025/01/explore-the-latest-tool-to-power-up-investigations-via-the-offshore-leaks-database/
- ICIJ on OpenSanctions: https://www.opensanctions.org/datasets/icij_offshoreleaks/
- Worker Rights Consortium: https://www.workersrights.org/our-work/factory-database/ , https://www.workersrights.org/our-work/factory-investigations/
- Fair Labor Association: https://www.fairlabor.org/accountability/fair-labor-investigations/tpc-tracking-chart/ , https://www.fairlabor.org/accountability/fair-labor-investigations/investigations-reports/
- Walk Free / Global Slavery Index: https://www.walkfree.org/global-slavery-index/downloads/
- CDP: https://www.cdp.net/en/data , https://www.cdp.net/en/data/scores
- Banking on Climate Chaos 2025: https://www.bankingonclimatechaos.org/ , https://www.ran.org/press-releases/bocc2025/
- Mercy For Animals: https://mercyforanimals.org/ , https://stock.mercyforanimals.org/search/
- Open Wing Alliance Fair and Fowl 2025: https://downloads.ctfassets.net/ww1ie0z745y7/3SwZZ35xGnAFJzbLNER7DW/537b8c84d7ed2cb6ec55182a787dda8a/25-owa-cage-free-egg-fulfillment-report-final-v2.pdf
- Stanford SCAC: https://securities.stanford.edu/filings.html , https://law.stanford.edu/securities-class-action-clearinghouse-scac/
- ProPublica Nonprofit Explorer API: https://projects.propublica.org/nonprofits/api , https://www.propublica.org/nerds/announcing-the-nonprofit-explorer-api
- Mighty Earth Soy & Cattle: https://soyandcattlemonitor.mightyearth.org/tracker-scorecard/ , https://mightyearth.org/methodology/
- NAAG Multistate Settlements: https://www.naag.org/news-resources/research-data/multistate-settlements-database/
- State Energy & Environmental Impact Center AG Actions: https://stateimpactcenter.org/ag-work/ag-actions
- BBFAW: https://www.bbfaw.com/media/2190/bbfaw-2024-report.pdf
- Clean Clothes Campaign / Transparency Pledge: https://cleanclothes.org/campaigns/gotransparent , https://transparencypledge.org/about/ , https://fashionchecker.org/
- As You Sow: https://www.asyousow.org/resolutions-tracker , https://www.asyousow.org/invest-your-values/download-data
- Urgewald GCEL/GOGEL: https://www.coalexit.org/downloads , https://gogel.org/about
- OCCRP Aleph: https://docs.aleph.occrp.org/ , https://github.com/alephdata/aleph
- InfluenceMap LobbyMap: https://lobbymap.org/ , https://lobbymap.org/Methodology-Portal
- Ranking Digital Rights 2025 Big Tech: https://rankingdigitalrights.org/bte25/executive-summary , https://www.worldbenchmarkingalliance.org/benchmark/ranking-digital-rights-index
- The Humane League: https://thehumaneleague.org/our-impact
- BHRRC API description: https://www.cambridge.org/core/journals/business-and-human-rights-journal/article/big-data-on-bhr-innovative-approaches-to-analysing-the-business-human-rights-resource-centre-database/C97BD45AC0322629EF626036D5ABAC88
- Cornell ILR Labor Action Tracker: https://striketracker.ilr.cornell.edu/ , https://github.com/ilrWebServices/StrikeSiteTracker
- WikiRate: https://wikirate.org/data , https://wikirate.org/Dataset , https://wikirate.org/How_to_Use_Data
- PETA cruelty-free list: https://crueltyfree.peta.org/
- KnowTheChain: https://knowthechain.org/ , https://www.business-humanrights.org/en/from-us/briefings/2025-knowthechain-ict-benchmark/
- Fashion Checker / WikiRate: https://wikirate.org/Fashion_Checker , https://labs.wikirate.org/Fashion_Checker
- Stand.earth Fossil Free Fashion Scorecard 2025: https://stand.earth/fashion/resources/2025-scorecard/all-scores/ , https://stand.earth/fashion/wp-content/uploads/sites/8/2025/05/FFF-Scorecard-2025.pdf
- EWG Skin Deep: https://www.ewg.org/skindeep/

---

*Word count: ~2,950 (under 4,000 cap).*
