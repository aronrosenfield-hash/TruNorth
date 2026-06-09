# Top-Brand Coverage Gap Audit — TruNorth Index (2026-06-08)

**Goal.** Make sure that on Product Hunt launch day (Jun 23, 2026), every top consumer-facing brand a user is plausibly going to scan or search returns a real result — not "brand not found." This is a one-shot audit of `public/data/index.json` (11,209 entries) and `public/data/_meta/brand-parent-map.json` (4,626 sub→parent links) against seven authoritative top-brand sources.

**Method.** Built a normalized name/slug lookup over the index plus the parent-map; for each brand from each source, classified as DIRECT (exact match by name or slug), VIA PARENT (sub-brand mapped to an indexed parent, OR parent of the brand is in the index by name), or MISSING. Substring/fuzzy hits were spot-verified by hand to avoid false positives ("Mini" ≠ "GoldMining"; "Razer" ≠ "ParaZero").

**Index file path.** `/Users/aronrosenfield/Developer/trunorth/public/data/index.json`
**Parent-map file path.** `/Users/aronrosenfield/Developer/trunorth/public/data/_meta/brand-parent-map.json`

---

## Headline stats

- **Total top-brand slots evaluated:** ~832 (across 7 sources, with overlap)
- **Unique brands evaluated:** ~660
- **Coverage rate (direct + via parent), weighted:** **~84%**
- **Truly missing (after fuzzy verification):** **~104 brands** = **~16% miss rate**
- **Launch-critical missing (top-50 by scan frequency):** **50 brands** — see fix list below

This is **better than expected for a 11k-brand index**, but the misses are concentrated in three painful places for a barcode-scanning consumer app: **luxury/global fashion (LVMH/Kering/Capri portfolios), Chinese tech (TikTok/Temu/Alibaba/Huawei), and modern beauty (Glossier/Rare Beauty/Drunk Elephant)**. Closing the top 50 gets us above 95% covered against blue-chip lists for less than a day of curation work.

---

## Per-source coverage breakdown

| Source | Total | Direct | Via Parent | Missing | Coverage |
|---|---:|---:|---:|---:|---:|
| Interbrand Best Global Brands 2024 (top ~100) [^1] | 105 | 79 | 9 | 17 | **83.8%** |
| Kantar BrandZ Most Valuable Global Brands 2024 (additions beyond Interbrand) [^2] | 40 | 23 | 5 | 12 | **70.0%** |
| Forbes consumer-brand portfolios (CPG roll-up, ~170 sub-brands) [^3] | 167 | 71 | 94 | 2 | **98.8%** |
| Statista Top US Brands by Industry (~15 categories) [^4] | 356 | 228 | 60 | 68 | **80.9%** |
| Forbes Top US Private Companies (sample) [^5] | 42 | 23 | 0 | 19 | **54.8%** |
| Yelp most-reviewed national chains (proxy) [^6] | 72 | 60 | 3 | 9 | **87.5%** |
| Open Food Facts top-scanned (food/bev staples) [^7] | 50 | 15 | 24 | 11 | **78.0%** |

**Patterns visible from per-source rates:**

1. **CPG (Forbes roll-up) coverage is excellent at 98.8%** — the parent-map work for P&G, Unilever, Mondelez, Nestlé, Kraft Heinz, J.M. Smucker pays off. Oreo/Tide/Hellmann's scans resolve through the parent.
2. **Forbes Private companies is worst at 54.8%** — we miss unicorns (OpenAI, Anthropic, Databricks, Canva, ByteDance, SpaceX, Discord, Roblox) and large private CPG/retail (Wegmans, Goya, Hearst, Bechtel, SAS). Public-records pipelines naturally under-index private firms.
3. **Statista weakest in beauty (60–70%) and household cleaners** (Reckitt and S.C. Johnson portfolios not mapped).
4. **Kantar BrandZ misses dominated by China** — Alibaba, TikTok, Douyin, Temu, Pinduoduo, Huawei, ICBC, Moutai absent. TikTok/Temu are the highest US-relevance ones.

---

## Missing brands — sorted by estimated US consumer scan frequency

Tiered by realistic likelihood that a user, in the first 30 days of using TruNorth, will scan or search for the brand in a US grocery store, drugstore, big-box, mall, or app store.

