# Product-Level Data Sources Research — 2026-06-07

**Goal:** Close TruNorth's *product-level* metadata gap. We have strong parent-company data (60+ sources), but when a user scans an Oreo barcode, our only product-level lookup is Open Food Facts (crowdsourced, incomplete). We need authoritative product registries that map a **specific GTIN/UPC** (or product class) to a parent company, a flag, or a certification.

**Scope:** Research-only. No code. Cap 4,000 words.

**Already in pipeline (skip):** Open Food Facts, USDA Organic Integrity (DW-5), USDA FSIS recalls (DW-6), Energy Star (DW-11), Cradle to Cradle (`c2c-fetch.mjs`), MSC (`msc-fetch.mjs`), Fair Trade USA (`fair-trade-fetch.mjs`), FSC (`fsc-fetch.mjs`), PETA Beauty Without Bunnies (`peta-bwb-fetch.mjs`), cruelty-free (`cruelty-free-merge.mjs`), Non-GMO Project (DW-38), EPEAT (DW-37), V-Label (DW-41), Climate Neutral (`climate-neutral-fetch.mjs`), Kosher (DW-40), CPSC product recalls (cron live), NHTSA recalls (cron live), OpenFDA (cron live). These are noted but not re-proposed.

---

## 1. Food product registries

| Source | URL | Coverage | Access | License | GTIN/UPC? | Freshness | US-relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|---|
| **USDA FoodData Central — Branded Foods** | `fdc.nal.usda.gov/download-datasets` | ~1.9M branded items × brand name, ingredients, nutrition, GTIN/UPC | Bulk JSON + API key (free, unlimited) | **Public domain** | **YES — gtinUpc field on every item** | Monthly drops | US-only | **S** | **TOP TIER — propose** |
| **USDA Plants Database** | `plants.usda.gov` | Plant taxonomy + native-status | Bulk CSV | Public domain | No | Quarterly | US | M | Skip — not consumer products |
| **Open Beauty Facts** | `world.openbeautyfacts.org/data` | ~250k cosmetics, partial brand-parent | Bulk JSON-L (Postgres dump) | **Open DB License (ODbL)** — commercial OK with attribution | **YES** | Daily | Global, US partial | S | **Propose** — same loader as OFF |
| **Open Products Facts** | `world.openproductsfacts.org/data` | ~50k generic products | Bulk CSV/JSON | ODbL | Yes | Daily | Mixed | S | Low value — small, noisy. Skip. |
| **Open Pet Food Facts** | `world.openpetfoodfacts.org/data` | ~25k pet products | Bulk CSV | ODbL | Yes | Daily | Mixed | S | Niche win — propose if pet shoppers in cohort |
| **EWG Food Scores** | `ewg.org/foodscores` | ~80k food products with health/nutrition/processing scores | Web scrape (HTML, no API) | **Proprietary — non-commercial only.** | UPC on detail pages | Quarterly-ish | US | **L** | **SKIP** (license-incompatible) |
| **GS1 US — GTIN-to-Brand Lookup** | `gs1us.org` | Authoritative brand owner per UPC prefix | Paid API; GS1 GTIN search public for 50/day | Restrictive | **YES — by design** | Continuous | Global | L+$ | **Future — F-tier** (paid only) |
| **UPC Item DB** | `upcitemdb.com/api` | ~600M UPCs with title + brand | API (free 100/day, paid above) | Commercial OK with paid plan | YES | Continuous | Global | M+$ | **Propose paid fallback** — ~$30/mo unlocks 100k lookups |
| **Barcode Lookup** | `barcodelookup.com` | 1B+ barcodes | Paid API | Commercial OK | YES | Continuous | Global | M+$ | F-tier alt to UPC Item DB |

### USDA FoodData Central — Branded Foods (deep dive)

This is the single biggest unlock for the scanner. Direct equivalent of OFF, but **federal, authoritative, US-focused, and includes the brand owner field as a structured attribute** (not user-edited text). 1.9M products with:

- `gtinUpc` — exact barcode match
- `brandOwner` — legal entity name (the parent slug we need)
- `brandName` — consumer brand
- `subBrand` — sub-line
- `ingredients` — full text (allergen flag derivation)
- `marketCountry` — US filter
- `brandedFoodCategory` — category for fallback scoring

