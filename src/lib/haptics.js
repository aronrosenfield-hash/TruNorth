// ─── Haptics — thin wrapper around @capacitor/haptics ────────────────────────
//
// QA-10 (2026-06-14): the app had ZERO haptic feedback — a flagged "feels
// static" gap. This fires native taps on key moments (Match answers, the
// Switch, purchase/restore success). No-ops on web and any non-native
// platform, and never throws — callers can fire-and-forget.
//
//   import { tapLight, tapMedium, notifySuccess } from "./lib/haptics";
//   tapLight();   // selection / choice
//   tapMedium();  // commit an action
//   notifySuccess(); // reward (purchase/restore)

import { Capacitor } from "@capacitor/core";

let HapticsMod = null;
async function load() {
  if (HapticsMod) return HapticsMod;
  if (!Capacitor.isNativePlatform()) return null;
  HapticsMod = await import("@capacitor/haptics");
  return HapticsMod;
}

/** Light selection tick — taps/choices (Match answers, chips). */
export async function tapLight() {
  try { const H = await load(); if (H) await H.Haptics.impact({ style: H.ImpactStyle.Light }); } catch {}
}

/** Medium tap — committing an action (the Switch, save). */
export async function tapMedium() {
  try { const H = await load(); if (H) await H.Haptics.impact({ style: H.ImpactStyle.Medium }); } catch {}
}

/** Success notification buzz — purchase / restore success. */
export async function notifySuccess() {
  try { const H = await load(); if (H) await H.Haptics.notification({ type: H.NotificationType.Success }); } catch {}
}
