# Data-source discovery — 2026-06-09

Comprehensive scan for **public, free, machine-readable** data sources we
do NOT yet ingest that could meaningfully enrich brand grading.

This pass prototypes the 5 highest-leverage finds and documents 20+ additional
candidates for prioritization post-launch (Phase 5).

---

## Methodology

For each candidate we evaluate:

| Field            | Definition                                                         |
|------------------|--------------------------------------------------------------------|
| Coverage         | Approximate number of TruNorth-indexed brands the source touches.  |
| Category         | Which TruNorth scoring category(ies) the signal feeds.             |
| Accessibility    | Free / paywalled / scrapable / structured feed?                    |
| Recommended      | high · medium · low — based on leverage / effort ratio.            |
| Duplicates?      | Any overlap with the existing 100+ sources?                        |

All sources below are NEW to TruNorth's ingestion stack as of 2026-06-09
(verified against `scripts/*-fetch.mjs` and `public/data/_meta/*-merge-log.json`).

---

## Prototyped (5)

These are wired end-to-end (fetch → merge → augment → apply) in this PR.
Each ships with a fixture mode (no network required) and an integration
into `scripts/apply-augments-to-companies.mjs`.

### 1. HRC Corporate Equality Index (CEI) — DEI / LGBTQ+ workplace

- **URL**: https://www.hrc.org/resources/corporate-equality-index
- **Coverage**: ~1,300 companies scored annually; ~80 in initial fixture.
- **Category**: `dei` (LGBTQ+ workplace policy specifically — a documented gap).
- **Vintage**: 2025 report (published April 2025).
- **License**: Public scorecard, attribution required.
- **Fetcher**: `scripts/hrc-cei-fetch.mjs` (annual cron candidate).
- **Merger**: `scripts/hrc-cei-merge.mjs` → `data/derived/hrc-cei-augment.json`.
- **Match rate (sample fixture)**: 80 / 80 (100%).
- **Brand evidence**:
  - Apple 100/100 (Equality 100 Leader)
  - Tesla 65/100 (lapsed — did not respond to 2024-25 survey)
  - ExxonMobil/Chevron 85/100 (deductions for anti-LGBTQ giving)

### 2. CDP Climate Change A-List — environment / disclosure quality

- **URL**: https://www.cdp.net/en/companies/companies-scores
- **Coverage**: ~24,000 companies scored worldwide; ~86 in initial fixture.
- **Category**: `environment` (verified disclosure — distinct from
  SBTi target-validation and Net Zero Tracker pledge tracking).
- **Vintage**: 2024 cycle (annual February release).
- **License**: Public, attribution required.
- **Fetcher**: `scripts/cdp-climate-fetch.mjs`.
- **Merger**: `scripts/cdp-climate-merge.mjs` → `data/derived/cdp-climate-augment.json`.
- **Match rate**: 86 / 86 (100%).
- **Brand evidence**:
  - Apple, Microsoft, Patagonia, Levi Strauss = A (leadership)
  - Tesla = F (declined to disclose despite investor request)
  - Marathon Petroleum, Moderna = C (awareness-only)

### 3. NCRC / FFIEC Community Reinvestment Act (CRA) ratings — banking community impact

- **URL**: https://www.ffiec.gov/craratings/default.aspx (+ https://ncrc.org)
- **Coverage**: All ~5,000 FDIC-insured US depository institutions; 33 of the largest in the fixture.
- **Category**: `labor` (community-impact proxy — TruNorth lacks a dedicated
  `community` category). Fills brief's **affordable housing / community impact** gap.
- **Vintage**: 2023-2024 exam cycle.
- **License**: Public records.
- **Fetcher**: `scripts/ncrc-cra-fetch.mjs`.
- **Merger**: `scripts/ncrc-cra-merge.mjs` → `data/derived/ncrc-cra-augment.json`.
- **Match rate**: 25 / 33 (parent-corp resolution; 8 banks not in TruNorth index).
- **Brand evidence**:
  - Wells Fargo "Needs to Improve" (post-2022 CFPB $3.7B settlement)
  - SVB / First Republic / Signature "Substantial Noncompliance" (pre-collapse exams)

