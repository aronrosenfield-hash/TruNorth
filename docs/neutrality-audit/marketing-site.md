# Marketing-Site Neutrality Audit

**Date:** 2026-06-08
**Branch:** `feature/neutrality-audit-marketing`
**Auditor:** Claude (pre-Product-Hunt launch sweep)
**Surface scope:** Public marketing landing, privacy policy, SEO meta tags, sitemap, marketing-only HTML.

> **Why this matters.** Marketing copy is the FIRST surface every visitor — and every share-preview viewer — touches. A single biased adjective in an `og:description` ships everywhere TruNorth's link is pasted. Per CORE PRINCIPLE: "Journalism, not opinion."

---

## Files scanned

| File | Lines | Notes |
|---|---|---|
| `src/MarketingLanding.jsx` | 596 | Hero, value props, FAQ, testimonials, demo card, email capture |
| `src/PrivacyPolicy.jsx` | 194 | Plain-English privacy policy |
| `index.html` | 104 | SEO meta + OG/Twitter share-preview tags |
| `public/sitemap.xml` | 67,269 | URL-only entries (no descriptions) — out of scope |
| `public/skip.html` | 7 | Onboarding skip redirect — no copy |
| `docs/TALK_TRACKS.md` | 170 | Founder talk tracks — read for tone calibration |
| `src/lib/marketing.js` | 77 | Email-capture lib — code/comments only |

Read end-to-end, not just grep'd. Cumulative-tone findings included below.

---

## Severity counts

| Severity | Count | Definition |
|---|---|---|
| CRITICAL | **2** | Auto-fixed inline. Single-phrase partisan signal, advocacy framing, or factual / category inconsistency. |
| MAJOR | **4** | Flagged for owner review. Cumulative or contestable; needs product/marketing judgment. |
| MINOR | **3** | Noted for future polish. Acceptable for launch. |

---

## CRITICAL fixes applied

### 1. `index.html:33` — OG description category name
**Before:**
```
"11,000+ companies graded across politics, environment, labor, animal testing, privacy & more — using only public records. Free on iOS."
```
**After:**
```
"11,000+ companies graded across politics, environment, labor, animal welfare, privacy & more — using only public records. Free on iOS."
```
**Why:** "Animal testing" specifically names a contested practice (cosmetic / lab testing) and is the language used by advocacy campaigns against the practice. The app's own category is "animal welfare" (per `docs/TALK_TRACKS.md` line 161 and in-app scoring). Using "animal testing" in the OG description signals an editorial stance on the practice. "Animal welfare" is the neutral category label and matches the app. Bonus: this is a silent fix — every Facebook/Slack/LinkedIn/iMessage share-preview now uses the neutral term.

### 2. `src/MarketingLanding.jsx:167` — Value prop title
**Before:**
```
title:"No streaks. No outrage. Just journalism.",
body: "...no daily-streak hooks, no rage-bait headlines..."
```
**After:**
```
title:"No streaks. No rage-bait. Just journalism.",
body: (unchanged) "...no daily-streak hooks, no rage-bait headlines..."
```
**Why:** "No outrage" reads two ways: (a) UX-design critique of engagement traps, (b) implicit positioning as "not part of the outrage industrial complex," which leans toward a conservative-coded framing of media. The body copy already lands the UX-design point cleanly with "rage-bait headlines." Aligning the title with the body removes the secondary partisan reading and is more accurate to what the card actually claims.

---

## MAJOR — flagged for review (NOT auto-fixed)

### M-1. Demo brand grades signal political tribe in the hero (`MarketingLanding.jsx:104-108`)

```js
const DEMO_BRANDS = [
  { name:"Patagonia",  ... grade:"A", ... },
  { name:"Amazon",     ... grade:"C", ... },
  { name:"ExxonMobil", ... grade:"D", ... },
];
```

