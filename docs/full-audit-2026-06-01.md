# TruNorth Full Audit — 2026-06-01

> 25-agent audit: 10 thorough app reviewers + 10 first-time user personas + 5 QA/stress engineers. **343 raw findings** dedupped + synthesized into the buckets below.

## Executive Summary

TruNorth is a genuinely promising product with a strong methodology core, smart onboarding decisions (deferred email, draft persistence, deep-link bypass), and best-in-class iOS shipping infrastructure — but it cannot launch in current state. Five critical blockers will torpedo Product Hunt and risk App Store rejection: the paywall is a setTimeout stub (zero revenue possible), Pro state doesn't persist across relaunches, an undefined variable white-screens the app on a reachable Back path, the entire free tier delivers zero content despite onboarding promises, and the MailerLite API key is architected to leak the moment it's populated. Beyond the criticals, the biggest pre-launch fixes are content honesty (the '11,000+ brands graded' claim collapses at the long tail — 85% of companies have zero personalization signal; Patagonia shows neutral despite being the iconic green brand), aggressive paywall timing teaching users to dismiss reflexively, and inconsistent navigation behavior where Brand-of-Day / Weekly Digest / Library taps dump users into search-result lists instead of focused brand views. The medium tier is the usual polish-pass material: theme token consolidation, tap target sizing, a11y landmarks/labels, and copy clarity for non-native English readers. Strong existing foundations to preserve: the symmetric scoring engine, the soft-to-hard quiz ordering, the privacy policy's plain-English honesty, the SEO architecture, and ship-ios.sh.

## 🚨 Critical — must fix before launch (5)

### 1. Paywall is a no-op fake — zero revenue possible at launch

**Location:** `src/App.jsx:802-819 (handleSubscribe), docs/payments-integration-plan.md`
  
**Flagged by:** Paywall-CRO-Audit, App-Review-Indie-Founder-Audit, Broke-College-Student

handleSubscribe (src/App.jsx:802-819) is a setTimeout(1500) stub. There is no Stripe Checkout, no IAP wiring, no real billing. Every 'Pro' user since launch is unpaid. The 43 paywall_shown / 0 upgrade_clicked PostHog data confirms this. Shipping to Product Hunt with this state means every potential conversion is forfeited AND creates App Store rejection risk (4.5.3 / IAP rules) for advertising a subscription that doesn't charge. Compounded by the lack of Restore Purchase, no entitlement persistence, and no annual anchor.

**Fix:** Pick one before PH: (a) finish RevenueCat + annual tier ($14/yr default, $1.99/mo secondary) and ship a real Stripe Checkout / StoreKit flow, OR (b) reframe the paywall as 'Join Pro waitlist — first 500 get $9/year forever' and capture emails to MailerLite. Option (b) is shippable today, removes Apple rejection risk, and still captures intent signal.

### 2. Pro subscription state never persists — relaunch reverts to Free

**Location:** `src/App.jsx:3769-3771 (isPaid init), :4496/:4540 (setIsPaid after purchase)`
  
**Flagged by:** App-Review-Account-Library-UX, Paywall-CRO-Audit

isPaid is initialized only from DEV ?pro query param and never written to localStorage. After purchase, setIsPaid(true) is in-memory only. No StoreKit/Capacitor receipt restore on launch, no entitlement hydration. As soon as the user closes the app or refreshes, isPaid flips back to false: Account shows Free, the gold Upgrade CTA reappears, paywall fires again, locked features re-lock. Even with real billing, paid users would lose entitlement on every relaunch. Also: no 'Restore Purchase' affordance anywhere — Apple guidelines violation.

**Fix:** Persist signed entitlement (tn_isPaid + expiry) after purchase and rehydrate in the useState initializer. Wire Capacitor StoreKit restorePurchases() on app launch and on Account mount. Add a 'Already subscribed? Restore' link to the paywall.

### 3. ReferenceError __skipMarketing crashes app on Privacy → Back

**Location:** `src/App.jsx:4258, :3673, src/OnboardingFlow.jsx:38, src/main.jsx:14-18`
  
**Flagged by:** App-Review-ChaosEngineer, App-Review-Code

src/App.jsx:4258 references __skipMarketing which is never declared anywhere in the file. When a user visits #privacy then taps Back, this line throws ReferenceError. There is no top-level ErrorBoundary in main.jsx, so the whole app white-screens. Path is reachable from the marketing landing privacy link and from any in-app deep link to #privacy. Compounded by unguarded localStorage.getItem at render time (src/App.jsx:3673, OnboardingFlow.jsx:38) which throws in Safari private mode.

**Fix:** Replace __skipMarketing with __isCapacitorNative || !__isRoot. Add a top-level ErrorBoundary around <App /> in main.jsx so pre-main crashes are recoverable and tracked. Wrap all localStorage.getItem at render in try/catch.

### 4. Free-tier delivers zero takeaway value — onboarding promises are lies

**Location:** `src/App.jsx:2100, :3832-3834, :2090, :1989-2018`
  
**Flagged by:** Broke-College-Student, App-Review-ChaosEngineer, App-Review-Code, Paywall-CRO-Audit

Three compounding bugs: (1) src/App.jsx:2100 gates the entire detail panel on `open && isPaid`, so the 'advertised' 1 free view per week opens nothing — the row toggles a chevron and shows blank. (2) src/App.jsx:3832-3834 runs `localStorage.removeItem('tn_freeViewed')` on every mount, making the weekly quota logic dead code. (3) Grade badge shows '?' until quiz is taken AND paid (src/App.jsx:2090), but quiz output is also paywalled. Net effect: a free user sees brand names and nothing else. The paywall comparison table claims free users get 'View brand names + grade' and 'Browse 11,000+ companies', but neither delivers any actual content. Onboarding slide 3 says 'all free' which is false. This is the single biggest credibility wound at launch.

**Fix:** Pick a free model and make code match: either (a) deliver the promised 1-free-view-per-week by rendering detail when open && (isPaid || isFirstFreeView), with paywall sliding up AFTER the view, OR (b) permanently unlock full profiles for 3-5 demo brands (Patagonia, Amazon, Nestle, Exxon) — the Yuka model. Show personalized grades on those demo brands after quiz completion so the 'aha' moment lands without paywall.

### 5. MailerLite write API key architected to ship in client bundle

**Location:** `src/lib/marketing.js:18-63`
  
**Flagged by:** App-Review-Privacy, App-Review-Security

src/lib/marketing.js:18 reads ML_KEY = import.meta.env.VITE_MAILERLITE_API_KEY and sends it as Authorization: Bearer directly to MailerLite from the browser. Any VITE_-prefixed value is inlined into the public bundle at build time. Today the env var is unset so the bundle is clean — but the moment anyone fills it in on Vercel and ships, the key is publicly extractable. A MailerLite write key can drain the subscriber list, send mail on the account's behalf, and burn sender reputation.

**Fix:** Add /api/subscribe edge function reading MAILERLITE_API_KEY (no VITE_ prefix) from process.env. Client POSTs email+source to that endpoint. Same shape as existing /api/submit.js. Rotate the current key immediately — assume compromised.

## 🔥 High priority (15)

### H1. Paywall fires on 2nd brand tap with no fatigue cap — trains dismissal

**Location:** `src/App.jsx:1995-2017 (trigger), :2006 (cooldown), :4513/:4554 (dismiss)` · **Flagged by:** Paywall-CRO-Audit, Broke-College-Student, Tech-Press-Methodology-Audit