### 4. GLAAD Studio Responsibility Index + Where We Are On TV — DEI / media content

- **URL**: https://glaad.org/sri + https://glaad.org/whereweareontv
- **Coverage**: ~30 studios/streamers/networks annually.
- **Category**: `dei` (LGBTQ+ media representation — distinct from CEI's
  *workplace* scoring).
- **Vintage**: 2024 reports.
- **License**: Public, attribution required.
- **Fetcher**: `scripts/glaad-sri-fetch.mjs`.
- **Merger**: `scripts/glaad-sri-merge.mjs` → `data/derived/glaad-sri-augment.json`.
- **Match rate**: 12 parent brands matched (with worst-grade rollup to parents).
- **Brand evidence**:
  - Disney "Insufficient" rolled up from Walt Disney Studios slate
  - Warner Bros. Discovery "Fair" (Max + Cartoon Network "Good")
  - Fox Corporation "Poor" (Fox Broadcasting slate)

### 5. Mental Health at Work Pledge — labor / mental health

- **URL**: https://www.mindsharepartners.org/mental-health-at-work-pledge
   + https://onemind.org/onemindatwork/
- **Coverage**: ~250 publicly committed Fortune-500 employers across both
  programs; 57 in initial fixture.
- **Category**: `labor` (workplace mental health — explicit brief gap).
- **Vintage**: 2022-2024 commitments.
- **License**: Public coalition list.
- **Fetcher**: `scripts/mind-share-partners-fetch.mjs`.
- **Merger**: `scripts/mind-share-partners-merge.mjs` → `data/derived/mind-share-partners-augment.json`.
- **Match rate**: 57 / 57 (100%).
- **Brand evidence**:
  - Bank of America, JPMorgan, J&J, Pfizer, Disney = One Mind CEO Pledge (since 2017-2020)
  - Patagonia, Levi Strauss, Microsoft, Salesforce = Mental Health at Work Pledge (since 2022)

---

## Documented for follow-up (20)

Ranked by recommended priority. None of these duplicate an existing source.

### Highest leverage

1. **CDP Forests + Water Security disclosure scores** — companion to CDP
   Climate. Free per-company score band. ~7,000 companies. category:
   environment. URL: https://www.cdp.net/en/scores. **high**.

2. **EPA EJSCREEN — facility-level environmental-justice burden**.
   We already use TRI for chemical releases but EJSCREEN overlays demographic
   burden (race/income of nearby residents) on every TRI facility. Free GeoJSON
   API at https://www.epa.gov/ejscreen. ~10,000 facilities. category: environment.
   **high**.

3. **OFCCP / DOL VETS-4212 corporate veteran-hire reports** — federal
   contractors with 50+ employees + $150K+ in contracts must file annual
   veteran-employment counts. Public via the Office of Federal Contract
   Compliance Programs (DOL OFCCP). https://www.dol.gov/agencies/vets/programs/vets4212.
   Fills brief's **veterans hiring** gap. ~6,000 contractors. category: labor.
   **high**.

4. **Military Times Best for Vets Employers list** — annual ranking of
   ~125 vet-friendly employers based on hire/retention/benefits. Free
   table on militarytimes.com. category: labor (veteran-specific).
   **medium**.

5. **HUD LIHTC / Affordable-Housing Investor Database** — Low Income
   Housing Tax Credit syndicators (banks, insurance cos) tracked publicly
   by HUD. https://www.huduser.gov/portal/datasets/lihtc.html. Fills the
   **affordable housing** gap further. ~500 large investors. category:
   labor / community. **high**.

### Animal welfare

6. **Compassion in World Farming — Business Benchmark on Farm Animal Welfare
   (BBFAW)**. Public annual scorecard (tiers 1-6) on ~150 global food
   companies. URL: https://www.bbfaw.com. category: animals. **high**.

7. **USDA AMS Audited Animal Welfare Approved facility list** — already cited
   indirectly via AWA, but USDA AMS maintains the *facility* registry distinct
   from AWA's brand list. https://www.ams.usda.gov. category: animals. **medium**.

8. **Mercy For Animals — investigations & corporate-pledge tracker**.
   Public corporate-commitment tracker for cage-free, broiler welfare,
   etc. https://mercyforanimals.org. category: animals. **medium**.

