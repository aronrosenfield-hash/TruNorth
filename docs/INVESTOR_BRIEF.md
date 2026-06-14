# TruNorth — Investor & Diligence Brief

> **Living document.** Maintained by the founder + AI engineering co-pilot. Last updated automatically as material changes ship. **Do not share secrets / API keys from this doc** — all sensitive values are intentionally redacted and stored in `.env` files (git-ignored) and GitHub Actions Secrets.

**Last updated:** 2026-06-12 PM
**Status:** Pre-launch · iOS TestFlight (Build 68) · full product redesign shipped Jun 11–12 ("Civic Premium") · PH launch date being re-set post-redesign
**Founder:** Aron Rosenfield (solo indie, US-based, Texas)
**Legal entity:** TruNorthApp LLC (formed; business bank account + RevenueCat live — pre-revenue by choice until the paid build flips)

---

## 0 · What shipped June 5–12 (material changes)

- **Civic Premium redesign (Builds 61–68):** full visual system (ink/bone/teal, serif verdicts, mono receipts), four-surface architecture, ring verdict seal, the Match, the Switch + Ledger impact counter, clash-led basket stat ("0% aligned" retired — presentation only, scoring untouched).
- **Scoring V3 (frozen):** evidence-shrunk overall scores, thresholds A≥63/B≥56/C≥46/D≥41; single-category brands cap at B; F requires documented misconduct; zero-data brands show "?" — never a fabricated C.
- **Neutrality hardening:** stance categories (politics/DEI/animals/firearms) contribute nothing to neutral baselines; symmetric mismatch scoring both directions; third-party DEI recognition (HRC/Disability:IN/Bloomberg, 736 brands) now reaches stanced users' grades both ways.
- **Catalog & sources:** 12,841 companies (EDGAR expansion +1,583); R7 sources wired (OFCCP EEO-1, ToS;DR, CBP UFLPA, SAM exclusions, USAspending); 167 automated workflows.
- **Trust layer:** published /methodology (formulas + frozen thresholds + disclosed judgment calls), per-claim receipts on the verdict card, opinion framing, corrections channel.

---

## 1 · One-line pitch

> **TruNorth tracks 12,000+ consumer brands and grades ~2,900 of them across 9 values categories using over 200 public-records sources — so you can shop in line with what you actually believe in.**

We're a personalized, mobile-first, primary-sourced shopping intelligence app. Anti-engagement-trap by design: no streaks, no push spam, no rage-bait. Open, decide, close. The Match — nine full-screen tension cards, ~45 seconds — derives your weights (never asks for numbers), and every grade reweights to you: two users see different verdicts on the same brand.

---

## 2 · The problem

US consumers funnel **$4T/year** through brands whose values diverge sharply from their own. Existing tools fail because:

1. **ESG ratings are pay-to-play** (MSCI, Sustainalytics charge $25–30k/yr; available only to institutional buyers).
2. **Free competitors are opinion-driven** (Buycott, Good On You) — handful of categories, no audit trail, no primary sources.
3. **Yuka, EWG, etc.** cover narrow verticals (food only, beauty only).
4. **No personalization** — a left-leaning shopper and a right-leaning shopper see the same "score."

TruNorth is the only consumer-facing app pulling from 200+ federal regulators, courts, certifications, and international enforcement bodies — with profile-aware grading.

---

## 3 · Product

**Mobile-first React SPA wrapped in Capacitor for iOS** (Android post-launch).

### Core flows

The June 2026 redesign ("Civic Premium" — archival ink + bone, one teal signal color, serif verdicts, monospace receipts) reorganized the app into **four surfaces**:

| Surface | Description |
|---|---|
| **Today** | The daily pulse: your compass seal + basket verdict ("One clash on the record — the rest holds steady"), one record-driven story, one daily-rotating shelf ranked for you. |
| **Lens** (center) | Search, scan, or browse → the **verdict card**: one serif sentence ("Aligned on 4 of your 5 priorities — one red flag"), three mono receipt lines (penalties · recalls · political money) with source links, and a better-matched swap. One-tap barcode scanner. |
| **Ledger** | Your money's record: clash count, **dollars redirected** ($X/mo · $Y/yr from committed switches), switch receipts, saved basket with a what-changed feed. |
| **You** | Values archetype (serif name + 4-letter codename + identity seal), re-run the Match anytime, methodology/sources/corrections. |

Supporting flows: **the Match** (11 tension cards replace the old quiz; weights derived, never asked; politically symmetric by construction) · **the Switch** (commit a swap, log monthly spend once, Ledger counts the impact) · **Versus** (two brands, serif verdict line) · first-run basket picker → "your basket, judged" reveal in under 90 seconds.

### Scoring categories (9)

| Category | Slider or Badge | Data shape |
|---|---|---|
| Political donations | Slider (Left ↔ Right) | Continuous lean position |
| Environmental policy | Slider (Violations ↔ Certified) | EPA, EPA ECHO, PHMSA, NRC, CDP, B Corp |
| Labor practices | Slider (Violations ↔ Clean record) | OSHA, MSHA, NLRB, DOL WHD, DOL OFCCP, Violation Tracker |
| Data privacy | Slider (Breaches ↔ No breaches) | HIBP, CISA KEV, NIST NVD, OSV, GHSA, CERT |
| Executive pay | Slider (>300:1 ↔ <50:1) | SEC DEF 14A proxy filings, AFL-CIO Paywatch |
| Charitable giving | Badge | IRS 990, ProPublica Nonprofit Explorer |
| DEI & social equity | Badge | HRC CEI, EEOC, UK Gender Pay Gap |
| Animal welfare | Badge | PETA, Leaping Bunny, USDA APHIS, ASPCA |
| Firearms policy | Badge | ATF FFL registry |

**Why mixed UI**: continuous-spectrum data (violations count, CEO pay ratio) is genuinely a slider. Categorical data (sells guns / does not) was misleading as a centered dot — replaced with explicit pill badges showing all possible states and highlighting the matched one.

---

## 4 · Data — the moat

### 200+ public-record sources, free, primary

The core IP. No competitor has assembled this. Costs the user $0 because every source is gov / nonprofit / open-data.

**Live in pipeline as of 2026-06-12** — full registry: `/docs/SOURCES.md`. The table below is the 2026-06-04 baseline (100); R6/R7 expansions since added 100+ more feeds: OFCCP EEO-1 workforce demographics, ToS;DR privacy grades, CBP UFLPA/WRO forced-labor lists, SAM.gov exclusions, USAspending per-recipient, DOL/state regulators, and the international round-3 set.