Bulk download at `fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_2025-xx.zip` (~2 GB unzipped). License: **public-domain US-gov work**. Monthly updates.

**This alone fixes the Nabisco-scan gap.** `brandOwner` for Oreo reads "Mondelez Global LLC" → trivially maps to existing Mondelez slug via brand-parent-map.

---

## 2. Personal-care / cosmetics / cleaners

| Source | URL | Coverage | Access | License | GTIN? | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|
| **EWG Skin Deep** | `ewg.org/skindeep` | ~100k products × hazard score (1-10) per ingredient | HTML scrape; no API | **Proprietary, non-commercial only** | Yes (on detail page) | XL | **Already DW-36 — but license is a blocker.** See note below. |
| **EWG Cleaners Database** | `ewg.org/guides/cleaners` | ~3,000 cleaning products | HTML scrape | Non-commercial | Some | L | **Skip** — license |
| **EPA Safer Choice Product Finder** | `epa.gov/saferchoice/products` | ~2,400 certified products (cleaners, detergents) | HTML download (CSV available) | Public domain | Some | S | **Propose** |
| **CDC NIOSH Skin Notation Profiles** | `cdc.gov/niosh/topics/skin/skinnotations.html` | Ingredient-level skin hazard | HTML/PDF | Public domain | No | M | Future ingredient-flag enrichment |
| **FDA Cosmetic Ingredient Review (CIR)** | `cir-safety.org` | ~1,400 ingredient safety reviews | PDF reports | Public, redistribute-OK | No | L | Future ingredient enrichment |

**Re: EWG Skin Deep (DW-36):** The DW-36 backlog entry should be **downgraded or removed**. EWG's terms restrict reproduction and explicitly bar commercial reuse. We could *link out* to ewg.org per-product (no data redistribution), but we cannot import their scores into our JSON. Replace DW-36 with EPA Safer Choice + Skin Deep deep-link.

---

## 3. Allergen / additive / chemical watchlists

| Source | URL | Coverage | License | GTIN? | Difficulty | Recommend |
|---|---|---|---|---|---|---|
| **FDA Substances Added to Food (SAF)** | `cfsanappsexternal.fda.gov/scripts/fdcc/?set=FoodSubstances` | ~4,000 additives, GRAS status, banned substances | Public domain | No (ingredient-level) | S | **Propose** — flag ingredients in OFF/FDC ingredients text |
| **California Prop 65 List** | `oehha.ca.gov/proposition-65/proposition-65-list` | 900+ chemicals + listing date | CSV download | Public domain | No (ingredient) | S | **Propose** — high-trust flag |
| **EU E-Numbers (EFSA)** | `efsa.europa.eu/en/topics/topic/food-additives` | ~340 E-numbers + safety reviews | XLSX | CC-BY | No | S | Optional — useful for European brands |
| **FDA FALCPA major allergens** | Static list of 9 (milk, egg, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame) | n/a | Public | No | S | **Propose static lookup** — derive from FDC ingredients |
| **EWG Tap Water Database** | `ewg.org/tapwater` | 50k US utilities by ZIP | Non-commercial | n/a | L | Skip — license + not product-scope |
| **EFSA OpenFoodTox** | `efsa.europa.eu/en/data-report/chemical-hazards-data` | 7,000+ chemical hazard records | CC-BY | No | M | Niche; future |
| **NIH PubChem** | `pubchem.ncbi.nlm.nih.gov` | 119M compounds; tox data | Public domain | No | M | Skip for now — too broad |

---

## 4. Recall databases (product-level)

