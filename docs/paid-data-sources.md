# Paid Data Sources — Pricing, Cadence, Fit

Generated 2026-06-09 for Aron — round-3 enrichment scoping.

Pricing is best-effort from public web sources + vendor quotes. Real numbers vary by company size, contract length, user count, and what you negotiate. Treat the columns as **order of magnitude**, not invoice.

**Legend:**
- **Cost** = annual list price for a single-org subscription
- **Cadence** = how often the data refreshes
- **Fit** = (high / medium / low) for TruNorth's brand-graded model
- **Why it matters** = what we'd gain vs the free stack

---

## Tier 1 — Big ESG Aggregators ($10K–$50K+/yr)

These wrap thousands of sources into a single rating. Replace 30+ of our own scrapers. Heavy spend, but they're the gold standard.

| Source | Cost / yr | Cadence | Fit | Why it matters |
|---|---|---|---|---|
| **MSCI ESG Ratings** | ~$25K–$50K (varies by AUM) | Quarterly | **High** | Industry-standard ESG ratings for 14,000+ public cos. Their AAA-CCC grades are what asset managers use. Brand recognition alone is worth it. |
| **Sustainalytics ESG Risk** | ~$15K–$30K | Quarterly | **High** | Morningstar-owned. 13,000+ co's. Strong on controversies (we'd cut OFAC/court-listener noise). |
| **Refinitiv (LSEG) ESG** | ~$20K–$40K | Quarterly + event-driven | **High** | 10,000+ co's, history back to 2002. Strong on emissions data. Tied to financial dataset. |
| **Bloomberg ESG via Terminal** | $25K+ (single seat) | Continuous | Medium | Terminal cost prohibitive. ESG is bundled — you can't subscribe to just data. |
| **S&P Global ESG / RobecoSAM** | ~$15K–$35K | Annual + events | **High** | Source of Dow Jones Sustainability Index. Gold standard for board governance. |
| **ISS ESG (Institutional Shareholder Services)** | ~$15K–$50K | Annual | Medium | Strong on governance / proxy voting / executive comp. Overlaps with what we'd build cheaper. |
| **ESG Book** (formerly Arabesque S-Ray) | ~$10K–$25K | Monthly | Medium | Newer entrant, cheaper. 50,000+ co's via NLP. Quality varies. |
| **GRESB** (real estate ESG) | $5K–$15K | Annual | Low | Real estate / infrastructure only. Skip unless we add a property vertical. |

**Cheapest meaningful entry into this tier: ESG Book at ~$15K/yr.**
**Best single buy: Sustainalytics ($25K/yr) — controversies data alone justifies the spend.**

---

## Tier 2 — News & Media Intelligence ($1K–$50K/yr)

Replace News API / GDELT for higher quality + structured tagging. Critical for our weekly_changes journalism loop.

| Source | Cost / yr | Cadence | Fit | Why it matters |
|---|---|---|---|---|
| **Factiva (Dow Jones)** | $5K–$50K | Real-time | **High** | The gold standard for corporate news + WSJ/Barron's/Reuters archive. Required if we go premium-tier news. |
| **LexisNexis Newsdesk** | $5K–$25K | Real-time | **High** | Includes legal filings + global press. Heavy on litigation coverage. |
| **NewsAPI.org** | $449/mo (~$5.4K/yr) Business plan | Real-time | Medium | Affordable, broad coverage. Quality lower than Factiva. Already free at lower tiers. |
| **GNews API** | $249/mo (~$3K/yr) | Real-time | Medium | Google News wrapper. Good for SEO/headline tracking. |
| **Mediastack** | $250/mo (~$3K/yr) | Real-time | Medium | Lower-tier. Decent coverage but ~24hr lag. |
| **Aylien News API** | $499–$999/mo (~$6K–$12K/yr) | Real-time | **High** | NLP-tagged: entities, sentiment, IPTC categories. Saves us NLP work. |
| **Event Registry** | $99–$999/mo | Real-time | Medium | Strong on global news + entity linking. Cheaper alternative. |
| **Cision PR Newswire / Business Wire archive** | $5K–$15K | Real-time | Low | Press-release noise; we'd filter most of it anyway. |
| **AP News API** | Custom (~$10K) | Real-time | Medium | Highest credibility newswire. Probably overkill for our usage volume. |

**Best entry buy: Aylien at ~$6K/yr — pre-tagged entities save scraping work.**

---

## Tier 3 — Legal & Court Data ($500–$10K/yr or pay-per-use)

We have CourtListener (free), but it's incomplete. Real PACER access opens up class actions, antitrust dockets, and regulatory dockets we currently miss.

