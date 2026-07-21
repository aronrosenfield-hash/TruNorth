/**
 * Capacitor native bridge — initialized only when running inside the
 * native iOS app. Safe no-op when running as a regular browser PWA.
 *
 * Adds:
 *   - StatusBar styled to match the dark app
 *   - SplashScreen auto-hide once React mounts
 *   - App URL-open listener (handles deep links from share sheet, etc.)
 *   - Hardware back button — resolved through the shared back-stack (B-74):
 *     open overlay → main screen → double-tap-to-exit. Never quits on the
 *     first press.
 */

import { handleBack } from "./back-stack";

let isInitialized = false;

export async function initCapacitor() {
  if (isInitialized) return;
  isInitialized = true;

  // Bail cleanly if not running inside Capacitor (most users hit the web app)
  let Capacitor;
  try {
    const mod = await import("@capacitor/core");
    Capacitor = mod.Capacitor;
    if (!Capacitor.isNativePlatform()) return;
  } catch {
    return; // @capacitor/core not bundled in some builds — fine
  }

  // Status bar — match the dark app chrome
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0f0f0f" });
  } catch (e) {
    console.warn("[cap] StatusBar setup failed:", e);
  }

  // Auto-hide the splash once React's first paint is done
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    setTimeout(() => SplashScreen.hide().catch(() => {}), 200);
  } catch (e) {
    console.warn("[cap] SplashScreen hide failed:", e);
  }

  // Deep-link + back-button handling
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appUrlOpen", ({ url }) => {
      try {
        const u = new URL(url);
        const path = u.pathname + u.search;
        window.history.replaceState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch {}
    });
    // B-74 (2026-07-20): this used to be
    //   window.history.length > 1 ? history.back() : App.exitApp()
    // The app never calls pushState (only replaceState, which doesn't grow
    // history.length), so in a fresh WebView that length is 1 and the FIRST
    // Back press quit the app — verified on a Pixel 8: one press from the
    // basket picker ejected to the launcher mid-onboarding. Back is Android's
    // primary nav control, so we now resolve it in priority order:
    //   1. an open overlay dismisses itself (scanner / paywall / filters /
    //      compare / what's-new),
    //   2. otherwise the app navigates back to the main screen,
    //   3. only at the true root does Back exit — and then only on a second
    //      press within 2s, so it can never be accidental.
    let lastBackAt = 0;
    App.addListener("backButton", () => {
      if (handleBack()) return;

      const now = Date.now();
      if (now - lastBackAt < 2000) {
        App.exitApp();
        return;
      }
      lastBackAt = now;
      // Let the UI surface "Press back again to exit" if it wants to; exiting
      // silently on the second press is still correct without a listener.
      try { window.dispatchEvent(new CustomEvent("tn:back-exit-hint")); } catch {}
    });
  } catch (e) {
    console.warn("[cap] App listeners failed:", e);
  }
}
