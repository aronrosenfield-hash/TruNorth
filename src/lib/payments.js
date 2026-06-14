// ─── Payments — RevenueCat + StoreKit wrapper ────────────────────────────────
//
// 2026-06-10 (X-2): real IAP wiring. Replaces the setTimeout(1500) fake in
// PaywallScreen.handleSubscribe. iOS uses RevenueCat → Apple StoreKit; web
// is no-op (post-launch we'll add Stripe Checkout via RevenueCat web).
//
// Product IDs match what was created in App Store Connect → IAPs
// (see docs/payments-integration-plan.md). Entitlement identifier
// "TruNorth Pro" (with the space) matches the RevenueCat dashboard config
// (confirmed 2026-06-13). See ENTITLEMENT_ID below — keep them identical.
//
// USAGE
//   import { configurePayments, hasProEntitlement, purchasePackage,
//            restorePurchases, getOfferings } from "./lib/payments";
//
//   At app boot:
//     await configurePayments();             // safe to call repeatedly
//     const paid = await hasProEntitlement(); // initial entitlement check
//
//   When user taps a paywall button:
//     const offerings = await getOfferings();
//     const annual = offerings.annual;
//     const ok = await purchasePackage(annual);
//
//   Restore button:
//     const ok = await restorePurchases();

import { Capacitor } from "@capacitor/core";

// Capacitor-only dynamic import — the @revenuecat/purchases-capacitor package
// is iOS+Android native and won't load cleanly in a web SSR/build context.
let PurchasesMod = null;
async function loadRC() {
  if (PurchasesMod) return PurchasesMod;
  if (!Capacitor.isNativePlatform()) return null;
  PurchasesMod = await import("@revenuecat/purchases-capacitor");
  return PurchasesMod;
}

const IOS_API_KEY  = import.meta.env.VITE_REVENUECAT_IOS_KEY || "";
const ENTITLEMENT_ID = "TruNorth Pro"; // exact RevenueCat entitlement identifier (confirmed 2026-06-13)

// PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR — the only error-shape that
// reliably crosses the Capacitor bridge is `err.code` (the native side rejects
// with (message, code) and no data dict, so `err.userCancelled` is always
// undefined — QA finding 2026-06-10). Inlined to avoid importing the enum on web.
const PURCHASE_CANCELLED_CODE = "1";

// Cache the in-flight configure promise (not a boolean) so a mount-effect and
// a tap handler racing each other can't both invoke native configure().
let configurePromise = null;

/** Initialize the SDK. Safe to call multiple times. No-ops on web. */
export function configurePayments(appUserID = null) {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (configurePromise) return configurePromise;
  if (!IOS_API_KEY) {
    console.warn("[payments] VITE_REVENUECAT_IOS_KEY missing — paywall will fail silently");
    return Promise.resolve();
  }
  configurePromise = (async () => {
    const RC = await loadRC();
    if (!RC) return;
    // Anonymous by default; appUserID can be set later via logIn() once we
    // have a real auth/email identity to associate purchases with.
    await RC.Purchases.configure({ apiKey: IOS_API_KEY, appUserID });
  })().catch((err) => {
    configurePromise = null; // allow retry after a failed configure
    throw err;
  });
  return configurePromise;
}

/**
 * Tri-state entitlement check:
 *   true  — RevenueCat verified the "pro" entitlement is active
 *   false — RevenueCat answered and it is NOT active (safe to revoke)
 *   null  — couldn't get an answer (web / network error / SDK missing) — do
 *           NOT revoke on null; keep whatever local state says.
 */
export async function hasProEntitlement() {
  if (!Capacitor.isNativePlatform()) return null;
  const RC = await loadRC();
  if (!RC) return null;
  try {
    await configurePayments();
    const { customerInfo } = await RC.Purchases.getCustomerInfo();
    const ent = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return ent != null;
  } catch (err) {
    console.warn("[payments] hasProEntitlement failed:", err?.message || err);
    return null;
  }
}

/** Get available offerings. Returns { monthly, annual, all } or null on failure. */
export async function getOfferings() {
  if (!Capacitor.isNativePlatform()) return null;
  const RC = await loadRC();
  if (!RC) return null;
  try {
    await configurePayments();
    // v13 returns the PurchasesOfferings object DIRECTLY ({ all, current }) —
    // no wrapper key. Destructuring { offerings } returned undefined and made
    // every purchase silently no-op (QA P0, 2026-06-10).
    const offerings = await RC.Purchases.getOfferings();
    const current = offerings?.current;
    if (!current) return null;
    return {
      monthly: current.monthly || null,
      annual:  current.annual  || null,
      all:     current.availablePackages || [],
    };
  } catch (err) {
    console.warn("[payments] getOfferings failed:", err?.message || err);
    return null;
  }
}

/**
 * Purchase a specific package.
 * Returns: "purchased" | "cancelled" | "failed"
 * (Callers treat only "purchased" as success; "cancelled" must not be
 * tracked as a failure.)
 */
export async function purchasePackage(pkg) {
  if (!Capacitor.isNativePlatform()) return "failed";
  if (!pkg) return "failed";
  const RC = await loadRC();
  if (!RC) return "failed";
  try {
    await configurePayments();
    const { customerInfo } = await RC.Purchases.purchasePackage({ aPackage: pkg });
    const ent = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return ent != null ? "purchased" : "failed";
  } catch (err) {
    if (String(err?.code) === PURCHASE_CANCELLED_CODE) return "cancelled";
    console.warn("[payments] purchasePackage failed:", err?.message || err);
    return "failed";
  }
}

/** Restore Purchases — Apple requires this on every subscription paywall. */
export async function restorePurchases() {
  if (!Capacitor.isNativePlatform()) return false;
  const RC = await loadRC();
  if (!RC) return false;
  try {
    await configurePayments();
    const { customerInfo } = await RC.Purchases.restorePurchases();
    const ent = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return ent != null;
  } catch (err) {
    console.warn("[payments] restorePurchases failed:", err?.message || err);
    return false;
  }
}

/**
 * Convenience: given a chosen plan tier, fetch offerings + complete purchase.
 * tier: "annual" | "monthly"
 * Returns: "purchased" | "cancelled" | "failed" (same contract as purchasePackage).
 */
export async function purchasePro(tier = "annual") {
  const offerings = await getOfferings();
  if (!offerings) return "failed";
  const pkg = tier === "monthly" ? offerings.monthly : offerings.annual;
  if (!pkg) return "failed";
  return purchasePackage(pkg);
}

/** Tag the active anonymous user with the email captured at paywall time. */
export async function setEmailOnCustomer(email) {
  if (!Capacitor.isNativePlatform() || !email) return;
  const RC = await loadRC();
  if (!RC) return;
  try {
    await configurePayments();
    await RC.Purchases.setAttributes({ "$email": email });
  } catch (err) {
    console.warn("[payments] setEmailOnCustomer failed:", err?.message || err);
  }
}
