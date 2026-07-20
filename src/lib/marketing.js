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

import { track } from "./analytics";
import { apiUrl } from "./dataSource";

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

  // 1) Persist so we can prefill on future visits
  try { localStorage.setItem("tn_email", cleaned); } catch {}

  // 2) Analytics event (never blocks — never throws).
  // NOTE (2026-06-12 review): we deliberately do NOT identify() the raw email
  // into PostHog. Setting a plaintext email as distinct_id leaks PII and
  // contradicts the app's anonymous-analytics promise (and is a no-op anyway
  // under persistence:'memory'). The capture is still counted here.
  try { track("email_captured", { source, ...metadata }); } catch {}

  // 3) Server-side proxy to MailerLite (key never touches the client bundle).
  // apiUrl() rewrites to the production origin on native iOS (relative paths
  // resolve to capacitor://localhost there and never reach the edge function).
  try {
    const res = await fetch(apiUrl(SUBSCRIBE_ENDPOINT), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: cleaned, source, metadata }),
    });
    // 2026-07-20 (v1.2 review): these two paths returned ok:true on a FAILED
    // call, so every caller reported success to the user even when the email
    // never reached MailerLite — combined with the CORS scheme mismatch (see
    // api/subscribe.js), native "notify me when we grade this" signups were
    // very likely 403'ing while the UI rendered "✓ we'll email you". Report
    // the truth; callers are responsible for a retry affordance.
    if (!res.ok) {
      console.warn("[marketing] /api/subscribe returned", res.status);
      return { ok: false, source, warning: `subscribe_${res.status}` };
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
    return { ok: false, source, warning: "subscribe_network" };
  }
}

const DELETE_ENDPOINT = "/api/delete-account";

/**
 * Deletes the user's server-side data — their email in MailerLite — for the
 * in-app "Delete Account" flow (App Store Guideline 5.1.1(v): account creation
 * requires in-app account deletion, not "email support"). Best-effort: always
 * resolves ok:true (even on a transient error or no-email-on-file) so the
 * local data wipe + on-screen confirmation still complete. The RevenueCat
 * purchase record is intentionally retained — Apple requires receipt history
 * for "Restore Purchases".
 * @param {string} email — the stored email (may be empty)
 * @returns {Promise<{ok: boolean, deleted?: boolean, warning?: string}>}
 */
export async function deleteAccountData(email) {
  const cleaned = String(email || "").trim().toLowerCase();
  try { track("account_deleted", { had_email: !!(cleaned.includes("@") && cleaned.includes(".")) }); } catch {}
  if (!cleaned.includes("@") || !cleaned.includes(".")) {
    return { ok: true, deleted: false }; // nothing server-side to remove
  }
  try {
    const res = await fetch(apiUrl(DELETE_ENDPOINT), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: cleaned }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: data.ok !== false, deleted: !!data.deleted, warning: data.warning };
  } catch (err) {
    console.warn("[marketing] /api/delete-account call failed:", err);
    return { ok: true, deleted: false, warning: "delete_network" };
  }
}

/** Prefill helper — returns the stored email if any. */
export function getStoredEmail() {
  try { return localStorage.getItem("tn_email") || ""; }
  catch { return ""; }
}
