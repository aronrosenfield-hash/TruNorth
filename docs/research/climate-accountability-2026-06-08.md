# Climate Accountability Data Sources for TruNorth

**Date:** 2026-06-08
**Author:** Research agent
**Scope:** Climate-accountability datasets to extend TruNorth's climate scoring before the 2026-06-23 launch, with deep focus on Climate TRACE. Builds on the prior NGO/Watchdog (2026-06-07), Product Registries (2026-06-07), and International Data Sources (2026-06-07) reports. Does not duplicate items already integrated (EPA TRI, GHGRP, ECHO, SBTi, CA100+, Forest 500, industry carbon-intensity fallback) or paywalled (CDP).

---

## 1. Climate TRACE — deep dive

### 1.1 What it is

Climate TRACE is the open-emissions database backed by Al Gore and a 100+ member coalition (WattTime, RMI, TransitionZero, Carbon Plan, Earthrise Media, OceanMind, etc.). It uses satellites, remote sensing, and AI to *estimate* (not self-report) greenhouse-gas emissions for every meaningful emitter on Earth. The November 2024 v4 release expanded coverage from ~80,000 assets to **352 million individual emission sources** — a 4,400× jump made possible by treating every road segment, ship voyage, building, and oil-and-gas well as its own asset. The May 2026 release (v5.7.0) extends monthly emissions through March 2026.