| Source | URL | Coverage | Access | License | GTIN? | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|
| **OpenFDA Food Enforcement** | `api.fda.gov/food/enforcement` | All FDA-regulated food recalls 2004+ | REST JSON | Public domain | UPC sometimes in `code_info` text | S | **Verify current cron extracts UPC** — possibly improve |
| **OpenFDA Device Enforcement** | `api.fda.gov/device/enforcement` | Medical device recalls | REST JSON | Public domain | Device ID, not UPC | S | **Propose** if we cover devices |
| **OpenFDA Drug Enforcement** | `api.fda.gov/drug/enforcement` | Drug recalls (incl. OTC) | REST JSON | Public domain | NDC code | S | **Propose** |
| **SaferProducts.gov (CPSC)** | `saferproducts.gov/PublicSearch` | Consumer reports + recalls, ~80k incidents | API (XML/JSON) | Public domain | Sometimes UPC | M | **Propose** — extends current CPSC cron |
| **RAPEX / Safety Gate (EU)** | `ec.europa.eu/safety-gate-alerts` | EU dangerous non-food alerts; ~4k/yr | RSS + JSON API | CC-BY 4.0 | Sometimes barcode | S | **Propose** — multinational brand catch (Shein/Temu signal) |
| **Health Canada Recalls** | `recalls-rappels.canada.ca/en/search/site?search_api_fulltext=&f%5B0%5D=category%3A1` | Food/health/consumer Canadian recalls | RSS + HTML; no JSON | Public-sector OGL | Rarely | M | Optional Canadian overlay |
| **TGA Recalls (Australia)** | `tga.gov.au/safety/alerts` | Therapeutic goods | HTML; manual export | CC-BY | No | L | Skip — narrow + Aus-only |
| **NHTSA Recalls (existing cron)** | `nhtsa.gov/recalls` | Vehicle recalls × make/model/year/VIN | REST API | Public domain | VIN | — | **Verify mapping** to brand→parent (see §6) |

**Verification needed:** does the current `cpsc-weekly.yml` cron pull SaferProducts.gov consumer incident reports, or only the formal recall list? If only recalls, adding the incident feed would 5x the signal density.

---

## 5. Certification programs (product-level)

| Source | URL | Coverage | Access | License | GTIN? | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|
| **WaterSense (EPA)** | `epa.gov/watersense/product-search` | ~36,000 water-efficient products | HTML; CSV downloadable | Public domain | Model # | S | **Propose** |
| **Green Seal** | `greenseal.org/find-products-services` | ~3,500 certified products | HTML scrape | Proprietary; ToS unclear | No | L | Skip — license risk |
| **EPA Safer Choice** | `epa.gov/saferchoice/products-list` | ~2,400 cleaners | HTML + CSV | Public domain | Sometimes UPC | S | **Propose** (re §2) |
| **GREENGUARD / UL Environment** | `spot.ul.com` | ~150,000 SKUs (low-emission furniture/building) | Searchable HTML; no bulk dump | Proprietary | No | XL | Skip — paid-only bulk access |
| **OEKO-TEX Buying Guide** | `oeko-tex.com/en/buying-guide` | ~10,000 textile licensees | HTML search; no bulk | Proprietary | No | XL | Skip — no bulk; scrape risky |
| **Bluesign system partners** | `bluesign.com/en/business/system-partners` | ~900 textile producers (no product list) | HTML | Proprietary | No | M | **Brand-level only** — minor add |
| **GOTS (Global Organic Textile)** | `global-standard.org/find-certified-suppliers/database` | ~13,000 certified facilities | HTML; CSV via request | CC-BY for some lists | No | M | **Propose brand-level** — apparel category critical |
| **Forest Stewardship Council (FSC)** | already wired (`fsc-fetch.mjs`) | — | — | — | — | — | Already in pipeline |
| **Marine Stewardship Council (MSC)** | already wired (`msc-fetch.mjs`) | — | — | — | — | — | Already in pipeline |
| **ASC (Aquaculture Stewardship Council)** | `asc-aqua.org/find-a-supplier` | ~3,000 farms + 1,800 product brands | HTML; some XLSX | CC-BY 4.0 | No | M | **Propose** — closes salmon/shrimp gap |
| **Rainforest Alliance Certified** | already in pipeline (`rainforest-merge-log.json`) | — | — | — | — | — | Verify scope is product-level |
| **Whole Trade Guarantee (Whole Foods)** | No public dataset | — | — | — | — | — | Skip — proprietary, no list |
| **Fair Trade Certified (FT USA + Fairtrade Intl)** | already wired (`fair-trade-fetch.mjs`) | — | — | — | — | — | Verify covers FT International too |
| **Regenerative Organic Certified** | already DW-45 | ~150 brands | — | — | — | — | DW-45 |
| **B Corp** | already wired (`bcorp-merge-log.json`) | — | — | — | — | — | In pipeline |
| **1% for the Planet** | already DW-12 | — | — | — | — | — | DW-12 |
| **Bonsucro** | already DW-46 | — | — | — | — | — | DW-46 |
| **RSPO** | already DW-44 | — | — | — | — | — | DW-44 |

