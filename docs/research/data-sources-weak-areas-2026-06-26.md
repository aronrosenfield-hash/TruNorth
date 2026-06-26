# Data-source expansion — weak-area research (2026-06-26)

Synthesis of 10 parallel research agents targeting TruNorth's **data-weak categories**
(animals 16%, execPay 23%, privacy 35% coverage) + values gaps. Every endpoint was
live-verified by the agents. **Paid-app license rule applies:** US/state government public
records (CC0 / public domain) only, unless a third party grants commercial reuse.

> Companion to `data-sources-expansion-2026-06-22.md` (B-65). Build order below.

---

## ⚠️ LICENSE EXCLUSIONS — do NOT ship in the paid app (confirmed NC / proprietary)

| Source | License | Notes |
|---|---|---|
| **Good Jobs First — Violation Tracker + Subsidy Tracker** | internal-use-only / paywalled / © | ⚠️ **LIVE RISK: `violationTracker` is currently DISPLAYED** in the reveal ("Federal Penalties"). Re-source from gov primaries (OSHA/EPA/DOJ/state) or pull it. |
| OpenSecrets / CRP / FollowTheMoney | CC-BY-NC-SA | Revolving-door also Columbia Books–restricted |
| AFL-CIO Executive Paywatch | non-commercial | re-derive from SEC proxies |
| As You Sow (scorecards, Overpaid-CEOs) | all-rights-reserved / NC | currently in `enriched.asYouSow` — **pulled from UI** |
| CPA-Zicklin Index | unconfirmed (third-party) | in `enriched.cpaZicklin` — **pulled from UI** pending license |
| Newsweek/Statista Most Responsible | © Statista | in `enriched.newsweekMrc` — **pulled from UI** |
| KFF opioid tracker | CC-BY-NC-ND | use official administrator instead |
| KnowTheChain · Fashion Revolution · BBFAW · LobbyMap/InfluenceMap · LittleSis | NC / proprietary | partnership/paid only |
| ProPublica Nonprofit Explorer | gray (no resale) | use for discovery; source production from IRS bulk |

---

## TIER 1 — build first (US public-domain, S/M effort, high brand-match)

| # | Source | Endpoint | Effort | Area / signal |
|---|---|---|---|---|
| 1 | **openFDA enforcement** (food+drug+device recalls) | `api.fda.gov/{food,drug,device}/enforcement.json` (CC0) | S | product safety + pharma · `recalling_firm` |
| 2 | **NHTSA recalls** | `api.nhtsa.gov/recalls/recallsByVehicle` | S | product safety (autos) |
| 3 | **SEC EDGAR XBRL tax** (effective rate, 3,961 cos) | `data.sec.gov/api/xbrl/frames/us-gaap/EffectiveIncomeTaxRateContinuingOperations/pure/CY2023.json` | S/M | tax — broadens ITEP to thousands |
| 4 | **USAspending** federal contracts/grants | `api.usaspending.gov/api/v2/search/spending_by_award/` (CC0) | M | taxpayer-dependence |
| 5 | **SEC Form SD** conflict minerals (1,864 filers, CIK-keyed) | `efts.sec.gov/LATEST/search-index?q=%22conflict%20minerals%22&forms=SD` | M | supply chain |
| 6 | **DHS UFLPA Entity List** (forced-labor import ban) | `dhs.gov/uflpa-entity-list` + `federalregister.gov/api/v1` | M | supply chain |
| 7 | **CMS Open Payments** (pharma→physician $) | `openpaymentsdata.cms.gov/api/1/datastore/query/{id}/0` | M | pharma conflict-of-interest |
| 8 | **HHS-OIG LEIE + CIA** (exclusions) | `oig.hhs.gov/exclusions/downloadables/UPDATED.csv` | S/M | pharma "got caught" |
| 9 | **DOL WHISARD** wage/hour bulk (back wages, CMPs) | data.gov "Wage and Hour Compliance Action Data" CSV | S | labor (verify vs existing WHD) |
| 10 | **NLRB** ULP + election cases | `github.com/labordata/nlrb-data` (MIT/PD, nightly SQLite) | S | union-busting |
| 11 | **State WARN** layoffs | Socrata e.g. `data.texas.gov/resource/8w53-c4f6.json` | S/state | NEW signal: mass layoffs |
| 12 | **Vegan Action / Certified Vegan** | `vegan.org/certification/companies-using-our-logo` | S | animals (cruelty-free) |
| 13 | **EPA ECHO CAFO** (animal-ag enforcement) | `echodata.epa.gov/echo/cwa_rest_services.get_facility_info?p_sic=0211…` | M | factory farming (penalties) |
| 14 | **National Opioid Settlement** (~12 named cos) | `nationalopioidofficialsettlement.com` | S | pharma (curate) |

