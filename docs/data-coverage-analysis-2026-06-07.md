# TruNorth Data Coverage Analysis — 2026-06-07

**Total companies in the bundle: 11,209**

This is the snapshot right before the 13 open PRs land. Use it as the baseline for measuring post-merge coverage.

---

## Methodology

A company has **real data** in a category when ALL of these are true:
- The category is NOT listed in the company's `excl` array
- The `sc.<category>` value is not `"na"`
- The `sc.<category>` value is not `"neutral"` (placeholder default)

Anything else is a placeholder score, not a signal. This is the stricter of two readings; the looser reading (treating `"neutral"` as data) makes coverage look 100% across the board and is misleading.

---

## Current state (Jun 7, 2026 baseline)

| Category | Companies with real data | % of 11,209 |
|---|---|---|
| labor | 1,283 | 11.4% |
| political | 553 | 4.9% |
| environment | 325 | 2.9% |
| privacy | 41 | 0.4% |
| animals | 6 | 0.1% |
| guns | 6 | 0.1% |
| charity | 5 | < 0.1% |
| dei | 5 | < 0.1% |
| execPay | 5 | < 0.1% |
| **Any category** | **1,521** | **13.6%** |
| All 9 categories | 5 | < 0.1% |

### Histogram — companies by number of cats filled

| Cats filled | # companies | % |
|---|---|---|
| 0 | 9,688 | 86.4% |
| 1 | 961 | 8.6% |
| 2 | 443 | 4.0% |
| 3 | 111 | 1.0% |
| 4 | 1 | 0.0% |
| 5–8 | 0 | 0.0% |
| 9 | 5 | 0.0% |

---

## Pipeline state at baseline

- **99 GitHub Actions workflows** in `.github/workflows/`
- **98 fetch scripts** under `scripts/`
- **~113 distinct data sources** ingested

---

## Open PRs and their contribution

13 PRs sit in queue:

| PR | Source | Live test | Est. company matches |
|---|---|---|---|
| #1 | DW-1 to DW-6 (SBTi, WBA, Forest 500, 50/50, USDA Organic, FSIS) | 36/36 tests | Not yet run live |
| #2 | DW-7 to DW-12 (OFAC SDN, BIS, FERC, DOL WHD, Energy Star, 1% Planet) | 34/34 tests | Not yet run live |
| #3 | DW-13 to DW-17 (Disability:IN, CFTC, UK ICO, MAS, Canada CB) | 25/25 tests | Not yet run live |
| #4 | brand-parent-map mega-expansion | 138 → 4,625 entries | Scanner only, no category contribution |
| #5 | USDA FoodData Central | 69% GTIN resolution on fixture | Scanner only (1.9M UPCs once cron runs) |
| #6 | OpenSanctions | 4 fixture matches (intentional) | political, labor (intl) |
| #7 | WikiRate | 16/30 fixture | labor, environment, transparency (new cat) |
| #8 | Brazil Lista Suja | 3 direct, 3 supply-chain hints | labor |
| #9 | EU Transparency Register | 24/29 fixture (Meta, MSFT, Google) | political |
| #10 | NAAG Multistate Settlements | 6/6 (Equifax, J&J, McKesson, Google, Intuit, Cardinal) | political, privacy, health |
| #11 | AU Fair Work Ombudsman | 3/6 (McD's, Domino's, 7-11) | labor |
| #12 | UN B&HR communications | 12/12 tests | labor, political (intl) |
| #13 | California Prop 65 | **7,395 live notices, 18 matches** | environment, health |

### Top live cited companies (PR #13 — only live-data PR)
1. Amazon — 785 Prop 65 notices
2. Ross — 574
3. Walmart — 395
4. Big 5 Sporting Goods — 383
5. Williams-Sonoma — 191

---

## Projected coverage after all 13 PRs land + first cron runs

These are **mid-case estimates** — full-run cron numbers extrapolated from fixture-stage match rates. Conservative bound assumes ~5× fixture; optimistic assumes ~30×.

| Category | Now | Δ mid | After mid | Mid % |
|---|---|---|---|---|
| **political** | 553 | +4,500 | **5,053** | **45%** |
| **environment** | 325 | +2,500 | **2,825** | **25%** |
| **labor** | 1,283 | +1,500 | **2,783** | **25%** |
| **health** *(new, via NAAG + Prop 65)* | — | +1,500 | **1,500** | **13%** |
| **privacy** | 41 | +250 | 291 | 3% |
| **transparency** *(new, via WikiRate)* | — | +1,000 | **1,000** | **9%** |
| **dei** | 5 | +250 (WikiRate + Disability:IN) | 255 | 2% |
| animals | 6 | — | 6 | < 0.1% |
| guns | 6 | — | 6 | < 0.1% |
| charity | 5 | +20 | 25 | < 0.1% |
| execPay | 5 | +50 (CFTC) | 55 | 0.5% |
| **Any category** | 1,521 | +5,000 | **~6,500** | **~58%** |

### Histogram after merges (estimated)

