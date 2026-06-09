# International Public-Records Data Sources for TruNorth

**Research date:** 2026-06-07
**Author:** Claude (research agent)
**Purpose:** Expand TruNorth's ~113 sources beyond US-centric coverage so multinational brands (Nestlé, Unilever, AB InBev, Toyota, Samsung, LVMH, Volkswagen, etc.) and APAC/EU/LatAm regulatory signal show up at parity with US public-record sources.

**Scope notes:**
- IDs continue the existing `DW-` waitlist (BACKLOG.md DW-1 … DW-60). New IDs start at **DW-61**.
- Anything already on the waitlist (DW-15 UK ICO, DW-16 Singapore MAS, DW-17 Canada Competition, DW-22 KnowTheChain, DW-23 CHRB, DW-25 Mighty Earth, DW-30 ACCC+ASIC, DW-31 Banking on Climate Chaos, DW-43 ICIJ Offshore Leaks, DW-44 RSPO, DW-46 Bonsucro, DW-49 DOL TVPRA, DW-52 BaFin, DW-53 FCA UK, DW-54 KFTC, DW-55 India SEBI, DW-56 South Africa) is **excluded** from new candidates below but flagged where relevant.
- Difficulty: **S** = <1 day, clean API/CSV; **M** = 1-3 days, parse/clean work; **L** = 4+ days, scrape + entity resolution; **XL** = impractical (skip).
- Recommendation: **build now** = candidate for next sprint; **waitlist** = add to DW backlog; **skip** = explained.

---

## 1. European Union

| ID | Source | Type | URL | Freq | Access | ToS | US-brand relevance | Diff | Rec |
|---|---|---|---|---|---|---|---|---|---|
| DW-61 | **EUR-Lex / CURIA — ECJ + General Court rulings** | Antitrust + competition rulings, case texts | https://curia.europa.eu/jcms/jcms/Jo2_7045/ ; https://eur-lex.europa.eu/homepage.html | Daily | REST API (EUR-Lex SPARQL + Cellar) + JSON metadata | Open Data Decision 2011/833/EU — full reuse allowed with attribution | High — every $1B+ EU antitrust ruling (Google, Apple, Meta, Microsoft, Intel, Qualcomm, Amazon) lives here | M | **build now** |
| DW-62 | **European Banking Authority (EBA) — public register of administrative sanctions** | Bank/IF sanctions across all EU states | https://www.eba.europa.eu/risk-and-data-analysis/risk-analysis/breaches-and-sanctions | Quarterly | XLSX/CSV downloads, no API | Open re-use, EBA standard | Medium — JPM, Citi, Goldman EU subsidiaries appear | M | waitlist |
| DW-63 | **European Medicines Agency (EMA) — referrals + recalls + safety signals** | Pharma referrals, EPARs, safety notifications | https://www.ema.europa.eu/en/medicines ; https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/pharmacovigilance-post-authorisation/referral-procedures | Continuous | REST JSON + RSS feed (per-medicine) | EMA reuse policy — open | High — covers Pfizer/Merck/AbbVie/Novartis/Sanofi EU actions | M | **build now** |
| DW-64 | **ECHA REACH + CLP database** | Chemical hazard registrations, restricted substances | https://echa.europa.eu/information-on-chemicals/registered-substances ; https://echa.europa.eu/scip-database | Daily | Public REST + bulk XML; SCIP DB has API | Open data policy 2019 | Medium — manufacturers (3M, Dow, BASF) but also consumer brands flagged for SVHCs in products | L | waitlist |
| DW-65 | **EU Transparency Register (lobbying)** | EU-level lobbying disclosures (LD-2 analog) | https://transparency-register.europa.eu/ ; bulk JSON at /api/v1 | Daily | Public JSON API (well-documented) | Open, attribution requested | High — every multinational with Brussels lobbying (Big Tech, pharma, auto, food) is here | S | **build now** |
| DW-66 | **EU CORDIS — Horizon research grants** | Research funding to corporations (incl. greenwashing claims) | https://cordis.europa.eu/ ; CORDIS Open Data | Monthly | CSV + JSON bulk | CC-BY 4.0 | Low-Medium — niche signal for "Pfizer got €X EU research grant" angle | M | skip (low priority vs other EU items) |
| DW-67 | **EU OLAF Press Releases (fraud investigations naming companies)** | Anti-fraud office cases | https://anti-fraud.ec.europa.eu/media-corner/news_en | Weekly | RSS + HTML | Open | Medium — overlaps with existing EU OLAF source we already have; check current coverage | S | skip (likely duplicate of existing EU OLAF) |
| — | EU AMLA | Anti-money-laundering authority | — | — | — | — | — | — | **skip — not yet operational (begins 2026)** |
| — | EU CBAM filings | Carbon border tax filings | — | — | — | — | — | — | **skip — registry not yet public; first filings due 2026** |

