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
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    persistence: 'memory',         // cookieless — no consent banner needed
    autocapture: true,             // grabs most clicks/forms automatically
    capture_pageview: true,
    disable_session_recording: false,
    loaded: (ph) => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[analytics] PostHog ready', ph.get_distinct_id?.());
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