Paywall fires on the 2nd unique company tap per week with only a 4h sessionStorage cooldown. sessionStorage clears on tab close, so on mobile web cooldown is effectively zero. Multiple manual triggers (Pro banner, Library CTA at 5465/5533, Submit) bypass cooldown entirely — a user tapping two Pro features back-to-back gets the same modal twice in 5 seconds. The 'Maybe later' button is visually equal-weighted to Subscribe. Combined with the bug that the 2nd tap reveals nothing, conversion is impossible. Industry comparison: Yuka allows unlimited scans free; this app gates the core verb on day one.

**Fix:** Move cooldown to localStorage with escalating durations (1st dismiss=24h, 2nd=72h, 3rd=7d). Cap at 3 paywall views per 24h regardless of source. Shrink 'Maybe later' to a text-link with loss-framed copy ('Keep my 1 free view per week'). Show blurred-content + paywall-at-50%-height on 2nd tap so users SEE what they're missing.

### H2. '11,000+ graded brands' overstated — 85% have zero personalization signal

**Location:** `public/data/index.json, public/data/companies/*.json, src/App.jsx:1953-1957 (sources rendering)` · **Flagged by:** TruNorth-Data-Scoring-Audit, Tech-Press-Methodology-Audit, Climate-Activist-Persona, App-Review-MidwestMom52, TruNorth-EU-User-Berlin

Of 11,209 companies, 9,551 (85.2%) have every sc field set to neutral/na/unknown — their grade is static regardless of quiz answers. Of 500 sampled, only 7.4% have populated FEC, ZERO have populated OSHA/EPA/HIBP. The dominant cited source is 'Public records research' (3,783 mentions vs 132 Violation Tracker / 66 EPA / 37 FEC), styled identically to named source pills — exactly the 'opinions dressed as ratings' competitors do. Patagonia (the flagship green brand) shows env=neutral with 'No public record found'. Hobby Lobby (flagship conservative brand) is missing entirely. Major brands like ExxonMobil have three duplicate slugs with inconsistent signal. Reviewers and trade-press journalists who spot-check 3-5 brands will hit this immediately.

**Fix:** (1) Backfill Patagonia, Ben & Jerry's, Chick-fil-A, Tesla, Nestle, Hobby Lobby and the top 100 PostHog-impression brands with verified signals before any press push. (2) Add a 'Limited data — grade not personalized' flag for low-signal companies. (3) Rename 'Public records research' to 'Editorial research (unverified)' and visually de-emphasize. (4) Restate marketing as '500+ headline brands graded against named federal records; long-tail companies graded against aggregated research'. (5) Dedupe ExxonMobil/Meta/Google slug collisions and promote EU parents (volkswagen not volkswagen-usa).

### H3. Navigation inconsistency: Brand-of-Day / Weekly Digest / Library dump users into search lists instead of focused brand view

**Location:** `src/App.jsx:1247-1251, 1295-1298, 5069-5075, 4035-4054, 4751, 5295, 5372, 4906-4942` · **Flagged by:** App-Review-Visual, App-Review-Account-Library-UX

BrandOfDayCard (src/App.jsx:1247-1251, 1295-1298), weekly-digest cards (5069-5075), the day-7 brand button (4751), and the cold deep-link effect (4035-4054) all set deepLinkSlug + setTab('search') but never setFocusedSlug. Result: tapping a single brand from the daily-ritual surface shows a name-based search list. The adjacent saved-updates card (5022) and Universal Link handler (3943) DO set focusedSlug — so identical user intents produce different results depending on entry point. Library Saved/History clicks (5295, 5372) don't reset queryRaw/leanFilter/catFilters either, so tapping Clear on the focused chip drops the user into stale-filter results. focusedSlug also persists across tab changes, producing 'why is only 1 brand showing' on Search re-entry.

**Fix:** Extract a single openBrand(slug) helper that resets all filters AND sets focusedSlug AND deepLinkSlug AND tab='search'. Call from every 'navigate to one brand' entry point. Auto-clear focusedSlug on tab leave from 'search'. Document the contract.

### H4. iOS auto-zoom and sub-44pt tap targets across multiple critical surfaces

**Location:** `src/App.jsx:5250-5253, 1037, 1582, 1675, 5719, 331, 2821-2828, 2877` · **Flagged by:** App-Review-Mobile, Content-Design-Audit, App-Review-A11y

Library sort <select> at fontSize:12 (src/App.jsx:5250-5253) triggers iOS Safari auto-zoom on focus — the exact bug the codebase already commented around the paywall input. Multiple icon buttons fall below Apple HIG 44pt: Filters close 28×28 (1037), Compare close 32×32 (1582), Compare remove × 24×24 (1675), Compare-bar clear × 24×24 (5719), Scanner close 36×36 (331), purchase log toggles ~28-32px (2821-2828), Save/Compare/Share row borderline (2877). The search-bar clear (4619) at minWidth/minHeight:44 is the model to copy.

**Fix:** Bump Library <select> to fontSize:16. Add minWidth:44, minHeight:44 to every icon-only button. Bump purchase-log padding to 11-12px / fontSize:12. Extract a <DismissButton> component to enforce.

### H5. Modals (Compare/Scanner/Paywall/WhatsNew) lack dialog semantics, focus trap, focus return

**Location:** `src/App.jsx:1578 (Compare), :328 (Scanner), :1456 (WhatsNew), :797 (Paywall), :5739-5755 (nav)` · **Flagged by:** App-Review-A11y

Only ConfirmModal is a11y-correct. The four fullscreen overlays use plain <div onClick={onClose}> backdrops and miss role='dialog', aria-modal='true', aria-labelledby, focus trap (Tab walks into hidden tab content underneath), ESC handler, and focus return to trigger on close. VoiceOver users opening Compare land focus nowhere predictable. Bottom tab nav also has no <nav>/role='tablist', no aria-label, no aria-current — five identical-sounding buttons to a screen reader. No skip-link, no <main> landmark. Compounded: only one aria-live region in the whole app (filtered count) — quiz progress, save/unsave, scanner state transitions, paywall errors all silent.

**Fix:** Promote ConfirmModal's pattern into a shared <Modal> wrapper. Add <nav aria-label='Main'> + aria-current to bottom nav. Wrap tab content in <main id='main' tabIndex={-1}>. Add a useAnnouncer() hook with global polite live region for save/quiz/scanner events.

### H6. Native alert()/prompt() calls bypass themed ConfirmModal — scam-popup UX

**Location:** `src/App.jsx:803, 3321, 2946` · **Flagged by:** App-Review-ChaosEngineer, App-Review-Code, Paywall-CRO-Audit

PaywallScreen's email validation (src/App.jsx:803) and SubmitView (3321) use native alert(). On iOS Capacitor/TestFlight these render as 'trunorthapp.com says:' which is the exact scam-popup UX that triggered the Phase 5.au themed-modal rewrite. share fallback at 2946 uses window.prompt. These hit at the highest-intent moments (paywall + submit) where polish matters most. Email validation also uses `email.includes('@')` — 'a@' passes; failed validation pops the system dialog and visually breaks the bottom-sheet aesthetic.

**Fix:** Replace alert()/prompt() with themedAlert/themedPrompt via useAlert hook (lift into components that still use natives). Replace email validation with a proper regex and inline error text below the field.

### H7. Sign-out leaves PII on device + no in-app data deletion / analytics opt-out

**Location:** `src/App.jsx:5645 (sign-out), src/lib/analytics.js:17-21, src/PrivacyPolicy.jsx:147-156` · **Flagged by:** App-Review-Account-Library-UX, App-Review-Privacy, TruNorth-EU-User-Berlin

