# TruNorth Backlog

> **Single source of truth.** I (Claude) keep this up to date as we work. You can edit it directly anytime — I'll respect your edits.
>
> **How to use:** Open this file → say "let's do **L-3**" or "work on the next item under PRE-LAUNCH" or "what's blocked?"
>
> **Last updated:** 2026-06-01

---

## ⏰ NEXT MILESTONES

| Date | Event |
|---|---|
| **Mon, Jun 16** | 1-week-out PH prep reminder fires (9 AM CDT) |
| **Mon, Jun 22** | PH launch-eve readiness reminder fires (7 PM CDT) |
| **Tue, Jun 23 2:01 AM CDT** | 🚀 **Product Hunt launch fires** |
| Tue, Jul 7 (est.) | Earliest Android shipping window (Phase 6.a) |

---

## 🔥 ACTIVE — working on now

*Nothing actively in progress. Pick an item from below and tell me to start.*

---

## 🚀 PRE-LAUNCH — do BEFORE June 23

Things that should land before the PH launch fires. Sorted by impact ÷ effort.

| ID | Item | Effort | Why it matters | Blocker |
|---|---|---|---|---|
| **L-1** | **Pin Twitter tweet from PROMO_COPY.md** | 5 min | Hour-1 Coming Soon subscribers = ~30+ launch-day votes | None — just paste |
| **L-2** | **LinkedIn pinned post from PROMO_COPY.md** | 5 min | Same as L-1 but B2B audience | None |
| **L-3** | **Personal email blast to 10-20 closest contacts** | 30 min | Warmest voters on launch day | None |
| ~~**L-4**~~ | ~~Email signature domain fix~~ | ✅ done 2026-06-01 | Patched v1 script + regenerated all 4 PNGs; now all show `Aron@trunorthapp.com` | — |
| **L-5** | **Pick + install ONE email signature** in Mac Mail | 5 min | Every cold email is a marketing surface | None |
| ~~**L-6**~~ | ~~Add PH "Subscribe" chip to landing~~ | ✅ done 2026-06-01 | Pill chip under hero CTA links to Coming Soon page; gradient hover, easy to remove post-launch | — |
| **L-7** | **Activate Google Apps Script personalized auto-reply** | 20 min | Setup guide at `/docs/gmail-personalized-autoreply-setup.md`; reduces email triage burden during launch chaos | None |
| **L-8** | **Daily 10-min PH "warming" routine** (upvote 5-10, comment on 1) | 10 min/day × 22 days | PH algo weights engagement; warm account = higher launch reach | None — recurring |
| **L-9** | **Record a 30-60 second demo video** for PH gallery | 1-2 hr | Demo videos boost PH conversion ~30%; QuickTime → iPhone screen rec → unlisted YouTube | None |
| ~~**L-10**~~ | ~~Trade press pre-pitches~~ — **drafts ready, you send Jun 16** | ✅ drafted | 4 personalized pitches at `/docs/trade-press-pitches.md` (Verge/Fast Co/Mother Jones/ESG Today) with target journalists + follow-up copy | Your action: personalize + send Jun 16 |
| **L-11** | **Verify Vercel env vars still active** (RESEND_API_KEY, SUBMIT_INBOX, MAILERLITE_API_KEY) | 5 min | Submit form + email capture break silently if any rotate | None |

---

## 🎯 LAUNCH DAY — June 23 only

Don't touch these until launch day. All in `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md`.

| ID | Item | When (CDT) |
|---|---|---|
| **D-1** | Paste First Comment IMMEDIATELY after launch fires | 2:01 AM |
| **D-2** | Fire scheduled Twitter launch tweet | 2:05 AM |
| **D-3** | Fire scheduled LinkedIn launch post | 2:05 AM |
| **D-4** | Text 5 closest people the launch URL | 2:10 AM |
| **D-5** | Reply to every PH comment within 5 minutes | 2-6 AM (hour 1-4 algo weight highest) |
| **D-6** | Indie Hackers post | 9 AM |
| **D-7** | Hacker News "Show HN" post | 9 AM |
| **D-8** | Relevant Reddit posts (r/SideProject, r/Anticonsumption — be authentic) | 9 AM |
| **D-9** | Midday rank check + strategy adjust | 12 PM |
| **D-10** | Slack/Discord community pings | 3 PM |
| **D-11** | Final ping to network non-responders | 6 PM |