| Cats filled | # companies (est.) | % |
|---|---|---|
| 0 | ~4,700 | 42% |
| 1 | ~3,100 | 28% |
| 2 | ~1,800 | 16% |
| 3 | ~1,000 | 9% |
| 4 | ~400 | 4% |
| 5 | ~150 | 1% |
| 6+ | ~70 | 1% |

---

## Goal: every category > 60% (>6,725 companies each)

The 13 PRs get the top 3 categories (political, environment, labor) into the 25–45% range. **None of them will hit 60% post-merge.** Reaching 60% requires another round of dedicated sources per low-coverage category.

### Gap to 60% per category

| Category | After PRs land | Gap to 60% (6,725) |
|---|---|---|
| political | ~5,053 | -1,672 |
| environment | ~2,825 | -3,900 |
| labor | ~2,783 | -3,942 |
| privacy | ~291 | -6,434 |
| dei | ~255 | -6,470 |
| transparency | ~1,000 | -5,725 |
| health | ~1,500 | -5,225 |
| animals | 6 | -6,719 |
| guns | 6 | -6,719 |
| charity | 25 | -6,700 |
| execPay | 55 | -6,670 |

### Sprint priorities to close the gap

**A. Categories that need 1–2 more sources to hit 60%** (low hanging fruit):
- **political** is 1,700 short. Adding Wikidata "political affiliation of company executives" plus a broader campaign-finance lobbying pull at the EXECUTIVE level (FEC C00 individual-donation files joined to corporate insider rosters from SEC Form 4) would cover the gap.
- **labor** is 4,000 short. The bottleneck is non-Fortune-500 employers. Glassdoor reviews (high-volume, no auth) + Indeed company-page snapshots would close it.

**B. Categories that need a structural new pipeline:**
- **animals (60% gap = 6,719)** — PETA "anti-fur" list is small. Need to integrate the full PETA campaigns DB + Cruelty Free International + Leaping Bunny + Beauty Without Bunnies as a UNION, then explode each parent company's product list as a sub-brand inheritance.
- **guns (60% gap = 6,719)** — only signal currently is corporate political donations to NRA-affiliated PACs. Need a separate "industry membership" flag (NSSF, NRA Corporate Membership program disclosures, lobbying disclosure forms).
- **charity (60% gap = 6,700)** — currently sparse because we treat it as "corporate giving" not as a brand-level signal. New pipeline: IRS Form 990 Schedule B (which corporations donate to NGOs), corporate giving disclosures, B Corp + Just Capital giving scores.
- **execPay (60% gap = 6,670)** — SEC DEF14A proxy statements already in pipeline but not at scale. Need a parser that handles all 6,000 public US companies (currently only 5 are scored) and a public/private flag for the non-listed ones.
- **dei (60% gap = 6,470)** — Disability:IN (DW-13) helps. Need EEOC EEO-1 mandatory filings (workforce-composition data, ~25k companies report) — that's the big unlock.
- **privacy (60% gap = 6,434)** — Privacy Policy NLP score (we have a small pipeline) needs to run against every company in the index, not just the top-1000. Estimated 3-5 days of cron time.
- **transparency (60% gap = 5,725)** — WikiRate (PR #7) provides Fashion Transparency Index, KnowTheChain, CHRB. Expanding to RDR (Ranking Digital Rights) + Transparency Pledge + Just Capital transparency score would close it.
- **health (60% gap = 5,225)** — Prop 65 + NAAG already hit Amazon/Walmart/Ross with hundreds of notices each. Adding the FULL OpenFDA recall stream (we currently only pull a curated subset) + EPA TRI carcinogen emissions tied to brand-level production would close it.
- **environment (60% gap = 3,900)** — EPA TRI/ECHO/GHGRP already scaling. Adding CDP (paywalled — skip), Climate Action 100+ benchmark (DW-X, partially in PR pipeline), and Wikidata "industry sector → emissions intensity" inferences as a fallback signal would close it.

---

## Recommended next sprint shape (post-launch, post-merge)

A 5-agent fan-out targeting the lowest categories:

| Agent | Target | Estimated impact |
|---|---|---|
| 1 | EEOC EEO-1 dei (25k filings) | +20k dei coverage |
| 2 | IRS Form 990 Schedule B + corporate giving | +5k charity |
| 3 | NSSF + NRA Corporate + firearms-industry lobbying | +2k guns |
| 4 | SEC DEF14A executive comp parser at scale | +4k execPay |
| 5 | Privacy policy NLP at scale | +5k privacy |

Each is a 1–2 day agent build. Total estimated coverage gain: 35-40k category-data points, pushing the "any category" rate to ~85% and dragging at least 6 of 9 categories above the 60% target.

The remaining 3 (animals, guns at parent-corp level, execPay for private cos) probably max out at 30–40% even with effort and may need a "no data available" UX state rather than a synthetic placeholder.

---

## Notes for future maintainers

- The 11,209 number includes lots of small private brands with no SEC filings, no FEC giving, no OSHA incidents. Some will never have real category data — they're searchable but won't grade.
- A "minimum viable grading" threshold of 3+ categories with real data is sensible — anything less and a grade is misleading.
- Post-launch metrics to watch: % of barcode scans that result in a "no match" (Open Food Facts → brand → company), % of searches that resolve to a graded company, % of graded companies with ≥3 categories.