**EU summary:** ECJ rulings (DW-61), EMA pharma (DW-63), and EU Transparency Register lobbying (DW-65) are the three highest-ROI EU additions. EBA (DW-62) and ECHA (DW-64) waitlist for after launch.

---

## 2. Asia-Pacific

| ID | Source | Type | URL | Freq | Access | ToS | US-brand relevance | Diff | Rec |
|---|---|---|---|---|---|---|---|---|---|
| DW-68 | **Japan SESC — disciplinary recommendations** | Securities/markets misconduct | https://www.fsa.go.jp/sesc/english/ ; https://www.fsa.go.jp/sesc/reco/index.htm | Monthly | HTML + PDF (no API) | Government work, open reuse | Medium — Nomura, SoftBank, MUFG, but US-listed Japanese ADRs caught here | L | waitlist |
| DW-69 | **Japan MHLW — Industrial Safety violations ("公表案件")** | Workplace safety violations | https://www.mhlw.go.jp/bunya/roudoukijun/anzeneisei11/01.html | Quarterly | HTML, Japanese only | Open, govt | Low — mostly domestic firms but Toyota/Honda/Sony plants appear | L | skip (Japanese-only HTML scrape, low US coverage) |
| DW-70 | **South Korea KFTC — already DW-54** | — | — | — | — | — | — | — | already on waitlist |
| DW-71 | **South Korea FSS — enforcement actions** | Banking/securities enforcement | https://english.fss.or.kr/ ; https://www.fss.or.kr/ | Quarterly | HTML, partial English | Open, govt | Low-Medium — Samsung, LG, SK financial arms | L | waitlist |
| DW-72 | **Australia ACCC + ASIC — already DW-30** | — | — | — | — | — | — | — | already on waitlist |
| DW-73 | **Australia Fair Work Ombudsman — Litigation tracker** | Wage theft, labor violations w/ employer named | https://www.fairwork.gov.au/about-us/our-role-and-purpose/our-priorities/our-campaigns/court-cases | Continuous | HTML scrape (per-case page) | Open, govt | Medium — covers Subway, McDonald's, 7-Eleven, Coles AU operations | M | **build now** |
| DW-74 | **NZ Commerce Commission — enforcement decisions** | Cartel, deceptive conduct, fair-trading | https://comcom.govt.nz/case-register | Monthly | HTML + structured case register | Open, govt | Low — mostly NZ-domestic; some Apple/Mastercard cases | M | skip (small market, low ROI) |
| DW-75 | **India SEBI — already DW-55** | — | — | — | — | — | — | — | already on waitlist |
| DW-76 | **India NCLT/NCLAT orders** | Company-law tribunal orders, insolvency, oppression | https://nclt.gov.in/ ; https://nclat.gov.in/ | Continuous | PDF dumps, no JSON | Open, govt | Low — Indian conglomerates (Tata, Reliance) but few US-consumer brands | L | skip (PDF-only, India-domestic skew) |
| — | China NMPA recalls | Drug regulator | https://www.nmpa.gov.cn/ | — | Mostly Chinese, geofenced, anti-scrape | — | — | XL | **skip — geofenced + Chinese-only + anti-scraping; flagged as risk by TruNorth's own RU/CN block policy (BACKLOG B-35)** |
| DW-77 | **Singapore MAS — already DW-16** | — | — | — | — | — | — | — | already on waitlist |
| DW-78 | **Hong Kong SFC — enforcement news** | HK securities enforcement | https://www.sfc.hk/en/News-and-announcements/Enforcement-news | Weekly | RSS + HTML | Open, govt | Medium — JPM, Goldman, Citi HK arms, plus China-listed brands | M | waitlist |

**APAC summary:** **Australia Fair Work Ombudsman (DW-73)** is the only high-ROI build-now APAC candidate — clean labor-violation signal naming employers, includes US multinational AU operations. Japan/Korea English-language access is poor; defer.

---

## 3. Latin America