**Issue:** All three brands are coded along the same political axis. Patagonia (progressive-favored apparel co-op) gets A. ExxonMobil (right-coded fossil-fuel major) gets D. Amazon (left-critique target) sits at C. A conservative shopper opening the landing sees their identity-coded brand graded "D" inside the first viewport — *before* they reach the disclaimer "Grades shown are an illustrative summary. Full breakdowns inside the app" (line 142) or the personalization promise ("The same brand can earn a different grade for you than for your neighbor," line 158).

**Mitigation in place:** The disclaimer and the personalization value prop *do* defuse this if read. But the visual gestalt is processed in the first 1-2 seconds, before the reader scrolls.

**Proposed neutral rewrites (pick one):**
- **Option A (mix the tribe-coding):** Show a progressive-coded brand at a low grade and/or a conservative-coded brand at a high grade — e.g. swap Amazon's C with a different mid-grade brand without strong party-coding, and consider replacing ExxonMobil with a brand coded oppositely to Patagonia on the labor / privacy / safety axis (e.g. show a tech company low on privacy, or a fast-fashion brand low on labor).
- **Option B (politically neutral demo set):** Use brands without strong party-coding — e.g. Costco (A on labor), Boeing (D on safety), Spotify (C on artist pay). Demonstrates the methodology without picking a tribe.
- **Option C (keep the demo, surface the personalization disclaimer earlier):** Add a "Grades shown are illustrative. Yours will differ based on your quiz." line *above* the demo card, not below.

**Recommendation:** Option A or B. Highest-leverage neutrality fix on the entire site.

> **Note:** `src/OnboardingFlow.jsx` slide 1 has the same Patagonia=A / ExxonMobil=D pair. Owned by a different agent per the task brief — flag for that agent's audit.

### M-2. "Most 'ethical shopping' tools are vibes-based." (`MarketingLanding.jsx:431`)

```
Most "ethical shopping" tools are vibes-based. We pull from the same primary sources investigative journalists use.
```

**Issue:** Dismisses the entire competitive category as "vibes-based." Industry-critique framing, not partisan-critique — but the dismissive tone undermines the "journalism, not opinion" core principle. A journalist would not write "every competitor is vibes-based"; they would specify *what* the competitor does and let the reader judge.

**Proposed neutral rewrite:**
```
Other "ethical shopping" tools blend opinion, advocacy campaigns, and editorial scoring. We pull from the same primary sources investigative journalists use — no editorial layer.
```

This says the same competitive truth ("we're different because we use primary sources") without the "vibes-based" dig.

### M-3. "No vibes. No spin. Just receipts." (`MarketingLanding.jsx:153`)

Repeated in the OG title (`index.html:32`), Twitter title (line 42), Twitter description (line 43), and the hero lead (line 361 — "Real records, not opinions"). The phrase is on-brand and clear. "Spin" is industry-marketing critique, not partisan. "Receipts" is internet vernacular for "evidence."

**Issue:** Cumulative effect. "No vibes" / "No spin" / "No opinions" / "vibes-based" / "Real data, not opinions" — the page repeats this contrast ~6 times. Each use is defensible; the cumulative effect feels combative ("everyone else lies, we tell the truth"). The "journalism, not opinion" stance is *better served by demonstrating*, not by repeating the contrast.

**Proposed light edit:** Keep one or two strong uses (the OG title and the hero lead). Soften the value-prop body from "No vibes. No spin. Just receipts." to "Every grade traces to a public record." Same content, less prosecutorial tone.

### M-4. "Conscious shopping, made simple" (`MarketingLanding.jsx:348` — Hero eyebrow)

**Issue:** "Conscious shopping" / "conscious consumer" is industry-standard but historically associated with progressive consumer movements (B Corp, fair trade, etc.). Most readers won't register the coding, but a values-first conservative shopper may bounce on the eyebrow alone.

**Proposed neutral rewrite (any of):**
- "Values-aligned shopping, made simple"
- "Shop your values. Backed by public records."
- "Shopping, informed by public records"

Eyebrow text — low cost to change.

---

## MINOR — noted, acceptable for launch

