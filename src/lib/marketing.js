// Phase 4.7 — email capture / marketing.
//
// subscribeEmail(email, source, metadata) is the single entry point used at
// every capture touchpoint (paywall, quiz completion, save-prompt, submit form).
// It does three things:
//   1. Fires a PostHog `email_captured` event so the funnel is visible in analytics.
//   2. POSTs to MailerLite (if VITE_MAILERLITE_API_KEY is configured) to add
//      the subscriber to the configured group.
//   3. Stores the email in localStorage `tn_email` so we can prefill future
//      forms and identify the user across sessions.
//
// When MailerLite isn't configured (no env vars), the call resolves successfully
// — analytics fires, localStorage saves, the user flow continues. This keeps
// dev / prod-before-MailerLite-signup working without any feature flag.

import { track, identify } from "./analytics";

// CRITICAL FIX (audit 2026-06-01): MailerLite API key was here, but
// VITE_-prefixed values inline into the public bundle at build time —
// the moment Vercel had the var set, the write key would have been
// extractable from the JS bundle. Now we POST to our own /api/subscribe
// edge function, which holds MAILERLITE_API_KEY (no VITE_ prefix)
// server-side. Same client-facing API for backwards compatibility.
const SUBSCRIBE_ENDPOINT = "/api/subscribe";

/**
 * Captures an email at a known funnel point.
 * @param {string} email — the user-entered email
 * @param {string} source — short stable identifier ("paywall" | "quiz_complete" | "save_first" | "submit_form")
 * @param {object} [metadata] — extra context (companyName for "save_first", etc.)
 * @returns {Promise<{ok: boolean, error?: string, source: string}>}
 */
export async function subscribeEmail(email, source, metadata = {}) {
  const cleaned = String(email || "").trim().toLowerCase();
  if (!cleaned.includes("@") || !cleaned.includes(".")) {
    return { ok: false, error: "invalid_email", source };
  }

  // 1) Persist so we can prefill / identify on future visits
  try { localStorage.setItem("tn_email", cleaned); } catch {}

  // 2) PostHog identification — links this email to the anonymous distinctId
  try { identify(cleaned, { source, ...metadata }); } catch {}

  // 3) Analytics event (never blocks — never throws)
  try { track("email_captured", { source, ...metadata }); } catch {}

  // 4) Server-side proxy to MailerLite (key never touches the client bundle)
  try {
    const res = await fetch(SUBSCRIBE_ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: cleaned, source, metadata }),
    });
    if (!res.ok) {
      console.warn("[marketing] /api/subscribe returned", res.status);
      return { ok: true, source, warning: `subscribe_${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    // 2026-06-05: pass through requiresVerification so the calling UI can
    // show "Check your inbox" when MailerLite is sending a double-opt-in
    // confirmation email.
    return {
      ok: data.ok !== false,
      source,
      warning: data.warning,
      requiresVerification: !!data.requiresVerification,
    };
  } catch (err) {
    console.warn("[marketing] /api/subscribe call failed:", err);
    return { ok: true, source, warning: "subscribe_network" };
  }
}

/** Prefill helper — returns the stored email if any. */
export function getStoredEmail() {
  try { return localStorage.getItem("tn_email") || ""; }
  catch { return ""; }
}