Sign-out only removes tn_hasOnboarded and tn_user. tn_saved, tn_profile, tn_viewHistory, tn_weeklyDigest, tn_user_hash, tn_email, tn_purchaseLog, tn_recentSearches all persist. On shared devices, the next user sees the previous person's saved brands (which reveal political/values info) and view history. Confirm copy 'your saved brands stay on this device' implies same-user continuity but is silent on multi-user risk. Compounding: privacy policy promises GDPR/CCPA rights and GPC honoring, but there's no posthog.opt_out_capturing() call, no GPC check, no 'Delete my data' button, no analytics toggle. PostHog session recording is enabled by default (disable_session_recording: false) capturing form keystrokes including emails and quiz answers — not disclosed to user. PostHog routed to us.i.posthog.com creates GDPR Schrems II risk for any EU user.

**Fix:** (1) Sign-out modal: two options 'Sign out (keep data)' vs 'Sign out and erase'. (2) Account → Privacy section: Pause analytics, Clear local data, Delete email from list. (3) Set disable_session_recording: true OR mask_all_text: true. (4) Read navigator.globalPrivacyControl before posthog.init(). (5) Route EU users to eu.i.posthog.com.

### H8. 'Unsubscribe in-app' doesn't actually unsubscribe + accept-anything email validation

**Location:** `src/App.jsx:1351-1358, 5614, 1336` · **Flagged by:** App-Review-Account-Library-UX

EmailDigestCard.turnOff (src/App.jsx:1351-1358) flips local state and writes tn_weeklyDigest=0 but never calls MailerLite. User-facing label says 'Unsubscribe' — users will expect emails to stop, they won't. CAN-SPAM and trust risk. Compounded: email validation throughout (Account 5614, EmailDigestCard 1336) is just trimmed.includes('@') && includes('.') — 'a@b.' passes, no lowercasing means Foo@Bar.com vs foo@bar.com create duplicate MailerLite records.

**Fix:** Rename to 'Mute reminders' OR add real /api/unsubscribe endpoint. Replace validation with /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, trim+lowercase before persist.

### H9. Force-quit during quiz strands users — never see quiz again

**Location:** `src/OnboardingFlow.jsx:38, src/App.jsx:4272, 4288-4289` · **Flagged by:** Onboarding-UX-Audit

OnboardingFlow.handleNext sets tn_hasOnboarded='1' BEFORE the quiz runs. If user force-quits/backgrounds between onboarding completion and quiz start, the next launch reads hasOnboarded=true and routes to 'main'. tn_quiz_draft is preserved but screen state lives in useState only — orphaned draft never resumed. The carefully-designed first-run reveal moment is lost forever; user only gets the small Account 'Retake quiz' affordance. This breaks the differentiating mechanic for any interrupted user.

**Fix:** Move tn_hasOnboarded set from OnboardingFlow.handleNext into Quiz's onComplete and onSkip handlers in App.jsx. Or persist screen state to sessionStorage so a relaunch resumes at 'quiz' when a draft exists.

### H10. Quiz 'Tap to edit' starts blank retake instead of editing answers

**Location:** `src/App.jsx:4687, 2998-3001, 3025, 4318-4480` · **Flagged by:** Quiz-Design-Specialist, Onboarding-UX-Audit

ProfileStrip pill reads 'Personalized · Tap to edit' but launches a blank quiz — tn_quiz_draft was cleared on previous completion (src/App.jsx:3025), so users redo all 10 decisions from scratch. There's also no Edit button on the Reveal screen at all — the highest-engagement moment in the funnel has no fix-a-mistake affordance.

**Fix:** On retake entry, seed answers state from the current tn_profile (politicalLean, deiLean, animalTesting, guns, unionSupport map back to the quiz). Add 'Tweak my answers' link below the two CTAs on Reveal.

### H11. Sources tab makes promises the app doesn't deliver

**Location:** `src/App.jsx:5474-5510, :1911-1968, :2282, :5492, :5486` · **Flagged by:** Content-Design-Audit, Tech-Press-Methodology-Audit

Sources copy at src/App.jsx:5474-5489 promises (1) 'Tap any company → Sources tab to see the specific filings' — there is no per-company Sources tab. (2) 'Per-grade citations visible under Why this grade?' — CompanyCard has only the small inline 'Why:' microcopy ('Labor helped') with no citation links. (3) 'For breaking news, tap Live update on any company card' — there is no Live update button anywhere (line 5492). (4) The phrase 'not opinions, not vibes, not AI synthesis' (5486) directly mentions AI after Phase 5.aw was supposed to scrub it. (5) Source pills in CategoryRow (1953-1957) are plain text — no hrefs, can't audit FEC committee IDs or Violation Tracker URLs that ARE already in the data. The 'every grade auditable end-to-end' marketing claim is materially false.

**Fix:** Either ship a Sources accordion in CompanyCard that lists each category's d.sources with real URLs (FEC committee IDs and Violation Tracker URLs are already in the data) OR rewrite Sources copy to match reality. Remove the AI mention entirely. Delete the 'Live update' promise.

### H12. /privacy returns 404, company SEO pages lack JSON-LD and have wrong og:url

**Location:** `vercel.json, api/company-seo.js, src/OnboardingFlow.jsx:118` · **Flagged by:** App-Review-Visual, Onboarding-UX-Audit

(1) HEAD /privacy returns 404 NOT_FOUND — only /#privacy works. Apple App Store Connect's privacy URL field expects a real path; Apple onboarding Terms/Privacy links use href='#' which scrolls to top. (2) /company/<slug> SEO pages emit ZERO application/ld+json, og:url is hard-coded to / on every company page (breaks share-preview dedup), and <title> is still the generic homepage title. (3) Unknown slugs return HTTP 200 with the homepage shell — soft-404 risk for Google to index junk URLs.

**Fix:** Add vercel.json rewrite for /privacy → /index.html. In api/company-seo.js: set per-slug og:url + canonical, per-slug <title>, inject Organization JSON-LD. 404 unknown slugs with noindex meta. Wire OnboardingFlow Terms/Privacy hrefs to #privacy.

### H13. Acronym wall + idiomatic copy + US-political framing alienate non-US, non-native readers

**Location:** `src/OnboardingFlow.jsx (multiple), src/App.jsx:404-408, 462-471, 483, 948-953, src/MarketingLanding.jsx` · **Flagged by:** App-Review-MidwestMom52, App-Review-Conservative-Shopper, App-Review-Copy-NonNative, Climate-Activist-Persona, TruNorth-EU-User-Berlin, Quiz-Design-Specialist

Onboarding slide 2 lists FEC/EPA/OSHA/NLRB/BHRRC/HIBP with no expansion. Quiz screen 1 'Things you'd rather not buy' uses 'Supportive' as Firearms middle option — contradicts the avoidance frame. Screen 4 'Lines you won't cross' with 'Made in adversary nations' is US-foreign-policy language. 'Your wallet is a vote' headline is left-coded. DEI category uses rainbow flag icon making the category itself feel pride-coded (Firearms correctly uses neutral target icon). Conservative archetype almost never triggers because the 4 importance axes are all progressive-coded. Onboarding demo pairs Patagonia A vs ExxonMobil D — visibly partisan first impression. Hobby Lobby missing entirely. Several long sentences with em-dashes for non-native readers. 'Vibes', 'spin', 'rage-bait', 'engagement traps', 'streak hooks' across marketing copy. Aunt Jemima as the parent-mapping example — renamed brand unknown outside US.

**Fix:** Expand acronyms on first use ('FEC (US campaign-finance filings)'). Rename Firearms middle option to 'No preference'. Swap 'adversary nations' for 'countries with serious human-rights concerns'. Add 'Made in USA' as positive filter (not just absence-of-foreign). Swap DEI rainbow icon for ti-users-group. Drop quiz's required all-5 rows on importance grid — let users skip. Replace Patagonia/Exxon demo with one neutral brand (Coca-Cola). Add Hobby Lobby + faith-coded brands. Replace 'vibes/spin/rage-bait' with plain phrasing.