---

## 6. Brand → parent mapping (THE Nabisco-gap fix)

This is the killer category for the scanner UX. When someone scans an Oreo, we get a brand name ("Oreo") but no parent. Our `brand-parent-map.json` has only ~137 entries.

| Source | URL | Coverage | Access | License | Difficulty | Recommend |
|---|---|---|---|---|---|---|
| **USDA FoodData Central — `brandOwner` field** | (re §1) | ~1.9M items, each with brandOwner | Bulk | Public domain | S | **#1 unlock — propose first** |
| **Wikidata SPARQL — P127 owned-by / P749 parent-org** | `query.wikidata.org` | ~13k brand entities with parent-org statements | SPARQL endpoint, JSON | **CC0** | S | **#2 unlock — propose** |
| **Wikipedia "List of X brands"** | `en.wikipedia.org/wiki/Lists_of_brands` | ~400 lists (e.g., "List of Mondelez brands") | HTML scrape | CC-BY-SA | M | **Propose** — Wikidata-augmented gap fill |
| **GS1 GTIN registry prefix lookup** | `gs1.org/services/check-digit-calculator` | Manufacturer code → company (per UPC prefix) | Paid API + free Verified by GS1 lookup (50/day) | Proprietary | M+$ | Future — paid only |
| **SEC 10-K Exhibit 21** | `sec.gov/cgi-bin/browse-edgar` | US-listed parent → subsidiary lists | EDGAR full-text + scrape | Public domain | M | We have for US-listed — verify completeness |
| **OpenCorporates** | `opencorporates.com/api` | 200M+ global companies | Free tier 200/day; paid for bulk | **Restrictive — Share-Alike for redistribution** | M+ | Skip — license incompatible for our static JSON files |
| **EU Transparency Register** | `transparency-register.europa.eu` | Lobbyists + parent companies | XML export | CC-BY 4.0 | S | **Propose** — fills EU brand gap |
| **Crunchbase** | `crunchbase.com/api` | M&A events | Paid API (~$10k/yr) | Restrictive | — | F-tier — too expensive |
| **OFF brand `parent_company_tag`** | (already wired) | OFF crowdsources parent-company tags | Bulk JSON | ODbL | S | **Verify pipeline ingests parent_company_tag** — possibly free fix |

### Concrete plan for the Nabisco gap

Three layers, in priority order:

1. **USDA FoodData Central** — gives us authoritative brand-owner strings for ~1.9M US food/beverage products. ~80-90% scanner hit rate for groceries. Direct text-match `brandOwner` against existing slugs (case-insensitive, normalize "LLC"/"Inc.").
2. **Wikidata SPARQL** — fills the non-food gap (tech, apparel, household). Single query: `SELECT ?brand ?brandLabel ?parent ?parentLabel WHERE { ?brand wdt:P749 ?parent }` returns ~13,000 brand-parent edges, CC0. Run once monthly.
3. **OFF `parent_company_tag`** — if our current OFF pipeline only reads `brands` and not `parent_company_tag`, fixing that is a 1-line change that nets a few thousand crowdsourced edges.

These three combined should take `brand-parent-map.json` from 137 → 50,000+ entries with minimal compute.

---

## 7. Pricing / availability (lower priority)

| Source | URL | Coverage | License | Recommend |
|---|---|---|---|---|
| USDA Agricultural Marketing Service | `marketnews.usda.gov` | Commodity prices, not retail | Public domain | Skip — not consumer-product scope |
| BLS Consumer Price Index detail | `bls.gov/cpi` | Category-level CPI | Public domain | Skip — not product-level |
| Walmart Open Data | — | Doesn't exist (Walmart shut down API in 2020) | — | Skip |
| Open Prices (OFF sister project) | `prices.openfoodfacts.org/api/docs` | Crowdsourced retail prices, ~100k entries | ODbL | **Niche — future** |

---

## TOP 15 RANKED by ability to improve in-store scanner accuracy

