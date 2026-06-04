// TruNorth analytics — PostHog wrapper.
// Cookieless config: no GDPR banner needed, slightly worse cross-session attribution.
// Public client key, safe to ship in bundle.

import posthog from 'posthog-js';

let initialized = false;

export function initAnalytics() {
  if (initialized) return;
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    console.warn('[analytics] VITE_POSTHOG_KEY not set — analytics disabled');
    return;
  }
  // 2026-06-04: direct to PostHog. Ad-blockers will drop ~25-40% of
  // events but the proxy approaches (path-based and subdomain-based via
  // Vercel rewrites) both hit Vercel/PostHog CORS preflight issues.
  // Proper fix tracked in BACKLOG as B-28 (Cloudflare Worker reverse
  // proxy after DNS migration to Cloudflare).
  const apiHost = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
  const uiHost  = import.meta.env.VITE_POSTHOG_UI_HOST || 'https://us.posthog.com';
  posthog.init(key, {
    api_host: apiHost,
    ui_host:  uiHost,
    persistence: 'memory',         // cookieless — no consent banner needed
    autocapture: true,             // grabs most clicks/forms automatically
    capture_pageview: true,
    disable_session_recording: false,
    loaded: (ph) => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[analytics] PostHog ready', ph.get_distinct_id?.(), 'via', apiHost);
      }
    },
  });
  initialized = true;
}

export function track(event, props) {
  if (!initialized) return;
  posthog.capture(event, props);
}

export function identify(distinctId, props) {
  if (!initialized) return;
  posthog.identify(distinctId, props);
}

export default posthog;
