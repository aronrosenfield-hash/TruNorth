# TruNorth Backlog

> **Single source of truth.** Claude keeps this current. You can edit it directly anytime — edits are respected.
>
> **How to use:** Open this file → say "let's do **L-3**" or "what's blocked?" or "what's the next highest-leverage item?"
>
> **Last updated:** 2026-06-08 PM — **37 PRs merged today** (26 → 62) + PR #63 round 2 ready. Open PRs: **1** (#63). Workflows: **143** (+44 today). Scripts: **373** (+~79 today). TestFlight: **Build 51** in your hands. **15 days to launch.**

---

## 🔴 NEEDS YOUR DECISION — TODAY

### 1. Build 53 — overnight progress report (Aron wakes up to this)

**Build 52 still on your phone.** Build 53 is **75% ready** — needs your nav-restructure call + ship approval.

**✅ DONE overnight (merged + pushed to main):**
- PR #64 merged: brand-parent-map +1,980 entries (4,738 → 6,718). Bush's Best, Heinz, KitKat→Hershey (corrected), Planters→Hormel (corrected), Pop-Tarts, French's, etc. all resolve now.
- PR #65 merged: static `upc-to-slug.json` cache with **3,937 UPCs** baked into the IPA. Bush's Best 53 SKUs included. Instant + offline lookup.
- **B: No-match → Search fallback** — scanner overlay now shows "Search for [Brand]" button when OFF/UPCitemdb returns a brand but we can't map it. Never a dead-end. (commit `dcfa9dc5b`)
- **D: UPCitemdb Tier-3 fallback** — when OFF returns nothing, fall through to UPCitemdb's free trial endpoint (100 lookups/day, no API key). Wrapped in try/catch.
- **Search-bug fix** (`aa4c1a941`) — focusedSlug releases when query changes.
- 7/7 scanner tests pass. `vite build` clean.
- Build number persisted (47→52 was lost from git previously; now committed so next ship-ios bumps cleanly to 53).