| Source | Cost | Cadence | Fit | Why it matters |
|---|---|---|---|---|
| **PACER** (federal courts) | $0.10/page, capped $3/doc | Real-time | **High** | Federal court docs. ~$50–500/mo realistic usage. Free under $30/quarter (auto-waived). |
| **Bloomberg Law** | $5K–$15K/seat | Real-time | Medium | Premium legal. Court dockets + news. Overlaps with Factiva + PACER. |
| **Westlaw Edge** | $5K–$15K/seat | Real-time | Medium | Premium legal research. Similar to Bloomberg Law. |
| **Lex Machina** | $10K–$25K | Real-time | Medium | Litigation analytics on PACER data. Adds judge/firm metrics — overkill for us. |
| **CourtListener API** | Free + $50–500/mo for higher rate limits | Real-time | **High** (already use) | Our current source. RECAP archive of PACER docs. Good but not complete. |
| **Justia Dockets** | Free | Daily | Low | We can scrape this; already partial. |
| **Class Action Database** | $99–$499/mo (TopClassActions.com API) | Real-time | Medium | Pre-aggregated class action filings. Saves us NLP work. |
| **DocketAlarm** | $99–$499/mo | Real-time | Medium | PACER alerts + analytics. Cheaper than Bloomberg. |
| **Pacer Pro** | $20–$100/mo + PACER fees | Real-time | Medium | UI layer on PACER, less expensive than full Bloomberg/Westlaw. |

**Recommended: PACER direct (~$200/mo realistic) + DocketAlarm ($99/mo) = ~$3.5K/yr covers 90% of legal needs.**

---

## Tier 4 — Private Company / Corporate Intelligence ($5K–$25K/yr)

For private brands (a huge chunk of our 6,345 ungraded brands).

| Source | Cost / yr | Cadence | Fit | Why it matters |
|---|---|---|---|---|
| **Pitchbook** | $25K+/seat | Daily | **High** | Best private-company database. Funding, M&A, leadership. Solves a huge chunk of our "?" grades. |
| **Crunchbase Enterprise** | $999/mo (~$12K/yr) | Daily | **High** | Cheaper than Pitchbook, still strong. Crunchbase Pro is $300/yr but limited. |
| **CB Insights** | $30K+ | Daily | Medium | Tech-focused. Industry reports + private co data. Overlap with Pitchbook. |
| **Tracxn** | $5K–$15K | Daily | Medium | Cheaper private-co alternative. Strong on Asia. |
| **PrivCo** | $5K–$10K | Monthly | Medium | Private financials estimation. Useful for revenue-based scoring. |
| **D&B Hoovers** | $1K–$5K | Daily | Medium | Old-school. Strong on small private cos. Hierarchy/parent mapping. |
| **ZoomInfo** | $15K–$50K | Daily | Low | Sales-focused contact data. Useful for parent-co mapping but expensive. |
| **Apollo.io** | $1K–$10K | Daily | Low | Sales data. Cheaper than ZoomInfo. |
| **Owler** | $35/mo/user (~$420/yr) | Weekly | Low | Crowd-sourced corp intel. Limited but cheap. |

**Recommended: Crunchbase Enterprise at $12K/yr** if we want to grade more private cos. Otherwise live with "?" for now.

---

## Tier 5 — Industry Research ($1K–$15K/yr)

Industry-specific deep dives. Bigger value for B2B/enterprise tools than D2C apps.

| Source | Cost / yr | Cadence | Fit | Why it matters |
|---|---|---|---|---|
| **IBISWorld** | $1.5K–$10K | Quarterly | Low | Industry reports. Strong on benchmarks. Mostly overkill for brand scoring. |
| **Statista Enterprise** | $2K–$10K | Continuous | Low | Generic stats database. Free tier covers most of what we'd use. |
| **GlobalData** | $5K–$25K | Quarterly | Low | Industry intel. Heavy on healthcare/energy. |
| **Euromonitor Passport** | $25K+ | Quarterly | Medium | Consumer markets focus. Strong on brand share data. |
| **Mintel** | $25K+ | Quarterly | Medium | Consumer trends + brand research. |
| **Nielsen IQ** | $25K+ | Continuous | Low | Retail scan data. Overkill for us. |

**Skip this tier unless we add explicit industry reports.**

---

## Tier 6 — Workplace / Employee Sentiment ($1K–$20K/yr)

For DEI + labor signals beyond what we scrape.

| Source | Cost / yr | Cadence | Fit | Why it matters |
|---|---|---|---|---|
| **Glassdoor for Employers API** | $5K–$15K | Daily | Medium | Reviews + ratings + diversity metrics. ToS issues at scraping. Direct partnership cleaner. |
| **Indeed Hiring Insights API** | $5K–$15K | Daily | Medium | Pay scales + benefit data. |
| **Comparably API** | $1K–$10K | Daily | Medium | D&I ratings + culture scores. Cheaper than Glassdoor. |
| **Great Place to Work data** | Custom (~$5K–$15K) | Annual | Medium | Certified-employer lists. Free for the public certification list — paid for full scores. |
| **PayScale data** | $1K–$5K | Quarterly | Low | Pay benchmarks. Useful for pay-ratio signal. |
| **JobScout** | $500–$2K | Daily | Low | Job posting velocity. Marginal value. |