---

## 📅 POST-LAUNCH — first 2 weeks after PH

| ID | Item | Effort | Notes |
|---|---|---|---|
| **P-1** | **Phase 6.a: Android launch via Capacitor** | 7-9 hr + $25 | Full plan at `/docs/ANDROID_LAUNCH_PLAN.md`. Blocked on iOS App Store launch. |
| **P-2** | **Thank-you DMs to top 10 PH commenters** | 1 hr | Day 2 |
| **P-3** | **Results tweet** ("Launched at #X on PH yesterday...") | 15 min | Day 2 |
| **P-4** | **"Featured on Product Hunt" badge** added to trunorthapp.com | 10 min | Day 2 — embed code in PH dashboard |
| **P-5** | **Reach out to anyone who hit site with `?ref=producthunt` UTM** | 30 min | Day 3-7 |
| **P-6** | **Post-launch retro** — what worked, what didn't, top requested features | 1 hr | End of week 1 |
| **P-7** | **Trade press follow-ups** with launch results data | 1 hr | Week 2 |

---

## ⏸️ BLOCKED — waiting on external

| ID | Item | Blocked on | Notes |
|---|---|---|---|
| **X-1** | **App Store URL** in PH First Comment + marketing landing CTA | Apple App Store approval | Falls back to TestFlight mailto until approved. Check status before D-1. |
| **X-2** | **RevenueCat / Stripe / Apple IAP integration** (Pro tier $1.99/mo) | TruNorthApp LLC formation + business bank account | Plan at `/docs/payments-integration-plan.md`. Pro features already gated, just needs payment rail. |
| **X-3** | **Apify Indeed reviews scraper** | $10/mo Apify subscription | Code ready at `/Users/aronrosenfield/Developer/hybrid-pipeline/sources/indeed-apify.js`. Needs `APIFY_API_TOKEN`. |
| **X-4** | **MailerLite paid plan** | >1k subscribers OR >12k emails/month | Currently free tier covers us — not blocking. Track in PostHog dashboard. |
| **X-5** | **Annual + lifetime pricing tiers** | RevenueCat live (depends on X-2) | UX 6C + 6D from parked list. |
| **X-6** | **Push notifications** (iOS + FCM Android) | iOS launch settled first | Half-day work when ready. |

---

## 📋 BACKLOG — pick when relevant

Sorted by category. Each has an effort tag (S = <1hr, M = 1-4hr, L = day+).

### App / UX polish

| ID | Item | Effort | Source |
|---|---|---|---|
| **B-1** | **iPad tablet breakpoint** | M-L | Plan at `/docs/tablet-breakpoint-plan.md`. iPhone-first is fine for launch; iPad fixes deferred. |
| **B-2** | Browser/Safari extension (UX 7C) — grade badge overlay on Amazon/Target/Walmart | L (1 week) | Primer at `/docs/TruNorth-Tier-C-Browser-Extension-Primer.docx` |
| ~~**B-3**~~ | ~~Weekly digest opt-in UX~~ | ✅ done 2026-06-01 | `EmailDigestCard` on Account screen. Two-state toggle, expands inline email input when no email captured, persists `tn_weeklyDigest=1` to localStorage and `weekly_digest_optin` source to MailerLite |
| **B-4** | Break up App.jsx (UX 9A) — ~5000 lines → component files | L | Refactor only; no user-facing change |
| **B-5** | JSDoc `@typedef` for Company shape (UX 9C) | M | Autocomplete win, no behavior change |
| ~~**B-6**~~ | ~~Soft email ask after quiz completion~~ | ✅ done 2026-06-01 | Inline `RevealEmailCapture` card on the Reveal screen; suppresses if email already stored; per-session dismiss; fires `reveal_email_captured` to PostHog + MailerLite |

