# TruNorth Backlog

> **Single source of truth.** I (Claude) keep this up to date as we work. You can edit it directly anytime — I'll respect your edits.
>
> **How to use:** Open this file → say "let's do **L-3**" or "work on the next item under PRE-LAUNCH" or "what's blocked?"
>
> **Last updated:** 2026-06-02 PM

---

## ⏰ NEXT MILESTONES

| Date | Event |
|---|---|
| Tue, Jun 2 · 9 AM | SEO check-in reminder (Tuesday cadence) |
| Fri, Jun 5 · 9 AM | SEO check-in reminder (Friday cadence) |
| Mon, Jun 8 · 9 AM | SEO check-in reminder (Monday cadence) |
| **Tue, Jun 16 · 9 AM** | PH 1-week-out prep reminder |
| Tue, Jun 17 (target) | Submit to Apple App Store (gives ~5-day review buffer before launch) |
| **Mon, Jun 22 · 7 PM** | PH launch-eve readiness reminder |
| **Tue, Jun 23 · 2:01 AM CDT** | 🚀 **Product Hunt launch fires** |
| Tue, Jul 7 (est.) | Earliest Android shipping window (Phase 6.a) |

---

## 🔥 ACTIVE — working on now

*Nothing actively in progress. Pick an item from below and tell me to start.*

---

## 🚀 PRE-LAUNCH — do BEFORE June 23

8 items left, all on you. ~3 hours total work (+1-2 hr if you film the demo video).

| ID | Item | Effort | Why it matters |
|---|---|---|---|
| **L-1** | Pin Twitter tweet from `/docs/producthunt/PROMO_COPY.md` | 5 min | Hour-1 PH subscribers → launch-day votes |
| **L-2** | LinkedIn pinned post from same doc | 5 min | B2B reach |
| **L-3** | Personal email blast to 10-20 closest contacts | 30 min | Warmest hour-1 voters |
| **L-5** | Pick + install ONE email signature in Mac Mail | 5 min | Every cold email is a marketing surface |
| **L-7** | Activate Google Apps Script personalized auto-reply | 20 min | `/docs/gmail-personalized-autoreply-setup.md` — reduces email triage during launch |
| **L-8** | Daily 10-min PH "warming" routine (upvote 5-10, comment on 1) | 10 min/day × 22 days | PH algo rewards engaged accounts |
| **L-9** | Record 30-60 sec demo video for PH gallery | 1-2 hr | Demo videos boost PH conversion ~30% |
| ~~**L-12**~~ | ~~Add `MAILERLITE_API_KEY` to GitHub Actions secrets~~ | ✅ done 2026-06-01 | All 3 secrets verified: `MAILERLITE_API_KEY`, `MAILERLITE_GROUP_ID`, `POSTHOG_API_KEY` (the last for the trending cron, not Vercel). Names match what scripts read. |

**Send-on-Jun-16:** L-10 trade press pitches (drafts ready at `/docs/trade-press-pitches.md`).

---

## 🎯 LAUNCH DAY — June 23 only

Don't touch these until launch day. All scripted in `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md`.

| ID | Item | When (CDT) |
|---|---|---|
| **D-1** | Paste First Comment IMMEDIATELY after launch fires | 2:01 AM |
| **D-2** | Fire scheduled Twitter launch tweet | 2:05 AM |
| **D-3** | Fire scheduled LinkedIn launch post | 2:05 AM |
| **D-4** | Text 5 closest people the launch URL | 2:10 AM |
| **D-5** | Reply to every PH comment within 5 minutes | 2-6 AM |
| **D-6** | Indie Hackers post | 9 AM |
| **D-7** | Hacker News "Show HN" post | 9 AM |
| **D-8** | Reddit posts (r/SideProject, r/Anticonsumption) | 9 AM |
| **D-9** | Midday rank check + strategy adjust | 12 PM |
| **D-10** | Slack/Discord community pings | 3 PM |
| **D-11** | Final ping to network non-responders | 6 PM |

---

## 📅 POST-LAUNCH — first 2 weeks after PH

