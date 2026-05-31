/**
 * Capacitor native bridge — initialized only when running inside the
 * native iOS app. Safe no-op when running as a regular browser PWA.
 *
 * Adds:
 *   - StatusBar styled to match the dark app
 *   - SplashScreen auto-hide once React mounts
 *   - App URL-open listener (handles deep links from share sheet, etc.)
 *   - Hardware back button — collapses cards / clears focus instead of
 *     nuking the WebView (iOS swipe-back also routes through here)
 */

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
    App.addListener("backButton", () => {
      if (window.history.length > 1) window.history.back();
      else App.exitApp();
    });
  } catch (e) {
    console.warn("[cap] App listeners failed:", e);
  }
}
