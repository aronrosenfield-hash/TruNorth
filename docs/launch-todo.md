# TruNorth Launch To-Do — Honest, Prioritized

> Based on the 25-agent audit (343 findings synthesized). What's actually risky if you launch now vs. what's polish vs. what's actually solid.

**Launch date:** Tuesday June 23, 2026 (Product Hunt) — **21 days**.

---

## 🔴 Real risks if you launch today (the "hardcore" stuff)

These are the audit's actual hard-hitting findings. Either fixed already, or still real and need a decision.

### 1. **"11,000+ brands graded" is overstated** — _still real_

The audit found **85% of brands have zero personalization signal**. They're in the catalog with `neutral` or empty values across every category. The quiz can't actually personalize their grade because there's nothing to weight.

> "Patagonia shows neutral despite being the iconic green brand" — Skeptical-Journalist agent

**What to decide:**
- **A.** Backfill personalization signal for top 100 most-recognized brands (Patagonia, Nike, Amazon, Walmart, Target, Costco, Apple, Google, etc.) — ~2-3 hr of pipeline work. Biggest single credibility lift.
- **B.** Reframe copy from "11,000+ graded" → "11,000+ tracked" with disclosure that deep signal exists for ~1,500 brands. More honest. Easier.
- **C.** Accept the gap. Lean into "verified records on top-traffic brands" framing. Cheapest.

**My recommendation:** **B + A for top 50 only**. Reframing solves the credibility hit; backfilling the top 50 most-searched brands (about 1 hour of pipeline work) makes the experience feel real for the brands users will actually look up day 1.

---

### 2. **Paywall isn't real revenue yet** — _MITIGATED_

You ARE on the waitlist pivot now, so this won't get you App Store rejected. But the audit's underlying concern remains: you have no monetization until RevenueCat is live.

**What to decide:**
- Form TruNorthApp LLC + open a business bank account (your blocker for ~3 months now)
- OR stay free forever for v1 launch + monetize later

**My recommendation:** Don't sweat this for PH. The waitlist captures intent. Get to LLC formation within 30 days post-launch.

---

### 3. **Free-tier expectations vs. reality** — _MITIGATED_

The audit found onboarding promises ("1 free view/week") that the code didn't deliver. **Both are fixed now.** Free users can expand any company detail panel; the 1-per-week paywall fires only on the second unique brand tap.

But the audit's deeper point stands: **the free tier needs to feel valuable enough that people don't immediately delete the app**. Right now a free user gets:
- Browse 11,000+ brands ✅
- See letter grades ✅
- Take the values quiz ✅
- View ONE full brand detail per week ✅ (now actually works)
- Then paywall ("join waitlist") ✅

**My recommendation:** A first-week metric to watch — **% of installs who stay 7+ days**. If it's under 30%, the free experience is too thin.

---

### 4. **Acronym wall alienates non-US, non-native English readers** — _still real_

FEC, OSHA, NLRB, EPA, SEC — used throughout the app without ever being expanded. Non-US users + younger users won't know what these mean.

**What to decide:**
- Run a 30-min copy pass expanding acronyms on first use ("Federal Election Commission (FEC)") and softening US-political framing
- OR ship as-is and accept that v1 is US-focused

**My recommendation:** Spend the 30 min. It's the cheapest credibility win. I can do this if you say go.

---

### 5. **Sources tab promises things that don't exist** — _MITIGATED_

The audit found references to a "Live update" button that doesn't exist in the UI. **Already fixed** (removed from Sources copy this session). Should sweep one more pass to make sure no other dead promises remain.

---

## 🟡 Soft polish — should fix but launch-survivable

These will get noticed by power users + reviewers, but won't sink the launch.

| | Item | Effort | Notes |
|---|---|---|---|
| ☐ | **Modal accessibility** (Compare/Scanner/WhatsNew/Paywall) | 1-2 hr | Add `role="dialog"`, `aria-modal`, focus trap. App Store reviewers DO check this. |
| ☐ | **Unified navigation** | ~1 hr | Brand-of-Day, Weekly Digest, Library, search-row taps navigate inconsistently. Some focus the brand, others dump into search. |
| ☐ | **Bundle size** (2.5MB companies + 4MB icon font) | 2-3 hr | First-paint perf. Risky refactor — defer to post-launch unless you see real slowness in TestFlight. |
| ☐ | **Tap targets pass** for remaining small buttons | 30 min | Did 7 this session — there are likely 5-10 more. |

---

## 🟢 What's actually solid (in case you need the reassurance)

The audit's 15 explicit "wins" — things the agents flagged as working well:

- **Methodology core** is strong — public records + neutrality framing holds up under journalist scrutiny
- **Symmetric scoring engine** + soft-to-hard quiz ordering
- **Privacy policy** plain-English honesty (a11y user + privacy expert both approved)
- **iOS shipping infrastructure** (ship-ios.sh) — best-in-class for indie
- **SEO architecture** (sitemap, JSON-LD, per-company HTML)
- **Deferred email capture** (no "give us your email" wall)
- **Capacitor native detection** (bulletproof 6-signal check)
- **Editorial Brand of the Day** + Values Fingerprint identity
- **Submit form's primary public record framing**
- **Reveal screen as celebration moment**
- **Day-7 retention card**

**Founder peer agent's take:** "Smart architectural choices. Solid solo-build velocity. Single biggest risk is the LLC/payments stall blocking monetization."

**Skeptical journalist agent's verdict:** "Would write the piece — the methodology holds up. Caveat to flag: data coverage gaps in the long tail."

---

## 📋 Your actual to-do list (sorted by priority + impact)

### This week (June 2-8) — Critical for launch readiness

| # | Item | Time | Owner |
|---|---|---|---|
| 1 | **Reframe "11,000+ graded" copy** to "11,000+ tracked" + add a "deep signal on top brands" line. Helps with #1 audit risk. | 30 min | I draft, you approve |
| 2 | **Backfill top 50 brands** (Patagonia, Nike, Amazon, Costco, etc.) with verified signals via pipeline run | 1-2 hr | Me, you trigger |
| 3 | **L-1: Pin Twitter tweet** from `/docs/producthunt/PROMO_COPY.md` | 5 min | You |
| 4 | **L-2: LinkedIn pinned post** from same doc | 5 min | You |
| 5 | **L-3: Personal email blast** to 10-20 closest contacts | 30 min | You |
| 6 | **Acronym pass** — expand FEC/OSHA/NLRB/etc on first use, neutralize US-political framing | 1 hr | Me |

### Next week (June 9-15) — Launch prep

| # | Item | Time | Owner |
|---|---|---|---|
| 7 | **L-9: Record demo video** for PH gallery (30-60 sec) | 1-2 hr | You |
| 8 | **App Store submission** — paste from `/docs/app-store-submission.md`, target Jun 17 | 1 hr | You |
| 9 | **Modal accessibility** + unified navigation pass | 2-3 hr | Me |
| 10 | **L-5: Install email signature** in Mac Mail | 5 min | You |
| 11 | **L-7: Activate Gmail auto-reply** Apps Script | 20 min | You |
| 12 | **L-8: Daily 10-min PH warming** routine | Recurring | You |

### Launch week (June 16-22) — Final readiness

| # | Item | Time | Owner |
|---|---|---|---|
| 13 | **L-10: Send trade press pitches** (4 personalized, drafts at `/docs/trade-press-pitches.md`) | 1 hr | You |
| 14 | **Confirm App Store status** — Apple should have approved by now | 5 min | You |
| 15 | **Pre-launch checklist** from `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` | 30 min | You |
| 16 | **Schedule launch-day tweets** to fire at 2:05 AM CDT Tuesday | 15 min | You |

### Launch day (June 23) — Execution

Already scripted in `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md`. Wake-up reminder fires at 1:50 AM CDT.

### Post-launch (June 24+) — Iterate

- Watch metrics for 48 hr
- Day 2 thank-you DMs to top 10 PH commenters
- Day 7 retro (`/docs/full-audit-2026-06-01.md` has the deferred items A-1 through A-5)
- Form LLC + start RevenueCat (X-2)
- Then flip `PRO_WAITLIST_MODE = false`

---

## What to do RIGHT NOW

**My honest recommendation, in this order:**

1. **Open `/docs/full-audit-2026-06-01.md`** and skim it once. The agents wrote those critiques out of genuine analysis — most of what they flagged is fixed or mitigated. You'll feel less anxious after reading the wins section.

2. **Ship the "11,000+ tracked" reframe + 50-brand backfill** — this resolves the single biggest credibility risk identified. Tell me "ship the credibility fix" and I'll start.

3. **Do L-1 + L-2 + L-3** (Twitter, LinkedIn, email blast) tonight or tomorrow. 40 min, biggest leverage you have.

4. **Trust the rest is fine.** You have 6 successful TestFlight builds, working analytics, working email capture, a credible product story, and 21 days of runway. The audit's "hardcore" critique is what good audits look like — they surface the worst-case interpretation so you can fix the real stuff. Most of the real stuff is fixed.

**The launch isn't fragile.** It's actually in great shape.
