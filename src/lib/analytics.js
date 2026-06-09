// TruNorth analytics — PostHog wrapper.
// Cookieless config: no GDPR banner needed, slightly worse cross-session attribution.
// Public client key, safe to ship in bundle.

import posthog from 'posthog-js';

let initialized = false;

// GEO measurement — detect when a visit was referred by an AI answer engine
// (ChatGPT, Perplexity, Gemini, Claude, Copilot, etc.). Registered as super
// properties so every event is filterable by `ai_referrer` / `ai_engine` in
// PostHog — that's our "is GEO sending traffic?" KPI. Heuristic, best-effort:
// many engines strip the referrer, so this is a floor, not a full count.
const AI_REFERRERS = [
  { host: /(^|\.)chatgpt\.com$/i,            engine: 'chatgpt' },
  { host: /(^|\.)openai\.com$/i,             engine: 'chatgpt' },
  { host: /(^|\.)perplexity\.ai$/i,          engine: 'perplexity' },
  { host: /(^|\.)gemini\.google\.com$/i,     engine: 'gemini' },
  { host: /(^|\.)bard\.google\.com$/i,       engine: 'gemini' },
  { host: /(^|\.)claude\.ai$/i,              engine: 'claude' },
  { host: /(^|\.)copilot\.microsoft\.com$/i, engine: 'copilot' },
  { host: /(^|\.)you\.com$/i,                engine: 'you' },
  { host: /(^|\.)phind\.com$/i,              engine: 'phind' },
  { host: /(^|\.)poe\.com$/i,                engine: 'poe' },
];

function detectAiReferrer() {
  try {
    const ref = document.referrer;
    if (!ref) return null;
    const host = new URL(ref).hostname;
    const match = AI_REFERRERS.find(r => r.host.test(host));
    if (match) return { ai_referrer: true, ai_engine: match.engine, ai_referrer_host: host };
  } catch {}
  return null;
}

export function initAnalytics() {
  if (initialized) return;
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    console.warn('[analytics] VITE_POSTHOG_KEY not set — analytics disabled');
    return;
  }
  // 2026-06-04: route through ph.trunorthapp.com subdomain proxy
  // (Vercel host-based rewrite to us.i.posthog.com). Earlier proxy
  // attempts appeared to fail with PostHog 401s — root cause was a
  // stale VITE_POSTHOG_KEY in Vercel env vars, NOT a proxy/CORS issue.
  // Now that the key is correct, the subdomain proxy should work.
  // ui_host stays on us.posthog.com for SDK dashboard links.
  const apiHost = import.meta.env.VITE_POSTHOG_HOST || 'https://ph.trunorthapp.com';
  const uiHost  = import.meta.env.VITE_POSTHOG_UI_HOST || 'https://us.posthog.com';
  posthog.init(key, {
    api_host: apiHost,
    ui_host:  uiHost,
    persistence: 'memory',         // cookieless — no consent banner needed
    autocapture: true,             // grabs most clicks/forms automatically
    capture_pageview: true,
    disable_session_recording: false,
    loaded: (ph) => {
      const ai = detectAiReferrer();
      if (ai) {
        ph.register(ai);            // attach to every subsequent event
        ph.capture('ai_referral', ai); // explicit landing event for funnels
      }
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[analytics] PostHog ready', ph.get_distinct_id?.(), 'via', apiHost, ai ? `· AI referral: ${ai.ai_engine}` : '');
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