| Tier | Source count | Examples |
|---|---|---|
| Company universe | 3 | SEC EDGAR, Wikidata, Open Food Facts |
| Federal enforcement | 19 | DOJ, SEC Litigation, CourtListener, OCC, FDIC, Fed Reserve, FINRA, CFTC, PCAOB, FERC, HUD, OFAC, Stanford SCAC, GAO, Oversight.gov IG, MuckRock, GSA SAM, DOJ FCPA, DOJ ATR |
| Consumer protection | 4 | CFPB, CPSC, NHTSA, FCC |
| Political donations | 6 | FEC, OpenSecrets, OpenStates, InfluenceMap, CPA-Zicklin, As You Sow |
| Charitable giving | 2 | Charity Navigator, Candid/GuideStar |
| Environmental | 8 | CDP, B Corp, EPA, EPA ECHO, PHMSA, NRC, Break Free From Plastic, Climate Action 100+ |
| Labor practices | 8 | OSHA, OSHA SIR, MSHA, NLRB, DOL WHD, DOL OFCCP, Violation Tracker, Oxfam |
| Supply chain & human rights | 8 | BHRRC, DOL TVPRA, Yale CELI, KnowTheChain, UK MSA, GoodWeave, Fair Trade USA, Rainforest Alliance |
| DEI | 3 | HRC CEI, EEOC, UK Gender Pay Gap |
| Firearms | 1 | ATF FFL |
| Animal testing & welfare | 4 | PETA, Leaping Bunny, ASPCA, USDA APHIS |
| Drug enforcement | 1 | DEA Diversion Control |
| Data privacy & security | 8 | HIBP, CISA KEV, NIST NVD, OSV, GHSA, CERT VU, EFF, Mozilla |
| Health & product safety | 7 | OpenFDA, FSIS, NTSB, FAA, FRA, CDC FoodNet, HHS OIG |
| Sustainability certifications & rankings | 9 | MSC, FSC, C2C, Climate Neutral, UN Global Compact, JUST 100, Ethisphere, Newsweek MRC, WikiRate |
| International regulators | 4 | EU DG Comp, EU Sanctions, Canadian Competition Bureau, Australian ACCC |
| Executive pay | 2 | AFL-CIO Paywatch, SEC Proxy |
| News & global press | 3 | Google News RSS, AllSides Bias, GDELT |
| **TOTAL** | **100** | |

### Refresh cadence (automated)

| Frequency | What |
|---|---|
| **Daily** (04:00 UTC) | Google News RSS → per-brand mention extraction |
| **Weekly** (Sun-Tue UTC) | CFPB, CourtListener, NHTSA, CPSC, EPA ECHO, OCC, FDIC, FINRA, NRC, FERC, FSIS, PHMSA, MSHA, FRA, NTSB, FAA, FCC, OpenFDA, GDELT, OSHA SIR, FAA, SEC Litigation, CISA KEV, DOJ |
| **Monthly** (1st-2nd UTC) | NIST NVD, OSV, GHSA, CERT VU, NLRB, EPA Enforcement, OFAC, EU Sanctions, EU Antitrust, OpenStates, OpenSecrets, CDC FoodNet, HHS OIG, FEC, DOJ FCPA, DOJ ATR, PCAOB, CFTC, Fed Reserve, HUD, ATF, DEA, USDA APHIS, DOL WHD, DOL OFCCP, GSA SAM, Stanford SCAC, GAO, Oversight.gov, MuckRock, Canadian Comp, ACCC, Violation Tracker, WikiRate |
| **Quarterly** | SEC EDGAR (ticker list + 10-K subsidiaries), Wikidata, AllSides Bias |
| **Annual** | CDP, B Corp, HRC CEI, BHRRC, DOL TVPRA, Yale CELI, As You Sow, KnowTheChain, CPA-Zicklin, Fair Trade USA, Rainforest Alliance, MSC, FSC, C2C, Climate Neutral, GoodWeave, UN Global Compact, JUST 100, Ethisphere, Newsweek MRC, Climate Action 100+, UK MSA, UK Gender Pay Gap, Charity Navigator, Candid, AFL-CIO, EEOC, EFF, Mozilla, Break Free From Plastic, Oxfam, InfluenceMap, ASPCA, PETA, Leaping Bunny, Open Food Facts |

All refreshes run on **GitHub Actions** (free 2,000 min/mo, currently using ~30%).

### Data pipeline architecture

```
GitHub Actions cron
       ↓
Per-source fetch script (Node.js, 1 req/sec, polite UA)
       ↓
Per-source JSON output (/public/data/{source}.json)
       ↓
Per-source merge script (resolves brand → company slug via slug-aliases.json + brand-parent-map.json)
       ↓
Per-company JSON file (/public/data/companies/{slug}.json) — 12,000+ files
       ↓
companies.json index (merged at build time, ships with bundle)
       ↓
React app reads companies.json → renders detail card on demand
```

**Why per-company JSON**: lazy-load per profile, keeps initial bundle <700KB gzipped, scales linearly with company count.