### Indigenous rights / sovereignty

9. **First Peoples Worldwide Indigenous-Rights Risk Report** — Colorado
   State University project. Annual report covering ~250 extractive-industry
   companies. https://www.colorado.edu/program/fpw. category: environment +
   political. **medium**.

10. **Indigenous Environmental Network / Stop the Money Pipeline** —
    coalition publishes the "Investing in Climate Chaos" report listing 60+
    banks/asset managers financing fossil-fuel pipelines opposed by
    Indigenous communities. https://www.ran.org/bankingonclimatechaos.
    category: environment + political. **high**.

### Geographic-specific consumer protections

11. **NY AG enforcement actions** — searchable settlements + press releases.
    https://ag.ny.gov/press-releases (RSS feed exists). category: lawsuits.
    **medium**.

12. **MA AG consumer-protection actions** — https://www.mass.gov/ago.
    Smaller volume but high-quality narrative. category: lawsuits. **medium**.

13. **TX AG consumer-protection actions** — particularly for energy &
    healthcare. https://www.texasattorneygeneral.gov/news. category:
    lawsuits. **medium**.

14. **WA AG settlements** — Bob Ferguson's office has been unusually
    aggressive on tech/antitrust. https://www.atg.wa.gov/news. category:
    lawsuits. **medium**.

15. **IL AG settlements** — strong on insurance + pharma. **low**.

### Sustainable agriculture

16. **Real Organic Project certified farms + brands** — tighter than USDA
    Organic; ~1,200 farms; small but symbolic. https://www.realorganicproject.org.
    category: environment / animals. **medium**.

17. **Regenerative Organic Certified (Patagonia / Dr. Bronner's-backed)** —
    ~75 brands certified. https://regenorganic.org. category: environment.
    **medium**.

18. **Equitable Food Initiative certified farms** — farmworker-welfare + food
    safety. https://equitablefood.org. category: labor + animals. **medium**.

### Religious / civil liberties

19. **ACLU Corporate Accountability Tracker (book bans, voting rights
    funding)** — periodic open-letter signatories + corporate-PAC pull-out
    list. https://www.aclu.org. category: political. **medium**.

20. **Freedom of Religion or Belief 'FoRB' Corporate Index (Religious Freedom
    & Business Foundation)** — annual REDI (Religious Equity, Diversity,
    Inclusion) scorecard. ~200 companies. https://religiousfreedomandbusiness.org.
    Fills brief's **religious freedom / discrimination** gap. category: dei.
    **medium**.

---

## Skipped / not recommended

| Source | Reason |
|--------|--------|
| Glassdoor "Best Places to Work" | Crowdsourced reviews, not a public record. |
| Forbes "America's Best Employers" | Methodology opaque; behind a paywall once you click through. |
| Indeed Top-Rated Workplaces | Same as Glassdoor, plus narrow Indeed dataset. |
| Refinitiv ESG Scores | Paid feed only; no free tier matching our brand list. |
| MSCI ESG Ratings | Paid feed; only top-200 free abstract. |
| ISS QualityScore | Paid feed. |

---

## How to refresh

Each source ships a fixture so the pipeline is testable offline:

```bash
node scripts/hrc-cei-fetch.mjs --fixture     && node scripts/hrc-cei-merge.mjs
node scripts/cdp-climate-fetch.mjs --fixture && node scripts/cdp-climate-merge.mjs
node scripts/ncrc-cra-fetch.mjs --fixture    && node scripts/ncrc-cra-merge.mjs
node scripts/glaad-sri-fetch.mjs --fixture   && node scripts/glaad-sri-merge.mjs
node scripts/mind-share-partners-fetch.mjs --fixture && node scripts/mind-share-partners-merge.mjs
node scripts/apply-augments-to-companies.mjs   # writes into public/data/companies/
```

Tests:

```bash
node --test scripts/discovery-pass-2026-06-09.test.mjs
```

Annual / quarterly cron workflows under `.github/workflows/` are TBD; each
source's fetcher is shaped to be wired in identical fashion to the existing
`strike-map-monthly.yml` pattern.