| ID | Source | Type | URL | Freq | Access | ToS | US-brand relevance | Diff | Rec |
|---|---|---|---|---|---|---|---|---|---|
| DW-79 | **Brazil CADE — antitrust decisions** | Cartel, merger, abuse-of-dominance rulings | https://www.gov.br/cade/pt-br ; https://sei.cade.gov.br/ | Weekly | HTML + structured PDF, Portuguese | LAI (Brazilian FOIA) — open | Medium — AB InBev, Unilever, Cargill, Bunge LatAm operations + cartel cases | L | waitlist |
| DW-80 | **Brazil CVM — sanctions register** | Securities sanctions | https://www.gov.br/cvm/pt-br/assuntos/sancionadores | Monthly | CSV + HTML | Open, govt | Low — mostly Brazilian-domestic | M | skip |
| DW-81 | **Brazil "Lista Suja" — Ministério do Trabalho dirty list (slave labor)** | Employers caught using forced/slave labor | https://www.gov.br/trabalho-e-emprego/pt-br ; published by SmartLab/InPACTO mirror | Semi-annual | CSV/PDF (govt) + clean CSV via SmartLab mirror (https://smartlabbr.org/trabalhoescravo/) | Open data | **HIGH** — supply-chain integrity flag. JBS, Cosan, M. Dias Branco have appeared. Critical for "ethically sourced" claims. | M | **build now** |
| DW-82 | **Mexico COFECE — antitrust resolutions** | Competition rulings | https://www.cofece.mx/resoluciones/ | Monthly | HTML + PDF, Spanish | Open, govt | Low-Medium — Walmart de México, Coca-Cola FEMSA, AB InBev (Modelo) | L | waitlist |
| DW-83 | **Mexico CNBV — sanctions** | Financial enforcement | https://www.gob.mx/cnbv/acciones-y-programas/sanciones | Monthly | HTML, Spanish | Open, govt | Low | L | skip |
| DW-84 | **Chile FNE — competition decisions** | Antitrust | https://www.fne.gob.cl/ | Quarterly | HTML + structured cases | Open, govt | Low | L | skip |
| DW-85 | **Argentina CNV — sanctions** | Securities | https://www.argentina.gob.ar/cnv | Quarterly | HTML/PDF Spanish | Open, govt | Very low | L | skip |

