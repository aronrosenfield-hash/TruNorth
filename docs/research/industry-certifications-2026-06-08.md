# Industry-Specific Certification & Standards Bodies — Research 2026-06-08

**Goal:** Identify NEW high-signal industry-specific certifications and standards-body datasets to add to TruNorth's ~134 source pipeline. Focus: category-specific certifications that let us tell a user "this brand's product meets standard X."

**Author:** Research agent
**Scope:** Research only — no code. Word cap 4,000.

**Already in pipeline (NOT proposed below):** B Corp, Fair Trade USA, Rainforest Alliance, MSC, USDA Organic, Non-GMO Project, 1% for the Planet, Energy Star (base), Cradle to Cradle, Leaping Bunny, PETA BWB, Vegan Society, Climate Neutral, FSC, OEKO-TEX (partial brand-level), WikiRate, SBTi, Forest 500, USDA FoodData Central, CDP (skipped/paywalled).

**Already on BACKLOG (DW-1 through DW-90) — NOT re-proposed:** EPEAT (DW-37), V-Label (DW-41), Kosher OU/OK (DW-40), Certified Humane + AGW (DW-39), Bonsucro (DW-46), RSPO (DW-44), Regenerative Organic Certified (DW-45), Climate Label (DW-47), Better Cotton (DW-57), Demeter (DW-58), Bird-Friendly (DW-59), Global Animal Partnership (DW-60), Bluesign (referenced in product-registries doc), USDA Organic Integrity (DW-5), ASC (proposed in product-registries doc), GOTS (proposed in product-registries doc).

This report covers the **remaining gaps** by industry vertical.

---

## 1. Beauty / Personal Care