| ID | Item | Effort | Notes |
|---|---|---|---|
| **P-1** | Phase 6.a: Android launch via Capacitor | 7-9 hr + $25 | Plan at `/docs/ANDROID_LAUNCH_PLAN.md`. Blocked on iOS App Store launch. |
| **P-2** | Thank-you DMs to top 10 PH commenters | 1 hr | Day 2 |
| **P-3** | Results tweet ("Launched at #X on PH yesterday...") | 15 min | Day 2 |
| **P-4** | "Featured on Product Hunt" badge added to trunorthapp.com | 10 min | Day 2 — embed code in PH dashboard |
| **P-5** | Reach out to anyone who hit site with `?ref=producthunt` UTM | 30 min | Day 3-7 |
| **P-6** | Post-launch retro — what worked, top requested features | 1 hr | End of week 1 |
| **P-7** | Trade press follow-ups with launch results data | 1 hr | Week 2 |

---

## ⏸️ BLOCKED — waiting on external

| ID | Item | Blocked on |
|---|---|---|
| **X-0** | Flip `PRO_WAITLIST_MODE = false` to enable real IAP | RevenueCat live + LLC + bank (X-2). When done: single constant flip in `src/App.jsx` + verify Apple receipt validation in `handleSubscribe`. Currently the paywall captures waitlist signups with founder pricing ($9/yr first 500). |
| **X-1** | App Store URL in PH First Comment + landing CTA | Apple App Store approval (you submit, Apple reviews) |
| **X-2** | RevenueCat / Stripe / Apple IAP integration | TruNorthApp LLC + business bank account. Plan at `/docs/payments-integration-plan.md`. |
| **X-3** | Apify Indeed reviews scraper | $10/mo Apify subscription + `APIFY_API_TOKEN`. Code ready in hybrid-pipeline. |
| **X-4** | MailerLite paid plan | >1k subscribers OR >12k emails/month. Free tier covers us until then. |
| **X-5** | Annual + lifetime pricing tiers (UX 6C + 6D) | RevenueCat live (depends on X-2) |
| **X-6** | Push notifications (iOS APNs + FCM Android) | iOS launch settled first |

---

## 📋 BACKLOG — pick when relevant

Sorted by category. Each has an effort tag (S = <1hr, M = 1-4hr, L = day+).

### Audit deferrals (after the Jun 1 25-agent audit)

| ID | Item | Effort | Notes |
|---|---|---|---|
| **A-1** | **H3: Unified `openBrand(slug)` helper** | M | Brand-of-Day, Weekly Digest, Library, search-row taps all navigate differently. Extract one canonical helper, call from all 6+ entry points. Currently some land on focused-brand view, others dump into search list. |
| **A-2** | **H5: Modal a11y** | M | Compare / Scanner / WhatsNew / Paywall need `role="dialog"`, `aria-modal="true"`, focus trap on open, focus return on close, ESC to close. ConfirmModal already does this — promote to shared pattern. |
| **A-3** | **H13: Copy honesty + acronym pass** | M | Expand FEC / OSHA / NLRB / EPA on first use. Neutralize US-political-specific framing for international readers. Shorten dense sentences. Touch every screen's copy. |
| **A-4** | **H2: Backfill personalization signal for top 100 brands** | L | 85% of catalog has `neutral` or empty scores in every category, so quiz can't actually personalize them. Pipeline work in `/Users/aronrosenfield/Developer/hybrid-pipeline/`. Prioritize top-100 by PostHog impressions or curated list. |
| **A-5** | **H15: Bundle splitting (2.5MB companies + 4MB Tabler font)** | L | Lazy-load companies dataset, swap Tabler webfont for a sprite subset of the ~30 icons actually used. Risky — break dynamic imports / asset paths. |

### App / UX polish

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-1** | iPad tablet breakpoint | M-L | Plan at `/docs/tablet-breakpoint-plan.md`. iPhone-first is fine for launch. |
| **B-2** | Browser/Safari extension (UX 7C) — grade badge overlay on Amazon/Target/Walmart | L | Primer at `/docs/TruNorth-Tier-C-Browser-Extension-Primer.docx` |
| **B-4** | Break up App.jsx (UX 9A) — ~5,000 lines → component files | L | Refactor only; no user-facing change |
| **B-5** | JSDoc `@typedef` for Company shape (UX 9C) | M | Dev autocomplete win, no behavior change |