**LatAm summary:** Only **Brazil Lista Suja (DW-81)** is a build-now candidate — uniquely valuable forced-labor signal with consumer-brand attribution, and overlaps DW-49 (DOL TVPRA) for cross-validation. Skip the rest pre-launch (Spanish/Portuguese HTML scrapes with low US-brand density don't pencil out).

---

## 4. Middle East / Africa

| ID | Source | Type | URL | Freq | Access | ToS | US-brand relevance | Diff | Rec |
|---|---|---|---|---|---|---|---|---|---|
| — | **South Africa Competition Commission — already DW-56** | — | — | — | — | — | — | — | already on waitlist |
| DW-86 | **UAE Securities and Commodities Authority (SCA) sanctions** | Securities enforcement | https://www.sca.gov.ae/en/regulations/violations--decisions.aspx | Monthly | HTML | Open | Very low — UAE-domestic | L | skip |
| DW-87 | **Saudi CMA — enforcement decisions** | Securities | https://cma.org.sa/en/Market/News/Pages/CMA_N_3719.aspx | Monthly | HTML, English available | Open | Very low — Saudi-domestic | L | skip |

**MENA summary:** Saudi Aramco listed entities aside, MENA regulators have near-zero overlap with US consumer brands. Skip all except SA Competition (already waitlisted).

---

## 5. Cross-border watchdogs

| ID | Source | Type | URL | Freq | Access | ToS | US-brand relevance | Diff | Rec |
|---|---|---|---|---|---|---|---|---|---|
| DW-88 | **Tax Justice Network — Financial Secrecy Index + Corporate Tax Haven Index** | Country-level secrecy/tax-haven scores | https://taxjustice.net/topics/financial-secrecy-index/ ; https://cthi.taxjustice.net/ | Biennial | CSV + JSON downloads | CC-BY | Medium — country-level only; useful as a "manufactured/HQ'd in tax haven" company-level overlay using HQ country | S | waitlist (low freshness) |
| DW-89 | **OECD National Contact Points — Multinational Enterprise Guidelines complaints** | Specific instances filed against MNEs (mediation cases) | https://mneguidelines.oecd.org/database/ | Quarterly | HTML database + downloadable cases | Open OECD data | **HIGH** — every major MNE labor/environment complaint outside US courts ends up here. Apple, Shell, Nike, Glencore, Volkswagen | M | **build now** |
| DW-90 | **UN Working Group on Business and Human Rights — communications database** | Allegations sent to companies by UN special procedures | https://spcommreports.ohchr.org/ | Continuous | Searchable HTML; per-communication PDF | Open, UN | **HIGH** — companies named in UN special-rapporteur letters (Meta, Glencore, Chevron, ExxonMobil, etc.). Extremely high-credibility signal. | M | **build now** |
| — | **ICIJ Offshore Leaks — already DW-43** | — | — | — | — | — | — | — | already on waitlist |
| DW-91 | **OpenSanctions — consolidated international PEP+sanctions+enforcement graph** | 220+ source datasets including most APAC/EU regulators above | https://www.opensanctions.org/ ; https://api.opensanctions.org/ | Daily | **Excellent JSON REST API + bulk dumps**, FollowTheMoney schema | CC-BY 4.0 for non-commercial; **commercial use requires paid license** (~€500-2k/yr) | **VERY HIGH** — single integration replaces ~30 separate scrapers for EU/APAC/MENA enforcement registers | S (technically) but licensing review needed | **waitlist (eval license cost before build)** |
| DW-92 | **OFAC + UN + EU + UK consolidated sanctions (via OpenSanctions or direct EU FSF)** | Sanctions lists merged | https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions | Daily | XML/CSV/JSON | Open | High — overlap with existing OFAC SDN (DW-7) but adds EU/UN-specific entities | S | waitlist (de-dupe risk w/ DW-7) |
| DW-93 | **GRAIN Land Grabs database** | Documented land-grabbing deals (corporate land acquisition in global south) | https://grain.org/landgrabsdataset | Annual | CSV download | CC-BY-SA | Medium — Cargill, Bunge, ADM, Olam — strong supply-chain ethics signal | S | waitlist |
| — | Transparency International CPI | Country corruption perceptions | https://www.transparency.org/en/cpi | Annual | CSV | CC-BY-ND | Country-level only; same shape as DW-88. Useful as overlay, not standalone | S | waitlist (low marginal value) |

**Cross-border summary:** **OECD NCP (DW-89)** and **UN Business & Human Rights communications (DW-90)** are the two highest-credibility additions in this entire research pass — neither duplicates anything in the existing 113 sources, and both name multinationals US consumers buy from. **OpenSanctions (DW-91)** is the single highest-leverage technical bet but needs a licensing review before commitment.

---

## TOP 15 — ranked by US-consumer relevance × ease × freshness

Scoring rubric: each axis 1-5, total /15. Ties broken by data-freshness (daily > weekly > monthly > annual).

| Rank | ID | Source | US-rel | Ease | Fresh | Score | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **DW-65** | EU Transparency Register (lobbying) | 5 | 5 | 5 | 15 | **Sprint** |
| 2 | **DW-89** | OECD National Contact Points (MNE complaints) | 5 | 4 | 4 | 13 | **Sprint** |
| 3 | **DW-61** | EUR-Lex/CURIA (EU court rulings) | 5 | 3 | 5 | 13 | **Sprint** |
| 4 | **DW-90** | UN B&HR communications database | 5 | 3 | 5 | 13 | **Sprint** |
| 5 | **DW-63** | EMA (EU pharma referrals/recalls) | 4 | 4 | 5 | 13 | **Sprint** |
| 6 | **DW-81** | Brazil Lista Suja (slave-labor list) | 4 | 4 | 3 | 11 | **Sprint** |
| 7 | **DW-73** | Australia Fair Work Ombudsman litigation | 4 | 3 | 4 | 11 | **Sprint** |
| 8 | **DW-91** | OpenSanctions consolidated graph | 5 | 5 | 5 | 15* | **Eval license, then sprint** |
| 9 | **DW-92** | EU consolidated sanctions list | 4 | 5 | 5 | 14 | Waitlist (dedupe risk) |
| 10 | **DW-62** | EBA banking sanctions register | 3 | 3 | 3 | 9 | Waitlist |
| 11 | **DW-64** | ECHA REACH chemicals | 4 | 2 | 5 | 11 | Waitlist |
| 12 | **DW-78** | HK SFC enforcement | 3 | 3 | 4 | 10 | Waitlist |
| 13 | **DW-93** | GRAIN land grabs | 3 | 4 | 2 | 9 | Waitlist |
| 14 | **DW-79** | Brazil CADE antitrust | 3 | 2 | 4 | 9 | Waitlist |
| 15 | **DW-88** | Tax Justice Index (overlay) | 3 | 5 | 1 | 9 | Waitlist |

*DW-91 license review required before build.

---

## Proposed next-sprint integration list (7 sources)

In recommended build order — chosen to maximize coverage gain × engineering velocity. Total estimated effort: **8-12 days of agent compute**, similar shape to the DW-1 through DW-17 batch already shipped.

| Order | ID | Why this one, why this order |
|---|---|---|
| 1 | **DW-65 EU Transparency Register** | Clean JSON API, daily refresh, instantly upgrades lobbying signal beyond US LD-2/FARA. Fastest win. (S) |
| 2 | **DW-89 OECD National Contact Points** | Highest-credibility human-rights/labor signal for non-US operations of every MNE. Pairs with existing OECD Watch data we have. (M) |
| 3 | **DW-90 UN B&HR communications** | Companion to DW-89; UN-letter level signal. Same engineering shape (HTML + per-case PDF parse). Build alongside DW-89 to share entity-resolution code. (M) |
| 4 | **DW-63 EMA pharma referrals** | RSS-driven, near-real-time. Closes the EU pharma recall gap (OpenFDA only covers US). High-criticality category. (M) |
| 5 | **DW-61 EUR-Lex/CURIA EU court rulings** | Highest-prestige antitrust signal globally. SPARQL is fiddly but worth it for Google/Apple/Meta/Microsoft EU cases. (M) |
| 6 | **DW-81 Brazil Lista Suja** | Unique forced-labor signal not in any existing source. Small CSV, big trust-signal payoff. Pairs nicely with DW-49 DOL TVPRA already on waitlist. (M) |
| 7 | **DW-73 Australia Fair Work Ombudsman** | Closes APAC labor gap for US multinational AU subsidiaries. HTML scrape but well-structured case register. (M) |

**Sprint outcome estimate:** 7 new sources → coverage shift from ~95% US / 5% intl to roughly ~85% US / 15% intl on the surface-area we care about (lobbying, antitrust, human-rights, pharma, forced labor, labor enforcement). Adds an estimated **2,000-4,000 new data points** across 4 categories (Political, Human Rights, Labor, Health/Animals).

**Explicitly deferred to a later sprint:**
- DW-91 OpenSanctions — license review needed (potential €500-2k/yr cost) but if approved, replaces ~10 of the items on the existing DW waitlist; should be evaluated **before** building any individual APAC/EU enforcement scraper that's already in OpenSanctions.
- All Tier-skip items above (China NMPA, Mexico/Chile/Argentina securities regs, Japan MHLW, India NCLT, UAE/Saudi) — not worth English-translation + low-density-scrape investment pre-launch.

---

## Risks + ToS notes summary

| Concern | Sources affected | Mitigation |
|---|---|---|
| Non-English HTML/PDF parsing | DW-79 (BR-PT), DW-82 (MX-ES), DW-68 (JP) | Skipped or waitlisted. Brazil Lista Suja kept because SmartLab provides clean CSV mirror. |
| Geofenced / anti-scrape | China NMPA | Skipped. TruNorth already blocks CN traffic at edge (BACKLOG B-35); reciprocating their access blocks is consistent. |
| Commercial licensing required | DW-91 OpenSanctions | Flagged for eval. CC-BY is fine for non-commercial; TruNorth has a paid tier so the commercial license needs a $-impact decision. |
| Government open-data attribution | All EU + Aus + Brazil + UN sources | All require attribution. Add to existing TruNorth Sources tab attribution list. |
| Per-case PDF parsing | DW-89, DW-90, DW-79 | Use existing Sonnet extraction harness (proven on DOJ press releases). |
| Brand-name canonicalization across languages | All international sources | Reuse `slug-aliases.json` + `brand-parent-map.json` infrastructure shipped in B-22. Add international subsidiaries (Coca-Cola FEMSA, Walmart de México, Nestlé Brasil, Toyota Europe) as new alias entries. |

---

## Appendix — what's NOT recommended and why (one-line per item)

- **China NMPA** — geofenced + Chinese-only + anti-scraping; skip.
- **EU AMLA, CBAM filings** — not yet operational; revisit Q4 2026.
- **EU CORDIS grants** — low signal-to-noise for consumer brand-grading.
- **EU OLAF press releases** — likely duplicates an OLAF source TruNorth already has; verify before re-building.
- **Japan MHLW + NZ Commerce + India NCLT + UAE SCA + Saudi CMA + Mexico CNBV + Chile FNE + Argentina CNV** — low US-consumer-brand density and high scraping cost; skip.
- **Country-level indices (CPI, Tax Justice CTHI, Financial Secrecy)** — useful as overlay on HQ country only, not as company-level signal. Waitlist for a v2 "country-of-HQ overlay" feature.

---

**End of report.** 7 new build-now candidates (DW-61, DW-63, DW-65, DW-73, DW-81, DW-89, DW-90), 1 strategic eval (DW-91 OpenSanctions), 9 waitlist adds. Ready to slot into BACKLOG.md DW section as DW-61 through DW-93.
