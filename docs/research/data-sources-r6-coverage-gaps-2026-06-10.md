# Data Sources R6 — filling the emptiest categories (2026-06-10)

Deep-research run (104 agents, 22 sources fetched, 109 claims extracted, 25
adversarially verified) + hands-on endpoint probes. Goal: maximize the NUMBER
of companies gaining data in the dead categories.

## Where the catalog stands (11,261 brands)

| Segment | Count |
|---|---|
| Zero data (all "?") | 6,303 (56%) — heaviest: Ent. & Media 1,391, Retail 803, Food & Bev 603 |
| Stuck at 1–2 realCats (grade-capped) | 3,851 (34%) — 87% have political only |
| 3+ realCats (full grades) | 1,107 (10%) |

Per-category fill: execPay **0.2%**, guns **0.3%**, animals **0.9%**, dei
**1.4%**, privacy **1.8%**, health 2.8%, charity 2.9%, environment 5.0%,
labor 12.6%, political 38.0%.

**Leverage math:** the grade cap requires 3+ categories for an A and 2+ for a
B. Any bulk source in a dead category converts political-only brands into
really-graded brands. One execPay source covering 2,000 parents > ten niche
sources covering 50 brands each.

---

## ✅ BUILD NOW (verified end-to-end)

### 1. SEC XBRL `ecd` — executive compensation at scale ⭐ biggest win
- **Category:** execPay (0.2% → est. 15–25% of catalog via brand→parent map)
- **Coverage:** ~1,500–3,000 public parent companies (1,009 hard-verified in
  the CY2024 frame alone; 1,487 in NonPeoNeoAvgTotalCompAmt/CY2023)
- **Access (verified live):**
  - Light: ~6 frame URLs, e.g.
    `https://data.sec.gov/api/xbrl/frames/ecd/PeoTotalCompAmt/USD/CY2024.json`
    (also CY2023/CY2022 + `NonPeoNeoAvgTotalCompAmt` frames)
  - Full: `https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip`
    (~1.39 GB, rebuilt nightly; supersets frames incl. non-calendar FYs)
  - Join CIK→ticker via `https://www.sec.gov/files/company_tickers.json`
- **Record shape:** `{ cik, entityName, val (USD), fy/fp }` — PEO total comp +
  avg non-PEO NEO comp ⇒ we can compute a CEO-to-median-NEO style ratio or
  display raw PEO comp with year.
- **License:** US-gov public domain. Keyless. Requires descriptive User-Agent
  per SEC fair-access policy.
- **Cadence:** annual data, nightly-refreshed files → quarterly cron is plenty.
- **Caveat:** public parents only; flows to brands via brand-parent-map.
- **Note:** AFL-CIO Paywatch (403 to bots) is derived from this same SEC data
  — going to the primary source is strictly better.

### 2. ToS;DR Service API — privacy + the Entertainment/Tech long tail
- **Category:** privacy (1.8% → est. +500–1,500 matched brands)
- **Coverage:** 10,639 services keyed by BRAND NAME + domains; ~40% (~4,000)
  carry real A–E ratings (filter `rating != "N/A"`). Verified examples:
  Netflix → D, Disney → E (22 domains incl. marvel.com/espn.com/pixar.com).
- **Access (verified live):** `GET https://api.tosdr.org/service/v3/?page=N`
  — 22 pages × 500 records, keyless, ~113 KB/page. Name search:
  `/search/v5/?query=`.
- **Why it matters beyond privacy:** it's the only verified source that
  blankets the Entertainment & Media (1,391 zero-data) and Technology (559)
  long tails — streaming services, games, apps, platforms.
- **Cadence:** actively maintained (records updated May 2026) → weekly cron.
- **⚠️ License open item:** historically CC BY-SA — share-alike scope on
  derived grades needs a check (or a quick email to the ToS;DR team) before
  shipping. Attribution string in Sources tab either way.

### 3. CPPA California Data Broker Registry — privacy flag (hands-on find)
- **Category:** privacy (binary "registered data broker" signal)
- **Access (verified live):** bulk CSVs directly linked from
  `https://cppa.ca.gov/data_broker_registry/` —
  `complete-reg-data-brokers.csv`, `registry2024.csv`, `registry2025.csv`.