### Data / pipeline

| ID | Item | Effort | Source |
|---|---|---|---|
| **B-7** | **Sources behind VT (priority order):** As You Sow, UK Gender Pay Gap, CPA-Zicklin, GDELT, KnowTheChain | M each | `parked_vt_backfill.md` |
| **B-8** | Quarterly full re-narrate of Tier 1 (top 1k) companies — Sonnet batch | S + $5-10 | `parked_update_cadence.md` |
| **B-9** | Annual HRC CEI + CDP A-List re-ingest | S | Reminder needed |
| **B-10** | Drop Glassdoor source from any future planning | — | ToS forbids scraping, Cloudflare-blocked, prior lawsuits |
| ~~**B-11**~~ | ~~Failed-search → MailerLite "notify me when added"~~ | ✅ done 2026-06-01 | SuggestBrandButton refactored into 3-phase flow (idle → form → done). Captures email with `brand=<query>` tag so users get a targeted email when that specific brand lands. |

### Scoring schema expansion

| ID | Item | Effort | Source |
|---|---|---|---|
| **B-12** | **Tax category** (ITEP, Fair Tax Foundation, SEC 10-K parsing) | M | Decided to skip in Phase 1, now reconsider post-launch |
| **B-13** | Supply-chain labor extension (BHRRC + KnowTheChain) — separate score from domestic Labor | M | `planned_scoring_expansion.md` |
| **B-14** | Cruelty-free / animal testing flags (Leaping Bunny, PETA) | S | Industry-conditional |
| **B-15** | Gun industry ties, tobacco ties, fossil-fuel financing flags | S | Easy boolean adds once schema reopened |
| **B-16** | BDS / Israeli military ties flags | M | Politically polarizing — skipped for v1, reconsider |
| **B-17** | CEO behavior dimension (Musk/Tesla case) | M | Opt-in dimension under political category |

### Marketing / growth

| ID | Item | Effort | Source |
|---|---|---|---|
| **B-18** | Reddit/HN "behind the scenes" post (data pipeline deep dive) | M | Best fired 1 week after PH launch as follow-up content |
| ~~**B-19**~~ | ~~Email drip: 3-step welcome sequence~~ — **copy ready, you wire in MailerLite** | ✅ drafted | 3 paste-ready emails at `/docs/mailerlite-welcome-drip.md` (welcome / behind-the-data / top brands) with personalization tokens + setup checklist |
| **B-20** | PostHog → daily KPI digest email | S | Already a built-in PH feature; just subscribe |
| **B-21** | "Worst of the week" / "Best of the week" social content (auto-generated) | M | Use `/public/data/weekly_changes.json` already produced by Sunday digest |
| ~~**B-22**~~ | ~~TikTok / Reels strategy~~ — **7 scripts ready, you film** | ✅ drafted | 7 video concepts at `/docs/tiktok-reels-content-scripts.md` (Patagonia vs Exxon, barcode scan, founder story, FEC reveal, personalization, "what mom thinks", fast-food OSHA) + production logistics |

### Infra / ops

| ID | Item | Effort | Source |
|---|---|---|---|
| ~~**B-23**~~ | ~~iOS Universal Links~~ | ✅ done 2026-06-01 | AASA at `/.well-known/apple-app-site-association` (Team 22SZQ6B763 + bundle com.trunorthapp.app, matches `/company/*` + `/c/*`). Entitlements file + project.pbxproj wired. Every `https://www.trunorthapp.com/company/X` share now opens IN the app after Build 21 lands. |
| **B-24** | Privacy page review for CCPA/GDPR compliance pre-1k users | S | Already at `/#privacy`; lawyer review nice-to-have once revenue starts |
| **B-25** | k6 loadtest run once we have real DAU baseline | S | Script at `/scripts/loadtest.js`, GH Action ready (manual dispatch) |
| **B-26** | TestFlight → App Store production cutover process documented | S | Once approved, document the steps for future updates |

