// B-74 — Android hardware Back stack.
//
// THE BUG THIS REPLACES: capacitor-init.js used to do
//   window.history.length > 1 ? history.back() : App.exitApp()
// but the app never calls pushState — the only history writes are
// replaceState, which does NOT grow history.length. In a fresh Capacitor
// WebView that length is 1, so the FIRST Back press called exitApp(): from
// onboarding, mid-Match, with the camera stream live, with the paywall open.
// Verified on a Pixel 8 emulator (Android 17) — one press from the basket
// picker ejected straight to the launcher and lost onboarding progress.
// Back is the PRIMARY navigation control on Android, so this is a Play blocker.
//
// THE MODEL: a module-level LIFO of dismiss handlers. Any overlay that can be
// closed registers itself while it's open; Back pops the top one. When nothing
// is registered, a single "root" handler gets a chance to navigate home. Only
// when that also declines do we fall through to double-tap-to-exit.
//
// Deliberately framework-free (plain module state, not context) so
// capacitor-init.js — which runs outside React — can consult it directly.

import { useEffect, useRef } from "react";

/** @type {Array<() => void>} LIFO — last registered overlay is closed first. */
const stack = [];

/** @type {null | (() => boolean)} Consulted only when the stack is empty. */
let rootHandler = null;

/**
 * Register a dismiss handler. Returns an unregister function suitable for
 * direct use as a useEffect cleanup.
 */
export function pushBackHandler(fn) {
  if (typeof fn !== "function") return () => {};
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * Register the fallback handler (App's "go back to the main screen").
 * Must return true if it actually navigated, false if it's already at the root.
 */
export function setRootBackHandler(fn) {
  rootHandler = typeof fn === "function" ? fn : null;
  return () => {
    if (rootHandler === fn) rootHandler = null;
  };
}

/**
 * Handle one Back press.
 * @returns {boolean} true if something consumed it; false → caller should
 *          apply its own exit policy (double-tap-to-exit).
 */
export function handleBack() {
  if (stack.length) {
    // Pop BEFORE invoking: the handler usually unmounts its component, whose
    // cleanup also unregisters. splice-by-identity makes that idempotent, and
    // popping first guarantees we can never loop on a handler that doesn't
    // actually unmount.
    const fn = stack.pop();
    try { fn(); } catch (e) { console.warn("[back-stack] handler threw:", e); }
    return true;
  }
  if (rootHandler) {
    try { return !!rootHandler(); } catch (e) {
      console.warn("[back-stack] root handler threw:", e);
      return false;
    }
  }
  return false;
}

/** Test/debug helper. */
export function backStackSize() { return stack.length; }

/**
 * Close-on-Back for an overlay.
 *
 * Every overlay in App.jsx already calls useModalA11y({ isOpen, onClose }),
 * so adding Back support is one line beside it:
 *     useBackDismiss(onClose);
 *
 * `onClose` is held in a ref, so an inline arrow passed fresh every render
 * does NOT churn the registration — we only re-register when `active` flips.
 */
export function useBackDismiss(onClose, active = true) {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; });
  useEffect(() => {
    if (!active) return undefined;
    return pushBackHandler(() => {
      const fn = ref.current;
      if (typeof fn === "function") fn();
    });
  }, [active]);
}