### m-1. "the holding company you were boycotting" (`MarketingLanding.jsx:163`)
Frames the reader as a boycotter. User-action framing, not editorial, but assumes a specific consumer behavior. Acceptable; consider "the parent you were trying to avoid" in future copy revisions.

### m-2. "consumers got fed up with marketing-speak" (`TALK_TRACKS.md:101`)
Founder talk-track, not on the public landing. "Fed up" is mildly editorializing; fine for spoken-word press but flag if it migrates into landing copy.

### m-3. Repeated use of "Real" / "Real data" / "Real records"
The word "real" implies others are "fake." Three uses on the landing (`Real data, not opinions` × 2, `Real records, not opinions` × 1, plus OG/Twitter). Functional; future passes could vary the framing ("Public-record data, not editorial scoring," etc.).

---

## SEO meta-tag findings

| Tag | Bias status | Notes |
|---|---|---|
| `meta description` | ✅ Neutral | "11,000+ companies graded across 9 value categories using only public records — FEC, OSHA, EPA, SEC, NLRB. No opinions. No vibes. Free on iOS." Mentions only neutral-coded regulators. |
| `og:title` | ✅ Neutral | "TruNorth — Shop with your values. Real data, not opinions." |
| `og:description` | ✅ **Fixed** | Was: "...animal testing, privacy..." → Now: "...animal welfare, privacy..." (matches in-app category name). |
| `og:image:alt` | ✅ Neutral | "TruNorth — 11,000+ brands graded using public records" |
| `twitter:title` | ✅ Neutral | Mirrors og:title. |
| `twitter:description` | ✅ Neutral | "11,000+ brands graded using public records — FEC, OSHA, EPA, SEC. No vibes. Free on iOS." |
| `<title>` | ✅ Neutral | "TruNorth — Know where your money goes" |

**Verdict on share-preview surface:** Clean after the one fix. Every share preview now uses neutral category language and names only primary-source regulators (no editorial framing of *what those regulators find*).

---

## TONE assessment — overall page

**One-line verdict:** *The page leans slightly progressive in framing (demo brand selection + "conscious shopping" eyebrow + cumulative "we tell the truth, they don't" tone), but the underlying claims are journalism-defensible. A conservative shopper would notice the lean before reaching the personalization disclaimer; a progressive shopper would read it as on-brand.*

**Cumulative-effect issues:**

1. **The demo card is the loudest tribal signal.** A Patagonia=A / ExxonMobil=D combo in the first viewport is processed before any disclaimer is read. This is the highest-ROI neutrality fix on the site (see M-1).
2. **"No X. No Y. No Z." appears too often.** Six negation contrasts repeat the same "we're real, they're fake" pattern. Each is defensible; the aggregate sounds combative rather than journalistic. Soften 1-2 instances (see M-3).
3. **Competitor critique is too sharp.** "Most ethical-shopping tools are vibes-based" (line 431) and the TALK_TRACKS line on Buycott ("that's activism") undermine the "journalism, not opinion" stance. A journalist describes; she does not dismiss (see M-2).
4. **Privacy policy is impeccably neutral.** Zero findings. The plain-English, low-collection framing is on-brand and unobjectionable.
5. **Testimonials are non-partisan.** All three quotes ground in concrete user actions (dish soap, formula, EPA enforcement) rather than political identity. Keep as-is.

**Net call:** Ready for launch after M-1 is decided on. M-2 / M-3 / M-4 are post-launch polish. The two CRITICAL fixes applied here are sufficient to remove explicit category bias from the silent-but-pervasive share-preview surface.

---

## Out-of-scope items (handed to other agents)

- `src/App.jsx` — SPA; separate agent owns.
- `src/OnboardingFlow.jsx` — onboarding slides; separate agent owns. *Note: shares the Patagonia=A / ExxonMobil=D demo pair flagged in M-1.*
- `docs/marketing/` rendered PNGs — separate agents own image regeneration.
- Per-company JSON narratives in `data/` — covered by the separate per-company neutrality audit.

---

## PR

Branch: `feature/neutrality-audit-marketing`
PR: open, **do not merge** until M-1 is decided on by the owner.