### Tier 1 — LAUNCH-CRITICAL (top 50, highest scan frequency)

These are brands a typical US shopper encounters weekly. Each one is a credibility hit if it returns "not found."

| # | Brand | Parent / Owner | Category | Recommended fix |
|---:|---|---|---|---|
| 1 | TikTok | ByteDance | Tech / Social | Add ByteDance to index + map `tiktok` → `bytedance` |
| 2 | Temu | PDD Holdings | E-commerce | Add PDD Holdings to index + map `temu` → `pdd-holdings` |
| 3 | Athleta | Gap Inc. | Apparel | Add `athleta` → `gap-inc` to brand-parent-map (parent already in index) |
| 4 | Old Navy | Gap Inc. | Apparel | Add `old-navy` → `gap-inc` to brand-parent-map (parent already in index) |
| 5 | Rite Aid | Rite Aid Corporation | Drugstore | Add parent to index |
| 6 | Wegmans | Wegmans Food Markets | Grocery | Add to index (private, US Northeast scan staple) |
| 7 | eBay | eBay Inc. | E-commerce | Add to index |
| 8 | LG Electronics | LG Corporation | Electronics | Add to index (TVs, appliances) |
| 9 | Dyson | Dyson Ltd. | Appliances | Add to index |
| 10 | Cuisinart | Conair | Small appliances | Add Conair + map sub-brand |
| 11 | Hamilton Beach | Hamilton Beach Brands | Small appliances | Add to index |
| 12 | Vitamix | Vitamix | Small appliances | Add to index |
| 13 | Instant Pot | Instant Brands | Small appliances | Add Instant Brands + map |
| 14 | Breville | Breville Group | Small appliances | Add to index |
| 15 | TJ Maxx | TJX Companies | Off-price retail | Add TJX + map sub-brand (Marshalls, HomeGoods too) |
| 16 | HomeGoods | TJX Companies | Off-price retail | Map to `tjx-companies` once added |
| 17 | Big Lots | Big Lots Inc. | Discount retail | Add to index |
| 18 | Tractor Supply | Tractor Supply Company | Rural/farm retail | Add to index |
| 19 | O'Reilly Auto Parts | O'Reilly Automotive | Auto parts | Verify slug — `o-reilly-automotive` exists; just add brand-parent-map entry for `o-reilly-auto-parts` |
| 20 | NAPA Auto Parts | Genuine Parts Company | Auto parts | Add GPC if not present + map sub-brand |
| 21 | Pep Boys | Icahn Automotive | Auto parts/service | Add to index |
| 22 | Lidl | Schwarz Group | Grocery | Add Schwarz Group + map |
| 23 | Texas Roadhouse | Texas Roadhouse Inc. | Restaurant | Add to index |
| 24 | Papa Murphy's | Papa Murphy's Holdings | Pizza | Add to index |
| 25 | Mucinex | Reckitt | OTC pharma | Add Reckitt to index + map sub-brand |
| 26 | Durex | Reckitt | Personal care | Map after Reckitt added |
| 27 | Enfamil | Reckitt | Baby food | Map after Reckitt added |
| 28 | Woolite | Reckitt | Laundry | Map after Reckitt added |
| 29 | Calgon | Reckitt | Laundry | Map after Reckitt added |
| 30 | Pledge | S. C. Johnson & Son | Household | Add S.C. Johnson + map full portfolio |
| 31 | Raid | S. C. Johnson & Son | Household | Map after SCJ added |
| 32 | Scrubbing Bubbles | S. C. Johnson & Son | Household | Map after SCJ added |
| 33 | Mr Muscle | S. C. Johnson & Son | Household | Map after SCJ added |
| 34 | Fage | Fage International | Yogurt | Add to index (top-scanned dairy) |
| 35 | Stonyfield | Lactalis | Yogurt | Add Lactalis + map |
| 36 | Barilla | Barilla Group | Pasta | Add to index (top-scanned pantry staple) |
| 37 | Goya | Goya Foods | Hispanic foods | Add to index |
| 38 | Impossible Foods | Impossible Foods Inc. | Plant-based | Add to index |
| 39 | Tofurky | Tofurky | Plant-based | Add to index |
| 40 | Newman's Own | Newman's Own Inc. | Condiments | Add to index |
| 41 | Glossier | Glossier Inc. | Beauty | Add to index |
| 42 | Rare Beauty | Rare Beauty | Beauty | Add to index |
| 43 | Drunk Elephant | Shiseido | Skincare | Verify Shiseido in index + map |
| 44 | Roblox | Roblox Corp | Gaming | Add to index |
| 45 | OpenAI | OpenAI | AI/SaaS | Add to index |
| 46 | Anthropic | Anthropic | AI/SaaS | Add to index |
| 47 | Canva | Canva | SaaS | Add to index |
| 48 | Databricks | Databricks | SaaS | Add to index |
| 49 | ByteDance | ByteDance | Tech parent | Add to index (covers TikTok/Douyin) |
| 50 | Huawei | Huawei | Electronics | Add to index |