### Data / pipeline

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-7** | Sources behind VT: As You Sow, UK Gender Pay Gap, CPA-Zicklin, GDELT, KnowTheChain | M each | `parked_vt_backfill.md` |
| **B-8** | Quarterly full re-narrate of Tier 1 (top 1k) companies — Sonnet batch | S + $5-10 | `parked_update_cadence.md` |
| **B-9** | Annual HRC CEI + CDP A-List re-ingest | S | Set a yearly reminder |
| **B-10** | Drop Glassdoor source from any future planning | — | ToS forbids scraping, Cloudflare-blocked, prior lawsuits |
| **B-22** | **Sub-brand → parent slug mapping** for Option A merge | M | 278/528 top-500 slugs have no `/companies/<slug>.json` because they're sub-brands (Sprite→Coca-Cola, Mountain Dew→PepsiCo). Currently logged as orphans in `news/merge-log.json`. Add a `parentSlug` field in `top-500-brands.txt` or build a separate mapping JSON that the merge layer reads. |
| **B-23** | **Scoring rebake from `recent_events[]`** | M-L | The news merge layer writes structured events but doesn't mutate scores. Need a scoring engine that reads `recent_events[]` (weighted by severity × magnitude × evidence_strength × bias) and re-derives `sc.*` values. Run weekly to keep grades fresh without per-article volatility. |
| **B-24** | **AllSides outlet whitelist expansion** | S | Currently 33 outlets mapped. Many Tier-2 outlets (Axios, Politico, The Verge, Ars Technica) appear in high-signal results — add their bias ratings to `OUTLET_BIAS` in `news-rss-collect.mjs` for richer fact_driver coverage. |
| **B-25** | **Option B — fix BBB scraper letter extraction** | S-M | First live run hit 506/528 brands without errors, but the `letter` field is empty for all of them. CSS selector in `scripts/bbb-scrape.mjs` is stale — inspect a current BBB page (e.g. bbb.org/us/oh/cincinnati/profile/automotive-manufacturers/ford-motor-company-0292-0040002) and update the rating selector. Currently writes zero usable data. |
| **B-26** | **Option C — disambiguate CourtListener party search** | M | First live run produced wildly over-counted lawsuit numbers (Dawn dish-soap = 183k cases, Ford = 99k) because `party:"Brand"` matches every human plaintiff/defendant with that name. Options: (a) restrict to `nature_of_suit` codes for commercial cases, (b) require `party_type=corporation`, (c) post-filter by checking case docket against a corporate-name regex, (d) use CL's RECAP entity API instead of free text search. Currently writes data but it's not usable. |

### Scoring schema expansion

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-12** | Tax category (ITEP, Fair Tax Foundation, SEC 10-K parsing) | M | Decided to skip in Phase 1, reconsider post-launch |
| **B-13** | Supply-chain labor extension (BHRRC + KnowTheChain) — separate score from domestic Labor | M | `planned_scoring_expansion.md` |
| **B-14** | Cruelty-free / animal testing flags (Leaping Bunny, PETA) | S | Industry-conditional |
| **B-15** | Gun industry / tobacco / fossil-fuel financing flags | S | Easy boolean adds once schema reopened |
| **B-16** | BDS / Israeli military ties flags | M | Politically polarizing — skipped for v1 |
| **B-17** | CEO behavior dimension (Musk/Tesla case) | M | Opt-in dimension under political category |

### Marketing / growth

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-18** | Reddit/HN "behind the scenes" post (data pipeline deep dive) | M | Best fired ~1 week after PH launch as follow-up content |
| **B-20** | PostHog → daily KPI digest email | S | Built-in PH feature; just subscribe |
| **B-21** | "Worst of the week" / "Best of the week" social content (auto-generated) | M | Use `/public/data/weekly_changes.json` from Sunday digest |

### Infra / ops

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-24** | Privacy page review for CCPA/GDPR compliance pre-1k users | S | Already at `/#privacy`; lawyer review nice-to-have once revenue starts |
| **B-25** | k6 loadtest run once we have real DAU baseline | S | Script at `/scripts/loadtest.js`, GH Action ready (manual dispatch) |