---

## 💤 PARKED / FUTURE — not on critical path

| ID | Item | Why parked |
|---|---|---|
| **F-1** | Migrate to Supabase or any DB | Static JSON + Vercel covers 100k+ companies free. No reason to migrate. |
| **F-2** | OpenCorporates / Crunchbase / D&B integrations | All paid; doesn't justify cost. |
| **F-3** | Local Llama 3.1 8B narrative generation | ~89 hours/run for 10k. Haiku batch is cheaper + better quality. |
| **F-4** | Multiple Claude sessions in worktrees for parallel work | Only relevant when work fans out across non-conflicting code paths. Used when needed. |

---

## ⏰ SCHEDULED REMINDERS (active)

| Date (CDT) | Reminder | Topic |
|---|---|---|
| Tue, Jun 2 | SEO check-in (Tuesday) | Google Search Console + sitemap status |
| Fri, Jun 5 | SEO check-in (Friday) | First indexing pass review |
| Mon, Jun 8 | SEO check-in (Monday) | Week-1 SEO results |
| **Tue, Jun 16 · 9 AM** | **PH 1-week-out prep** | Subscriber count + outreach + demo video + App Store status |
| **Mon, Jun 22 · 7 PM** | **PH launch eve** | Schedule social posts, final link verification, mental prep |
| **Tue, Jun 23 · 1:50 AM** | **PH launch hour** ☕ | Wake-up + 4-hour battle plan |

Manage in sidebar under "Scheduled".

---

## ✅ RECENTLY SHIPPED (rolling last 15)

Most recent at top. Helps remember "what did we just do?"

1. **2026-06-01 PM** — Paywall conversion table (UX 6B) — Free vs Pro side-by-side comparison with highlighted "Personalized scores" + "Barcode scanner" rows
2. **2026-06-01 PM** — iOS Universal Links (B-23) — AASA file + entitlements + Vercel header. Every shared `/company/<slug>` link opens IN the iOS app instead of Safari (after Build 21)
2. **2026-06-01 PM** — Weekly digest opt-in UX (B-3) — Account-screen `EmailDigestCard` lets users explicitly subscribe to the Sunday digest with `weekly_digest_optin` MailerLite tag
2. **2026-06-01 PM** — Design picks locked: v1 Browse + v4 ProfileStrip + 1-free paywall. Real Browse→Search empty bug FIXED (empty-state path also checked industryBucket). Stripped alt-a/b/c Browse variants + v1/v2/v3 ProfileStrip variants from code.
2. **2026-06-01 PM** — Bug batch: Splash "11,000+" rounding, Browse→Search empty-state fix attempt #1 (openBucket filter reset), free-plan paywall, Brand of Day moved above Top Picks, paid Sources tab now narrative paragraph
2. **2026-06-01 PM** — OG / Twitter card metadata sharpened — "public records" differentiator now in first 10 words; updated to mention 9 categories + iOS
3. **2026-06-01 PM** — Failed-search "notify me" (B-11) — SuggestBrandButton 3-phase flow with brand-tagged MailerLite signup
4. **2026-06-01 PM** — Soft email ask after quiz completion (B-6) — inline card on Reveal screen, fires `reveal_email_captured`
5. **2026-06-01 PM** — TestFlight Build 18 uploaded with B-6 + B-11 (email capture moments)
6. **2026-06-01 PM** — TestFlight Build 17 uploaded with Reveal fix + new What's New copy
4. **2026-06-01 PM** — TikTok/Reels content scripts drafted (B-22) — 7 video concepts
5. **2026-06-01 PM** — MailerLite 3-step welcome drip copy drafted (B-19)
6. **2026-06-01 PM** — Trade press pitch drafts ready (L-10) — Verge / Fast Co / Mother Jones / ESG Today
7. **2026-06-01 PM** — Reveal "tailored to you" overflow fix (maxWidth:340)
8. **2026-06-01 PM** — Privacy Policy scroll fix on web (owns 100vh scroll container)
9. **2026-06-01 PM** — What's New modal rewritten for launch + WHATSNEW_VERSION bumped
10. **2026-06-01 PM** — Email signatures all 4 corrected to `Aron@trunorthapp.com` (L-4)
11. **2026-06-01 PM** — ProductHunt "Coming Soon" chip on marketing landing (L-6)
12. **2026-06-01** — All 3 PH launch reminders scheduled (Jun 16, Jun 22, Jun 23)
13. **2026-06-01** — Master BACKLOG.md created as single source of truth
7. **2026-06-01** — PROMO_COPY.md filled with real PH Coming Soon URL, committed + pushed
8. **2026-06-01** — ProductHunt Coming Soon page scheduled for June 23 (logo, 5 gallery images, First Comment, 3 shoutouts)
9. **2026-05-31** — Phase 5.av/aw/ax: iOS-only landing + Claude/AI scrub + bulletproof Capacitor native detection
10. **2026-05-31** — Capacitor switched from `server.hostname` mode to bundled `dist/` (App Store ready)
11. **2026-05-31** — TestFlight builds 5-16 shipped via `npm run ship:ios` automation
12. **2026-05-31** — SEO foundation: sitemap.xml (11,211 URLs), robots.txt, per-company SEO edge function with JSON-LD
13. **2026-05-31** — Google Search Console + Bing Webmaster Tools verified
14. **2026-05-31** — Resend DNS chain verified (SPF, DKIM, MX, DMARC all PASS)
15. **2026-05-31** — Day-7 reflection + Values Fingerprint + Saved-brand badges + editorial Brand of Day + ConfirmModal + inline typeahead + Top Picks rearrange + email capture wiring