---

## 5 · Technology stack

### Frontend

| Layer | Tool | Why |
|---|---|---|
| Framework | **React 19** | Stable concurrent rendering, Suspense for lazy detail loads |
| Bundler | **Vite 7** | 2-second cold builds, ESM-first, smaller bundles |
| Mobile shell | **Capacitor 8** | Same React bundle ships to iOS + Android. ML Kit barcode scanner integrated. |
| Search | **MiniSearch** | Client-side fuzzy search across 11k companies, ~80KB |
| Analytics | **PostHog** | Anonymous event tracking, free <1M events/mo. No PII. |
| Email capture | **MailerLite** (free <1k subs) | Pre-launch list building |
| Transactional email | **Resend** (free <3k/mo) | Welcome, "your brand was added" notifications |
| Hosting (web) | **Vercel** (free hobby) | Auto-deploys on every main push |
| iOS dist | **TestFlight → App Store** | Apple Developer Program ($99/yr) |

### Backend / data pipeline

| Layer | Tool | Why |
|---|---|---|
| Cron | **GitHub Actions** (free 2,000 min/mo) | Per-source workflows; commits results back to main; auto-deploys via Vercel hook |
| News extraction | **Anthropic Claude API** | Sonnet 4.6 extracts brand mentions + sentiment from RSS feeds. ~$20-50/mo at current volume. |
| Storage | **Git** (companies.json + per-company files) | Free; full diff history; no DB to run; reads happen at CDN edge via Vercel |
| Future revenue | **RevenueCat + Apple IAP** (free <$2.5k MRR) | One-time Pro upgrade; planned post-LLC |

### Repo structure

```
/src/
  App.jsx              # ~6000 lines, monolithic intentionally — single file for solo dev velocity
  MarketingLanding.jsx # Public marketing site at trunorthapp.com
  SplashScreen.jsx     # iOS splash
  companies.js         # Lazy-loaded company index (split from main bundle)
  lib/                 # analytics.js, marketing.js, theme.js
/public/data/          # All source-level + per-company JSON
  companies/           # 12,000+ files
  _meta/               # slug-aliases.json, brand-parent-map.json, merge logs
/scripts/              # All cron fetchers + mergers (~100 .mjs files)
/.github/workflows/    # 30+ cron workflows
/ios/                  # Capacitor iOS shell
/docs/                 # SOURCES.md, INVESTOR_BRIEF.md (this file), launch docs
```

### Code stats

- **App.jsx**: ~6,000 lines (intentionally monolithic for solo-dev velocity)
- **Total LOC**: ~50,000 (incl. ~25k in pipeline scripts)
- **Per-company JSON files**: 12,000+
- **GitHub Actions workflows**: 30+ active crons
- **Build size**: 700KB gzipped main bundle, 630KB gzipped company index

---

## 6 · Accounts & infrastructure inventory

> **All secrets stored in `.env` (git-ignored) and GitHub Actions Secrets. None included in this doc.**

| Service | Tier | Purpose | Cost |
|---|---|---|---|
| Apple Developer Program | Individual | iOS distribution, TestFlight, App Store | $99/yr |
| Vercel | Hobby (free) | Web hosting + marketing site | $0 |
| GitHub | Free | Source control + Actions + Secrets | $0 |
| Anthropic API | Pay-as-you-go | News extraction (Sonnet 4.6) | $20-50/mo |
| PostHog | Free <1M events/mo | Anonymous product analytics | $0 |
| MailerLite | Free <1k subscribers | Email list | $0 (paid plan $9-39/mo when triggered) |
| Resend | Free <3k emails/mo | Transactional email | $0 |
| Domain | Cloudflare/Namecheap | trunorthapp.com | ~$12/yr |
| OpenStates | Free w/ key | State-legislation API | $0 |
| WikiRate | Free w/ key | ESG aggregator (key requested 2026-06-04) | $0 |
| FEC.gov, EPA, OSHA, OpenFDA, NHTSA, etc. | Free | All 100 public-records sources | $0 |
| Capacitor / Ionic | OSS | Mobile shell | $0 |
| Anthropic Claude Code | Subscription | Solo-dev AI co-pilot | $20-200/mo (separately reported) |