---

## 💤 PARKED / FUTURE — not on critical path

| ID | Item | Why parked |
|---|---|---|
| **F-1** | Migrate to Supabase or any DB | Static JSON + Vercel covers 100k+ companies free. No reason to migrate. |
| **F-2** | OpenCorporates / Crunchbase / D&B integrations | All paid; doesn't justify cost. |
| **F-3** | Local Llama 3.1 8B narrative generation | ~89 hours/run for 10k. Haiku batch is cheaper + better quality. |
| **F-4** | Multiple Claude sessions in worktrees for parallel work | Only relevant when work fans out across non-conflicting code paths. Used when needed. |

---

## ⏰ DATA-FRESHNESS CADENCE — full system map

### Fully automated (GitHub Actions cron — runs without your involvement)

| Job | File | Cadence | What it does |
|---|---|---|---|
| Trending refresh | `.github/workflows/trending-refresh.yml` | Daily 06:00 UTC | PostHog → `/public/data/trending.json` |
| Sunday digest | `.github/workflows/weekly-digest.yml` | Sunday 14:00 UTC | MailerLite campaign of weekly grade changes |
| Loadtest | `.github/workflows/loadtest.yml` | Manual dispatch | k6 stress test |
| **News RSS (Option A)** | `.github/workflows/news-rss-nightly.yml` | Daily 04:00 UTC | 528 brands → 45k+ RSS items → 350+ high-signal → Claude AI extraction → merge into per-company `news[]` + `recent_events[]`. ~$0.50-1/run. |
| **BBB scrape (Option B)** | `.github/workflows/bbb-scrape-weekly.yml` | Sunday 16:00 UTC | Playwright pulls BBB rating + complaint count → `/public/data/bbb-ratings.json` |
| **CourtListener (Option C)** | `.github/workflows/courtlistener-weekly.yml` | Sunday 17:00 UTC | Free Law Project API → per-brand lawsuit counts → `/public/data/lawsuits.json` |

### Human-action reminders (scheduled — you'll get pinged)

| Date | Reminder | What |
|---|---|---|
| Jun 2, 5, 8 · 9 AM CDT | SEO check-ins | Google Search Console + sitemap status |
| **Jun 16 · 9 AM** | PH 1-week prep | Subscriber count + outreach + demo video |
| **Jun 22 · 7 PM** | PH launch eve | Pre-schedule social posts |
| **Jun 23 · 1:50 AM** | PH launch hour ☕ | Wake-up + 4-hour battle plan |
| **Jul 1 + monthly** | Cron health check | Verify GH Actions actually ran, no silent failures |
| **Sept 1 + quarterly** | Tier-1 re-narrate | Top-100 brand narratives refresh via Sonnet batch (~$10) |
| **Nov 15 + yearly** | HRC CEI re-ingest | Annual DEI scoring list (HRC publishes Nov-Dec) |
| **Feb 15 + yearly** | CDP A-List re-ingest | Annual climate disclosure list (CDP publishes Feb) |

Manage in sidebar under "Scheduled".

---

## ✅ RECENTLY SHIPPED (rolling, last 15)

Most recent at top.