**⏸️ WAITING ON YOUR EYEBALL:**
- **C: Nav restructure** — your spec was "SCAN as middle bottom-nav slot · Account top-right corner next to Upgrade with an icon." Need a 30-second eyeball on which icon for Account (likely `ti-user-circle` to match Upgrade's crown) + confirm I should swap the Account tab out of bottom nav. I held the change because it touches every screen.
- **Build 53 ship** — once C lands, `./scripts/ship-ios.sh` fires.

**🎯 Tuesday morning action when you wake up:**
1. Read this section (you're here ✓)
2. Approve nav-restructure execution (or tweak my plan)
3. I implement C in 30 min
4. You run `./scripts/ship-ios.sh` → Build 53 to TestFlight in 15 min
5. Test Bush's Best UPC + a couple others to confirm the scanner is fixed

### 2. L-2 LinkedIn pinned post (5 min — Twitter pin is up; LinkedIn audience won't see it)
- **Copy:** `/docs/producthunt/PROMO_COPY.md` → "Pinned LinkedIn post" section. Same vibe as your X pin.
- **Where:** Your LinkedIn personal profile → Activity → Featured → + → Post → paste → pin.

### ✅ Resolved earlier today
- ~~**PR #63 — banner design fix**~~ → **merged** 2026-06-08 (commit `acf0649a1`). Round 1 + round 2 (desat purple + reclassify 5 + Chipotle name) all in.
- ~~**PR #19 — Glassdoor**~~ → **closed** 2026-06-08, parked as F-5.
- ~~**MailerLite Vercel env var**~~ → **fixed days ago** (Aron confirmed). `/api/subscribe` healthy.
- ~~**L-1 Twitter pinned post**~~ → **done** 2026-06-08 PM with promo video.

---

## ⏰ COUNTDOWN TO LAUNCH

| Date | Event |
|---|---|
| **Tue Jun 9 · 9 AM CDT** | ITEP follow-up to Amy Hanauer (auto-reminder) |
| **Tue Jun 9 · 1 PM CDT** | Egregious 15:15 polarity rebalance (auto-reminder) |
| **Fri Jun 13** | Final `ship-ios.sh` → Build N for App Store submission |
| **Sat Jun 14** | Submit Build N to App Review |
| **Mon Jun 16 · 9 AM CDT** | (a) PH 1-week prep, (b) coverage measurement after Tier-S crons run (auto-reminder) |
| **Mon Jun 16** | Toggle scoring-flags feature ON (24h stability watch) |
| **Tue Jun 17** | Cut final App Store build if flags stable |
| ~Jun 18-22 | Apple review (avg 24-48h, buffer for re-submit) |
| **Mon Jun 22 · 7 PM** | PH launch eve reminder |
| **Tue Jun 23 · 1:50 AM CDT** | Launch hour wake-up |
| **Tue Jun 23 · 2:01 AM CDT** | 🚀 **Product Hunt launch fires** |
| ~Jul 7 | Earliest Android shipping window (P-1) |

---

## 🚀 PRE-LAUNCH — YOU MUST DO (manual)

| ID | Item | Effort | Why |
|---|---|---|---|
| ~~**L-1**~~ | ~~Pin Twitter tweet~~ | ✅ done 2026-06-08 PM | Live on @TruNorthapp with 0:23 promo video. |
| **L-2** | LinkedIn pinned post from same doc | 5 min | B2B reach |
| **L-3** | Personal email blast — 10-20 closest contacts | 30 min | Drafted at `/docs/L-3-email-blast-checklist.md` — recipients + tracker ready |
| **L-7** | Activate Gmail Apps Script personalized auto-reply | 20 min | `/docs/gmail-personalized-autoreply-setup.md` — reduces email triage during launch |
| **L-8** | Daily 10-min PH "warming" routine (upvote 5-10, comment on 1) | 10 min/day × 15 days | PH algo rewards engaged accounts |
| **L-9** | Record 30-60s demo video for PH gallery | 1-2 hr | Pipeline at `~/.claude/.../teetime-bot-project.md` peer doc (`promo-video-pipeline.md`) — covers what to recapture when app screens change |
| **L-10** | Trade press pitches — send Mon Jun 16 | 30 min | Drafts ready at `/docs/trade-press-pitches.md` |
| ~~**L-5**~~ | ~~Pick + install ONE email signature~~ | ✅ done 2026-06-03 | `/docs/email-signature.html` installed |
| ~~**L-12**~~ | ~~MailerLite key in GitHub Actions secrets~~ | ✅ done 2026-06-01 | (Vercel runtime env is a separate item — see Decision #4 above) |

---

## 🎯 LAUNCH DAY — June 23 ONLY (don't pre-fire)

All scripted in `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md`.

| ID | Item | When (CDT) |
|---|---|---|
| **D-1** | Paste First Comment IMMEDIATELY after launch fires | 2:01 AM |
| **D-2** | Fire scheduled Twitter launch tweet | 2:05 AM |
| **D-3** | Fire scheduled LinkedIn launch post | 2:05 AM |
| **D-4** | Text 5 closest people the launch URL | 2:10 AM |
| **D-4b** | Swap LinkedIn personal headline to launch-day version | 7 AM |
| **D-5** | Reply to every PH comment within 5 min | 2-6 AM |
| **D-6** | Indie Hackers post | 9 AM |
| **D-7** | Hacker News "Show HN" post | 9 AM |
| **D-8** | Reddit posts (r/SideProject, r/Anticonsumption) | 9 AM |
| **D-9** | Midday rank check + strategy adjust | 12 PM |
| **D-10** | Slack/Discord community pings | 3 PM |
| **D-11** | Final ping to network non-responders | 6 PM |

---

## ⏸️ BLOCKED — waiting on external

| ID | Item | Blocked on |
|---|---|---|
| **X-0** | Flip `PRO_WAITLIST_MODE = false` to enable real IAP | RevenueCat live + LLC + bank (X-2). Single constant flip in `src/App.jsx` once unblocked. |
| **X-1** | App Store URL in PH First Comment + landing CTA | Apple App Store approval (target: Jun 17 submit, Jun 22 approve) |
| **X-2** | RevenueCat / Stripe / Apple IAP integration | TruNorthApp LLC + business bank account. Plan at `/docs/payments-integration-plan.md`. |
| **X-3** | Apify Indeed reviews scraper | $10/mo Apify subscription + `APIFY_API_TOKEN` |
| **X-4** | MailerLite paid plan | >1k subscribers OR >12k emails/month |
| **X-5** | Annual + lifetime pricing tiers | RevenueCat live (depends on X-2) |
| **X-6** | Push notifications (iOS APNs + FCM Android) | iOS launch settled first |
| **X-7** | ITEP citation approval | Sent to Amy Hanauer (`itep@itep.org`). Follow-up auto-reminder Tue Jun 9 · 9 AM CDT. |

---

## 📅 POST-LAUNCH — first 2 weeks

| ID | Item | Effort | Notes |
|---|---|---|---|
| **P-1** | Phase 6.a: Android launch via Capacitor | 7-9 hr + $25 | `/docs/ANDROID_LAUNCH_PLAN.md`. Blocked on iOS App Store launch. |
| **P-2** | Thank-you DMs to top 10 PH commenters | 1 hr | Day 2 |
| **P-3** | Results tweet ("Launched at #X on PH yesterday…") | 15 min | Day 2 |
| **P-4** | "Featured on PH" badge on trunorthapp.com | 10 min | Day 2 — embed code in PH dashboard |
| **P-5** | Outreach to `?ref=producthunt` UTM visitors | 30 min | Day 3-7 |
| **P-6** | Post-launch retro — what worked, top requests | 1 hr | End of week 1 |
| **P-7** | Trade press follow-ups with launch results data | 1 hr | Week 2 |
| **P-8** | Swap LinkedIn headline to **1-week-after** version | 2 min | Day 7 (Jun 30) |
| **P-9** | Swap LinkedIn headline to **1-month-after** version | 2 min | Day ~30 (Jul 23) |

---

## 📋 BACKLOG — pick when relevant

Sorted by category. Effort tags: **S** = <1 hr · **M** = 1-4 hr · **L** = day+

### Audit deferrals (from Jun 1 25-agent audit)

| ID | Item | Effort | Notes |
|---|---|---|---|
| ~~**A-1**~~ | ~~Unified `openBrand(slug)` helper~~ | ✅ done 2026-06-02 | |
| ~~**A-2**~~ | ~~Modal a11y (focus trap + ESC + return)~~ | ✅ done 2026-06-02 | |
| ~~**A-3**~~ | ~~Copy honesty + acronym pass~~ | ✅ done 2026-06-02 | |
| **A-4** | Backfill personalization signal for top 100 brands | L · $15-60 | Procedure at `/docs/A-4-backfill-procedure.md`. Sample (Jun 3): 24/41 top-100 brands have all-neutral scores. Run requires API budget approval. |
| **A-5** | Bundle splitting (2.5MB companies + 4MB Tabler font) | L | Lazy-load companies dataset; swap Tabler webfont for sprite. Risky — could break dynamic imports/asset paths. |

### App / UX polish

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-1** | iPad tablet breakpoint | M-L | `/docs/tablet-breakpoint-plan.md`. iPhone-first is fine for launch. |
| **B-2** | Browser/Safari extension — grade badge overlay on Amazon/Target/Walmart | L | Primer at `/docs/TruNorth-Tier-C-Browser-Extension-Primer.docx` |
| **B-4** | Break up App.jsx (~5,000 lines → component files) | L | Refactor only |
| **B-5** | JSDoc `@typedef` for Company shape | M | Dev autocomplete win |
| ~~**B-31**~~ | ~~Account → Edit email~~ | ✅ done 2026-06-05 | |
| ~~**B-32**~~ | ~~Email signature HTML template~~ | ✅ done 2026-06-05 | |
| ~~**B-33**~~ | ~~Sources tab — hide behind Pro~~ | ✅ done 2026-06-05 | |
| ~~**B-34**~~ | ~~Group ID 189038375757415926~~ | ✅ resolved (doc artifact) 2026-06-05 | |

### Scoring / data

| ID | Item | Effort | Notes |
|---|---|---|---|
| ~~**B-22**~~ | ~~Sub-brand → parent slug mapping~~ | ✅ done 2026-06-03 | |
| **B-23** | Scoring rebake from `recent_events[]` | M-L | News merge writes events; scoring engine doesn't consume yet. Weekly cron to keep grades fresh. **Partially unblocked by PR #51 (scoring flags now live, OFF by default).** |
| **B-24** | AllSides outlet whitelist expansion | S | 33 outlets mapped today. Axios/Politico/The Verge/Ars Technica still missing. Add to `OUTLET_BIAS` in `news-rss-collect.mjs`. |
| ~~**B-25**~~ | ~~BBB scraper letter extraction~~ | ✅ done 2026-06-03 | (Source itself retired in favor of CFPB.) |
| ~~**B-26**~~ | ~~CourtListener party disambiguation~~ | ✅ done 2026-06-03 | |
| ~~**B-27**~~ | ~~CA AG enforcement-actions scrape~~ | ✅ done 2026-06-06 | |
| **B-28** | Skip state AG complaint DBs (CA/NY/IL/FL/TX) | — | Surveyed: no public per-company complaint records. Resolved-not-feasible. |
| **B-29** | Skip FTC Sentinel + EEOC + ConsumerAffairs | — | Surveyed: law-enforcement-only / statutorily confidential / bot-protected. Not buildable without paid infra. |
| ~~**B-30**~~ | ~~VT v2 (per-state + YoY + recent_top5 + active)~~ | ✅ done 2026-06-06 | |
| ~~**B-30b**~~ | ~~UPS slug alias~~ | ✅ done 2026-06-07 | |
| ~~**B-37**~~ | ~~ATF FFL entity-resolution rebuild~~ | ✅ done 2026-06-06 | |
| ~~**B-37b**~~ | ~~Rewrite atf-fetch.mjs to v2 schema~~ | ✅ done 2026-06-07 | |
| **B-37c** | Auto-download ATF FFL CSVs (page scrape) | M | URLs change monthly. Manual drop into `public/data/_raw/atf-ffl/` for now. |
| ~~**B-38**~~ | ~~News-extract pipeline producing 0 high-signal items~~ | ✅ done 2026-06-07 | NEEDS_CONTEXT_BRANDS + NEGATIVE_CONTEXT logic. Pipeline UNFROZEN. |
| ~~**B-43**~~ | ~~OUTLET_BIAS canonical sync (news-rss-collect.mjs)~~ | ✅ done 2026-06-08 | Commit 8f9bb0c6f. Methodology comment + 3 right-of-center additions (NR→0.7, Reason 0.75, Free Beacon 0.5). |
| **B-44** | Re-render Tesla ITEP mockup after URL fix | S | Auto-task scheduled Tue Jun 9 · 9 AM. |
| **B-45** | Egregious 15:15 polarity rebalance (1:1 mix) | S | Auto-task scheduled Tue Jun 9 · 1 PM. Currently 20 negative + 10 positive. |
| **B-46** | Coverage measurement after Tier-S crons stabilize | S | Auto-task scheduled Mon Jun 16 · 9 AM. Writes `/docs/coverage-measurement-2026-06-16.md`. |
| ~~**B-47**~~ | ~~Re-fetch cleaner mark-only logo PNGs for Starbucks + Acura~~ | ✅ resolved 2026-06-08 PM | Solved differently — Aron reclassified Acura as wordmark (the cached PNG IS the canonical brand-identity expression for him). Starbucks left as-is; it looks fine in contact sheet. |
| **B-50** | Negative banner palette pinned to desat purple (`#5d54a6`/`#463f7d`) | — | Decided 2026-06-08 PM. Env-var override preserved. If you want to test another palette pre-launch, run `PURPLE=#xxx PURPLE_DEEP=#xxx node scripts/build-egregious-banners.mjs`. |
| **B-51** | Chipotle facts entry shortened (`Chipotle Mexican Grill` → `Chipotle`) | ✅ done 2026-06-08 PM | Long name was overflowing iOS splash brand-identity area at font 140. Stat copy still names "Chipotle Mexican Grill" for legal identity. |
| **B-52** | Auto-fit text in renderer for future long brand names | S | Defer post-launch. Quick template: `textLength + lengthAdjust="spacingAndGlyphs"` on the SVG brand-name `<text>`. Affects ~0 brands today (we shortened the one offender) but a future egregious add could hit this. |
| ~~**B-53**~~ | ~~Search bug: focusedSlug stuck after openBrand~~ | ✅ done 2026-06-08 PM (`aa4c1a941`) | Ships in Build 53. |
| ~~**B-54**~~ | ~~Scanner: brand-parent-map expansion (+1,980 entries)~~ | ✅ done 2026-06-09 AM (PR #64, `15d8c4b6b`) | 4,738 → 6,718 entries. Bush's, Heinz, French's, Pop-Tarts, KitKat→Hershey (correction), Planters→Hormel (correction). |
| ~~**B-55**~~ | ~~Scanner: static UPC→slug cache (3,937 entries)~~ | ✅ done 2026-06-09 AM (PR #65, `b8e610698`) | Baked into IPA. Bush's Best 53 SKUs included. Instant + offline lookup. Monthly cron via `scripts/build-upc-cache.mjs`. |
| ~~**B-56**~~ | ~~Scanner: no-match fallback to brand-name search~~ | ✅ done 2026-06-09 AM (`dcfa9dc5b`) | When OFF/UPCitemdb returns a brand but no parent match, primary "Search for [Brand]" button pre-fills query + jumps to Search tab. Yuka-style no-dead-end. |
| ~~**B-57**~~ | ~~Scanner: nav restructure — SCAN as bottom-nav middle slot~~ | ✅ done 2026-06-09 AM (`243f67051`) | Bottom-nav: [Top Picks] [Search] [**SCAN**] [Browse] [Library]. SCAN renders as a purple circular FAB-style button bumped above the nav line with drop-shadow. Account moved to top-right header (ti-user-circle icon next to Upgrade pill). Upgrade pill now opens Paywall directly instead of routing through Account tab. |
| ~~**B-58**~~ | ~~Scanner: UPCitemdb Tier-3 fallback API~~ | ✅ done 2026-06-09 AM (`dcfa9dc5b`) | Free trial endpoint (100/day per-IP, no key). Hit when OFF returns nothing. Wrapped in try/catch — silent on failure. |
| **B-59** | Coverage-correction call-out in docs/landing | S | My earlier "11k companies all have 7 scored categories" claim was misleading. Honest distribution: 84% have only 3-5 real public-records data points. Update talk tracks accordingly post-launch. |

### Scoring schema expansion

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-12** | Tax category (ITEP, FTF, SEC 10-K parsing) | M | PR #34 shipped ITEP pipeline **dormant** pending license clarity. Activate when X-7 lands. |
| **B-13** | Supply-chain labor extension (BHRRC + KnowTheChain) | M | Separate score from domestic Labor. `planned_scoring_expansion.md` |
| ~~**B-14**~~ | ~~Cruelty-free / animal testing flags~~ | ✅ done 2026-06-08 | Bird Friendly + AWA shipped in PR #45. |
| **B-15** | Tobacco / fossil-fuel financing flags | S | Easy boolean adds. (Firearms shipped in PR #20.) |
| **B-16** | BDS / Israeli military ties flags | M | Politically polarizing — skipped for v1. |
| **B-17** | CEO behavior dimension (Musk/Tesla case) | M | Opt-in dimension under political. SEC 8-K Items 5.02/4.02 (PR #36) lays groundwork. |

### Marketing / growth

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-18** | Reddit/HN "data pipeline deep dive" post | M | Fire ~1 week after PH launch as follow-up content |
| **B-20** | PostHog → daily KPI digest email | S | Built-in PH feature; subscribe |
| **B-21** | "Worst/Best of the week" auto-social content | M | Use `/public/data/weekly_changes.json` from Sunday digest |
| **B-41** | Set up Postiz self-hosted cross-poster | M | Railway free tier. Cross-platform to X/LinkedIn/Threads/IG/FB/Bluesky. Defer until post-launch traction. **(renumbered from duplicate B-27)** |
| ~~**B-42**~~ | ~~PostHog reverse proxy via subdomain~~ | ✅ done 2026-06-04 | `ph.trunorthapp.com` → `us.i.posthog.com`. **(renumbered from duplicate B-28)** |

### Infra / ops

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-39** | Privacy page review for CCPA/GDPR pre-1k users | S | Already at `/#privacy`; lawyer review nice-to-have once revenue starts. **(renumbered from duplicate B-24)** |
| **B-40** | k6 loadtest run with real DAU baseline | S | Script + GH Action ready (manual dispatch). **(renumbered from duplicate B-25)** |
| ~~**B-35**~~ | ~~Country-level geo-block (RU/BY/CN/KP/IR/SY/CU/VE → 451)~~ | ✅ done 2026-06-05 | `middleware.js`. |
| ~~**B-36**~~ | ~~Pre-launch load test (single-IP)~~ | ✅ done 2026-06-07 | k6 reduced to 150 VUs (realistic single-IP). 78ms avg / 282ms p95. |
| ~~**B-36b**~~ | ~~Diagnose loadtest 94% failure rate~~ | ✅ done 2026-06-07 | Root cause: per-IP rate limit from single GH Actions IP. Not real-world. |
| **B-36c** | Distributed loadtest at 1000+ VUs (k6 Cloud / BlazeMeter) | M · $ | True 1000-concurrent stress needs many IPs. Defer until post-launch. |
| **B-48** | Retire old `ofac-fetch.mjs` / `ferc-fetch.mjs` / `dol-whd-fetch.mjs` | S | Replaced by DW-7-12 new pattern. Confirmed safe to coexist; cleanup PR after Jun 14 verification window. |
| **B-49** | Verify 44 new crons (today) each ran successfully on schedule | S | Check Jun 14 — every workflow added Jun 7-8. |

---

## 🎯 SCORING-FLAGS PRE-LAUNCH ROLLOUT — IN FLIGHT

3-PR sequence to ship `na` / `notDisclosed` / `_inferred` flags safely before Jun 23. Full plan at `/docs/pre-launch-scoring-flags-plan.md`.

| Step | What | State |
|---|---|---|
| PR-1 (#?) | Scoring engine audit | ✅ merged |
| PR-2 (#27) | Add `flags` field to data (no UI) | ✅ merged |
| PR-3 (#51) | UI rendering + grade math behind feature flag | ✅ merged (flag OFF) |
| **Toggle ON** | Flip `scoringFlagsEnabled` in `/data/_meta/feature-flags.json` | **Mon Jun 16** (24h stability watch) |
| **App Store cut** | Final TestFlight + App Review submission | **Tue Jun 17** if flags stable |

---

## 🎯 DATA-DEPTH WAITLIST — STATUS POST-JUN-8

The 60-source ranked candidates from Jun 7 research. **Tier S sprint is COMPLETE** (DW-1 through DW-17 all shipped 2026-06-08). Many Tier A items also shipped today (see ✅ below). Remaining items deferred to post-launch.

### Tier S — Quick wins → **ALL SHIPPED 2026-06-08**

| ID | Source | PR |
|---|---|---|
| ✅ DW-1 | SBTi Target Dashboard | (merged) |
| ✅ DW-2 | WBA Social Benchmark | (merged) |
| ✅ DW-3 | Forest 500 | (merged) |
| ✅ DW-4 | 50/50 Women on Boards | (merged) |
| ✅ DW-5 | USDA Organic Integrity DB | (merged) |
| ✅ DW-6 | USDA FSIS Recall API | (merged) |
| ✅ DW-7..12 | OFAC SDN, BIS Entity List, FERC, DOL WHD, Energy Star, 1% for the Planet | #2 + augments |
| ✅ DW-13..17 | Disability:IN, CFTC, UK ICO, Singapore MAS, Canada Competition Bureau | #25 |

### Tier A — Shipped today

| ID | Source | PR |
|---|---|---|
| ✅ DW-19 | Carbon Majors (via Climate TRACE) | #48 |
| ✅ DW-26 | FMCSA Motor Carrier Safety | #42 |
| ✅ DW-29 | (covered by IIHS + FSIS combo) | #35 + ✅DW-6 |
| ✅ DW-33 | (groundwork — FDAAA Trials) | #43 |
| ✅ DW-39 | Certified Humane + AWA | #45 |
| ✅ DW-42 | Cornell ILR Labor Action Tracker | #40 |
| ✅ DW-44 | WWF Sustainable Palm Oil (RSPO partial) | #37 |
| ✅ DW-50 | NLRB voluntary recognition (positive labor) | #41 |
| ✅ DW-57 | Better Cotton Initiative | #45 |

### Tier A — Still open (defer to post-launch unless quick win)

| ID | Source | Effort | Why hold |
|---|---|---|---|
| DW-18 | InfluenceMap / LobbyMap anti-climate-policy scores | M | High-value greenwasher detection. Worth a sprint week 2. |
| DW-20 | EEOC Litigation Resolutions | S | TruNorth DEI has zero enforcement signal today. **High-leverage post-launch.** |
| DW-21 | IRS Form 990 (via ProPublica API) | M | Bumps charity % coverage from ~5% to ~50%. |
| DW-22 | KnowTheChain Forced Labor Benchmark | M | Apparel + ICT depth |
| DW-23 | Corporate Human Rights Benchmark | M | Non-US extractives + auto |
| DW-24 | BHRRC API upgrade (50k stories daily) | S | We have static; live API is daily refresh |
| DW-25 | Mighty Earth Deforestation Trackers (Soy + Cattle + Palm) | M | Satellite-verified Cargill/JBS/Bunge attribution |
| DW-27 | PHMSA Pipeline Enforcement | S | Note: data(phmsa) snapshot is already running daily — wire it up. |
| DW-28 | FTC Cases & Proceedings | M | US consumer-protection backbone |
| DW-30 | Australia ACCC + ASIC | M | 2026 ACCC priority = greenwashing enforcement |
| DW-31 | Banking on Climate Chaos | S | Annual June refresh |
| DW-32 | Ranking Digital Rights | S | 14 platforms; rare to score >50/100 |
| DW-34 | OCC + FDIC Enforcement | S | Chase/Wells/Citi enforcement |
| DW-35 | FCC Enforcement Bureau Forfeitures | S | TCPA + location-data fines |
| DW-36 | EWG Skin Deep beauty DB | M | Scanner UX win |
| DW-37 | EPEAT Registry | S | Scanner UX for electronics |
| DW-38 | Non-GMO Project Verified | S | Highest US seal after Organic |
| DW-40 | OU/OK/Star-K Kosher Search | M | Zero religious-dietary today |
| DW-41 | V-Label Certified (vegan/vegetarian) | M | International Leaping Bunny equivalent |
| DW-43 | ICIJ Offshore Leaks DB | M | Panama/Pandora/Paradise governance opacity |
| DW-45 | Regenerative Organic Certified | S | +22% YoY 2025 |
| DW-46 | Bonsucro (sugar) | S | Sugar is 2nd most ubiquitous commodity |
| DW-47 | Climate Label | S | Only consumer-facing carbon label |
| DW-48 | Cradle to Cradle Certified | S | Premium home goods |
| DW-49 | DOL TVPRA list (204 goods × 82 countries) | M | Cross-reference ingredient origins |

### Tier B — Specialist (DW-51..60) — defer indefinitely or pick selectively

DW-51 As You Sow Fund Lists · DW-52 BaFin (Germany) · DW-53 FCA (UK) · DW-54 KFTC (Korea) · DW-55 SEBI (India) · DW-56 S. Africa Competition Tribunal · DW-58 Demeter Biodynamic · DW-59 Bird-Friendly Smithsonian coffee · DW-60 GAP 5-Step Manufacturers.

**Recommendation:** Don't add anything else pre-launch. Lock the source list at 143 workflows for stability. Resume DW-18, DW-20, DW-21 the week after launch.

---

## 💤 PARKED — not on critical path

| ID | Item | Why |
|---|---|---|
| **F-1** | Migrate to Supabase / any DB | Static JSON + Vercel covers 100k+ free |
| **F-2** | OpenCorporates / Crunchbase / D&B | All paid, doesn't justify cost |
| **F-3** | Local Llama 3.1 8B narrative gen | ~89 hr per 10k brands; Haiku batch is cheaper + better |
| **F-4** | Multiple Claude sessions in worktrees | Only when work fans out across non-conflicting paths |
| **F-5** | Glassdoor employee ratings | ToS forbids scraping; Cloudflare-blocked; prior lawsuits. (PR #19 is the open vehicle — recommend close.) |

---

## 🤖 OPEN BACKGROUND AGENTS

| Agent | Status | Notes |
|---|---|---|
| Banner design fix: logo redundancy + gradient boundary | ✅ complete (round 1 + round 2) | PR #63 ready to merge — round 2 applied desat purple + reclassified 5 brands + Chipotle name fix |
| (No other agents in flight) | | |

---

## ⏰ DATA-FRESHNESS CADENCE — 143 workflows now

### Daily (UTC)
News RSS (04:00) · Trending refresh (06:00) · OFAC SDN snapshot · MSHA refresh · PHMSA refresh · BIS Entity List · trending augments

### Weekly (Sunday UTC)
CourtListener (17:00) · CFPB (18:00) · NHTSA (19:00) · CPSC (20:00) · DOJ (21:00) · EPA ECHO (22:00) · SEC Litigation (23:00) · CISA KEV (Mon 00:00) · GDELT (Mon 02:00)

### Monthly (1st UTC)
GSA SAM exclusions · OSHA Severe Injury · CDC FoodNet · HHS OIG · OpenStates · CA AG · Climate TRACE · Net Zero Tracker · IIHS · NHTSA 5-Star · Strike Map · Cornell ILR · FMCSA SMS · DOL OFLC · WWF Palm Oil · TCO Certified · NSF/USP · Textile Exchange · EPA Green Vehicle · EPA SmartWay · NLRB voluntary recognition · SEC 8-K · FDAAA Trials · 50+ more added today

### Annual / quarterly (manual reminders)
Tier-1 re-narrate (quarterly Sept 1) · HRC CEI (Nov 15) · CDP A-List (Feb 15) · Banking on Climate Chaos (Jun) · 1% for the Planet sweep

### Human-action reminders (auto-scheduled)
- Jun 9 · 9 AM CDT — ITEP follow-up
- Jun 9 · 1 PM CDT — Egregious polarity rebalance
- Jun 16 · 9 AM CDT — Coverage measurement + PH 1-week prep
- Jun 22 · 7 PM CDT — PH launch eve
- Jun 23 · 1:50 AM CDT — Launch hour wake-up
- Jul 1 (+monthly) — Cron health check

---

## ✅ SHIPPED 2026-06-08 — 37 PRs (BIGGEST DAY)

### Scoring + neutrality (the critical pre-launch sweep)
- ✅ **#27** PR-2 Scoring flags — `flags` field in data
- ✅ **#51** PR-3 Scoring flags — UI rendering + grade math (flag OFF by default)
- ✅ **#28** Category taxonomy 34 → 18 (no <20, no Other)
- ✅ **#50** Category override map for firearm-retailing Retail brands
- ✅ **#54** Neutrality audit: marketing-PNG renderers (4 MAJOR fixed)
- ✅ **#55** Neutrality audit: derived augments + merge scripts (0 critical/major)
- ✅ **#56** Neutrality audit: outreach + user-facing docs
- ✅ **#57** Neutrality audit: marketing-site (2 CRITICAL fixed)
- ✅ **#58** Neutrality audit: rewrite biased UI strings in src/
- ✅ **#59** Neutrality audit: scoring-engine scan
- ✅ **#60** Neutrality audit: per-company narrative text
- ✅ **#62** Apply 6 human-approved fixes from audit sweep
- ✅ **8f9bb0c6f** OUTLET_BIAS canonical sync (news-rss-collect.mjs)

### Egregious rotation
- ✅ **#52** "5 Most Egregious" rotation engine + initial banners
- ✅ **#53** ITEP citation mockup for Amy Hanauer outreach
- ✅ **#61** Egregious 5 → 30 brands + design pass + brand logos
- ✅ **5defd6826** ITEP mockup: remove biased copy, neutral fact-only framing

### Data pipelines (33 new sources)
- ✅ **#1** DW-1..6 Tier-S waitlist (SBTi, WBA, Forest 500, 50/50, USDA Organic, USDA FSIS)
- ✅ **#2** DW-7..12 Tier-S (OFAC, BIS, FERC, DOL WHD, Energy Star, 1% for the Planet)
- ✅ **#25** DW-13..17 Tier-S (Disability:IN, CFTC, UK ICO, Singapore MAS, Canada Competition)
- ✅ **#6** OpenSanctions consolidated feed
- ✅ **#8** Brazil Lista Suja (forced-labor employers)
- ✅ **#10** NAAG Multistate Settlements (replaces 50 state AGs)
- ✅ **#11** Australia Fair Work Ombudsman
- ✅ **#12** UN B&HR communications scraper
- ✅ **#14** Privacy policy rule-based scoring at scale
- ✅ **#17** Animal welfare watchdog union
- ✅ **#20** Firearms industry corporate signals
- ✅ **#23** Full OpenFDA + EPA TRI carcinogen signals
- ✅ **#26** EU Transparency JSON→XML fix
- ✅ **#29** EPA SmartWay clean trucking
- ✅ **#31** Textile Exchange (RCS/GRS/RWS/RDS/RMS — 5 apparel certs)
- ✅ **#32** Net Zero Tracker
- ✅ **#33** EPA Green Vehicle + ZEV
- ✅ **#34** ITEP Corporate Tax Avoidance (dormant, license-pending)
- ✅ **#35** IIHS Top Safety Pick+
- ✅ **#36** SEC 8-K Items 5.02 + 4.02 (exec departures + restatements)
- ✅ **#37** WWF Sustainable Palm Oil Buyer Scorecard
- ✅ **#38** TCO Certified electronics sustainability
- ✅ **#39** NSF + USP supplements verification
- ✅ **#40** Cornell ILR Labor Action Tracker
- ✅ **#41** NLRB voluntary union recognition
- ✅ **#42** FMCSA SMS carrier safety
- ✅ **#43** FDAAA TrialsTracker (~5k pharma sponsors)
- ✅ **#44** Blue-chip coverage gap 84% → 97%
- ✅ **#45** Better Cotton + Bird Friendly + AWA
- ✅ **#46** DOL OFLC LCA H1B
- ✅ **#47** Strike Map USA
- ✅ **#48** Climate TRACE facility emissions
- ✅ **#49** NHTSA 5-Star Safety Ratings

---

## ✅ SHIPPED 2026-06-07 — 24 PRs (prior big day)

**Tier-S waitlist (DW-1..17 sub-PRs):** #4 brand-parent-map (138 → 4,625) · #5 USDA FoodData · #6 OpenSanctions · #7 WikiRate · #8 Brazil Lista Suja · #9 EU Transparency · #10 NAAG · #11 AU Fair Work · #12 UN B&HR · #13 CA Prop 65 (7,395 notices) · #14 Privacy NLP · #15 Industry carbon intensity (100% coverage) · #16 Transparency benchmarks · #17 Animal welfare union · #18 Exec political donations (4,468 cos) · #20 Firearms industry · #21 SEC DEF14A (Home Depot 2,026:1 pay ratio) · #22 EEOC DEI · #23 OpenFDA + EPA TRI carcinogens · #24 Corporate giving ($56.6B disclosed)

---

## ✅ EARLIER MILESTONES (compressed)

- **2026-06-03 — Massive data day**: 11 new sources in parallel agents (CFPB, NHTSA, CPSC, DOJ, EPA ECHO, SEC Litigation, CISA KEV, GSA SAM, OSHA SIR, CDC FoodNet, HHS OIG, OpenStates, GDELT). Total sources 20 → 46.
- **2026-06-03 — Walmart scoring fix**: computeScore + "Why hurt most" exclude no-record categories. Build 41.
- **2026-06-03 — A-1/A-2/A-3 audit deferrals shipped.**
- **2026-06-02 — Option A News pipeline LIVE end-to-end** (528-brand RSS → Claude Sonnet extraction → per-company `news[]` + `recent_events[]`).
- **2026-06-02 — Critical security incident**: 3 leaked API keys revoked + rotated; leak doc scrubbed from git history via `git-filter-repo`.
- **2026-06-02 — 528 hand-curated top-brand list** at `public/data/top-500-brands.txt`.
- **2026-06-01 — 25-agent audit shipped** (343 findings → 5 critical / 15 high / 35 medium fixed).
- **2026-06-01 — 4 critical bugs fixed** (white-screen `__skipMarketing`, `tn_isPaid` persistence, free-tier detail unlock, MailerLite key off bundle).
- **2026-06-01 — Waitlist pivot** (`PRO_WAITLIST_MODE` constant, founder pricing capture).
- **2026-06-01 — GDPR/CCPA delete button**, **quiz retake hydration**, **paywall cooldown** 4h → 7d, **email validation**, **/privacy 404 fix**, **/api/submit rate limit**, **tap-target a11y**.
- **2026-06-01 — iOS Universal Links** end-to-end (Build 33).
- **2026-05-31 — SEO foundation** (11,211-URL sitemap, JSON-LD, GSC + Bing verified).
- **2026-05-31 — Resend DNS** fully verified (SPF + DKIM + MX + DMARC PASS).
- **2026-05-31 — Capacitor bundled dist/** App-Store-ready + ~16 TestFlight builds.
- **2026-05-28 — 6,050-company expansion** + full neutrality overhaul.

---

## 📌 META

**ID hygiene cleanup (2026-06-08):** The doc had duplicate IDs from cross-section reuse. Resolved as:
- `B-24` data (AllSides) kept; infra Privacy moved → `B-39`
- `B-25` data (BBB, done) kept; infra k6 loadtest moved → `B-40`
- `B-27` data (CA AG, done) kept; marketing Postiz moved → `B-41`
- `B-28` data (Skip state AG) kept; infra PostHog proxy moved → `B-42`
- Added `F-5` for Glassdoor parking

**Update protocol:** Claude updates this file at the end of every working session.

**Resume phrases:**
- "Open the backlog" → I summarize the top sections
- "What needs a decision?" → I list the 🔴 section
- "Work on **L-3**" → I start that specific item
- "What's blocked?" → I summarize ⏸️
- "Add task: [description]" → I add with a fresh ID

**Source files this consolidates:**
- `~/.claude/projects/.../memory/MEMORY.md` + linked roadmap/launch/parked docs
- `/docs/pre-launch-scoring-flags-plan.md`, `/docs/scoring-engine-audit.md`
- `/docs/data-coverage-analysis-2026-06-07.md`, `/docs/cron-quality-audit-2026-06-07.md`
- `/docs/L-3-email-blast-checklist.md`, `/docs/trade-press-pitches.md`
- `/docs/neutrality-audit/*` (7 audit reports)
- `/docs/research/*` (4 research dossiers)
- `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` + `/docs/producthunt/PROMO_COPY.md`
- `/docs/ANDROID_LAUNCH_PLAN.md`, `/docs/payments-integration-plan.md`
- `/docs/TruNorth-TestFlight-Setup.docx`, `/docs/app-store-submission.md`