**Recommended: Comparably at ~$5K/yr** if we want labor depth without Glassdoor's ToS risk.

---

## Tier 7 — Specialized Niches ($500–$10K/yr)

Vertical-specific data for high-confidence categories.

| Source | Cost / yr | Cadence | Fit | Why it matters |
|---|---|---|---|---|
| **OpenSecrets API premium** | Free–$500 | Daily | **High** (already use) | We already use the free tier. Premium adds rate limits + bulk export. |
| **FollowTheMoney.org** | Free | Daily | High | State-level political donations. Already use partially — could go deeper. |
| **EWG bulk product database access** | Custom (~$2K–$10K) | Quarterly | Medium | Cosmetics + cleaners + food deep ingredient data. |
| **GoodGuide API** (defunct, but data via UL) | Custom | Quarterly | Low | Product-level safety scores. |
| **Carbon Disclosure Project (CDP) premium** | $5K–$15K | Annual | Medium | We have public A-List free; paid tier adds full company responses. |
| **B Lab data API** | Free (public) | Monthly | High | Already covered free. |
| **GS1 GPC data** | $500–$5K | Quarterly | Low | Product classification. Useful for barcode scanner accuracy. |
| **Open Food Facts premium support** | $500–$2K (donation) | Continuous | High (already use) | We use the free DB. Donation gets us community goodwill + uptime promise. |
| **Trase.earth** | Free + custom | Quarterly | Medium | Supply-chain traceability for agricultural commodities. Free for non-commercial. |

---

## Recommended Buy Order (if budget materializes)

| Priority | Source | Cost / yr | Why first |
|---|---|---|---|
| 1 | **Sustainalytics ESG Risk** | $25K | Replaces 30+ scrapers, controversies engine, industry-standard naming |
| 2 | **Aylien News API** | $6K | Pre-tagged news feed — saves NLP work, scales the journalism loop |
| 3 | **PACER + DocketAlarm** | ~$3.5K | Real federal court docket data, closes the legal-signal gap |
| 4 | **Crunchbase Enterprise** | $12K | Cuts the 6,345 ungraded brands by an estimated 30–40% |
| 5 | **Comparably API** | $5K | Labor + DEI depth without Glassdoor's ToS risk |
| 6 | **MSCI ESG** | $35K | Brand-prestige play — adds "rated by MSCI" copy to marketing |

**Total Tier 1+2+3 commitment: ~$35K/yr** unlocks: industry-standard controversies, premium news, real legal data.

**Stretch buy ($85K/yr total):** add Crunchbase + Comparably + MSCI for a fully premium data stack.

---

## What to keep FREE (no need to buy)

- **All federal regulators** (EPA, FDA, FTC, SEC, CFPB, NHTSA, CPSC, OSHA, EEOC, FCC, DOJ, USDA, HHS-OIG, MSHA, CMS, CISA)
- **Most state AGs** (where they publish — NY, TX, CA, MA, etc.)
- **OpenSecrets**, **FollowTheMoney**, **CDP A-List**, **SBTi**, **Net-Zero Tracker**
- **HIBP**, **Mozilla PNI**, **EFF**, **Ranking Digital Rights**
- **B Corp**, **1% for the Planet**, **Fair Trade USA**, **Climate Neutral**
- **CourtListener** (vs PACER paid): pick PACER only if we need filings <90 days old
- **GDELT**, **NewsAPI free tier**, **Wikidata** for entity linking
- **HRC CEI**, **Bloomberg GEI**, **JUST Capital**, **Newsweek Trust**

---

## ROI Decision Matrix

Don't buy a paid source unless one of these is true:

1. **It would unlock >500 ungraded brands** (Pitchbook, Crunchbase, ESG Book)
2. **It would replace ≥5 scrapers** + improve reliability (Sustainalytics, MSCI)
3. **It would close a specific user complaint** ("why no labor signal for [X]?")
4. **Brand recognition** ("Powered by MSCI" / "Sustainalytics-verified")

Reject if:
- Free alternative covers >80% of use case
- Less than 50 brands match our index
- Refresh cadence isn't faster than our cron tier (nightly/weekly)

---

## Notes

- Pricing is current to mid-2026 and changes constantly — confirm before any commit
- Most vendors run 12-month minimums; many require multi-year for the headline price
- Negotiation room: 20–40% for startups, especially if you commit to using the brand as a logo on your marketing
- Several offer **free academic** or **free press** tiers — worth applying for if we have a B-Corp / non-profit angle
- All Tier 1 ESG vendors require a redistribution-restricted license — we couldn't pass raw ratings through to free users without an additional rights fee
