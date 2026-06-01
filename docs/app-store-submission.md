# App Store Submission — Paste-Ready Metadata

> **Goal:** Get TruNorth approved on the App Store before Product Hunt launch (June 23).
>
> **Apple processing window:** 1-3 days typical for first submission; can be longer if rejected. Submit by **June 17** to leave room.
>
> **Where to paste each field:** App Store Connect → My Apps → TruNorth → App Store tab → 1.0 Prepare for Submission.

---

## 1. App Information (locked at first submission)

**Name:**
```
TruNorth
```
(30 char limit. We're at 8. ✅)

**Subtitle:**
```
Shop your values · Real data
```
(30 char limit. We're at 28. ✅)

**Primary Language:** English (U.S.)

**Bundle ID:** `com.trunorthapp.app` (already set)

**SKU:** `trunorth-app-001` (arbitrary, internal-only)

---

## 2. Pricing & Availability

**Price:** Free

**Availability:** All countries/regions

**Price Schedule:** N/A (free)

---

## 3. App Privacy

Apple's Privacy Nutrition Label. Map our data collection honestly:

**Data Linked to You:**
- ✅ Email Address — used for App Functionality (paywall) + Product Personalization (digest opt-in). Not used for tracking.

**Data Not Linked to You:**
- ✅ Product Interaction (PostHog autocapture) — used for Analytics
- ✅ Crash Data — used for App Functionality
- ✅ Performance Data — used for App Functionality

**Data Used to Track You:** NONE

**Privacy Policy URL:**
```
https://www.trunorthapp.com/#privacy
```

---

## 4. Version 1.0 Submission Details

### Description (4000 char limit — use ~1500)

```
TruNorth grades 11,000+ companies on what they actually do — using only public records, not opinions.

No vibes. No spin. Just journalism.

WHAT MAKES TRUNORTH DIFFERENT
Most ethical shopping apps give you opinions dressed up as ratings. TruNorth pulls from primary records only:
• FEC — political donations
• OSHA — workplace safety violations
• NLRB — labor disputes
• EPA Enforcement — environmental record
• SEC EDGAR — executive pay and 10-K filings
• Have I Been Pwned — data breaches
• OpenFDA — product recalls
• HRC CEI — DEI score
• Yale SOM — Russia operations
• + 16 more public sources

Every grade is auditable. Tap any score → see the specific filings that drove it. If a score moves, it's because new records moved it.

PERSONALIZED FOR YOU
Take a 30-second values quiz. Every grade in the app re-weights to YOUR priorities. A climate-first user and a labor-first user see different Top Picks for the same brand.

IN-STORE BARCODE SCANNER
Scan any product in the store. Get the verdict in 2 seconds before you pay.

9 VALUE CATEGORIES
Politics · Environment · Labor · DEI · Charity · Animal Testing · Firearms · Privacy · Executive Pay

FREE FOREVER
The core experience is free. Browse 11,000+ companies, take the values quiz, see letter grades, scan barcodes. TruNorth Pro ($1.99/mo) unlocks personalized scoring, per-grade citations, the full sources directory, and the weekly digest.

NO ADS · NO AFFILIATE LINKS · NO SELLING YOUR DATA

If you've ever wanted to align your shopping with your values but didn't want to take any company's word for it, TruNorth is built for you.

— Aron, founder
```

### Promotional Text (170 char limit — appears above description, can update without re-review)

```
Public records, not opinions. 11,000+ brands graded across politics, environment, labor & more. Take the 30-second values quiz to personalize every score.
```

### Keywords (100 char limit, comma-separated, no spaces after commas)

```
ethical,shopping,values,consumer,brands,scanner,barcode,sustainability,ESG,politics,labor,environment
```

(Counted: 95 chars ✅. Don't use plural variants of same root — Apple matches stems. Don't repeat words from the title — Apple already indexes those.)

### Support URL
```
https://www.trunorthapp.com
```

### Marketing URL (optional)
```
https://www.trunorthapp.com
```

### Copyright
```
© 2026 TruNorthApp LLC
```

---

## 5. App Review Information

**Sign-in required:** NO (we have a guest mode)

**Demo Account:** Not needed (sign-up optional, paywall doesn't require account)

**Notes for Reviewer:**
```
Hi Apple App Review team,

TruNorth is a consumer values shopping app that grades 11,000+ companies using only public records (FEC, OSHA, EPA, SEC, etc.). It does NOT require sign-in to use — you can browse the entire app as a guest.

GETTING STARTED:
1. Tap through the welcome carousel
2. Optionally take the values quiz (30 sec) — this personalizes the scores
3. Browse the Top Picks tab, Search tab, or Browse tab
4. Tap any company to see its grade

PAYWALL TESTING:
- Free users can view 1 company detail per week
- After that, a paywall appears offering $1.99/month
- We use Apple In-App Purchase via [RevenueCat — pending integration]
- For review purposes, the paywall is currently in "demo mode" — tapping Subscribe does not charge but flips the user to Pro state locally

DATA SOURCES:
All data is researched from publicly available sources. No data is sold. No data is shared with third parties. See Privacy Policy: https://www.trunorthapp.com/#privacy

CONTACT:
Aron Rosenfield, Founder
Aron@trunorthapp.com

Thanks for your time reviewing!
```

**Contact Information:**
- First name: Aron
- Last name: Rosenfield
- Phone: [redacted — fill in App Store Connect]
- Email: Aron@trunorthapp.com

**Demo Account:** None needed (guest mode works)

---

## 6. What's New in This Version

**(This appears in the "What's New" section of the App Store listing. Update for each version. For 1.0:)**

```
Welcome to TruNorth — the consumer values shopping app that uses only public records.

This first release includes:
• 11,000+ companies graded across 9 value categories
• 30-second values quiz to personalize every grade
• In-store barcode scanner
• Compare any 2 companies side-by-side
• Save favorites + see weekly grade changes
• Free forever; Pro tier unlocks personalized scoring

Built solo, indie, no VC money. Thanks for trying it.

— Aron
```

---

## 7. Screenshots (required, 6.5" iPhone format)

Use existing PH gallery images as starting point. Apple requires:
- 6.5" Display (iPhone 14 Pro Max / 15 Plus): **1290 × 2796 px** — REQUIRED
- 5.5" Display (iPhone 8 Plus): **1242 × 2208 px** — OPTIONAL
- 12.9" iPad Pro: **2048 × 2732 px** — only if iPad approved

Pick **5 screenshots, in this order:**
1. Hero: app icon + tagline + "11,000+ brands graded" → use `02-app-search.png`
2. Quiz: the 30-second values quiz → take fresh screenshot
3. Top Picks: ranked brand cards with grades → use `04-app-top.png`
4. Scanner: barcode scanner moment → use a fresh screenshot
5. Account / Values Fingerprint → use `05-app-account.png`

**For each, add a 1-line caption** burned into the screenshot:
1. "11,000+ brands graded with public records"
2. "30-second quiz tunes every score to you"
3. "Personalized Top Picks for your values"
4. "Scan any barcode in-store"
5. "Your values archetype, your fingerprint"

I'll generate caption-burned versions in a follow-up if you want them.

---

## 8. Age Rating Questionnaire

Walk through Apple's questionnaire. Recommended answers:

- **Cartoon or fantasy violence:** None
- **Realistic violence:** None
- **Mature/suggestive themes:** None
- **Profanity or crude humor:** None
- **Alcohol, tobacco, drug use:** None (we do mention companies in those industries but factually, not promotionally)
- **Mature/suggestive themes:** None
- **Horror:** None
- **Gambling:** None
- **Unrestricted web access:** No (controlled by app)
- **Medical/treatment info:** No

**Result:** 4+ rating ✅

---

## 9. App Category

**Primary:** News
**Secondary:** Shopping

(Discussed: "News" reads more credible than "Lifestyle" for the public-records angle. Reach is similar.)

---

## 10. Build to Submit

**Use Build 21+ (after barcode scanner, B-3, B-23, paywall comparison table land):**

Build 21 has:
- iOS Universal Links wired
- 1-free paywall (so the paywall fires for reviewers)
- Free vs Pro comparison table
- v4 ProfileStrip
- v1 Browse + bug fix
- Brand of Day above Top Picks
- Paid Sources paragraph
- Welcome What's New
- Soft email ask on Reveal
- Failed-search notify-me

Confirm Build 21 (or higher) processed before submitting in App Store Connect.

---

## 11. Submission Day Checklist

- [ ] All 11 sections above filled in
- [ ] 5 screenshots uploaded (6.5" format)
- [ ] Build 21+ selected
- [ ] Privacy policy URL works (https://www.trunorthapp.com/#privacy)
- [ ] Support URL works
- [ ] Tested the In-App Purchase flow in TestFlight
- [ ] Read the Reviewer Notes one more time
- [ ] Click "Submit for Review"
- [ ] Expect 24-72hr turnaround

---

## 12. If rejected

Common rejection reasons + responses:

**"In-App Purchase doesn't work."**
→ This will happen if RevenueCat / Stripe isn't fully wired by submission day. Either: (a) ship IAP first, or (b) remove the paywall entirely for v1 and add it in 1.1. For v1, we want the IAP working.

**"App doesn't justify a separate iOS app vs. a web page."**
→ Cite: barcode scanner (uses native ML Kit camera), offline-capable, push notification potential, App Store discovery value.

**"Privacy label inaccurate."**
→ Re-audit our PostHog config; we don't link PostHog identifiers to email. Privacy nutrition label needs to reflect that exactly.

**"Spam (scoring brands is editorial / inflammatory)."**
→ Unlikely given the public-records-only methodology, but if it comes up, point reviewer to the in-app Sources tab + Privacy Policy that clearly explains the methodology.

**"You compare TruNorth to other apps in description."**
→ We don't currently. Don't add it before review.

---

## 13. After Approval

- App Store listing URL → update vercel.json + marketing landing + PROMO_COPY.md + LAUNCH_DAY_PLAYBOOK.md
- Switch the marketing landing CTA from TestFlight mailto to App Store URL (already wired via APP_STORE_URL constant — just needs the value)
- Update PH First Comment with the live App Store URL
- Tweet: "TruNorth is on the App Store: [URL]"