1. **2026-06-02** — **Option A News pipeline LIVE end-to-end**: nightly cron pulls 528-brand Google News RSS (~45k articles) → keyword + AllSides-bias filter → Claude Sonnet AI extraction (~350 high-signal items/night, ~$0.50-1/run) → merge layer writes per-company `news[]` + `recent_events[]` (180-day TTL, 50-item cap). Score values NOT mutated automatically — separate scoring rebake consumes `recent_events[]`. Workflow: `news-rss-nightly.yml`. Files: `scripts/news-rss-collect.mjs`, `scripts/news-rss-extract.mjs`, `scripts/news-extracted-merge.mjs`.
2. **2026-06-02** — **Option B (BBB scrape) + Option C (CourtListener) workflows shipped**: weekly Playwright scrape of BBB ratings + weekly CourtListener API pull for lawsuit counts. Outputs: `/public/data/bbb-ratings.json`, `/public/data/lawsuits.json`.
3. **2026-06-02** — **Critical security incident handled**: 3 leaked API keys (Anthropic TruNorth Pipeline + PostHog Claude Diagnostic + Anthropic Conscious Consumer) revoked + rotated. Leak source `docs/API Key and Tokens.docx` scrubbed from git history via `git-filter-repo` + force-pushed clean main. `.gitignore` tightened so all `.env*` files blocked except `*.example`. Rotation verified end-to-end via manual workflow dispatch on 3 dependent crons.
4. **2026-06-02** — **528 hand-curated top-brand list** at `public/data/top-500-brands.txt` (14 tiers: CPG / household / restaurants / retail / apparel / tech / banking / telecom / auto / healthcare / travel / controversy / home / misc). Drives Options A/B/C scrapers.
5. **2026-06-01** — **25-agent audit shipped**: 343 raw findings synthesized → 5 critical / 15 high / 35 medium / 20 low / 15 wins. Full doc at `/docs/full-audit-2026-06-01.md`.
2. **2026-06-01** — **All 4 fixable critical bugs fixed** (5th = real IAP, blocked on LLC):
   • `__skipMarketing` ReferenceError white-screen fixed; root ErrorBoundary added
   • `tn_isPaid` localStorage persistence (Pro state survives relaunch)
   • Free-tier detail panel unlocked (removed `isPaid` gate); orphaned `tn_freeViewed` wipe killed
   • MailerLite write key moved off the client bundle into new `/api/subscribe` edge function
3. **2026-06-01** — **Waitlist pivot**: `PRO_WAITLIST_MODE` constant; paywall now captures founder-pricing email signups ($9/yr first 500) instead of fake-charging. App-Store-safe + intent-capturing. Flip the constant when real IAP lands.
4. **2026-06-01** — Marketing landing: founder pricing chip below hero CTA
5. **2026-06-01** — Account: "Delete my data" button (GDPR/CCPA-grade — wipes all `tn_*` keys + PostHog opt-out). Sign-out also clears email + user_hash + isPaid.
6. **2026-06-01** — Quiz retake hydrates from existing profile (audit H10)
7. **2026-06-01** — Paywall cooldown: sessionStorage → localStorage, 4h → 7d (audit H1)
8. **2026-06-01** — Email validation regex tightened; submit button disabled until valid (H8)
9. **2026-06-01** — `/privacy` 404 fixed (vercel rewrite + SPA path normalization, audit H12)
10. **2026-06-01** — `/api/submit` per-IP rate limit (5/min, 429+Retry-After, audit H14)
11. **2026-06-01** — Sources tab: removed dead "Live update" promise (H11)
12. **2026-06-01** — 7 small tap targets bumped to 44×44 minimum + Library `<select>` fontSize 12→16 (H4)
13. **2026-06-01** — L-12: GitHub Actions secrets verified (`MAILERLITE_API_KEY`, `MAILERLITE_GROUP_ID`, `POSTHOG_API_KEY`)
2. **2026-06-01** — Scroll-to-top on tab change (user-reported UX bug)
2. **2026-06-01** — PostHog env var rename `POSTHOG_API_KEY` → `VITE_POSTHOG_KEY` (was silently disabled)
3. **2026-06-01** — Vercel env vars audited; all critical keys verified (L-11)
4. **2026-06-01** — iOS Universal Links shipped end-to-end (Build 33): AASA + entitlements + manual provisioning + `appUrlOpen` handler + ship script hardened
5. **2026-06-01** — `ship-ios.sh` rewritten: bumps both Info.plist + pbxproj, re-injects entitlements after every `cap sync`, manual signing with explicit profile
6. **2026-06-01** — `formatCompanyCount()` helper — all "11,209" displays now "11,000+"
7. **2026-06-01** — Trending Now chips wired to nightly `/data/trending.json` (was hardcoded)
8. **2026-06-01** — OG image regenerated at correct 1200×630 (was 1500×500, every social share broken)
9. **2026-06-01** — Grade scale legend in Account (UX 5D) — answers "what does A/B/C/D/F mean" question
10. **2026-06-01** — Paywall Free vs Pro comparison table (UX 6B)
11. **2026-06-01** — App Store cutover playbook (B-26) + submission metadata doc
12. **2026-06-01** — Weekly digest opt-in card on Account (B-3)
13. **2026-06-01** — Failed-search "notify me when added" with brand-tagged MailerLite signup (B-11)
14. **2026-06-01** — Soft email ask after quiz completion (B-6) — highest-intent capture moment
15. **2026-06-01** — Locked picks: v1 Browse + v4 ProfileStrip + 1-free paywall; stripped unused variants