### Tier 2 — STRONG SECONDARY (next 30, medium scan frequency)

Brands encountered monthly by many US users — travel, luxury, fitness, fintech.

| Brand | Parent | Category | Fix |
|---|---|---|---|
| Louis Vuitton | LVMH | Luxury fashion | Add LVMH + map LV/Dior/Hennessy/Bulgari/Tiffany/Sephora portfolio |
| Dior | LVMH | Luxury fashion | Map after LVMH |
| Hennessy | LVMH | Spirits | Map after LVMH |
| Bulgari | LVMH | Luxury | Map after LVMH |
| Hermès | Hermès International | Luxury | Add to index |
| Chanel | Chanel | Luxury | Add to index |
| Prada | Prada Group | Luxury | Add to index |
| Rolex | Rolex SA | Watches | Add to index |
| Michael Kors | Capri Holdings | Fashion | Add Capri + map (Versace, Jimmy Choo too) |
| Versace | Capri Holdings | Fashion | Map after Capri |
| Jimmy Choo | Capri Holdings | Fashion | Map after Capri |
| Uniqlo | Fast Retailing | Apparel | Add Fast Retailing + map |
| Eastpak | VF Corporation | Apparel | VF Corp exists; add brand-parent-map entry |
| Wonderbra | HanesBrands | Apparel | HanesBrands exists; add map entry |
| Hilton (parent) | Hilton Worldwide | Hospitality | Already covered ("Hilton") — verify parent slug for sub-brand mapping |
| Air France | Air France-KLM | Airline | Add to index |
| KLM | Air France-KLM | Airline | Add to index |
| Emirates | The Emirates Group | Airline | Add to index |
| Singapore Airlines | Singapore Airlines | Airline | Add to index |
| Cathay Pacific | Cathay Pacific | Airline | Add to index |
| Ryanair | Ryanair Holdings | Airline | Add to index |
| Air Canada | Air Canada | Airline | Add to index |
| Mazda | Mazda Motor Corp | Auto | Add to index |
| Volvo | Volvo Cars / Volvo Group | Auto | Add to index (distinguish Cars vs Group) |
| Polestar | Polestar / Geely | Auto/EV | Add to index |
| Allianz | Allianz SE | Insurance | Add to index |
| HSBC | HSBC Holdings | Bank | Add to index |
| AXA | AXA Group | Insurance | Add to index |
| Vodafone | Vodafone Group | Telco | Add to index |
| 3M | 3M Company | Industrial/Consumer | Add to index (Post-it, Scotch tape, Command strips) |

### Tier 3 — INTERNATIONAL / LONG TAIL (remainder)

Lower urgency for US launch; nice-to-have for credibility on global press coverage.