**Monthly recurring burn**: **~$30-70/mo** (Anthropic API + domain).
**Annual fixed**: **$99 (Apple Dev) + $12 (domain) = $111/yr**.
**Total pre-revenue burn**: **<$100/mo all-in**.

### GitHub Secrets configured (Actions cron auth)

| Secret name | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | news-rss-nightly.yml | Sonnet 4.6 extraction |
| `MAILERLITE_API_KEY` | email signup flow | Server-side via Vercel edge function |
| `MAILERLITE_GROUP_ID` | email signup flow | Default group |
| `POSTHOG_API_KEY` | trending-cron.yml | Server-side analytics ingest |
| `OPENSTATES_API_KEY` | openstates-monthly.yml | State legislation API |
| `WIKIRATE_API_KEY` | wikirate-monthly.yml | **Requested 2026-06-04, awaiting reply** |

---

## 7 · Key technical decisions (defensibility)

1. **No backend**. All data is per-company JSON files served from Vercel's CDN edge. Zero database, zero ops cost, zero scaling concerns. Reads scale infinitely; writes happen once per cron run.

2. **Sub-brand → parent rollup**. The brand-parent-map.json (137 entries today, growing) means a search for "Aunt Jemima" lands on PepsiCo's grade. Competitors miss this; users hate "boycotting Aunt Jemima but accidentally rewarding the holding co."

3. **Profile-aware scoring**. `computeScore(company, profile)` runs client-side. Same company, different grades per user. Personalized without server-side compute.

4. **Neutral-data exclusion**. If we have no signal for a category, it's excluded from the grade entirely — not averaged as a 50. Prevents "thin-data → C grade by default" bias.

