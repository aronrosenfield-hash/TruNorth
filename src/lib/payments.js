// ─── Payments — RevenueCat + StoreKit wrapper ────────────────────────────────
//
// 2026-06-10 (X-2): real IAP wiring. Replaces the setTimeout(1500) fake in
// PaywallScreen.handleSubscribe. iOS uses RevenueCat → Apple StoreKit; web
// is no-op (post-launch we'll add Stripe Checkout via RevenueCat web).
//
// Product IDs match what was created in App Store Connect → IAPs
// (see docs/payments-integration-plan.md). Entitlement identifier "pro"
// matches the RevenueCat dashboard config.
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
const ENTITLEMENT_ID = "pro";

// Track whether we've already called configure() — RevenueCat is fine with
// duplicate calls but they're wasted work + log spam.
let configured = false;

/** Initialize the SDK. Safe to call multiple times. No-ops on web. */
export async function configurePayments(appUserID = null) {
  if (!Capacitor.isNativePlatform()) return;
  if (configured) return;
  if (!IOS_API_KEY) {
    console.warn("[payments] VITE_REVENUECAT_IOS_KEY missing — paywall will fail silently");
    return;
  }
  const RC = await loadRC();
  if (!RC) return;
  // Anonymous by default; appUserID can be set later via logIn() once we
  // have a real auth/email identity to associate purchases with.
  await RC.Purchases.configure({ apiKey: IOS_API_KEY, appUserID });
  configured = true;
}

/** Returns true if the user currently has the "pro" entitlement active. */
export async function hasProEntitlement() {
  if (!Capacitor.isNativePlatform()) return false;
  const RC = await loadRC();
  if (!RC) return false;
  try {
    await configurePayments();
    const { customerInfo } = await RC.Purchases.getCustomerInfo();
    const ent = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return ent != null;
  } catch (err) {
    console.warn("[payments] hasProEntitlement failed:", err?.message || err);
    return false;
  }
}

/** Get available offerings. Returns { monthly, annual, all } or null on failure. */
export async function getOfferings() {
  if (!Capacitor.isNativePlatform()) return null;
  const RC = await loadRC();
  if (!RC) return null;
  try {
    await configurePayments();
    const { offerings } = await RC.Purchases.getOfferings();
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

/** Purchase a specific package. Returns true if entitlement is now active. */
export async function purchasePackage(pkg) {
  if (!Capacitor.isNativePlatform()) return false;
  if (!pkg) return false;
  const RC = await loadRC();
  if (!RC) return false;
  try {
    await configurePayments();
    const { customerInfo } = await RC.Purchases.purchasePackage({ aPackage: pkg });
    const ent = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return ent != null;
  } catch (err) {
    // User-cancel comes through as a thrown error — silent.
    if (err?.userCancelled) return false;
    console.warn("[payments] purchasePackage failed:", err?.message || err);
    return false;
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
 * Returns true if Pro is now active.
 */
export async function purchasePro(tier = "annual") {
  const offerings = await getOfferings();
  if (!offerings) return false;
  const pkg = tier === "monthly" ? offerings.monthly : offerings.annual;
  if (!pkg) return false;
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