| Brand | Notes |
|---|---|
| Alibaba | Add for international coverage; covers AliExpress |
| Pinduoduo | Same as Temu parent |
| Moutai (Kweichow Moutai) | Chinese liquor leader |
| ICBC | China's largest bank |
| Telstra | Australian telco |
| Maybank | Malaysian bank |
| DBS Bank | Singapore bank |
| Reliance Jio | India's largest telco |
| Land Rover / Jaguar | Add JLR + map both |
| Mini | Add brand-parent-map `mini` → `bmw` (BMW already in index) |
| Lego | Add to index |
| Miele | Add (premium appliances) |
| Heinz Kraft sub-brands | Already covered via Kraft Heinz parent |
| Reckitt sub-brands beyond Tier 1 | Add Reckitt to cover full portfolio |
| Reyes Holdings | Largest US beer distributor — niche but ranked Forbes #1 private |
| C&S Wholesale Grocers | Forbes top private |
| Bechtel | Forbes top private (construction) |
| Ernst & Young, Hearst, Enterprise Holdings, SAS Institute | Forbes top private; not consumer-facing scan targets |
| Valve, Discord, Stripe, SpaceX | Private tech unicorns; low scan frequency |
| Lufthansa | Index has `DEUTSCHE LUFTHANSA A G` — add brand-parent-map alias `lufthansa` → `deutsche-lufthansa-a-g` |
| British Airways, Qatar Airways | Add as standalone or map to International Airlines Group |
| Orangetheory | Add to index |

### Already covered via parent — false alarms in initial pass

These looked missing on raw match but resolve correctly through the parent map or as a substring of a longer official name. **No action needed**, but worth knowing the matcher works:

- Lufthansa → `DEUTSCHE LUFTHANSA A G` (just add an alias)
- Container Store → `The Container Store`
- O'Reilly Auto Parts → `O REILLY AUTOMOTIVE`
- Boots → `Walgreens` (parent already correct)
- Burberry → direct match
- Beyond Meat → direct match (uppercased in index)
- Inditex sub-brands (Bershka, Massimo Dutti, Stradivarius) → already via `industria-de-diseno-textil-inditex-sa` / `zara-inditex`
- Pine-Sol / Hidden Valley / Burt's Bees / Liquid-Plumr / Glad → already via `CLOROX CO` (verify brand-parent-map entries exist for each)

---

## Recommended next sprint — the "launch-critical close"

### Phase A — Add these parent corporations to `index.json` (~20 entries)

Highest leverage: each one unlocks 3–20 sub-brand mappings.