5. **Evidence overrides for badges**. Even when the categorical enum lags (Walmart's sc.guns = neutral), we route ATF FFL evidence (348 active dealer licenses) into the "Sells firearms" badge. The truth wins over the stale category tag.

6. **Open audit trail**. Every score traces to primary sources in the in-app Sources tab. We're betting that auditability wins trust against "vibes-based" competitors.

7. **No paid scraping**. We pay zero for data. If a competitor wants to replicate the 100-source pipeline, they need to write ~50 fetchers + mergers + workflows themselves. Time + expertise is the moat.

---

## 8 · Roadmap

### Pre-launch (next 19 days)

| Date | Milestone |
|---|---|
| Tue Jun 17 | Submit to Apple App Store (5-day review buffer) |
| Mon Jun 22 PM | PH launch-eve readiness check |
| Tue Jun 23 02:01 AM CDT | 🚀 Product Hunt launch |

### Post-launch (first 90 days)

- **Form LLC** (X-1) → enables RevenueCat IAP, MailerLite paid plan, business banking
- **Pro upgrade** ($0.99 one-time or $2.99/yr) — gates personalized scoring, full source list per company
- **Android launch** (Phase 6.a) — same Capacitor bundle, ~1-2 weeks of Play Store work
- **WikiRate API integration** once key arrives
- **Backlog: Apify Indeed scraper** ($10/mo) — adds employee-review signal

### Mid-term (90-180 days)

- **Compare 3-4 brands** (currently 2)
- **Browser extension** (Chrome/Safari) — shows grade overlay on Amazon, Walmart.com, etc.
- **Family/household sharing** (one Pro account, multiple profiles)
- **Public API** — opens the dataset to researchers, journalists (Stripe metering)
- **Postiz cross-poster** (B-27) — solo founder time savings

### Long-term moat-deepeners

- **Court case detail extraction** — currently we have case counts; next step is summarizing top 5 cases per company via Claude
- **Annual report parsing** — extract emissions, supplier names, EEO-1 data from 10-K Exhibit 21s and DEF 14As
- **Multi-language** — Spanish first (3M Hispanic shoppers in launch markets)
- **Receipt scanning** — point camera at receipt, get aggregate spend-by-grade report

---

## 9 · Market & TAM

- **US conscious-consumer market**: ~70M shoppers willing to switch brands over values (Nielsen 2024)
- **Mobile shopping intelligence apps**: ~$1.2B TAM (Yuka ~$50M ARR equiv; we target the broader values-aware audience, not just food/cosmetics)
- **Launch market**: US iOS (then Android post-launch)
- **Customer acquisition channel**: organic via PH launch, content (data deep-dives), partnership w/ values-aligned brands (Patagonia/Klean Kanteen scope)

### Comparable / adjacent

| App | Coverage | Sources | Personalization | Cost to user |
|---|---|---|---|---|
| **TruNorth** | 12k+ brands, 9 categories | **200+ primary** | Yes (the Match) | Free (Pro $0.99) |
| Yuka | ~2M food/cosmetic products | ~5 (mostly product-level) | No | Freemium |
| Buycott | ~250k brands | Crowdsourced | Campaign-based | Free |
| Good On You | ~3k fashion brands | Proprietary methodology | No | Freemium |
| Done Good | ~3k brands | Curated | No | Free |
| EWG | ~150k food/cosmetic products | Lab tests | No | Free |

We are the only one with **federal-regulator depth** + **profile-aware grading**.

---

## 10 · Team

**Solo founder**: Aron Rosenfield (US-based, Texas).
- Software/product/data — handles all engineering, design, copy, marketing.
- AI co-pilot: Anthropic Claude (via Claude Code) is the active second engineer.

**No employees, no contractors, no agency spend.**

---

## 11 · Financial summary

### Current (pre-launch)

- **MRR**: $0 (no monetization live yet)
- **Monthly burn**: ~$30-70 (Anthropic API + domain)
- **Annual fixed**: $111 (Apple Dev + domain)
- **Personal investment to date**: <$5k (founder time + tools subscription)
- **Outside capital raised**: $0

### Year-1 projection (conservative)

Assuming PH launch performance similar to peer indie apps (5k-15k downloads first 30 days):

| Scenario | Downloads Y1 | Pro conversion @ 2% | ARPU/yr | Annual revenue |
|---|---|---|---|---|
| Low | 25,000 | 500 | $0.99 | $495 |
| Base | 75,000 | 1,500 | $0.99 | $1,485 |
| High | 250,000 | 5,000 | $1.49 (price test) | $7,450 |

**This is not VC-scale revenue intentionally** — the freemium-conscious-consumer playbook depends on hitting 1M+ downloads before Pro economics matter. Y2-Y3 is where the unit economics inflect (browser extension + receipt scanning).

### Investment thesis for outsiders

**TruNorth is currently bootstrapped + capital-efficient by design**, but the right strategic check unlocks:

1. **Hire 1 data engineer** ($120k/yr) → 100 → 200 sources in 6 months, deeper court-case + 10-K parsing
2. **Marketing budget** ($50k) → influencer + content seeding to hit 500k downloads Y1
3. **Browser extension build** ($30k) → Chrome/Safari overlay on Amazon/Walmart drives engagement loop
4. **Receipt scanning** ($25k) → post-purchase value loop, sticky moments
5. **API productization** ($40k) → researchers, journalists, advocacy orgs pay for the dataset

**Ask range** (if pursuing): $250k-$500k seed (priced or SAFE), 18-month runway to 500k downloads + measurable Pro revenue.

---

## 12 · Risks & mitigations

| Risk | Mitigation |
|---|---|
| Apple App Store rejection at launch | Build 51 was rejected (IAP metadata + receipts); fixed via free-v1 safe mode + full resubmission package staged. Build 68 live on TestFlight; resubmission fires on founder go |
| Source endpoint changes (gov reshuffling URLs) | Per-source `*-fetch.mjs` scripts are isolated. Failures don't cascade. Repair time per source ~30 min |
| Cloudflare bot blocks on public sources | Already handled — workflows run on GH Actions IPs which clear most WAFs. Two sources behind heavy bot protection (BBB dropped; ConsumerAffairs not used) |
| Lawsuit threat from brands with bad grades | Every score traces to **primary public records**. We don't editorialize. Settled SCOTUS precedent (Hustler v. Falwell) protects factual reporting. Defamation insurance + privacy-policy lawyer review is X-5 in backlog |
| Solo-founder bus factor | All systems documented in `/docs/`. Backlog, sources doc, this brief, launch playbook all in-repo. New engineer onboards in <1 week |
| Anthropic API outage breaks news extraction | News is daily-refresh, non-critical. Other 99 sources unaffected. Multi-day outage just means stale news, not stale grades |
| Apple changes IAP rules | Pro upgrade is one-time $0.99 — minimal exposure. RevenueCat abstracts the IAP layer so swap to Stripe/web is fast if Apple changes terms |

---

## 13 · IP & legal

- **Code**: proprietary, all-rights-reserved. Repo private. Source control on GitHub (only the founder + AI co-pilot have commit access).
- **Trademarks**: TruNorth — common-law mark in use. Federal USPTO registration in queue post-LLC formation.
- **Domain**: trunorthapp.com — owned by founder, on Cloudflare DNS.
- **Apple Bundle ID**: `com.trunorth.app` — registered to founder under personal Apple Developer Program (transfers to LLC post-formation).
- **Privacy Policy**: at `https://www.trunorthapp.com/#privacy`. No PII collected by default; analytics anonymized through PostHog.
- **Open-source license dependencies**: all MIT/Apache 2.0 — no copyleft contamination. Full dependency tree in `package.json`.
- **Data sources licensing**: all 200+ sources are public-records (US federal/state government, EU/UK/CA/AU government, accredited nonprofits, open-data certifications). No paid feeds, no scraped private data.

---

## 14 · Diligence checklist (what to expect on a data-room ask)

| Item | Status |
|---|---|
| Source code repo access (read-only) | Granted on request |
| `/docs/SOURCES.md` — full source registry | ✅ in repo |
| `/docs/INVESTOR_BRIEF.md` — this doc | ✅ in repo |
| `/BACKLOG.md` — active work + roadmap | ✅ in repo |
| Apple Developer account proof | Available |
| Vercel / GitHub / domain registration proof | Available |
| PostHog dashboard access | Available |
| TestFlight build (current = 68) | Available |
| Privacy policy + terms | Live at `/#privacy` |
| Founder background / LinkedIn | Available |
| LLC formation docs | **Pending — to be filed post-launch** |
| Trademark filings | **Pending — to be filed post-LLC** |
| Pro revenue history | **N/A pre-launch — will be in App Store Connect after IAP enabled** |

---

## 15 · How this doc stays alive

This document is maintained as part of the dev loop. **Material changes trigger an update**:

- New data source shipped → SOURCES.md + this doc's source count
- Build number increment → "Status" line at top
- LLC filed → Section 13
- First revenue → Section 11
- New account/API → Section 6

The AI co-pilot updates this in the same commit as the underlying change, so the doc never lags more than ~1 hour behind production. The founder can edit directly anytime; AI respects edits.

**Last AI-driven sweep**: 2026-06-04 PM — added 52 new sources (Tiers 1-7) + Option B UI shipped + Build 46 keyboard fix.

---

*If you're reading this as a potential investor, partner, or acquirer: thank you for the time. Email `aron@trunorthapp.com` for follow-up questions, demo access, or data-room invitation.*