| Rank | Source | Why it wins |
|---|---|---|
| **1** | **USDA FoodData Central Branded Foods** | 1.9M items, GTIN-indexed, authoritative `brandOwner` — single biggest scanner-accuracy unlock available |
| **2** | **Wikidata P127/P749 (brand-parent SPARQL)** | CC0, ~13k brand-parent edges, fills non-food gap |
| **3** | **Open Beauty Facts bulk** | Closes personal-care scanner gap; same loader as OFF |
| **4** | **California Prop 65 list** | Trusted "warning chemicals" flag, ingredient-derivable for any scanned product |
| **5** | **FDA Substances Added to Food (SAF)** | Banned/restricted additives flag from ingredient text |
| **6** | **OpenFDA Drug Enforcement** | NDC-indexed OTC drug recalls — pharmacy aisle coverage |
| **7** | **EU Safety Gate (RAPEX)** | Catches Shein/Temu/AliExpress dangerous-product flags — discount-retail relevant |
| **8** | **EPA Safer Choice product list** | Cleaning-aisle ecolabel, CSV-downloadable |
| **9** | **EPA WaterSense product list** | Bathroom/appliance ecolabel |
| **10** | **OFF `parent_company_tag` field** (improve existing) | Already in pipeline — just read the right field |
| **11** | **ASC (Aquaculture Stewardship Council)** | Seafood-aisle complement to MSC |
| **12** | **Wikipedia "List of brands" pages** | Augments Wikidata where statements missing |
| **13** | **SaferProducts.gov incident feed (CPSC)** | Consumer-reported hazards, not just formal recalls |
| **14** | **Open Pet Food Facts** | Closes pet-aisle gap |
| **15** | **GOTS certified facilities** | Apparel/textile aisle ecolabel |

---

## TOP 6-8 to integrate next sprint

These are the highest-value × lowest-effort × clean-license sources to wire up before Product Hunt launch (Jun 23) — or in the post-launch sprint.

| ID (proposed) | Source | Effort | Why now |
|---|---|---|---|
| **DW-61** | USDA FoodData Central Branded Foods (incl. brandOwner) | S | Single biggest scanner accuracy unlock. ~2 GB monthly dump, brandOwner field is the killer. |
| **DW-62** | Wikidata P127/P749 brand-parent SPARQL | S | CC0 license, single query → 13k brand-parent edges → `brand-parent-map.json` jumps 137 → 13,000+. |
| **DW-63** | Open Beauty Facts bulk | S | Mirror the OFF loader; ODbL. Solves personal-care scanner gap. |
| **DW-64** | California Prop 65 list | S | 900-row CSV, public domain. Flag every scanned product whose ingredients contain a Prop 65 chemical. Huge trust signal. |
| **DW-65** | FDA Substances Added to Food (SAF) | S | ~4,000-row CSV, public. Flags banned/restricted additives in ingredient text. |
| **DW-66** | EPA Safer Choice + EPA WaterSense | S | Both are public-domain CSV downloads. Two ecolabels for one sprint. |
| **DW-67** | EU Safety Gate (RAPEX) RSS+JSON | S | CC-BY 4.0, ~4,000 alerts/yr. Catches non-food dangerous-product flags Shein/Temu pump. |
| **DW-68** | OFF `parent_company_tag` field — pipeline fix | S | We probably already pull OFF; this is a 1-line addition to also read the parent tag. |

Total estimated effort: ~3-4 days of agent compute. Combined impact: barcode scanner moves from "Open Food Facts only" to **authoritative brand-owner + 5+ certification overlays + 2 hazard registries**.

---

## SPECIAL SECTION: Which sources fix the Nabisco-scan-gap problem?

**The problem:** User scans Oreo → barcode resolves via OFF → we get brand="Oreo" but our company data is keyed by parent="mondelez-international" → no match → blank result card.

**Five sources, ranked by impact:**