### Earlier this session (compressed)

- **2026-06-01** — Trade press pitches (L-10), MailerLite welcome drip (B-19), TikTok scripts (B-22) — all drafted in `/docs/`
- **2026-06-01** — Bug batch: Reveal "you" overflow, Privacy scroll, Splash 11,000+ rounding, Browse→Search empty, paywall first-tap, Brand of Day above Top Picks, paid Sources paragraph
- **2026-06-01** — OG/Twitter card copy sharpened ("public records" in first 10 words)
- **2026-06-01** — ProductHunt Coming Soon chip on marketing landing (L-6)
- **2026-06-01** — Email signatures regenerated with correct `Aron@trunorthapp.com` (L-4)
- **2026-06-01** — Master BACKLOG.md created · all 3 PH launch reminders scheduled
- **2026-05-31** — SEO foundation: sitemap (11,211 URLs), robots.txt, per-company SEO HTML with JSON-LD, Google Search Console + Bing verified
- **2026-05-31** — Resend DNS fully verified (SPF + DKIM + MX + DMARC PASS)
- **2026-05-31** — Capacitor switched to bundled dist/ (App Store ready) + ~16 TestFlight builds shipped (5-33)
- **2026-05-31** — Day-7 reflection · Values Fingerprint · Saved-brand badges · editorial Brand of Day · ConfirmModal · inline typeahead · Top Picks rearrange · email capture wiring
- **2026-05-28** — 6,050-company expansion + full neutrality overhaul shipped

---

## 📌 META — about this file

**Update protocol:**
- I update this file at the end of every working session when something ships, gets parked, or changes state.
- Completed items move to **RECENTLY SHIPPED** (capped at 15 latest) and drop from the active sections.
- New items get a fresh ID and land in the right section.
- IDs are stable — once assigned (e.g. `B-12`), they stay forever so old chat references survive.

**Resume phrases:**
- "Open the backlog" → I summarize the top sections
- "What's in PRE-LAUNCH?" / "What's BLOCKED?" → I summarize that section
- "Work on **L-3**" → I start that specific item
- "What's next?" → I look at ACTIVE → PRE-LAUNCH → BACKLOG (in that order) and suggest the highest-leverage item
- "Park **B-12**" → I move it to PARKED with a reason
- "Add task: [description]" → I add it with a fresh ID

**Source files this consolidates (kept on disk for deep history):**
- `~/.claude/projects/.../memory/roadmap.md` — master 6-phase plan
- `~/.claude/projects/.../memory/parked_ux_perf_list.md` — original 9-section UX list 1A–9D
- `~/.claude/projects/.../memory/parked_vt_backfill.md` — data pipeline
- `~/.claude/projects/.../memory/parked_scale_to_10k.md` — 12-step zero-cost plan
- `~/.claude/projects/.../memory/parked_update_cadence.md` — tiered cron refresh
- `~/.claude/projects/.../memory/parked_analytics_marketing.md` — PostHog/MailerLite/Resend
- `~/.claude/projects/.../memory/planned_scoring_expansion.md` — new categories/flags
- `~/.claude/projects/.../memory/launch_2026_05_28.md` — launch notes archive
- `/docs/ANDROID_LAUNCH_PLAN.md`
- `/docs/SEO_STRATEGY.md`
- `/docs/payments-integration-plan.md`
- `/docs/tablet-breakpoint-plan.md`
- `/docs/app-store-submission.md`
- `/docs/app-store-cutover.md`
- `/docs/trade-press-pitches.md`
- `/docs/mailerlite-welcome-drip.md`
- `/docs/tiktok-reels-content-scripts.md`
- `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` + `/docs/producthunt/PROMO_COPY.md`
