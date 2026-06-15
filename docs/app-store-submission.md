# TruNorth — App Store Resubmission Sheet (Build 74)

> **Status — 2026-06-14:** Resubmitting **iOS 1.0** after the Jun-11 rejection. **Build 74** (iPhone-only) is the candidate. Every cited issue is fixed in the binary; this is the paste-ready metadata + the exact App Store Connect steps.
>
> **App:** `com.trunorthapp.app` · TruNorthApp (app id 6775301458) · SKU `trunorth-001`
> **Build 74 delivery:** `e31f4220-006b-4ca4-a839-4875bce63053`

---

## Why it was rejected — and where each fix lives

Apple's rejection (Submission `50e085d7`, reviewed on an **iPad**, v1.0 build 51) cited three guidelines:

| Guideline | What Apple said | Fix |
|---|---|---|
| **3.1.1** Payments – IAP | Subscriptions purchasable via a mechanism other than IAP (the old email **waitlist**) | ✅ B74 = real StoreKit purchase via RevenueCat; waitlist gone |
| **3.1.2(c)** Subscriptions | Need functional **Terms of Use (EULA)** + **Privacy Policy** links **in the app** AND **in metadata** | ✅ In-app: on the paywall · Metadata: EULA line in Description (below) + Privacy Policy URL field |
| **2.1(b)** Completeness | IAPs not submitted for review + must provide an **App Review screenshot** | ✅ Attach both subs to the version + upload the IAP screenshot to each |

Also proactively fixed: **5.1.1** — the paywall no longer *requires* an email to purchase (email is optional). **Build 74** additionally reworded the archetype Reveal's email card off the stale "ship on the App Store" waitlist line (now a neutral "Stay in the loop?" opt-in) and ships a refreshed `05-reveal.png` with that card dismissed. The app is now **iPhone-only**, so the iPad screenshot requirement is gone.

---

## The exact ASC steps  (Distribution → iOS App 1.0)

1. **Build** → attach **Build 74** (wait until it shows VALID — ~10–15 min after upload).
2. **In-App Purchases and Subscriptions** (on the version) → **＋** → add **TruNorth Pro Annual** *and* **TruNorth Pro Monthly**.
3. For **each subscription** → **Review Information → Screenshot** → upload `docs/marketing/iap-review/paywall-real-65.png` (same file for both). *(This is the "App Review screenshot" 2.1(b) requires.)*
4. **Previews and Screenshots → iPhone 6.5"** → drag the 5 from `docs/app-store-screenshots/final-65/` in order **01 → 05**. *(iPhone-only — no iPad slot.)*
5. **Promotional Text** → paste below.
6. **Description** → paste below (already includes the EULA link).
7. **App Review Information** → Sign-in required: **No** · Notes below · Contact: Aron / Aron@trunorthapp.com.
8. **Reply** to the rejection: App Review (sidebar) → the **Jun 7** submission → **Reply to App Review** → paste the reply below.
9. **Save** → **Resubmit to App Review**. Answer the gates: **Export compliance** = exempt (standard HTTPS) · **IDFA / advertising identifier** = No · **Content rights** = Yes.

---

## Paste-ready fields

### Name (30) · Subtitle (30)
```
TruNorth
```
```
Shop your values · Real data
```

### Promotional Text (170 char)
```
Public records, not opinions. ~2,900 brands graded, 12,000+ tracked. Take the 45-second values Match to personalize every score.
```

### Keywords (100 char, no spaces after commas)
```
ethical,shopping,values,consumer,brands,scanner,barcode,sustainability,ESG,politics,labor,environment
```

