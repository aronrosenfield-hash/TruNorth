import { createRoot } from 'react-dom/client'
import './index.css'
// M8 (2026-06-11): subset icon font — 84 used glyphs, 12KB vs the full
// 5,800-glyph 457KB woff2. Regenerate src/tabler-subset.css + assets woff2
// when adding icons (see comment inside the css).
import './tabler-subset.css'
import App from './App.jsx'
import { initCapacitor } from './lib/capacitor-init'
import { ConfirmProvider } from './components/ConfirmModal'
import { ErrorBoundary } from './lib/ErrorBoundary'

// App Store 5.1.1(v) account deletion — finish the reset on the FIRST load
// after the in-app "Delete Account" flow set this flag. Running HERE, before
// React mounts, removes any tn_* key the old (pre-reload) component tree
// re-persisted during the reload transition — notably tn_email, which a live
// email-state component re-writes after the handler's wipe but before the
// browser actually navigates. After this, the fresh mount has no armed state,
// so nothing re-persists (verified). The sessionStorage flag survives the
// reload; this localStorage wipe never touches it.
try {
  if (sessionStorage.getItem("tn_account_reset") === "1") {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("tn_")) localStorage.removeItem(k);
    }
    sessionStorage.removeItem("tn_account_reset");
  }
} catch {}

// Phase 5.am: Native bridge — only runs when inside the Capacitor iOS shell.
initCapacitor()

// 2026-06-05 (PageSpeed Tier 3): on /company/<slug> URLs, the Edge function
// at api/company-seo.js already painted brand grades + narratives inside
// the visible #root. If we hydrate React immediately, it wipes that content
// before the browser can latch onto it as the LCP element — exactly what
// Lighthouse measured as 5.1s on /company/walmart.
//
// Trick: hand the browser ONE animation frame (~16ms) to paint the SEO
// content, then mount React. LCP now fires at FCP+1frame (~2s), then
// React mounts and replaces. The brief flash is invisible because the
// SEO HTML and React's first render look near-identical (same dark bg,
// same brand name in same position).
//
// Marketing landing + privacy + Capacitor iOS shell: mount immediately,
// no SEO content to preserve there.
const path = typeof window !== "undefined" ? window.location.pathname : "/";
const isSeoLandingPath = /^\/(company|c)\//.test(path);

const mountReact = () => {
  // Phase 5.au: ConfirmProvider exposes themed alert/confirm/prompt hooks
  // (replaces native window dialogs which render as "trunorthapp.com says:"
  // scam-looking popups on Android Chrome).
  //
  // 2026-06-01 (audit fix): wrapped in root ErrorBoundary so a pre-main
  // crash (e.g. ReferenceError in marketing-screen routing) shows a
  // recoverable fallback instead of a white screen.
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary name="root">
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ErrorBoundary>
  );
};

if (isSeoLandingPath && typeof requestAnimationFrame === "function") {
  // Two rAFs ≈ one paint cycle. Tested: <33ms perceived delay, LCP
  // attaches to SEO paint instead of React-replaced content.
  //
  // R6 fix (2026-06-10): rAF is SUSPENDED in background tabs (and headless
  // browsers) — a share link opened in a background tab stayed a blank
  // white page until the tab was focused. The 250ms timeout fallback
  // guarantees the mount; in a foreground tab the rAF pair always wins
  // the race, so the LCP behavior is unchanged.
  let mounted = false;
  const mountOnce = () => { if (!mounted) { mounted = true; mountReact(); } };
  requestAnimationFrame(() => requestAnimationFrame(mountOnce));
  setTimeout(mountOnce, 250);
} else {
  mountReact();
}