## TIER 2 — high value, heavier lift

| Source | Endpoint | Effort | Area |
|---|---|---|---|
| **SEC pay-ratio iXBRL** (DEF 14A Item 402(u)) | parse DEF 14A R-files via `efts.sec.gov` | L | **fixes execPay 23% gap** (CEO-worker ratio) |
| **SEC 8-K 5.07** say-on-pay vote % | `efts.sec.gov ?q="say-on-pay"&forms=8-K` | M | execPay governance |
| **ClinicalTrials.gov** results-reporting compliance | `clinicaltrials.gov/api/v2/studies` | M | pharma transparency |
| **DOJ FCA settlements** | `justice.gov/news/rss?type=press_release` + NER | M/L | pharma/conduct |
| **CBP WRO/Findings** (forced labor) | `cbp.gov/.../withhold-release-orders-and-findings` | M | supply chain |
| **USDA FSIS recalls** + **MPI crosswalk** (CC0) | `fsis.usda.gov/fsis/api/recall/v/1` (Akamai — needs UA) + data.gov MPI CSV | M | product safety / animals |
| **IRS 990 bulk** (trade-assoc / 501c4 dark money) | `apps.irs.gov/pub/epostcard/990/xml/` | L | lobbying — biggest missing layer |
| **FARA eFile V1 API** (upgrade existing) | `efile.fara.gov/api` | S | lobbying (CSV→JSON) |
| **SEC Exhibit 21** offshore-haven subsidiaries | EDGAR filing parse | L | tax |
| **NY + state subsidy portals** (Socrata) | `data.ny.gov/resource/26ei-n4eb.json` | S/state | tax/subsidies |
| **Certified Humane** | `certifiedhumane.org` | M | animals (farm welfare) |

## Privacy (35% weak) — Tier-1 additions (all government, license-clean)
- **CPPA Data Broker Registry** ⭐ `cppa.ca.gov/data_broker_registry/registry.csv` — CA gov, 77 cols incl. per-broker booleans (collects biometric / precise-geolocation / minors' data; sold-to-law-enforcement / foreign-actor / GenAI-developer). **TOP privacy pick** · S effort.
- **WA AG breach** (Socrata) `data.wa.gov/resource/sb4j-ca4h.json` — 1,596 breaches, structured cause/cyberattack-type/affected · S.
- **CA AG breach** `oag.ca.gov/privacy/databreach/list-export` — ~5,100-row bulk CSV · S.
- **TX AG releases** `texasattorneygeneral.gov/news/releases` — named privacy enforcement (Meta $1.4B biometric, GM/Allstate location-data) · M.
- **FTC location-data 5 cases** (Kochava, X-Mode, InMarket, Mobilewalla, Gravy/Venntel) — curate, public domain · S.
- Defer **FTC Legal Library** (Akamai-blocked, backlog E-3/B-29; cover marquee cases via TX AG + the 5 above). Leads-only (no commercial license): IL BIPA tracker (S.T.O.P.), Apple privacy-labels (MIT but stale 2022).
- Already have: HIBP, CISA KEV, NVD, OSV, GitHub Advisories, FTC 6(b), CPPA-enforcement + HHS-OCR (fixtures).

## Notes
- **Dups already in repo:** Senate LD2 lobbying, FARA (upgrade), state-lobbying-r5, FEC, OSHA,
  NLRB (verify), CPSC, HIBP, IRS990 (charity), FDIC, fsis-dw recalls, USDA APHIS, Forest500,
  Better Cotton, Fair Trade.
- **execPay technical fix:** the `ecd:`/pay-ratio XBRL is NOT in the SEC frames JSON API — must
  parse the DEF 14A inline-XBRL R-files. This is why `payRatio` is null on most companies.