| Rank | Source | What it gives us | Coverage estimate |
|---|---|---|---|
| **1** | **USDA FoodData Central — `brandOwner`** | Direct text field on every of 1.9M US grocery items. "OREO" → brandOwner: "Mondelez Global LLC" | **~80% of US grocery scans** |
| **2** | **Wikidata P749 (parent-organization SPARQL)** | Structured CC0 edges: `Oreo (Q12345) → parent-organization → Mondelez International (Q67890)` | **~13,000 well-known brands globally** |
| **3** | **OFF `parent_company_tag`** | Crowdsourced parent tag already in OFF dumps. We may not be reading it | **~20-40% of OFF-covered SKUs** |
| **4** | **Wikipedia "List of [Company] brands"** | One Wikipedia page per major parent enumerates their sub-brands. Mondelez's page lists Oreo, Ritz, Nabisco, Toblerone, Cadbury, etc. | **~200 major parents × ~20 brands each = 4,000 edges** |
| **5** | **SEC 10-K Exhibit 21** | US-listed parent companies disclose subsidiary lists in their annual filing | **~3,000 US-listed companies, but Exhibit 21 lists *legal entities*, not consumer brands** — narrower than it sounds |

**Recommended fix sequence:**

1. Add USDA FDC ingest (DW-61). Map every distinct `brandOwner` string to either an existing slug or a new candidate row. **Expect ~10,000 new brand-parent edges.**
2. Add Wikidata SPARQL (DW-62). Cross-reference with #1; conflict-resolve in favor of USDA.
3. Fix OFF pipeline to read `parent_company_tag` (DW-68). Treat as evidence-strength=weak (crowdsourced).
4. After 1-3 ship, `brand-parent-map.json` should hit ~25,000 entries. The Nabisco-gap is mostly closed.

**What won't work / common traps:**

- **GS1 GTIN prefix lookup** sounds magical (the first 6-9 UPC digits encode the manufacturer ID), but GS1 charges enterprise rates and the free `Verified by GS1` tool caps at 50/day. Don't propose.
- **OpenCorporates** is tempting but its license forces share-alike on derivative datasets — incompatible with our static-JSON publishing model.
- **OFF crowdsourced brands field alone** is what we have today and it has a long tail of misspellings ("oreo", "Oreo Brand", "Nabisco Oreo") with no parent. The fix isn't more OFF; it's the structured `parent_company_tag` field.

---

## Notes on existing pipeline (verification follow-ups)

These aren't new proposals but tasks to confirm we get the most out of what's already wired:

1. **CPSC cron** — confirm it ingests `saferproducts.gov` incident reports, not just formal recalls. If only recalls, add the incidents endpoint.
2. **NHTSA cron** — verify the make→automaker→parent chain hits (e.g., Ram → Stellantis, GMC → GM, Acura → Honda). Brand-parent map should already cover this but worth a sanity check.
3. **OpenFDA cron** — verify it pulls Drug and Device enforcement, not just Food. NDC code on drug recalls is a UPC-equivalent.
4. **OFF loader** — confirm whether we read `parent_company_tag` (free fix per DW-68).
5. **Rainforest Alliance** (`rainforest-merge-log.json` exists) — confirm scope: company-level or product-SKU-level. If only company-level, complement with the certified-products list.
6. **EWG DW-36 backlog item** — reclassify as **license-blocked, do not ingest**. Keep "deep-link to ewg.org" as a UX-only option.

---

## Sources used in this report

- USDA FoodData Central docs — `https://fdc.nal.usda.gov/api-guide`
- Open Food Facts data exports — `https://world.openfoodfacts.org/data`
- Open Beauty Facts data exports — `https://world.openbeautyfacts.org/data`
- Wikidata SPARQL endpoint — `https://query.wikidata.org`
- EWG Skin Deep terms of use — `https://www.ewg.org/terms-of-use`
- California OEHHA Prop 65 — `https://oehha.ca.gov/proposition-65/proposition-65-list`
- FDA Substances Added to Food — `https://cfsanappsexternal.fda.gov/scripts/fdcc/?set=FoodSubstances`
- OpenFDA API docs — `https://open.fda.gov/apis/`
- EU Safety Gate — `https://ec.europa.eu/safety-gate-alerts`
- EPA Safer Choice — `https://www.epa.gov/saferchoice/products`
- EPA WaterSense — `https://www.epa.gov/watersense/product-search`
- GS1 US — `https://www.gs1us.org`
- OpenCorporates API terms — `https://opencorporates.com/info/api`
- ASC certified — `https://www.asc-aqua.org/find-a-supplier`
- GOTS database — `https://global-standard.org/find-certified-suppliers/database`

**Word count: ~3,400 words.** Within cap.