- **Coverage:** ~500 registered brokers; expect ~50–150 catalog matches
  (Experian, Acxiom, LiveRamp, Oracle-adjacent, retail media arms).
- **License:** CA state government data. Trivial fetcher (one CSV).
- **Cadence:** annual registration cycle → quarterly cron.

### 4. FTC cases & proceedings — privacy/consumer enforcement (hands-on find)
- **Category:** privacy + health (consumer-protection actions by company name)
- **Access (verified 200):** `ftc.gov/legal-library/browse/cases-proceedings`
  is server-rendered and filterable by topic (Privacy & Data Security);
  paginated HTML scrape, same pattern as our DOJ scraper.
- **Coverage:** hundreds of named companies incl. consumer brands.
- **License:** US-gov public domain. **Cadence:** monthly.

### 5. Charity at scale = implementation, not a new source
ProPublica Nonprofit Explorer is EXCLUDED (terms prohibit commercial reuse)
— but the underlying IRS 990/990-PF bulk data is public domain and ALREADY
integrated. The unlock is a **corporate-foundation name-pattern pass**:
match `"<Brand/Parent> Foundation"` (+ legal-name aliases; note "Wal-Mart
Foundation" style hyphenation) against the IRS index we already pull, and
write a charity narrative from foundation assets/giving. Est. several
hundred brands. Zero license risk.

## 🔬 STRONG LEAD — needs hands-on testing (best per-company DEI option)

### DOL OFCCP FOIA library — company-identified EEO-1 Type 2 reports
- ~19,000+ federal-contractor EEO-1 reports (2016–2021 cycles) released
  under court order (N.D. Cal. 3:22-cv-07182) — the ONLY public
  per-company workforce-demographics data at scale.
- dol.gov returns 403 to curl/CLI from datacenter IPs (Akamai). Untested
  from GitHub Actions. Try: browser session to find the actual file URLs
  (released as spreadsheets), check for mirrors (Reveal/CIR published
  earlier cycles on GitHub), or fetch once manually and commit the static
  snapshot (data is historical; no cron needed).

## ❌ VERIFIED DEAD ENDS (don't revisit)
- **ProPublica Nonprofit Explorer** — API works, terms forbid commercial use.
- **California CRD pay-data portal** — employer-identified reports are
  confidential by statute; only anonymized aggregates; JS-only portal.
- **EEOC public EEO-1 products** — deliberately aggregate-only.
- **Guns Down America "Business Must Act"** — only ~40 companies, mostly
  overlapping our existing guns coverage. Guns remains unsolved at scale.
- **Open Beauty Facts cruelty-free label** — 59 products tagged; useless for
  animals despite OBF's 9,813 brands.
- **AFL-CIO Paywatch** — bot-blocked AND derivative of SEC ecd (#1).

## Still unsolved at scale
**guns** and **animals** have no 1,000+ brand source anywhere we could
verify. Realistic paths: (a) animals — full Leaping Bunny + PETA dumps are
already in; the remainder is brand-by-brand; (b) guns — policy is only
meaningful for retail/finance; consider an explicit "na" backfill for
categories where the industry makes the question inapplicable, which raises
realCats honesty instead of data volume.

## Suggested build order (impact ÷ effort)
1. **SEC ecd execPay** (frames first, companyfacts.zip later) — biggest
   dead-category unlock, public domain, ~half-day fetcher.
2. **IRS 990 corporate-foundation pass** — no new source plumbing.
3. **CPPA data-broker CSV** — ~1-hour fetcher.
4. **ToS;DR** — fetcher is easy; resolve the license question in parallel.
5. **FTC cases scrape** — clone the DOJ scraper pattern.
6. **OFCCP EEO-1** — manual one-time download + static augment.

Run stats: 5 search angles, 22 sources fetched, 109 claims, 25 verified,
2 killed, 7 budget-dropped. Hands-on probes: 10 endpoints.