### H14. /api/submit + /api/og/* have no rate limiting — spam + bill-amplification vectors

**Location:** `api/submit.js:22-46, api/og/brand.js, api/og/values.js, vercel.json, capacitor.config.json:7` · **Flagged by:** API-Stress-Test, App-Review-Security

Burst-tested 30 parallel POSTs to /api/submit — all 200, all forwarded to Resend. No CAPTCHA, no honeypot, no per-IP throttle, no min-time check. Forwards directly to aron@trunorth.com. Single attacker can exhaust Resend 100/day quota and drown the inbox. Also reply_to passed straight to Resend with no validation — bot can spam your inbox with weaponized reply-to. /api/og/* endpoints unbounded: 100 unique-querystring requests = 100 fresh Satori renders cached at CDN, polluting cache and inflating Vercel function cost. No CSP header anywhere, Capacitor limitsNavigationsToAppBoundDomains=false.

**Fix:** Add @upstash/ratelimit (5/min/IP) + Origin check + honeypot field to /api/submit. HMAC-sign OG URLs or rate-limit (60/min/IP). Validate email regex + blocklist trunorth.com from reply_to. Add CSP via vercel.json headers (start report-only). Set limitsNavigationsToAppBoundDomains=true with WKAppBoundDomains allowlist.

### H15. MAIN bundle ships entire 2.5MB companies dataset + 4MB Tabler icon webfont

**Location:** `src/main.jsx:3, dist/assets/companies-*.js, src/lib/dataSource.js:20, src/App.jsx:2150, :4057-4060, :4189-4196` · **Flagged by:** App-Review-Indie-Founder-Audit, App-Review-ChaosEngineer, App-Review-Code, Search-UX

Vite emits 2.5MB companies chunk + 639KB main bundle (chunk-size warning fires). main.jsx imports @tabler/icons-webfont CSS pulling 4MB of font formats for ~40 icons used. For a 'scan a barcode in store on cellular' product, first paint on weak LTE feels broken. The 11,205 per-company JSON files already exist in /public/data/companies/ — they're loaded on-demand AND bundled. Tabler webfont also has no preload optimization. detailCache in dataSource.js grows unbounded across long sessions. Top Picks rebuilds an 11k-entry Map per opened card. deduped uses O(n²) findIndex.

**Fix:** (1) Replace webfont import with tree-shaken SVG imports from @tabler/icons-react — saves ~3.5MB. (2) Stop bundling the companies dataset — use the existing on-demand JSON loader. (3) Memoize a slug→company Map at App level once; pass to CompanyCard. (4) Cap detailCache at 200 (LRU). (5) Dedupe with Set, not findIndex. (6) Partial-sort Top Picks (top K) instead of full 11k sort.

## ⚠️ Medium priority (35)

**M1.** PostHog double-tracks paywall_shown for auto-trigger path + tracking inconsistencies — `src/App.jsx:2010, 3959, 4160`

  · src/App.jsx:2010 tracks paywall_shown when CompanyCard.handleTap triggers. Then onUpgrade sets showPaywall=true which fires useEffect at 3959 tracking paywall_shown AGAIN. Auto-trigger users log 2x while manual triggers (banner, library, submit) log 1x. The 43/0 funnel diagnostic is inflated and unrecoverable. Also: search effect at 4160 reads stale filtered.length from closure.

  · *Fix:* Remove track call at :2010. Let useEffect at :3959 be single source. Pass reason via state.

**M2.** Compare overlay has no path to remove second brand or auto-close on tab change — `src/App.jsx:5704-5734, 1556`

  · Floating compare bar at 5704 only exposes × to clear ALL. Inside CompareView onRemove drops a brand but bottom-nav remains visible — user mid-compare can tap a tab and end up confused about persistence. compareList persists across tab changes but showCompare only closes via onClose. 'Suggest' button at 1-brand state has no visible result if CompareView's empty-second-slot UI is subtle.

  · *Fix:* On setTab while showCompare, decide: close with toast ('Compare saved — tap bar to reopen') or block. Verify CompareView renders prominent search-for-competitor when list.length===1.

**M3.** Save/Compare/Share buried at bottom of long card scroll — `src/App.jsx:2877-2963`

  · Actions (Save+Compare at 2877, Share at 2905) sit AFTER recency footer, after I-bought-it row, after every enrichment. On a brand with full data, user scrolls a screen+ before seeing save controls. The closed-row save icon was removed (Phase 5.af) — actions should reappear higher.

  · *Fix:* Move Save/Compare/Share row to under the hero grade block (~line 2304).

**M4.** Animal-testing spectrum endpoint label 'Tests' is ambiguous + empty-category rationale missing — `src/App.jsx:1905, 1947, 1960`

  · src/App.jsx:1905 SPECTRUM_LABELS.animals.lo is 'Tests' — could read as QA tests. CategoryRow at 1947: when category has value but no summary, renders empty paragraph + Signal label with no explanation. Unknown branch at 1960 has graceful fallback ('No public record found yet…') but partial-data branch doesn't.

  · *Fix:* Change lo to 'Tests on animals'. Wrap 1947 in stripCites check: if empty, render 'Signal recorded — see source links below'.

**M5.** Importance grid forces all-5 ratings, no opt-out — straightlining risk — `src/App.jsx:412-422, 3019, 3008, 3070-3073`

  · Quiz screen 2 canAdvance requires every row to have 1-5 (src/App.jsx:3019). User with no opinion on CEO pay can't move on without lying. The very forced-choice failure mode the research notes warn about. Compounded: progress bar shows 0% on welcome instead of starting at ~5-10% to leverage momentum-builds-commitment.

  · *Fix:* Add 6th '—'/'Skip' pill at end of each row, OR pre-fill all rows with default weight 3 and treat screen as confirmation. Start welcome at 5-10% with prog=((step+0.5)/(steps.length+0.5))*100.

**M6.** '30-second quiz' overpromise — actual is 60-90s and copy contradicts itself — `src/App.jsx:857, 1524, 2297, 5149, 3086-3088, src/OnboardingFlow.jsx:115`

  · Five surfaces say 30 seconds. Actual quiz is 4 screens with ~10 decisions taking 45-90s. Reveal share text already says '60 seconds'. The progress bar betrays the lie ('1 of 10', '2 of 10') at the most fragile funnel moment. Also: '9 categories' is referenced as '9 things' / '9 quiz topics' / '5 weights in fingerprint' inconsistently.

  · *Fix:* Either tighten quiz to fit 30s (3 importance rows) or update all 5 copy sites to '60-second quiz' + 'about 10 quick questions'. Pull literal steps.length into welcome string. Lock canonical category count (9) across surfaces.

**M7.** Quiz Skip strands users with no acknowledgment + no Back button on onboarding slides — `src/App.jsx:4531, src/OnboardingFlow.jsx:122-129`

  · onSkip just calls setScreen('main') — no toast, no profile, no '?' badges explanation. Users skip and land in Top Picks with '?' grades, no later nudge. Onboarding has no Back between slides — mis-tap on Next is irreversible without abandoning entirely.

  · *Fix:* On skip: fire themed toast 'Grades show as ? until quiz — Account → Take quiz' and persist tn_quizSkipped. Make onboarding dots tappable or add Back chevron when slide > 0.

**M8.** Header search input force-switches tabs on every keystroke — `src/App.jsx:4614`

  · src/App.jsx:4614 calls setTab('search') in onChange. Typing on Library/Account/Browse rips user out without warning. Tapping the input alone doesn't switch — only typing — making behavior non-deterministic. Previous tab's scroll/sub-tab state was just reset.

  · *Fix:* Move setTab('search') from onChange to onFocus. Keep onChange purely about queryRaw. Or add a 'cancel' that restores prior tab.

**M9.** WhatsNewModal countdown to ship 1.0 vs Pro narrative confused — `src/App.jsx:4806, 840`

  · Paid Sources tab body claims 'narratives' (in feature list at 840 / banner at 4806), but unlocked CompanyCard has no narrative paragraph — only stripped category one-liners. Paid users may feel narrative promise wasn't delivered.

  · *Fix:* Drop 'narratives'. Use 'category breakdowns, sources & full profiles'. Or render a 2-3 sentence top-of-card synopsis when data exists.

**M10.** Quiz output paywalled despite quiz being free — bait-and-switch perception — `src/App.jsx:2090, 5573`

  · Account says 'Take the quiz (free)'. User spends 30s — but grade still shows '?' or site-wide because personalized score path requires isPaid + profile. Comparison table lists 'Personalized scores' as Pro-only — but the user just provided the inputs. Lost dopamine moment.

  · *Fix:* Show free users their personalized grade on at least 3-5 demo brands after quiz completion. The 'Patagonia is an A FOR ME' moment converts.

**M11.** Submit tab fully paywalled — kills UGC growth flywheel — `src/App.jsx:3307-3318`

  · SubmitView returns paywall for !isPaid (src/App.jsx:3307-3318). Free users can't flag corrections or suggest companies. Bizarre for a data-quality-dependent app — paywalling the help you'd get from users finding errors. Yuka/Wikipedia/Reddit all let anyone submit.

  · *Fix:* Open submissions to all. Rate-limit by fingerprint if abuse concerns. Contributors convert at much higher rates than passive users.

**M12.** Lean sort hardcoded L→R doesn't match user's lean preference — `src/App.jsx:4111, 4777-4781`

  · Pill says 'Lean' (src/App.jsx:4777) but sort is hardcoded left→bipartisan→mixed→neutral→right at 4111. A right-leaning user tapping Lean expecting alignment-first sees Left companies and bounces.

  · *Fix:* Drive order from profile.political so right-leaning user sees Right first. Or rename to 'Lean (L→R)' with arrow. Falls back to L→R when no profile.

**M13.** Free user shows closed row with no preview — harsh single-tap paywall — `src/App.jsx:1989-2018`

  · src/App.jsx:1989-2018, 2100 — free users on closed row see name + cat + grade (or '?' without profile) + lock icon. There's no preview of any data inside the card. The closed row could surface one extra free signal (a recall/breach chip) to demonstrate value before paywall.

  · *Fix:* Show 1 risk chip (recall/breach/lawsuit) inline on closed row when present. Reinforces 'gold inside' without giving away the breakdown.

**M14.** Suspicious entries in index: endowment funds and government divisions — `public/data/index.json`

  · Index includes 'Anne G. Lipow Endowment Fund', 'Toll Operations Division of Texas DOT', 'US Government Publishing Office' — look like SEC EDGAR bleed-through. Makes Browse noisier and dilutes search relevance.

  · *Fix:* Add junk-filter pass dropping entries matching 'Endowment Fund', 'Division of the [State/Federal] Dept', 'Office of', etc.

**M15.** Category names not normalized — singleton buckets hurt discoverability — `public/data/index.json`

  · 'Hospitality' (358) + 'Hospitality & Travel' (49); 'Beverage' (1) + 'Food & Beverage' (864); 'Aerospace' (1) + 'Defense & Aerospace' (31); one entry has cat='na'. Browse filter chips render near-duplicates with ~1 member each.

  · *Fix:* One-liner canonical-category mapping in export script. Fix marketwise cat='na' specifically.

**M16.** 'na' values dilute scoring instead of being excluded like neutral — `src/App.jsx:491, 504-560, 604`

  · App.jsx:495 NA_IS_FACTUAL=true treats 'na' on animals/guns/privacy/execPay as scored, returning default 45-62. A company whose only meaningful signal is labor=poor gets diluted toward 50 from three 'na' that have no user-pref logic.

  · *Fix:* Exclude 'na' from weighted scoring like neutral — `if (['neutral','na','n/a'].includes(...)) continue;`.

**M17.** Submit /api/submit silently succeeds even when Resend fails — `api/submit.js:85-94, src/App.jsx:3320-3345`

  · api/submit.js:94 always returns 200 even if Resend 4xx/5xx (quota, DKIM, API key rotated). UX intent is fine but operationally you have no signal that emails are being lost during e.g. a spam wave. The client setSent(true) after fetch.catch() also fakes success on network failure.

  · *Fix:* Keep 200 client behavior. Fire server-side PostHog event tagged email_delivered:true/false for observability. On client: await + check res.ok; queue to tn_pendingSubmits on failure (queue already exists for SuggestBrandButton).

**M18.** Browse industry chip has no breadcrumb back to Browse + focusedSlug persists across tab changes — `src/App.jsx:4906-4942, 4869-4887, 4014`

  · Browse → tile flips to Search with industry chip. Chip 'Clear' removes filter but doesn't return to Browse — users must hit Browse nav. focusedSlug also persists globally; user entering Search via Brand-of-Day, then Account, then back to Search sees focused-1-brand view still active.

  · *Fix:* Add 'Browse other categories →' secondary tap in industry chip. Auto-clear focusedSlug when tab leaves 'search'.

**M19.** Onboarding asks Skip → jumps to slide 2 (not actual quiz/app skip) — `src/OnboardingFlow.jsx:128, 115`

  · OnboardingFlow.jsx:128 onClick goTo(2) — Skip just moves to last slide. User still has to tap 'Start exploring' to leave. No way to skip carousel+quiz in one action. Combined: scanner buried until slide 3 (the killer demo that should be slide 1).

  · *Fix:* Make Skip drop straight to app (onComplete with isGuest:true), or add 'Skip everything → see app' on slide 3. Surface scanner CTA on slide 1.

**M20.** Reveal 'Top match' from full 11k can surface aspirational-but-irrelevant brand — `src/App.jsx:4307-4317`

  · src/App.jsx:4307-4316 picks top-3 from all companies. With values-first profile, surfaces Patagonia/Ben&Jerry's. Target/Costco/Amazon shopper sees 'top match: Patagonia' and thinks 'not spending $300 on fleece'. Reveal moment falls flat. Also: low-confidence matches still get high-conviction 'Your top match' framing.

  · *Fix:* Ask 'where do you usually shop?' early. Filter top-match to user's shopping universe OR show 'A brand you might already buy' alongside aspirational. For low-score winners, soften headline to 'Start with these brands'.

**M21.** Onboarding tone too tech-bro for mom demo + 'codename' Values Fingerprint feels Buzzfeed — `src/OnboardingFlow.jsx:135-181, :79, src/App.jsx:4337`

  · Pure black + neon purple + monospace 'codename' on archetype card (4337) reads as crypto wallet, not Target shopper's app. Compare Yuka (white/green) or Honey (yellow). Demo card on slide 0 is the BEST moment but interactive hint (#555 11px) is invisible — no chevron, no auto-expand on entry. Many users tap purple CTA without discovering they could explore.

  · *Fix:* Auto-expand Patagonia on slide 0 entry. Add chevron icon to unexpanded rows. Consider light theme option. Replace codename/monospace 'archetype' with plain 'Your top priorities: Environment, Workers, Kid-safety'.

**M22.** Bottom-nav 'Lean' filter, font weight, inactive states drift across toggle UIs — `src/App.jsx:5753, 1043, 1054`

  · Bottom-nav inactive uses fontWeight:400 vs active 600. Inline filter chips keep fontWeight:600 with only color changing. Inactive grey different (T.txt3 vs T.txt2). Defensible but inconsistent — no unified toggle-state convention.

  · *Fix:* Document toggle convention in theme.js. Align inactive grey.

**M23.** Profile strip duplicates content on Account tab — `src/App.jsx:4684-4699`

  · Account already embeds archetype card AND profile summary card. Three identifying surfaces stacked. Strip is useful on other tabs.

  · *Fix:* Hide strip when tab==='account'.

**M24.** Wikipedia extracts used as primary source signal — undermines 'public records, not vibes' — `public/data/companies/*.json (wiki.controversies)`

  · ExxonMobil/Patagonia files include verbatim Wikipedia 'controversies' section. Wikipedia is consensus narrative, not primary filing. Marketing positions as 'public records, not vibes' — blurs the line.

  · *Fix:* Label Wikipedia-derived text as 'background context (Wikipedia)' on company page. Or stop including it in per-company JSON.

**M25.** Empty-category UI says 'Update history unavailable' — bleaker than needed + '$X across N records' jargon — `src/App.jsx:2861, 2123`

  · When lastUpdated missing, footer says 'Update history unavailable' — sounds like system error. Federal-penalty callout uses 'records' without context — could be court case, OSHA citation, EPA fine.

  · *Fix:* Change to 'Last updated · pending refresh' or hide. Change to '$X across N federal enforcement actions'.

**M26.** Onboarding company rows are non-button divs with onClick — `src/OnboardingFlow.jsx:57, 53, 88`

  · OnboardingFlow.jsx:57 companyRow is <div onClick>. Keyboard/VoiceOver users can't tab or activate. No aria-expanded. Decorative emoji not aria-hidden — VoiceOver announces 'shopping trolley, Amazon'.

  · *Fix:* Convert to <button> with aria-expanded + aria-controls. Add aria-hidden='true' to emoji divs.

**M27.** T.txt3 (#666) fails WCAG AA on dark bg — `src/lib/theme.js:6, src/App.jsx, src/OnboardingFlow.jsx, src/MarketingLanding.jsx`

  · #666 on #0f0f0f computes to ~3.9:1 — fails AA 4.5:1 for normal text. Used for 186 places. Onboarding #555 (~2.9:1) and #444 (~2.1:1) worse. Marketing landing C.textMute #6c6c72 ~4.3:1 also misses for small text.

  · *Fix:* Bump T.txt3 to #8a8a8a (≈5.6:1). Replace ad-hoc #555/#444 with token. Run contrast pass on every text <16px.

**M28.** Logo coverage gap — 46% null + BBB false-positive linking — `public/data/companies/aldi.json`

  · Aldi profile's BBB rating links to 'Aldi Fence LLC' in Connecticut. FEC matched to 'WALBRIDGE ALDINGER COMPANY'. Name-collision false matches across non-US parents.

  · *Fix:* Add name-similarity threshold + HQ-country sanity check before binding BBB/FEC to non-US parent.

**M29.** Bottom nav lacks 'jump to top' on active tap; window.scrollTo races on rapid taps — `src/App.jsx:3909-3915, 5750`

  · Tab effect at 3909-3915 fires only on tab change. Bottom-nav scrollTo races on rapid switching — inner ref may be null for empty-state tabs. iOS Capacitor shell may not honor window.scrollTo.

  · *Fix:* Null-check tabScrollRef. Debounce/RAF so only last tab-tap scrolls. Add 'tap active tab = scroll top' behavior.

**M30.** OnboardingFlow fade transition not gated on prefers-reduced-motion — `src/OnboardingFlow.jsx:26-29, 47`

  · Global CSS rule covers CSS transitions, but OnboardingFlow uses inline 'opacity 0.28s ease' + setTimeout(280) which is JS-driven — prefers-reduced-motion has no effect. Vestibular sensitivity affected.

  · *Fix:* Read window.matchMedia('(prefers-reduced-motion: reduce)').matches; when true, skip 280ms setTimeout and inline transition.

**M31.** BarcodeScanner stale closure on lastCode + cleanup doesn't reset refs — `src/App.jsx:140-325`

  · scan callback at 216 and onResult at 247 read lastCode from closure — dedupe only protects within single effect run. Can fire lookup(code) twice for same code. Cleanup doesn't null detectorRef/streamRef/zxingControlsRef.

  · *Fix:* Use lastCodeRef = useRef(null); check/set ref inside callbacks. Null out refs in cleanup.

**M32.** tn_freeViewed week-key + multiple inline JSON.parse(localStorage) on every render — `src/App.jsx (multiple)`

  · Library count badge JSON.parse(localStorage 'tn_viewHistory') on every render (5192). Similar pattern at 5108, 5212, 5326, 4722, 2810, 2003, 2025, 3525. Cheap individually but a footgun.

  · *Fix:* Lift viewHistory and purchaseLog into useState seeded once. Sync from writers. Cap history length on write (200 entries).

**M33.** PaywallScreen email read at useState init can stale — `src/App.jsx:800`

  · src/App.jsx:800 reads getStoredEmail only at mount. If RevealEmailCapture / EmailDigestCard sets email mid-session and paywall opens without remount, field is empty.

  · *Fix:* useEffect that re-reads when showPaywall flips true. Or confirm Paywall isn't kept mounted with display:none.

**M34.** Logo display monogram fallback chain is robust but unscoped logoUrl can XSS-vector — `public/data/companies/*.json`

  · Per-company logoUrl values come from pipeline (semi-trusted) and flow to <img src>. Attacker who could PR a malicious logoUrl could point at tracking URL. Risk is informational.

  · *Fix:* In pipeline export, allowlist logoUrl: upload.wikimedia.org, logo.clearbit.com, your CDN. Reject else and fall back to initials.

**M35.** Quiz cannot communicate 'climate is my #1' — caps at 5 alongside other items + no climate-dealbreaker — `src/App.jsx:411-422, 562-607`

  · Importance grid allows 5 across all axes — no relative intensity. Only political-lean boost (×2) acts as climate amplifier, keyed to L/R identity not climate priority. Dealbreakers screen has no 'major fossil-fuel financier' / 'Climate Action 100+ laggard'. Climate maximalist can't express it.

  · *Fix:* Add 'Climate dealbreaker' option (penalize Carbon Majors/Forest 500 laggards). Or let one importance pick get 2x multiplier.

## 🌱 Low / nice-to-have (20)

**L1.** Sort selection not persisted across sessions — _src/App.jsx:3839_
  · *Fix:* Lazy-init from localStorage.getItem('tn_searchSort') with guard for unknown values; useEffect to write on change.
**L2.** Typeahead dropdown dead during 800ms search-index load window + no keyboard nav + no ARIA combobox — _src/App.jsx:3804-3814, 4610-4670_
  · *Fix:* Fall back to naive prefix filter during load gap. Trigger loadSearchIndex on input focus. Add combobox WAI-ARIA pattern with keyboard nav.
**L3.** Bottom-nav tap on already-active tab is a no-op (no scroll-to-top) — _src/App.jsx:5750, 3910_
  · *Fix:* On nav button click, if t.id === tab, call tabScrollRef.current?.scrollTo({top:0, behavior:'smooth'}).
**L4.** Day-7 reflection card 'dismiss' doesn't re-render — uses setState noop — _src/App.jsx:4736-4738_
  · *Fix:* Hoist day7 dismissed into actual useState seeded from localStorage.
**L5.** Skip button on onboarding nearly invisible (#444 on #0f0f0f) + dead Terms/Privacy links — _src/OnboardingFlow.jsx:118, 180_
  · *Fix:* Bump Skip color to T.txt2 (#a8a8a8). Wire Privacy to #privacy, Terms to a real page or remove the link.
**L6.** Sign-out window.location.reload() jarring; better to reset React state — _src/App.jsx:5645-5646_
  · *Fix:* Replace with state resets: setScreen('splash'); setCurrentUser(null); setProfile(null); setHasOnboarded(false).
**L7.** Submit tab branch is dead code — unreachable from UI — _src/App.jsx:5517, 5588_
  · *Fix:* Delete the tab==='submit' branch (or repurpose as deep-linkable share route).
**L8.** Static assets served with max-age=0 instead of immutable — _vercel.json_
  · *Fix:* Add headers rule for /assets/(.*) → Cache-Control: public, max-age=31536000, immutable.
**L9.** Trending fallback brands can route to dead search if not in index — _src/App.jsx:4138-4156_
  · *Fix:* Filter fallback through deduped.some(c=>c.name===name) before rendering.
**L10.** Week-key computation isn't ISO-8601 — drifts around New Year — _src/App.jsx:2001_
  · *Fix:* Use ISO week (date-fns getISOWeek) or store start-of-week timestamp.
**L11.** Onboarding Patagonia A-grade demo contradicts the actual data file — _src/OnboardingFlow.jsx:5-6 vs public/data/companies/patagonia.json_
  · *Fix:* Either backfill Patagonia with real public signals (B Corp, 1% for the Planet, Fair Trade, SBTi) so data matches the demo, or pick a different demo company where data already supports the A.
**L12.** EU/international coverage gaps — labor/political/DEI signals are US-only — _src/App.jsx:60-64, 504-560, 700-707_
  · *Fix:* Phase as 'EU support' milestone: SBTi + CDP + UK GPG + EU Transparency Register + BAFA LkSG. Add 'Data coverage: US-focused, expanding to EU' disclosure on marketing landing.
**L13.** Theme tokens missing: grade colors, status colors, radius scale duplicated 20+ times — _src/App.jsx (multiple), src/OnboardingFlow.jsx:4-18, src/PrivacyPolicy.jsx:8-15, src/lib/theme.js_
  · *Fix:* Extend theme.js with grade={A:{fg,bg,border},...}, good/goodBg, warn/warnBg, radius={sm,md,lg,pill}. Import T into OnboardingFlow/PrivacyPolicy. Snap icons to 4-step scale (12/16/20/28). 1-2 hour mechanical edit.
**L14.** Email field BEFORE pricing on paywall + no annual anchor + no social proof — _src/App.jsx:821-908_
  · *Fix:* Remove inline email field, pass to Stripe Checkout as customer_email. Add annual anchor ($14/yr — save 41%) which makes monthly feel premium. Add 'Join 12,000+ shoppers · ★ 4.8' social proof line. Add Restore Purchase link below 'Maybe later'.
**L15.** Schema pollution: 42 companies have flat-key parser leakage in sc — _public/data/companies/*.json (abb, costco, american-airlines, boeing, 38 others)_
  · *Fix:* In bake script, emit sc[k]=value and sc_detail[k]=s as siblings, not sc[k+'.s']=s. Re-bake and republish.
**L16.** Inconsistent quiz answer-value naming + 'mixed' politics may collapse to neutral — _src/App.jsx:399-409, 430-458, 504-560_
  · *Fix:* Standardize tri-option axis on {avoid,support,neutral}. Add unit test that scoreCat('political','left',{lean:'mixed'}) returns documented value. Assert in scoring engine that unknown values log warning rather than silently coerce.
**L17.** Conservative brands show neutral despite real data in the file — _public/data/companies/chick-fil-a.json, in-n-out-burger.json_
  · *Fix:* Pipeline should roll political.lean field into sc.political, and charity_irs990.totalGrants>1M into sc.charity. Currently long-form is written but doesn't reach the scored summary the UI reads.
**L18.** Bottom-nav labels at fontSize:10 cramp on iPhone SE; 'Top Picks' can wrap — _src/App.jsx:5750-5754_
  · *Fix:* Add whiteSpace:nowrap. Optionally bump fontSize to 11 and reduce icon to 20 to keep overall height.
**L19.** OG image cache-control has duplicate directives — _api/og/values.js, api/og/brand.js_
  · *Fix:* Use single Cache-Control header; let it override Vercel's default.
**L20.** Logo coverage gap — 46% of brands have null logoUrl — _public/data/index.json_
  · *Fix:* Top-N (by PostHog impressions) brands without logo: one-time pass using Clearbit /v1/{domain} or DuckDuckGo ip3 endpoint.

## 🏆 Wins (things working well — keep doing)

- **Symmetric scoring engine is a real moat** — scoreCat gives a Right voter 97 for a right-donating company and 8 for a left-donating one — exact mirror of the Left case. Same for DEI. Political spectrum bar uses neutral gray gradient, not red/green. The whole scoring path is ~70 lines of readable JS any methodology reviewer can audit. The 'neutral = exclude from weighted score' rule (Phase 5.ac) is the right methodological discipline. This is the strongest pitch angle and the strongest defense against 'secretly liberal' accusations. Lead with this in every trade-press pitch.
- **Soft-to-hard quiz ordering with politics LAST is research-backed and well-documented** — Low-stakes avoids → importance ranking → identity → peak-end dealbreakers. Code comments cite Krosnick + Pew polarization research. 'Mixed' option for cross-cutting views halves political weight instead of zeroing. 'Stays on your device. We never sell or share this.' microcopy is exactly where research says it should go. Skip button copy 'Skip — see baseline scores. You can take the quiz anytime from Account.' tells users consequence + recovery path — unusually thoughtful.
- **Onboarding email/password drop + draft persistence + deep-link bypass are correct decisions** — Killing the upfront signup wall (Phase 5.as) was the right call for the demographic — most users wouldn't survive a create-account wall after a 30-second carousel. Quiz draft persistence to localStorage on every step/answers change addresses iOS Safari backgrounding eviction. /company/<slug> deep-link auto-sets tn_hasOnboarded so shared brand links skip 3 carousel slides + 10 quiz questions. These are the kind of decisions a careful founder gets right.
- **Privacy policy is unusually plain-English and honest** — Plain English, no 'we may share with affiliates and partners' weasel clauses, explicit named processors (PostHog/MailerLite/Vercel/Apple/Open Food Facts), explicit no-sell language, real contact email. Above-bar for a consumer app. The implementation gaps (PostHog US routing, no consent banner, no in-app deletion) are fixable — the writing itself is a trust asset.
- **SEO architecture + AASA + JS bundle hygiene are launch-grade** — 11,211-URL sitemap, per-company server-rendered HTML at /company/<slug>, AggregateRating JSON-LD intent, explicit GPTBot/ClaudeBot/PerplexityBot allow rules. AASA is valid + minimal. JS bundle 626KB uncompressed, 187KB brotli — well under 1MB budget. ATS configured correctly (HTTPS-only). Brand-search long-tail SEO is the real compounding moat if PH never lands. (Note: per-company SEO pages still need JSON-LD wired and og:url fixed — listed as a high-priority fix.)
- **ship-ios.sh is the strongest piece of infrastructure in the repo** — Handles altool key staging, dual-bumps CFBundleVersion + CURRENT_PROJECT_VERSION (most indies hit Apple's 'duplicate build' rejection at least once), re-injects entitlements line that cap sync strips, manual provisioning for Universal Links. Comments preserve the 'why' for each fix. This is the rare ship script that survives a founder vacation.
- **Safe-area handling is thorough + zoom-prevention applied to most flows** — Bottom nav, scanner top/bottom bars, modal sheets, tab content all use env(safe-area-inset-*). 100dvh + paddingTop is the correct modern iOS pattern. Main search, paywall email, SubmitView, failed-search email-capture, OnboardingNudge all explicitly set fontSize:16 with explanatory comments — the Library <select> is the lone straggler. Scroll-to-top on tab change with dual-target reset (tabScrollRef + window) handles WebView pain cleanly.
- **Comparison table + $1.99 price point are well-tuned CRO foundation** — Side-by-side Free vs Pro with checkmarks is the right pattern. 9-row depth feels substantive without scrolling. The 'hi' highlight rows correctly identify killer features (personalized scores, scanner). $1.99/mo is below the psychological-friction threshold. Email prefill from getStoredEmail() shaves a tap for returning users. Iterate on table row order and highlight color but don't rebuild — this is the foundation.
- **Server-side hygiene: ATS, AASA, /api/submit XSS-escaped, /api/company-seo path-traversal-safe** — Email body XSS properly escaped via esc() helper across every interpolation. SEO endpoint defended against path traversal at Vercel edge + the function itself uses encodeURIComponent. OG image cache hit on second request (x-vercel-cache: HIT) with appropriate s-maxage. Zero dangerouslySetInnerHTML/innerHTML usage in src/. The security floor is solid — gaps are at the secrets-management and rate-limit layer, not the input-sanitization layer.
- **Founder voice in App Store description is the best trust signal in the product** — 'Built solo, indie, no VC money. — Aron, founder' lands harder than any FEC/EPA citation. It's the line that makes someone tell a friend 'one guy built it, just go try it.' Currently missing from in-app onboarding — port this voice into onboarding, About screen, and Sources tab footer. The App Store reads as a human; the app should too.
- **Saved/History library: strong empty states + chronological grouping** — Both Library sub-tab empty states use same visual pattern (themed icon + 2-line copy + one accent CTA). 'No results in this filter' offers inline 'Clear filter' rather than dead-ending. History grouped Today/Yesterday/Earlier with 'Xm/Xh/Xd ago' formatting. Themed destructive-styled confirm modal for clear-all. Saved tab sort (recent/grade/name/category) only renders when 2+ categories present — graceful for small libraries.
- **Better for your values CTA is the best-designed element on a CompanyCard** — Fires only for personalized C/D/F grades, requires ≥7-point improvement, caps at 3, sorts descending, green call-to-switch styling with full alternative card. 'X+ points better for you' microcopy gives a concrete why-switch number. Tap targets generous ~50px. onNavigate routing was fixed in 5.ag QA. Extend this prominence pattern to the Save/Compare bar.
- **Privacy category for brands has real teeth — HIBP + CourtListener integration** — Not vibes — wired to HIBP breachCount, totalRecordsLost, hasSensitiveBreach, recency staleness (>3yr dims badge), plus litigation data from CourtListener with class-action detection. Sources panel cites EFF and Mozilla Privacy Not Included. Labels are factual ('No Documented Breaches' / 'Documented Breaches'), not judgmental.
- **MiniSearch fuzzy + prefix + name-boost + useDeferredValue is the right modern search stack** — {boost:{name:2}, prefix:true, fuzzy:0.2} — typo tolerance (amazn→Amazon), prefix matching, 2x name weight. Switching from 150ms setTimeout debounce to React 18 useDeferredValue (Phase 5) is adaptive to device speed and keeps input at high priority. Comment articulates the why. This is exactly the perf decision that holds up at 11k records.
- **SuggestBrandButton optional-email flow is a model UGC capture** — Three-phase state (idle → form → done_email/done_anon), prefill from getStoredEmail, persistence to tn_pendingSubmits, MailerLite tag with brand=<query> for targeted follow-up, dismiss-as-anon Skip, idempotent re-render. Highest-intent surface in the funnel with the implementation it deserves. Use this as a model when opening Submit to free users.

## 📋 Top-10 fix order

| # | Item | Why |
|---|---|---|
| 1 | Ship a real paywall OR pivot to waitlist before PH | Zero revenue possible in current state + App Store rejection risk. The waitlist pivot is 90 minutes of work and preserves all the conversion signal (paywall_shown, email_provided) you need to know whether to keep building. |
| 2 | Fix __skipMarketing ReferenceError + add root ErrorBoundary | One-line fix unblocks a hard white-screen crash on a reachable user path (Privacy → Back). Root ErrorBoundary catches any other pre-main crashes including Safari private-mode localStorage throws. |
| 3 | Persist Pro entitlement + add Restore Purchase | Even with real billing, paid users lose entitlement on every relaunch in current state. Combined with the fake paywall, no paying customer can stay paid. Required before any real billing ships. |
| 4 | Deliver actual free-tier content (3-5 fully-unlocked demo brands + remove dead localStorage wipe) | The compounding bugs (gated detail, wiped quota, '?' grade) mean a free user sees NOTHING after onboarding promised 'all free'. This is the single biggest credibility wound. Yuka-style 3-5 permanent demo brands fixes 80% of it without touching the paywall. |
| 5 | Move MailerLite key server-side + add CSP + rate-limit /api/submit & /api/og | Single security sprint covering the highest-impact server-side gaps. Today's bundle is clean only because the env var is unset — that's a footgun waiting for the next deploy. |
| 6 | Backfill top 100 PostHog-impression brands with verified signals (Patagonia, Chick-fil-A, Hobby Lobby, Tesla, Ben & Jerry's) | These are the lookups every reviewer/journalist/skeptical user performs in their first 60 seconds. Patagonia showing 'neutral' on environment will sink trade-press credibility on day one. Highest-ROI data work pre-launch. |
| 7 | Unify brand-navigation: extract openBrand(slug) helper, call from all entry points | Six different surfaces produce different results for 'I want to see this one brand'. The Brand-of-Day card — the centerpiece of the daily-ritual surface — sends users into a search-result list. Cheap mechanical fix, big consistency win. |
| 8 | Add minWidth/minHeight:44 to icon buttons + fix Library <select> auto-zoom + Save/Compare/Share placement | Multiple sub-44pt buttons (24×24 in Compare!) violate Apple HIG and WCAG. The iOS auto-zoom on Library sort is a known pattern already solved elsewhere in the codebase. Save/Compare moved above the fold is a 1-line JSX move with big engagement upside. |
| 9 | Honest copy pass: remove dead 'Live update'/'Sources tab' promises, expand acronyms, neutralize US-political framing | Sources tab promises features that don't exist; '30-second quiz' is 60-90s; acronym walls alienate non-US readers; 'adversary nations'/'Your wallet is a vote' read as ideologically loaded. None require engineering work — pure copy edit pass earns the trust the methodology actually deserves. |
| 10 | Promote ConfirmModal pattern into shared Modal + add bottom-nav landmarks/aria-current + replace alert()/prompt() everywhere | One refactor (shared Modal wrapper) closes a11y gaps across 4 overlays AND eliminates the 'trunorthapp.com says:' Android scam-popup UX in the highest-intent funnel (paywall + submit). VoiceOver users get a usable app for the first time. |

## Audit stats

- **25 agents** ran in parallel across 3 phases
- **343 raw findings** dedupped via synthesis agent
- **1.9M tokens** consumed
- **25 minutes** wall-clock
- **5 critical · 15 high · 35 medium · 20 low · 15 wins**

---

## Source agents

**App Review (10):** Visual-Styling, Mobile-Responsive, Navigation-Flow, Onboarding-Flow, Quiz-UX, Search-Filters, Brand-Detail, Paywall-Conversion, Account-Library, Edge-Errors

**First-Time Users (10):** Suburban-Mom-50s, GenZ-Climate-Activist, Conservative-Shopper, Privacy-Tech-Worker, Skeptical-Journalist, Budget-Conscious-Free-User, Founder-Peer-Technical, Accessibility-User, International-EU-User, Non-Native-English

**QA + Stress (5):** Code-Review-Deep, API-Endpoints, Data-Integrity, Security-Audit, Production-Live-Check