# Payments integration plan — Stripe + RevenueCat

Currently `PaywallScreen.handleSubscribe()` is a `setTimeout(1500)` fake.
This doc is the plan for the real wire — unblocked the moment LLC + bank
account are live.

## Recommended: RevenueCat (covers iOS + web with one SDK)

**Why RevenueCat over raw Stripe:**
- iOS App Store requires Apple's in-app purchase for digital subscriptions — you can't legally use Stripe for that on TestFlight/App Store. RevenueCat wraps StoreKit so the iOS app pays via Apple, but you still get a unified subscriber dashboard.
- Web (trunorthapp.com) uses Stripe Checkout via RevenueCat — same subscriber DB, same entitlement model.
- Free under $10K MTR (Monthly Tracked Revenue). At $1.99/mo that's 5,000 paying subs before the bill starts — far past launch.

## Prerequisites (you must complete first)

1. ✅ Apple Developer Program enrolled (done)
2. ⏳ LLC formed → bank account opened
3. ⏳ Stripe account verified with bank
4. ⏳ App Store Connect → Agreements, Tax, Banking → Paid Apps agreement signed + tax forms completed
5. ⏳ App Store Connect → In-App Purchases → create "trunorth_pro_monthly" ($1.99/mo) and "trunorth_pro_annual" ($14/yr — recommended pricing per QA report, save 26% vs monthly)
6. ⏳ RevenueCat free account → connect both Stripe + App Store Connect

## Code shape (once ready)

```js
// src/lib/payments.js
import { Purchases } from "@revenuecat/purchases-capacitor"; // ios
// + web stub via stripe.js

export async function purchasePro(email) {
  if (Capacitor.isNativePlatform()) {
    await Purchases.configure({ apiKey: import.meta.env.VITE_REVENUECAT_IOS_KEY });
    const offerings = await Purchases.getOfferings();
    const monthly   = offerings.current?.monthly;
    const purchase  = await Purchases.purchasePackage({ aPackage: monthly });
    return purchase.customerInfo.entitlements.active.pro != null;
  } else {
    // Web: Stripe Checkout redirect
    const res = await fetch("/api/checkout", { method: "POST", body: JSON.stringify({ email }) });
    const { url } = await res.json();
    window.location.href = url;
  }
}
```

Then in `PaywallScreen.handleSubscribe()`:

```js
const ok = await purchasePro(email);
if (ok) onSubscribe(email);
```

## Pricing strategy (per QA fleet stickiness report)

| Plan | Price | Anchor |
|---|---|---|
| Annual | **$14/year** (default) | strike through "$24" — "save 42%" |
| Monthly | $1.99/mo | secondary CTA |

Annual lock-in bumps LTV ~6x vs monthly churn. Use the annual price as the BIG button on the paywall, monthly as the small text link below.

## Estimated time once unblocked

- RevenueCat setup: 30 min
- iOS StoreKit IAP creation in App Store Connect: 1-2 hours (Apple validation can be slow)
- Code wire + test in TestFlight sandbox: 2 hours
- Web Stripe Checkout via Vercel serverless function: 2 hours
- **Total: half a day's work**

Block: LLC + bank.
