# Data source discovery — round 2 (2026-06-09)

Round 2 of the data-grab focused on industry-specific datasets and niche
advocacy databases not covered by the existing TruNorth pipeline. This
note documents what we investigated, what we shipped, and what's left
for follow-up.

## Shipped this round

| # | Source | Category | Slugs enriched | Script |
|---|--------|----------|---------------|--------|
| 1 | USTR Notorious Markets (2025) | privacy | 3 (alibaba-group, baidu, bytedance) | `scripts/ustr-notorious-markets-{fetch,merge}.mjs` |
| 2 | Common Sense Privacy | privacy | 11 (meta-facebook, google-alphabet, bytedance, snap, apple, netflix, disney, amazon, spotify, zoom, roblox-corporation) | `scripts/common-sense-privacy-{fetch,merge}.mjs` |
| 3 | Consumer Reports 2026 Auto Brand Report Card | health | 23 (top-10 + mid-pack + bottom-5 auto brands) | `scripts/cr-auto-reliability-{fetch,merge}.mjs` |

All three writers are wired into `scripts/apply-augments-to-companies.mjs`
under their respective categories. Total of **35 net-new category
narratives** written to per-company files (no overwrites of existing
non-no-record narratives, per Aron's first-wins rule).

## Investigated and parked

Each row below was researched against round-2's "publicly accessible,
machine-readable" bar. Numbers in the first column correspond to the
24-source brief.

| # | Source | Why parked | Possible path forward |
|---|--------|------------|------------------------|
| 1 | NHTSA Tier-2 (lemon law / NCAP detail) | NHTSA recalls + complaints already ingested in `nhtsa-fetch.mjs`. Lemon-law complaints live in the same complaints endpoint we already aggregate. NCAP detail (`SafetyRatings/VehicleId/...`) is already walked by `nhtsa-safety-fetch.mjs`. | Nothing — covered. |
| 2 | IIHS HLDI injury-claim frequencies | Per-model HLDI tables ship only as quarterly PDFs in the IIHS Status Report (paywalled aggregation index). The public landing page summarizes worst-of/best-of records but not full make/model frequencies. | Quarterly scrape of `iihs.org/api/datastoredocument/status-report/pdf/<n>/<m>` once the report-cadence URLs stabilize. |
| 3 | JD Power dependability + initial-quality | Methodology + per-brand findings are press-release only; rankings vary by industry vertical (auto, retail, banking) and JD Power asserts copyright on the rankings. | Manual seed of the auto vertical (mirroring our CR approach). |
| 4 | AAA driver-cost report | Published as a single annual PDF aggregating segment medians, not per-brand. | Use for sector benchmarks if we add a TCO category. |
| 5 | BTS / DOT Air Travel Consumer Report | Akamai WAF returns 403 on every `transportation.gov` / `bts.gov` URL from non-browser UAs (including direct PDF links). The data is per-carrier on-time, mishandled baggage, and consumer complaints. | Run from a residential IP or proxy; or pre-stage the monthly ATCR PDFs in a fixtures bucket. |
| 6 | Cruise sanitation inspections | CDC Vessel Sanitation Program publishes per-ship scores; brand attribution to Carnival / Royal Caribbean / NCL fleets requires a fleet-to-operator map. | Build the fleet map, then scrape `wwwn.cdc.gov/InspectionQueryTool`. |
| 7 | OSHA hospitality enforcement | OSHA SIR enforcement is already ingested in `scripts/osha-sir-fetch.mjs` (covers fall protection, hazcom across all industries including hotels/restaurants). | Nothing — covered. |
| 8 | HUD LIHTC affordable-housing developer tracker | `huduser.gov` returns AWS WAF challenge (HTTP 202) on `lihtcpub.zip`. The Datalumos mirror has 2024-vintage data but no licence-clear permission to redistribute via TruNorth. | Use the LIHTC database in a one-shot manual download → fixture upload; or query individual state HFA datasets which are unblocked. |
| 9 | NIBS inclusive-design / accessibility compliance | NIBS does not publish a company-level compliance registry; its data is project-level and consultancy-gated. | Skip — wrong granularity. |
| 10 | AIA 2030 Commitment signatory firms | The 2030 DDx directory is a React SPA at `2030ddx.aia.org/2030-directory` — content loads via private API after a JS-driven session handshake. | Selenium / Playwright scrape of the directory; or contact AIA for the published signatory CSV. |
| 11 | Consumer Reports product-reliability ratings | We shipped the **auto** vertical (#3 above). CR's appliance + electronics ratings live behind the same paywall but with no equivalent press-release archive. | Skip the consumer-electronics vertical for now. |
| 12 | Public Citizen watchdog tracker | Public Citizen publishes investigations + lobbying reports as long-form articles, not a structured corporate database. The Center for Responsive Politics (OpenSecrets) — which Public Citizen co-founded — already feeds our FEC + lobbying pipeline. | Skip — coverage already exists. |
| 13 | Common Sense Media corporate ratings | Implemented this round (#2 above). | — |
| 14 | POGO college-loan-servicer report cards | POGO last published the report card in 2021; no recent updates. Servicer-level data is also available through the CFPB student-loan complaint set, which the `cfpb-fetch` pipeline already ingests. | Skip — partial coverage via CFPB. |
| 15 | AAUP corporate-influence database | AAUP's "Faculty Compensation Survey" and "Corporate Influence in Higher Ed" reports are HTML essays, not a structured database. | Skip — wrong shape. |
| 16 | CBP UFLPA detentions | The UFLPA Statistics Dashboard publishes industry-level aggregates only — no named importers. CBP redacts importer identity per Customs Trade Partnership rules. | Skip — granularity too coarse for brand attribution. |
| 17 | USTR Notorious Markets | Shipped this round (#1 above). | — |
| 18 | OFAC sanctions evasion enforcement | Already covered: `ofac-fetch.mjs` and `ofac-sdn-fetch.mjs` ingest the SDN list and enforcement actions. OpenSanctions feed (also already wired) catches secondary-sanctions evasion cases. | Nothing — covered. |
| 19 | First Peoples Worldwide indigenous-relations tracker | The Indigenous Rights Risk screen is licensed only through Adasina Social Capital + EIRIS / Sustainalytics paywalls. Public report (2014, 2020) names 52 Russell-1000 extractive companies. | Hand-seed the 52 named companies from the 2020 report as a one-shot enrichment. |
| 20 | Religious Freedom Index corporate ratings | The Religious Freedom Index (Becket Fund) measures public opinion, not corporations. The closest corporate equivalent is "Religious Freedom & Business Foundation" — too small a list. | Skip — wrong shape. |
| 21 | NAACP corporate accountability + boycott list | NAACP's Opportunity & Diversity Report Card (last released 2012 hotel/lodging report) and the 2025 Black Consumer Advisory both name brands inline in press releases rather than via a structured registry. | Hand-seed the BCA's named brands (Walmart, McDonald's, Meta as flagged; Delta, Apple, Costco, Ben & Jerry's as praised) once methodology is published. |
| 22 | ADL corporate-statement tracker | ADL maintains a "Glass" advertising-safety database but it's restricted to ADL members. The public-facing "Hate at Work" data is incident-level, not corporate. | Skip — wrong access tier. |
| 23 | Stop AAPI Hate corporate-response tracker | SAH publishes campaign-level activity (e.g., its 2024 "Hate Doesn't Pay" report names ~10 corporate participants) but no rolling tracker. | Hand-seed the named corporate signatories. |
| 24 | GLAAD corporate-pride-month tracker | GLAAD SRI (Studio Responsibility Index) was already covered per Aron's brief. The annual Pride Month corporate-statement tracker is a journalism asset, not a structured database. | Skip — covered by SRI. |

## Notes for future rounds

- **WAF-gated federal datasets**: `transportation.gov`, `bts.gov`,
  `huduser.gov` all return 403 / 202 challenge responses on
  non-browser UAs. A GitHub Actions cron running these scrapers will
  hit the same wall. Solution candidates:
  1. Manual one-shot download → pre-stage into `scripts/fixtures/<source>/`.
  2. Headless-browser stage in CI (Playwright with stealth).
  3. Use the Wayback Machine snapshots — they're served unredacted.
- **SPA-only sources** (Common Sense Privacy, AIA 2030 DDx): even with
  a friendly UA, the data hydrates via private loaders. Hand-seeding
  the top consumer-facing entries gives 80% of the value with 5% of
  the engineering surface.
- **Industry-narrow datasets** (extraction-only Indigenous risk
  screens, religious-freedom corporate ratings) score very few brands
  in TruNorth's index. Consider deferring until a "Specialty advocacy"
  category exists in the scoring rubric to absorb the long tail.