### Description
```
WHAT YOU BUY MATTERS — TruNorth shows you how every brand really behaves, using public records, not opinions.

We track 12,000+ companies and grade ~2,900 of them across 9 categories that consumers actually care about:
• Political donations
• Environmental enforcement
• Labor practices
• DEI & social equity
• Charitable giving
• Animal testing
• Firearms policy
• Data privacy
• Executive pay ratio

EVERY GRADE IS AUDITABLE
Every score comes from public databases — SEC EDGAR, FEC, OSHA, EPA, CFPB, NHTSA, NLRB, OpenFDA, and many more. No editorial opinions. No vibes.

PERSONALIZED FOR YOUR VALUES
Take the 45-second values Match once. Every brand grade rebalances to match what YOU care about. A user who cares about climate sees different scores than someone who cares about labor practices.

IN-STORE BARCODE SCANNER
Scan any product in the store. Get the verdict in 2 seconds before you pay.

FREE
The core experience is free. Browse 12,000+ companies, take the values Match, see letter grades, scan barcodes. TruNorth Pro ($1.99/mo or $14.99/yr) unlocks personalized scoring, per-grade citations, the full sources directory, and the weekly digest.

NO ADS · NO AFFILIATE LINKS · NO SELLING YOUR DATA

If you've ever wanted to align your shopping with your values but didn't want to take any company's word for it, TruNorth is built for you.

— Aron, founder

Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### App Review Information → Notes
```
TruNorth is anonymous — no login needed. Browse the whole app as a guest.

SUBSCRIPTION (this build resolves the prior 3.1.1 / 3.1.2 rejection):
Tap the gold "Upgrade" pill (top-right), or any locked feature, to open the paywall. It shows both plans (Annual $14.99 / Monthly $1.99), an auto-renew disclosure, functional Terms of Use + Privacy Policy links, and a "Restore Purchases" button. The paywall completes a real StoreKit purchase via RevenueCat; Restore re-grants Pro on a fresh install. Verified end-to-end in sandbox (purchase + restore). Email is optional — it never blocks the purchase.

GETTING STARTED: the 45-second values "Match" is optional and free — you can browse graded companies immediately. Tap a company to see its grade; the in-store barcode Scanner is the center tab.

No data sold/shared. US-only by design. Privacy: https://www.trunorthapp.com/#privacy
Contact: Aron Rosenfield · Aron@trunorthapp.com
```

### Reply to App Review (on the Jun 7 rejection thread)
```
Build 74 resolves the cited issues:

• 3.1.1 — the subscription now completes a real StoreKit purchase via RevenueCat (the prior email "waitlist" mechanism is removed). Email is optional and never blocks the purchase.
• 3.1.2(c) — the paywall now shows the auto-renew terms and functional Terms of Use (EULA) + Privacy Policy links; a Terms of Use (EULA) link is in the App Description and the Privacy Policy is set in the Privacy Policy field.
• 2.1(b) — both subscriptions (Annual + Monthly) are attached to this version, each with an App Review screenshot.

Verified end-to-end in sandbox: purchase succeeds, Restore Purchases re-grants Pro on a fresh install. Thank you.
```

---

## Assets & config (verify these are set)
- **Build:** 74 (iPhone-only) · **Screenshots:** 5 × iPhone 6.5" (`docs/app-store-screenshots/final-65/`) · **IAP screenshot:** `docs/marketing/iap-review/paywall-real-65.png` (both subs)
- **Subscriptions** (group 22148623): TruNorth Pro Annual `com.trunorthapp.app.pro.annual` $14.99/yr · TruNorth Pro Monthly `com.trunorthapp.app.pro.monthly` $1.99/mo
- **Privacy Policy URL:** `https://www.trunorthapp.com/#privacy` · **Support URL:** `https://www.trunorthapp.com`
- **Price:** Free · **Age rating:** 4+ · **Category:** News / Shopping
- **Export compliance:** standard HTTPS only (exempt) · **IDFA:** not used · **Content rights:** yes

## After approval
- Set `APP_STORE_URL` (marketing landing CTA flips from the TestFlight mailto automatically) · update PH First Comment + announcement copy with the live URL · merge PR #109 to deploy the web changes.