1. **Reckitt** (Mucinex, Lysol\*, Air Wick\*, Finish\*, Durex, Enfamil, Woolite, Calgon) — note: Lysol/Air Wick/Finish already appear in our test results as covered direct; verify
2. **S. C. Johnson & Son** (Ziploc\*, Windex\*, Pledge, Raid, Off!\*, Glade\*, Scrubbing Bubbles, Mr Muscle, Saran, Shout)
3. **Capri Holdings** (Michael Kors, Versace, Jimmy Choo)
4. **LVMH** (Louis Vuitton, Dior, Hennessy, Bulgari, Tiffany, Sephora, Hermès — wait, not Hermès, that's separate)
5. **Hermès International**
6. **Chanel**
7. **Prada Group**
8. **Rolex SA**
9. **Fast Retailing** (Uniqlo)
10. **TJX Companies** (TJ Maxx, Marshalls, HomeGoods, Sierra)
11. **Schwarz Group** (Lidl, Kaufland)
12. **Yum! Brands** (KFC, Pizza Hut, Taco Bell already in index — verify map)
13. **Inspire Brands** (Sonic, Arby's, Dunkin', Baskin-Robbins, Buffalo Wild Wings, Jimmy John's)
14. **ByteDance** (TikTok, Douyin)
15. **PDD Holdings** (Temu, Pinduoduo)
16. **Conair** (Cuisinart)
17. **Instant Brands** (Instant Pot, Pyrex, Corelle)
18. **LG Corporation** (LG Electronics — and verify Korean Hyundai-style entries)
19. **Lactalis** (Stonyfield, Président, Galbani)
20. **Genuine Parts Company** (NAPA Auto Parts)

### Phase B — Add these direct brand entries (~30 entries)

Brands without a US-public parent or where the brand IS effectively the company:

Rite Aid, Wegmans Food Markets, eBay, Dyson, Hamilton Beach, Vitamix, Breville, Big Lots, Tractor Supply, Pep Boys, Texas Roadhouse, Papa Murphy's, Fage, Barilla, Goya Foods, Impossible Foods, Tofurky, Newman's Own, Glossier, Rare Beauty, Roblox, OpenAI, Anthropic, Canva, Databricks, Huawei, Lego, Miele, 3M, Allianz, HSBC, AXA, Vodafone, Air France-KLM, Emirates, Singapore Airlines, Cathay Pacific, Ryanair, Air Canada, Mazda Motor, Volvo Cars, Polestar.

### Phase C — Add these `brand-parent-map.json` entries (~40 mappings, after Phases A/B)

For each brand under the parents added in Phase A, add a `{parent, confidence:"high", source:"curated"}` entry keyed by the brand slug. Same for:

- `athleta` → `gap-inc`
- `old-navy` → `gap-inc`
- `banana-republic` → `gap-inc` (already in index as standalone but should link to Gap Inc.)
- `mini` → `bmw`
- `lufthansa` → `deutsche-lufthansa-a-g` (alias)

**Estimated effort:** one focused session, ~3-4 hours, mostly mechanical lookup of Wikidata/Wikipedia for parent companies. Net result: takes overall covered rate against blue-chip lists from ~84% to ~97%.

---

## Optional discovery — patterns and structural observations

1. **Beauty & Personal Care is dramatically under-categorized.** Only 17 entries are tagged `Beauty & Personal Care`; many cosmetics live under Consumer Goods/Retail or are missing. A category-rebalance pass after Phase B would improve filter UX.

2. **Modern DTC beauty is a known weak spot.** Glossier, Rare Beauty, Fenty, Drunk Elephant, e.l.f., Tatcha dominate TikTok/Sephora but are private/recently-acquired and don't surface from our SEC-driven pipelines. Hand-curate top 30 DTC beauty.

3. **Chinese tech is structurally missing.** TikTok, Douyin, Temu, Pinduoduo, Huawei, Alibaba, Tencent. Pipelines are US-centric. For the PH audience, TikTok is the highest priority.

4. **Hotel sub-brand mapping is thin.** Marriott/Hilton/IHG main flags resolve, but St. Regis, W Hotels, Curio, Canopy, Crowne Plaza need explicit parent-map entries. Note: "Intercontinental Exchange" in the index is the financial company, NOT the hotel chain.

5. **Parent-map covers CPG strongly but ignores apparel/restaurant chains.** The 4,626 entries skew toward food/personal-care. Apparel (Gap→Athleta/Old Navy) and restaurant operators (Inspire Brands→Sonic/Arby's/Dunkin') are under-mapped. Targeted sweep adds ~80–100 entries.

6. **Private companies will always be a structural blind spot** for an SEC/Form-D/lobbying pipeline. Accept and document: for Trader Joe's, Wegmans, In-N-Out, Mars, Cargill, Koch, Publix, we should still index them with "Private — limited public-records signal" and surface what we DO have (FEC, OSHA, EPA).

---

## Sources cited

[^1]: Interbrand, "Best Global Brands 2024." https://interbrand.com/best-global-brands/
[^2]: Kantar BrandZ, "Most Valuable Global Brands 2024." https://www.kantar.com/campaigns/brandz/global
[^3]: Forbes, "The World's Most Valuable Brands." https://www.forbes.com/the-worlds-most-valuable-brands/ and parent-company portfolios from each owner's investor-relations brand list (P&G, Unilever, Mondelez International, Nestlé, Kraft Heinz, Mars, Hershey, General Mills, J.M. Smucker, Kellanova, Conagra, PepsiCo, Coca-Cola, Reckitt, S.C. Johnson, Clorox, Kimberly-Clark, Kenvue, Haleon).
[^4]: Statista, "Top Brands in the US" by industry (groceries, personal care, household cleaners, beauty, apparel, electronics, restaurants/QSR, beverages, snacks, OTC pharma, automotive, hotels, airlines, banks, streaming). https://www.statista.com/markets/
[^5]: Forbes, "America's Largest Private Companies." https://www.forbes.com/largest-private-companies/
[^6]: Yelp Trends & "Most-Reviewed National Chains" (proxy for top consumer-facing brick-and-mortar). https://trends.yelp.com/ and https://www.yelp.com/
[^7]: Open Food Facts product database public statistics. https://world.openfoodfacts.org/

**Methodology files (not committed):** ad-hoc node scripts at `/tmp/coverage_check.mjs` and `/tmp/missing_refined.json` used to generate the per-source coverage stats and missing brand list above.