---

## 📌 META — about this file

**Update protocol:**
- I update this file at the end of every working session when something ships, gets parked, or changes state.
- I move completed items to **RECENTLY SHIPPED** (keep last 15) and drop them from elsewhere.
- I add new items as they come up during conversations.
- IDs are stable — once assigned (e.g. `B-12`), they stay even after the item ships, so old chat references still work.

**Resume phrases:**
- "Open the backlog" → I `cat` this file's top sections to you
- "What's in PRE-LAUNCH?" / "What's BLOCKED?" → I summarize that section
- "Work on **L-3**" → I start that specific item
- "What's next?" → I look at ACTIVE → PRE-LAUNCH → BACKLOG (in that order) and suggest the highest-leverage item
- "Park **B-12**" → I move it to PARKED with a reason
- "Add task: [description]" → I add it to the right section with a fresh ID

**Source files this consolidates (still on disk for deep history):**
- `~/.claude/projects/-Users-aronrosenfield-Developer-trunorth/memory/roadmap.md` (master 6-phase plan)
- `~/.claude/projects/.../memory/parked_ux_perf_list.md` (9-section UX/perf list 1A-9D)
- `~/.claude/projects/.../memory/parked_vt_backfill.md` (data pipeline)
- `~/.claude/projects/.../memory/parked_scale_to_10k.md` (12-step zero-cost plan)
- `~/.claude/projects/.../memory/parked_update_cadence.md` (tiered cron refresh)
- `~/.claude/projects/.../memory/parked_analytics_marketing.md` (PostHog/MailerLite/Resend)
- `~/.claude/projects/.../memory/planned_scoring_expansion.md` (new categories/flags)
- `~/.claude/projects/.../memory/launch_2026_05_28.md` (launch notes archive)
- `/docs/ANDROID_LAUNCH_PLAN.md` (Phase 6.a)
- `/docs/SEO_STRATEGY.md`
- `/docs/payments-integration-plan.md`
- `/docs/tablet-breakpoint-plan.md`
- `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` + `/docs/producthunt/PROMO_COPY.md`