| Source | URL | What it certifies | # certified | Access | License | Freshness | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|---|
| **MADE SAFE** | madesafe.org/products | Non-toxic personal care, baby, household | ~250 brands × 1,500 products | HTML scrape (no API, no bulk CSV); product cards include brand + cert date | Proprietary — directory data is factual (cert status); reasonable scrape OK | Continuous | **High** — Beautycounter, Annmarie, etc. | M | **PROPOSE** |
| **COSMOS-standard (organic & natural cosmetics)** | cosmos-standard.org/certified-products | Organic/natural cosmetics global standard (Ecocert, Soil Assoc., ICEA, etc.) | ~30,000 products | HTML search (no bulk); per-certifier CSVs exist (Ecocert publishes one) | CC-BY w/ attribution (varies by issuer) | Quarterly | Med — Dr. Bronner's, Weleda, Pai | M-L | **PROPOSE** (Ecocert CSV path only) |
| **CertClean** | certclean.com/brand-search | Free-from 60+ flagged chemicals (parabens, phthalates, etc.) | ~80 brands × ~2,000 products | HTML directory | Proprietary, factual | Annual | Med — niche but recognizable | M | Optional — small footprint |
| **EWG VERIFIED for beauty** (separate from Skin Deep DB) | ewg.org/ewgverified | EWG's seal program (vs. Skin Deep scoring) | ~2,000 products × ~120 brands | HTML scrape | **Proprietary — non-commercial.** Same ToS as Skin Deep | Continuous | High recognition | L | **SKIP** — license blocker |
| **Skin Cancer Foundation Seal of Recommendation** | skincancer.org/product-finder | Sunscreens + photoprotective products meeting SCF criteria | ~900 products | HTML search | Proprietary, factual | Continuous | High — Neutrogena, La Roche-Posay, Supergoop | M | **PROPOSE** |
| **Reef-Safe / "Reef-Friendly" certifications** | Multiple: Hawaii SB 2571 prohibited list (oxybenzone, octinoxate); Haereticus Lab "Protect Land + Sea" certification (haereticus-lab.org) | Sunscreens without coral-toxic UV filters | ~50 certified products + INCI-derivable boolean | HI banned-ingredient list (CSV from state); Haereticus list (HTML) | Public domain (HI law); proprietary (Haereticus, factual) | Annual | Med — flagship for sunscreen aisle | S | **PROPOSE** (INCI-derived + Haereticus) |
| **IFRA Standards** | ifrafragrance.org/safe-use/standards-library | Fragrance ingredient safety standards (51st amendment in 2024) | ~200 restricted/prohibited fragrance ingredients | PDF + IFRA Library web app (no bulk CSV) | Proprietary — redistribution restricted | Annual (amendments) | Low at *brand* level; useful at *ingredient* level only | L | **SKIP** for brand-level; future ingredient enrichment |
| **CIR (Cosmetic Ingredient Review)** | cir-safety.org/ingredients | Industry-funded safety panel reviews of cosmetic ingredients | ~1,400 reviewed ingredients | PDF reports + searchable HTML | Public (factual reviews) | Continuous | Low at brand level; ingredient-flag enrichment only | L | **SKIP** for brand-level (echoes product-registries doc note) |
| **NSF/ANSI 305 — Organic personal care** | nsf.org/standards-development/standards-portfolio/personal-care-305 | NSF organic personal care standard (US org equivalent for cosmetics) | ~50 brands | NSF White Book Listing (HTML, model #) | Proprietary, factual | Continuous | Low US adoption (most beauty brands use COSMOS or USDA Organic) | M | **SKIP** — low coverage |

**Beauty bottom line:** MADE SAFE + COSMOS (via Ecocert) + Skin Cancer Foundation + Reef-Safe (HI law + Haereticus) are the 4 build-now candidates. EWG Verified is the most-recognized label but license blocks redistribution — deep-link UX only.

---

## 2. Textiles / Apparel

| Source | URL | What it certifies | # certified | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **Made in Green by OEKO-TEX** | oeko-tex.com/en/our-standards/made-in-green-by-oeko-tex | Traceable label combining STeP factory + product test | ~6,000 products w/ unique label IDs | HTML label-ID lookup (each product has a 14-digit ID); no bulk dump | Proprietary | Med — H&M, IKEA, Mammut, Maier Sports | XL | **SKIP** — no bulk access, scraping each label ID is impractical |
| **Recycled Claim Standard (RCS) + Global Recycled Standard (GRS)** | textileexchange.org/standards/recycled-claim-standard-global-recycled-standard/ | Recycled-content tracing for textiles | ~9,000 certified facilities | Textile Exchange "Certified Sites" search (HTML) + annual report PDF lists licensees | CC-BY for the Annual Report dataset | Annual | High — Patagonia, Adidas, North Face, Levi's | M | **PROPOSE** |
| **Responsible Wool Standard (RWS) + Responsible Down Standard (RDS) + Responsible Mohair Standard (RMS)** | textileexchange.org/standards | Animal-welfare + land-use standards for fibers | ~3,000 certified entities (combined) | Same TE "Certified Sites" portal | CC-BY (TE annual lists) | Annual | High — Patagonia, Athleta, Allbirds (RWS); H&M, Eddie Bauer (RDS) | M | **PROPOSE** (bundle with RCS/GRS) |
| **Better Cotton Initiative members** | bettercotton.org/who-we-are/find-members | Cotton sustainability program (members include H&M, IKEA, Nike, Adidas, Levi's, Marks & Spencer) | ~2,800 members | HTML directory | CC-BY-ish; members public | Quarterly | High | S | **NOTE: BACKLOG DW-57** — already waitlisted. Promote to build-now. |
| **Fair Wear Foundation members** | fairwear.org/brands | Garment-industry labor rights mfr standard (EU heavy, but Nudie, Vaude, Acne Studios, Mammut) | ~140 brand members | HTML directory + annual brand performance score CSV (1-5 scale) | CC-BY 4.0 | Annual | Med (EU-skewed but US-sold) | S | **PROPOSE** |
| **bluesign system partners** (see product-registries doc) | bluesign.com | Chemical-management for textiles | ~900 partners | HTML | Proprietary | Med — Patagonia, North Face, prAna | M | Already noted; not re-proposed |
| **B Lab Climate Justice Playbook signatories** | bcorporation.net (within B Lab climate site) | Subset of B Corps that have publicly committed to Climate Justice principles | ~700 signatories | HTML list | CC-BY (B Lab pubs) | Annual | Med (signal-strength weak — pledge only) | M | **SKIP** — pledge signal too soft; already a B Corp |

**Textiles bottom line:** Textile Exchange standards (RCS/GRS/RWS/RDS/RMS) bundled is the single biggest unlock — one source, 5+ apparel-relevant certifications. Fair Wear is the labor-side complement. Promote BCI (DW-57) into the build-now wave.

---

## 3. Electronics / Tech

| Source | URL | What it certifies | # entities | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **TCO Certified** | tcocertified.com/product-finder | Sustainability cert for IT products (laptops, monitors, datacenter, mobile, audio) | ~3,500 certified models × ~60 brands | HTML search + CSV download ("Product Finder Export") | CC-BY w/ attribution | Continuous | **High** — HP, Lenovo, Dell, Samsung, LG, Apple monitors | S | **PROPOSE — Tier S** |
| **ENERGY STAR Most Efficient** | energystar.gov/most_efficient | *Subset* of Energy Star for top-performing products (annual cohort) | ~3,000 models/yr across categories | CSV/JSON via same Energy Star Product Finder API | Public domain | Annual cohort | High — premium appliance/electronics aisle | S | **PROPOSE** (cron extension; ride on DW-11) |
| **Common Criteria (CCEVS / NIAP)** | niap-ccevs.org/Product (US scheme) + commoncriteriaportal.org (intl) | IT security evaluation per ISO/IEC 15408 (firewalls, OS, etc.) | ~2,500 certified products globally | HTML search + per-product PDF; no bulk | CC-BY (intl portal) | Continuous | Low at consumer level (enterprise IT) | L | **SKIP** — wrong audience |
| **FedRAMP Authorized vendor list** | marketplace.fedramp.gov | Cloud services authorized for US federal use | ~370 authorized offerings × ~250 vendors | JSON API (open) + CSV | Public domain | Low for consumer; med for B2B SaaS brands consumers know (Slack, Zoom, Dropbox, Adobe, Microsoft) | S | **PROPOSE — low priority, but quick win** |
| **IT-SCC certifications (Supply Chain Security)** | it-scc.org | Trade association — *not* a public certification dataset | n/a | None | — | Low | — | **SKIP** — not a public registry |
| **IEC 60601 medical electronics** | iec.ch/conformity-assessment | Medical device safety standard | ~tens of thousands | No public registry; certifying bodies (UL, TÜV, Intertek) hold their own lists | Proprietary | Low — B2B | XL | **SKIP** |
| **iFixit Repairability Score** | ifixit.com/Right-to-Repair/Repairability | Per-device teardown score 1-10 | ~600 devices (mostly flagship phones/laptops) | HTML scrape + per-device "smartphone-repairability" CSV (partial) | CC-BY-NC-SA 3.0 (per iFixit) | Continuous | High — Apple, Samsung, Google, Microsoft Surface, all major laptops | M | **SKIP for ingest** (CC-BY-NC blocks commercial use) — UX deep-link only |
| **Repair Association brand commitments / Right to Repair pledges** | repair.org/stand-up | Brands publicly supporting right-to-repair legislation | ~30 brands signed | HTML | CC-BY | Annual | Med — Patagonia, Framework, Fairphone | S | Optional — small footprint |
| **Fairphone / Framework / similar "ethical" electronics directories** | — | n/a — these are *brands*, not registries | — | — | — | — | — | n/a |

**Electronics bottom line:** **TCO Certified is the single highest-ROI electronics add** — clean CSV, ~3,500 models with brand + model #, perfect for scanner UPC-to-brand lookups in tech aisle. Energy Star Most Efficient piggy-backs on the DW-11 cron for trivial cost. FedRAMP is a small but easy win for consumer-recognized SaaS brands.

---

## 4. Automotive

| Source | URL | What it certifies | # entities | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **NHTSA 5-Star Safety Ratings (NCAP)** | nhtsa.gov/ratings + api.nhtsa.gov/SafetyRatings | Crash-test ratings per make/model/year | ~thousands of make×model×year rows | **JSON REST API (free, unlimited)** | Public domain | **High** — every car sold in US | S | **PROPOSE — Tier S** |
| **IIHS Top Safety Pick / Top Safety Pick+** | iihs.org/ratings (annual list also published as PDF/CSV) | Annual award list for top-rated vehicles | ~70 vehicles/yr | HTML + downloadable per-model PDFs; IIHS publishes the TSP+ list as CSV-ish HTML | Proprietary, factual annual list (citing TSP awards is industry-standard) | Annual | High | S | **PROPOSE — Tier S** |
| **EPA SmartWay Carrier list** | epa.gov/smartway/smartway-partner-list | Fuel-efficient freight carriers/shippers | ~3,800 partners (carriers + shippers) | Public CSV download | Public domain | Med — covers FedEx, UPS, Schneider, J.B. Hunt, Walmart logistics, Amazon Logistics partners | S | **PROPOSE** |
| **EPA Green Vehicle Guide / Fuel Economy data** | fueleconomy.gov/feg/download.shtml | Per-vehicle MPG, GHG score, smog score | ~40,000 vehicle records (1984+) | **Bulk CSV/XML (zip download), annually refreshed** | Public domain | High | S | **PROPOSE** |
| **EPA SmartWay Verified Tech list** | epa.gov/verified-diesel-tech | Diesel-emission-reduction technologies | ~200 verified tech, not brand-level | CSV | Public | Low (B2B) | S | Skip — narrow |
| **ZEV (Zero-Emission Vehicle) tax credit eligibility list** | fueleconomy.gov/feg/tax2023.shtml | IRS-eligible EVs for 30D/45W credits | ~80 models/yr | HTML + CSV | Public domain | High — Tesla, GM, Ford, Hyundai, Kia, Rivian, Lucid | S | **PROPOSE** (sub-set of fuel economy import) |
| **ZEV Alliance / state ZEV memoranda** | zevalliance.org | Government coalitions, not corporate certifications | — | — | — | — | — | n/a |

**Automotive bottom line:** Four clean Tier-S additions: **NHTSA 5-star (JSON API), IIHS TSP/TSP+ (annual), EPA SmartWay (CSV), EPA Green Vehicle Guide / Fuel Economy (bulk CSV including ZEV eligibility).** All public domain, free, US-relevant. Together they cover safety + emissions + freight at full coverage for every US-sold vehicle.

---

## 5. Food / Beverage

| Source | URL | What it certifies | # certified | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **Whole Grain Council Stamp** | wholegrainscouncil.org/find-whole-grains/whole-grain-product-finder | "Whole grain" content stamps (Basic, 50%+, 100%) | ~13,000 products × ~600 brands | HTML search; CSV listing published in industry reports | Proprietary, factual | High — Cheerios, Quaker, Nature Valley, Kashi, Annie's | M | **PROPOSE** |
| **AHA Heart-Check Food Certification** | recipes.heart.org/en/heart-check-foods/heart-check-mark-foods | American Heart Assoc nutrition cert | ~800 products | HTML directory (no bulk) | Proprietary, factual | High — Cheerios, Mott's, Welch's, V8, Quaker, Smucker's | M | **PROPOSE** |
| **USDA Process Verified Program (PVP)** | ams.usda.gov/services/auditing/process-verified-programs | USDA-audited claims (grass-fed, no antibiotics, sustainably raised, etc.) | ~120 approved suppliers (Tyson, Cargill, Hilmar, Smithfield divisions) | PDF list + ams.usda.gov searchable HTML | Public domain | Med — B2B-ish but some brands carry the seal | S | **PROPOSE** |
| **Animal Welfare Approved (A Greener World)** | agreenerworld.org/certifications/animal-welfare-approved/find-products | Pasture-raised, highest welfare tier | ~3,000 farms + product brands | HTML directory; CSV via member portal | Proprietary, factual | Med (premium tier — Whole Foods, FreshDirect) | M | Already BACKLOG DW-39 (Certified Humane + AWA) — promote to build-now |
| **MSC completeness check** (already in pipeline) | msc.org/track-a-fishery | — | — | — | — | — | — | **Verify** scope; should be product-SKU level already |
| **ASC** | (see product-registries doc — already proposed as DW-equiv) | — | — | — | — | — | — | n/a |
| **Bird-Friendly coffee (Smithsonian)** | nationalzoo.si.edu/migratory-birds/bird-friendly-coffee | Shade-grown, organic, bird-habitat-preserving coffee | ~50 brands × ~200 SKUs | HTML directory | Proprietary, factual | Med — Birds & Beans, Allegro, Caribou (small) | S | **NOTE: BACKLOG DW-59** — promote to build-now |
| **Salmon-Safe** | salmonsafe.org/find-certified-farms | West-coast watershed-friendly farming/wineries | ~700 farms/vineyards | HTML directory | Proprietary, factual | Low-Med (PNW-skewed) | M | Optional |
| **Certified Naturally Grown** | cngfarming.org/find-a-farmer | Peer-review alternative to USDA Organic for small farms | ~700 producers | HTML + JSON-LD per page | Proprietary, factual | Low — farmers-market scale | M | Skip — wrong scale for consumer-brand app |
| **Equitable Food Initiative (EFI)** | equitablefood.org/certified-farms | Worker-welfare-certified produce | ~50 farms × 30 retail brand partners | HTML | Proprietary, factual | Med — Costco Kirkland produce, Whole Foods, Trader Joe's | M | Optional |

**Food bottom line:** **Whole Grain Council + AHA Heart-Check** are the two clean adds (recognized seals, decent coverage). **USDA PVP** is a small but authoritative federal-backed signal. **Bird-Friendly coffee (DW-59) and AWA (DW-39 bundle)** are already waitlisted — promote both.

---

## 6. Housing / Construction

| Source | URL | What it certifies | # entities | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **LEED-certified buildings registry** | usgbc.org/projects | LEED-certified projects (buildings, communities) | ~200,000 projects | USGBC Project Directory: HTML search + paid API; small public CSV samples | Restrictive (USGBC trademarks LEED; redistribution limited) | High in aggregate, but **building-level data doesn't map to consumer brands** | L | **SKIP** — wrong granularity for consumer-brand app |
| **ENERGY STAR Certified Homes / Multifamily** | energystar.gov/newhomes | Certified new homes by builder | ~2.5M homes, ~6,000 builders | Builder directory (CSV via API) | Public domain | Med — only relevant if we score homebuilders (Lennar, D.R. Horton, KB Home, Pulte) | M | Optional — only if homebuilder brands are in scope |
| **Living Building Challenge (ILFI)** | living-future.org/lbc/certified-projects | Most rigorous green-building standard | ~150 projects | HTML | CC-BY | Low at consumer-brand level | M | Skip |
| **BREEAM** | breeam.com/projects | UK-origin green-building standard | ~600,000 projects globally | HTML + CSV (UK/EU heavy) | Restrictive | Low US | M | Skip |
| **Green Globes** | greenglobes.com/about-projects | US/Canada green-building alt to LEED | ~2,500 projects | HTML | Proprietary | Low at consumer-brand level | M | Skip |
| **DECLARE Label (ILFI)** | living-future.org/declare/declare-products | Building-product ingredient transparency labels | ~7,000 products × ~800 manufacturers | HTML + CSV via API access (free request) | CC-BY-SA 4.0 | Med — Mohawk, Interface, Shaw, Sherwin-Williams, Benjamin Moore subset | M | **PROPOSE** (most useful housing add) |
| **HPD (Health Product Declaration)** | hpd-collaborative.org/hpd-public-repository | Material health disclosures for building products | ~15,000 published HPDs | Repository (HTML, factual list) | CC-BY | Med — same audience as DECLARE | M | Optional (overlaps DECLARE) |

**Housing bottom line:** Almost all building-certification data is *project-level* (not consumer-brand-level) and license-restrictive. **DECLARE** is the one exception — it's at the manufacturer/product level (paints, flooring, finishes), CC-licensed, and includes consumer-recognizable brands (Sherwin-Williams, Benjamin Moore, Interface, Mohawk).

---

## 7. Toys / Kids

| Source | URL | What it certifies | # certified | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **ASTM F963 toy safety** | astm.org/f0963-23.html | Mandatory US toy-safety standard | n/a — *standard*, not registry | — | Proprietary (paywalled) | Universal but invisible (table-stakes) | XL | **SKIP** — no registry, table-stakes signal |
| **GREENGUARD Gold (UL Solutions)** | spot.ul.com (filter "GREENGUARD Gold") | Low-chemical-emissions cert (mattresses, furniture, toys, building products) | ~50,000 products × ~1,500 brands | HTML search; **NO bulk CSV** — paid UL SPOT data subscription required for bulk | Proprietary | High — Pottery Barn Kids, Crate & Kids, IKEA, Naturepedic, Avocado | XL (without paid sub) | **SKIP** — bulk access paywalled (echoes product-registries doc on GREENGUARD) |
| **CPSC product recalls** (already in pipeline) | cpsc.gov | — | — | — | — | — | — | Already cron'd |
| **PIRG "Trouble in Toyland"** | pirg.org/edfund/articles/trouble-in-toyland | Annual unsafe-toy report (named brands/products) | ~30-50 named/year | HTML + annual PDF | Proprietary, fair-use | Med — viral around holidays | M | Optional |
| **NRDC / EWG / HealthyStuff.org consumer chemical lists** | various | Chemical-of-concern lists | varies | mixed | mixed | — | varies | Out of scope here |
| **GoodGuide (defunct)** | — | — | — | — | — | — | — | Defunct |
| **Made Safe** | (covered in §1 Beauty) | Cross-categorizes baby/kids products too | — | — | — | High | M | Already proposed in §1 |

**Toys bottom line:** **GREENGUARD Gold would be huge** (most-recognized low-emissions seal) but bulk access is paywalled — SKIP unless UL SPOT subscription is in budget. Made Safe (§1) covers a lot of the same baby/kids brands at no license cost — propose Made Safe and treat as the practical substitute.

---

## 8. Pharma / Health / Supplements

| Source | URL | What it certifies | # certified | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **USP Verified Dietary Supplements** | quality-supplements.org/verified-products | USP-tested supplements | ~250 verified products × ~30 brands | HTML directory (no bulk) | Proprietary, factual | High — Nature Made, Kirkland Signature, GNC subset, Equate, Berkley Jensen | S | **PROPOSE — Tier S** |
| **NSF Certified for Sport** | nsfsport.com/certified-products | Banned-substance-free supplements for athletes | ~3,000 products × ~150 brands | HTML search + searchable JSON endpoint (semi-public) | Proprietary, factual | High — Klean, Thorne, Garden of Life, Gatorade, BodyArmor | S | **PROPOSE — Tier S** |
| **NSF/ANSI 173 Dietary Supplement Certification** | nsf.org (broader than Sport) | Verified label-claim accuracy + contaminant testing | ~1,000 products | HTML "NSF Listing — Dietary Supplements" page | Proprietary, factual | Med — overlap w/ NSF Sport | S | **PROPOSE** (bundle with Sport) |
| **ConsumerLab independent testing** | consumerlab.com | Per-product passes/fails | ~5,000 tested products | **Paid subscription only** (~$50/yr) — no API | Proprietary, paywalled | High — single best supplement audit | XL | **SKIP** — paywall |
| **BSCG (Banned Substances Control Group) Certified Drug Free** | bscg.org/certified-drug-free | Drug-free certification for supplements | ~1,000 products × ~40 brands | HTML directory | Proprietary, factual | Med | M | Optional (overlaps NSF Sport) |
| **Informed Sport / Informed Choice** | informed-sport.com/find-product | Banned-substance certification (UK origin, US adopted) | ~25,000 products × ~400 brands | HTML search + CSV (registration required, free) | CC-BY w/ attribution | High — Optimum Nutrition, BSN, Cellucor, Dymatize, MyProtein | S | **PROPOSE — Tier S** |
| **FDAAA TrialsTracker (Bristol)** | fdaaa.trialstracker.net | Tracks reporting compliance for FDAAA-required clinical trials | ~5,000 sponsors (incl. Pfizer, Merck, J&J, Novartis, AbbVie) | **JSON/CSV download (Apache 2.0)** | Apache 2.0 | High — every big pharma + every academic medical center | S | **PROPOSE — Tier S** |
| **FDA OpenFDA Recalls (drug/device)** | already covered in product-registries doc | — | — | — | — | — | — | Already discussed |
| **Pharmacy Quality Alliance star ratings** | pqaalliance.org | Medicare Part D pharmacy quality | n/a (pharmacy-level, not product) | — | — | Low | — | Skip |
| **GMP certifications (cGMP audits)** | fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-references | FDA inspection-pass status | n/a — facilities, not brands | — | — | — | — | Out of scope (similar to existing FDA warning letters) |

**Pharma bottom line:** **5 clean wins** — USP Verified, NSF Certified for Sport, NSF 173 (dietary supplement general), Informed Sport, FDAAA TrialsTracker. Combined they cover ~30,000 supplement SKUs + clinical-trial compliance for every major pharma maker. ConsumerLab is the most authoritative but paywalled.

---

## 9. Financial / Responsible Business Cross-Cutting

| Source | URL | What it certifies | # entities | Access | License | US relevance | Difficulty | Recommend |
|---|---|---|---|---|---|---|---|---|
| **Just Capital Rankings** (already partial) | justcapital.com | Annual Top-100 / sector rankings | 940 cos ranked annually | CSV/JSON via Just API + bulk dataset on download page | CC-BY 4.0 | High | S | **VERIFY completeness** — we have partial; may need refresh |
| **Glassdoor Best Places to Work** | glassdoor.com/Award/Best-Places-to-Work-LST_KQ0,25.htm | Annual top-100 list by employee size band | ~150 cos/yr | HTML scrape only (no public API); ToS limits | Restrictive (Glassdoor ToS prohibits) | High — but **license-blocked** | XL | **SKIP** — same blocker as B-10/scraper note in BACKLOG |
| **Fortune Best Companies to Work For (Great Place To Work)** | greatplacetowork.com/best-workplaces | Annual lists (various categories) by GPTW survey | ~1,000 cos/yr across categories | HTML scrape; per-list PDFs | Proprietary, factual lists (citing rankings is fair use) | High | M | **PROPOSE** — single biggest legit alt to Glassdoor |
| **Forbes Best Employers for Diversity / Women / Veterans** | forbes.com/lists | Annual lists | ~500 cos/yr × multiple lists | HTML scrape | Proprietary, factual | High | M | Optional — overlap w/ HRC CEI + WBA Gender |
| **B Lab annual transparency reports** | bcorporation.net/standards (Annual Reports section) | B Lab's own annual governance, certification stats per-region | n/a (org-level B Lab transparency, not company-level) | PDF | CC-BY | n/a — *about B Lab*, not about brands | — | Skip — not a brand dataset |
| **Disability:IN DEI Index (DW-13)** | already BACKLOG | — | — | — | — | — | — | Already waitlisted (DW-13) |
| **DJSI / S&P Global CSA** | spglobal.com/esg/csa/csa-resources | ESG self-assessment scores | ~3,500 companies | **Paywalled** | Proprietary | High | XL | **SKIP** — paywall |
| **MSCI ESG ratings** | msci.com/our-solutions/esg-investing/esg-ratings-climate-search-tool | Public letter grades only (AAA-CCC) | ~2,900 cos | HTML search (no bulk public access) | Restrictive | High | XL | **SKIP** — bulk paywall, ToS blocks scrape |
| **Sustainalytics ESG Risk Ratings** | sustainalytics.com | ESG risk scores | ~16,000 cos | Public summary page only (free 5 lookups/day); bulk paywalled | Restrictive | High | XL | **SKIP** |
| **Refinitiv ESG / LSEG ESG** | lseg.com/en/data-analytics/sustainable-finance | ESG scores | ~16,000 cos | Paywalled | Restrictive | High | XL | **SKIP** |
| **ISS ESG Corporate Rating** | issgovernance.com | ESG ratings | ~9,000 cos | Paywalled | Restrictive | High | XL | **SKIP** |

**Cross-cutting bottom line:** The major paid-ESG-rating ecosystem (MSCI, Sustainalytics, ISS, S&P/DJSI, Refinitiv) is uniformly paywalled and ToS-blocked — skip uniformly. **Great Place To Work** (Fortune list backer) is the cleanest legit alternative to Glassdoor for "good employer" signal. **Just Capital** completeness should be verified — likely a 1-day refresh, not a new source.

---

## TOP 15 ranked by ROI (US relevance × ease × freshness)

| Rank | Source | Category | Effort | Why it wins |
|---|---|---|---|---|
| **1** | **NHTSA 5-Star Safety Ratings (NCAP)** | Auto | S | Free JSON API, public domain, every US-sold car. Closes auto-safety gap not covered by recalls cron. |
| **2** | **TCO Certified Product Finder** | Electronics | S | CSV export, ~3,500 models × 60 brands, free. Single biggest tech-aisle cert. |
| **3** | **EPA Green Vehicle Guide / Fuel Economy bulk** | Auto | S | Bulk CSV, 40k vehicles incl. ZEV eligibility, public domain. |
| **4** | **IIHS Top Safety Pick + TSP+ annual list** | Auto | S | Annual award list, ~70 vehicles/yr, well-defined fair-use. |
| **5** | **NSF Certified for Sport** | Pharma/Supplements | S | Well-recognized, factual directory, ~3,000 products. |
| **6** | **USP Verified Dietary Supplements** | Pharma/Supplements | S | Gold-standard supplement audit, ~250 products × 30 brands. |
| **7** | **Informed Sport (banned-substance cert)** | Pharma/Supplements | S | ~25,000 products, free CSV w/ registration. Largest supplement cert dataset. |
| **8** | **FDAAA TrialsTracker (Bristol)** | Pharma | S | Apache-2.0 JSON, names every pharma sponsor + reporting compliance. |
| **9** | **EPA SmartWay Carrier list** | Auto/Logistics | S | Public CSV, ~3,800 carriers/shippers, all major US freight names. |
| **10** | **Textile Exchange standards bundle (RCS/GRS/RWS/RDS/RMS)** | Apparel | M | One source → 5 apparel certifications, CC-BY annual reports. |
| **11** | **Whole Grain Council Stamp directory** | Food | M | ~13,000 products × 600 brands, household-name cert. |
| **12** | **Great Place To Work / Fortune Best Companies** | Cross | M | Best legit alternative to license-blocked Glassdoor. |
| **13** | **DECLARE Label (ILFI)** | Construction | M | Only Housing-vertical add with consumer-brand granularity + CC license. |
| **14** | **MADE SAFE** | Beauty/Baby | M | 250 brands, factual scrape OK, fills baby + non-toxic personal care gap. |
| **15** | **AHA Heart-Check Food Certification** | Food | M | High consumer recognition, ~800 products. |

---

## TOP 8 to integrate next sprint (proposed DW-91 → DW-98)

Pre-launch (June 23) priority. All Tier-S (S effort, clean license, US-high coverage):

| Proposed ID | Source | Effort | Coverage | Why first |
|---|---|---|---|---|
| **DW-91** | NHTSA 5-Star Safety Ratings (NCAP) | S (~4 hr) | All US-sold vehicles | Fills auto-safety gap; cron sibling to existing NHTSA recalls. |
| **DW-92** | TCO Certified Product Finder (CSV) | S (~4 hr) | ~3,500 IT products × ~60 brands | Biggest electronics-cert unlock; no peer dataset. |
| **DW-93** | EPA Green Vehicle Guide + ZEV eligibility (bulk CSV) | S (~3 hr) | 40k vehicles | Public domain, complements NHTSA. |
| **DW-94** | IIHS Top Safety Pick + TSP+ annual list | S (~3 hr) | ~70 vehicles/yr | Tight scope, annual cron. |
| **DW-95** | NSF Certified for Sport + NSF 173 + USP Verified Supplements (bundle) | S-M (~6 hr) | ~6,000 products × ~200 brands | Three supplement certs, one sprint, same access pattern. |
| **DW-96** | FDAAA TrialsTracker (Bristol) | S (~3 hr) | ~5,000 pharma sponsors | Apache-2.0 JSON, fastest possible integration. |
| **DW-97** | EPA SmartWay Carrier list | S (~2 hr) | ~3,800 carriers/shippers | Tiny CSV, public domain. |
| **DW-98** | Textile Exchange standards bundle (RCS / GRS / RWS / RDS / RMS) | M (~8 hr) | ~9,000 facilities + annual brand-licensee lists | Five certifications, one TE annual-report ingest. |

**Total est. effort:** ~33 hours / ~3 days of agent compute. **Adds:** ~70,000 cert-flag records across Auto, Electronics, Supplements, Apparel, Logistics, Pharma trials.

**Plus promote existing BACKLOG items to build-now:**
- **DW-57** Better Cotton Initiative members (S, ~2,800 members)
- **DW-59** Bird-Friendly Smithsonian coffee (S, ~50 brands)
- **DW-39** Animal Welfare Approved (bundle with existing Certified Humane plan)

---

## SKIP LIST (with reasons)

| Source | Reason |
|---|---|
| **EWG Verified for beauty** | Same non-commercial ToS as Skin Deep — deep-link UX only |
| **EWG Skin Deep DB** | Already DW-36; product-registries doc recommends downgrade — non-commercial license |
| **IFRA Standards** | No brand-level data; ingredient-level only and behind redistribution restrictions |
| **CIR (Cosmetic Ingredient Review)** | Ingredient-level only; no brand mapping |
| **NSF/ANSI 305 (organic personal care)** | Low US adoption; most beauty brands prefer COSMOS or USDA Organic |
| **Common Criteria / NIAP** | B2B/government IT only, not consumer-recognizable brands |
| **IEC 60601 medical electronics** | No public registry; B2B-only |
| **iFixit Repairability Score** | CC-BY-NC-SA license blocks commercial ingest |
| **LEED registry** | Project-level (not brand-level); USGBC ToS restricts redistribution |
| **BREEAM / Green Globes / Living Building Challenge** | Project-level; no consumer-brand mapping |
| **ASTM F963 toy safety** | Mandatory standard with no public registry |
| **GREENGUARD Gold** | Bulk access paywalled (UL SPOT subscription) |
| **ConsumerLab** | Paywalled ($50/yr subscription) |
| **MSCI / Sustainalytics / ISS / Refinitiv / S&P DJSI** | Uniformly paywalled + ToS blocks scrape |
| **Glassdoor Best Places to Work** | Already documented as license-blocked (B-10) |
| **Forbes Best Employers lists** | Mostly overlap HRC CEI + Just Capital + GPTW; lower priority than GPTW |
| **Made in Green by OEKO-TEX** | 14-digit per-product label IDs, no bulk dump — impractical |
| **Pharmacy Quality Alliance star ratings** | Pharmacy-level, not product/brand-level |
| **Certified Naturally Grown** | Farmers-market scale; wrong granularity |
| **Salmon-Safe** | PNW-skewed; low national coverage |
| **GoodGuide** | Defunct |
| **CDC NIOSH Skin Notation** | Ingredient-level; chemical hazard, not brand cert |
| **EPA Verified Diesel Tech** | Component-level, B2B |
| **Climate Justice Playbook signatories** | Pledge-only, soft signal; already B Corp |

---

## LICENSE-RISK SUMMARY for proposed adds

| Source | License | Commercial use OK? | Notes |
|---|---|---|---|
| NHTSA / EPA / FDAAA / EPA SmartWay / EPA Green Vehicle | Public domain | YES | Federal works; redistribute freely |
| TCO Certified | CC-BY (attribution required) | YES | Cite source per record |
| Textile Exchange annual reports | CC-BY | YES | Cite |
| Informed Sport | CC-BY w/ attribution | YES | Free registration required for CSV; cite source |
| NSF Sport / USP Verified | Proprietary, **factual directories** | YES (factual data) | Don't reproduce verbatim certification logos; we cite the certification status as fact |
| Whole Grain Council / AHA Heart-Check | Proprietary, factual | YES (factual data) | Same pattern as above; cite source |
| Great Place To Work / Fortune lists | Proprietary, **factual rankings** | YES (citing ranking is fair use) | Same pattern as the "fortune 500 list" precedent |
| MADE SAFE | Proprietary, factual | YES (factual) | Cite source per record |
| IIHS TSP/TSP+ | Proprietary, factual annual list | YES (citing awards is industry standard) | Cite source per record |
| DECLARE Label | CC-BY-SA 4.0 | **YES — but SHARE-ALIKE**; must publish derived data under CC-BY-SA | Acceptable for `public/data/declare.json` if attributed + share-alike noted |

**Compliance pattern across all proposed adds:** treat each record as factual (e.g., "Tesla Model Y is IIHS TSP+ 2024" or "Nature Made Multivitamin is USP Verified"). Cite source URL on every record. No logo reproduction. Same legal pattern TruNorth already uses for HRC CEI, B Corp, and other "factual cert directory" sources.

---

## Sources used in this report

- Made Safe — madesafe.org/products
- COSMOS-standard — cosmos-standard.org/certified-products
- CertClean — certclean.com
- Skin Cancer Foundation Seal — skincancer.org/product-finder
- Haereticus Lab Protect Land + Sea — haereticus-lab.org
- Hawaii SB 2571 sunscreen law — capitol.hawaii.gov
- IFRA Standards Library — ifrafragrance.org/safe-use/standards-library
- Textile Exchange standards — textileexchange.org/standards
- Better Cotton Initiative — bettercotton.org/who-we-are/find-members
- Fair Wear Foundation — fairwear.org/brands
- TCO Certified — tcocertified.com/product-finder
- ENERGY STAR Most Efficient — energystar.gov/most_efficient
- FedRAMP Marketplace — marketplace.fedramp.gov
- NHTSA NCAP API — api.nhtsa.gov/SafetyRatings
- IIHS Top Safety Pick — iihs.org/ratings
- EPA SmartWay Partners — epa.gov/smartway/smartway-partner-list
- EPA Green Vehicle Guide / fueleconomy.gov — fueleconomy.gov/feg/download.shtml
- Whole Grain Council — wholegrainscouncil.org/find-whole-grains
- AHA Heart-Check — recipes.heart.org/en/heart-check-foods
- USDA AMS Process Verified — ams.usda.gov/services/auditing/process-verified-programs
- Animal Welfare Approved (AGW) — agreenerworld.org/certifications/animal-welfare-approved
- Bird-Friendly coffee — nationalzoo.si.edu/migratory-birds/bird-friendly-coffee
- ILFI DECLARE — living-future.org/declare/declare-products
- HPD Collaborative — hpd-collaborative.org/hpd-public-repository
- PIRG Trouble in Toyland — pirg.org/edfund/articles/trouble-in-toyland
- USP Verified — quality-supplements.org/verified-products
- NSF Certified for Sport — nsfsport.com/certified-products
- NSF Dietary Supplement (NSF/ANSI 173) — nsf.org
- BSCG Certified Drug Free — bscg.org/certified-drug-free
- Informed Sport — informed-sport.com/find-product
- FDAAA TrialsTracker — fdaaa.trialstracker.net
- ConsumerLab — consumerlab.com
- Just Capital — justcapital.com
- Great Place To Work — greatplacetowork.com/best-workplaces
- USGBC LEED projects — usgbc.org/projects
- ENERGY STAR Certified Homes — energystar.gov/newhomes
- UL SPOT / GREENGUARD — spot.ul.com

**Word count: ~3,900.** Within cap.