Source: [climate-trace-unveils-open-emissions-database-of-more-than](https://climatetrace.org/news/climate-trace-unveils-open-emissions-database-of-more-than)

### 1.2 Data shape

Two parallel grain levels:

| Grain | Scope | Time | Files |
|-------|-------|------|-------|
| **Country-level** | Sub-sector × gas × country | Annual 2015–2024 + projected 2025 | `country_emissions_*.csv` |
| **Asset (source) level** | Individual facility/road/ship/etc. | **Monthly** 2021–March 2026 | `asset_<subsector>_emissions.csv` and `asset_<subsector>_emissions_sources_ownership.csv` |

Ten top-level sectors → **~37 subsectors** → ~7 million distinct asset rows in the bulk CSVs (the 352 M figure includes vehicle-segment and ship-voyage micro-assets that are only published on request).

**Asset CSV schema** (per the official "Beyond the UI: What's in the Asset Metadata" guide):

- `source_id` (stable Climate TRACE internal ID, defined by unique combination of facility name + country + source type + subsector)
- `source_name`, `source_type`
- `iso3_country`, `lat`, `lon`
- `start_time`, `end_time`, `temporal_granularity` (`monthly` or `annual`)
- `gas` (`co2`, `ch4`, `n2o`, `co2e_100yr`, `co2e_20yr`)
- `emissions_quantity` (metric tons)
- `activity`, `activity_units` (e.g., MWh generated, barrels produced)
- `capacity`, `capacity_factor`, `capacity_units`
- `emissions_factor`, `emissions_factor_units`
- `inventory_added`, `inventory_updated`

Source: [Beyond the UI: What's in the Asset Metadata](https://climatetrace.org/news/beyond-the-ui-what039s-in-the-asset-metadata)

### 1.3 Ownership / parent-company linkage — the killer feature for TruNorth

Ownership is shipped as a **separate file per subsector**: `asset_<subsector>_emissions_sources_ownership.csv`. Schema:

- `source_id` (join back to emissions CSV)
- `asset_name`, `country`, `sector`, `subsector`
- `owner_name` (column C in the docs example)
- `owner_classification`
- `ownership_percentage` (column E; threshold ≥5 %, includes minority stakes)
- `owner_direct_parent` (immediate operator/owner)
- `owner_grouping` (the **ultimate parent**; "the list of companies that have greater than 50 % interest in the asset")
- `recency` (year the ownership record applies to)

Climate TRACE explicitly distinguishes **immediate owner** (often the operator joint venture) from **ultimate owner** (the holding company / publicly listed parent). The dashboard shows only the immediate owner; the CSV reveals the full chain. Worked example from the official tutorial: the Troll oil field shows only "Petoro" in the UI but the ownership CSV lists Petoro 56 % + Equinor + Shell + TotalEnergies + ConocoPhillips as minority partners. ([how-to-parse-asset-ownership-in-climate-trace-data](https://climatetrace.org/news/how-to-parse-asset-ownership-in-climate-trace-data))

**Coverage**: ~26,000 assets carry ownership data, mapping to **~14,000 unique ultimate owners**, accounting for **32 % of global emissions with full hierarchies + 14 % more with immediate-owner only**, across **18 emissions-intensive subsectors** (power, oil and gas, refining, steel, cement, aluminum, etc.). For deeper graph analysis, a nodes-and-edges format is available on request. ([understanding-and-using-climate-trace-ownership-data](https://climatetrace.org/news/understanding-and-using-climate-trace-ownership-data-for-emitting-assets))

### 1.4 Access methods

1. **Bulk download (recommended for TruNorth)** — at [climatetrace.org/data](https://climatetrace.org/data). Two slicing options: by country (one ZIP with every sector for that ISO3) or by sector (one ZIP per top-level sector, all countries). Files are subsector-level CSVs. The community downloader [liamlaverty/climate-trace-data-downloader](https://github.com/liamlaverty/climate-trace-data-downloader) notes "at least 2 TB of free space" to mirror everything — but the **US-only + 18 ownership-bearing subsectors** subset is realistically **5–15 GB** uncompressed.
2. **Beta REST API v6** at `https://api.dev.c10e.org/` — supports search by sector, owner, location; query emissions and asset detail; aggregate by country. Climate TRACE warns it's beta and asks users to "keep volume low and use cautiously in production." Best for live queries on user-requested brands, not for bulk loads.
3. **Google Earth Engine mirror** — `projects/sat-io/open-datasets/CLIMATE-TRACE/EMISSIONS/` as FeatureCollections. ([gee-community-catalog.org/projects/climate_trace](https://gee-community-catalog.org/projects/climate_trace/)) Useful for geospatial joins but overkill for TruNorth.
4. **Open Net Zero mirror** — Icebreaker One re-publishes the dataset as ClimateTRACE API v4. Stable but a version behind.

### 1.5 Refresh cadence

Monthly. May 2026 release (v5.7.0) shipped data through March 2026 → ~6-week lag from observation to publication. Annual major version bumps (v4 Nov 2024 → v5 mid-2025 → v6 expected Nov 2026). For TruNorth's nightly/weekly/monthly tiered cron, the right home is the **monthly** lane.

### 1.6 License

**Creative Commons Attribution 4.0 International (CC BY 4.0)**, explicitly with **commercial use permitted**: "free to copy, modify and distribute Climate TRACE data in any format for any purpose, including commercial use." Caveat: a handful of upstream feeds (EDGAR, FAOSTAT, EPA) carry their own terms. Attribution requirement is "attribute it to Climate TRACE and indicate if you have made any changes" — meets our existing source-card pattern. ([climatetrace.org/terms](https://climatetrace.org/terms))

This is the best-case license for TruNorth's Pro tier: redistributable inside a paid app with a one-line credit.

### 1.7 Facility → corporate-parent mapping plan for TruNorth

Recommended pipeline (mirrors how DW-31 BoCC + DW-1 Forest 500 are wired):

1. **Filter to US-relevant subsectors first** — power (electricity-generation), oil-and-gas-production-and-transport, oil-refining, steel, cement, aluminum, petrochemicals, coal-mining, pulp-and-paper. These are the 9 of 18 ownership-bearing subsectors with the densest US presence.
2. **Load `asset_<subsector>_emissions_sources_ownership.csv` for each**, filter `country = USA` plus any USA-headquartered ultimate parent regardless of asset location. The `owner_grouping` column is the join key.
3. **Normalize `owner_grouping` to TruNorth brand IDs** using our existing brand→parent alias table (the same one Forest 500 and SBTi use). Estimate: of ~14,000 unique ultimate owners globally, **~1,200–1,800 are US-listed or US-headquartered**; of those, **~400–600 already appear in our 11,000-brand catalog** as either the parent or a major sub-brand. The remaining ~600–1,200 are oil-and-gas / utility / heavy-industry parents not yet on our consumer-brand list — many of which we *do* want to grade (Chevron, Marathon, NRG, Vistra, Nucor, Cleveland-Cliffs, etc.).
4. **Aggregate** annual `co2e_100yr` per `owner_grouping`, summing `(emissions_quantity × ownership_percentage)` to apportion JV emissions. Cache the latest 3 calendar years.
5. **Score**: compare per-parent total tCO2e against sector medians (we already have the sector-intensity scaffolding from PR #15). Brands in the top quartile of their sector lose climate points; brands well below median gain them. Climate TRACE replaces the industry-fallback for any parent we can confidently match.

**Estimated coverage gain**: of the ~3,200 distinct corporate parents currently scored under our "climate" pillar, we expect Climate TRACE to upgrade **600–900** from sector-average fallback to facility-attributed real numbers — a meaningful jump in defensibility on the Brand Detail card.

### 1.8 Sample queries

CSV path pattern after unzip:

```
data_packages/climate_trace/sector_packages/power/electricity-generation/
  asset_electricity-generation_emissions.csv
  asset_electricity-generation_emissions_sources_ownership.csv
  country_electricity-generation_emissions.csv
```

Minimal join in DuckDB / pandas:

```sql
SELECT o.owner_grouping AS parent,
       SUM(e.emissions_quantity * o.ownership_percentage / 100) AS tco2e_share
FROM emissions e
JOIN ownership o USING (source_id)
WHERE e.gas = 'co2e_100yr'
  AND e.iso3_country = 'USA'
  AND EXTRACT(year FROM e.start_time) = 2024
GROUP BY parent
ORDER BY tco2e_share DESC;
```

### 1.9 Risks / open questions

- **Beta API**: don't depend on the REST endpoint for nightly jobs; use bulk CSVs.
- **Asset name fuzziness**: facility names are not always brand-friendly ("AG der Dillinger Hüttenwerke") — entity resolution against our brand catalog needs the alias layer, not raw strings.
- **Ownership recency**: the `recency` field is per-row; older rows can be stale. Always filter to most recent year per `source_id`.
- **Apportionment**: JV minority stakes mean a single facility shows up under 5 parents. Decide whether to use 100 % ownership (simpler, double-counts JVs) or equity-weighted (truer, more code). Equity-weighted is the industry standard; recommended.

---

## 2. Secondary climate-accountability sources

| ID | Source | URL | Data type | Format | License / ToS | Freshness | US relevance | Difficulty | Recommendation |
|----|--------|-----|-----------|--------|---------------|-----------|--------------|------------|----------------|
| C-1 | **Net Zero Tracker** | [zerotracker.net](https://zerotracker.net/) | 4,190 entities incl. 1,277 of largest 1,987 public cos × pledge quality (target year, type, interim, plan, Scope 3, credits) | Download Data button (CSV); also mirrored on KAPSARC | Open data; attribute Net Zero Tracker / NewClimate Institute / ECIU / Oxford Smith / Data-Driven EnviroLab | Quarterly+ | Maximum — every F500 covered | **S** | **BUILD NOW.** Best greenwashing-vs-real-pledge signal we don't have. Pairs with SBTi (which only certifies the *good* pledges); NZT scores quality across the whole population. |
| C-2 | **Carbon Majors (InfluenceMap × CAI / Heede)** | [carbonmajors.org/Downloads](https://carbonmajors.org/Downloads) | 122 oil/gas/coal/cement producers × historical emissions back to 1854; 3 granularity tiers (incl. flaring/venting/methane) | CSV | **Non-commercial only** per InfluenceMap T&Cs | Annual (Nov); latest Jan 2026 covers RY2024; Oct 2025 added LEIs | High — Exxon, Chevron, Peabody, ConocoPhillips, Occidental | **S** | **SKIP** (commercial-use prohibited; would conflict with Pro tier). Re-derive equivalent via Climate TRACE + GHGRP for the same 122 entities. |
| C-3 | **Banking on Climate Chaos 2025 (RAN / Sierra Club / Urgewald et al.)** | [bankingonclimatechaos.org](https://www.bankingonclimatechaos.org/) | 65 banks × 2,700+ fossil clients × $869 B financing FY24 | Online dashboard + methodology PDF; no public CSV/API found — request via shawna@ran.org | Public report; attribution required; commercial reuse undefined — confirm before launch | Annual (June) | Max for finance vertical (JPM, BofA, Citi, Wells, MS, GS top 6) | **M** (dashboard scrape until CSV is offered) | **BUILD NOW** for bank-finance grading. Already DW-31 on BACKLOG; this entry reconfirms June 2025 release shipped. |
| C-4 | **InfluenceMap / LobbyMap** | [lobbymap.org](https://lobbymap.org/) | 1,000 cos + 330 industry associations × climate-policy engagement score | Login-gated web tables; no public API; weekly refresh | T&Cs require permission for redistribution; non-commercial framing | Weekly | High | **L** (auth + scrape) | **WAITLIST** — already DW-18. License caveat means we display the score, not redistribute the dataset. |
| C-5 | **Stand.earth Fossil-Free Fashion Scorecard 2025** | [stand.earth/fashion/resources/2025-scorecard](https://stand.earth/fashion/resources/2025-scorecard/all-scores/) | 42 brands × 5 climate impact areas × letter grade | HTML table + PDF | Public; attribute Stand.earth | Biennial (2023→2025→2027) | High (H&M, Nike, Adidas, Levi's, Patagonia, Lululemon, Gap) | **S** | **BUILD NOW** — already in N-10 from 2026-06-07 NGO report. Restated here as a climate-specific source. |
| C-6 | **Mighty Earth Soy & Cattle Tracker** | [mightyearth.org](https://www.mightyearth.org/) | Brazil cattle/soy deforestation scorecards (~10 cos × 100 pts) + live tracker map | HTML scorecards | Public; attribute Mighty Earth | Annual+ | Medium (impacts JBS, Cargill, Bunge, ADM customers) | **S** | **WAITLIST** — already DW-25. Confirmed scope. |
| C-7 | **Trase.earth open data** | [trase.earth/open-data](https://trase.earth/open-data) | Commodity supply-chain flows for soy, cattle, palm oil, cocoa, coffee, cotton, etc. across 10 countries, 13 commodities, 1997–2025; includes facility-level mills/slaughterhouses | CSV | **CC BY 4.0 for data on website; commercial use → contact info@trase.earth** | Continuous | Medium-High (US food-co supply chains traceable for soy/beef/palm) | **M** | **WAITLIST → contact first.** The "commercial use requires contact" caveat is the only thing blocking a Pro-tier integration. Email Trase, get written confirmation, then promote to Tier-S. |
| C-8 | **Global Forest Watch Data API** | [data-api.globalforestwatch.org](https://data-api.globalforestwatch.org/) | Real-time tree-cover-loss + GLAD/RADD deforestation alerts; geospatial only — no native corporate linkage | REST JSON + GeoJSON; bulk downloads | Free, open access; attribute WRI | Weekly (alerts) | High when joined to known corporate concessions | **M** (geospatial join to Forest 500 / Trase concessions) | **WAITLIST.** Powerful but requires Trase or Forest 500 concession polygons to attribute to brands. Useful as a v2 enhancement to climate scoring, not a v1 standalone. |
| C-9 | **Global Coal Exit List 2025 (Urgewald + 48 partners)** | [coalexit.org](https://coalexit.org/) | 1,500 parent cos + 1,400 subsidiaries × coal production, capacity, revenue share, expansion plans | Excel after free signup | Free for non-commercial; commercial use → contact Urgewald | Annual (Oct) | High (Peabody, Arch, Vistra, Duke, Southern, AEP, Berkshire Energy) | **S** | **WAITLIST → contact Urgewald.** Same license posture as Trase. Already covered indirectly by DW-7 on BACKLOG (general Urgewald). |
| C-10 | **WWF Palm Oil Buyers Scorecard 2024** | [palmoilscorecard.panda.org](https://palmoilscorecard.panda.org/) | ~200 manufacturers/retailers/food-service cos × commitment + action scores out of 24 | HTML filterable table + PDF | Public; attribute WWF | Biennial | High (Unilever, Nestlé, P&G, Mondelez, Mars, PepsiCo, Walmart, Costco, Target, Kroger, Ahold) | **S** | **BUILD NOW.** Tiny scrape, 200-row payload, exact brand-name keys → highest signal-per-engineer-hour of the C-series. |
| C-11 | **GRI Sustainability Disclosure Database** | [globalreporting.org](https://www.globalreporting.org/) | n/a — **discontinued April 2021** | n/a | n/a | n/a | n/a | n/a | **SKIP.** Replaced by no single successor. WikiRate (N-1) and individual company report scraping fill the gap. |
| C-12 | **TCFD signatories list** | n/a | TCFD wound into ISSB IFRS S2 in 2024 | — | — | — | — | — | **SKIP.** TCFD ceased standalone reporting Oct 2023; ISSB now custodian. Use Net Zero Tracker (C-1) plus SBTi for equivalent coverage. |
| C-13 | **Just Energy Transition / ClimateScore Global Innovation 1000** | various | Strategy& report; not a structured dataset; thematic essay | PDF | Closed | Irregular | Low | — | **SKIP.** Neither is a maintained corporate-rated dataset of the kind we ingest. |

---

## 3. Top 8 to integrate next sprint — ranked by impact per engineer-hour

Heuristic: (US brand-naming density) × (license openness) × (data freshness) ÷ (engineering effort).

| Rank | ID | Source | Why now | Est. eng-hours |
|------|----|--------|---------|----------------|
| 1 | **Climate TRACE** | facility emissions + ultimate-owner mapping for 14k parents | CC BY 4.0, commercial OK, biggest single climate dataset on Earth, replaces our industry-fallback for ~600–900 brands | 16–24 h (bulk CSV pipeline + alias resolver + apportionment) |
| 2 | **C-1 Net Zero Tracker** | pledge-quality across all F500 | Cleanest greenwashing flag; quarterly refresh; open data; one CSV | 3–5 h |
| 3 | **C-10 WWF Palm Oil Scorecard 2024** | 200 rows, named brands, biennial | Trivial scrape; tight brand-name keys; biennial cadence is forgiving | 2–3 h |
| 4 | **C-5 Stand.earth Fossil-Free Fashion 2025** | 42 brands, letter grades, climate-specific | Already on N-10; restate as climate signal | 2 h |
| 5 | **C-3 Banking on Climate Chaos 2025** | 65 banks × $869 B fossil financing | Top finance-vertical signal; dashboard scrape until CSV offered | 8–12 h (DW-31 already queued; refresh schedule confirmed late-June annual) |
| 6 | **C-7 Trase.earth** (pending license clarification) | soy/cattle/palm facility-to-buyer flows | Email Trase first; if commercial-OK, single CSV unlocks supply-chain deforestation grading | 1 h email + 6 h ingest |
| 7 | **C-9 GCEL 2025** (pending license) | 1,500 coal parents | Email Urgewald; if commercial-OK, replaces our coal-exposure heuristic | 1 h email + 4 h ingest |
| 8 | **C-8 Global Forest Watch alerts** | weekly deforestation alerts | Defer until C-7 Trase concession polygons are loaded; otherwise no corporate linkage | 12+ h (v2 work) |

---

## 4. License flag table

| Source | License | Commercial use in Pro tier? | Attribution |
|--------|---------|----------------------------|-------------|
| **Climate TRACE** | CC BY 4.0 | **YES** (explicit in terms) | "Climate TRACE" + note modifications |
| **Net Zero Tracker** | Open data (CC BY-style) | **YES** | NZT + NewClimate Institute + ECIU + Oxford Smith + Data-Driven EnviroLab |
| **WWF Palm Oil Scorecard** | Public report, public ToU | **YES** with credit | WWF |
| **Stand.earth Fossil-Free Fashion** | Public report | **YES** with credit | Stand.earth |
| **Banking on Climate Chaos** | Public report, commercial reuse undefined | **CONFIRM** (email shawna@ran.org) | RAN + Sierra Club + Urgewald + Indigenous Environmental Network + Oil Change Int'l + Reclaim Finance + BankTrack |
| **Trase.earth open data** | CC BY 4.0 non-commercial implied; commercial → contact | **CONFIRM** (email info@trase.earth) | Trase / SEI / Global Canopy |
| **Global Forest Watch** | Free, open access (WRI) | **YES** | WRI / GFW |
| **Global Coal Exit List** | Free non-commercial; commercial → contact | **CONFIRM** (email Urgewald) | Urgewald |
| **InfluenceMap / LobbyMap** | T&Cs require permission to redistribute | **NO** (display-only) | InfluenceMap (link, no redistribution) |
| **Carbon Majors** | Non-commercial only (InfluenceMap T&Cs) | **NO** | n/a — skip |
| **CDP** | Paywalled since 2025 | **NO** | already skipped |
| **GRI Sustainability Disclosure DB** | Discontinued April 2021 | n/a | n/a — skip |
| **TCFD** | Wound into ISSB 2024 | n/a | skip; use SBTi + C-1 |

**Three "license-CONFIRM" items** (BoCC, Trase, GCEL) are blockers for Pro tier. Recommended action: send three short emails this week, gate Pro-tier inclusion on written confirmation. If denied, all three still ship to the Free tier as "display-only" badges.

---

## 5. Recommendation summary

For the June 23 launch, Climate TRACE is the single highest-leverage addition to TruNorth's climate pillar. The CC BY 4.0 license with explicit commercial-use language clears the Pro-tier hurdle that CDP, Carbon Majors, and InfluenceMap fail. The ownership CSVs (`owner_grouping` field) provide the exact facility-to-public-parent mapping that replaces our PR #15 industry-intensity fallback for 600–900 named corporate parents. Combined with Net Zero Tracker (greenwashing-quality scoring) and WWF Palm Oil Scorecard (low-effort, high-brand-density), the three together can ship inside a single sprint and meaningfully upgrade the defensibility of the climate sub-score on every Brand Detail card.

The three license-pending sources (BoCC, Trase, GCEL) should be unblocked by short outreach emails in parallel — even one positive response materially expands Pro-tier coverage.

---

## Sources

- [Climate TRACE — Data Downloads](https://climatetrace.org/data)
- [Climate TRACE — Terms](https://climatetrace.org/terms)
- [Climate TRACE — Press release: 352M-asset open emissions database](https://climatetrace.org/news/climate-trace-unveils-open-emissions-database-of-more-than)
- [Climate TRACE — Understanding ownership data](https://climatetrace.org/news/understanding-and-using-climate-trace-ownership-data-for-emitting-assets)
- [Climate TRACE — How to parse asset ownership](https://climatetrace.org/news/how-to-parse-asset-ownership-in-climate-trace-data)
- [Climate TRACE — Beyond the UI: asset metadata schema](https://climatetrace.org/news/beyond-the-ui-what039s-in-the-asset-metadata)
- [Climate TRACE API v6 (beta)](https://api.dev.c10e.org/)
- [Climate TRACE — Sectors](https://climatetrace.org/sectors)
- [Climate TRACE on Open Net Zero](https://opennetzero.org/climate-trace)
- [Climate TRACE on Google Earth Engine](https://gee-community-catalog.org/projects/climate_trace/)
- [liamlaverty/climate-trace-data-downloader (GitHub)](https://github.com/liamlaverty/climate-trace-data-downloader)
- [Net Zero Tracker](https://zerotracker.net/)
- [Net Zero Stocktake 2025](https://zerotracker.net/analysis/net-zero-stocktake-2025)
- [Carbon Majors Downloads](https://carbonmajors.org/Downloads)
- [Banking on Climate Chaos 2025 (RAN press release)](https://www.ran.org/press-releases/bocc2025/)
- [Banking on Climate Chaos site](https://www.bankingonclimatechaos.org/)
- [Trase.earth Open Data](https://trase.earth/open-data)
- [Global Forest Watch Data API](https://data-api.globalforestwatch.org/)
- [Global Coal Exit List 2025](https://coalexit.org/)
- [Urgewald GCEL 2025 announcement](https://www.urgewald.org/en/medien/gcel2025-chemicals-captive-power)
- [WWF Palm Oil Buyers Scorecard](https://palmoilscorecard.panda.org/)
- [LobbyMap (InfluenceMap)](https://lobbymap.org/)
- [InfluenceMap Climate Lobbying](https://influencemap.org/climate-lobbying)
- [Stand.earth Fossil-Free Fashion 2025](https://stand.earth/fashion/resources/2025-scorecard/all-scores/)
- [Mighty Earth](https://www.mightyearth.org/)
- [GRI standards & disclosure DB](https://www.globalreporting.org/)
